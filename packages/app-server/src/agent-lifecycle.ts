import { listAgents as listSdkAgents } from "@agentmesh/sdk";
import {
  createAgentRegistration,
  deleteAgentRegistration,
  setAgentRegistrationEnabled,
  updateAgentRegistration,
  type AgentLifecycleRuntimeResult,
} from "@agentmesh/runtime/src/agents/lifecycle.js";
import { discoverAdapterModels } from "@agentmesh/runtime/src/adapters/models.js";

export interface StudioAgentLifecycleOptions {
  cwd?: string;
  configPath?: string;
}

export interface StudioAgentSummary {
  id: string;
  label: string;
  adapter: string;
  capabilities: string[];
  status: "enabled" | "disabled";
  disabled: boolean;
  model?: string;
  reasoning_effort?: string;
  source_layer?: string;
  source_path?: string;
}

export interface StudioAgentListPayload {
  agents: StudioAgentSummary[];
}

export interface StudioAgentModelListPayload {
  adapter_id: string;
  status: "discovered" | "unsupported";
  source: "adapter-cli" | "unsupported";
  models: string[];
  command?: string[];
  reason?: string;
}

export type StudioAgentLifecycleAction = "create" | "update" | "delete" | "enable" | "disable";

export interface StudioAgentCreateRequest {
  adapter: string;
  model: string;
  label?: string;
  capabilities?: string[];
  reasoning_effort?: string;
  timeout_seconds?: number;
  command?: string;
  args?: string[];
  env?: string[];
}

export interface StudioAgentUpdateRequest {
  adapter: string;
  model: string;
  label?: string;
  capabilities?: string[];
  reasoning_effort?: string;
  timeout_seconds?: number;
  command?: string;
  args?: string[];
  env?: string[];
}

export interface StudioAgentLifecycleRequest {
  action: StudioAgentLifecycleAction;
  agentId?: string;
  create?: StudioAgentCreateRequest;
  update?: StudioAgentUpdateRequest;
}

export interface StudioAgentLifecycleOperation {
  operation_id: string;
  action: StudioAgentLifecycleAction;
  status: "running" | "succeeded" | "failed" | "conflict";
  command: string[];
  exit_code: number | null;
  stdout: string;
  stderr: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  agent_id?: string;
}

const operations = new Map<string, StudioAgentLifecycleOperation>();
const activeKeys = new Set<string>();

export async function runStudioAgentLifecycleOperation(
  request: StudioAgentLifecycleRequest,
  options: StudioAgentLifecycleOptions = {},
): Promise<StudioAgentLifecycleOperation> {
  const operationId = `agent-op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const command = studioAgentLifecycleCommand(request, options);
  const agentId = agentIdForRequest(request);
  const activeKey = agentLifecycleActiveKey(request, agentId);
  const startedAt = Date.now();
  const operation: StudioAgentLifecycleOperation = {
    operation_id: operationId,
    action: request.action,
    status: "running",
    command,
    exit_code: null,
    stdout: "",
    stderr: "",
    started_at: new Date(startedAt).toISOString(),
    ...(agentId ? { agent_id: agentId } : {}),
  };
  operations.set(operationId, operation);
  if (activeKeys.has(activeKey)) {
    const completedAt = Date.now();
    const conflict = {
      ...operation,
      status: "conflict" as const,
      stderr: `agent lifecycle operation already running for ${agentId ?? request.action}`,
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
    };
    operations.set(operationId, conflict);
    return conflict;
  }
  activeKeys.add(activeKey);
  try {
    let result: AgentLifecycleRuntimeResult;
    try {
      result = runRuntimeAgentLifecycle(request, options);
    } catch (error) {
      const completedAt = Date.now();
      const failed: StudioAgentLifecycleOperation = {
        ...operation,
        status: "failed",
        exit_code: 1,
        stdout: "",
        stderr: `${error instanceof Error ? error.message : String(error)}\n`,
        completed_at: new Date(completedAt).toISOString(),
        duration_ms: completedAt - startedAt,
      };
      operations.set(operationId, failed);
      return failed;
    }
    const completedAt = Date.now();
    const completed: StudioAgentLifecycleOperation = {
      ...operation,
      status: result.exitCode === 0 ? "succeeded" : "failed",
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
      ...(result.agentId ? { agent_id: result.agentId } : {}),
    };
    operations.set(operationId, completed);
    return completed;
  } finally {
    activeKeys.delete(activeKey);
  }
}

export function readStudioAgents(options: StudioAgentLifecycleOptions = {}): StudioAgentListPayload {
  const agents = listSdkAgents({
    cwd: options.cwd ?? process.cwd(),
    ...(options.configPath ? { configPath: options.configPath } : {}),
  });
  return {
    agents: agents.map(studioAgentSummary).filter((agent): agent is StudioAgentSummary => agent !== undefined),
  };
}

export function readStudioAgent(agentId: string, options: StudioAgentLifecycleOptions = {}): StudioAgentSummary {
  const agent = readStudioAgents(options).agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    throw new Error(`agent not found: ${agentId}`);
  }
  return agent;
}

export function readStudioAgentModels(adapter: string): StudioAgentModelListPayload {
  const discovery = discoverAdapterModels(adapter, { runCli: true });
  if (discovery.status === "discovered") {
    return {
      adapter_id: discovery.adapterId,
      status: discovery.status,
      source: discovery.source,
      models: discovery.models,
      ...(discovery.command ? { command: discovery.command } : {}),
    };
  }
  return {
    adapter_id: discovery.adapterId,
    status: discovery.status,
    source: discovery.source,
    models: [],
    reason: discovery.reason,
  };
}

export function readStudioAgentLifecycleOperation(operationId: string): StudioAgentLifecycleOperation | undefined {
  return operations.get(operationId);
}

export function studioAgentLifecycleCommand(
  request: StudioAgentLifecycleRequest,
  options: StudioAgentLifecycleOptions = {},
): string[] {
  rejectAgentScope(request);
  if (request.action === "create") {
    const create = request.create;
    if (!create) {
      throw new Error("create request is required");
    }
    const command = [
      "runtime",
      "agents",
      "add",
      "--adapter",
      safeToken(create.adapter, "adapter"),
      "--model",
      safeValue(create.model, "model"),
    ];
    if (create.label) {
      command.push("--label", create.label);
    }
    for (const capability of create.capabilities ?? []) {
      command.push("--capability", safeToken(capability, "capability"));
    }
    if (create.reasoning_effort) {
      command.push("--reasoning-effort", safeToken(create.reasoning_effort, "reasoning_effort"));
    }
    if (create.timeout_seconds !== undefined) {
      if (!Number.isInteger(create.timeout_seconds) || create.timeout_seconds <= 0) {
        throw new Error("timeout_seconds must be a positive integer");
      }
      command.push("--timeout-seconds", String(create.timeout_seconds));
    }
    if (create.command) {
      command.push("--command", safeValue(create.command, "command"));
    }
    for (const arg of create.args ?? []) {
      command.push("--arg", safeValue(arg, "arg"));
    }
    for (const env of create.env ?? []) {
      command.push("--env", safeValue(env, "env"));
    }
    return withConfigTrace(command, options);
  }
  if (request.action === "update") {
    const update = request.update;
    if (!update) {
      throw new Error("update request is required");
    }
    const command = [
      "runtime",
      "agents",
      "update",
      safeToken(request.agentId, "agent_id"),
      "--adapter",
      safeToken(update.adapter, "adapter"),
      "--model",
      safeValue(update.model, "model"),
    ];
    if (update.label) {
      command.push("--label", update.label);
    }
    for (const capability of update.capabilities ?? []) {
      command.push("--capability", safeToken(capability, "capability"));
    }
    if (update.reasoning_effort) {
      command.push("--reasoning-effort", safeToken(update.reasoning_effort, "reasoning_effort"));
    }
    if (update.timeout_seconds !== undefined) {
      if (!Number.isInteger(update.timeout_seconds) || update.timeout_seconds <= 0) {
        throw new Error("timeout_seconds must be a positive integer");
      }
      command.push("--timeout-seconds", String(update.timeout_seconds));
    }
    if (update.command) {
      command.push("--command", safeValue(update.command, "command"));
    }
    for (const arg of update.args ?? []) {
      command.push("--arg", safeValue(arg, "arg"));
    }
    for (const env of update.env ?? []) {
      command.push("--env", safeValue(env, "env"));
    }
    return withConfigTrace(command, options);
  }
  const agentId = safeToken(request.agentId, "agent_id");
  if (request.action === "delete") {
    return withConfigTrace(["runtime", "agents", "remove", agentId], options);
  }
  return withConfigTrace(["runtime", "agents", request.action, agentId], options);
}

function runRuntimeAgentLifecycle(
  request: StudioAgentLifecycleRequest,
  options: StudioAgentLifecycleOptions,
): AgentLifecycleRuntimeResult {
  rejectAgentScope(request);
  const runtimeOptions = {
    cwd: options.cwd ?? process.cwd(),
    ...(options.configPath ? { configPath: options.configPath } : {}),
  };
  if (request.action === "create") {
    const create = request.create;
    if (!create) {
      throw new Error("create request is required");
    }
    return createAgentRegistration({
      adapter: safeToken(create.adapter, "adapter"),
      model: safeValue(create.model, "model"),
      label: create.label,
      capabilities: create.capabilities,
      reasoningEffort: create.reasoning_effort,
      timeoutSeconds: create.timeout_seconds,
      command: create.command,
      args: create.args,
      env: create.env,
    }, runtimeOptions);
  }
  const agentId = safeToken(request.agentId, "agent_id");
  if (request.action === "update") {
    const update = request.update;
    if (!update) {
      throw new Error("update request is required");
    }
    return updateAgentRegistration(agentId, {
      ...(update.adapter ? { adapter: safeToken(update.adapter, "adapter") } : {}),
      ...(update.model ? { model: safeValue(update.model, "model") } : {}),
      label: update.label,
      capabilities: update.capabilities,
      reasoningEffort: update.reasoning_effort,
      timeoutSeconds: update.timeout_seconds,
      command: update.command,
      args: update.args,
      env: update.env,
    }, runtimeOptions);
  }
  if (request.action === "delete") {
    return deleteAgentRegistration(agentId, runtimeOptions);
  }
  return setAgentRegistrationEnabled(agentId, request.action === "enable", runtimeOptions);
}

function withConfigTrace(command: string[], options: StudioAgentLifecycleOptions): string[] {
  return options.configPath ? [...command, "--config", options.configPath] : command;
}

function agentIdForRequest(request: StudioAgentLifecycleRequest): string | undefined {
  return request.action === "create" ? undefined : request.agentId;
}

function agentLifecycleActiveKey(
  request: StudioAgentLifecycleRequest,
  agentId: string | undefined,
): string {
  if (request.action !== "create") {
    return `${request.action}:${agentId ?? "agents"}`;
  }
  const create = request.create;
  if (!create) {
    return "create:agents";
  }
  return `create:${safeToken(create.adapter, "adapter")}:${safeValue(create.model, "model")}`;
}

function rejectAgentScope(request: StudioAgentLifecycleRequest): void {
  if (isRecord(request) && Object.hasOwn(request, "scope")) {
    throw new Error("agent scope is not supported; agents are global user-level resources");
  }
  if (isRecord(request.create) && Object.hasOwn(request.create, "scope")) {
    throw new Error("agent scope is not supported; agents are global user-level resources");
  }
  if (isRecord(request.update) && Object.hasOwn(request.update, "scope")) {
    throw new Error("agent scope is not supported; agents are global user-level resources");
  }
}

function safeToken(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${label} contains unsupported characters: ${value}`);
  }
  return value;
}

function safeValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.includes("\0")) {
    throw new Error(`${label} cannot contain null bytes`);
  }
  return value;
}

function studioAgentSummary(value: unknown): StudioAgentSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = stringValue(value.id);
  const label = stringValue(value.label);
  const adapter = stringValue(value.adapter);
  if (!id || !label || !adapter) {
    return undefined;
  }
  const disabled = value.disabled === true || stringValue(value.status) === "disabled";
  return {
    id,
    label,
    adapter,
    capabilities: stringArray(value.capabilities),
    status: disabled ? "disabled" : "enabled",
    disabled,
    ...(stringValue(value.model) ? { model: stringValue(value.model) } : {}),
    ...(stringValue(value.reasoning_effort) ? { reasoning_effort: stringValue(value.reasoning_effort) } : {}),
    ...(stringValue(value.source_layer) ? { source_layer: stringValue(value.source_layer) } : {}),
    ...(stringValue(value.source_path) ? { source_path: stringValue(value.source_path) } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
