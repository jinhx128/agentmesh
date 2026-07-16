import type { StudioApiClient, StudioApiJsonResponse } from "./client.js";

export type StudioCallStatus = "running" | "success" | "failed" | "aborted" | "timeout" | "stale";
export type StudioCallAdoptionStatus = "unreviewed" | "accepted" | "rejected" | "superseded";

export interface StudioCallArtifactRef {
  kind: "file";
  path: string;
  sha256: string | null;
  redaction_state: string;
  authoritative: boolean;
}

export interface StudioCallWarning {
  code: string;
  message: string;
  path?: string;
}

export interface StudioWorkspaceRef {
  id: string;
  label: string;
  path: string;
  current: boolean;
}

export interface StudioCallDiagnostic {
  code: string;
  message: string;
  workspace?: StudioWorkspaceRef;
}

export interface StudioCallSummary {
  schema_version: number;
  id: string;
  title?: string;
  workspace: StudioWorkspaceRef;
  agent_id: string | null;
  adapter: string;
  model: string | null;
  purpose: string;
  status: StudioCallStatus;
  cwd: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  heartbeat_at: string | null;
  prompt_source: string;
  prompt_ref: StudioCallArtifactRef | null;
  output_ref: StudioCallArtifactRef | null;
  output_path: string | null;
  exit_code: number | null;
  error_kind: string;
  error_summary: string | null;
  redaction_state: string;
  redactions_applied: string[];
  related_files: string[];
  related_run_ids: string[];
  related_call_ids: string[];
  tokens_in: number | null;
  tokens_out: number | null;
  cost_estimate_usd: number | null;
  adoption_status: StudioCallAdoptionStatus;
  read_only?: boolean;
  schema_warning?: string;
  unsupported_schema: boolean;
  warnings: StudioCallWarning[];
}

export interface StudioCallGroup {
  date: string;
  calls: StudioCallSummary[];
}

export interface StudioCallsPayload {
  schema_version: 1;
  total: number;
  calls: StudioCallSummary[];
  groups: StudioCallGroup[];
  workspaces: StudioWorkspaceRef[];
  diagnostics: StudioCallDiagnostic[];
}

export interface StudioCallPreview {
  present: boolean;
  path: string | null;
  content: string;
  truncated: boolean;
  sha256: string | null;
  redaction_state: string | null;
  authoritative: boolean | null;
}

export interface StudioCallAdoptionEvent {
  schema_version: number;
  call_id: string;
  previous_status: StudioCallAdoptionStatus;
  status: Exclude<StudioCallAdoptionStatus, "unreviewed">;
  updated_at: string;
  updated_by_entrypoint: string;
  reason: string | null;
  related_commit: string | null;
  related_run_id: string | null;
  superseded_by_call_id: string | null;
}

export interface StudioCallDetail {
  schema_version: 1;
  call: StudioCallSummary;
  prompt: StudioCallPreview;
  output: StudioCallPreview;
  stderr: StudioCallPreview;
  adoption_events: StudioCallAdoptionEvent[];
  warnings: StudioCallWarning[];
}

export interface StudioCallAdoptionRequest {
  status: Exclude<StudioCallAdoptionStatus, "unreviewed">;
  reason?: string;
  related_commit?: string;
  related_run_id?: string;
  superseded_by_call_id?: string;
}

export interface StudioCallAdoptionError {
  error: string;
}

export type StudioCallAdoptionResponse = StudioApiJsonResponse<
  StudioCallDetail | StudioCallAdoptionError
>;

export function loadStudioCalls(client: StudioApiClient): Promise<StudioCallsPayload> {
  return client.getJson<StudioCallsPayload>("/api/calls");
}

export function loadStudioCallDetail(
  client: StudioApiClient,
  callId: string,
  workspaceId?: string,
): Promise<StudioCallDetail> {
  return client.getJson<StudioCallDetail>(
    withWorkspaceId(`/api/calls/${encodeURIComponent(callId)}`, workspaceId),
  );
}

export function submitStudioCallAdoption(
  client: StudioApiClient,
  callId: string,
  request: StudioCallAdoptionRequest,
  workspaceId?: string,
): Promise<StudioCallAdoptionResponse> {
  return client.postJsonWithStatus<StudioCallDetail | StudioCallAdoptionError>(
    withWorkspaceId(`/api/calls/${encodeURIComponent(callId)}/adoption`, workspaceId),
    request,
  );
}

export function studioCallKey(call: StudioCallSummary): string {
  return `${call.workspace.id}:${call.id}`;
}

export function nextSelectedCallKey(
  calls: StudioCallSummary[],
  currentCallKey: string | undefined,
): string | undefined {
  if (currentCallKey && calls.some((call) => studioCallKey(call) === currentCallKey)) {
    return currentCallKey;
  }
  return calls[0] ? studioCallKey(calls[0]) : undefined;
}

export const nextSelectedCallId = nextSelectedCallKey;

function withWorkspaceId(url: string, workspaceId: string | undefined): string {
  if (!workspaceId) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}workspace_id=${encodeURIComponent(workspaceId)}`;
}
