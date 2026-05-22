import type {
  StudioApiClient,
  StudioApiJsonResponse,
} from "./client.js";

export interface StudioWorkflowCreateRequest {
  workflow_file?: string;
  workflow_toml?: string;
  source_name?: string;
}

export interface StudioWorkflowUpdateRequest extends StudioWorkflowCreateRequest {}

export interface StudioWorkflowLifecycleOperation {
  operation_id: string;
  action: "create" | "update" | "delete";
  status: "running" | "succeeded" | "failed" | "conflict";
  command: string[];
  exit_code: number | null;
  stdout: string;
  stderr: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  workflow_id?: string;
  workflow_file?: string;
}

export type StudioWorkflowLifecycleResponse = StudioApiJsonResponse<StudioWorkflowLifecycleOperation>;

export function submitStudioWorkflowCreate(
  client: StudioApiClient,
  request: StudioWorkflowCreateRequest,
): Promise<StudioWorkflowLifecycleResponse> {
  return client.postJsonWithStatus<StudioWorkflowLifecycleOperation>("/api/v1/workflows", request);
}

export function submitStudioWorkflowUpdate(
  client: StudioApiClient,
  workflowId: string,
  request: StudioWorkflowUpdateRequest,
): Promise<StudioWorkflowLifecycleResponse> {
  return client.putJsonWithStatus<StudioWorkflowLifecycleOperation>(
    `/api/v1/workflows/${encodeURIComponent(workflowId)}`,
    request,
  );
}

export function submitStudioWorkflowDelete(
  client: StudioApiClient,
  workflowId: string,
): Promise<StudioWorkflowLifecycleResponse> {
  return client.deleteJsonWithStatus<StudioWorkflowLifecycleOperation>(
    `/api/v1/workflows/${encodeURIComponent(workflowId)}`,
  );
}
