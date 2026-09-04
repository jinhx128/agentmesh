import { existsSync, statSync } from "node:fs";
import path from "node:path";

import {
  currentWorkspaceRegistryEntry,
  listRegisteredWorkspaces,
  resolveRegisteredWorkspace,
  type WorkspaceRegistryEntry,
} from "@agentmesh/runtime/src/workspaces/registry.js";
import {
  getWorkspaceCompatibility,
  getRun,
  listRuns,
  readArtifactPreview,
  type AgentMeshArtifactPreview,
  type AgentMeshArtifactSummary,
  type AgentMeshEventPage,
  type AgentMeshMarkdownSectionView,
  type AgentMeshRawReviewView,
  type AgentMeshReleaseVerdictView,
  type AgentMeshReviewReleaseView,
  type AgentMeshRunDetail,
  type AgentMeshRunReadOptions,
  type AgentMeshRunSummary,
  type AgentMeshStageTimingSummary,
  type AgentMeshWorkspaceCompatibility,
} from "@agentmesh/sdk";
import {
  workspaceCompatibilityDiagnostics,
  type WorkspaceCompatibilityDiagnostics,
} from "@agentmesh/runtime/src/packet/compatibility.js";

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

export interface StudioRunSummary extends AgentMeshRunSummary {
  workspace: StudioWorkspaceRef;
}

export type StudioStageTimingSummary = AgentMeshStageTimingSummary;
export type StudioArtifactSummary = AgentMeshArtifactSummary;
export type StudioRunActionState = "completed" | "running" | "failed" | "timed_out" | "aborted" | "awaiting_current" | "incomplete";
export type StudioRunActionBlockReason = "auto_dispatch_disabled" | "retry_limit_reached" | "unassigned_stage";
export interface StudioRunAction {
  action: "dispatch" | "retry" | "resume" | "attach";
  stage: string;
}
export interface StudioRunActions {
  state: StudioRunActionState;
  current_stage?: string;
  next_stage?: string;
  blocked_reason?: StudioRunActionBlockReason;
  actions: StudioRunAction[];
}
export interface StudioRunDetail extends Omit<AgentMeshRunDetail, "summary"> {
  summary: StudioRunSummary;
  run_actions: StudioRunActions;
}
export type StudioEventPage = AgentMeshEventPage;
export type StudioArtifactPreview = AgentMeshArtifactPreview;
export type StudioReleaseVerdictView = AgentMeshReleaseVerdictView;
export type StudioReviewReleaseView = AgentMeshReviewReleaseView;
export type StudioRawReviewView = AgentMeshRawReviewView;
export type StudioMarkdownSectionView = AgentMeshMarkdownSectionView;
export interface StudioReadOptions extends AgentMeshRunReadOptions {
  entrypoint?: string;
  registryPath?: string;
  scope?: "all" | "current" | "workspace";
  workspaceId?: string;
}
export type StudioWorkspaceCompatibility = AgentMeshWorkspaceCompatibility | WorkspaceCompatibilityDiagnostics;

export interface StudioRunIndex {
  schema_version: 1;
  total: number;
  runs: StudioRunSummary[];
  workspaces: StudioWorkspaceRef[];
  diagnostics: StudioRunDiagnostic[];
}

export function readStudioCompatibility(
  options: StudioReadOptions = {},
): StudioWorkspaceCompatibility {
  return options.entrypoint
    ? workspaceCompatibilityDiagnostics(options.cwd ?? process.cwd(), { entrypoint: options.entrypoint })
    : getWorkspaceCompatibility({ cwd: options.cwd });
}

export function listStudioRunIndex(options: StudioReadOptions = {}): StudioRunIndex {
  const cwd = options.cwd ?? process.cwd();
  const { workspaces, diagnostics } = visibleStudioWorkspaces(cwd, options);
  const runs = workspaces.flatMap((workspace) => {
    if (!isReadableDirectory(workspace.path)) {
      diagnostics.push({
        code: "workspace_missing",
        message: `workspace path is not readable: ${workspace.path}`,
        workspace,
      });
      return [];
    }
    try {
      return listRuns({
        cwd: workspace.path,
        eventTail: options.eventTail ?? 1,
        page: 1,
        pageSize: Number.MAX_SAFE_INTEGER,
        reviewerSessions: options.reviewerSessions,
      }).runs.map((run) => studioRunSummary(run, workspace));
    } catch (error) {
      diagnostics.push({
        code: "workspace_run_list_failed",
        message: error instanceof Error ? error.message : String(error),
        workspace,
      });
      return [];
    }
  }).sort(compareStudioRuns);
  return {
    schema_version: 1,
    total: runs.length,
    runs,
    workspaces,
    diagnostics,
  };
}

export function listStudioRuns(options: StudioReadOptions = {}): StudioRunSummary[] {
  return listStudioRunIndex(options).runs;
}

export function readStudioRun(
  runIdOrDir: string,
  options: StudioReadOptions = {},
): StudioRunDetail {
  const cwd = options.cwd ?? process.cwd();
  const workspace = resolveStudioWorkspace(cwd, options);
  const runDir = resolveStudioRunDirectory(runIdOrDir, workspace.path);
  const detail = getRun(runDir, { ...options, cwd: workspace.path });
  const summary = studioRunSummary(detail.summary, workspace);
  return {
    ...detail,
    summary,
    run_actions: studioRunActions(summary, detail.status),
  };
}

export function studioRunActions(
  summary: StudioRunSummary,
  status: Record<string, unknown> = {},
): StudioRunActions {
  if (summary.run_status === "completed") {
    return { state: "completed", actions: [] };
  }
  if (summary.run_status === "aborted") {
    return { state: "aborted", actions: [] };
  }
  const nextStage = summary.current_stage;
  if (!nextStage) {
    return { state: "incomplete", blocked_reason: "unassigned_stage", actions: [] };
  }
  const stageContext = {
    current_stage: nextStage,
    next_stage: nextStage,
  };
  if (summary.run_status === "running") {
    return { state: "running", ...stageContext, actions: [] };
  }

  const autoDispatchAllowed = resolvedBoolean(status.resolved_execution_policy, "allow_auto_dispatch") !== false;
  if (summary.run_status === "failed" || summary.run_status === "timed_out") {
    const retryAllowed = studioRetryAllowed(summary, status, nextStage);
    const failedAgents = summary.stage_assignments?.[nextStage] ?? [];
    if (failedAgents.length === 0) {
      return {
        state: summary.run_status,
        ...stageContext,
        blocked_reason: "unassigned_stage",
        actions: [],
      };
    }
    const blockedReason = !autoDispatchAllowed
      ? "auto_dispatch_disabled" as const
      : !retryAllowed
        ? "retry_limit_reached" as const
        : undefined;
    return {
      state: summary.run_status,
      ...stageContext,
      ...(blockedReason ? { blocked_reason: blockedReason } : {}),
      actions: blockedReason
        ? []
        : [
            { action: "retry", stage: nextStage },
            { action: "resume", stage: nextStage },
          ],
    };
  }

  const agents = summary.stage_assignments?.[nextStage] ?? [];
  if (summary.run_status === "awaiting_current") {
    return {
      state: "awaiting_current",
      ...stageContext,
      actions: [{ action: "attach", stage: nextStage }],
    };
  }
  if (agents.length === 0) {
    return {
      state: "incomplete",
      ...stageContext,
      blocked_reason: "unassigned_stage",
      actions: [],
    };
  }
  if (!autoDispatchAllowed) {
    return {
      state: "incomplete",
      ...stageContext,
      blocked_reason: "auto_dispatch_disabled",
      actions: [],
    };
  }
  return {
    state: "incomplete",
    ...stageContext,
    actions: studioRunHasStarted(summary)
      ? [{ action: "resume", stage: nextStage }]
      : [{ action: "dispatch", stage: "all" }],
  };
}

export function readStudioArtifactPreview(
  runIdOrDir: string,
  artifactName: string,
  options: StudioReadOptions = {},
): StudioArtifactPreview {
  const cwd = options.cwd ?? process.cwd();
  const workspace = resolveStudioWorkspace(cwd, options);
  const runDir = resolveStudioRunDirectory(runIdOrDir, workspace.path);
  return readArtifactPreview(runDir, artifactName, { ...options, cwd: workspace.path });
}

export function resolveStudioRunDirectory(runIdOrDir: string, cwd = process.cwd()): string {
  if (!/^[A-Za-z0-9._-]+$/.test(runIdOrDir)) {
    throw new Error(`invalid run id: ${runIdOrDir}`);
  }
  const runsDir = path.resolve(cwd, ".agentmesh", "runs");
  const runDir = path.resolve(runsDir, runIdOrDir);
  const relative = path.relative(runsDir, runDir);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`invalid run id: ${runIdOrDir}`);
  }
  if (!existsSync(path.join(runDir, "status.json"))) {
    throw new Error(`run not found: ${runIdOrDir}`);
  }
  return runDir;
}

export function isInvalidStudioRunIdError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.startsWith("invalid run id:") || message === "run id cannot be empty";
}

export function isMissingStudioRunError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.startsWith("run not found:") || message.startsWith("workspace not found:");
}

export function isMissingStudioArtifactError(error: unknown): boolean {
  return errorMessage(error).startsWith("artifact not found:");
}

function studioRunSummary(run: AgentMeshRunSummary, workspace: StudioWorkspaceRef): StudioRunSummary {
  return {
    ...run,
    workspace,
  };
}

function studioRetryAllowed(
  summary: StudioRunSummary,
  status: Record<string, unknown>,
  stage: string,
): boolean {
  const maxRetryAttempts = resolvedNumber(status.resolved_execution_policy, "max_retry_attempts");
  if (maxRetryAttempts === undefined) {
    return true;
  }
  const attemptCount = summary.stage_timing.find((item) => item.stage === stage)?.attempt_count ?? 0;
  return Math.max(0, attemptCount - 1) < maxRetryAttempts;
}

function studioRunHasStarted(summary: StudioRunSummary): boolean {
  return Object.values(summary.stage_status).some((status) => status !== "planned")
    || summary.stage_timing.some((timing) => timing.attempt_count > 0);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvedBoolean(value: unknown, key: string): boolean | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return typeof value[key] === "boolean" ? value[key] : undefined;
}

function resolvedNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : undefined;
}

function visibleStudioWorkspaces(
  cwd: string,
  options: StudioReadOptions,
): { workspaces: StudioWorkspaceRef[]; diagnostics: StudioRunDiagnostic[] } {
  const diagnostics: StudioRunDiagnostic[] = [];
  const current = workspaceRef(currentWorkspaceRegistryEntry(cwd), true);
  const byId = new Map<string, StudioWorkspaceRef>([[current.id, current]]);
  try {
    for (const entry of listRegisteredWorkspaces({ registryPath: options.registryPath })) {
      if (!entry.enabled) {
        continue;
      }
      const existing = byId.get(entry.id);
      byId.set(
        entry.id,
        existing
          ? { ...workspaceRef(entry, existing.current), current: existing.current }
          : workspaceRef(entry, false),
      );
    }
  } catch (error) {
    diagnostics.push({
      code: "workspace_registry_unreadable",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const workspaces = [...byId.values()];
  if (options.scope === "current") {
    return { workspaces: [current], diagnostics };
  }
  if (options.scope === "workspace" && options.workspaceId) {
    return {
      workspaces: workspaces.filter((workspace) => workspace.id === options.workspaceId),
      diagnostics,
    };
  }
  return { workspaces, diagnostics };
}

function resolveStudioWorkspace(cwd: string, options: StudioReadOptions): StudioWorkspaceRef {
  if (!options.workspaceId) {
    return workspaceRef(currentWorkspaceRegistryEntry(cwd), true);
  }
  const entry = resolveRegisteredWorkspace(options.workspaceId, {
    currentWorkspace: cwd,
    registryPath: options.registryPath,
  });
  if (!entry) {
    throw new Error(`workspace not found: ${options.workspaceId}`);
  }
  return workspaceRef(entry, entry.id === currentWorkspaceRegistryEntry(cwd).id);
}

function workspaceRef(entry: WorkspaceRegistryEntry, current: boolean): StudioWorkspaceRef {
  return {
    id: entry.id,
    label: entry.label,
    path: entry.path,
    current,
  };
}

function compareStudioRuns(left: StudioRunSummary, right: StudioRunSummary): number {
  return runSortTimestamp(right).localeCompare(runSortTimestamp(left))
    || left.workspace.label.localeCompare(right.workspace.label)
    || left.run_id.localeCompare(right.run_id);
}

function runSortTimestamp(run: StudioRunSummary): string {
  return run.updated_at ?? run.latest_event_timestamp ?? run.created_at ?? "";
}

function isReadableDirectory(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
