import {
  getWorkflow,
  listAgents,
  listWorkflows,
} from "@agentmesh/sdk";
import { loadConfigWithSources } from "@agentmesh/runtime/src/config.js";
import {
  listPresets,
  presetSearchDirs,
} from "@agentmesh/runtime/src/preset/registry.js";
import { realpathSync } from "node:fs";
import path from "node:path";

export interface StudioCatalogOptions {
  cwd?: string;
  configPath?: string;
}

export interface StudioCatalog {
  agents: StudioCatalogAgent[];
  workflows: StudioCatalogWorkflow[];
  presets: StudioCatalogPreset[];
  mcpServers: StudioCatalogMcpServer[];
  diagnostics: StudioCatalogDiagnostic[];
}

export interface StudioCatalogAgent {
  id: string;
  label: string;
  adapter: string;
  capabilities: string[];
  model?: string;
  reasoning_effort?: string;
  disabled: boolean;
  status: "enabled" | "disabled";
  source_layer?: string;
}

export interface StudioCatalogWorkflow {
  workflowId: string;
  name: string;
  source: string;
  stages: string[];
  description?: string;
  whenToUse?: string[];
  packetArtifacts?: string[];
  qualityGates?: string[];
  path?: string;
}

export interface StudioCatalogPreset {
  presetId: string;
  name: string;
  workflowId: string;
  description?: string;
  source: string;
  path?: string;
  stageAssignments: Record<string, string[]>;
  defaultAgents: string[];
  validationWarnings: string[];
}

export interface StudioCatalogMcpServer {
  id: string;
  command: string;
  args: string[];
  resource_hints: string[];
  source_layer?: string;
  source_path?: string;
}

export interface StudioCatalogDiagnostic {
  target: "agents" | "workflows" | "presets" | "mcp";
  message: string;
}

export function readStudioCatalog(options: StudioCatalogOptions = {}): StudioCatalog {
  const cwd = options.cwd ?? process.cwd();
  const readOptions = {
    cwd,
    ...(options.configPath ? { configPath: options.configPath } : {}),
  };
  const agentResult = readSdkJsonArray("agents", () => listAgents(readOptions));
  const workflowResult = readSdkJsonArray("workflows", () =>
    listWorkflows(readOptions).map((workflow) => workflowDetailOrSummary(workflow.workflowId, workflow, readOptions)));
  const presetResult = readSdkJsonArray("presets", () =>
    listPresets(presetSearchDirs(cwd, options.configPath), cwd, options.configPath));
  const mcpResult = readMcpConfig(readOptions);
  const agents = agentResult.items
    .map(catalogAgent)
    .filter((agent): agent is StudioCatalogAgent => agent !== undefined);
  const workflows = workflowResult.items
    .map(catalogWorkflow)
    .filter((workflow): workflow is StudioCatalogWorkflow => workflow !== undefined);
  const presets = presetResult.items
    .map(catalogPreset)
    .filter((preset): preset is StudioCatalogPreset => preset !== undefined);
  const mcpServers = mcpResult.items
    .map(catalogMcpServer)
    .filter((server): server is StudioCatalogMcpServer => server !== undefined);
  return {
    agents,
    workflows,
    presets,
    mcpServers,
    diagnostics: [
      ...agentResult.diagnostics,
      ...workflowResult.diagnostics,
      ...presetResult.diagnostics,
      ...mcpResult.diagnostics,
    ],
  };
}

function readMcpConfig(
  options: { cwd: string; configPath?: string },
): { items: unknown[]; diagnostics: StudioCatalogDiagnostic[] } {
  try {
    const loaded = loadConfigWithSources(options.configPath, options.cwd);
    return {
      items: Object.entries(loaded.config.mcp_servers)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, config]) => ({
          id,
          command: stringValue(config.command) ?? "",
          args: stringArray(config.args),
          resource_hints: stringArray(config.resource_hints),
          ...(loaded.mcpServerSources[id]?.source ? { source_layer: loaded.mcpServerSources[id].source } : {}),
          ...(sourcePath(loaded.mcpServerSources[id]?.path)
            ? { source_path: sourcePath(loaded.mcpServerSources[id]?.path) }
            : {}),
        })),
      diagnostics: [],
    };
  } catch (error) {
    return {
      items: [],
      diagnostics: [{
        target: "mcp",
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
}

function sourcePath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function readSdkJsonArray(
  target: "agents" | "workflows" | "presets",
  reader: () => unknown[],
): { items: unknown[]; diagnostics: StudioCatalogDiagnostic[] } {
  try {
    return { items: reader(), diagnostics: [] };
  } catch (error) {
    return {
      items: [],
      diagnostics: [{ target, message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

function catalogPreset(value: unknown): StudioCatalogPreset | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const presetId = stringValue(value.presetId);
  const name = presetId ? stringValue(value.name) ?? titleFromId(presetId) : undefined;
  const workflowId = stringValue(value.workflowId);
  const source = stringValue(value.source);
  if (!presetId || !name || !workflowId || !source) {
    return undefined;
  }
  return {
    presetId,
    name,
    workflowId,
    source,
    stageAssignments: stringArrayRecord(value.stageAssignments),
    defaultAgents: defaultPresetAgents(value.defaultStageAgents),
    validationWarnings: stringArray(value.validationWarnings),
    ...(stringValue(value.description) ? { description: stringValue(value.description) } : {}),
    ...(stringValue(value.path) ? { path: sourcePath(stringValue(value.path)) } : {}),
  };
}

function catalogAgent(value: unknown): StudioCatalogAgent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = stringValue(value.id);
  const label = stringValue(value.label);
  const adapter = stringValue(value.adapter);
  if (!id || !label || !adapter) {
    return undefined;
  }
  return {
    id,
    label,
    adapter,
    capabilities: stringArray(value.capabilities),
    disabled: value.disabled === true,
    status: value.disabled === true ? "disabled" : stringValue(value.status) === "disabled" ? "disabled" : "enabled",
    ...(stringValue(value.model) ? { model: stringValue(value.model) } : {}),
    ...(stringValue(value.reasoning_effort) ? { reasoning_effort: stringValue(value.reasoning_effort) } : {}),
    ...(stringValue(value.source_layer) ? { source_layer: stringValue(value.source_layer) } : {}),
  };
}

function catalogWorkflow(value: unknown): StudioCatalogWorkflow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const workflowId = stringValue(value.workflowId);
  const name = stringValue(value.name);
  const source = stringValue(value.source);
  if (!workflowId || !name || !source) {
    return undefined;
  }
  return {
    workflowId,
    name,
    source,
    stages: stringArray(value.stages),
    ...(stringValue(value.description) ? { description: stringValue(value.description) } : {}),
    ...(stringArray(value.whenToUse).length > 0 ? { whenToUse: stringArray(value.whenToUse) } : {}),
    ...(stringArray(value.packetArtifacts).length > 0 ? { packetArtifacts: stringArray(value.packetArtifacts) } : {}),
    ...(stringArray(value.qualityGates).length > 0 ? { qualityGates: stringArray(value.qualityGates) } : {}),
    ...(stringValue(value.path) ? { path: sourcePath(stringValue(value.path)) } : {}),
  };
}

function workflowDetailOrSummary(
  workflowId: string,
  summary: unknown,
  options: { cwd: string; configPath?: string },
): unknown {
  try {
    return getWorkflow(workflowId, options);
  } catch {
    return summary;
  }
}

function defaultPresetAgents(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }
  return stringArray(value.agents);
}

function titleFromId(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function catalogMcpServer(value: unknown): StudioCatalogMcpServer | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = stringValue(value.id);
  const command = stringValue(value.command);
  if (!id || !command) {
    return undefined;
  }
  return {
    id,
    command,
    args: stringArray(value.args),
    resource_hints: stringArray(value.resource_hints),
    ...(stringValue(value.source_layer) ? { source_layer: stringValue(value.source_layer) } : {}),
    ...(stringValue(value.source_path) ? { source_path: stringValue(value.source_path) } : {}),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringArrayRecord(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, stringArray(entry)] as const)
      .filter(([, entry]) => entry.length > 0),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
