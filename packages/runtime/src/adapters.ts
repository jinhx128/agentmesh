import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { STAGE_TYPES } from "@agentmesh/core";

import {
  AgentmeshConfig,
  ConfigSourceRef,
  loadConfig,
  loadConfigWithSources,
  parseAgentmeshToml,
  removeTomlTable,
  tomlArray,
  tomlString,
} from "./config.js";
import {
  listRuntimeAdapters,
  lookupRuntimeAdapter,
  normalizeRuntimeAdapterId,
  type RuntimeAdapterMetadata,
} from "./adapters/registry.js";
import {
  parseAdapterStructuredSessionResult,
  prepareAdapterInvocation,
  prepareAdapterSessionInvocation,
} from "./adapters/invocation.js";
import type { AdapterSessionDirective, AdapterStructuredResult } from "./adapters/session.js";
import { resolveProviderTool } from "./adapters/provider-tools.js";
import { buildAgentProcessEnv } from "./process-env.js";

export interface BuiltinAdapter {
  name: string;
  description: string;
  command: string;
  args: string[];
  label: string;
}

export interface AgentConfig {
  id: string;
  label: string;
  adapter: string;
  command: string;
  args: string[];
  env: string[];
  capabilities: string[];
  model?: string;
  reasoning_effort?: string;
  timeout_seconds?: number;
  prompt_file_arg?: string;
  prompt_arg?: string;
  output_file_arg?: string;
  stdin?: boolean;
  disabled?: boolean;
  source_layer?: string;
  source_path?: string;
}

export interface AgentRegistrationInput {
  agentId: string;
  adapter: string;
  command?: string;
  args?: string[];
  env?: string[];
  model: string;
  reasoningEffort?: string;
  capabilities?: string[];
  label?: string;
  timeoutSeconds?: number;
}

export interface AgentCallRuntimeTiming {
  config_load_ms: number;
  adapter_spawn_ms: number;
  agent_total_ms: number;
  total_ms: number;
  first_output_ms?: number;
}

export interface AgentCallResult {
  exitCode: number;
  timing: AgentCallRuntimeTiming;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  structuredSessionResult?: AdapterStructuredResult;
}

export class AgentCallError extends Error {
  readonly timing: Partial<AgentCallRuntimeTiming>;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly timedOut: boolean;

  constructor(
    error: Error,
    timing: Partial<AgentCallRuntimeTiming>,
    output: { stdout?: string; stderr?: string; timedOut?: boolean } = {},
  ) {
    super(error.message, { cause: error });
    this.name = error.name;
    this.timing = timing;
    this.stdout = output.stdout;
    this.stderr = output.stderr;
    this.timedOut = output.timedOut ?? false;
  }
}

export function agentCallTimingFromError(
  error: unknown,
): Partial<AgentCallRuntimeTiming> | undefined {
  return error instanceof AgentCallError ? error.timing : undefined;
}

export function agentCallOutputFromError(
  error: unknown,
): { stdout?: string; stderr?: string; timedOut?: boolean } | undefined {
  return error instanceof AgentCallError
    ? { stdout: error.stdout, stderr: error.stderr, timedOut: error.timedOut }
    : undefined;
}

export function listAdapters(): BuiltinAdapter[] {
  return listRuntimeAdapters().map(builtinAdapterFromMetadata);
}

export function defaultAgentLabel(adapterIdOrAlias: string, canonicalModel: string): string {
  const adapter = adapterDefaults(adapterIdOrAlias);
  return `${adapter.label} (${canonicalModel.trim()})`;
}

export function appendAgentRegistration(
  configPath: string,
  input: AgentRegistrationInput,
): void {
  const adapter = adapterDefaults(input.adapter);
  const capabilities = input.capabilities?.length
    ? input.capabilities
    : [...STAGE_TYPES];
  const lines = [
    "",
    `[agents.${input.agentId}]`,
    `label = ${tomlString(input.label ?? adapter.label)}`,
    `adapter = ${tomlString(adapter.name)}`,
    `command = ${tomlString(input.command ?? adapter.command)}`,
    `args = ${tomlArray(input.args ?? adapter.args)}`,
    ...(input.env?.length ? [`env = ${tomlArray(input.env)}`] : []),
    `model = ${tomlString(input.model)}`,
    `reasoning_effort = ${tomlString(input.reasoningEffort ?? "high")}`,
    `capabilities = ${tomlArray(capabilities)}`,
    ...(input.timeoutSeconds === undefined ? [] : [`timeout_seconds = ${input.timeoutSeconds}`]),
    'context_mode = "workspace-aware"',
    "",
  ];
  mkdirSync(path.dirname(configPath), { recursive: true });
  if (!existsSync(configPath)) {
    writeFileSync(configPath, "schema_version = 1\n", { encoding: "utf-8" });
  }
  appendFileSync(configPath, lines.join("\n"), { encoding: "utf-8" });
}

export function removeAgentRegistration(configPath: string, agentId: string): void {
  if (!existsSync(configPath)) {
    throw new Error(`agent not found: ${agentId}`);
  }
  const content = readFileSync(configPath, { encoding: "utf-8" });
  const config = parseAgentmeshToml(content, configPath);
  if (!Object.hasOwn(config.agents, agentId)) {
    throw new Error(`agent not found: ${agentId}`);
  }
  const updated = removeTomlTable(content, `agents.${agentId}`);
  if (updated === undefined) {
    throw new Error(`agent table not found in config: ${agentId}`);
  }
  writeFileSync(configPath, updated, { encoding: "utf-8" });
}

export function setAgentRegistrationDisabled(
  configPath: string,
  agentId: string,
  disabled: boolean,
): void {
  if (!existsSync(configPath)) {
    throw new Error(`agent not found: ${agentId}`);
  }
  const content = readFileSync(configPath, { encoding: "utf-8" });
  const config = parseAgentmeshToml(content, configPath);
  if (!Object.hasOwn(config.agents, agentId)) {
    throw new Error(`agent not found: ${agentId}`);
  }
  const updated = upsertTomlTableField(content, `agents.${agentId}`, "disabled", disabled ? "true" : "false");
  if (updated === undefined) {
    throw new Error(`agent table not found in config: ${agentId}`);
  }
  writeFileSync(configPath, updated, { encoding: "utf-8" });
}

export function loadAgents(configPath?: string, cwd = process.cwd()): Record<string, AgentConfig> {
  const config = loadConfig(configPath, cwd);
  return normalizeAgents(config);
}

export function loadAgentsWithSources(configPath?: string, cwd = process.cwd()): Record<string, AgentConfig> {
  const loaded = loadConfigWithSources(configPath, cwd);
  return normalizeAgents(loaded.config, loaded.agentSources);
}

export function normalizeAgents(
  config: AgentmeshConfig,
  sources: Record<string, ConfigSourceRef> = {},
): Record<string, AgentConfig> {
  return Object.fromEntries(
    Object.entries(config.agents).map(([id, payload]) => [
      id,
      normalizeAgent(id, payload, sources[id]),
    ]),
  );
}

export function resolveAgent(agents: Record<string, AgentConfig>, name: string): AgentConfig {
  if (agents[name]) {
    if (agents[name].disabled) {
      throw new Error(`agent is disabled: ${name}`);
    }
    return agents[name];
  }
  throw new Error(`unknown agent: ${name}`);
}

export function runAgentCall(options: {
  configPath?: string;
  cwd?: string;
  agentName: string;
  prompt?: string;
  promptFile?: string;
  outputFile?: string;
  timeoutSecs?: number;
}): number {
  return runAgentCallWithTiming(options).exitCode;
}

export function runAgentCallWithTiming(options: {
  configPath?: string;
  cwd?: string;
  agentName: string;
  prompt?: string;
  promptFile?: string;
  outputFile?: string;
  timeoutSecs?: number;
}): AgentCallResult {
  if (options.agentName === "current") {
    throw new Error(
      "current is host-only and cannot be invoked with agentmesh call; use flow prompt and flow attach on a run stage so the current entrance agent writes an artifact.",
    );
  }
  const totalStartedAt = Date.now();
  const configStartedAt = Date.now();
  const cwd = options.cwd ?? process.cwd();
  const agents = loadAgents(options.configPath, cwd);
  const configLoadMs = elapsedMs(configStartedAt);
  const agent = resolveAgent(agents, options.agentName);
  const prepared = prepareAdapterInvocation(resolveInvokableAgent(agent, cwd), options);
  const command = prepared.command;
  const stdin = prepared.stdin;
  const captureStdout = prepared.captureStdout;
  const spawnStartedAt = Date.now();
  const result = spawnSync(command[0], command.slice(1), {
    env: buildAgentProcessEnv(prepared.env),
    input: stdin,
    encoding: "utf-8",
    timeout: options.timeoutSecs ? options.timeoutSecs * 1000 : undefined,
    stdio:
      stdin === undefined
        ? ["inherit", captureStdout ? "pipe" : "inherit", "inherit"]
        : ["pipe", captureStdout ? "pipe" : "inherit", "inherit"],
  });
  const adapterSpawnMs = elapsedMs(spawnStartedAt);
  const timing = (): AgentCallRuntimeTiming => {
    const totalMs = elapsedMs(totalStartedAt);
    return {
      config_load_ms: configLoadMs,
      adapter_spawn_ms: adapterSpawnMs,
      agent_total_ms: totalMs,
      total_ms: totalMs,
    };
  };
  if (result.error) {
    throw new AgentCallError(result.error, timing());
  }
  if (captureStdout && prepared.outputFile && result.stdout) {
    writeFileSync(prepared.outputFile, result.stdout, { encoding: "utf-8" });
  }
  return {
    exitCode: result.status ?? 1,
    timing: timing(),
  };
}

export async function runAgentCallAsync(options: {
  configPath?: string;
  cwd?: string;
  agentName: string;
  prompt?: string;
  promptFile?: string;
  outputFile?: string;
  timeoutSecs?: number;
  session?: AdapterSessionDirective;
  /** Opaque runtime metadata; never added to prompts, artifacts, or adapter argv. */
  idempotencyKey?: string;
}): Promise<AgentCallResult> {
  if (options.agentName === "current") {
    throw new Error(
      "current is host-only and cannot be invoked with agentmesh call; use flow prompt and flow attach on a run stage so the current entrance agent writes an artifact.",
    );
  }
  const totalStartedAt = Date.now();
  const configStartedAt = Date.now();
  const cwd = options.cwd ?? process.cwd();
  const agents = loadAgents(options.configPath, cwd);
  const configLoadMs = elapsedMs(configStartedAt);
  const agent = resolveAgent(agents, options.agentName);
  const prepared = options.session
    ? prepareAdapterSessionInvocation(resolveInvokableAgent(agent, cwd), options, options.session)
    : prepareAdapterInvocation(resolveInvokableAgent(agent, cwd), options);
  const command = prepared.command;
  const stdin = prepared.stdin;
  const captureStdout = prepared.captureStdout;
  const spawnStartedAt = Date.now();
  let firstOutputMs: number | undefined;
  let stdout = "";
  let stderr = "";
  let settled = false;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = timeoutSecsToMs(options.timeoutSecs);

  const timing = (): AgentCallRuntimeTiming => {
    const totalMs = elapsedMs(totalStartedAt);
    return {
      config_load_ms: configLoadMs,
      adapter_spawn_ms: elapsedMs(spawnStartedAt),
      ...(firstOutputMs === undefined ? {} : { first_output_ms: firstOutputMs }),
      agent_total_ms: totalMs,
      total_ms: totalMs,
    };
  };

  const child = spawn(command[0], command.slice(1), {
    env: buildAgentProcessEnv({
      ...prepared.env,
      ...(options.idempotencyKey ? { AGENTMESH_INTERNAL_IDEMPOTENCY_KEY: options.idempotencyKey } : {}),
    }),
    stdio:
      stdin === undefined
        ? ["inherit", "pipe", "pipe"]
        : ["pipe", "pipe", "pipe"],
  });

  if (timeoutMs !== undefined) {
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 1_000);
    }, timeoutMs);
  }

  if (stdin !== undefined) {
    child.stdin?.end(stdin);
  }
  child.stdout?.on("data", (chunk: Buffer | string) => {
    firstOutputMs ??= elapsedMs(spawnStartedAt);
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    firstOutputMs ??= elapsedMs(spawnStartedAt);
    stderr += chunk.toString();
  });

  return new Promise<AgentCallResult>((resolve, reject) => {
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      reject(new AgentCallError(asError(error), timing(), { stdout, stderr, timedOut }));
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      if (timedOut) {
        reject(
          new AgentCallError(
            new Error(`agent invocation timed out after ${options.timeoutSecs}s`),
            timing(),
            { stdout, stderr, timedOut },
          ),
        );
        return;
      }
      try {
        if (!options.session && captureStdout && prepared.outputFile && stdout) {
          writeFileSync(prepared.outputFile, stdout, { encoding: "utf-8" });
        }
      } catch (error) {
        reject(new AgentCallError(asError(error), timing(), { stdout, stderr, timedOut }));
        return;
      }
      const structuredSessionResult = options.session
        ? parseAdapterStructuredSessionResult(agent.adapter, { exitCode: code ?? 1, stdout, stderr, timedOut })
        : undefined;
      resolve({
        exitCode: code ?? 1,
        timing: timing(),
        stdout,
        stderr,
        timedOut,
        ...(structuredSessionResult ? { structuredSessionResult } : {}),
      });
    });
  });
}

function normalizeAgent(
  id: string,
  payload: Record<string, unknown>,
  source?: ConfigSourceRef,
): AgentConfig {
  const adapter = normalizeRuntimeAdapterId(optionalString(payload, "adapter") ?? "command");
  const defaults = adapterDefaults(adapter);
  return {
    id,
    label: optionalString(payload, "label") ?? defaults.label,
    adapter,
    command: optionalString(payload, "command") ?? defaults.command,
    args: stringList(payload, "args", defaults.args),
    env: stringList(payload, "env"),
    capabilities: stringList(payload, "capabilities"),
    model: optionalString(payload, "model"),
    reasoning_effort: optionalString(payload, "reasoning_effort"),
    timeout_seconds: optionalInteger(payload, "timeout_seconds"),
    prompt_file_arg: optionalString(payload, "prompt_file_arg"),
    prompt_arg: optionalString(payload, "prompt_arg"),
    output_file_arg: optionalString(payload, "output_file_arg"),
    stdin: payload.stdin === true,
    disabled: payload.disabled === true,
    source_layer: source?.source,
    source_path: source?.path,
  };
}

function upsertTomlTableField(
  content: string,
  tablePath: string,
  field: string,
  value: string,
): string | undefined {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.endsWith("\n")
    ? content.split(/\r?\n/).slice(0, -1)
    : content.split(/\r?\n/);
  const tableHeader = new RegExp(
    `^\\s*\\[\\s*${escapeRegExp(tablePath)}\\s*\\]\\s*(?:#.*)?$`,
  );
  const anyTableHeader = /^\s*\[[^\]]+\]\s*(?:#.*)?$/;
  const start = lines.findIndex((line) => tableHeader.test(line));
  if (start === -1) {
    return undefined;
  }
  let end = start + 1;
  while (end < lines.length && !anyTableHeader.test(lines[end])) {
    end += 1;
  }
  const fieldLine = new RegExp(`^(\\s*)${escapeRegExp(field)}\\s*=.*$`);
  for (let index = start + 1; index < end; index += 1) {
    const match = lines[index].match(fieldLine);
    if (match) {
      const updated = [...lines];
      updated[index] = `${match[1]}${field} = ${value}`;
      return `${updated.join(newline)}${newline}`;
    }
  }
  const updated = [...lines.slice(0, end), `${field} = ${value}`, ...lines.slice(end)];
  return `${updated.join(newline)}${newline}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function adapterDefaults(adapter: string): BuiltinAdapter {
  return builtinAdapterFromMetadata(lookupRuntimeAdapter(adapter));
}

function builtinAdapterFromMetadata(adapter: RuntimeAdapterMetadata): BuiltinAdapter {
  return {
    name: adapter.id,
    description: adapter.description,
    command: adapter.command,
    args: [...adapter.args],
    label: adapter.label,
  };
}

function optionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalInteger(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return Number.isInteger(value) ? value as number : undefined;
}

function stringList(
  payload: Record<string, unknown>,
  key: string,
  fallback: string[] = [],
): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function resolveInvokableAgent(agent: AgentConfig, workspace: string): AgentConfig {
  if (lookupRuntimeAdapter(agent.adapter).id === "command") {
    return agent;
  }
  const toolResolution = resolveProviderTool(agent, {
    enabled: true,
    workspace,
  });
  if (!toolResolution.ok || !toolResolution.path) {
    return agent;
  }
  return {
    ...agent,
    command: toolResolution.path,
  };
}

function timeoutSecsToMs(timeoutSecs: number | undefined): number | undefined {
  return timeoutSecs === undefined ? undefined : Math.max(0, timeoutSecs * 1000);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
