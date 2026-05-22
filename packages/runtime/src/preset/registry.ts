import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CURRENT_SCHEMA_VERSION,
  MAX_FALLBACK_AGENTS,
  MAX_FALLBACK_ATTEMPTS_PER_AGENT,
  MAX_FANOUT_AGENTS,
  MAX_INVOCATION_TIMEOUT_SECONDS,
  MIN_INVOCATION_TIMEOUT_SECONDS,
  StageFailurePolicySchema,
  StageTypeSchema,
  type StageFailurePolicy,
  type StageNode,
  type StageType,
} from "@agentmesh/core";
import {
  loadConfigWithSources,
  type DefaultStageAgentsConfig,
  type StageAgentListConfig,
} from "../config.js";
import { normalizeAgents, type AgentConfig } from "../adapters.js";
import { parseTomlDocument, stringifyTomlInlineValue } from "../toml.js";
import {
  getWorkflow,
  workflowSearchDirs,
  type Workflow,
} from "../workflow/registry.js";

const USER_PRESET_DIR = path.join(".config", "agentmesh", "presets");
const GENERATED_PRESET_ID_PATTERN = /^p-[0-9a-f]{8}$/;
const LEGACY_TEMPORARY_PRESET_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const MAX_PRESET_ID_GENERATION_ATTEMPTS = 64;
const PRESET_TOP_LEVEL_FIELDS = new Set([
  "schema_version",
  "name",
  "workflow",
  "description",
  "stage_assignments",
  "default_stage_agents",
  "failure_policy",
  "fallback",
]);
const FAILURE_POLICY_FIELDS = new Set(["stage_types", "nodes"]);
const FAILURE_POLICY_OBJECT_FIELDS = new Set(["mode", "max_fallback_agents"]);

export type PresetSource = "user" | "temporary";
export type PresetIdGenerator = () => string;

export interface PresetRegistryDirectory {
  source: "user";
  path: string;
}

export interface Preset {
  presetId: string;
  name: string;
  workflowId: string;
  description?: string;
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  stageAssignments: Record<string, string[]>;
  defaultStageAgents: DefaultStageAgentsConfig;
  failurePolicy: PresetFailurePolicyConfig;
  fallback: PresetFallbackConfig;
  source: PresetSource;
  path?: string;
  validationWarnings: string[];
}

export interface PresetFailurePolicyConfig {
  stage_types: Partial<Record<StageType, StageFailurePolicy>>;
  nodes: Record<string, StageFailurePolicy>;
}

export interface PresetFallbackConfig {
  agents?: string[];
  max_attempts_per_agent?: number;
  timeout_seconds?: number;
  stage_types: Partial<Record<StageType, PresetFallbackStageTypeConfig>>;
  nodes: Record<string, PresetFallbackNodeConfig>;
}

export interface PresetFallbackStageTypeConfig {
  agents?: string[];
  inherit_common?: boolean;
  max_attempts_per_agent?: number;
  timeout_seconds?: number;
}

export interface PresetFallbackNodeConfig extends PresetFallbackStageTypeConfig {
  inherit_stage_type?: boolean;
}

export interface PresetDoctorReport {
  preset_id: string;
  workflow_id: string;
  ok: boolean;
  warnings: string[];
}

export function presetSearchDirs(
  _cwd = process.cwd(),
  _configPath?: string,
): PresetRegistryDirectory[] {
  const dirs: PresetRegistryDirectory[] = [{ source: "user", path: path.join(os.homedir(), USER_PRESET_DIR) }];
  return dedupePresetDirs(dirs);
}

export function presetRegistryDirForWrite(
  _cwd = process.cwd(),
  _configPath?: string,
): string {
  return presetRegistryDirsForWrite().at(-1)?.path
    ?? path.join(os.homedir(), USER_PRESET_DIR);
}

export function presetRegistryDirsForWrite(): PresetRegistryDirectory[] {
  return [{ source: "user", path: path.join(os.homedir(), USER_PRESET_DIR) }];
}

export function findRegistryPreset(
  presetId: string,
  cwd = process.cwd(),
  configPath?: string,
): Preset | undefined {
  const presets = loadRegistryPresets(
    presetRegistryDirsForWrite(),
    cwd,
    configPath,
  ).filter((preset) => preset.presetId === presetId);
  if (presets.length > 1) {
    throw new Error(`multiple user presets found with id: ${presetId}`);
  }
  return presets[0];
}

export function generatePresetRegistrationId(
  existingPresetIds: Iterable<string>,
  generator: PresetIdGenerator = defaultPresetIdGenerator,
): string {
  const existing = new Set(existingPresetIds);
  for (let attempt = 0; attempt < MAX_PRESET_ID_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = generator();
    if (!GENERATED_PRESET_ID_PATTERN.test(candidate)) {
      throw new Error(`generated preset id must match p-xxxxxxxx: ${candidate}`);
    }
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`could not generate a unique preset id after ${MAX_PRESET_ID_GENERATION_ATTEMPTS} attempts`);
}

export function listPresets(
  presetDirs = presetSearchDirs(),
  cwd = process.cwd(),
  configPath?: string,
): Preset[] {
  const seenIds = new Set<string>();
  const presets: Preset[] = [];
  for (const preset of loadRegistryPresets(presetDirs, cwd, configPath)) {
    if (seenIds.has(preset.presetId)) {
      throw new Error(`duplicate preset id '${preset.presetId}' in ${preset.path}`);
    }
    presets.push(preset);
    seenIds.add(preset.presetId);
  }
  return presets.sort(comparePresets);
}

export function getPreset(
  presetId: string,
  presetDirs = presetSearchDirs(),
  cwd = process.cwd(),
  configPath?: string,
): Preset {
  const presets = listPresets(presetDirs, cwd, configPath);
  const preset = presets.find((item) => item.presetId === presetId);
  if (!preset) {
    const known = presets.map((item) => item.presetId).join(", ") || "(none)";
    throw new Error(`unknown preset: ${presetId}; known presets: ${known}`);
  }
  return preset;
}

export function loadPresetFile(
  presetPath: string,
  cwd = process.cwd(),
  configPath?: string,
  options: { presetId?: string } = {},
): Preset {
  const resolvedPath = path.isAbsolute(presetPath)
    ? path.resolve(presetPath)
    : path.resolve(cwd, presetPath);
  return loadPresetToml(resolvedPath, "temporary", cwd, configPath, options.presetId);
}

export function presetTemplate(workflow: Workflow): string {
  const lines = [
    "schema_version = 1",
    `name = ${tomlValue(`${workflow.name} Preset`)}`,
    `workflow = ${tomlValue(workflow.workflowId)}`,
    "",
    "# Derived node ids for this workflow:",
    `# ${workflow.stageNodes.map((node) => node.id).join(", ")}`,
    "",
    "[stage_assignments]",
    ...workflow.stageNodes.map((node) => `${node.id} = []`),
    "",
    "[default_stage_agents]",
    "agents = []",
    "",
    "[default_stage_agents.stage_types]",
    ...uniqueStageTypes(workflow.stageNodes).map((stage) => `${stage} = []`),
    "",
  ];
  for (const node of workflow.stageNodes) {
    lines.push(
      `[failure_policy.nodes.${node.id}]`,
      '# mode = "allow"',
      "# max_fallback_agents = 1",
      "",
    );
  }
  lines.push(
    "[fallback]",
    "agents = []",
    "# max_attempts_per_agent = 1",
    "# timeout_seconds = 900",
    "",
  );
  for (const node of workflow.stageNodes) {
    lines.push(
      `[fallback.nodes.${node.id}]`,
      "agents = []",
      "inherit_stage_type = true",
      "inherit_common = true",
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function formatPreset(preset: Preset): string {
  const lines = [
    `# ${preset.presetId}`,
    "",
    `ID: ${preset.presetId}`,
    `Name: ${preset.name}`,
    `Workflow: ${preset.workflowId}`,
    `Source: ${preset.source}`,
    "",
  ];
  if (preset.path) {
    lines.push("Preset file:", preset.path, "");
  }
  if (preset.description) {
    lines.push("Description:", preset.description, "");
  }
  lines.push("Stage assignments:", "");
  for (const [nodeId, agents] of Object.entries(preset.stageAssignments)) {
    lines.push(`- ${nodeId}: ${agents.join(", ") || "(none)"}`);
  }
  if (preset.validationWarnings.length > 0) {
    lines.push("", "Warnings:", "", ...preset.validationWarnings.map((warning) => `- ${warning}`));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function presetDoctorReport(preset: Preset): PresetDoctorReport {
  return {
    preset_id: preset.presetId,
    workflow_id: preset.workflowId,
    ok: true,
    warnings: [...preset.validationWarnings],
  };
}

export function presetSourceForRun(preset: Preset): Record<string, unknown> {
  return {
    source: preset.source,
    ...(preset.path
      ? {
          path: preset.path,
          hash: `sha256:${createHash("sha256").update(readFileSync(preset.path)).digest("hex")}`,
        }
      : {}),
  };
}

function dedupePresetDirs(dirs: PresetRegistryDirectory[]): PresetRegistryDirectory[] {
  const seen = new Map<string, PresetRegistryDirectory>();
  for (const dir of dirs) {
    seen.set(path.resolve(dir.path), dir);
  }
  return [...seen.values()];
}

function loadRegistryPresets(
  presetDirs: PresetRegistryDirectory[],
  cwd: string,
  configPath?: string,
): Preset[] {
  return presetDirs.flatMap((directory) =>
    iterPresetFiles(directory.path).map((presetPath) =>
      loadPresetToml(presetPath, directory.source, cwd, configPath),
    ),
  );
}

function iterPresetFiles(directory: string): string[] {
  if (!isDirectory(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".toml"))
    .sort()
    .map((entry) => path.join(directory, entry));
}

function loadPresetToml(
  presetPath: string,
  source: PresetSource,
  cwd: string,
  configPath?: string,
  presetIdOverride?: string,
): Preset {
  const payload = parsePresetRoot(
    readFileSync(presetPath, { encoding: "utf-8" }),
    presetPath,
  );
  const presetId = validatePresetId(
    presetIdOverride ?? presetIdFromPath(presetPath),
    presetPath,
    source,
  );
  const workflowId = requireString(payload, "workflow", presetPath);
  const workflow = getWorkflow(workflowId, workflowSearchDirs(cwd, configPath));
  const preset: Preset = {
    presetId,
    name: optionalString(payload, "name") ?? titleFromId(presetId),
    workflowId,
    description: optionalString(payload, "description"),
    schemaVersion: supportedVersion(payload, presetPath),
    stageAssignments: stageAssignmentTable(payload.stage_assignments, presetPath),
    defaultStageAgents: defaultStageAgentsTable(payload.default_stage_agents, presetPath),
    failurePolicy: failurePolicyTable(payload.failure_policy, presetPath),
    fallback: fallbackTable(payload.fallback, presetPath),
    source,
    path: presetPath,
    validationWarnings: [],
  };
  const configContext = optionalConfigContext(configPath, cwd);
  preset.validationWarnings = validatePreset(
    preset,
    workflow,
    configContext.agents,
    configContext.defaultStageAgents,
  );
  return preset;
}

function parsePresetRoot(content: string, label: string): Record<string, unknown> {
  const payload = parseTomlDocument(content, label, "invalid preset TOML");
  for (const [key, value] of Object.entries(payload)) {
    if (!PRESET_TOP_LEVEL_FIELDS.has(key)) {
      throw new Error(`invalid preset TOML ${label}: unknown top-level field: ${key}`);
    }
    if (
      isRecord(value) &&
      !["stage_assignments", "default_stage_agents", "failure_policy", "fallback"].includes(key)
    ) {
      throw new Error(`invalid preset TOML ${label}: sections are not supported: ${key}`);
    }
  }
  return payload;
}

function supportedVersion(
  payload: Record<string, unknown>,
  presetPath: string,
): typeof CURRENT_SCHEMA_VERSION {
  if (payload.schema_version !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`preset ${presetPath}: schema_version must be ${CURRENT_SCHEMA_VERSION}`);
  }
  return CURRENT_SCHEMA_VERSION;
}

function stageAssignmentTable(value: unknown, presetPath: string): Record<string, string[]> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`preset ${presetPath}: stage_assignments must be a table`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([nodeId, entry]) => [
      nodeId,
      agentList(entry, `preset ${presetPath}: stage_assignments.${nodeId}`),
    ]),
  );
}

function defaultStageAgentsTable(value: unknown, presetPath: string): DefaultStageAgentsConfig {
  const defaults: DefaultStageAgentsConfig = { stage_types: {} };
  if (value === undefined) {
    return defaults;
  }
  if (!isRecord(value)) {
    throw new Error(`preset ${presetPath}: default_stage_agents must be a table`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "agents") {
      defaults.agents = agentList(entry, `preset ${presetPath}: default_stage_agents.agents`);
      continue;
    }
    if (key === "stage_types") {
      defaults.stage_types = stageAgentListMap(entry, `preset ${presetPath}: default_stage_agents.stage_types`);
      continue;
    }
    if (key === "nodes") {
      throw new Error(`preset ${presetPath}: default_stage_agents.nodes is not supported`);
    }
    throw new Error(`preset ${presetPath}: default_stage_agents.${key} is not supported`);
  }
  return defaults;
}

function stageAgentListMap(
  value: unknown,
  label: string,
): Partial<Record<StageType, StageAgentListConfig>> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a table`);
  }
  const stageTypes: Partial<Record<StageType, StageAgentListConfig>> = {};
  for (const [stage, entry] of Object.entries(value)) {
    const stageType = parseStageTypeKey(stage, `${label}.${stage}`);
    stageTypes[stageType] = Array.isArray(entry)
      ? { agents: agentList(entry, `${label}.${stage}`) }
      : stageAgentListTable(entry, `${label}.${stage}`);
  }
  return stageTypes;
}

function stageAgentListTable(value: unknown, label: string): StageAgentListConfig {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a table or list of agent ids`);
  }
  const table: StageAgentListConfig = { agents: [] };
  for (const [key, entry] of Object.entries(value)) {
    if (key === "agents") {
      table.agents = agentList(entry, `${label}.agents`);
      continue;
    }
    throw new Error(`${label}.${key} is not supported`);
  }
  return table;
}

function failurePolicyTable(value: unknown, presetPath: string): PresetFailurePolicyConfig {
  const policy: PresetFailurePolicyConfig = { stage_types: {}, nodes: {} };
  if (value === undefined) {
    return policy;
  }
  if (!isRecord(value)) {
    throw new Error(`preset ${presetPath}: failure_policy must be a table`);
  }
  for (const key of Object.keys(value)) {
    if (!FAILURE_POLICY_FIELDS.has(key)) {
      throw new Error(`preset ${presetPath}: failure_policy.${key} is not supported`);
    }
  }
  policy.stage_types = stageFailurePolicyMap(
    value.stage_types,
    `preset ${presetPath}: failure_policy.stage_types`,
  );
  policy.nodes = nodeFailurePolicyMap(
    value.nodes,
    `preset ${presetPath}: failure_policy.nodes`,
  );
  return policy;
}

function stageFailurePolicyMap(
  value: unknown,
  label: string,
): Partial<Record<StageType, StageFailurePolicy>> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be a table`);
  }
  const policies: Partial<Record<StageType, StageFailurePolicy>> = {};
  for (const [stage, entry] of Object.entries(value)) {
    const stageType = parseStageTypeKey(stage, `${label}.${stage}`);
    policies[stageType] = failurePolicyObject(entry, `${label}.${stage}`);
  }
  return policies;
}

function nodeFailurePolicyMap(value: unknown, label: string): Record<string, StageFailurePolicy> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be a table`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([nodeId, entry]) => [
      nodeId,
      failurePolicyObject(entry, `${label}.${nodeId}`),
    ]),
  );
}

function failurePolicyObject(value: unknown, label: string): StageFailurePolicy {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a table`);
  }
  for (const key of Object.keys(value)) {
    if (!FAILURE_POLICY_OBJECT_FIELDS.has(key)) {
      throw new Error(`${label}.${key} is not supported`);
    }
  }
  const parsed = StageFailurePolicySchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const pathSuffix = issue?.path.length ? `.${issue.path.join(".")}` : "";
    throw new Error(`${label}${pathSuffix} ${issue?.message ?? "invalid failure policy"}`);
  }
  return parsed.data;
}

function fallbackTable(value: unknown, presetPath: string): PresetFallbackConfig {
  const fallback: PresetFallbackConfig = { stage_types: {}, nodes: {} };
  if (value === undefined) {
    return fallback;
  }
  if (!isRecord(value)) {
    throw new Error(`preset ${presetPath}: fallback must be a table`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "agents") {
      fallback.agents = agentList(entry, `preset ${presetPath}: fallback.agents`);
      continue;
    }
    if (key === "max_attempts_per_agent" || key === "timeout_seconds") {
      fallback[key] = entry as number;
      continue;
    }
    if (key === "stage_types") {
      fallback.stage_types = fallbackStageTypeMap(entry, `preset ${presetPath}: fallback.stage_types`);
      continue;
    }
    if (key === "nodes") {
      fallback.nodes = fallbackNodeMap(entry, `preset ${presetPath}: fallback.nodes`);
      continue;
    }
    if (key === "inherit_common") {
      throw new Error(`preset ${presetPath}: fallback.inherit_common is not supported`);
    }
    throw new Error(`preset ${presetPath}: fallback.${key} is not supported`);
  }
  return fallback;
}

function fallbackStageTypeMap(
  value: unknown,
  label: string,
): Partial<Record<StageType, PresetFallbackStageTypeConfig>> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a table`);
  }
  const stageTypes: Partial<Record<StageType, PresetFallbackStageTypeConfig>> = {};
  for (const [stage, entry] of Object.entries(value)) {
    const stageType = parseStageTypeKey(stage, `${label}.${stage}`);
    stageTypes[stageType] = fallbackStageTypeTable(entry, `${label}.${stage}`);
  }
  return stageTypes;
}

function fallbackNodeMap(value: unknown, label: string): Record<string, PresetFallbackNodeConfig> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a table`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([nodeId, entry]) => [
      nodeId,
      fallbackNodeTable(entry, `${label}.${nodeId}`),
    ]),
  );
}

function fallbackStageTypeTable(value: unknown, label: string): PresetFallbackStageTypeConfig {
  if (Array.isArray(value)) {
    return { agents: agentList(value, label) };
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be a table or list of agent ids`);
  }
  const table: PresetFallbackStageTypeConfig = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "agents") {
      table.agents = agentList(entry, `${label}.agents`);
      continue;
    }
    if (key === "inherit_common") {
      table.inherit_common = entry as boolean;
      continue;
    }
    if (key === "max_attempts_per_agent" || key === "timeout_seconds") {
      table[key] = entry as number;
      continue;
    }
    throw new Error(`${label}.${key} is not supported`);
  }
  return table;
}

function fallbackNodeTable(value: unknown, label: string): PresetFallbackNodeConfig {
  if (Array.isArray(value)) {
    return { agents: agentList(value, label) };
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be a table or list of agent ids`);
  }
  const table: PresetFallbackNodeConfig = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "agents") {
      table.agents = agentList(entry, `${label}.agents`);
      continue;
    }
    if (key === "inherit_common") {
      table.inherit_common = entry as boolean;
      continue;
    }
    if (key === "inherit_stage_type") {
      table.inherit_stage_type = entry as boolean;
      continue;
    }
    if (key === "max_attempts_per_agent" || key === "timeout_seconds") {
      table[key] = entry as number;
      continue;
    }
    throw new Error(`${label}.${key} is not supported`);
  }
  return table;
}

function validatePreset(
  preset: Preset,
  workflow: Workflow,
  agents: Record<string, AgentConfig>,
  globalDefaults: DefaultStageAgentsConfig | undefined,
): string[] {
  const warnings: string[] = [];
  const nodeById = new Map(workflow.stageNodes.map((node) => [node.id, node]));
  const validNodeIds = workflow.stageNodes.map((node) => node.id);
  validateNodeIdRecord("stage_assignments", preset.stageAssignments, nodeById);
  validateNodeIdRecord("failure_policy.nodes", preset.failurePolicy.nodes, nodeById);
  validateNodeIdRecord("fallback.nodes", preset.fallback.nodes, nodeById);
  validateDefaultStageAgents(preset, workflow.stageNodes, agents, warnings);
  validateFallback(preset, workflow.stageNodes, agents);
  validateFallbackSettings("fallback", preset.fallback);
  validateFallbackStageSettings("fallback.stage_types", preset.fallback.stage_types);
  validateFallbackNodeSettings("fallback.nodes", preset.fallback.nodes);
  for (const node of workflow.stageNodes) {
    const agentsForNode = resolvedPresetPrimaryAgents(preset, node, globalDefaults);
    if (agentsForNode.length === 0) {
      throw new Error(`preset ${preset.presetId}: node '${node.id}' has no primary assignment`);
    }
    validatePrimaryAgents(`stage_assignments.${node.id}`, agentsForNode, node, agents);
    if ((node.type === "plan" || node.type === "decide") && agentsForNode.length >= 4) {
      warnings.push(
        `node '${node.id}' has ${agentsForNode.length} ${node.type} agents; synthesis readability may suffer`,
      );
    }
  }
  validateFailurePolicyStageTypes(preset.failurePolicy.stage_types);
  for (const key of Object.keys(preset.failurePolicy.nodes)) {
    if (!validNodeIds.includes(key)) {
      throw new Error(
        `preset ${preset.presetId}: unknown failure_policy node id '${key}'; valid node ids: ${validNodeIds.join(", ")}`,
      );
    }
  }
  return warnings;
}

function validateNodeIdRecord(
  label: string,
  record: Record<string, unknown>,
  nodeById: Map<string, StageNode>,
): void {
  const validNodeIds = [...nodeById.keys()];
  for (const nodeId of Object.keys(record)) {
    if (!nodeById.has(nodeId)) {
      throw new Error(
        `unknown ${label} node id '${nodeId}'; valid node ids: ${validNodeIds.join(", ")}`,
      );
    }
  }
}

function validateDefaultStageAgents(
  preset: Preset,
  nodes: StageNode[],
  agents: Record<string, AgentConfig>,
  warnings: string[],
): void {
  validatePrimaryList(`default_stage_agents.agents`, preset.defaultStageAgents.agents, undefined, agents);
  for (const [stage, config] of Object.entries(preset.defaultStageAgents.stage_types)) {
    const stageType = parseStageTypeKey(stage, `default_stage_agents.stage_types.${stage}`);
    validatePrimaryList(
      `default_stage_agents.stage_types.${stageType}.agents`,
      config.agents,
      stageType,
      agents,
    );
    if (stageType === "execute" && config.agents.length !== 1) {
      throw new Error(`default_stage_agents.stage_types.execute.agents must contain exactly one agent`);
    }
    if (
      (stageType === "plan" || stageType === "decide") &&
      nodes.some((node) => node.type === stageType) &&
      config.agents.length >= 4
    ) {
      warnings.push(
        `stage type '${stageType}' has ${config.agents.length} default agents; synthesis readability may suffer`,
      );
    }
  }
}

function validatePrimaryList(
  label: string,
  agentIds: string[] | undefined,
  stage: StageType | undefined,
  agents: Record<string, AgentConfig>,
): void {
  if (agentIds === undefined) {
    return;
  }
  validateAgentListShape(label, agentIds, MAX_FANOUT_AGENTS);
  const hasCurrent = agentIds.includes("current");
  if (hasCurrent && agentIds.length > 1) {
    throw new Error(`${label} cannot mix current with worker agents`);
  }
  validateKnownAgents(label, agentIds, agents, stage, true);
}

function validatePrimaryAgents(
  label: string,
  agentIds: string[],
  node: StageNode,
  agents: Record<string, AgentConfig>,
): void {
  validatePrimaryList(label, agentIds, node.type, agents);
  if (node.type === "execute" && agentIds.length !== 1) {
    throw new Error(`${label} must contain exactly one agent`);
  }
}

function validateFallback(
  preset: Preset,
  nodes: StageNode[],
  agents: Record<string, AgentConfig>,
): void {
  const workflowStageTypes = uniqueStageTypes(nodes);
  validateFallbackAgentList("fallback.agents", preset.fallback.agents, agents, workflowStageTypes);
  for (const [stage, config] of Object.entries(preset.fallback.stage_types)) {
    const stageType = parseStageTypeKey(stage, `fallback.stage_types.${stage}`);
    validateFallbackAgentList(`fallback.stage_types.${stageType}.agents`, config.agents, agents, [stageType]);
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const [nodeId, config] of Object.entries(preset.fallback.nodes)) {
    const node = nodeById.get(nodeId);
    if (node) {
      validateFallbackAgentList(`fallback.nodes.${nodeId}.agents`, config.agents, agents, [node.type]);
    }
  }
}

function validateFallbackAgentList(
  label: string,
  agentIds: string[] | undefined,
  agents: Record<string, AgentConfig>,
  stages: StageType[],
): void {
  if (agentIds === undefined) {
    return;
  }
  validateAgentListShape(label, agentIds, MAX_FALLBACK_AGENTS);
  if (agentIds.includes("current")) {
    throw new Error(`${label} must not include current`);
  }
  for (const stage of stages) {
    validateKnownAgents(label, agentIds, agents, stage, false);
  }
}

function validateKnownAgents(
  label: string,
  agentIds: string[],
  agents: Record<string, AgentConfig>,
  stage: StageType | undefined,
  allowCurrent: boolean,
): void {
  for (const agentId of agentIds) {
    if (agentId === "current" && allowCurrent) {
      continue;
    }
    const agent = agents[agentId];
    if (!agent) {
      throw new Error(`${label} references unknown agent: ${agentId}`);
    }
    if (stage && agent.capabilities.length > 0 && !agent.capabilities.includes(stage)) {
      throw new Error(`${label} references agent without ${stage} capability: ${agentId}`);
    }
  }
}

function validateAgentListShape(label: string, agentIds: string[], maxAgents: number): void {
  if (!Array.isArray(agentIds) || !agentIds.every((agent) => typeof agent === "string" && agent.length > 0)) {
    throw new Error(`${label} must be a list of non-empty agent ids`);
  }
  if (agentIds.length > maxAgents) {
    throw new Error(`${label} must contain at most ${maxAgents} agents`);
  }
}

function validateFailurePolicyStageTypes(
  policies: Partial<Record<StageType, StageFailurePolicy>>,
): void {
  for (const stage of Object.keys(policies)) {
    parseStageTypeKey(stage, `failure_policy.stage_types.${stage}`);
  }
}

function validateFallbackSettings(label: string, value: {
  max_attempts_per_agent?: number;
  timeout_seconds?: number;
}): void {
  validateIntegerBounds(
    `${label}.max_attempts_per_agent`,
    value.max_attempts_per_agent,
    1,
    MAX_FALLBACK_ATTEMPTS_PER_AGENT,
  );
  validateIntegerBounds(
    `${label}.timeout_seconds`,
    value.timeout_seconds,
    MIN_INVOCATION_TIMEOUT_SECONDS,
    MAX_INVOCATION_TIMEOUT_SECONDS,
  );
}

function validateFallbackStageSettings(
  label: string,
  configs: Partial<Record<StageType, PresetFallbackStageTypeConfig>>,
): void {
  for (const [stage, config] of Object.entries(configs)) {
    validateFallbackSettings(`${label}.${stage}`, config);
    if (config.inherit_common !== undefined && typeof config.inherit_common !== "boolean") {
      throw new Error(`${label}.${stage}.inherit_common must be a boolean`);
    }
  }
}

function validateFallbackNodeSettings(
  label: string,
  configs: Record<string, PresetFallbackNodeConfig>,
): void {
  for (const [nodeId, config] of Object.entries(configs)) {
    validateFallbackSettings(`${label}.${nodeId}`, config);
    if (config.inherit_common !== undefined && typeof config.inherit_common !== "boolean") {
      throw new Error(`${label}.${nodeId}.inherit_common must be a boolean`);
    }
    if (
      config.inherit_stage_type !== undefined &&
      typeof config.inherit_stage_type !== "boolean"
    ) {
      throw new Error(`${label}.${nodeId}.inherit_stage_type must be a boolean`);
    }
  }
}

function resolvedPresetPrimaryAgents(
  preset: Preset,
  node: StageNode,
  globalDefaults: DefaultStageAgentsConfig | undefined,
): string[] {
  return [
    ...(
      preset.stageAssignments[node.id]
      ?? preset.defaultStageAgents.stage_types[node.type]?.agents
      ?? preset.defaultStageAgents.agents
      ?? globalDefaults?.stage_types[node.type]?.agents
      ?? globalDefaults?.agents
      ?? []
    ),
  ];
}

function optionalConfigContext(configPath?: string, cwd = process.cwd()): {
  agents: Record<string, AgentConfig>;
  defaultStageAgents?: DefaultStageAgentsConfig;
} {
  try {
    const config = loadConfigWithSources(configPath, cwd).config;
    return {
      agents: normalizeAgents(config),
      defaultStageAgents: config.default_stage_agents,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("no config found")) {
      return { agents: {} };
    }
    throw error;
  }
}

function agentList(value: unknown, label: string): string[] {
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an agent id or list of agent ids`);
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

function validatePresetId(presetId: string, label: string, _source: PresetSource): string {
  if (!LEGACY_TEMPORARY_PRESET_ID_PATTERN.test(presetId)) {
    throw new Error(
      `${label}: id must start with a letter and contain only letters, numbers, underscore, or dash`,
    );
  }
  return presetId;
}

function presetIdFromPath(presetPath: string): string {
  return path.basename(presetPath, ".toml");
}

function defaultPresetIdGenerator(): string {
  return `p-${randomBytes(4).toString("hex")}`;
}

function optionalString(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requireString(
  payload: Record<string, unknown>,
  key: string,
  presetPath: string,
): string {
  const value = optionalString(payload, key);
  if (!value) {
    throw new Error(`preset ${presetPath}: ${key} must be a non-empty string`);
  }
  return value;
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

function uniqueStageTypes(nodes: StageNode[]): StageType[] {
  return [...new Set(nodes.map((node) => node.type))];
}

function titleFromId(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function comparePresets(left: Preset, right: Preset): number {
  const sourceOrder: Record<PresetSource, number> = { user: 0, temporary: 1 };
  return (
    sourceOrder[left.source] - sourceOrder[right.source] ||
    left.presetId.localeCompare(right.presetId)
  );
}

function tomlValue(value: string): string {
  return stringifyTomlInlineValue(value);
}

function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
