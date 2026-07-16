import type { StudioApiClient } from "./client.js";

export interface StudioRunsPayload {
  schema_version?: 1;
  total?: number;
  runs: StudioRunSummary[];
  workspaces?: StudioWorkspaceRef[];
  diagnostics?: StudioRunDiagnostic[];
}

export interface StudioWorkspaceRef {
  id: string;
  label: string;
  path: string;
  current: boolean;
}

export interface StudioRunDiagnostic {
  code: string;
  message: string;
  workspace?: StudioWorkspaceRef;
}

export interface StudioRunSummary {
  run_id: string;
  title?: string;
  workspace: StudioWorkspaceRef;
  status: string;
  workflow?: string;
  latest_event?: string;
  latest_event_timestamp?: string;
  created_at?: string;
  updated_at?: string;
}

export interface StudioRunDetail {
  summary: StudioRunDetailSummary;
  status?: Record<string, unknown>;
  events: StudioRunEvent[];
  events_page?: StudioEventPage;
  artifacts: StudioArtifactSummary[];
  review_release: StudioReviewReleaseView;
}

export interface StudioRunDetailSummary extends StudioRunSummary {
  run_dir?: string;
  stages: string[];
  stage_nodes?: StudioStageNodeSummary[];
  completed_stages: string[];
  stage_timing: StudioStageTimingSummary[];
  stage_assignments?: Record<string, string[]>;
  stage_invocations?: Record<string, StudioStageInvocationSummary[]>;
  stage_attempts?: Record<string, StudioStageAttemptSummary[]>;
  current_stage?: string;
  resolved_context_policy?: Record<string, unknown>;
  resolved_execution_policy?: Record<string, unknown>;
}

export interface StudioStageNodeSummary {
  id: string;
  type: string;
  occurrence: number;
}

export interface StudioStageTimingSummary {
  stage: string;
  attempt_count: number;
  started_at?: string;
  completed_at?: string;
  failed_at?: string;
  duration_ms?: number;
  exit_code?: number | null;
}

export interface StudioStageInvocationSummary {
  agent?: string;
  kind?: string;
  [key: string]: unknown;
}

export interface StudioStageAttemptSummary {
  primary_agent?: string;
  requested_agent?: string;
  actual_agent?: string;
  status?: string;
  exit_code?: number | null;
  [key: string]: unknown;
}

export interface StudioRunEvent {
  event?: string;
  timestamp?: string;
  stage?: string;
  agent?: string;
  [key: string]: unknown;
}

export interface StudioArtifactSummary {
  name: string;
  path: string;
  kind: string;
  stage: string;
  agent?: string;
  written_at?: string;
  created_at?: string;
  timestamp?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface StudioArtifactPreview extends StudioArtifactSummary {
  content: string;
  truncated: boolean;
}

export interface StudioEventPage {
  offset: number;
  limit: number;
  total: number;
}

export interface StudioReviewReleaseView {
  release_verdict?: StudioReleaseVerdictView;
  findings: StudioReviewFindingsView;
  raw_reviews: StudioRawReviewView[];
  release_summary: StudioReleaseSummaryView;
  skipped_checks: string[];
  residual_risk: string[];
}

export interface StudioReleaseVerdictView {
  value: string | null;
  diagnostic: string | null;
}

export interface StudioReviewFindingsView {
  present: boolean;
  accepted: string[];
  rejected: string[];
  needs_decision: string[];
}

export interface StudioRawReviewView {
  reviewer: string;
  reviewer_label?: string;
  path: string;
  content: string;
  truncated: boolean;
}

export interface StudioReleaseSummaryView {
  present: boolean;
  path: string;
  truncated: boolean;
  sections: StudioMarkdownSectionView[];
}

export interface StudioMarkdownSectionView {
  heading: string;
  content: string;
  items: string[];
}

export interface StudioRunDetailOptions {
  eventOffset?: number;
  eventLimit?: number;
  workspaceId?: string;
}

export function loadStudioRuns(client: StudioApiClient): Promise<StudioRunsPayload> {
  return client.getJson<StudioRunsPayload>("/api/runs");
}

export function loadStudioRunDetail(
  client: StudioApiClient,
  runId: string,
  options: StudioRunDetailOptions = {},
): Promise<StudioRunDetail> {
  const params = new URLSearchParams();
  if (options.eventOffset !== undefined) {
    params.set("event_offset", String(options.eventOffset));
  }
  if (options.eventLimit !== undefined) {
    params.set("event_limit", String(options.eventLimit));
  }
  if (options.workspaceId) {
    params.set("workspace_id", options.workspaceId);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return client.getJson<StudioRunDetail>(`/api/runs/${encodeURIComponent(runId)}${query}`);
}

export function loadStudioArtifactPreview(
  client: StudioApiClient,
  runId: string,
  artifactName: string,
  workspaceId?: string,
): Promise<StudioArtifactPreview> {
  const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
  return client.getJson<StudioArtifactPreview>(
    `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactName)}${query}`,
  );
}

export function studioRunKey(run: StudioRunSummary): string {
  return `${run.workspace.id}:${run.run_id}`;
}

export function nextSelectedRunKey(
  runs: StudioRunSummary[],
  currentRunKey: string | undefined,
): string | undefined {
  if (currentRunKey && runs.some((run) => studioRunKey(run) === currentRunKey)) {
    return currentRunKey;
  }
  return runs[0] ? studioRunKey(runs[0]) : undefined;
}

export const nextSelectedRunId = nextSelectedRunKey;
