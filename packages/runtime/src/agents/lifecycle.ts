import { randomBytes } from "node:crypto";

import {
  appendAgentRegistration,
  loadAgentsWithSources,
  removeAgentRegistration,
  setAgentRegistrationDisabled,
} from "../adapters.js";
import {
  buildAgentRegistrationCandidate,
  probeAgentRegistrationReadiness,
} from "../adapters/registration.js";
import {
  resolveKnownAdapterModelWithAliases,
  type ModelResolution,
} from "../adapters/models.js";
import { listRuntimeAdapters, normalizeRuntimeAdapterId } from "../adapters/registry.js";
import { configPathForAgentWrite, loadConfig } from "../config.js";

const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
const REASONING_UNSUPPORTED_ADAPTERS = new Set(["cursor-agent", "antigravity-cli"]);
const ANTIGRAVITY_CURRENT_MODEL = "current";
const GENERATED_AGENT_ID_PATTERN = /^a-[0-9a-f]{8}$/;
const MAX_AGENT_ID_GENERATION_ATTEMPTS = 64;

export type AgentLifecycleAction = "create" | "update" | "delete" | "enable" | "disable";
export type AgentIdGenerator = () => string;

export interface AgentCreateInput {
  adapter: string;
  model: string;
  label?: string;
  capabilities?: string[];
  reasoningEffort?: string;
  timeoutSeconds?: number;
  command?: string;
  args?: string[];
  env?: string[];
  skipVerify?: boolean;
}

export interface AgentUpdateInput {
  adapter?: string;
  model?: string;
  label?: string;
  capabilities?: string[];
  reasoningEffort?: string;
  timeoutSeconds?: number;
  command?: string;
  args?: string[];
  env?: string[];
  skipVerify?: boolean;
}

export interface AgentLifecycleRuntimeOptions {
  cwd?: string;
  configPath?: string;
  agentIdGenerator?: AgentIdGenerator;
}

export interface AgentLifecycleRuntimeResult {
  action: AgentLifecycleAction;
  agentId?: string;
  configPath?: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function createAgentRegistration(
  input: AgentCreateInput,
  options: AgentLifecycleRuntimeOptions = {},
): AgentLifecycleRuntimeResult {
  const cwd = options.cwd ?? process.cwd();
  const existingAgents = loadExistingAgentsForDuplicateCheck(options.configPath, cwd);
  const resolvedModel = resolveKnownAdapterModelWithAliases(
    input.adapter,
    input.model,
    loadModelAliases(options.configPath, cwd),
    { runCli: true },
  );
  if (resolvedModel.status !== "resolved") {
    return failure("create", reportModelResolutionFailure(resolvedModel), 2);
  }
  const storedModel = storedModelForAdapter(input.adapter, resolvedModel.canonicalModel);
  if (input.reasoningEffort && !REASONING_EFFORTS.has(input.reasoningEffort)) {
    return failure(
      "create",
      `reasoning_effort must be one of: ${[...REASONING_EFFORTS].join(", ")}`,
      2,
    );
  }
  let agentId: string;
  try {
    agentId = generateAgentRegistrationId(Object.keys(existingAgents), options.agentIdGenerator);
  } catch (error) {
    return failure("create", errorMessage(error), 1);
  }

  let candidate: ReturnType<typeof buildAgentRegistrationCandidate>;
  try {
    candidate = buildAgentRegistrationCandidate({
      agentId,
      adapter: input.adapter,
      model: storedModel,
      command: input.command,
      args: input.args,
      env: input.env,
      reasoningEffort: reasoningEffortForAdapter(input.adapter, input.reasoningEffort),
      capabilities: input.capabilities,
      label: input.label,
      timeoutSeconds: input.timeoutSeconds,
    });
  } catch (error) {
    const message = errorMessage(error);
    return failure(
      "create",
      message.startsWith("unknown adapter:")
        ? `${message}\nSupported adapters: ${supportedAdapters().join(", ")}`
        : message,
      2,
    );
  }

  if (input.skipVerify) {
    return failure(
      "create",
      "--skip-verify is diagnostic-only and does not write config; run without --skip-verify after readiness succeeds.",
      2,
      candidate.id,
    );
  }
  const readiness = probeAgentRegistrationReadiness(candidate, {
    skipVerify: false,
  });
  if (!readiness.ok) {
    return failure(
      "create",
      [readiness.message, ...readiness.hints.map((hint) => `Hint: ${hint}`)].join("\n"),
      1,
      candidate.id,
    );
  }

  const targetConfigPath = configPathForAgentWrite(cwd);
  appendAgentRegistration(targetConfigPath, {
    agentId: candidate.id,
    adapter: candidate.adapter,
    command: candidate.command,
    args: candidate.args,
    env: candidate.env,
    model: candidate.model ?? storedModel,
    reasoningEffort: candidate.reasoning_effort,
    capabilities: candidate.capabilities,
    label: candidate.label,
    timeoutSeconds: candidate.timeout_seconds,
  });

  const lines = [
    `Added agent: ${candidate.id}`,
    `Config: ${targetConfigPath}`,
    ...readiness.warnings.map((warning) => `Warning: ${warning}`),
  ];
  const reasoningWarning = reasoningEffortWarning(candidate.adapter, input.reasoningEffort);
  if (reasoningWarning) {
    lines.push(`Warning: ${reasoningWarning}`);
  }
  const modelWarning = modelSelectionWarning(candidate.adapter, resolvedModel.canonicalModel, storedModel);
  if (modelWarning) {
    lines.push(`Warning: ${modelWarning}`);
  }
  return success("create", lines.join("\n"), candidate.id, targetConfigPath);
}

export function deleteAgentRegistration(
  agentId: string,
  options: AgentLifecycleRuntimeOptions = {},
): AgentLifecycleRuntimeResult {
  const cwd = options.cwd ?? process.cwd();
  const configPath = configPathForAgentWrite(cwd);
  try {
    removeAgentRegistration(configPath, agentId);
  } catch (error) {
    if (error instanceof Error && error.message === `agent not found: ${agentId}`) {
      return failure("delete", `agent not found in user config: ${agentId}`, 1, agentId, configPath);
    }
    return failure("delete", errorMessage(error), 1, agentId, configPath);
  }
  return success(
    "delete",
    [`Removed agent: ${agentId}`, `Config: ${configPath}`].join("\n"),
    agentId,
    configPath,
  );
}

export function updateAgentRegistration(
  currentAgentId: string,
  input: AgentUpdateInput,
  options: AgentLifecycleRuntimeOptions = {},
): AgentLifecycleRuntimeResult {
  const cwd = options.cwd ?? process.cwd();
  const targetConfigPath = configPathForAgentWrite(cwd);
  const scopedAgents = loadExistingAgentsForDuplicateCheck(targetConfigPath, cwd);
  const existingAgent = scopedAgents[currentAgentId];
  if (!existingAgent) {
    return failure("update", `agent not found in user config: ${currentAgentId}`, 1, currentAgentId, targetConfigPath);
  }
  const adapter = input.adapter ?? existingAgent.adapter;
  const model = input.model ?? existingAgent.model;
  if (!model) {
    return failure("update", `agent model is required: ${currentAgentId}`, 2, currentAgentId, targetConfigPath);
  }
  const resolvedModel = resolveKnownAdapterModelWithAliases(
    adapter,
    model,
    loadModelAliases(options.configPath, cwd),
    { runCli: true },
  );
  if (resolvedModel.status !== "resolved") {
    return failure("update", reportModelResolutionFailure(resolvedModel), 2, currentAgentId, targetConfigPath);
  }
  const storedModel = storedModelForAdapter(adapter, resolvedModel.canonicalModel);
  const requestedReasoningEffort = input.reasoningEffort ?? existingAgent.reasoning_effort;
  if (requestedReasoningEffort && !REASONING_EFFORTS.has(requestedReasoningEffort)) {
    return failure(
      "update",
      `reasoning_effort must be one of: ${[...REASONING_EFFORTS].join(", ")}`,
      2,
      currentAgentId,
      targetConfigPath,
    );
  }

  let candidate: ReturnType<typeof buildAgentRegistrationCandidate>;
  try {
    candidate = buildAgentRegistrationCandidate({
      agentId: currentAgentId,
      adapter,
      model: storedModel,
      command: input.command ?? existingAgent.command,
      args: input.args ?? existingAgent.args,
      env: input.env ?? existingAgent.env,
      reasoningEffort: reasoningEffortForAdapter(adapter, requestedReasoningEffort),
      capabilities: input.capabilities ?? existingAgent.capabilities,
      label: input.label ?? existingAgent.label,
      timeoutSeconds: input.timeoutSeconds ?? existingAgent.timeout_seconds,
    });
  } catch (error) {
    const message = errorMessage(error);
    return failure(
      "update",
      message.startsWith("unknown adapter:")
        ? `${message}\nSupported adapters: ${supportedAdapters().join(", ")}`
        : message,
      2,
      currentAgentId,
      targetConfigPath,
    );
  }
  if (input.skipVerify) {
    return failure(
      "update",
      "--skip-verify is diagnostic-only and does not write config; run without --skip-verify after readiness succeeds.",
      2,
      currentAgentId,
      targetConfigPath,
    );
  }
  const readiness = probeAgentRegistrationReadiness(candidate, {
    skipVerify: false,
  });
  if (!readiness.ok) {
    return failure(
      "update",
      [readiness.message, ...readiness.hints.map((hint) => `Hint: ${hint}`)].join("\n"),
      1,
      currentAgentId,
      targetConfigPath,
    );
  }

  try {
    removeAgentRegistration(targetConfigPath, currentAgentId);
    appendAgentRegistration(targetConfigPath, {
      agentId: candidate.id,
      adapter: candidate.adapter,
      command: candidate.command,
      args: candidate.args,
      env: candidate.env,
      model: candidate.model ?? storedModel,
      reasoningEffort: candidate.reasoning_effort,
      capabilities: candidate.capabilities,
      label: candidate.label,
      timeoutSeconds: candidate.timeout_seconds,
    });
    if (existingAgent.disabled) {
      setAgentRegistrationDisabled(targetConfigPath, candidate.id, true);
    }
  } catch (error) {
    return failure("update", errorMessage(error), 1, currentAgentId, targetConfigPath);
  }

  const lines = [
    `Updated agent: ${candidate.id}`,
    `Config: ${targetConfigPath}`,
    ...readiness.warnings.map((warning) => `Warning: ${warning}`),
  ];
  const reasoningWarning = reasoningEffortWarning(candidate.adapter, requestedReasoningEffort);
  if (reasoningWarning) {
    lines.push(`Warning: ${reasoningWarning}`);
  }
  const modelWarning = modelSelectionWarning(candidate.adapter, resolvedModel.canonicalModel, storedModel);
  if (modelWarning) {
    lines.push(`Warning: ${modelWarning}`);
  }
  return success("update", lines.join("\n"), candidate.id, targetConfigPath);
}

export function setAgentRegistrationEnabled(
  agentId: string,
  enabled: boolean,
  options: AgentLifecycleRuntimeOptions = {},
): AgentLifecycleRuntimeResult {
  const cwd = options.cwd ?? process.cwd();
  const configPath = configPathForAgentWrite(cwd);
  try {
    setAgentRegistrationDisabled(configPath, agentId, !enabled);
  } catch (error) {
    if (error instanceof Error && error.message === `agent not found: ${agentId}`) {
      return failure(enabled ? "enable" : "disable", `agent not found in user config: ${agentId}`, 1, agentId, configPath);
    }
    return failure(enabled ? "enable" : "disable", errorMessage(error), 1, agentId, configPath);
  }
  const label = enabled ? "Enabled" : "Disabled";
  return success(
    enabled ? "enable" : "disable",
    [`${label} agent: ${agentId}`, `Config: ${configPath}`].join("\n"),
    agentId,
    configPath,
  );
}

export function generateAgentRegistrationId(
  existingAgentIds: Iterable<string>,
  generator: AgentIdGenerator = defaultAgentIdGenerator,
): string {
  const existing = new Set(existingAgentIds);
  for (let attempt = 0; attempt < MAX_AGENT_ID_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = generator();
    if (!GENERATED_AGENT_ID_PATTERN.test(candidate)) {
      throw new Error(`generated agent id must match a-xxxxxxxx: ${candidate}`);
    }
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`could not generate a unique agent id after ${MAX_AGENT_ID_GENERATION_ATTEMPTS} attempts`);
}

function defaultAgentIdGenerator(): string {
  return `a-${randomBytes(4).toString("hex")}`;
}

function reasoningEffortForAdapter(adapter: string, requested: string | undefined): string {
  if (REASONING_UNSUPPORTED_ADAPTERS.has(normalizeRuntimeAdapterId(adapter))) {
    return "none";
  }
  return requested ?? "high";
}

function storedModelForAdapter(adapter: string, resolvedModel: string): string {
  return normalizeRuntimeAdapterId(adapter) === "antigravity-cli"
    ? ANTIGRAVITY_CURRENT_MODEL
    : resolvedModel;
}

function modelSelectionWarning(
  adapter: string,
  resolvedModel: string,
  storedModel: string,
): string | undefined {
  const adapterId = normalizeRuntimeAdapterId(adapter);
  if (adapterId !== "antigravity-cli" || resolvedModel === storedModel) {
    return undefined;
  }
  return `${adapterId} uses the current Antigravity CLI model; stored ${storedModel} instead of ${resolvedModel}`;
}

function reasoningEffortWarning(adapter: string, requested: string | undefined): string | undefined {
  const adapterId = normalizeRuntimeAdapterId(adapter);
  if (!REASONING_UNSUPPORTED_ADAPTERS.has(adapterId) || !requested || requested === "none") {
    return undefined;
  }
  return `${adapterId} does not support reasoning_effort; stored none instead of ${requested}`;
}

function reportModelResolutionFailure(resolution: Exclude<ModelResolution, { status: "resolved" }>): string {
  if (resolution.status === "ambiguous") {
    return `ambiguous --model: ${resolution.input}\nCandidates: ${resolution.candidates.join(", ")}`;
  }
  return `could not resolve --model: ${resolution.input}`;
}

function supportedAdapters(): string[] {
  return listRuntimeAdapters().flatMap((adapter) => [adapter.id, ...adapter.aliases]);
}

function loadExistingAgentsForDuplicateCheck(configPath: string | undefined, cwd: string) {
  try {
    return loadAgentsWithSources(configPath, cwd);
  } catch (error) {
    const message = errorMessage(error);
    if (message.startsWith("no config found; searched:")) {
      return {};
    }
    throw error;
  }
}

function loadModelAliases(configPath: string | undefined, cwd: string) {
  try {
    return loadConfig(configPath, cwd).model_aliases;
  } catch (error) {
    const message = errorMessage(error);
    if (message.startsWith("no config found; searched:")) {
      return {};
    }
    throw error;
  }
}

function success(
  action: AgentLifecycleAction,
  stdout: string,
  agentId: string,
  configPath: string,
): AgentLifecycleRuntimeResult {
  return {
    action,
    agentId,
    configPath,
    exitCode: 0,
    stdout: `${stdout}\n`,
    stderr: "",
  };
}

function failure(
  action: AgentLifecycleAction,
  stderr: string,
  exitCode: number,
  agentId?: string,
  configPath?: string,
): AgentLifecycleRuntimeResult {
  return {
    action,
    ...(agentId ? { agentId } : {}),
    ...(configPath ? { configPath } : {}),
    exitCode,
    stdout: "",
    stderr: `${stderr.trimEnd()}\n`,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
