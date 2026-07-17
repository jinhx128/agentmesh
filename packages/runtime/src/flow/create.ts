import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  BUILTIN_WORKFLOW_IDS,
  CURRENT_PACKET_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_INVOCATION_TIMEOUT_SECONDS,
  MAX_FANOUT_AGENTS,
  MAX_INVOCATION_TIMEOUT_SECONDS,
  MIN_INVOCATION_TIMEOUT_SECONDS,
  type StageFailurePolicy,
  type StageFallback,
  type StageFallbackCandidate,
  type StageInvocation,
  type StageNode,
  type StageState,
  type StageType,
  WORKFLOW_RECIPE_SCHEMA_VERSION,
  deriveStageNodes,
} from "@agentmesh/core";
import {
  assertWorkspaceWritable,
  recordSuccessfulWorkspaceMutation,
} from "../packet/compatibility.js";
import {
  appendEvent,
  recordArtifact,
  saveStatus,
  writeArtifacts,
  writeFileAtomic,
  type PacketStatus,
} from "../packet/io.js";
import { buildContextPack } from "./context-pack.js";
import {
  hasContextPolicy,
  prepareContextPolicyInput,
} from "./context-policy.js";
import { DEFAULT_STAGES } from "./state.js";
import type {
  FailurePolicyConfig,
  FallbackRoutingConfig,
  FlowRunInput,
  HostScopeInput,
  WorkflowCompatibilityInput,
} from "./types.js";
import { resolveDisplayTitle } from "../display-title.js";
import { resolveHostScope } from "../reviewer-sessions/scope.js";

type TimeoutProvenance = "cli" | "preset_fallback" | "global_fallback" | "agent" | "system_default" | "current";
type FallbackProvenance = "preset_fallback" | "global_fallback" | "none";

interface TimeoutResolution {
  seconds: number | null;
  provenance: TimeoutProvenance;
}

interface FallbackCandidateWithProvenance extends StageFallbackCandidate {
  timeout_provenance: TimeoutProvenance;
}

interface RoutingResolution {
  invocations: Record<string, StageInvocation[]>;
  failurePolicies: Record<string, StageFailurePolicy>;
  fallbacks: Record<string, StageFallback>;
  fallbackProvenance: Record<string, FallbackProvenance>;
  timeoutProvenance: Record<string, Record<string, TimeoutProvenance>>;
}

export async function createFlowRun(input: FlowRunInput, cwd = process.cwd()): Promise<string> {
  const runStartedAt = Date.now();
  assertWorkspaceWritable(cwd);
  assertWorkflowCompatibility(input.workflowCompatibility);
  const runtimeTiming = { ...(input.runtimeTiming ?? {}) };
  const resolvedHostScope = input.hostScopeInput
    ? resolveHostScope(input.hostScopeInput, cwd, input.hostScopeOptions)
    : undefined;
  const preparedContext = input.contextPolicy
    ? prepareContextPolicyInput(input, input.contextPolicy, cwd)
    : undefined;
  const effectiveInput = preparedContext
    ? { ...input, contextFiles: preparedContext.contextFiles }
    : input;
  const stages = input.stages?.length ? input.stages : DEFAULT_STAGES;
  const stageNodes = deriveStageNodes(stages);
  const assignmentResolution = resolveStageAssignments(input, stageNodes);
  const stageAssignments = assignmentResolution.assignments;
  const routingResolution = resolveExecutionRouting(input, stageNodes, stageAssignments);
  const runDir = path.resolve(cwd, ".agentmesh", "runs", input.runId);
  const createdAt = new Date();
  const now = createdAt.toISOString();
  mkdirSync(runDir, { recursive: true });
  writeFileAtomic(path.join(runDir, "request.md"), `# Request\n\n${input.task.trim()}\n`);
  writeFileAtomic(
    path.join(runDir, "assignment.toml"),
    assignmentToml(input, stages, stageNodes, stageAssignments),
  );
  const status: PacketStatus = {
    schema_version: CURRENT_PACKET_SCHEMA_VERSION,
    run_id: input.runId,
    title: resolveDisplayTitle({
      title: input.title,
      workspace: cwd,
      summaries: [input.task],
      createdAt,
    }),
    created_at: now,
    updated_at: now,
    status: "created",
    stage_assignments: stageAssignments,
    stage_invocations: routingResolution.invocations,
    stage_failure_policies: routingResolution.failurePolicies,
    stage_fallbacks: routingResolution.fallbacks,
    stage_attempts: Object.fromEntries(stageNodes.map((node) => [node.id, []])),
    assignment_provenance: assignmentResolution.provenance,
    fallback_provenance: routingResolution.fallbackProvenance,
    timeout_provenance: routingResolution.timeoutProvenance,
    stages: [...stages],
    stage_nodes: stageNodes,
    completed_stages: [],
    user_gate: Boolean(input.userGate || input.executionPolicy?.require_user_gate),
    workflow: input.workflow ?? BUILTIN_WORKFLOW_IDS.GUIDED_DELIVERY,
    ...(input.workflowSource ? { workflow_source: input.workflowSource } : {}),
    ...(input.preset ? { preset: input.preset } : {}),
    ...(input.presetSource ? { preset_source: input.presetSource } : {}),
    ...(input.contextPolicy && hasContextPolicy(input.contextPolicy)
      ? { resolved_context_policy: input.contextPolicy }
      : {}),
    ...(input.reviewReleasePolicy
      ? { resolved_review_release_policy: input.reviewReleasePolicy }
      : {}),
    ...(input.reviewerSessionPolicy
      ? { resolved_reviewer_session_policy: input.reviewerSessionPolicy }
      : {}),
    ...(input.hostScopeInput
      ? { host_scope_input: safeHostScopeInput(input.hostScopeInput) }
      : {}),
    ...(resolvedHostScope
      ? { resolved_host_scope: resolvedHostScope }
      : {}),
    ...(input.executionPolicy
      ? { resolved_execution_policy: input.executionPolicy }
      : {}),
    ...(input.configProvenance ? { config_provenance: input.configProvenance } : {}),
    stage_state: Object.fromEntries(
      stageNodes.map((node) => [node.id, "planned" satisfies StageState]),
    ),
    stage_timing: Object.fromEntries(
      stageNodes.map((node) => [node.id, { attempt_count: 0 }]),
    ),
    agent_timing: {},
    context_bytes: 0,
    prompt_bytes: {},
  };
  saveStatus(runDir, status);
  writeFileAtomic(path.join(runDir, "events.jsonl"), "");
  writeArtifacts(runDir, {});
  recordArtifact(runDir, "request", path.join(runDir, "request.md"), "request", "run");
  recordArtifact(runDir, "assignment", path.join(runDir, "assignment.toml"), "assignment", "run");
  recordArtifact(runDir, "status", path.join(runDir, "status.json"), "status", "run");
  const context = await buildContextPack(effectiveInput, cwd, runtimeTiming);
  status.context_bytes = Buffer.byteLength(context, "utf-8");
  if (context.trim().length > 0) {
    writeFileAtomic(path.join(runDir, "context.md"), context);
    recordArtifact(runDir, "context", path.join(runDir, "context.md"), "context", "run");
  }
  status.runtime_timing = {
    ...runtimeTiming,
    total_ms: elapsedMs(runStartedAt),
  };
  status.updated_at = new Date().toISOString();
  saveStatus(runDir, status);
  appendEvent(runDir, "run.created", {
    run_id: input.runId,
    workflow: status.workflow,
    ...(input.workflowSource ? { workflow_source: input.workflowSource } : {}),
    stages,
    stage_nodes: stageNodes,
  });
  recordSuccessfulWorkspaceMutation(cwd);
  return runDir;
}

function safeHostScopeInput(input: HostScopeInput): {
  host_kind: string;
  scope_source: "native" | "propagated" | "missing";
  propagated_scope_token_present?: true;
} {
  if (input.nativeConversationId) {
    return {
      host_kind: input.hostKind ?? "unknown",
      scope_source: "native",
      ...(input.propagatedScopeToken ? { propagated_scope_token_present: true } : {}),
    };
  }
  if (input.propagatedScopeToken) {
    return {
      host_kind: input.hostKind ?? "unknown",
      scope_source: "propagated",
      propagated_scope_token_present: true,
    };
  }
  return {
    host_kind: input.hostKind ?? "unknown",
    scope_source: "missing",
  };
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function resolveExecutionRouting(
  input: FlowRunInput,
  stageNodes: StageNode[],
  stageAssignments: Record<string, string[]>,
): RoutingResolution {
  validateCliTimeoutOverride(input);
  const invocations: Record<string, StageInvocation[]> = {};
  const failurePolicies: Record<string, StageFailurePolicy> = {};
  const fallbacks: Record<string, StageFallback> = {};
  const fallbackProvenance: Record<string, FallbackProvenance> = {};
  const timeoutProvenance: Record<string, Record<string, TimeoutProvenance>> = {};
  for (const node of stageNodes) {
    const agents = stageAssignments[node.id] ?? [];
    const policy = resolveFailurePolicyForNode(input, node);
    const fallbackResolution = resolveFallbackForNode(input, node, agents, policy);
    const invocationResolution = resolveInvocationsForNode(input, node, agents);
    invocations[node.id] = invocationResolution.invocations;
    failurePolicies[node.id] = policy;
    fallbacks[node.id] = {
      agents: fallbackResolution.candidates.map(({ timeout_provenance: _provenance, ...candidate }) => candidate),
      max_attempts_per_agent: fallbackResolution.maxAttemptsPerAgent,
    };
    fallbackProvenance[node.id] = fallbackResolution.provenance;
    timeoutProvenance[node.id] = {
      ...invocationResolution.timeoutProvenance,
      ...Object.fromEntries(
        fallbackResolution.candidates.map((candidate) => [
          `${node.id}:${candidate.agent}`,
          candidate.timeout_provenance,
        ]),
      ),
    };
  }
  return { invocations, failurePolicies, fallbacks, fallbackProvenance, timeoutProvenance };
}

function resolveInvocationsForNode(
  input: FlowRunInput,
  node: StageNode,
  agents: string[],
): {
  invocations: StageInvocation[];
  timeoutProvenance: Record<string, TimeoutProvenance>;
} {
  const timeoutProvenance: Record<string, TimeoutProvenance> = {};
  const invocations: StageInvocation[] = agents.map((agent) => {
    const laneId = `${node.id}:${agent}`;
    const timeout = resolvePrimaryTimeout(input, agent);
    timeoutProvenance[laneId] = timeout.provenance;
    return {
      lane_id: laneId,
      kind: agent === "current" ? "current" : "primary",
      agent,
      timeout_seconds: timeout.seconds,
    };
  });
  if ((node.type === "plan" || node.type === "decide") && agents.length > 1 && agents[0] !== "current") {
    const laneId = `${node.id}:synthesis`;
    const timeout = resolvePrimaryTimeout(input, agents[0] ?? "");
    timeoutProvenance[laneId] = timeout.provenance;
    invocations.push({
      lane_id: laneId,
      kind: "synthesis",
      agent: agents[0] ?? "",
      timeout_seconds: timeout.seconds,
    });
  }
  return { invocations, timeoutProvenance };
}

function resolvePrimaryTimeout(input: FlowRunInput, agent: string): TimeoutResolution {
  if (agent === "current") {
    return { seconds: null, provenance: "current" };
  }
  if (input.timeoutSeconds !== undefined) {
    return { seconds: input.timeoutSeconds, provenance: "cli" };
  }
  const agentTimeout = agentTimeoutSeconds(input, agent);
  if (agentTimeout !== undefined) {
    return { seconds: agentTimeout, provenance: "agent" };
  }
  return { seconds: DEFAULT_INVOCATION_TIMEOUT_SECONDS, provenance: "system_default" };
}

function resolveFailurePolicyForNode(
  input: FlowRunInput,
  node: StageNode,
): StageFailurePolicy {
  const workflow = resolveWorkflowPolicy(input.workflowFailurePolicy, node);
  let policy = { ...workflow.policy };
  for (const presetPolicy of [
    input.presetFailurePolicy?.stage_types[node.type],
    input.presetFailurePolicy?.nodes[node.id],
  ]) {
    if (!presetPolicy) {
      continue;
    }
    if (
      presetPolicy.mode !== undefined &&
      policyStrictness(presetPolicy.mode) < policyStrictness(policy.mode)
    ) {
      throw new Error(
        `stage_failure_policies.${node.id} preset policy cannot loosen workflow mode ${policy.mode} to ${presetPolicy.mode}`,
      );
    }
    if (
      presetPolicy.max_fallback_agents !== undefined &&
      workflow.explicitMaxFallbackAgents !== undefined &&
      presetPolicy.max_fallback_agents > workflow.explicitMaxFallbackAgents
    ) {
      throw new Error(
        `stage_failure_policies.${node.id} preset max_fallback_agents cannot exceed workflow max_fallback_agents ${workflow.explicitMaxFallbackAgents}`,
      );
    }
    policy = mergeFailurePolicy(policy, presetPolicy);
  }
  if (policy.mode === "terminal") {
    return { mode: "terminal" };
  }
  return {
    mode: policy.mode,
    max_fallback_agents: policy.max_fallback_agents ?? 1,
  };
}

function resolveWorkflowPolicy(
  workflowPolicy: FailurePolicyConfig | undefined,
  node: StageNode,
): {
  policy: StageFailurePolicy;
  explicitMaxFallbackAgents?: number;
} {
  let policy: StageFailurePolicy = { mode: "allow", max_fallback_agents: 1 };
  let explicitMaxFallbackAgents: number | undefined;
  for (const entry of [
    workflowPolicy?.stage_types[node.type],
    workflowPolicy?.nodes[node.id],
  ]) {
    if (!entry) {
      continue;
    }
    policy = mergeFailurePolicy(policy, entry);
    if (entry.max_fallback_agents !== undefined) {
      explicitMaxFallbackAgents = entry.max_fallback_agents;
    }
  }
  if (policy.mode === "terminal") {
    policy = { mode: "terminal" };
  }
  return { policy, explicitMaxFallbackAgents };
}

function mergeFailurePolicy(
  base: StageFailurePolicy,
  override: StageFailurePolicy,
): StageFailurePolicy {
  const mode = override.mode ?? base.mode;
  if (mode === "terminal") {
    return { mode: "terminal" };
  }
  return {
    mode,
    max_fallback_agents: override.max_fallback_agents ?? base.max_fallback_agents,
  };
}

function policyStrictness(mode: StageFailurePolicy["mode"]): number {
  return { allow: 0, required: 1, terminal: 2 }[mode];
}

function resolveFallbackForNode(
  input: FlowRunInput,
  node: StageNode,
  primaryAgents: string[],
  policy: StageFailurePolicy,
): {
  candidates: FallbackCandidateWithProvenance[];
  maxAttemptsPerAgent: number;
  provenance: FallbackProvenance;
} {
  const maxAttemptsPerAgent = resolveFallbackAttempts(input, node);
  if (policy.mode === "terminal") {
    return { candidates: [], maxAttemptsPerAgent, provenance: "none" };
  }
  if (primaryAgents.length === 1 && primaryAgents[0] === "current") {
    if (policy.mode === "required") {
      throw new Error(
        `stage_failure_policies.${node.id} requires fallback agents but ${node.id} is assigned to current`,
      );
    }
    return { candidates: [], maxAttemptsPerAgent, provenance: "none" };
  }
  const fallbackAgents = fallbackAgentsForNode(input, node);
  const filteredAgents = uniqueStrings(
    fallbackAgents
      .map((candidate) => candidate.agent)
      .filter((agent) => !primaryAgents.includes(agent)),
  );
  validateFallbackAgents(node, filteredAgents, input.agentCapabilities);
  const maxFallbackAgents = policy.max_fallback_agents ?? 1;
  const agents = filteredAgents.slice(0, maxFallbackAgents);
  if (policy.mode === "required" && agents.length === 0) {
    throw new Error(`stage_failure_policies.${node.id} requires at least one fallback agent`);
  }
  const provenance = fallbackProvenanceForNode(input, node, agents);
  return {
    candidates: agents.map((agent) => {
      const timeout = resolveFallbackTimeout(input, node, agent);
      return { agent, timeout_seconds: timeout.seconds ?? DEFAULT_INVOCATION_TIMEOUT_SECONDS, timeout_provenance: timeout.provenance };
    }),
    maxAttemptsPerAgent,
    provenance,
  };
}

function fallbackAgentsForNode(
  input: FlowRunInput,
  node: StageNode,
): Array<{ agent: string; source: FallbackProvenance }> {
  return [
    ...presetFallbackAgentsForNode(input.presetFallback, node),
    ...fallbackAgentsFromStageConfig(input.globalFallback, node.type, "global_fallback"),
  ];
}

function presetFallbackAgentsForNode(
  fallback: FallbackRoutingConfig | undefined,
  node: StageNode,
): Array<{ agent: string; source: FallbackProvenance }> {
  if (!fallback) {
    return [];
  }
  const nodeFallback = fallback.nodes?.[node.id];
  if (nodeFallback) {
    return [
      ...agentEntries(nodeFallback.agents, "preset_fallback"),
      ...(nodeFallback.inherit_stage_type === false
        ? []
        : agentEntries(fallback.stage_types[node.type]?.agents, "preset_fallback")),
      ...(nodeFallback.inherit_common === false
        ? []
        : agentEntries(fallback.agents, "preset_fallback")),
    ];
  }
  return fallbackAgentsFromStageConfig(fallback, node.type, "preset_fallback");
}

function fallbackAgentsFromStageConfig(
  fallback: { agents?: string[]; stage_types: Partial<Record<StageType, { agents?: string[]; inherit_common?: boolean }>> } | undefined,
  stage: StageType,
  source: FallbackProvenance,
): Array<{ agent: string; source: FallbackProvenance }> {
  if (!fallback) {
    return [];
  }
  const stageFallback = fallback.stage_types[stage];
  return [
    ...agentEntries(stageFallback?.agents, source),
    ...(stageFallback?.inherit_common === false ? [] : agentEntries(fallback.agents, source)),
  ];
}

function agentEntries(
  agents: string[] | undefined,
  source: FallbackProvenance,
): Array<{ agent: string; source: FallbackProvenance }> {
  return (agents ?? []).map((agent) => ({ agent, source }));
}

function resolveFallbackAttempts(input: FlowRunInput, node: StageNode): number {
  return (
    input.presetFallback?.nodes?.[node.id]?.max_attempts_per_agent
    ?? input.presetFallback?.stage_types[node.type]?.max_attempts_per_agent
    ?? input.presetFallback?.max_attempts_per_agent
    ?? input.globalFallback?.stage_types[node.type]?.max_attempts_per_agent
    ?? input.globalFallback?.max_attempts_per_agent
    ?? 1
  );
}

function resolveFallbackTimeout(
  input: FlowRunInput,
  node: StageNode,
  agent: string,
): TimeoutResolution {
  if (input.timeoutSeconds !== undefined) {
    return { seconds: input.timeoutSeconds, provenance: "cli" };
  }
  const presetTimeout = fallbackTimeoutForNode(input.presetFallback, node);
  if (presetTimeout !== undefined) {
    return { seconds: presetTimeout, provenance: "preset_fallback" };
  }
  const globalTimeout = fallbackTimeoutForNode(input.globalFallback, node);
  if (globalTimeout !== undefined) {
    return { seconds: globalTimeout, provenance: "global_fallback" };
  }
  const agentTimeout = agentTimeoutSeconds(input, agent);
  if (agentTimeout !== undefined) {
    return { seconds: agentTimeout, provenance: "agent" };
  }
  return { seconds: DEFAULT_INVOCATION_TIMEOUT_SECONDS, provenance: "system_default" };
}

function fallbackTimeoutForNode(
  fallback: {
    timeout_seconds?: number;
    stage_types: Partial<Record<StageType, { timeout_seconds?: number }>>;
    nodes?: Record<string, { timeout_seconds?: number }>;
  } | undefined,
  node: StageNode,
): number | undefined {
  return (
    fallback?.nodes?.[node.id]?.timeout_seconds
    ?? fallback?.stage_types[node.type]?.timeout_seconds
    ?? fallback?.timeout_seconds
  );
}

function fallbackProvenanceForNode(
  input: FlowRunInput,
  node: StageNode,
  agents: string[],
): FallbackProvenance {
  if (agents.length === 0) {
    return "none";
  }
  if (hasPresetFallbackForNode(input.presetFallback, node)) {
    return "preset_fallback";
  }
  return "global_fallback";
}

function hasPresetFallbackForNode(
  fallback: FallbackRoutingConfig | undefined,
  node: StageNode,
): boolean {
  return Boolean(
    fallback?.nodes?.[node.id]
    || fallback?.stage_types[node.type]
    || fallback?.agents
    || fallback?.max_attempts_per_agent !== undefined
    || fallback?.timeout_seconds !== undefined,
  );
}

function validateFallbackAgents(
  node: StageNode,
  agents: string[],
  agentCapabilities: Record<string, string[]> | undefined,
): void {
  for (const agent of agents) {
    if (agent === "current") {
      throw new Error(`stage_fallbacks.${node.id}.agents must not include current`);
    }
    const capabilities = agentCapabilities?.[agent];
    if (agentCapabilities && !capabilities) {
      throw new Error(`stage_fallbacks.${node.id}.agents references unknown agent: ${agent}`);
    }
    if (capabilities && capabilities.length > 0 && !capabilities.includes(node.type)) {
      throw new Error(`stage_fallbacks.${node.id}.agents references agent without ${node.type} capability: ${agent}`);
    }
  }
}

function validateCliTimeoutOverride(input: FlowRunInput): void {
  const timeout = input.timeoutSeconds;
  if (timeout === undefined) {
    return;
  }
  if (
    !Number.isInteger(timeout) ||
    timeout < MIN_INVOCATION_TIMEOUT_SECONDS ||
    timeout > MAX_INVOCATION_TIMEOUT_SECONDS
  ) {
    throw new Error(
      `--timeout-seconds must be between ${MIN_INVOCATION_TIMEOUT_SECONDS} and ${MAX_INVOCATION_TIMEOUT_SECONDS}`,
    );
  }
  const max = input.executionPolicy?.max_adapter_timeout_secs;
  if (max !== undefined && timeout > max) {
    throw new Error(`execution_policy max_adapter_timeout_secs exceeded: ${timeout} > ${max}`);
  }
}

function agentTimeoutSeconds(input: FlowRunInput, agent: string): number | undefined {
  const timeout = input.agentTimeoutSeconds?.[agent];
  if (timeout === undefined) {
    return undefined;
  }
  if (
    !Number.isInteger(timeout) ||
    timeout < MIN_INVOCATION_TIMEOUT_SECONDS ||
    timeout > MAX_INVOCATION_TIMEOUT_SECONDS
  ) {
    throw new Error(
      `agents.${agent}.timeout_seconds must be between ${MIN_INVOCATION_TIMEOUT_SECONDS} and ${MAX_INVOCATION_TIMEOUT_SECONDS}`,
    );
  }
  return timeout;
}

function assertWorkflowCompatibility(metadata?: WorkflowCompatibilityInput): void {
  if (!metadata) {
    return;
  }
  const source = metadata.source || "unknown";
  if (metadata.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `workflow ${source} schema_version ${metadata.schemaVersion} is newer than supported workflow schema_version ${CURRENT_SCHEMA_VERSION}`,
    );
  }
  if (metadata.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `workflow ${source} schema_version must be ${CURRENT_SCHEMA_VERSION}`,
    );
  }
  if (metadata.workflowRecipeVersion > WORKFLOW_RECIPE_SCHEMA_VERSION) {
    throw new Error(
      `workflow ${source} workflow_recipe_version ${metadata.workflowRecipeVersion} is newer than supported workflow_recipe_version ${WORKFLOW_RECIPE_SCHEMA_VERSION}`,
    );
  }
  if (metadata.workflowRecipeVersion !== WORKFLOW_RECIPE_SCHEMA_VERSION) {
    throw new Error(
      `workflow ${source} workflow_recipe_version must be ${WORKFLOW_RECIPE_SCHEMA_VERSION}`,
    );
  }
  if (
    metadata.compatiblePacketSchemaVersions.length !== 1
    || metadata.compatiblePacketSchemaVersions[0] !== CURRENT_PACKET_SCHEMA_VERSION
  ) {
    throw new Error(
      `workflow ${source} compatible_packet_schema_versions must equal [${CURRENT_PACKET_SCHEMA_VERSION}]`,
    );
  }
}

function assignmentToml(
  input: FlowRunInput,
  stages: string[],
  stageNodes: StageNode[],
  stageAssignments: Record<string, string[]>,
): string {
  const lines = [
    "schema_version = 1",
    `workflow = ${JSON.stringify(input.workflow ?? BUILTIN_WORKFLOW_IDS.GUIDED_DELIVERY)}`,
    `stages = [${stages.map((item) => JSON.stringify(item)).join(", ")}]`,
    "",
  ];
  for (const node of stageNodes) {
    lines.push("[[stage_nodes]]");
    lines.push(`id = ${JSON.stringify(node.id)}`);
    lines.push(`type = ${JSON.stringify(node.type)}`);
    lines.push(`occurrence = ${node.occurrence}`);
    lines.push("");
  }
  lines.push("[stage_assignments]");
  for (const node of stageNodes) {
    lines.push(`${node.id} = [${(stageAssignments[node.id] ?? []).map((item) => JSON.stringify(item)).join(", ")}]`);
  }
  lines.push("");
  return lines.join("\n");
}

function resolveStageAssignments(
  input: FlowRunInput,
  stageNodes: StageNode[],
): {
  assignments: Record<string, string[]>;
  provenance: Record<string, string>;
} {
  const legacyAssignments: Record<string, string[]> = {
    plan: input.plan ? [input.plan] : [],
    execute: input.execute ? [input.execute] : [],
    review: [...input.review],
    decide: input.decide ? [input.decide] : [],
  };
  const assignments: Record<string, string[]> = {};
  const provenance: Record<string, string> = {};
  for (const node of stageNodes) {
    const resolved = resolveStageAssignmentForNode(input, legacyAssignments, node);
    validateResolvedPrimaryAssignment(node, resolved.agents, input.agentCapabilities);
    assignments[node.id] = resolved.agents;
    provenance[node.id] = resolved.provenance;
  }
  return { assignments, provenance };
}

function resolveStageAssignmentForNode(
  input: FlowRunInput,
  legacyAssignments: Record<string, string[]>,
  node: StageNode,
): {
  agents: string[];
  provenance: string;
} {
  const nodeAssignment = nonEmptyList(input.stageAssignments?.[node.id]);
  if (nodeAssignment) {
    return {
      agents: nodeAssignment,
      provenance: input.preset ? "preset_assignment" : "cli",
    };
  }
  const stageAssignment = nonEmptyList(input.stageAssignments?.[node.type]);
  if (stageAssignment) {
    return { agents: stageAssignment, provenance: "cli" };
  }
  const legacyAssignment = nonEmptyList(legacyAssignments[node.type]);
  if (legacyAssignment) {
    return { agents: legacyAssignment, provenance: "workflow_defaults" };
  }
  const presetStageDefault = nonEmptyList(input.presetDefaultStageAgents?.stage_types[node.type]?.agents);
  if (presetStageDefault) {
    return { agents: presetStageDefault, provenance: "preset_stage_default" };
  }
  const presetCommonDefault = nonEmptyList(input.presetDefaultStageAgents?.agents);
  if (presetCommonDefault) {
    return { agents: presetCommonDefault, provenance: "preset_common_default" };
  }
  const globalStageDefault = nonEmptyList(input.globalDefaultStageAgents?.stage_types[node.type]?.agents);
  if (globalStageDefault) {
    return { agents: globalStageDefault, provenance: "global_stage_default" };
  }
  const globalCommonDefault = nonEmptyList(input.globalDefaultStageAgents?.agents);
  if (globalCommonDefault) {
    return { agents: globalCommonDefault, provenance: "global_common_default" };
  }
  return { agents: [], provenance: "unresolved" };
}

function nonEmptyList(value: string[] | undefined): string[] | undefined {
  if (!value || value.length === 0) {
    return undefined;
  }
  return [...value];
}

function uniqueStrings(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

function validateResolvedPrimaryAssignment(
  node: StageNode,
  agents: string[],
  agentCapabilities: Record<string, string[]> | undefined,
): void {
  const label = `stage_assignments.${node.id}`;
  if (agents.length === 0) {
    throw new Error(`${label} must resolve at least one agent`);
  }
  if (agents.length > MAX_FANOUT_AGENTS) {
    throw new Error(`${label} must contain at most ${MAX_FANOUT_AGENTS} agents`);
  }
  if (agents.includes("current") && agents.length > 1) {
    throw new Error(`${label} cannot mix current with worker agents`);
  }
  if (node.type === "execute" && agents.length !== 1) {
    throw new Error(`${label} must contain exactly one agent`);
  }
  for (const agent of agents) {
    if (agent === "current") {
      continue;
    }
    const capabilities = agentCapabilities?.[agent];
    if (agentCapabilities && !capabilities) {
      throw new Error(`${label} references unknown agent: ${agent}`);
    }
    if (capabilities && capabilities.length > 0 && !capabilities.includes(node.type)) {
      throw new Error(`${label} references agent without ${node.type} capability: ${agent}`);
    }
  }
}
