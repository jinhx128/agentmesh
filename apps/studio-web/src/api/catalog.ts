import type { StudioApiClient } from "./client.js";

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
  disabled?: boolean;
  status?: "enabled" | "disabled";
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
  defaultAgents?: string[];
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
  target: "agents" | "workflows" | "presets" | "mcp" | "catalog";
  message: string;
}

export function loadStudioCatalog(client: StudioApiClient): Promise<StudioCatalog> {
  return client.getJson<StudioCatalog>("/api/catalog");
}
