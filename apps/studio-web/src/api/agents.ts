import type {
  StudioApiClient,
  StudioApiJsonResponse,
} from "./client.js";

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
}

export interface StudioAgentUpdateRequest {
  adapter: string;
  model: string;
  label?: string;
  capabilities?: string[];
  reasoning_effort?: string;
  timeout_seconds?: number;
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

export type StudioAgentLifecycleResponse = StudioApiJsonResponse<StudioAgentLifecycleOperation>;

export type StudioAgentLifecycleSubmit =
  | { action: "create"; request: StudioAgentCreateRequest }
  | { action: "update"; agentId: string; request: StudioAgentUpdateRequest }
  | { action: "delete" | "enable" | "disable"; agentId: string };

export function loadStudioAgents(client: StudioApiClient): Promise<StudioAgentListPayload> {
  return client.getJson<StudioAgentListPayload>("/api/v1/agents");
}

export function loadStudioAgentModels(
  client: StudioApiClient,
  adapter: string,
): Promise<StudioAgentModelListPayload> {
  return client.getJson<StudioAgentModelListPayload>(
    `/api/v1/agents/models?adapter=${encodeURIComponent(adapter)}`,
  );
}

export function submitStudioAgentLifecycleOperation(
  client: StudioApiClient,
  submit: StudioAgentLifecycleSubmit,
): Promise<StudioAgentLifecycleResponse> {
  if (submit.action === "create") {
    return client.postJsonWithStatus<StudioAgentLifecycleOperation>("/api/v1/agents", submit.request);
  }
  if (submit.action === "delete") {
    return client.deleteJsonWithStatus<StudioAgentLifecycleOperation>(
      `/api/v1/agents/${encodeURIComponent(submit.agentId)}`,
    );
  }
  if (submit.action === "update") {
    return client.putJsonWithStatus<StudioAgentLifecycleOperation>(
      `/api/v1/agents/${encodeURIComponent(submit.agentId)}`,
      submit.request,
    );
  }
  return client.postJsonWithStatus<StudioAgentLifecycleOperation>(
    `/api/v1/agents/${encodeURIComponent(submit.agentId)}/${submit.action}`,
    {},
  );
}
