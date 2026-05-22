import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  configPathForScope,
  loadConfigWithSources,
  parseAgentmeshToml,
  tomlArray,
  type AgentmeshConfig,
  type CapabilityProfilePreferenceConfig,
  type ConfigSourceRef,
  type DefaultStageAgentsConfig,
  type ExecutionPolicyConfig,
  type FallbackConfig,
  type ModelAliasConfig,
  type RunDefaultsConfig,
} from "@agentmesh/runtime/src/config.js";

export interface StudioAdvancedSettingsOptions {
  cwd?: string;
  configPath?: string;
}

export interface StudioAdvancedSettingsConfig {
  default_stage_agents: DefaultStageAgentsConfig;
  fallback: FallbackConfig;
  run_defaults: RunDefaultsConfig;
  execution_policy: ExecutionPolicyConfig;
  model_aliases: Record<string, ModelAliasConfig>;
  capability_profile_preferences: Record<string, CapabilityProfilePreferenceConfig>;
}

export interface StudioAdvancedSettingsPayload {
  user_config_path: string;
  layers: ConfigSourceRef[];
  user: StudioAdvancedSettingsConfig;
  resolved: StudioAdvancedSettingsConfig;
  diagnostics: Array<{ target: "advanced"; message: string }>;
}

export interface StudioAdvancedSettingsUpdateRequest {
  default_stage_agents?: {
    agents?: string[] | null;
    stage_types?: Partial<Record<string, { agents?: string[] | null } | null>>;
  };
  fallback?: {
    agents?: string[] | null;
    max_attempts_per_agent?: number | null;
    timeout_seconds?: number | null;
  };
  run_defaults?: {
    dispatch_timeout_secs?: number | null;
    adapter_timeout_secs?: number | null;
    event_page_size?: number | null;
    retry_attempts?: number | null;
  };
  execution_policy?: {
    max_fanout_concurrency?: number | null;
    max_dispatch_timeout_secs?: number | null;
    max_adapter_timeout_secs?: number | null;
    max_retry_attempts?: number | null;
    require_user_gate?: boolean | null;
    allow_auto_dispatch?: boolean | null;
  };
}

const ADVANCED_SECTION_NAMES = [
  "default_stage_agents",
  "fallback",
  "run_defaults",
  "execution_policy",
] as const;
const STAGE_TYPES = ["plan", "execute", "verify", "review", "decide"] as const;
type StudioStageType = typeof STAGE_TYPES[number];

export function readStudioAdvancedSettings(
  options: StudioAdvancedSettingsOptions = {},
): StudioAdvancedSettingsPayload {
  const cwd = options.cwd ?? process.cwd();
  const userConfigPath = configPathForScope("user", cwd);
  const userConfig = loadConfigFileOrEmpty(userConfigPath);
  const diagnostics: StudioAdvancedSettingsPayload["diagnostics"] = [];
  let resolvedConfig: AgentmeshConfig;
  let layers: ConfigSourceRef[] = [];
  try {
    const loaded = loadConfigWithSources(options.configPath, cwd);
    resolvedConfig = loaded.config;
    layers = loaded.layers;
  } catch (error) {
    const message = errorMessage(error);
    resolvedConfig = emptyConfig(userConfigPath);
    if (!message.startsWith("no config found; searched:")) {
      diagnostics.push({ target: "advanced", message });
    }
  }
  return {
    user_config_path: userConfigPath,
    layers,
    user: advancedSettingsConfig(userConfig),
    resolved: advancedSettingsConfig(resolvedConfig),
    diagnostics,
  };
}

export function updateStudioAdvancedSettings(
  request: StudioAdvancedSettingsUpdateRequest,
  options: StudioAdvancedSettingsOptions = {},
): StudioAdvancedSettingsPayload {
  const cwd = options.cwd ?? process.cwd();
  const userConfigPath = configPathForScope("user", cwd);
  const existed = existsSync(userConfigPath);
  const previousContent = existed
    ? readFileSync(userConfigPath, { encoding: "utf-8" })
    : "schema_version = 1\n";
  const nextConfig = loadConfigFromContent(previousContent, userConfigPath);
  applyAdvancedSettingsUpdate(nextConfig, request);
  const nextContent = replaceAdvancedSections(previousContent, nextConfig);
  mkdirSync(path.dirname(userConfigPath), { recursive: true });
  writeFileSync(userConfigPath, nextContent, { encoding: "utf-8" });
  try {
    loadConfigWithSources(options.configPath, cwd);
    return readStudioAdvancedSettings(options);
  } catch (error) {
    if (existed) {
      writeFileSync(userConfigPath, previousContent, { encoding: "utf-8" });
    } else {
      rmSync(userConfigPath, { force: true });
    }
    throw error;
  }
}

function applyAdvancedSettingsUpdate(
  config: AgentmeshConfig,
  request: StudioAdvancedSettingsUpdateRequest,
): void {
  if (request.default_stage_agents) {
    applyAgentListField(
      config.default_stage_agents,
      "agents",
      request.default_stage_agents.agents,
      "default_stage_agents.agents",
    );
    applyDefaultStageTypeUpdates(
      config.default_stage_agents,
      request.default_stage_agents.stage_types,
    );
  }
  if (request.fallback) {
    applyAgentListField(config.fallback, "agents", request.fallback.agents, "fallback.agents");
    applyNumberField(config.fallback, "max_attempts_per_agent", request.fallback.max_attempts_per_agent);
    applyNumberField(config.fallback, "timeout_seconds", request.fallback.timeout_seconds);
  }
  if (request.run_defaults) {
    applyNumberField(config.run_defaults, "dispatch_timeout_secs", request.run_defaults.dispatch_timeout_secs);
    applyNumberField(config.run_defaults, "adapter_timeout_secs", request.run_defaults.adapter_timeout_secs);
    applyNumberField(config.run_defaults, "event_page_size", request.run_defaults.event_page_size);
    applyNumberField(config.run_defaults, "retry_attempts", request.run_defaults.retry_attempts);
  }
  if (request.execution_policy) {
    applyNumberField(config.execution_policy, "max_fanout_concurrency", request.execution_policy.max_fanout_concurrency);
    applyNumberField(config.execution_policy, "max_dispatch_timeout_secs", request.execution_policy.max_dispatch_timeout_secs);
    applyNumberField(config.execution_policy, "max_adapter_timeout_secs", request.execution_policy.max_adapter_timeout_secs);
    applyNumberField(config.execution_policy, "max_retry_attempts", request.execution_policy.max_retry_attempts);
    applyBooleanField(config.execution_policy, "require_user_gate", request.execution_policy.require_user_gate);
    applyBooleanField(config.execution_policy, "allow_auto_dispatch", request.execution_policy.allow_auto_dispatch);
  }
}

function applyDefaultStageTypeUpdates(
  target: DefaultStageAgentsConfig,
  updates: Partial<Record<string, { agents?: string[] | null } | null>> | undefined,
): void {
  if (updates === undefined) {
    return;
  }
  if (!isRecord(updates)) {
    throw new Error("default_stage_agents.stage_types must be a table");
  }
  for (const [stage, update] of Object.entries(updates)) {
    if (!isStudioStageType(stage)) {
      throw new Error(`default_stage_agents.stage_types.${stage} is not a supported stage type`);
    }
    if (update === null) {
      delete target.stage_types[stage];
      continue;
    }
    if (!isRecord(update)) {
      throw new Error(`default_stage_agents.stage_types.${stage} must be a table`);
    }
    if (!("agents" in update)) {
      continue;
    }
    const agentsValue = (update as { agents?: string[] | null }).agents;
    const agents = normalizeStringList(
      agentsValue ?? null,
      `default_stage_agents.stage_types.${stage}.agents`,
    );
    if (agents.length === 0) {
      delete target.stage_types[stage];
      continue;
    }
    target.stage_types[stage] = { agents };
  }
}

function isStudioStageType(value: string): value is StudioStageType {
  return (STAGE_TYPES as readonly string[]).includes(value);
}

function applyAgentListField<T extends { agents?: string[] }>(
  target: T,
  key: "agents",
  value: string[] | null | undefined,
  label: string,
): void {
  if (value === undefined) {
    return;
  }
  const agents = normalizeStringList(value, label);
  if (agents.length === 0) {
    delete target[key];
    return;
  }
  target[key] = agents;
}

function applyNumberField(
  target: object,
  key: string,
  value: number | null | undefined,
): void {
  const record = target as Record<string, unknown>;
  if (value === undefined) {
    return;
  }
  if (value === null) {
    delete record[key];
    return;
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  record[key] = value;
}

function applyBooleanField(
  target: object,
  key: string,
  value: boolean | null | undefined,
): void {
  const record = target as Record<string, unknown>;
  if (value === undefined) {
    return;
  }
  if (value === null) {
    delete record[key];
    return;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  record[key] = value;
}

function normalizeStringList(value: string[] | null, label: string): string[] {
  if (value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a list of strings`);
  }
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`${label} must be a list of strings`);
    }
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

function advancedSettingsConfig(config: AgentmeshConfig): StudioAdvancedSettingsConfig {
  return {
    default_stage_agents: {
      ...(config.default_stage_agents.agents ? { agents: [...config.default_stage_agents.agents] } : {}),
      stage_types: Object.fromEntries(
        Object.entries(config.default_stage_agents.stage_types).map(([stage, value]) => [
          stage,
          { agents: [...(value?.agents ?? [])] },
        ]),
      ),
    },
    fallback: {
      ...(config.fallback.agents ? { agents: [...config.fallback.agents] } : {}),
      ...(config.fallback.max_attempts_per_agent !== undefined
        ? { max_attempts_per_agent: config.fallback.max_attempts_per_agent }
        : {}),
      ...(config.fallback.timeout_seconds !== undefined
        ? { timeout_seconds: config.fallback.timeout_seconds }
        : {}),
      stage_types: Object.fromEntries(
        Object.entries(config.fallback.stage_types).map(([stage, value]) => [
          stage,
          {
            ...(value?.agents ? { agents: [...value.agents] } : {}),
            ...(value?.inherit_common !== undefined ? { inherit_common: value.inherit_common } : {}),
            ...(value?.max_attempts_per_agent !== undefined
              ? { max_attempts_per_agent: value.max_attempts_per_agent }
              : {}),
            ...(value?.timeout_seconds !== undefined ? { timeout_seconds: value.timeout_seconds } : {}),
          },
        ]),
      ),
    },
    run_defaults: { ...config.run_defaults },
    execution_policy: { ...config.execution_policy },
    model_aliases: cloneRecord(config.model_aliases),
    capability_profile_preferences: cloneRecord(config.capability_profile_preferences),
  };
}

function replaceAdvancedSections(content: string, config: AgentmeshConfig): string {
  let next = ensureSchemaVersion(content);
  for (const section of ADVANCED_SECTION_NAMES) {
    next = removeTomlSectionTree(next, section);
  }
  const sections = [
    renderDefaultStageAgents(config.default_stage_agents),
    renderFallback(config.fallback),
    renderRunDefaults(config.run_defaults),
    renderExecutionPolicy(config.execution_policy),
  ].filter((section) => section.length > 0);
  const base = next.trimEnd();
  if (sections.length === 0) {
    return `${base}\n`;
  }
  return `${base}\n\n${sections.join("\n\n")}\n`;
}

function renderDefaultStageAgents(config: DefaultStageAgentsConfig): string {
  const stageEntries = Object.entries(config.stage_types).filter(([, value]) => value !== undefined);
  if (config.agents === undefined && stageEntries.length === 0) {
    return "";
  }
  const lines = ["[default_stage_agents]"];
  if (config.agents !== undefined) {
    lines.push(`agents = ${tomlArray(config.agents)}`);
  }
  for (const [stage, value] of stageEntries) {
    lines.push("", `[default_stage_agents.stage_types.${stage}]`, `agents = ${tomlArray(value?.agents ?? [])}`);
  }
  return lines.join("\n");
}

function renderFallback(config: FallbackConfig): string {
  const stageEntries = Object.entries(config.stage_types).filter(([, value]) => value !== undefined);
  if (
    config.agents === undefined &&
    config.max_attempts_per_agent === undefined &&
    config.timeout_seconds === undefined &&
    stageEntries.length === 0
  ) {
    return "";
  }
  const lines = ["[fallback]"];
  if (config.agents !== undefined) {
    lines.push(`agents = ${tomlArray(config.agents)}`);
  }
  if (config.max_attempts_per_agent !== undefined) {
    lines.push(`max_attempts_per_agent = ${config.max_attempts_per_agent}`);
  }
  if (config.timeout_seconds !== undefined) {
    lines.push(`timeout_seconds = ${config.timeout_seconds}`);
  }
  for (const [stage, value] of stageEntries) {
    lines.push("", `[fallback.stage_types.${stage}]`);
    if (value?.agents !== undefined) {
      lines.push(`agents = ${tomlArray(value.agents)}`);
    }
    if (value?.inherit_common !== undefined) {
      lines.push(`inherit_common = ${value.inherit_common ? "true" : "false"}`);
    }
    if (value?.max_attempts_per_agent !== undefined) {
      lines.push(`max_attempts_per_agent = ${value.max_attempts_per_agent}`);
    }
    if (value?.timeout_seconds !== undefined) {
      lines.push(`timeout_seconds = ${value.timeout_seconds}`);
    }
  }
  return lines.join("\n");
}

function renderRunDefaults(config: RunDefaultsConfig): string {
  const lines = renderNumberTable("[run_defaults]", config, [
    "dispatch_timeout_secs",
    "adapter_timeout_secs",
    "event_page_size",
    "retry_attempts",
  ]);
  return lines.join("\n");
}

function renderExecutionPolicy(config: ExecutionPolicyConfig): string {
  const record = config as Record<string, unknown>;
  const lines = ["[execution_policy]"];
  for (const key of [
    "max_fanout_concurrency",
    "max_dispatch_timeout_secs",
    "max_adapter_timeout_secs",
    "max_retry_attempts",
  ]) {
    const value = record[key];
    if (typeof value === "number") {
      lines.push(`${key} = ${value}`);
    }
  }
  if (config.require_user_gate !== undefined) {
    lines.push(`require_user_gate = ${config.require_user_gate ? "true" : "false"}`);
  }
  if (config.allow_auto_dispatch !== undefined) {
    lines.push(`allow_auto_dispatch = ${config.allow_auto_dispatch ? "true" : "false"}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

function renderNumberTable(
  header: string,
  config: object,
  keys: string[],
): string[] {
  const record = config as Record<string, unknown>;
  const lines = [header];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") {
      lines.push(`${key} = ${value}`);
    }
  }
  return lines.length > 1 ? lines : [];
}

function removeTomlSectionTree(content: string, section: string): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.endsWith("\n")
    ? content.split(/\r?\n/).slice(0, -1)
    : content.split(/\r?\n/);
  const tableHeader = /^\s*\[\s*([^\]]+)\s*\]\s*(?:#.*)?$/;
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const tablePath = tablePathFromLine(lines[index], tableHeader);
    if (!tablePath || (tablePath !== section && !tablePath.startsWith(`${section}.`))) {
      continue;
    }
    let end = index + 1;
    while (end < lines.length && !tableHeader.test(lines[end])) {
      end += 1;
    }
    const start = index > 0 && lines[index - 1].trim() === "" ? index - 1 : index;
    ranges.push([start, end]);
  }
  let nextLines = lines;
  for (const [start, end] of ranges.reverse()) {
    nextLines = [...nextLines.slice(0, start), ...nextLines.slice(end)];
  }
  return nextLines.length ? `${nextLines.join(newline)}${newline}` : "";
}

function tablePathFromLine(line: string, tableHeader: RegExp): string | undefined {
  const match = line.match(tableHeader);
  return match ? match[1].replace(/\s+/g, "") : undefined;
}

function ensureSchemaVersion(content: string): string {
  return /^\s*schema_version\s*=/.test(content) ? content : `schema_version = 1\n${content}`;
}

function loadConfigFileOrEmpty(configPath: string): AgentmeshConfig {
  return existsSync(configPath)
    ? loadConfigFromContent(readFileSync(configPath, { encoding: "utf-8" }), configPath)
    : emptyConfig(configPath);
}

function loadConfigFromContent(content: string, label: string): AgentmeshConfig {
  return parseAgentmeshToml(ensureSchemaVersion(content), label);
}

function emptyConfig(label: string): AgentmeshConfig {
  return parseAgentmeshToml("schema_version = 1\n", label);
}

function cloneRecord<T>(value: Record<string, T>): Record<string, T> {
  return JSON.parse(JSON.stringify(value)) as Record<string, T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
