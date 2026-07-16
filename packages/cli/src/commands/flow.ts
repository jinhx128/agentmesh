import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BUILTIN_WORKFLOW_IDS } from "@agentmesh/core";
import { loadAgents, normalizeAgents, resolveAgent } from "@agentmesh/runtime/src/adapters.js";
import {
  configProvenanceForRun,
  loadConfig,
  loadConfigWithSources,
  type DefaultStageAgentsConfig,
} from "@agentmesh/runtime/src/config.js";
import { reserveTimestampedId } from "@agentmesh/runtime/src/generated-id.js";
import {
  attachStageArtifact,
  buildStagePrompt,
  createFlowRun,
  dispatchFlowStage,
  flowEvents,
  flowStatus,
  resumeFlow,
  retryFlowStage,
} from "@agentmesh/runtime/src/flow/index.js";
import {
  assertMcpResourceCount,
  assertMcpResourceServersConfigured,
  parseMcpResourceSpecs,
} from "@agentmesh/runtime/src/mcp/resource.js";
import { validateCorrectionId } from "@agentmesh/runtime/src/corrections/index.js";
import { loadStatus, resolveRunDirectory } from "@agentmesh/runtime/src/packet/io.js";
import { withRunMutationLock } from "@agentmesh/runtime/src/packet/lock.js";
import {
  getPreset,
  presetSearchDirs,
  presetSourceForRun,
  type Preset,
} from "@agentmesh/runtime/src/preset/registry.js";
import {
  getWorkflow,
  loadWorkflowFile,
  type Workflow,
  workflowSearchDirs,
} from "@agentmesh/runtime/src/workflow/registry.js";
import {
  resolveReviewReleasePolicyForWorkflow,
  reviewAgentIdsFromPolicy,
} from "@agentmesh/runtime/src/review/policy.js";
import { resolveExecutionPolicyForRun } from "@agentmesh/runtime/src/flow/execution-policy.js";
import {
  firstPresent,
  optionalInteger,
  optionValue,
  optionValues,
  positionalArgs,
  readOptionFile,
} from "../flags.js";
import { recordCliWorkspaceActivity } from "../workspace-activity.js";

export async function workflowRun(args: string[], configPath?: string): Promise<number> {
  if (optionValue(args, "--workflow") || optionValue(args, "--workflow-file")) {
    return flowRun(args, configPath);
  }
  const positional = positionalArgs(args);
  if (positional.length === 1) {
    const presetId = positional[0];
    try {
      const preset = getPreset(
        presetId,
        presetSearchDirs(process.cwd(), configPath),
        process.cwd(),
        configPath,
      );
      return presetRun(preset, args, configPath);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("unknown preset") &&
        workflowExists(presetId, configPath)
      ) {
        throw new Error(
          `bare run resolves presets only: '${presetId}' is a workflow id. Use agentmesh run --workflow ${presetId} or agentmesh flow run --workflow ${presetId}.`,
        );
      }
      throw error;
    }
  }
  return flowRun(args, configPath);
}

async function presetRun(
  preset: Preset,
  args: string[],
  configPath?: string,
): Promise<number> {
  const unsupportedRole = firstPresent(args, ["--plan", "--execute", "--verify", "--review", "--decide"]);
  if (unsupportedRole) {
    console.error(`preset runs do not accept role flags: ${unsupportedRole}`);
    return 2;
  }
  const cwd = process.cwd();
  const workflow = getWorkflow(preset.workflowId, workflowSearchDirs(cwd, configPath));
  const taskInput = resolveTaskInput(args);
  if (taskInput.error) {
    console.error(taskInput.error);
    return 2;
  }
  const task = taskInput.task;
  if (!task) {
    console.error(`usage: agentmesh run ${preset.presetId} --task <text> [--title <title>]`);
    return 2;
  }
  const configLoadStartedAt = Date.now();
  const resolvedConfig = loadOptionalConfigWithSources(configPath);
  const runtimeTiming = { config_load_ms: elapsedMs(configLoadStartedAt) };
  const reviewReleasePolicy = resolveReviewReleasePolicyForWorkflow(
    workflow.workflowId,
    resolvedConfig,
  );
  const executionPolicy = resolveExecutionPolicyForRun(resolvedConfig);
  const userGate = Boolean(args.includes("--user-gate") || executionPolicy?.require_user_gate);
  const assignmentsByStage = legacyRoleAssignmentsForPreset(preset, workflow);
  if (
    userGate &&
    (assignmentsByStage.decide.length !== 1 || assignmentsByStage.decide[0] !== "current")
  ) {
    throw new Error("--user-gate or execution_policy.require_user_gate requires --decide current");
  }
  const runId = optionValue(args, "--run-id") ?? reserveTimestampedId("preset", path.join(cwd, ".agentmesh", "runs")).id;
  const mcpResources = optionValues(args, "--mcp-resource");
  const mcpResourceSpecs = parseMcpResourceSpecs(mcpResources);
  const excludeCorrections = optionValues(args, "--exclude-correction").map(validateCorrectionId);
  assertMcpResourceCount(mcpResourceSpecs);
  if (mcpResourceSpecs.length > 0) {
    const config = resolvedConfig?.config ?? loadConfig(configPath);
    assertMcpResourceServersConfigured(mcpResourceSpecs, config);
  }
  const runDir = await createFlowRun(
    {
      plan: null,
      execute: null,
      review: [],
      decide: null,
      stageAssignments: preset.stageAssignments,
      task,
      title: optionValue(args, "--title"),
      runId,
      userGate,
      workflow: workflow.workflowId,
      workflowCompatibility: workflowCompatibilityForRun(workflow),
      preset: preset.presetId,
      presetSource: presetSourceForRun(preset),
      presetDefaultStageAgents: preset.defaultStageAgents,
      globalDefaultStageAgents: resolvedConfig?.config.default_stage_agents,
      workflowFailurePolicy: workflow.failurePolicy,
      presetFailurePolicy: preset.failurePolicy,
      presetFallback: preset.fallback,
      globalFallback: resolvedConfig?.config.fallback,
      agentTimeoutSeconds: agentTimeoutsForConfig(resolvedConfig),
      timeoutSeconds: optionalInteger(args, "--timeout-seconds"),
      agentCapabilities: agentCapabilitiesForConfig(resolvedConfig),
      stages: workflow.stages,
      contextFiles: optionValues(args, "--context-file"),
      diffFile: optionValue(args, "--diff-file"),
      verificationFile: optionValue(args, "--verification-file"),
      scopes: optionValues(args, "--scope"),
      mcpResources: mcpResourceSpecs,
      mcpServers: resolvedConfig?.config.mcp_servers,
      contextPolicy: resolvedConfig?.config.context_policy,
      reviewReleasePolicy,
      executionPolicy,
      configProvenance: configProvenanceForRun(resolvedConfig, new Date().toISOString()),
      runtimeTiming,
      includeSpec: args.includes("--include-spec"),
      excludeCorrections,
    },
    cwd,
  );
  recordCliWorkspaceActivity(cwd);
  for (const warning of preset.validationWarnings) {
    console.warn(`warning: ${warning}`);
  }
  console.log(`Run: ${runId}`);
  console.log(`Packet: ${runDir}`);
  return 0;
}

export async function flowRun(args: string[], configPath?: string): Promise<number> {
  const cwd = process.cwd();
  const workflowId = optionValue(args, "--workflow");
  const workflowFile = optionValue(args, "--workflow-file");
  if (workflowId && workflowFile) {
    console.error("--workflow and --workflow-file are mutually exclusive");
    return 2;
  }
  const workflow = workflowId
    ? getWorkflow(workflowId, workflowSearchDirs(cwd, configPath))
    : workflowFile
      ? loadWorkflowFile(workflowFile, cwd)
    : undefined;
  const stages = workflow?.stages ?? ["plan", "execute", "review", "decide"];
  const configLoadStartedAt = Date.now();
  const resolvedConfig = loadOptionalConfigWithSources(configPath);
  const runtimeTiming = { config_load_ms: elapsedMs(configLoadStartedAt) };
  const effectiveWorkflowId = workflow?.workflowId ?? workflowId ?? BUILTIN_WORKFLOW_IDS.GUIDED_DELIVERY;
  const defaults = workflowId ? resolvedConfig?.config.workflow_defaults[workflowId] : undefined;
  const reviewReleasePolicy = resolveReviewReleasePolicyForWorkflow(
    effectiveWorkflowId,
    resolvedConfig,
  );
  const executionPolicy = resolveExecutionPolicyForRun(resolvedConfig);
  const plan = roleAssignment(args, "--plan", defaults, "plan");
  const execute = roleAssignment(args, "--execute", defaults, "execute");
  const verify = roleAssignment(args, "--verify", defaults, "verify");
  const review = uniqueStrings([
    ...roleAssignment(args, "--review", defaults, "review"),
    ...reviewAgentIdsFromPolicy(reviewReleasePolicy),
  ]);
  const decide = roleAssignment(args, "--decide", defaults, "decide");
  const taskInput = resolveTaskInput(args);
  if (taskInput.error) {
    console.error(taskInput.error);
    return 2;
  }
  const task = taskInput.task;
  const missing = requiredRoleFlags(
    stages,
    rolesWithGlobalDefaults(stages, { plan, execute, verify, review, decide }, resolvedConfig?.config.default_stage_agents),
  );
  const unsupportedRoles = unsupportedRoleFlags(stages, { plan, execute, verify, review, decide });
  if (unsupportedRoles.length > 0) {
    console.error(`workflow does not include role flag(s): ${unsupportedRoles.join(" ")}`);
    return 2;
  }
  if (missing.length > 0 || !task) {
    console.error(
      `usage: agentmesh flow run ${missing.join(" ")} --task <text> [--title <title>]`,
    );
    return 2;
  }
  const userGate = Boolean(args.includes("--user-gate") || executionPolicy?.require_user_gate);
  if (userGate && (decide.length !== 1 || decide[0] !== "current")) {
    throw new Error("--user-gate or execution_policy.require_user_gate requires --decide current");
  }
  if (workflowFile && workflow) {
    validateTemporaryWorkflowAgents({ plan, execute, verify, review, decide }, configPath);
  }
  const runId = optionValue(args, "--run-id") ?? reserveTimestampedId("workflow", path.join(cwd, ".agentmesh", "runs")).id;
  const mcpResources = optionValues(args, "--mcp-resource");
  const mcpResourceSpecs = parseMcpResourceSpecs(mcpResources);
  const excludeCorrections = optionValues(args, "--exclude-correction").map(validateCorrectionId);
  assertMcpResourceCount(mcpResourceSpecs);
  if (mcpResourceSpecs.length > 0) {
    const config = resolvedConfig?.config ?? loadConfig(configPath);
    assertMcpResourceServersConfigured(mcpResourceSpecs, config);
  }
  const workflowSource = workflowFile
    ? temporaryWorkflowSource(requireWorkflowPath(workflow), workflow)
    : undefined;
  const runDir = await createFlowRun(
    {
      plan: firstOrNull(plan),
      execute: firstOrNull(execute),
      review,
      decide: firstOrNull(decide),
      stageAssignments: stageAssignments(stages, { plan, execute, verify, review, decide }),
      task,
      title: optionValue(args, "--title"),
      runId,
      userGate,
      workflow: workflow?.workflowId ?? workflowId,
      workflowSource,
      workflowCompatibility: workflow ? workflowCompatibilityForRun(workflow) : undefined,
      stages,
      globalDefaultStageAgents: resolvedConfig?.config.default_stage_agents,
      workflowFailurePolicy: workflow?.failurePolicy,
      globalFallback: resolvedConfig?.config.fallback,
      agentTimeoutSeconds: agentTimeoutsForConfig(resolvedConfig),
      timeoutSeconds: optionalInteger(args, "--timeout-seconds"),
      agentCapabilities: agentCapabilitiesForConfig(resolvedConfig),
      contextFiles: optionValues(args, "--context-file"),
      diffFile: optionValue(args, "--diff-file"),
      verificationFile: optionValue(args, "--verification-file"),
      scopes: optionValues(args, "--scope"),
      mcpResources: mcpResourceSpecs,
      mcpServers: resolvedConfig?.config.mcp_servers,
      contextPolicy: resolvedConfig?.config.context_policy,
      reviewReleasePolicy,
      executionPolicy,
      configProvenance: configProvenanceForRun(resolvedConfig, new Date().toISOString()),
      runtimeTiming,
      includeSpec: args.includes("--include-spec"),
      excludeCorrections,
    },
    cwd,
  );
  recordCliWorkspaceActivity(cwd);
  console.log(`Run: ${runId}`);
  console.log(`Packet: ${runDir}`);
  return 0;
}

function workflowCompatibilityForRun(workflow: Workflow): {
  source: string;
  schemaVersion: number;
  workflowRecipeVersion: number;
  compatiblePacketSchemaVersions: number[];
} {
  return {
    source: workflow.path ?? workflow.source,
    schemaVersion: workflow.schemaVersion,
    workflowRecipeVersion: workflow.workflowRecipeVersion,
    compatiblePacketSchemaVersions: workflow.compatiblePacketSchemaVersions,
  };
}

function workflowExists(workflowId: string, configPath?: string): boolean {
  try {
    getWorkflow(workflowId, workflowSearchDirs(process.cwd(), configPath));
    return true;
  } catch {
    return false;
  }
}

function resolveTaskInput(args: string[]): { task?: string; error?: string } {
  if (args.includes("--task") && args.includes("--task-file")) {
    return { error: "--task and --task-file are mutually exclusive" };
  }
  return { task: optionValue(args, "--task") ?? readOptionFile(args, "--task-file") };
}

function legacyRoleAssignmentsForPreset(
  preset: Preset,
  workflow: Workflow,
): Record<RoleStage, string[]> {
  const assignments: Record<RoleStage, string[]> = {
    plan: [],
    execute: [],
    verify: [],
    review: [],
    decide: [],
  };
  for (const node of workflow.stageNodes) {
    const agents = [
      ...(
        preset.stageAssignments[node.id]
        ?? preset.defaultStageAgents.stage_types[node.type]?.agents
        ?? preset.defaultStageAgents.agents
        ?? []
      ),
    ];
    assignments[node.type] = uniqueStrings([...assignments[node.type], ...agents]);
  }
  return assignments;
}

function loadOptionalConfigWithSources(
  configPath?: string,
): ReturnType<typeof loadConfigWithSources> | undefined {
  try {
    return loadConfigWithSources(configPath);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("no config found")) {
      return undefined;
    }
    throw error;
  }
}

function agentCapabilitiesForConfig(
  resolvedConfig: ReturnType<typeof loadConfigWithSources> | undefined,
): Record<string, string[]> {
  if (!resolvedConfig) {
    return {};
  }
  const agents = normalizeAgents(resolvedConfig.config);
  const capabilities: Record<string, string[]> = {};
  for (const agent of Object.values(agents)) {
    capabilities[agent.id] = [...agent.capabilities];
  }
  return capabilities;
}

function agentTimeoutsForConfig(
  resolvedConfig: ReturnType<typeof loadConfigWithSources> | undefined,
): Record<string, number> {
  if (!resolvedConfig) {
    return {};
  }
  const agents = normalizeAgents(resolvedConfig.config);
  const timeouts: Record<string, number> = {};
  for (const agent of Object.values(agents)) {
    if (agent.timeout_seconds === undefined) {
      continue;
    }
    timeouts[agent.id] = agent.timeout_seconds;
  }
  return timeouts;
}

function roleAssignment(
  args: string[],
  optionName: string,
  defaults: Record<string, unknown> | undefined,
  stage: RoleStage,
): string[] {
  const values = optionValues(args, optionName);
  return values.length > 0 ? values : workflowDefaultList(defaults, stage);
}

type RoleStage = "plan" | "execute" | "verify" | "review" | "decide";

function workflowDefaultList(
  defaults: Record<string, unknown> | undefined,
  stage: RoleStage,
): string[] {
  const value = defaults?.[stage];
  if (value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return [...value];
  }
  throw new Error(`workflow_defaults.${stage} must be an agent id or list of agent ids`);
}

function firstOrNull(values: string[]): string | null {
  return values[0] ?? null;
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

function rolesWithGlobalDefaults(
  stages: string[],
  assignments: Record<RoleStage, string[]>,
  defaults: DefaultStageAgentsConfig | undefined,
): Record<RoleStage, string[]> {
  const resolved: Record<RoleStage, string[]> = {
    plan: [...assignments.plan],
    execute: [...assignments.execute],
    verify: [...assignments.verify],
    review: [...assignments.review],
    decide: [...assignments.decide],
  };
  for (const stage of stages as RoleStage[]) {
    if (resolved[stage]?.length > 0) {
      continue;
    }
    resolved[stage] = [
      ...(
        defaults?.stage_types[stage]?.agents
        ?? defaults?.agents
        ?? []
      ),
    ];
  }
  return resolved;
}

function stageAssignments(
  stages: string[],
  assignments: Record<RoleStage, string[]>,
): Record<string, string[]> {
  const output: Record<string, string[]> = {};
  for (const stage of stages) {
    const agents = assignments[stage as keyof typeof assignments] ?? [];
    if (agents.length > 0) {
      output[stage] = [...agents];
    }
  }
  return output;
}

function temporaryWorkflowSource(
  workflowPath: string,
  workflow: {
    schemaVersion: number;
    workflowRecipeVersion: number;
    compatiblePacketSchemaVersions: number[];
  } | undefined,
): Record<string, unknown> {
  if (!workflow) {
    throw new Error("temporary workflow version metadata was not resolved");
  }
  return {
    source: "temporary",
    path: path.resolve(workflowPath),
    hash: `sha256:${createHash("sha256").update(readFileSync(workflowPath)).digest("hex")}`,
    schema_version: workflow.schemaVersion,
    workflow_recipe_version: workflow.workflowRecipeVersion,
    compatible_packet_schema_versions: workflow.compatiblePacketSchemaVersions,
  };
}

function requireWorkflowPath(workflow: { path?: string } | undefined): string {
  if (!workflow?.path) {
    throw new Error("temporary workflow path was not resolved");
  }
  return workflow.path;
}

function validateTemporaryWorkflowAgents(
  assignment: Record<RoleStage, string[]>,
  configPath?: string,
): void {
  const agentNames = [
    ...assignment.plan,
    ...assignment.execute,
    ...assignment.verify,
    ...assignment.review,
    ...assignment.decide,
  ].filter((agent): agent is string => Boolean(agent) && agent !== "current");
  if (agentNames.length === 0) {
    return;
  }
  const agents = loadAgents(configPath);
  for (const agentName of agentNames) {
    resolveAgent(agents, agentName);
  }
}

export async function flowDispatch(args: string[], configPath?: string): Promise<number> {
  const cwd = process.cwd();
  const run = positionalArgs(args)[0];
  const stage = optionValue(args, "--stage");
  if (!run || !stage) {
    console.error("usage: agentmesh flow dispatch <run> --stage <stage|all>");
    return 2;
  }
  const result = await dispatchFlowStage(
    run,
    stage,
    { configPath, timeoutSecs: optionalInteger(args, "--timeout-secs") },
    cwd,
  );
  recordCliWorkspaceActivity(cwd);
  printDispatchResult(result);
  return 0;
}

export async function flowRetry(args: string[], configPath?: string): Promise<number> {
  const cwd = process.cwd();
  const run = positionalArgs(args)[0];
  if (!run) {
    console.error("usage: agentmesh flow retry <run> [--stage <stage>]");
    return 2;
  }
  const result = await retryFlowStage(
    run,
    optionValue(args, "--stage"),
    { configPath, timeoutSecs: optionalInteger(args, "--timeout-secs") },
    cwd,
  );
  recordCliWorkspaceActivity(cwd);
  printDispatchResult(result);
  return 0;
}

export async function flowResume(args: string[], configPath?: string): Promise<number> {
  const cwd = process.cwd();
  const run = positionalArgs(args)[0];
  if (!run) {
    console.error("usage: agentmesh flow resume <run> [--stage <stage>]");
    return 2;
  }
  const result = await resumeFlow(
    run,
    optionValue(args, "--stage"),
    { configPath, timeoutSecs: optionalInteger(args, "--timeout-secs") },
    cwd,
  );
  recordCliWorkspaceActivity(cwd);
  printDispatchResult(result);
  return 0;
}

export function flowStatusCommand(args: string[]): number {
  const json = args.includes("--json");
  const run = positionalArgs(args)[0];
  if (!run) {
    console.error("usage: agentmesh flow status <run> [--json]");
    return 2;
  }
  const status = flowStatus(run);
  if (json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    const stageTargets = Array.isArray(status.stage_nodes)
      ? status.stage_nodes.map((node: { id: string }) => node.id)
      : status.stages;
    console.log(`Run: ${status.run_id}`);
    console.log(`Title: ${status.title ?? "-"}`);
    console.log(`Status: ${status.status}`);
    console.log(`Stages: ${stageTargets.join(", ")}`);
    console.log(`Completed: ${status.completed_stages.join(", ") || "(none)"}`);
  }
  return 0;
}

export function flowEventsCommand(args: string[]): number {
  const unsupported = firstPresent(args, ["--follow", "--limit"]);
  if (unsupported) {
    console.error(`${unsupported} is not supported by TS flow events yet`);
    return 2;
  }
  const json = args.includes("--json");
  const run = positionalArgs(args)[0];
  if (!run) {
    console.error("usage: agentmesh flow events <run> [--json]");
    return 2;
  }
  const events = flowEvents(run);
  if (json) {
    console.log(JSON.stringify(events, null, 2));
  } else {
    for (const event of events) {
      console.log(`${event.timestamp}\t${event.event}`);
    }
  }
  return 0;
}

export function flowPrompt(args: string[]): number {
  const run = positionalArgs(args)[0];
  const stage = optionValue(args, "--stage");
  if (!run || !stage) {
    console.error("usage: agentmesh flow prompt <run> --stage <stage>");
    return 2;
  }
  const runDir = resolveRunDirectory(run);
  const status = loadStatus(runDir);
  const stageType = Array.isArray(status.stage_nodes)
    ? status.stage_nodes.find((node: { id: string }) => node.id === stage)?.type ?? stage
    : stage;
  const prompt =
    status.workflow === BUILTIN_WORKFLOW_IDS.RELEASE_CHECK && (stageType === "review" || stageType === "decide")
      ? withRunMutationLock(runDir, `flow.prompt:${stage}`, () =>
          buildStagePrompt(runDir, stage),
        )
      : buildStagePrompt(runDir, stage);
  process.stdout.write(prompt);
  return 0;
}

export function flowAttach(args: string[]): number {
  const cwd = process.cwd();
  const run = positionalArgs(args)[0];
  const stage = optionValue(args, "--stage");
  const text = optionValue(args, "--text") ?? readOptionFile(args, "--file");
  if (!run || !stage || text === undefined) {
    console.error("usage: agentmesh flow attach <run> --stage <stage> [--text <text>] [--file <path>]");
    return 2;
  }
  console.log(`Attached: ${attachStageArtifact(run, stage, text, optionValue(args, "--agent") ?? "current", cwd)}`);
  recordCliWorkspaceActivity(cwd);
  return 0;
}

function requiredRoleFlags(
  stages: string[],
  roles: Record<RoleStage, string[]>,
): string[] {
  const missing: string[] = [];
  if (stages.includes("plan") && roles.plan.length === 0) {
    missing.push("--plan <id>");
  }
  if (stages.includes("execute") && roles.execute.length === 0) {
    missing.push("--execute <id>");
  }
  if (stages.includes("verify") && roles.verify.length === 0) {
    missing.push("--verify <id>");
  }
  if (stages.includes("review") && roles.review.length === 0) {
    missing.push("--review <id>");
  }
  if (stages.includes("decide") && roles.decide.length === 0) {
    missing.push("--decide <id>");
  }
  return missing;
}

function unsupportedRoleFlags(
  stages: string[],
  roles: Record<RoleStage, string[]>,
): string[] {
  const unsupported: string[] = [];
  if (!stages.includes("plan") && roles.plan.length > 0) {
    unsupported.push("--plan");
  }
  if (!stages.includes("execute") && roles.execute.length > 0) {
    unsupported.push("--execute");
  }
  if (!stages.includes("verify") && roles.verify.length > 0) {
    unsupported.push("--verify");
  }
  if (!stages.includes("review") && roles.review.length > 0) {
    unsupported.push("--review");
  }
  if (!stages.includes("decide") && roles.decide.length > 0) {
    unsupported.push("--decide");
  }
  return unsupported;
}

function printDispatchResult(result: { dispatched: string[]; awaitingCurrent?: string }): void {
  if (result.dispatched.length > 0) {
    console.log(`Dispatched: ${result.dispatched.join(", ")}`);
  }
  if (result.awaitingCurrent) {
    console.log(`Awaiting current: ${result.awaitingCurrent}`);
  }
  if (result.dispatched.length === 0 && !result.awaitingCurrent) {
    console.log("Nothing to dispatch");
  }
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}
