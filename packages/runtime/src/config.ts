import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  MAX_FALLBACK_AGENTS,
  MAX_FALLBACK_ATTEMPTS_PER_AGENT,
  MAX_FANOUT_AGENTS,
  MAX_INVOCATION_TIMEOUT_SECONDS,
  MIN_INVOCATION_TIMEOUT_SECONDS,
  StageTypeSchema,
  type StageType,
} from "@agentmesh/core";
import { isValidMcpServerId } from "./mcp/resource.js";
import { parseTomlDocument, stringifyTomlInlineValue } from "./toml.js";

const SAFE_AGENT_TOKEN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

export interface AgentmeshConfig {
  schema_version: number;
  agents: Record<string, Record<string, unknown>>;
  mcp_servers: Record<string, Record<string, unknown>>;
  workflow_defaults: Record<string, Record<string, unknown>>;
  default_stage_agents: DefaultStageAgentsConfig;
  fallback: FallbackConfig;
  context_policy: ContextPolicyConfig;
  review_policy: Record<string, ReviewPolicyConfig>;
  release_policy: Record<string, ReleasePolicyConfig>;
  run_defaults: RunDefaultsConfig;
  execution_policy: ExecutionPolicyConfig;
  model_aliases: Record<string, ModelAliasConfig>;
  capability_profiles: Record<string, CapabilityProfileConfig>;
  capability_profile_preferences: Record<string, CapabilityProfilePreferenceConfig>;
}

export interface ContextPolicyConfig {
  max_bytes?: number;
  max_files?: number;
  freshness_max_age_seconds?: number;
  required_sources: string[];
  denied_paths: string[];
  redact_patterns: string[];
}

export interface ReviewPolicyConfig {
  required_review_profiles: string[];
}

export interface ReleasePolicyConfig {
  required_evidence: string[];
  needs_decision_risks: string[];
}

export interface RunDefaultsConfig {
  dispatch_timeout_secs?: number;
  adapter_timeout_secs?: number;
  event_page_size?: number;
  retry_attempts?: number;
}

export interface ExecutionPolicyConfig {
  max_fanout_concurrency?: number;
  max_dispatch_timeout_secs?: number;
  max_adapter_timeout_secs?: number;
  max_retry_attempts?: number;
  require_user_gate?: boolean;
  allow_auto_dispatch?: boolean;
}

export interface DefaultStageAgentsConfig {
  agents?: string[];
  stage_types: Partial<Record<StageType, StageAgentListConfig>>;
}

export interface StageAgentListConfig {
  agents: string[];
}

export interface FallbackConfig {
  agents?: string[];
  max_attempts_per_agent?: number;
  timeout_seconds?: number;
  stage_types: Partial<Record<StageType, FallbackStageTypeConfig>>;
}

export interface FallbackStageTypeConfig {
  agents?: string[];
  inherit_common?: boolean;
  max_attempts_per_agent?: number;
  timeout_seconds?: number;
}

export interface ModelAliasConfig {
  adapter: string;
  model: string;
}

export interface CapabilityProfileConfig {
  stage: string;
  required_capabilities: string[];
  min_count: number;
}

export interface CapabilityProfilePreferenceConfig {
  agents: string[];
}

export type ConfigLayerKind = "user" | "project" | "explicit";
export type ConfigWriteScope = "user" | "project";

interface ConfigLayerCandidate {
  kind: ConfigLayerKind;
  path: string;
}

export interface ConfigSourceRef {
  source: ConfigLayerKind;
  path: string;
}

export interface McpServerRegistrationInput {
  serverId: string;
  command: string;
  args?: string[];
  resourceHints?: string[];
}

export interface LoadedAgentmeshConfig {
  config: AgentmeshConfig;
  layers: ConfigSourceRef[];
  agentSources: Record<string, ConfigSourceRef>;
  mcpServerSources: Record<string, ConfigSourceRef>;
  reviewPolicySources: Record<string, ConfigSourceRef[]>;
  releasePolicySources: Record<string, ConfigSourceRef[]>;
  runDefaultsSources: ConfigSourceRef[];
  executionPolicySources: ConfigSourceRef[];
}

export interface ConfigProvenance {
  schema_version: 1;
  resolved_at: string;
  layers: Array<ConfigSourceRef & { sha256: string }>;
}

export function findConfigPath(explicitPath?: string, cwd = process.cwd()): string {
  const candidates = configCandidates(explicitPath, cwd);
  for (const candidate of candidates) {
    if (isFile(candidate)) {
      return candidate;
    }
  }
  throw new Error(`no config found; searched: ${candidates.join(", ")}`);
}

export function configPathForAgentWrite(
  _cwd = process.cwd(),
): string {
  return userConfigPath();
}

export function configPathForMcpWrite(
  _cwd = process.cwd(),
): string {
  return userConfigPath();
}

export function configPathForScope(
  scope: ConfigWriteScope = "user",
  cwd = process.cwd(),
): string {
  if (scope === "user") {
    return userConfigPath();
  }
  return path.resolve(cwd, ".agentmesh", "config.toml");
}

export function loadConfig(configPath?: string, cwd = process.cwd()): AgentmeshConfig {
  return loadConfigWithSources(configPath, cwd).config;
}

export function loadConfigWithSources(
  configPath?: string,
  cwd = process.cwd(),
): LoadedAgentmeshConfig {
  const candidates = configLayerCandidates(configPath, cwd);
  const existingLayers = candidates.filter((candidate) => isFile(candidate.path));
  if (existingLayers.length === 0) {
    throw new Error(`no config found; searched: ${candidates.map((candidate) => candidate.path).join(", ")}`);
  }
  const merged = emptyConfig();
  const agentSources: Record<string, ConfigSourceRef> = {};
  const mcpServerSources: Record<string, ConfigSourceRef> = {};
  const reviewPolicySources: Record<string, ConfigSourceRef[]> = {};
  const releasePolicySources: Record<string, ConfigSourceRef[]> = {};
  const runDefaultsSources: ConfigSourceRef[] = [];
  const executionPolicySources: ConfigSourceRef[] = [];
  for (const layer of existingLayers) {
    const config = parseAgentmeshToml(readFileSync(layer.path, { encoding: "utf-8" }), layer.path);
    if (config.schema_version !== 1) {
      throw new Error("config schema_version must be 1");
    }
    mergeConfigLayer(merged, config, layer, {
      agentSources,
      mcpServerSources,
      reviewPolicySources,
      releasePolicySources,
      runDefaultsSources,
      executionPolicySources,
    });
  }
  validateMcpServers(merged);
  validateContextPolicy(merged.context_policy);
  validateReviewPolicies(merged.review_policy);
  validateReleasePolicies(merged.release_policy);
  validateRunDefaults(merged.run_defaults);
  validateExecutionPolicy(merged.execution_policy);
  validateAgents(merged.agents);
  validateWorkflowDefaults(merged);
  validateDefaultStageAgents(merged);
  validateFallback(merged);
  return {
    config: merged,
    layers: existingLayers.map((layer) => ({
      source: layer.kind,
      path: layer.path,
    })),
    agentSources,
    mcpServerSources,
    reviewPolicySources,
    releasePolicySources,
    runDefaultsSources,
    executionPolicySources,
  };
}

export function configProvenanceForRun(
  loaded: LoadedAgentmeshConfig | undefined,
  resolvedAt: string,
): ConfigProvenance | undefined {
  if (!loaded) {
    return undefined;
  }
  return {
    schema_version: 1,
    resolved_at: resolvedAt,
    layers: loaded.layers.map((layer) => ({
      ...layer,
      sha256: `sha256:${createHash("sha256").update(readFileSync(layer.path)).digest("hex")}`,
    })),
  };
}

export function parseAgentmeshToml(content: string, label: string): AgentmeshConfig {
  const config = emptyConfig();
  const payload = parseTomlDocument(content, label, "invalid agentmesh TOML");
  for (const [key, value] of Object.entries(payload)) {
    if (key === "schema_version") {
      if (typeof value !== "number") {
        throw new Error(`invalid agentmesh TOML ${label}: schema_version must be a number`);
      }
      config.schema_version = value;
      continue;
    }
    if (key === "agents" || key === "mcp_servers" || key === "workflow_defaults") {
      config[key] = configSectionMap(value, key, label);
      continue;
    }
    if (key === "default_stage_agents") {
      config.default_stage_agents = defaultStageAgentsTable(value, label);
      continue;
    }
    if (key === "fallback") {
      config.fallback = fallbackTable(value, label);
      continue;
    }
    if (key === "context_policy") {
      config.context_policy = contextPolicyTable(value, label);
      continue;
    }
    if (key === "review_policy") {
      config.review_policy = reviewPolicyMap(value, label);
      continue;
    }
    if (key === "release_policy") {
      config.release_policy = releasePolicyMap(value, label);
      continue;
    }
    if (key === "run_defaults") {
      config.run_defaults = runDefaultsTable(value, label);
      continue;
    }
    if (key === "execution_policy") {
      config.execution_policy = executionPolicyTable(value, label);
      continue;
    }
    if (key === "model_aliases") {
      config.model_aliases = modelAliasMap(value, label);
      continue;
    }
    if (key === "capability_profiles") {
      config.capability_profiles = capabilityProfileMap(value, label);
      continue;
    }
    if (key === "capability_profile_preferences") {
      config.capability_profile_preferences = capabilityProfilePreferenceMap(value, label);
      continue;
    }
    throw new Error(`invalid agentmesh TOML ${label}: unsupported section or key: ${key}`);
  }
  return config;
}

export function tomlString(value: string): string {
  return stringifyTomlInlineValue(value);
}

export function tomlArray(values: string[]): string {
  return stringifyTomlInlineValue(values);
}

export function appendMcpServerRegistration(
  configPath: string,
  input: McpServerRegistrationInput,
): void {
  if (!isValidMcpServerId(input.serverId)) {
    throw new Error(
      `mcp server id must contain only letters, numbers, dot, underscore, and dash: ${input.serverId}`,
    );
  }
  if (!input.command.trim()) {
    throw new Error("mcp server command is required");
  }
  const args = input.args ?? [];
  const resourceHints = input.resourceHints ?? [];
  if (!args.every((item) => typeof item === "string")) {
    throw new Error("mcp server args must be a list of strings");
  }
  if (!resourceHints.every((item) => typeof item === "string")) {
    throw new Error("mcp server resource hints must be a list of strings");
  }
  mkdirSync(path.dirname(configPath), { recursive: true });
  if (!existsSync(configPath)) {
    writeFileSync(configPath, "schema_version = 1\n", { encoding: "utf-8" });
  }
  const content = readFileSync(configPath, { encoding: "utf-8" });
  const config = parseAgentmeshToml(content, configPath);
  if (Object.hasOwn(config.mcp_servers, input.serverId)) {
    throw new Error(`mcp server id already exists in target config: ${input.serverId}`);
  }
  appendFileSync(
    configPath,
    [
      "",
      `[mcp_servers.${tomlKey(input.serverId)}]`,
      `command = ${tomlString(input.command.trim())}`,
      `args = ${tomlArray(args)}`,
      `resource_hints = ${tomlArray(resourceHints)}`,
      "",
    ].join("\n"),
    { encoding: "utf-8" },
  );
}

export function removeMcpServerRegistration(configPath: string, serverId: string): void {
  if (!existsSync(configPath)) {
    throw new Error(`mcp server not found: ${serverId}`);
  }
  const content = readFileSync(configPath, { encoding: "utf-8" });
  const config = parseAgentmeshToml(content, configPath);
  if (!Object.hasOwn(config.mcp_servers, serverId)) {
    throw new Error(`mcp server not found: ${serverId}`);
  }
  const updated = removeTomlTable(content, `mcp_servers.${tomlKey(serverId)}`);
  if (updated === undefined) {
    throw new Error(`mcp server table not found in config: ${serverId}`);
  }
  writeFileSync(configPath, updated, { encoding: "utf-8" });
}

export function removeTomlTable(content: string, tablePath: string): string | undefined {
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
  const removeStart = start > 0 && lines[start - 1].trim() === "" ? start - 1 : start;
  const updatedLines = [...lines.slice(0, removeStart), ...lines.slice(end)];
  return updatedLines.length ? `${updatedLines.join(newline)}${newline}` : "";
}

function configCandidates(explicitPath: string | undefined, cwd: string): string[] {
  const candidates: string[] = [];
  if (explicitPath) {
    candidates.push(resolveConfigPath(explicitPath, cwd));
  }
  const envConfig = process.env.AGENTMESH_CONFIG;
  if (envConfig) {
    candidates.push(resolveConfigPath(envConfig, cwd));
  }
  candidates.push(...projectConfigCandidates(cwd), userConfigPath());
  return [...new Set(candidates)];
}

function configLayerCandidates(
  explicitPath: string | undefined,
  cwd: string,
): ConfigLayerCandidate[] {
  const candidates: ConfigLayerCandidate[] = [
    { kind: "user", path: userConfigPath() },
    ...projectConfigCandidates(cwd).map((candidate) => ({
      kind: "project" as const,
      path: candidate,
    })),
  ];
  const overlayPath = explicitPath ?? process.env.AGENTMESH_CONFIG;
  if (overlayPath) {
    candidates.push({ kind: "explicit", path: resolveConfigPath(overlayPath, cwd) });
  }
  return dedupeLayerCandidates(candidates);
}

function projectConfigCandidates(cwd: string): string[] {
  return [
    path.resolve(cwd, ".agentmesh", "config.toml"),
    path.resolve(cwd, "agentmesh.toml"),
  ];
}

function userConfigPath(): string {
  return path.join(os.homedir(), ".config", "agentmesh", "config.toml");
}

function dedupeLayerCandidates(candidates: ConfigLayerCandidate[]): ConfigLayerCandidate[] {
  const indexByPath = new Map<string, number>();
  const deduped: ConfigLayerCandidate[] = [];
  for (const candidate of candidates) {
    const key = canonicalConfigPath(candidate.path);
    const existingIndex = indexByPath.get(key);
    if (existingIndex === undefined) {
      indexByPath.set(key, deduped.length);
      deduped.push(candidate);
    } else {
      deduped[existingIndex] = candidate;
    }
  }
  return deduped;
}

function emptyConfig(): AgentmeshConfig {
  return {
    schema_version: 1,
    agents: {},
    mcp_servers: {},
    workflow_defaults: {},
    default_stage_agents: emptyDefaultStageAgents(),
    fallback: emptyFallback(),
    context_policy: emptyContextPolicy(),
    review_policy: {},
    release_policy: {},
    run_defaults: {},
    execution_policy: {},
    model_aliases: {},
    capability_profiles: {},
    capability_profile_preferences: {},
  };
}

function mergeConfigLayer(
  merged: AgentmeshConfig,
  layerConfig: AgentmeshConfig,
  layer: ConfigLayerCandidate,
  sources: {
    agentSources: Record<string, ConfigSourceRef>;
    mcpServerSources: Record<string, ConfigSourceRef>;
    reviewPolicySources: Record<string, ConfigSourceRef[]>;
    releasePolicySources: Record<string, ConfigSourceRef[]>;
    runDefaultsSources: ConfigSourceRef[];
    executionPolicySources: ConfigSourceRef[];
  },
): void {
  if (layer.kind === "user" && Object.keys(layerConfig.review_policy).length > 0) {
    throw new Error("review_policy is project-scoped and cannot be set in user config");
  }
  if (layer.kind === "user" && Object.keys(layerConfig.release_policy).length > 0) {
    throw new Error("release_policy is project-scoped and cannot be set in user config");
  }
  validateLayerScopedSections(layer, layerConfig);
  mergeSection(merged.agents, layerConfig.agents, "agents", layer, sources.agentSources);
  mergeSection(
    merged.mcp_servers,
    layerConfig.mcp_servers,
    "mcp_servers",
    layer,
    sources.mcpServerSources,
  );
  mergeWorkflowDefaults(merged.workflow_defaults, layerConfig.workflow_defaults);
  mergeDefaultStageAgents(merged.default_stage_agents, layerConfig.default_stage_agents);
  mergeFallback(merged.fallback, layerConfig.fallback);
  validateContextPolicy(layerConfig.context_policy);
  mergeContextPolicy(merged.context_policy, layerConfig.context_policy);
  validateReviewPolicies(layerConfig.review_policy);
  validateReleasePolicies(layerConfig.release_policy);
  validateRunDefaults(layerConfig.run_defaults);
  validateExecutionPolicy(layerConfig.execution_policy);
  validateModelAliases(layerConfig.model_aliases);
  validateCapabilityProfiles(layerConfig.capability_profiles);
  validateCapabilityProfilePreferences(layerConfig.capability_profile_preferences);
  mergeReviewPolicies(
    merged.review_policy,
    layerConfig.review_policy,
    layer,
    sources.reviewPolicySources,
  );
  mergeReleasePolicies(
    merged.release_policy,
    layerConfig.release_policy,
    layer,
    sources.releasePolicySources,
  );
  mergeRunDefaults(merged.run_defaults, layerConfig.run_defaults, layer, sources.runDefaultsSources);
  mergeExecutionPolicy(
    merged.execution_policy,
    layerConfig.execution_policy,
    layer,
    sources.executionPolicySources,
  );
  mergeUniqueMap(merged.model_aliases, layerConfig.model_aliases, "model_aliases", layer);
  mergeUniqueMap(
    merged.capability_profiles,
    layerConfig.capability_profiles,
    "capability_profiles",
    layer,
  );
  mergePreferenceMap(
    merged.capability_profile_preferences,
    layerConfig.capability_profile_preferences,
  );
}

function validateLayerScopedSections(
  layer: ConfigLayerCandidate,
  config: AgentmeshConfig,
): void {
  if (layer.kind === "explicit") {
    return;
  }
  if (layer.kind === "project" && Object.keys(config.model_aliases).length > 0) {
    throw new Error("model_aliases is user-scoped and cannot be set in project config");
  }
  if (layer.kind === "project" && Object.keys(config.agents).length > 0) {
    throw new Error("agents are user-scoped and cannot be set in project config");
  }
  if (layer.kind === "project" && Object.keys(config.mcp_servers).length > 0) {
    throw new Error("mcp_servers are user-scoped and cannot be set in project config");
  }
  if (
    layer.kind === "project" &&
    Object.keys(config.capability_profile_preferences).length > 0
  ) {
    throw new Error(
      "capability_profile_preferences is user-scoped and cannot be set in project config",
    );
  }
  if (layer.kind === "user" && Object.keys(config.capability_profiles).length > 0) {
    throw new Error("capability_profiles is project-scoped and cannot be set in user config");
  }
}

function mergeSection(
  target: Record<string, Record<string, unknown>>,
  source: Record<string, Record<string, unknown>>,
  section: "agents" | "mcp_servers",
  layer: ConfigLayerCandidate,
  sourceRefs: Record<string, ConfigSourceRef>,
): void {
  for (const [id, value] of Object.entries(source)) {
    if (target[id]) {
      throw new Error(
        `duplicate ${section} id across config layers: ${id} (${layer.kind}: ${layer.path})`,
      );
    }
    target[id] = { ...value };
    sourceRefs[id] = { source: layer.kind, path: layer.path };
  }
}

function mergeWorkflowDefaults(
  target: Record<string, Record<string, unknown>>,
  source: Record<string, Record<string, unknown>>,
): void {
  for (const [workflowId, defaults] of Object.entries(source)) {
    const targetDefaults = target[workflowId] ?? {};
    for (const [key, value] of Object.entries(defaults)) {
      targetDefaults[key] = cloneConfigValue(value);
    }
    target[workflowId] = targetDefaults;
  }
}

function mergeUniqueMap<T>(
  target: Record<string, T>,
  source: Record<string, T>,
  section: string,
  layer: ConfigLayerCandidate,
): void {
  for (const [id, value] of Object.entries(source)) {
    if (target[id]) {
      throw new Error(`duplicate ${section} id across config layers: ${id} (${layer.kind}: ${layer.path})`);
    }
    target[id] = cloneConfigValue(value) as T;
  }
}

function mergePreferenceMap(
  target: Record<string, CapabilityProfilePreferenceConfig>,
  source: Record<string, CapabilityProfilePreferenceConfig>,
): void {
  for (const [id, value] of Object.entries(source)) {
    target[id] = { agents: [...value.agents] };
  }
}

function cloneConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value];
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneConfigValue(entry)]),
    );
  }
  return value;
}

function emptyDefaultStageAgents(): DefaultStageAgentsConfig {
  return {
    stage_types: {},
  };
}

function emptyFallback(): FallbackConfig {
  return {
    stage_types: {},
  };
}

function emptyContextPolicy(): ContextPolicyConfig {
  return {
    required_sources: [],
    denied_paths: [],
    redact_patterns: [],
  };
}

function mergeDefaultStageAgents(
  target: DefaultStageAgentsConfig,
  source: DefaultStageAgentsConfig,
): void {
  if (source.agents !== undefined) {
    target.agents = [...source.agents];
  }
  for (const [stage, defaults] of Object.entries(source.stage_types)) {
    if (!defaults) {
      continue;
    }
    target.stage_types[stage as StageType] = {
      agents: [...defaults.agents],
    };
  }
}

function mergeFallback(target: FallbackConfig, source: FallbackConfig): void {
  if (source.agents !== undefined) {
    target.agents = [...source.agents];
  }
  if (source.max_attempts_per_agent !== undefined) {
    target.max_attempts_per_agent = source.max_attempts_per_agent;
  }
  if (source.timeout_seconds !== undefined) {
    target.timeout_seconds = source.timeout_seconds;
  }
  for (const [stage, fallback] of Object.entries(source.stage_types)) {
    if (!fallback) {
      continue;
    }
    const targetFallback = target.stage_types[stage as StageType] ?? {};
    if (fallback.agents !== undefined) {
      targetFallback.agents = [...fallback.agents];
    }
    if (fallback.inherit_common !== undefined) {
      targetFallback.inherit_common = fallback.inherit_common;
    }
    if (fallback.max_attempts_per_agent !== undefined) {
      targetFallback.max_attempts_per_agent = fallback.max_attempts_per_agent;
    }
    if (fallback.timeout_seconds !== undefined) {
      targetFallback.timeout_seconds = fallback.timeout_seconds;
    }
    target.stage_types[stage as StageType] = targetFallback;
  }
}

function mergeContextPolicy(target: ContextPolicyConfig, source: ContextPolicyConfig): void {
  mergeMinimumNumber(target, source, "max_bytes");
  mergeMinimumNumber(target, source, "max_files");
  mergeMinimumNumber(target, source, "freshness_max_age_seconds");
  mergeUniqueStrings(target.required_sources, source.required_sources);
  mergeUniqueStrings(target.denied_paths, source.denied_paths);
  mergeUniqueStrings(target.redact_patterns, source.redact_patterns);
}

function mergeReviewPolicies(
  target: Record<string, ReviewPolicyConfig>,
  source: Record<string, ReviewPolicyConfig>,
  layer: ConfigLayerCandidate,
  sourceRefs: Record<string, ConfigSourceRef[]>,
): void {
  for (const [workflowId, policy] of Object.entries(source)) {
    const targetPolicy = target[workflowId] ?? emptyReviewPolicy();
    mergeUniqueStrings(targetPolicy.required_review_profiles, policy.required_review_profiles);
    target[workflowId] = targetPolicy;
    appendPolicySource(sourceRefs, workflowId, layer);
  }
}

function mergeReleasePolicies(
  target: Record<string, ReleasePolicyConfig>,
  source: Record<string, ReleasePolicyConfig>,
  layer: ConfigLayerCandidate,
  sourceRefs: Record<string, ConfigSourceRef[]>,
): void {
  for (const [workflowId, policy] of Object.entries(source)) {
    const targetPolicy = target[workflowId] ?? emptyReleasePolicy();
    mergeUniqueStrings(targetPolicy.required_evidence, policy.required_evidence);
    mergeUniqueStrings(targetPolicy.needs_decision_risks, policy.needs_decision_risks);
    target[workflowId] = targetPolicy;
    appendPolicySource(sourceRefs, workflowId, layer);
  }
}

function mergeRunDefaults(
  target: RunDefaultsConfig,
  source: RunDefaultsConfig,
  layer: ConfigLayerCandidate,
  sourceRefs: ConfigSourceRef[],
): void {
  let touched = false;
  for (const key of [
    "dispatch_timeout_secs",
    "adapter_timeout_secs",
    "event_page_size",
    "retry_attempts",
  ] as const) {
    const value = source[key];
    if (value !== undefined) {
      target[key] = value;
      touched = true;
    }
  }
  if (touched) {
    appendLayerSource(sourceRefs, layer);
  }
}

function mergeExecutionPolicy(
  target: ExecutionPolicyConfig,
  source: ExecutionPolicyConfig,
  layer: ConfigLayerCandidate,
  sourceRefs: ConfigSourceRef[],
): void {
  let touched = false;
  for (const key of [
    "max_fanout_concurrency",
    "max_dispatch_timeout_secs",
    "max_adapter_timeout_secs",
    "max_retry_attempts",
  ] as const) {
    const value = source[key];
    if (value !== undefined) {
      target[key] = target[key] === undefined ? value : Math.min(target[key], value);
      touched = true;
    }
  }
  if (source.require_user_gate !== undefined) {
    target.require_user_gate = Boolean(target.require_user_gate) || source.require_user_gate;
    touched = true;
  }
  if (source.allow_auto_dispatch !== undefined) {
    target.allow_auto_dispatch =
      target.allow_auto_dispatch === undefined
        ? source.allow_auto_dispatch
        : target.allow_auto_dispatch && source.allow_auto_dispatch;
    touched = true;
  }
  if (touched) {
    appendLayerSource(sourceRefs, layer);
  }
}

function appendPolicySource(
  sourceRefs: Record<string, ConfigSourceRef[]>,
  workflowId: string,
  layer: ConfigLayerCandidate,
): void {
  const refs = sourceRefs[workflowId] ?? [];
  if (!refs.some((ref) => ref.source === layer.kind && ref.path === layer.path)) {
    refs.push({ source: layer.kind, path: layer.path });
  }
  sourceRefs[workflowId] = refs;
}

function appendLayerSource(sourceRefs: ConfigSourceRef[], layer: ConfigLayerCandidate): void {
  if (!sourceRefs.some((ref) => ref.source === layer.kind && ref.path === layer.path)) {
    sourceRefs.push({ source: layer.kind, path: layer.path });
  }
}

function mergeMinimumNumber(
  target: ContextPolicyConfig,
  source: ContextPolicyConfig,
  key: "max_bytes" | "max_files" | "freshness_max_age_seconds",
): void {
  const value = source[key];
  if (value === undefined) {
    return;
  }
  target[key] = target[key] === undefined ? value : Math.min(target[key], value);
}

function mergeUniqueStrings(target: string[], source: string[]): void {
  const seen = new Set(target);
  for (const item of source) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    target.push(item);
  }
}

function defaultStageAgentsTable(value: unknown, label: string): DefaultStageAgentsConfig {
  if (!isRecord(value)) {
    throw new Error(`invalid agentmesh TOML ${label}: default_stage_agents must be a table`);
  }
  const defaults = emptyDefaultStageAgents();
  for (const [key, entry] of Object.entries(value)) {
    if (key === "agents") {
      defaults.agents = agentIdList(entry, "default_stage_agents.agents");
      continue;
    }
    if (key === "stage_types") {
      defaults.stage_types = stageAgentListMap(entry, "default_stage_agents.stage_types");
      continue;
    }
    if (key === "nodes") {
      throw new Error("default_stage_agents.nodes is not supported");
    }
    (defaults as unknown as Record<string, unknown>)[key] = entry;
  }
  return defaults;
}

function stageAgentListMap(
  value: unknown,
  label: string,
): Partial<Record<StageType, StageAgentListConfig>> {
  if (!isRecord(value)) {
    throw new Error(`invalid agentmesh TOML: ${label} must be a table`);
  }
  const stageTypes: Partial<Record<StageType, StageAgentListConfig>> = {};
  for (const [stage, entry] of Object.entries(value)) {
    const stageType = parseStageTypeKey(stage, `${label}.${stage}`);
    stageTypes[stageType] = stageAgentListTable(entry, `${label}.${stage}`);
  }
  return stageTypes;
}

function stageAgentListTable(value: unknown, label: string): StageAgentListConfig {
  if (Array.isArray(value)) {
    return {
      agents: agentIdList(value, label),
    };
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be a table or list of agent ids`);
  }
  const defaults: StageAgentListConfig = {
    agents: [],
  };
  for (const [key, entry] of Object.entries(value)) {
    if (key === "agents") {
      defaults.agents = agentIdList(entry, `${label}.agents`);
      continue;
    }
    (defaults as unknown as Record<string, unknown>)[key] = entry;
  }
  return defaults;
}

function fallbackTable(value: unknown, label: string): FallbackConfig {
  if (!isRecord(value)) {
    throw new Error(`invalid agentmesh TOML ${label}: fallback must be a table`);
  }
  const fallback = emptyFallback();
  for (const [key, entry] of Object.entries(value)) {
    if (key === "agents") {
      fallback.agents = agentIdList(entry, "fallback.agents");
      continue;
    }
    if (key === "max_attempts_per_agent" || key === "timeout_seconds") {
      fallback[key] = entry as number;
      continue;
    }
    if (key === "stage_types") {
      fallback.stage_types = fallbackStageTypeMap(entry, "fallback.stage_types");
      continue;
    }
    if (key === "nodes") {
      throw new Error("fallback.nodes is not supported");
    }
    if (key === "inherit_common") {
      throw new Error("fallback.inherit_common is not supported");
    }
    (fallback as unknown as Record<string, unknown>)[key] = entry;
  }
  return fallback;
}

function fallbackStageTypeMap(
  value: unknown,
  label: string,
): Partial<Record<StageType, FallbackStageTypeConfig>> {
  if (!isRecord(value)) {
    throw new Error(`invalid agentmesh TOML: ${label} must be a table`);
  }
  const stageTypes: Partial<Record<StageType, FallbackStageTypeConfig>> = {};
  for (const [stage, entry] of Object.entries(value)) {
    const stageType = parseStageTypeKey(stage, `${label}.${stage}`);
    stageTypes[stageType] = fallbackStageTypeTable(entry, `${label}.${stage}`);
  }
  return stageTypes;
}

function fallbackStageTypeTable(value: unknown, label: string): FallbackStageTypeConfig {
  if (Array.isArray(value)) {
    return {
      agents: agentIdList(value, label),
    };
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be a table or list of agent ids`);
  }
  const fallback: FallbackStageTypeConfig = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "agents") {
      fallback.agents = agentIdList(entry, `${label}.agents`);
      continue;
    }
    if (key === "inherit_common") {
      fallback.inherit_common = entry as boolean;
      continue;
    }
    if (key === "max_attempts_per_agent" || key === "timeout_seconds") {
      fallback[key] = entry as number;
      continue;
    }
    (fallback as unknown as Record<string, unknown>)[key] = entry;
  }
  return fallback;
}

function agentIdList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a list of agent ids`);
  }
  const agents = value.map((item) => typeof item === "string" ? item.trim() : item);
  if (!agents.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error(`${label} must be a list of non-empty agent ids`);
  }
  return agents as string[];
}

function parseStageTypeKey(value: string, label: string): StageType {
  const parsed = StageTypeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${label} is not a supported stage`);
  }
  return parsed.data;
}

function contextPolicyTable(value: unknown, label: string): ContextPolicyConfig {
  if (!isRecord(value)) {
    throw new Error(`invalid agentmesh TOML ${label}: context_policy must be a table`);
  }
  const policy = emptyContextPolicy();
  for (const [key, entry] of Object.entries(value)) {
    if (
      key === "max_bytes" ||
      key === "max_files" ||
      key === "freshness_max_age_seconds"
    ) {
      policy[key] = entry as number;
      continue;
    }
    if (key === "required_sources" || key === "denied_paths" || key === "redact_patterns") {
      if (Array.isArray(entry)) {
        policy[key] = [...entry] as string[];
      } else {
        (policy as unknown as Record<string, unknown>)[key] = entry;
      }
      continue;
    }
    (policy as unknown as Record<string, unknown>)[key] = entry;
  }
  return policy;
}

function emptyReviewPolicy(): ReviewPolicyConfig {
  return {
    required_review_profiles: [],
  };
}

function emptyReleasePolicy(): ReleasePolicyConfig {
  return {
    required_evidence: [],
    needs_decision_risks: [],
  };
}

function reviewPolicyMap(value: unknown, label: string): Record<string, ReviewPolicyConfig> {
  const entries = configSectionMap(value, "review_policy", label);
  return Object.fromEntries(
    Object.entries(entries).map(([workflowId, entry]) => [
      workflowId,
      reviewPolicyTable(entry),
    ]),
  );
}

function releasePolicyMap(value: unknown, label: string): Record<string, ReleasePolicyConfig> {
  const entries = configSectionMap(value, "release_policy", label);
  return Object.fromEntries(
    Object.entries(entries).map(([workflowId, entry]) => [
      workflowId,
      releasePolicyTable(entry),
    ]),
  );
}

function reviewPolicyTable(value: Record<string, unknown>): ReviewPolicyConfig {
  const policy = emptyReviewPolicy();
  for (const [key, entry] of Object.entries(value)) {
    if (key === "required_review_profiles") {
      if (Array.isArray(entry)) {
        policy.required_review_profiles = [...entry] as string[];
      } else {
        (policy as unknown as Record<string, unknown>)[key] = entry;
      }
      continue;
    }
    (policy as unknown as Record<string, unknown>)[key] = entry;
  }
  return policy;
}

function releasePolicyTable(value: Record<string, unknown>): ReleasePolicyConfig {
  const policy = emptyReleasePolicy();
  for (const [key, entry] of Object.entries(value)) {
    if (key === "required_evidence" || key === "needs_decision_risks") {
      if (Array.isArray(entry)) {
        policy[key] = [...entry] as string[];
      } else {
        (policy as unknown as Record<string, unknown>)[key] = entry;
      }
      continue;
    }
    (policy as unknown as Record<string, unknown>)[key] = entry;
  }
  return policy;
}

function runDefaultsTable(value: unknown, label: string): RunDefaultsConfig {
  if (!isRecord(value)) {
    throw new Error(`invalid agentmesh TOML ${label}: run_defaults must be a table`);
  }
  const defaults: RunDefaultsConfig = {};
  for (const [key, entry] of Object.entries(value)) {
    (defaults as unknown as Record<string, unknown>)[key] = entry;
  }
  return defaults;
}

function executionPolicyTable(value: unknown, label: string): ExecutionPolicyConfig {
  if (!isRecord(value)) {
    throw new Error(`invalid agentmesh TOML ${label}: execution_policy must be a table`);
  }
  const policy: ExecutionPolicyConfig = {};
  for (const [key, entry] of Object.entries(value)) {
    (policy as unknown as Record<string, unknown>)[key] = entry;
  }
  return policy;
}

function modelAliasMap(value: unknown, label: string): Record<string, ModelAliasConfig> {
  const entries = configSectionMap(value, "model_aliases", label);
  return Object.fromEntries(Object.entries(entries).map(([id, entry]) => {
    validateSupportedPolicyKeys(`model_aliases.${id}`, entry, ["adapter", "model"]);
    return [
      id,
      {
        adapter: entry.adapter as string,
        model: entry.model as string,
      },
    ];
  }));
}

function capabilityProfileMap(
  value: unknown,
  label: string,
): Record<string, CapabilityProfileConfig> {
  const entries = configSectionMap(value, "capability_profiles", label);
  return Object.fromEntries(Object.entries(entries).map(([id, entry]) => {
    validateSupportedPolicyKeys(`capability_profiles.${id}`, entry, [
      "stage",
      "required_capabilities",
      "min_count",
    ]);
    return [
      id,
      {
        stage: entry.stage as string,
        required_capabilities: Array.isArray(entry.required_capabilities)
          ? [...entry.required_capabilities] as string[]
          : entry.required_capabilities as string[],
        min_count: entry.min_count as number,
      },
    ];
  }));
}

function capabilityProfilePreferenceMap(
  value: unknown,
  label: string,
): Record<string, CapabilityProfilePreferenceConfig> {
  const entries = configSectionMap(value, "capability_profile_preferences", label);
  return Object.fromEntries(Object.entries(entries).map(([id, entry]) => {
    validateSupportedPolicyKeys(`capability_profile_preferences.${id}`, entry, ["agents"]);
    return [
      id,
      {
        agents: Array.isArray(entry.agents)
          ? [...entry.agents] as string[]
          : entry.agents as string[],
      },
    ];
  }));
}

function configSectionMap(
  value: unknown,
  section:
    | "agents"
    | "mcp_servers"
    | "workflow_defaults"
    | "review_policy"
    | "release_policy"
    | "model_aliases"
    | "capability_profiles"
    | "capability_profile_preferences",
  label: string,
): Record<string, Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`invalid agentmesh TOML ${label}: ${section} must be a table`);
  }
  const entries: Record<string, Record<string, unknown>> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry) || Object.values(entry).some(isRecord)) {
      throw new Error(
        `invalid agentmesh TOML ${label}: ${section}.${id} must be a table of scalar values`,
      );
    }
    entries[id] = entry;
  }
  return entries;
}

function validateAgents(agents: Record<string, Record<string, unknown>>): void {
  for (const [agentId, agent] of Object.entries(agents)) {
    validateAgentToken(agentId, "agent id");
    validateSupportedPolicyKeys(`agents.${agentId}`, agent, [
      "label",
      "adapter",
      "command",
      "args",
      "env",
      "model",
      "reasoning_effort",
      "capabilities",
      "timeout_seconds",
      "prompt_file_arg",
      "prompt_arg",
      "output_file_arg",
      "stdin",
      "disabled",
      "context_mode",
    ]);
    const capabilities = optionalStringList(agent, "capabilities", `agents.${agentId}.capabilities`);
    for (const capability of capabilities) {
      validateAgentToken(capability, `agents.${agentId}.capabilities`);
    }
    const reasoningEffort = agent.reasoning_effort;
    if (
      reasoningEffort !== undefined &&
      (typeof reasoningEffort !== "string" || !REASONING_EFFORTS.has(reasoningEffort))
    ) {
      throw new Error(`agents.${agentId}.reasoning_effort must be one of: ${[...REASONING_EFFORTS].join(", ")}`);
    }
    if (agent.disabled !== undefined && typeof agent.disabled !== "boolean") {
      throw new Error(`agents.${agentId}.disabled must be a boolean`);
    }
    validateInvocationTimeout(
      `agents.${agentId}.timeout_seconds`,
      numberValue(agent.timeout_seconds, `agents.${agentId}.timeout_seconds`),
    );
  }
}

function validateAgentToken(value: string, label: string): void {
  if (!SAFE_AGENT_TOKEN.test(value)) {
    throw new Error(`${label} may only contain letters, numbers, dot, underscore, and dash, and must start with a letter: ${value}`);
  }
}

function optionalStringList(
  agent: Record<string, unknown>,
  key: string,
  label: string,
): string[] {
  const value = agent[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label} must be a list of strings`);
  }
  return value;
}

function numberValue(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new Error(`${label} must be a number`);
  }
  return value;
}

function validateWorkflowDefaults(config: AgentmeshConfig): void {
  for (const [workflowId, defaults] of Object.entries(config.workflow_defaults)) {
    for (const [stage, value] of Object.entries(defaults)) {
      if (!StageTypeSchema.safeParse(stage).success) {
        throw new Error(`workflow_defaults.${workflowId}.${stage} is not a supported stage`);
      }
      for (const agentId of workflowDefaultAgentIds(workflowId, stage, value)) {
        if (!config.agents[agentId]) {
          throw new Error(
            `workflow_defaults.${workflowId}.${stage} references unknown agent: ${agentId}`,
          );
        }
      }
    }
  }
}

function validateDefaultStageAgents(config: AgentmeshConfig): void {
  const defaults = config.default_stage_agents;
  validateSupportedPolicyKeys("default_stage_agents", defaults, ["agents", "stage_types"]);
  validateConfiguredAgentList({
    agents: defaults.agents,
    config,
    label: "default_stage_agents.agents",
    maxAgents: MAX_FANOUT_AGENTS,
    allowCurrent: true,
  });
  for (const [stage, stageDefaults] of Object.entries(defaults.stage_types)) {
    const stageType = parseStageTypeKey(stage, `default_stage_agents.stage_types.${stage}`);
    const label = `default_stage_agents.stage_types.${stageType}`;
    validateSupportedPolicyKeys(label, stageDefaults, ["agents"]);
    if (stageType === "execute" && stageDefaults.agents.length !== 1) {
      throw new Error(`${label}.agents must contain exactly one agent`);
    }
    validateConfiguredAgentList({
      agents: stageDefaults.agents,
      config,
      label: `${label}.agents`,
      maxAgents: MAX_FANOUT_AGENTS,
      allowCurrent: true,
      stage: stageType,
    });
  }
}

function validateFallback(config: AgentmeshConfig): void {
  const fallback = config.fallback;
  validateSupportedPolicyKeys("fallback", fallback, [
    "agents",
    "max_attempts_per_agent",
    "timeout_seconds",
    "stage_types",
  ]);
  validateConfiguredAgentList({
    agents: fallback.agents,
    config,
    label: "fallback.agents",
    maxAgents: MAX_FALLBACK_AGENTS,
    allowCurrent: false,
  });
  validateFallbackAttempts("fallback.max_attempts_per_agent", fallback.max_attempts_per_agent);
  validateInvocationTimeout("fallback.timeout_seconds", fallback.timeout_seconds);
  for (const [stage, stageFallback] of Object.entries(fallback.stage_types)) {
    const stageType = parseStageTypeKey(stage, `fallback.stage_types.${stage}`);
    const label = `fallback.stage_types.${stageType}`;
    validateSupportedPolicyKeys(label, stageFallback, [
      "agents",
      "inherit_common",
      "max_attempts_per_agent",
      "timeout_seconds",
    ]);
    validateConfiguredAgentList({
      agents: stageFallback.agents,
      config,
      label: `${label}.agents`,
      maxAgents: MAX_FALLBACK_AGENTS,
      allowCurrent: false,
      stage: stageType,
    });
    if (
      stageFallback.inherit_common !== undefined &&
      typeof stageFallback.inherit_common !== "boolean"
    ) {
      throw new Error(`${label}.inherit_common must be a boolean`);
    }
    validateFallbackAttempts(`${label}.max_attempts_per_agent`, stageFallback.max_attempts_per_agent);
    validateInvocationTimeout(`${label}.timeout_seconds`, stageFallback.timeout_seconds);
  }
}

function validateConfiguredAgentList(input: {
  agents: string[] | undefined;
  config: AgentmeshConfig;
  label: string;
  maxAgents: number;
  allowCurrent: boolean;
  stage?: StageType;
}): void {
  const { agents, config, label, maxAgents, allowCurrent, stage } = input;
  if (agents === undefined) {
    return;
  }
  if (
    !Array.isArray(agents) ||
    !agents.every((agent) => typeof agent === "string" && agent.length > 0)
  ) {
    throw new Error(`${label} must be a list of non-empty agent ids`);
  }
  if (agents.length > maxAgents) {
    throw new Error(`${label} must contain at most ${maxAgents} agents`);
  }
  const hasCurrent = agents.includes("current");
  if (hasCurrent && !allowCurrent) {
    throw new Error(`${label} must not include current`);
  }
  if (hasCurrent && agents.length > 1) {
    throw new Error(`${label} cannot mix current with worker agents`);
  }
  for (const agentId of agents) {
    if (agentId === "current") {
      continue;
    }
    const agent = config.agents[agentId];
    if (!agent) {
      throw new Error(`${label} references unknown agent: ${agentId}`);
    }
    if (agent.disabled === true) {
      throw new Error(`${label} references disabled agent: ${agentId}`);
    }
    if (stage && !agentSupportsStage(agent, stage)) {
      throw new Error(`${label} references agent without ${stage} capability: ${agentId}`);
    }
  }
}

function agentSupportsStage(agent: Record<string, unknown>, stage: StageType): boolean {
  const capabilities = agent.capabilities;
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return true;
  }
  if (!capabilities.every((capability) => typeof capability === "string")) {
    return true;
  }
  return capabilities.includes(stage);
}

function validateFallbackAttempts(label: string, value: number | undefined): void {
  validateIntegerBounds(label, value, 1, MAX_FALLBACK_ATTEMPTS_PER_AGENT);
}

function validateInvocationTimeout(label: string, value: number | undefined): void {
  validateIntegerBounds(
    label,
    value,
    MIN_INVOCATION_TIMEOUT_SECONDS,
    MAX_INVOCATION_TIMEOUT_SECONDS,
  );
}

function validateIntegerBounds(
  label: string,
  value: number | undefined,
  min: number,
  max: number,
): void {
  if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
}

function validateMcpServers(config: AgentmeshConfig): void {
  const supportedKeys = new Set(["command", "args", "resource_hints"]);
  for (const [serverId, server] of Object.entries(config.mcp_servers)) {
    if (!isValidMcpServerId(serverId)) {
      throw new Error(
        `mcp_servers id must contain only letters, numbers, dot, underscore, and dash: ${serverId}`,
      );
    }
    for (const key of Object.keys(server)) {
      if (!supportedKeys.has(key)) {
        throw new Error(
          `mcp_servers.${serverId}.${key} is not supported; MCP config supports command, args, and resource_hints only`,
        );
      }
    }
    if (typeof server.command !== "string" || server.command.trim().length === 0) {
      throw new Error(`mcp_servers.${serverId}.command is required and must be a non-empty string`);
    }
    if (
      server.args !== undefined &&
      (!Array.isArray(server.args) || !server.args.every((item) => typeof item === "string"))
    ) {
      throw new Error(`mcp_servers.${serverId}.args must be a list of strings`);
    }
    if (
      server.resource_hints !== undefined &&
      (
        !Array.isArray(server.resource_hints) ||
        !server.resource_hints.every((item) => typeof item === "string")
      )
    ) {
      throw new Error(`mcp_servers.${serverId}.resource_hints must be a list of strings`);
    }
  }
}

function validateContextPolicy(policy: ContextPolicyConfig): void {
  const supportedKeys = new Set([
    "max_bytes",
    "max_files",
    "freshness_max_age_seconds",
    "required_sources",
    "denied_paths",
    "redact_patterns",
  ]);
  for (const key of Object.keys(policy)) {
    if (!supportedKeys.has(key)) {
      throw new Error(`context_policy.${key} is not supported`);
    }
  }
  for (const key of ["max_bytes", "max_files", "freshness_max_age_seconds"] as const) {
    const value = policy[key];
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new Error(`context_policy.${key} must be a positive integer`);
    }
  }
  for (const key of ["required_sources", "denied_paths", "redact_patterns"] as const) {
    const value = policy[key];
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new Error(`context_policy.${key} must be a list of strings`);
    }
  }
}

function validateReviewPolicies(policies: Record<string, ReviewPolicyConfig>): void {
  for (const [workflowId, policy] of Object.entries(policies)) {
    validateSupportedPolicyKeys(`review_policy.${workflowId}`, policy, [
      "required_review_profiles",
    ]);
    if (
      !Array.isArray(policy.required_review_profiles) ||
      !policy.required_review_profiles.every((item) => typeof item === "string")
    ) {
      throw new Error(
        `review_policy.${workflowId}.required_review_profiles must be a list of strings`,
      );
    }
  }
}

function validateReleasePolicies(policies: Record<string, ReleasePolicyConfig>): void {
  for (const [workflowId, policy] of Object.entries(policies)) {
    validateSupportedPolicyKeys(`release_policy.${workflowId}`, policy, [
      "required_evidence",
      "needs_decision_risks",
    ]);
    for (const key of ["required_evidence", "needs_decision_risks"] as const) {
      const value = policy[key];
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new Error(`release_policy.${workflowId}.${key} must be a list of strings`);
      }
    }
  }
}

function validateRunDefaults(defaults: RunDefaultsConfig): void {
  validateSupportedPolicyKeys("run_defaults", defaults, [
    "dispatch_timeout_secs",
    "adapter_timeout_secs",
    "event_page_size",
    "retry_attempts",
  ]);
  for (const key of ["dispatch_timeout_secs", "adapter_timeout_secs", "event_page_size"] as const) {
    const value = defaults[key];
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new Error(`run_defaults.${key} must be a positive integer`);
    }
  }
  const retryAttempts = defaults.retry_attempts;
  if (
    retryAttempts !== undefined &&
    (!Number.isInteger(retryAttempts) || retryAttempts < 0)
  ) {
    throw new Error("run_defaults.retry_attempts must be a non-negative integer");
  }
}

function validateExecutionPolicy(policy: ExecutionPolicyConfig): void {
  validateSupportedPolicyKeys("execution_policy", policy, [
    "max_fanout_concurrency",
    "max_dispatch_timeout_secs",
    "max_adapter_timeout_secs",
    "max_retry_attempts",
    "require_user_gate",
    "allow_auto_dispatch",
  ]);
  for (const key of [
    "max_fanout_concurrency",
    "max_dispatch_timeout_secs",
    "max_adapter_timeout_secs",
  ] as const) {
    const value = policy[key];
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new Error(`execution_policy.${key} must be a positive integer`);
    }
  }
  const maxRetryAttempts = policy.max_retry_attempts;
  if (
    maxRetryAttempts !== undefined &&
    (!Number.isInteger(maxRetryAttempts) || maxRetryAttempts < 0)
  ) {
    throw new Error("execution_policy.max_retry_attempts must be a non-negative integer");
  }
  for (const key of ["require_user_gate", "allow_auto_dispatch"] as const) {
    const value = policy[key];
    if (value !== undefined && typeof value !== "boolean") {
      throw new Error(`execution_policy.${key} must be a boolean`);
    }
  }
}

function validateModelAliases(aliases: Record<string, ModelAliasConfig>): void {
  for (const [alias, config] of Object.entries(aliases)) {
    if (typeof config.adapter !== "string" || config.adapter.trim().length === 0) {
      throw new Error(`model_aliases.${alias}.adapter must be a non-empty string`);
    }
    if (typeof config.model !== "string" || config.model.trim().length === 0) {
      throw new Error(`model_aliases.${alias}.model must be a non-empty string`);
    }
  }
}

function validateCapabilityProfiles(profiles: Record<string, CapabilityProfileConfig>): void {
  for (const [profileId, profile] of Object.entries(profiles)) {
    if (!StageTypeSchema.safeParse(profile.stage).success) {
      throw new Error(`capability_profiles.${profileId}.stage is not a supported stage`);
    }
    if (
      !Array.isArray(profile.required_capabilities) ||
      !profile.required_capabilities.every((item) => typeof item === "string")
    ) {
      throw new Error(
        `capability_profiles.${profileId}.required_capabilities must be a list of strings`,
      );
    }
    if (!Number.isInteger(profile.min_count) || profile.min_count <= 0) {
      throw new Error(`capability_profiles.${profileId}.min_count must be a positive integer`);
    }
  }
}

function validateCapabilityProfilePreferences(
  preferences: Record<string, CapabilityProfilePreferenceConfig>,
): void {
  for (const [profileId, preference] of Object.entries(preferences)) {
    if (
      !Array.isArray(preference.agents) ||
      !preference.agents.every((item) => typeof item === "string")
    ) {
      throw new Error(`capability_profile_preferences.${profileId}.agents must be a list of strings`);
    }
  }
}

function validateSupportedPolicyKeys(
  label: string,
  policy: object,
  supportedKeys: string[],
): void {
  const supported = new Set(supportedKeys);
  for (const key of Object.keys(policy)) {
    if (!supported.has(key)) {
      throw new Error(`${label}.${key} is not supported`);
    }
  }
}

function workflowDefaultAgentIds(
  workflowId: string,
  stage: string,
  value: unknown,
): string[] {
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  ) {
    return value.map((item) => item.trim());
  }
  throw new Error(
    `workflow_defaults.${workflowId}.${stage} must be an agent id string or list of agent id strings`,
  );
}

function resolveConfigPath(value: string, cwd: string): string {
  const expanded = value.startsWith("~/")
    ? path.join(os.homedir(), value.slice(2))
    : value;
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(cwd, expanded);
}

function canonicalConfigPath(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
