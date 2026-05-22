import type { StudioApiClient } from "./client.js";

export type StudioConfigSource = "user" | "project" | "explicit";
export type StudioStageType = "plan" | "execute" | "verify" | "review" | "decide";

export interface StudioConfigSourceRef {
  source: StudioConfigSource;
  path: string;
}

export interface StudioDefaultStageAgentsConfig {
  agents?: string[];
  stage_types: Partial<Record<StudioStageType, { agents: string[] }>>;
}

export interface StudioFallbackConfig {
  agents?: string[];
  max_attempts_per_agent?: number;
  timeout_seconds?: number;
  stage_types: Partial<Record<StudioStageType, {
    agents?: string[];
    inherit_common?: boolean;
    max_attempts_per_agent?: number;
    timeout_seconds?: number;
  }>>;
}

export interface StudioRunDefaultsConfig {
  dispatch_timeout_secs?: number;
  adapter_timeout_secs?: number;
  event_page_size?: number;
  retry_attempts?: number;
}

export interface StudioExecutionPolicyConfig {
  max_fanout_concurrency?: number;
  max_dispatch_timeout_secs?: number;
  max_adapter_timeout_secs?: number;
  max_retry_attempts?: number;
  require_user_gate?: boolean;
  allow_auto_dispatch?: boolean;
}

export interface StudioAdvancedSettingsConfig {
  default_stage_agents: StudioDefaultStageAgentsConfig;
  fallback: StudioFallbackConfig;
  run_defaults: StudioRunDefaultsConfig;
  execution_policy: StudioExecutionPolicyConfig;
  model_aliases: Record<string, { adapter: string; model: string }>;
  capability_profile_preferences: Record<string, { agents: string[] }>;
}

export interface StudioAdvancedSettingsPayload {
  user_config_path: string;
  layers: StudioConfigSourceRef[];
  user: StudioAdvancedSettingsConfig;
  resolved: StudioAdvancedSettingsConfig;
  diagnostics: Array<{ target: "advanced"; message: string }>;
}

export interface StudioAdvancedSettingsUpdateRequest {
  default_stage_agents?: {
    agents?: string[] | null;
    stage_types?: Partial<Record<StudioStageType, { agents?: string[] | null } | null>>;
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

export function loadStudioAdvancedSettings(client: StudioApiClient): Promise<StudioAdvancedSettingsPayload> {
  return client.getJson<StudioAdvancedSettingsPayload>("/api/v1/settings/advanced");
}

export function updateStudioAdvancedSettings(
  client: StudioApiClient,
  request: StudioAdvancedSettingsUpdateRequest,
): Promise<StudioAdvancedSettingsPayload> {
  return client.putJson<StudioAdvancedSettingsPayload>("/api/v1/settings/advanced", request);
}
