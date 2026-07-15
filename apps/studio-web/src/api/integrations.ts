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
    default_bin_dir: string;
    target_path: string;
    requires_confirmation: boolean;
    path_command: {
      found: boolean;
      path?: string;
      source: "missing" | "app_wrapper" | "external";
      version: string;
      diagnostic?: string;
    };
    target_file: {
      exists: boolean;
      source: "missing" | "app_wrapper" | "external";
      version: string;
      different: boolean;
      diagnostic?: string;
    };
    app_wrapper: {
      node_path?: string;
      cli_path?: string;
      channel?: string;
      version: string;
    };
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
  installed: {
    path: string;
    replaced_existing: boolean;
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

export interface InstallCommandLineToolRequest {
  bin_dir: string;
  confirm_existing: boolean;
}

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
