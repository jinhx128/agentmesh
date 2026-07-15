import type { StudioApiClient, StudioApiJsonResponse } from "./client.js";

export type AgentMeshSkillTarget = "codex" | "cursor" | "antigravity" | "opencode" | "claude";
export type ProviderCliTool = "codex" | "claude" | "cursor" | "antigravity" | "opencode";
export type ProviderCliResolutionSource =
  | "configured_path"
  | "path"
  | "app_preference"
  | "well_known"
  | "login_shell_probe"
  | "missing";

export interface StudioIntegrationsReport {
  schema_version: 1;
  entrypoint: string;
  workspace: string;
  command_line_tool: {
    supported: boolean;
    package_name: "@jinhx128/agentmesh";
    installed: boolean;
    path?: string;
    source: ProviderCliResolutionSource;
    installed_version: string;
    latest_version: string;
    status: "missing" | "current" | "update_available" | "unknown";
    diagnostics: string[];
  };
  provider_clis: {
    tools: StudioProviderCliToolReport[];
  };
  skills: {
    targets: StudioSkillTargetReport[];
  };
}

export interface StudioProviderCliToolReport {
  tool: ProviderCliTool;
  adapter: string;
  label: string;
  command: string;
  found: boolean;
  source: ProviderCliResolutionSource;
  path?: string;
  version: string;
  diagnostics: string[];
  diagnostic?: string;
}

export interface StudioSkillTargetReport {
  target: AgentMeshSkillTarget;
  expected_path: string;
  status: "ok" | "missing" | "unreadable" | "content_mismatch" | "legacy_only" | "failed";
  ok: boolean;
  expected: boolean;
  hint?: string;
}

export interface InstallCommandLineToolResponse extends StudioIntegrationsReport {
  operation: {
    npm_path: string;
    args: string[];
    exit_code: number;
    stdout: string;
    stderr: string;
  };
}

export interface InstallAgentSkillsResponse extends StudioIntegrationsReport {
  installed_targets: Array<{
    target: AgentMeshSkillTarget;
    ok: boolean;
    files: StudioSkillTargetReport[];
    error?: string;
  }>;
}

export type InstallCommandLineToolRequest = Record<string, never>;

export interface InstallAgentSkillsRequest {
  targets: AgentMeshSkillTarget[];
  force: boolean;
}

export function loadStudioIntegrations(client: StudioApiClient): Promise<StudioIntegrationsReport> {
  return client.getJson<StudioIntegrationsReport>("/api/desktop/integrations");
}

export function installCommandLineTool(
  client: StudioApiClient,
  request: InstallCommandLineToolRequest,
): Promise<StudioApiJsonResponse<InstallCommandLineToolResponse | { error: string }>> {
  return client.postJsonWithStatus<InstallCommandLineToolResponse | { error: string }>(
    "/api/desktop/integrations/command-line-tool",
    request,
  );
}

export function installAgentSkills(
  client: StudioApiClient,
  request: InstallAgentSkillsRequest,
): Promise<StudioApiJsonResponse<InstallAgentSkillsResponse | { error: string }>> {
  return client.postJsonWithStatus<InstallAgentSkillsResponse | { error: string }>(
    "/api/desktop/integrations/skills",
    request,
  );
}
