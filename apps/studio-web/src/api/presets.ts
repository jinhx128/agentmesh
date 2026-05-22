import type {
  StudioApiClient,
  StudioApiJsonResponse,
} from "./client.js";

export interface StudioPresetCreateRequest {
  preset_file?: string;
  preset_toml?: string;
  source_name?: string;
}

export interface StudioPresetUpdateRequest extends StudioPresetCreateRequest {}

export interface StudioPresetLifecycleOperation {
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
  preset_id?: string;
  preset_file?: string;
}

export type StudioPresetLifecycleResponse = StudioApiJsonResponse<StudioPresetLifecycleOperation>;

export function submitStudioPresetCreate(
  client: StudioApiClient,
  request: StudioPresetCreateRequest,
): Promise<StudioPresetLifecycleResponse> {
  return client.postJsonWithStatus<StudioPresetLifecycleOperation>("/api/v1/presets", request);
}

export function submitStudioPresetUpdate(
  client: StudioApiClient,
  presetId: string,
  request: StudioPresetUpdateRequest,
): Promise<StudioPresetLifecycleResponse> {
  return client.putJsonWithStatus<StudioPresetLifecycleOperation>(
    `/api/v1/presets/${encodeURIComponent(presetId)}`,
    request,
  );
}

export function submitStudioPresetDelete(
  client: StudioApiClient,
  presetId: string,
): Promise<StudioPresetLifecycleResponse> {
  return client.deleteJsonWithStatus<StudioPresetLifecycleOperation>(
    `/api/v1/presets/${encodeURIComponent(presetId)}`,
  );
}
