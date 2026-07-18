import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { BUILTIN_WORKFLOW_IDS } from "@agentmesh/core";
import {
  appendEvent,
  loadArtifacts,
  loadEvents,
  loadStatus,
  recordArtifact,
  resolveRunDirectory,
  saveStatus,
  writeFileAtomic,
  type PacketStatus,
} from "../packet/io.js";
import { withRunMutationLock, withRunMutationLockAsync } from "../packet/lock.js";
import {
  agentCallOutputFromError,
  agentCallTimingFromError,
  loadAgents,
  resolveAgent,
  runAgentCallAsync,
  runAgentCallWithTiming,
  type AgentCallResult,
  type AgentCallRuntimeTiming,
} from "../adapters.js";
import { lookupRuntimeAdapter } from "../adapters/registry.js";
import {
  closeReviewerSession,
  readReviewerSession,
  reviewerSessionInvocationFingerprint,
  reviewerSessionRef,
  sessionRegistryKey,
  upsertReviewerSession,
} from "../reviewer-sessions/registry.js";
import { withReviewerSessionLease } from "../reviewer-sessions/lease.js";
import {
  invokeReviewerWithSession,
  type ResolvedReviewerSessionScope,
} from "./reviewer-session-dispatch.js";
import { isReleaseVerdictNode, updateReleaseVerdict } from "../release/verdict.js";
import {
  adapterTimeoutSecsForDispatch,
  assertAutoDispatchAllowed,
  fanoutConcurrencyLimit,
  assertRetryAllowed,
} from "./execution-policy.js";
import {
  recordReviewAgentFailure,
  recordRawReviewOutputArtifact,
  refreshFindingsRawReviews,
  reviewArtifactName,
  safeAgentId,
} from "../review/artifacts.js";
import { refreshReleaseEvidenceSummary } from "../release/check.js";
import { readOptional } from "./files.js";
import {
  buildStagePrompt,
  contextReferencePromptContent,
  orderedPriorEvidenceSections,
  packetDisplayPath,
  recordPromptByteMetric,
  releaseSummaryPromptContent,
  writePrompt,
} from "./prompt.js";
import {
  assertStageInRun,
  canonicalStageOutputPath,
  firstIncompleteStage,
  protectCompletedArtifact,
  setStageState,
  stageAgents,
  stageArtifactFile,
  stageArtifactName,
  stageFanoutOutputPath,
  stageNodeForId,
  stageNodes,
  stageOutputPath,
  stringField,
} from "./state.js";
import type { DispatchOptions, DispatchResult } from "./types.js";

const FANOUT_OUTPUT_PROMPT_CONTENT_MAX_BYTES = 6_000;

interface FanoutAgentResult {
  agent: string;
  outputPath: string;
  reused: boolean;
  exitCode?: number;
  error?: unknown;
  timing?: Partial<AgentCallRuntimeTiming>;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
}

interface StageAgentAttemptResult {
  primaryAgent: string;
  actualAgent: string;
  exitCode?: number;
  error?: unknown;
  timing?: Partial<AgentCallRuntimeTiming>;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  success: boolean;
}

export function attachStageArtifact(
  run: string,
  stage: string,
  content: string,
  agent = "current",
  cwd = process.cwd(),
  options: DispatchOptions = {},
): string {
  const runDir = resolveRunDirectory(run, cwd);
  return withRunMutationLock(runDir, `flow.attach:${stage}`, () => {
    const status = loadStatus(runDir);
    assertStageInRun(status, stage);
    const node = stageNodeForId(status, stage);
    assertPredecessorsCompleted(status, node.id, "attach");
    const fileName = stageArtifactFile(status, stage);
    const artifactPath = canonicalStageOutputPath(runDir, status, stage);
    protectCompletedArtifact(status, stage, artifactPath);
    writeFileAtomic(artifactPath, `${content.trimEnd()}\n`);
    recordArtifact(runDir, stageArtifactName(status, stage), artifactPath, "markdown", stage, agent);
    appendEvent(runDir, "artifact.written", {
      artifact: stageArtifactName(status, stage),
      path: fileName,
      stage,
      node_id: node.id,
      stage_type: node.type,
      agent,
    });
    if (node.type === "decide") {
      updateReleaseVerdict(runDir, node.id, content);
    }
    completeStage(runDir, stage, agent);
    return artifactPath;
  }, { entrypoint: options.entrypoint });
}

export async function dispatchFlowStage(
  run: string,
  stage: string,
  options: DispatchOptions = {},
  cwd = process.cwd(),
): Promise<DispatchResult> {
  const runDir = resolveRunDirectory(run, cwd);
  return withRunMutationLockAsync(runDir, `flow.dispatch:${stage}`, async () => {
    if (stage === "all") {
      return dispatchRemainingStages(runDir, options, cwd);
    }
    const status = loadStatus(runDir);
    assertStageInRun(status, stage);
    await dispatchOneStage(runDir, status, stage, options, cwd);
    return { runDir, dispatched: [stage] };
  }, { entrypoint: options.entrypoint });
}

export async function retryFlowStage(
  run: string,
  stage?: string,
  options: DispatchOptions = {},
  cwd = process.cwd(),
): Promise<DispatchResult> {
  const runDir = resolveRunDirectory(run, cwd);
  return withRunMutationLockAsync(runDir, `flow.retry:${stage ?? "failed_stage"}`, async () => {
    const status = loadStatus(runDir);
    const target = stage ?? stringField(status, "failed_stage");
    if (!target) {
      throw new Error("no failed stage to retry; pass --stage <stage>");
    }
    assertStageInRun(status, target);
    if (status.completed_stages.includes(target)) {
      throw new Error(`cannot retry completed stage; artifact is protected: ${target}`);
    }
    assertRetryAllowed(status, target);
    appendStageEvent(runDir, "stage.retry_requested", status, target);
    await dispatchOneStage(runDir, status, target, options, cwd);
    return { runDir, dispatched: [target] };
  }, { entrypoint: options.entrypoint });
}

export async function resumeFlow(
  run: string,
  stage?: string,
  options: DispatchOptions = {},
  cwd = process.cwd(),
): Promise<DispatchResult> {
  const runDir = resolveRunDirectory(run, cwd);
  return withRunMutationLockAsync(runDir, `flow.resume:${stage ?? "next"}`, async () => {
    const status = loadStatus(runDir);
    const start = stage ?? stringField(status, "failed_stage") ?? firstIncompleteStage(status);
    if (!start) {
      return { runDir, dispatched: [] };
    }
    assertStageInRun(status, start);
    appendStageEvent(runDir, "flow.resume_requested", status, start);
    return dispatchRemainingStages(runDir, options, cwd, start);
  }, { entrypoint: options.entrypoint });
}

export function flowStatus(run: string, cwd = process.cwd()): PacketStatus {
  return loadStatus(resolveRunDirectory(run, cwd));
}

export function flowEvents(run: string, cwd = process.cwd()) {
  return loadEvents(resolveRunDirectory(run, cwd));
}

async function dispatchRemainingStages(
  run: string,
  options: DispatchOptions,
  cwd: string,
  startStage?: string,
): Promise<DispatchResult> {
  const runDir = resolveRunDirectory(run, cwd);
  let status = loadStatus(runDir);
  const orderedNodes = stageNodes(status);
  const startIndex = startStage
    ? orderedNodes.findIndex((node) => node.id === startStage)
    : 0;
  const dispatched: string[] = [];
  for (const node of orderedNodes.slice(Math.max(startIndex, 0))) {
    status = loadStatus(runDir);
    if (status.completed_stages.includes(node.id)) {
      continue;
    }
    const agents = stageAgents(status, node.id);
    if (agents.includes("current")) {
      appendStageEvent(runDir, "stage.awaiting_current", status, node.id);
      return { runDir, dispatched, awaitingCurrent: node.id };
    }
    await dispatchOneStage(runDir, status, node.id, options, cwd);
    dispatched.push(node.id);
  }
  return { runDir, dispatched };
}

async function dispatchOneStage(
  runDir: string,
  status: PacketStatus,
  stage: string,
  options: DispatchOptions,
  cwd: string,
): Promise<void> {
  const node = stageNodeForId(status, stage);
  assertPredecessorsCompleted(status, node.id);
  if (status.completed_stages.includes(node.id)) {
    return;
  }
  const agents = stageAgents(status, node.id);
  assertAutoDispatchAllowed(status);
  if (agents.length === 0) {
    throw new Error(`stage has no assigned agent: ${node.id}`);
  }
  if (agents.includes("current")) {
    throw new Error(
      `stage '${node.id}' is assigned to current; current is host-only and cannot be dispatched as a worker. Use flow prompt and flow attach for this stage.`,
    );
  }
  const isFanout = agents.length > 1;
  if (isFanout && !supportsFanoutStage(node.type)) {
    throw new Error(`stage '${node.id}' does not support multi-agent dispatch`);
  }
  assertAgentsSupportStage(agents, node.type, options.configPath, cwd);
  const requestedTimeoutSecs = adapterTimeoutSecsForDispatch(status, options.timeoutSecs);
  startStage(runDir, node.id, agents);
  if (isFanout) {
    const results = await dispatchFanoutAgents(runDir, status, node.id, agents, options, cwd);
    const failures = fanoutFailures(results);
    for (const result of fanoutSuccesses(results)) {
      if (!result.reused) {
        recordStageOutput(runDir, status, node.id, result.agent, result.outputPath, true);
      }
    }
    if (node.type === "review") {
      for (const failure of failures) {
        recordReviewAgentFailure(runDir, failure.agent, failure.exitCode, node);
      }
      refreshFindingsRawReviews(runDir, node);
    }
    if (node.type === "verify") {
      writeVerificationAggregate(runDir, status, node.id, results);
    }
    if (failures.length > 0) {
      const failure = failures[0];
      failStage(runDir, node.id, failure.agent, failure.exitCode);
      throw fanoutFailureError(node.id, failure);
    }
    if (requiresFanoutSynthesis(node.type)) {
      synthesizeFanoutStage(runDir, status, node.id, agents, options, cwd);
    }
    if (node.type === "decide") {
      updateReleaseVerdict(runDir, node.id, readOptional(canonicalStageOutputPath(runDir, status, node.id)));
    }
    completeStage(runDir, node.id, agents.join(","));
    return;
  }
  for (const agent of agents) {
    const outputPath = isFanout
      ? stageFanoutOutputPath(runDir, status, node.id, agent)
      : stageOutputPath(runDir, status, node.id, agent);
    if (isFanout && hasCompletedFanoutOutput(runDir, status, node.id, agent, outputPath)) {
      appendEvent(runDir, "stage.agent_reused", {
        stage: node.id,
        node_id: node.id,
        stage_type: node.type,
        agent,
        path: path.relative(runDir, outputPath).split(path.sep).join("/"),
      });
      continue;
    }
    const promptPath = writePrompt(runDir, node.id, cwd, agent);
    protectCompletedArtifact(status, node.id, outputPath);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    const result = await invokeStageAgentWithFallback(runDir, status, node.id, agent, {
      configPath: options.configPath,
      cwd,
      outputPath,
      primaryPromptPath: promptPath,
      requestedTimeoutSecs,
    });
    if (!result.success) {
      if (node.type === "review") {
        recordReviewAgentFailure(runDir, agent, result.exitCode, node);
      }
      failStage(runDir, node.id, result.actualAgent, result.exitCode);
      throw stageAttemptFailureError(node.id, result);
    }
    recordStageOutput(runDir, status, node.id, result.actualAgent, outputPath, isFanout);
  }
  if (node.type === "review") {
    refreshFindingsRawReviews(runDir, node);
  }
  if (isFanout && requiresFanoutSynthesis(node.type)) {
    synthesizeFanoutStage(runDir, status, node.id, agents, options, cwd);
  }
  if (node.type === "decide") {
    updateReleaseVerdict(runDir, node.id, readOptional(canonicalStageOutputPath(runDir, status, node.id)));
  }
  completeStage(runDir, node.id, agents.join(","));
}

function startStage(runDir: string, stage: string, agents: string[]): void {
  const status = loadStatus(runDir);
  const now = touchStatus(status);
  const timing = {
    ...status.stage_timing[stage],
    started_at: now,
    attempt_count: status.stage_timing[stage].attempt_count + 1,
  };
  delete timing.completed_at;
  delete timing.failed_at;
  delete timing.duration_ms;
  delete timing.exit_code;
  status.stage_timing = {
    ...status.stage_timing,
    [stage]: timing,
  };
  status.status = `${stage}_running`;
  setStageState(status, stage, "running");
  saveStatus(runDir, status);
  appendStageEvent(runDir, "stage.started", status, stage, { agents });
}

function completeStage(runDir: string, stage: string, agent: string): void {
  const status = loadStatus(runDir);
  const now = touchStatus(status);
  const existingTiming = status.stage_timing[stage];
  const startedAt = existingTiming.started_at ?? now;
  const timing = {
    ...existingTiming,
    started_at: startedAt,
    completed_at: now,
    duration_ms: durationMs(startedAt, now),
    attempt_count: existingTiming.started_at
      ? existingTiming.attempt_count
      : existingTiming.attempt_count + 1,
  };
  delete timing.failed_at;
  delete timing.exit_code;
  status.stage_timing = {
    ...status.stage_timing,
    [stage]: timing,
  };
  if (!status.completed_stages.includes(stage)) {
    status.completed_stages = [...status.completed_stages, stage];
  }
  status.status = `${stage}_completed`;
  delete status.failed_stage;
  setStageState(status, stage, "completed");
  saveStatus(runDir, status);
  appendStageEvent(runDir, "stage.completed", status, stage, { agent });
}

function failStage(runDir: string, stage: string, agent: string, exitCode?: number): void {
  const status = loadStatus(runDir);
  const now = touchStatus(status);
  const existingTiming = status.stage_timing[stage];
  const startedAt = existingTiming.started_at ?? now;
  const timing = {
    ...existingTiming,
    started_at: startedAt,
    failed_at: now,
    duration_ms: durationMs(startedAt, now),
    exit_code: exitCode ?? null,
    attempt_count: existingTiming.started_at
      ? existingTiming.attempt_count
      : existingTiming.attempt_count + 1,
  };
  delete timing.completed_at;
  status.stage_timing = {
    ...status.stage_timing,
    [stage]: timing,
  };
  status.status = `${stage}_failed`;
  status.failed_stage = stage;
  setStageState(status, stage, "failed");
  saveStatus(runDir, status);
  appendStageEvent(runDir, "stage.failed", status, stage, {
    agent,
    exit_code: exitCode ?? null,
  });
}

function invokeAgentForStage(
  runDir: string,
  stage: string,
  agent: string,
  input: Parameters<typeof runAgentCallWithTiming>[0],
): number {
  startAgentTiming(runDir, stage, agent);
  let result: ReturnType<typeof runAgentCallWithTiming>;
  try {
    result = runAgentCallWithTiming(input);
  } catch (error) {
    failAgentTiming(runDir, stage, agent, undefined, agentCallTimingFromError(error));
    throw error;
  }
  const exitCode = result.exitCode;
  if (exitCode === 0) {
    completeAgentTiming(runDir, stage, agent, result.timing);
  } else {
    failAgentTiming(runDir, stage, agent, exitCode, result.timing);
  }
  return exitCode;
}

async function invokeAgentForStageAsync(
  runDir: string,
  stage: string,
  agent: string,
  input: Parameters<typeof runAgentCallAsync>[0],
): Promise<AgentCallResult> {
  startAgentTiming(runDir, stage, agent);
  let result: Awaited<ReturnType<typeof runAgentCallAsync>>;
  try {
    result = await runAgentCallAsync(input);
  } catch (error) {
    failAgentTiming(runDir, stage, agent, undefined, agentCallTimingFromError(error));
    throw error;
  }
  const exitCode = result.exitCode;
  if (exitCode === 0) {
    completeAgentTiming(runDir, stage, agent, result.timing);
  } else {
    failAgentTiming(runDir, stage, agent, exitCode, result.timing);
  }
  return result;
}

async function dispatchFanoutAgents(
  runDir: string,
  status: PacketStatus,
  stage: string,
  agents: string[],
  options: DispatchOptions,
  cwd: string,
): Promise<FanoutAgentResult[]> {
  const adapterTimeoutSecs = adapterTimeoutSecsForDispatch(status, options.timeoutSecs);
  const pending: Array<{
    agent: string;
    promptPath: string;
    outputPath: string;
  }> = [];
  const results: FanoutAgentResult[] = [];

  for (const agent of agents) {
    const outputPath = stageFanoutOutputPath(runDir, status, stage, agent);
    if (hasCompletedFanoutOutput(runDir, status, stage, agent, outputPath)) {
      appendEvent(runDir, "stage.agent_reused", {
        stage,
        node_id: stage,
        stage_type: stageNodeForId(status, stage).type,
        agent,
        path: path.relative(runDir, outputPath).split(path.sep).join("/"),
        exit_code: 0,
        timed_out: false,
        duration_ms: 0,
      });
      results.push({
        agent,
        outputPath,
        reused: true,
        exitCode: 0,
        timedOut: false,
        timing: { total_ms: 0 },
      });
      continue;
    }
    const promptPath = writePrompt(runDir, stage, cwd, agent);
    protectCompletedArtifact(status, stage, outputPath);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    pending.push({ agent, promptPath, outputPath });
  }

  const settled = await mapWithConcurrency(
    pending,
    fanoutConcurrencyLimit(status) ?? pending.length,
    async ({ agent, promptPath, outputPath }): Promise<FanoutAgentResult> => {
      const node = stageNodeForId(status, stage);
      const relativeOutputPath = path.relative(runDir, outputPath).split(path.sep).join("/");
      appendEvent(runDir, "stage.agent_started", {
        stage: node.id,
        node_id: node.id,
        stage_type: node.type,
        agent,
        path: relativeOutputPath,
        exit_code: null,
        timed_out: false,
        duration_ms: null,
      });
      const attemptResult = await invokeStageAgentWithFallback(runDir, status, stage, agent, {
        configPath: options.configPath,
        cwd,
        outputPath,
        primaryPromptPath: promptPath,
        requestedTimeoutSecs: adapterTimeoutSecs,
      });
      appendEvent(
        runDir,
        attemptResult.success ? "stage.agent_completed" : "stage.agent_failed",
        {
          stage: node.id,
          node_id: node.id,
          stage_type: node.type,
          agent,
          ...(attemptResult.actualAgent === agent ? {} : { actual_agent: attemptResult.actualAgent }),
          path: relativeOutputPath,
          exit_code: attemptResult.exitCode ?? null,
          timed_out: attemptResult.timedOut ?? false,
          duration_ms: attemptResult.timing?.total_ms ?? null,
        },
      );
      return {
        agent,
        outputPath,
        reused: false,
        exitCode: attemptResult.exitCode,
        error: attemptResult.success ? undefined : attemptResult.error,
        timing: attemptResult.timing,
        stdout: attemptResult.stdout,
        stderr: attemptResult.stderr,
        timedOut: attemptResult.timedOut ?? false,
      };
    },
  );

  const settledByAgent = new Map(settled.map((result) => [result.agent, result]));
  return agents.map((agent) =>
    results.find((result) => result.agent === agent) ?? settledByAgent.get(agent) ??
      {
        agent,
        outputPath: stageFanoutOutputPath(runDir, status, stage, agent),
        reused: false,
        error: new Error(`stage '${stage}' did not produce a result for agent '${agent}'`),
      },
  );
}

function startAgentTiming(runDir: string, stage: string, agent: string): void {
  const status = loadStatus(runDir);
  const now = touchStatus(status);
  const stageAgentsTiming = status.agent_timing[stage] ?? {};
  const previous = stageAgentsTiming[agent] ?? { attempt_count: 0 };
  const timing = {
    ...previous,
    started_at: now,
    attempt_count: previous.attempt_count + 1,
  };
  delete timing.completed_at;
  delete timing.failed_at;
  delete timing.duration_ms;
  delete timing.exit_code;
  status.agent_timing = {
    ...status.agent_timing,
    [stage]: {
      ...stageAgentsTiming,
      [agent]: timing,
    },
  };
  saveStatus(runDir, status);
}

function completeAgentTiming(
  runDir: string,
  stage: string,
  agent: string,
  runtimeTiming?: Partial<AgentCallRuntimeTiming>,
): void {
  const status = loadStatus(runDir);
  const now = touchStatus(status);
  const stageAgentsTiming = status.agent_timing[stage] ?? {};
  const existingTiming = stageAgentsTiming[agent] ?? { attempt_count: 0 };
  const startedAt = existingTiming.started_at ?? now;
  const timing = {
    ...existingTiming,
    ...runtimeTiming,
    started_at: startedAt,
    completed_at: now,
    duration_ms: durationMs(startedAt, now),
  };
  delete timing.failed_at;
  delete timing.exit_code;
  status.agent_timing = {
    ...status.agent_timing,
    [stage]: {
      ...stageAgentsTiming,
      [agent]: timing,
    },
  };
  saveStatus(runDir, status);
}

function failAgentTiming(
  runDir: string,
  stage: string,
  agent: string,
  exitCode?: number,
  runtimeTiming?: Partial<AgentCallRuntimeTiming>,
): void {
  const status = loadStatus(runDir);
  const now = touchStatus(status);
  const stageAgentsTiming = status.agent_timing[stage] ?? {};
  const existingTiming = stageAgentsTiming[agent] ?? { attempt_count: 0 };
  const startedAt = existingTiming.started_at ?? now;
  const timing = {
    ...existingTiming,
    ...runtimeTiming,
    started_at: startedAt,
    failed_at: now,
    duration_ms: durationMs(startedAt, now),
    exit_code: exitCode ?? null,
  };
  delete timing.completed_at;
  status.agent_timing = {
    ...status.agent_timing,
    [stage]: {
      ...stageAgentsTiming,
      [agent]: timing,
    },
  };
  saveStatus(runDir, status);
}

function touchStatus(status: PacketStatus): string {
  const now = new Date().toISOString();
  status.updated_at = now;
  return now;
}

function durationMs(startedAt: string, completedAt: string): number {
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) {
    return 0;
  }
  return Math.max(0, completed - started);
}

function recordStageOutput(
  runDir: string,
  status: PacketStatus,
  stage: string,
  agent: string,
  outputPath: string,
  isFanout: boolean,
): void {
  const node = stageNodeForId(status, stage);
  if (node.type === "review") {
    recordRawReviewOutputArtifact(runDir, agent, outputPath, node);
    return;
  }
  if (isFanout) {
    const artifact = fanoutOutputArtifactName(node.id, agent);
    recordArtifact(runDir, artifact, outputPath, "stage-output", node.id, agent);
    appendEvent(runDir, "artifact.written", {
      artifact,
      path: path.relative(runDir, outputPath).split(path.sep).join("/"),
      stage: node.id,
      node_id: node.id,
      stage_type: node.type,
      agent,
    });
    return;
  }
  recordArtifact(runDir, stageArtifactName(status, stage), outputPath, "markdown", node.id, agent);
  appendEvent(runDir, "artifact.written", {
    artifact: stageArtifactName(status, stage),
    path: path.relative(runDir, outputPath).split(path.sep).join("/"),
    stage: node.id,
    node_id: node.id,
    stage_type: node.type,
    agent,
  });
}

async function invokeStageAgentWithFallback(
  runDir: string,
  status: PacketStatus,
  stage: string,
  primaryAgent: string,
  options: {
    configPath?: string;
    cwd: string;
    outputPath: string;
    primaryPromptPath: string;
    requestedTimeoutSecs?: number;
  },
): Promise<StageAgentAttemptResult> {
  const primaryInvocation = primaryInvocationForAgent(status, stage, primaryAgent);
  const primaryResult = await invokeStageAgentAttempt(runDir, status, stage, {
    configPath: options.configPath,
    cwd: options.cwd,
    agent: primaryAgent,
    primaryAgent,
    requestedAgent: primaryAgent,
    laneId: primaryInvocation?.lane_id ?? `${stage}:${primaryAgent}`,
    outputPath: options.outputPath,
    promptPath: options.primaryPromptPath,
    timeoutSecs: options.requestedTimeoutSecs ?? primaryInvocation?.timeout_seconds ?? undefined,
  });
  if (primaryResult.success) {
    return primaryResult;
  }

  const policy = status.stage_failure_policies[stage];
  if (policy?.mode === "terminal") {
    return primaryResult;
  }
  const fallback = status.stage_fallbacks[stage];
  const maxAttempts = Math.max(1, fallback?.max_attempts_per_agent ?? 1);
  let lastResult = primaryResult;
  for (const candidate of fallback?.agents ?? []) {
    for (let index = 0; index < maxAttempts; index += 1) {
      const promptPath = writePrompt(runDir, stage, options.cwd, candidate.agent);
      const fallbackResult = await invokeStageAgentAttempt(runDir, status, stage, {
        configPath: options.configPath,
        cwd: options.cwd,
        agent: candidate.agent,
        primaryAgent,
        requestedAgent: candidate.agent,
        fallbackFrom: primaryAgent,
        laneId: `${stage}:${candidate.agent}`,
        outputPath: options.outputPath,
        promptPath,
        timeoutSecs: options.requestedTimeoutSecs ?? candidate.timeout_seconds,
      });
      lastResult = fallbackResult;
      if (fallbackResult.success) {
        return fallbackResult;
      }
    }
  }
  return lastResult;
}

async function invokeStageAgentAttempt(
  runDir: string,
  status: PacketStatus,
  stage: string,
  options: {
    configPath?: string;
    cwd: string;
    agent: string;
    primaryAgent: string;
    requestedAgent: string;
    fallbackFrom?: string;
    laneId: string;
    outputPath: string;
    promptPath: string;
    timeoutSecs?: number | null;
  },
): Promise<StageAgentAttemptResult> {
  const startedAt = new Date().toISOString();
  const laneAttempt = nextLaneAttempt(runDir, stage, options.laneId);
  try {
    const invocation = stageNodeForId(status, stage).type === "review"
      ? await invokeReviewAgentWithSession(runDir, status, stage, { ...options, attempt: laneAttempt })
      : await invokeAgentForStageAsync(runDir, stage, options.agent, {
      configPath: options.configPath,
      cwd: options.cwd,
      agentName: options.agent,
      promptFile: options.promptPath,
      outputFile: options.outputPath,
      timeoutSecs: options.timeoutSecs ?? undefined,
      });
    if (stageNodeForId(status, stage).type !== "review") {
      writeAgentLogs(runDir, stage, options.agent, invocation);
    }
    const statusValue = invocation.exitCode === 0 ? "completed" : invocation.timedOut ? "timed_out" : "failed";
    recordStageAttempt(runDir, stage, {
      laneId: options.laneId,
      primaryAgent: options.primaryAgent,
      requestedAgent: options.requestedAgent,
      actualAgent: options.agent,
      fallbackFrom: options.fallbackFrom,
      timeoutSeconds: options.timeoutSecs ?? null,
      status: statusValue,
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: invocation.exitCode,
      errorKind: invocation.exitCode === 0 ? undefined : invocation.timedOut ? "timeout" : "exit_code",
      error: invocation.exitCode === 0 ? undefined : `exit code ${invocation.exitCode}`,
      session: "session" in invocation
        ? invocation.session as ReturnType<typeof reviewerSessionAttemptFields>
        : undefined,
    });
    return {
      primaryAgent: options.primaryAgent,
      actualAgent: options.agent,
      exitCode: invocation.exitCode,
      timing: invocation.timing,
      stdout: invocation.stdout,
      stderr: invocation.stderr,
      timedOut: invocation.timedOut ?? false,
      success: invocation.exitCode === 0,
    };
  } catch (error) {
    const output = agentCallOutputFromError(error);
    const timing = agentCallTimingFromError(error);
    writeAgentLogs(runDir, stage, options.agent, output);
    const timedOut = output?.timedOut ?? isTimeoutError(error);
    recordStageAttempt(runDir, stage, {
      laneId: options.laneId,
      primaryAgent: options.primaryAgent,
      requestedAgent: options.requestedAgent,
      actualAgent: options.agent,
      fallbackFrom: options.fallbackFrom,
      timeoutSeconds: options.timeoutSecs ?? null,
      status: timedOut ? "timed_out" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      errorKind: timedOut ? "timeout" : "exception",
      error: errorMessage(error),
    });
    return {
      primaryAgent: options.primaryAgent,
      actualAgent: options.agent,
      error,
      timing,
      stdout: output?.stdout,
      stderr: output?.stderr,
      timedOut,
      success: false,
    };
  }
}

async function invokeReviewAgentWithSession(
  runDir: string,
  status: PacketStatus,
  stage: string,
  options: {
    configPath?: string;
    cwd: string;
    agent: string;
    laneId: string;
    outputPath: string;
    promptPath: string;
    timeoutSecs?: number | null;
    attempt: number;
  },
): Promise<AgentCallResult & { session: ReturnType<typeof reviewerSessionAttemptFields> }> {
  const agent = resolveAgent(loadAgents(options.configPath, options.cwd), options.agent);
  const adapter = lookupRuntimeAdapter(agent.adapter);
  const scope = safeFrozenScope(status);
  const sessionStartedAt = Date.now();
  const sessionBudgetMs = options.timeoutSecs === undefined || options.timeoutSecs === null
    ? undefined
    : Math.max(0, options.timeoutSecs * 1_000);
  const invokeFresh = async (context?: { timeoutSecs?: number; idempotencyKey?: string }) => {
    const result = await invokeAgentForStageAsync(runDir, stage, options.agent, {
      configPath: options.configPath,
      cwd: options.cwd,
      agentName: options.agent,
      promptFile: options.promptPath,
      outputFile: options.outputPath,
      timeoutSecs: context?.timeoutSecs ?? options.timeoutSecs ?? undefined,
      ...(context?.idempotencyKey ? { idempotencyKey: context.idempotencyKey } : {}),
    });
    return { exitCode: result.exitCode, outputText: result.stdout ?? "", call: result };
  };
  let lastCall: AgentCallResult | undefined;
  let usedStructuredSessionInvocation = false;
  const result = await invokeReviewerWithSession(runDir, {
    effectiveMode: status.resolved_reviewer_session_policy?.effective_mode ?? "independent",
    attemptIdentity: { runId: status.run_id, laneId: options.laneId, attempt: options.attempt },
    invokeFresh: async (context) => {
      const fresh = await invokeFresh(context);
      lastCall = fresh.call;
      return fresh;
    },
    invokeStructured: async (session, context) => {
      usedStructuredSessionInvocation = true;
      const call = await invokeAgentForStageAsync(runDir, stage, options.agent, {
        configPath: options.configPath,
        cwd: options.cwd,
        agentName: options.agent,
        promptFile: options.promptPath,
        timeoutSecs: context?.timeoutSecs ?? options.timeoutSecs ?? undefined,
        session,
      });
      lastCall = call;
      const structured = call.structuredSessionResult;
      return {
        exitCode: call.exitCode === 0 && !structured?.failure ? 0 : call.exitCode || 1,
        result: structured ?? { outputText: "", failure: {
          classification: "invalid_output" as const,
          message: "provider did not return a structured session result",
          retryable: false,
        } },
      };
    },
    sessionDependencies: {
      resolveScope: () => scope,
      supportsStructuredSessions: () => (
        adapter.capabilities.supports_resume === true
        && adapter.capabilities.supports_structured_session_id === true
        && scope !== undefined
      ),
      registryKey: (resolvedScope) => reviewerSessionKey(agent, resolvedScope),
      withLease: async (key, action) => {
        let unavailable = false;
        const lease = await withReviewerSessionLease(key, action, {
          onUnavailable: () => { unavailable = true; },
        });
        return lease.acquired || !unavailable
          ? lease
          : { acquired: false as const, reason: "unavailable" as const };
      },
      read: (key) => {
        const read = readReviewerSession(key);
        const entry = read.status === "available" || read.entry
          ? read.entry
          : undefined;
        if (read.status === "available" && entry) {
          return { kind: "entry" as const, entry: { providerSessionId: entry.provider_session_id, sessionRef: entry.session_ref, epoch: entry.epoch } };
        }
        if (
          entry
          && read.status === "unavailable"
          && (read.reason === "expired_idle" || read.reason === "expired_absolute" || read.reason === "resume_limit")
        ) {
          return {
            kind: "lifecycle" as const,
            entry: { providerSessionId: entry.provider_session_id, sessionRef: entry.session_ref, epoch: entry.epoch },
            reason: read.reason,
          };
        }
        return read.status === "unavailable" && read.reason === "missing"
          ? { kind: "missing" as const }
          : { kind: "unavailable" as const };
      },
      writeFresh: (key, providerSessionId) => {
        const write = upsertReviewerSession({
          key,
          sessionRef: reviewerSessionRef(key),
          providerSessionId,
          invocationFingerprint: reviewerSessionInvocationFingerprint(reviewerSessionInvocation(agent)),
          summary: scope ? { scopeRef: scope.conversationScopeRef, hostKind: scope.hostKind, reviewerId: agent.id, mode: "interactive_continuous" } : undefined,
        });
        return write.status === "written"
          ? { providerSessionId: write.entry.provider_session_id, sessionRef: write.entry.session_ref, epoch: write.entry.epoch }
          : undefined;
      },
      writeResume: (key, expectedEpoch, providerSessionId) => {
        const write = upsertReviewerSession({
          key,
          sessionRef: reviewerSessionRef(key),
          providerSessionId,
          expectedEpoch,
          successfulResume: true,
          invocationFingerprint: reviewerSessionInvocationFingerprint(reviewerSessionInvocation(agent)),
        });
        return write.status === "written"
          ? { providerSessionId: write.entry.provider_session_id, sessionRef: write.entry.session_ref, epoch: write.entry.epoch }
          : undefined;
      },
      close: (key, expectedEpoch) => closeReviewerSession(key, { expectedEpoch }).status === "closed",
      sleep: async (delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
      jitter: (baseMs) => Math.max(1, Math.round(baseMs * (0.8 + Math.random() * 0.4))),
      remainingBudgetMs: () => sessionBudgetMs === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(0, sessionBudgetMs - (Date.now() - sessionStartedAt)),
      normalizeInvocationException: (error) => {
        const output = agentCallOutputFromError(error);
        const timing = agentCallTimingFromError(error);
        return output?.timedOut
          ? { result: { outputText: "", failure: { classification: "timeout" as const, message: "provider session invocation timed out", retryable: false } }, timedOut: true, ...(timing ? { timing } : {}) }
          : { result: { outputText: "", failure: { classification: "configuration_error" as const, message: "provider session invocation failed", retryable: false } }, ...(timing ? { timing } : {}) };
      },
      onEvent: (event, payload) => appendEvent(runDir, event, payload),
    },
  });
  if (!usedStructuredSessionInvocation && lastCall) {
    writeAgentLogs(runDir, stage, options.agent, lastCall);
  }
  if (result.outputText) writeFileAtomic(options.outputPath, result.outputText);
  const call = lastCall;
  return {
    exitCode: result.exitCode,
    timing: result.timing
      ? {
          config_load_ms: result.timing.config_load_ms ?? 0,
          adapter_spawn_ms: result.timing.adapter_spawn_ms ?? 0,
          agent_total_ms: result.timing.agent_total_ms ?? 0,
          total_ms: result.timing.total_ms ?? 0,
          ...(result.timing.first_output_ms === undefined ? {} : { first_output_ms: result.timing.first_output_ms }),
        }
      : call?.timing ?? { config_load_ms: 0, adapter_spawn_ms: 0, agent_total_ms: 0, total_ms: 0 },
    ...(result.timedOut === undefined
      ? call?.timedOut === undefined ? {} : { timedOut: call.timedOut }
      : { timedOut: result.timedOut }),
    session: reviewerSessionAttemptFields(result.session),
  };
}

function safeFrozenScope(status: PacketStatus): ResolvedReviewerSessionScope | undefined {
  const scope = status.resolved_host_scope;
  if (!scope?.conversation_scope_ref || scope.scope_source === "missing") return undefined;
  return {
    hostKind: scope.host_kind,
    conversationScopeRef: scope.conversation_scope_ref,
    workspaceId: scope.workspace_id,
    worktreeId: scope.worktree_id,
    scopeSource: scope.scope_source,
  };
}

function reviewerSessionInvocation(agent: ReturnType<typeof resolveAgent>) {
  return {
    command: agent.command,
    args: agent.args,
    capabilities: agent.capabilities,
    permissionMode: "workspace-aware",
    contextMode: "workspace-aware",
    reviewerPersonaVersion: "v1",
    promptSchemaVersion: "v1",
    adapterPluginVersion: "v1",
    providerCliVersion: "unknown",
    environmentVariableNames: agent.env.map((entry) => entry.split("=", 1)[0] ?? ""),
  };
}

function reviewerSessionKey(agent: ReturnType<typeof resolveAgent>, scope: ResolvedReviewerSessionScope): string {
  return sessionRegistryKey({
    conversationScopeRef: scope.conversationScopeRef,
    workspaceId: scope.workspaceId,
    worktreeId: scope.worktreeId,
    agentId: agent.id,
    adapterId: agent.adapter,
    model: agent.model ?? "current",
    reasoningEffort: agent.reasoning_effort ?? "none",
    invocation: reviewerSessionInvocation(agent),
  });
}

function reviewerSessionAttemptFields(session: Awaited<ReturnType<typeof invokeReviewerWithSession>>["session"]) {
  return {
    sessionMode: session.mode,
    ...(session.sessionRef ? { sessionRef: session.sessionRef } : {}),
    ...(session.conversationScopeRef ? { conversationScopeRef: session.conversationScopeRef } : {}),
    ...(session.scopeSource ? { scopeSource: session.scopeSource } : {}),
    hermetic: session.hermetic,
    ...(session.nonHermeticReason ? { nonHermeticReason: session.nonHermeticReason } : {}),
    registryWrite: session.registryWrite,
  };
}

function recordStageAttempt(
  runDir: string,
  stage: string,
  input: {
    laneId: string;
    primaryAgent: string;
    requestedAgent: string;
    actualAgent: string;
    fallbackFrom?: string;
    timeoutSeconds: number | null;
    status: "completed" | "failed" | "timed_out";
    startedAt: string;
    completedAt: string;
    exitCode?: number;
    errorKind?: string;
    error?: string;
    session?: ReturnType<typeof reviewerSessionAttemptFields>;
  },
): void {
  const status = loadStatus(runDir);
  const attempts = status.stage_attempts[stage] ?? [];
  const laneAttempt = attempts.filter((attempt) => attempt.lane_id === input.laneId).length + 1;
  const agentAttempt = attempts.filter((attempt) => attempt.actual_agent === input.actualAgent).length + 1;
  status.stage_attempts = {
    ...status.stage_attempts,
    [stage]: [
      ...attempts,
      {
        lane_id: input.laneId,
        primary_agent: input.primaryAgent,
        requested_agent: input.requestedAgent,
        actual_agent: input.actualAgent,
        ...(input.fallbackFrom ? { fallback_from: input.fallbackFrom } : {}),
        lane_attempt: laneAttempt,
        attempt: agentAttempt,
        timeout_seconds: input.timeoutSeconds,
        status: input.status,
        started_at: input.startedAt,
        completed_at: input.completedAt,
        ...(input.exitCode === undefined ? {} : { exit_code: input.exitCode }),
        ...(input.errorKind ? { error_kind: input.errorKind } : {}),
        ...(input.error ? { error: input.error } : {}),
        ...(input.session ? {
          session_mode: input.session.sessionMode,
          ...(input.session.sessionRef ? { session_ref: input.session.sessionRef } : {}),
          ...(input.session.conversationScopeRef ? { conversation_scope_ref: input.session.conversationScopeRef } : {}),
          ...(input.session.scopeSource ? { scope_source: input.session.scopeSource } : {}),
          hermetic: input.session.hermetic,
          ...(input.session.nonHermeticReason ? { non_hermetic_reason: input.session.nonHermeticReason } : {}),
          registry_write: input.session.registryWrite,
        } : {}),
      },
    ],
  };
  saveStatus(runDir, status);
}

/** Caller holds the run mutation lock; reload keeps configured retries in one lane unique. */
function nextLaneAttempt(runDir: string, stage: string, laneId: string): number {
  const current = loadStatus(runDir);
  return (current.stage_attempts[stage] ?? []).filter((attempt) => attempt.lane_id === laneId).length + 1;
}

function primaryInvocationForAgent(status: PacketStatus, stage: string, agent: string) {
  return status.stage_invocations[stage]?.find((invocation) =>
    invocation.kind === "primary" && invocation.agent === agent
  );
}

function stageAttemptFailureError(stage: string, result: StageAgentAttemptResult): Error {
  if (result.timedOut) {
    return new Error(`stage '${stage}' timed out for agent '${result.actualAgent}'`);
  }
  if (result.exitCode !== undefined && result.exitCode !== 0) {
    return new Error(
      `stage '${stage}' failed for agent '${result.actualAgent}' with exit code ${result.exitCode}`,
    );
  }
  return result.error instanceof Error
    ? result.error
    : new Error(`stage '${stage}' failed for agent '${result.actualAgent}'`);
}

function fanoutSuccesses(results: FanoutAgentResult[]): FanoutAgentResult[] {
  return results.filter((result) => !fanoutResultFailed(result));
}

function fanoutFailures(results: FanoutAgentResult[]): FanoutAgentResult[] {
  return results.filter(fanoutResultFailed);
}

function fanoutResultFailed(result: FanoutAgentResult): boolean {
  return result.error !== undefined || result.exitCode !== 0;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : items.length;
  const effectiveLimit = Math.max(1, Math.min(normalizedLimit || items.length, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => runNext()));
  return results;
}

function writeAgentLogs(
  runDir: string,
  stage: string,
  agent: string,
  output?: { stdout?: string; stderr?: string },
): void {
  const logDir = path.join(runDir, "logs", stage);
  const filePrefix = path.join(logDir, safeAgentId(agent));
  if (output?.stdout) {
    writeFileAtomic(`${filePrefix}.stdout.log`, output.stdout);
  }
  if (output?.stderr) {
    writeFileAtomic(`${filePrefix}.stderr.log`, output.stderr);
  }
}

function fanoutFailureError(stage: string, failure: FanoutAgentResult): Error {
  if (failure.exitCode !== undefined && failure.exitCode !== 0) {
    return new Error(
      `stage '${stage}' failed for agent '${failure.agent}' with exit code ${failure.exitCode}`,
    );
  }
  return failure.error instanceof Error
    ? failure.error
    : new Error(`stage '${stage}' failed for agent '${failure.agent}'`);
}

function writeVerificationAggregate(
  runDir: string,
  status: PacketStatus,
  stage: string,
  results: FanoutAgentResult[],
): void {
  const node = stageNodeForId(status, stage);
  const outputPath = canonicalStageOutputPath(runDir, status, stage);
  protectCompletedArtifact(status, stage, outputPath);
  const artifact = stageArtifactName(status, stage);
  const sections = [
    "# Verification",
    "",
    "## Fanout Summary",
    "",
    ...results.map((result) => `- ${result.agent}: ${verificationResultStatus(result)}`),
    "",
    "## Per-Agent Evidence",
    "",
    ...results.flatMap((result) => verificationEvidenceSection(result)),
  ];
  writeFileAtomic(outputPath, sections.join("\n").trimEnd() + "\n");
  recordArtifact(runDir, artifact, outputPath, "markdown", node.id, "agentmesh");
  appendEvent(runDir, "artifact.written", {
    artifact,
    path: path.relative(runDir, outputPath).split(path.sep).join("/"),
    stage: node.id,
    node_id: node.id,
    stage_type: node.type,
    agent: "agentmesh",
  });
}

function verificationResultStatus(result: FanoutAgentResult): string {
  if (!fanoutResultFailed(result)) {
    return result.reused ? "completed (reused)" : "completed";
  }
  if (result.exitCode !== undefined) {
    return `failed (exit ${result.exitCode})`;
  }
  return `failed (${errorMessage(result.error)})`;
}

function verificationEvidenceSection(result: FanoutAgentResult): string[] {
  const content = readOptional(result.outputPath).trimEnd();
  const body = content || `No successful evidence artifact was produced for ${result.agent}.`;
  return [`### ${result.agent}`, "", body, ""];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTimeoutError(error: unknown): boolean {
  const payload = error as { code?: unknown; cause?: { code?: unknown }; message?: unknown };
  return (
    payload.code === "ETIMEDOUT" ||
    payload.cause?.code === "ETIMEDOUT" ||
    /timed out|ETIMEDOUT/i.test(String(payload.message ?? error))
  );
}

function synthesizeFanoutStage(
  runDir: string,
  status: PacketStatus,
  stage: string,
  agents: string[],
  options: DispatchOptions,
  cwd: string,
): void {
  const node = stageNodeForId(status, stage);
  const controllerAgent = agents[0];
  const promptPath = writeSynthesisPrompt(runDir, status, node.id, controllerAgent, agents, cwd);
  const outputPath = canonicalStageOutputPath(runDir, status, node.id);
  protectCompletedArtifact(status, stage, outputPath);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  let exitCode: number;
  try {
    exitCode = invokeAgentForStage(runDir, stage, controllerAgent, {
      configPath: options.configPath,
      cwd,
      agentName: controllerAgent,
      promptFile: promptPath,
      outputFile: outputPath,
      timeoutSecs: options.timeoutSecs,
    });
  } catch (error) {
    failStage(runDir, stage, controllerAgent);
    throw error;
  }
  if (exitCode !== 0) {
    failStage(runDir, stage, controllerAgent, exitCode);
    throw new Error(
      `stage '${stage}' synthesis failed for agent '${controllerAgent}' with exit code ${exitCode}`,
    );
  }
  recordStageOutput(runDir, status, stage, controllerAgent, outputPath, false);
}

function writeSynthesisPrompt(
  runDir: string,
  status: PacketStatus,
  stage: string,
  controllerAgent: string,
  agents: string[],
  cwd: string,
): string {
  const node = stageNodeForId(status, stage);
  const sections = [
    ...synthesisBaseSections(runDir, status, node.id, controllerAgent, cwd),
    "## Fanout Outputs",
    "",
    ...agents.flatMap((agent) => synthesisFanoutOutputSection(runDir, status, node.id, agent)),
    "## Synthesis Instructions",
    "",
    synthesisInstructions(status, node.id),
    "",
  ];
  const promptPath = path.join(runDir, "prompts", node.id, "synthesis.md");
  const prompt = sections.join("\n").trimEnd() + "\n";
  const artifactName = `prompt_${node.id}_synthesis`;
  writeFileAtomic(promptPath, prompt);
  recordArtifact(
    runDir,
    artifactName,
    promptPath,
    "prompt",
    node.id,
    controllerAgent,
  );
  recordPromptByteMetric(runDir, artifactName, promptPath, prompt, node.id, controllerAgent, "synthesis");
  return promptPath;
}

function synthesisFanoutOutputSection(
  runDir: string,
  status: PacketStatus,
  stage: string,
  agent: string,
): string[] {
  const outputPath = stageFanoutOutputPath(runDir, status, stage, agent);
  const sourcePath = path.relative(runDir, outputPath).split(path.sep).join("/");
  return [
    `### ${agent}`,
    "",
    boundedSynthesisFanoutOutput(
      readOptional(outputPath),
      sourcePath,
      FANOUT_OUTPUT_PROMPT_CONTENT_MAX_BYTES,
    ),
    "",
  ];
}

function boundedSynthesisFanoutOutput(
  content: string,
  source: string,
  maxBytes: number,
): string {
  const trimmed = content.trimEnd();
  const originalBytes = Buffer.byteLength(trimmed, "utf-8");
  if (originalBytes <= maxBytes) {
    return trimmed;
  }
  const excerpt = utf8HeadTail(trimmed, maxBytes).trimEnd();
  const excerptBytes = Buffer.byteLength(excerpt, "utf-8");
  return [
    excerpt,
    "",
    `> AgentMesh synthesis prompt truncated fanout output ${source}: showing ${excerptBytes}/${originalBytes} bytes. Full candidate output remains in ${source}.`,
  ].join("\n");
}

function utf8Prefix(content: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of content) {
    const characterBytes = Buffer.byteLength(character, "utf-8");
    if (bytes + characterBytes > maxBytes) {
      break;
    }
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function utf8HeadTail(content: string, maxBytes: number): string {
  const omission = "\n\n> AgentMesh omitted middle candidate content; the full output remains in its packet source.\n\n";
  const omissionBytes = Buffer.byteLength(omission, "utf-8");
  if (omissionBytes >= maxBytes) {
    return utf8Prefix(content, maxBytes);
  }
  const excerptBytes = maxBytes - omissionBytes;
  const headBytes = Math.floor(excerptBytes * 0.6);
  const tailBytes = excerptBytes - headBytes;
  return `${utf8Prefix(content, headBytes).trimEnd()}${omission}${utf8Suffix(content, tailBytes).trimStart()}`;
}

function utf8Suffix(content: string, maxBytes: number): string {
  const encoded = Buffer.from(content, "utf-8");
  if (encoded.byteLength <= maxBytes) {
    return content;
  }
  let start = encoded.byteLength - maxBytes;
  while (start < encoded.byteLength && (encoded[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return encoded.toString("utf-8", start);
}

function synthesisBaseSections(
  runDir: string,
  status: PacketStatus,
  stage: string,
  controllerAgent: string,
  cwd: string,
): string[] {
  const node = stageNodeForId(status, stage);
  if (status.workflow === BUILTIN_WORKFLOW_IDS.RELEASE_CHECK && (node.type === "review" || node.type === "decide")) {
    refreshReleaseEvidenceSummary(runDir, status);
  }
  const request = readOptional(path.join(runDir, "request.md"));
  const assignment = readOptional(path.join(runDir, "assignment.toml"));
  const context = readOptional(path.join(runDir, "context.md"));
  const releaseSummary = readOptional(path.join(runDir, "release-summary.md"));
  const sections = [
    "# AgentMesh Synthesis",
    "",
    `Stage: ${node.id}`,
    `Stage Type: ${node.type}`,
    `Packet Directory: ${packetDisplayPath(runDir, cwd)}`,
    `Agent: ${controllerAgent}`,
    "",
    "## Request",
    "",
    request.trimEnd(),
    "",
    "## Assignment",
    "",
    assignment.trimEnd(),
    "",
  ];
  if (context.trim()) {
    sections.push(
      "## Context Reference",
      "",
      contextReferencePromptContent(context, `${packetDisplayPath(runDir, cwd)}/context.md`),
      "",
    );
  }
  sections.push(...orderedPriorEvidenceSections(runDir, status, node.id));
  if (releaseSummary.trim()) {
    sections.push("## Release Summary", "", releaseSummaryPromptContent(releaseSummary), "");
  }
  if (status.workflow === BUILTIN_WORKFLOW_IDS.RELEASE_CHECK && (node.type === "review" || node.type === "decide")) {
    sections.push(
      "## Release Check Contract",
      "",
      "Reviewers must inspect the evidence summary, note missing or skipped checks, and identify residual risk with evidence. The decider must include exactly one non-fenced verdict line: `Verdict: ready`, `Verdict: not_ready`, or `Verdict: needs_decision`.",
      "",
    );
  }
  if (node.type === "decide" && status.user_gate) {
    sections.push(
      "## User Gate",
      "",
      "This run is user-gated. Summarize accepted findings, rejected findings, and items that need user decision. Recommend the next action, but do not claim final approval without the user's explicit decision.",
      "",
    );
  }
  return sections.filter((section) => section.length > 0);
}

function synthesisInstructions(status: PacketStatus, stage: string): string {
  const node = stageNodeForId(status, stage);
  if (node.type === "plan") {
    return [
      "Synthesize one canonical `plan.md` from the candidate plans above.",
      "Prefer concrete, low-risk execution steps and preserve source attribution for important trade-offs.",
      "Do not copy the raw outputs wholesale unless the exact wording is needed as evidence.",
    ].join(" ");
  }
  if (node.type === "decide") {
    const instructions = [
      `Synthesize one canonical \`${stageArtifactFile(status, node.id)}\` from the candidate decisions above.`,
      "Record the final decision, accepted or rejected evidence, skipped verification, residual risk, and any required next action.",
    ];
    if (isReleaseVerdictNode(status, node.id)) {
      instructions.push(
        "Include exactly one non-fenced verdict line: `Verdict: ready`, `Verdict: not_ready`, or `Verdict: needs_decision`.",
      );
    }
    return instructions.join(" ");
  }
  return "Synthesize one canonical stage artifact from the fanout outputs above.";
}

function supportsFanoutStage(stage: string): boolean {
  return stage === "plan" || stage === "review" || stage === "verify" || stage === "decide";
}

function requiresFanoutSynthesis(stage: string): boolean {
  return stage === "plan" || stage === "decide";
}

function fanoutOutputArtifactName(stage: string, agent: string): string {
  return `output_${stage}_${safeAgentId(agent)}`;
}

function fanoutCompletionArtifactName(stage: string, agent: string): string {
  if (stage === "review") {
    return reviewArtifactName(agent);
  }
  return fanoutOutputArtifactName(stage, agent);
}

function hasCompletedFanoutOutput(
  runDir: string,
  status: PacketStatus,
  stage: string,
  agent: string,
  outputPath: string,
): boolean {
  if (!existsSync(outputPath)) {
    return false;
  }
  const node = stageNodeForId(status, stage);
  const artifact = loadArtifacts(runDir)[
    node.type === "review"
      ? reviewArtifactName(agent, node)
      : fanoutCompletionArtifactName(node.id, agent)
  ];
  const relativeOutputPath = path.relative(runDir, outputPath).split(path.sep).join("/");
  return artifact?.stage === node.id && artifact.agent === agent && artifact.path === relativeOutputPath;
}

function assertPredecessorsCompleted(
  status: PacketStatus,
  stage: string,
  action = "dispatch",
): void {
  for (const node of stageNodes(status)) {
    if (node.id === stage) {
      return;
    }
    if (!status.completed_stages.includes(node.id)) {
      throw new Error(
        `cannot ${action} ${stage} before predecessor stage '${node.id}' is completed`,
      );
    }
  }
}

function appendStageEvent(
  runDir: string,
  event: string,
  status: PacketStatus,
  stage: string,
  fields: Record<string, unknown> = {},
): void {
  const node = stageNodeForId(status, stage);
  appendEvent(runDir, event, {
    stage: node.id,
    node_id: node.id,
    stage_type: node.type,
    ...fields,
  });
}

function assertAgentsSupportStage(
  agentNames: string[],
  stage: string,
  configPath?: string,
  cwd = process.cwd(),
): void {
  const configuredAgents = loadAgents(configPath, cwd);
  for (const agentName of agentNames) {
    const agent = resolveAgent(configuredAgents, agentName);
    if (agent.capabilities.length > 0 && !agent.capabilities.includes(stage)) {
      throw new Error(`agent ${agent.id} does not support ${stage}`);
    }
  }
}
