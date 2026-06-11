import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { appendCallAdoptionEvent } from "@agentmesh/runtime/src/calls/history.js";
import {
  currentWorkspaceRegistryEntry,
  listRegisteredWorkspaces,
  resolveRegisteredWorkspace,
  type WorkspaceRegistryEntry,
} from "@agentmesh/runtime/src/workspaces/registry.js";
import {
  getCall,
  listCallAdoptionEvents,
  listCalls,
  type AgentMeshCallAdoptionEvent,
  type AgentMeshCallReadOptions,
  type AgentMeshCallRecord,
} from "@agentmesh/sdk";

const DEFAULT_CALL_PREVIEW_BYTES = 24 * 1024;

type CallArtifactRef = NonNullable<AgentMeshCallRecord["prompt_ref"]>;

type StudioWorkspaceScope = "all" | "current" | "workspace";

type StudioCallOptions = AgentMeshCallReadOptions & {
  registryPath?: string;
  scope?: StudioWorkspaceScope;
  workspaceId?: string;
};

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

export interface StudioCallWarning {
  code: string;
  message: string;
  path?: string;
}

export interface StudioCallSummary extends AgentMeshCallRecord {
  workspace: StudioWorkspaceRef;
  unsupported_schema: boolean;
  warnings: StudioCallWarning[];
}

export interface StudioCallGroup {
  date: string;
  calls: StudioCallSummary[];
}

export interface StudioCallIndex {
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

export interface StudioCallDetail {
  schema_version: 1;
  call: StudioCallSummary;
  prompt: StudioCallPreview;
  output: StudioCallPreview;
  stderr: StudioCallPreview;
  adoption_events: AgentMeshCallAdoptionEvent[];
  warnings: StudioCallWarning[];
}

export interface StudioCallAdoptionRequest {
  status?: unknown;
  reason?: unknown;
  related_commit?: unknown;
  related_run_id?: unknown;
  superseded_by_call_id?: unknown;
}

export function listStudioCalls(options: StudioCallOptions = {}): StudioCallIndex {
  const cwd = options.cwd ?? process.cwd();
  const { workspaces, diagnostics } = visibleStudioWorkspaces(cwd, options);
  const calls = workspaces.flatMap((workspace) => {
    if (!isReadableDirectory(workspace.path)) {
      diagnostics.push({
        code: "workspace_missing",
        message: `workspace path is not readable: ${workspace.path}`,
        workspace,
      });
      return [];
    }
    try {
      return listCalls({ cwd: workspace.path }).map((record) =>
        studioCallSummary(record, workspace));
    } catch (error) {
      diagnostics.push({
        code: "workspace_call_list_failed",
        message: error instanceof Error ? error.message : String(error),
        workspace,
      });
      return [];
    }
  }).sort(compareStudioCalls);
  return {
    schema_version: 1,
    total: calls.length,
    calls,
    groups: groupCallsByDate(calls),
    workspaces,
    diagnostics,
  };
}

export function readStudioCall(
  callId: string,
  options: StudioCallOptions & { previewBytes?: number } = {},
): StudioCallDetail {
  const cwd = options.cwd ?? process.cwd();
  const workspace = resolveStudioWorkspace(cwd, options);
  const callDir = resolveStudioCallDirectory(callId, workspace.path);
  const record = getCall(callDir, { cwd: workspace.path });
  const call = studioCallSummary(record, workspace);
  const previewBytes = normalizePreviewBytes(options.previewBytes);
  return {
    schema_version: 1,
    call,
    prompt: readCallRefPreview(callDir, record.prompt_ref, previewBytes),
    output: readOutputPreview(workspace.path, callDir, record, previewBytes),
    stderr: readNamedCallFilePreview(callDir, "stderr.txt", previewBytes),
    adoption_events: listCallAdoptionEvents(callDir, { cwd: workspace.path }),
    warnings: call.warnings,
  };
}

export function adoptStudioCall(
  callId: string,
  request: StudioCallAdoptionRequest,
  options: StudioCallOptions = {},
): StudioCallDetail {
  const cwd = options.cwd ?? process.cwd();
  const workspace = resolveStudioWorkspace(cwd, options);
  const callDir = resolveStudioCallDirectory(callId, workspace.path);
  const reason = optionalString(request.reason);
  const relatedCommit = optionalString(request.related_commit);
  const relatedRunId = optionalString(request.related_run_id);
  const supersededByCallId = optionalString(request.superseded_by_call_id);
  appendCallAdoptionEvent({
    callDir,
    status: finalAdoptionStatus(request.status),
    updatedByEntrypoint: "studio",
    reason,
    relatedCommit,
    relatedRunId,
    supersededByCallId,
  });
  return readStudioCall(callId, { cwd, registryPath: options.registryPath, workspaceId: workspace.id });
}

export function isInvalidStudioCallAdoptionError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.startsWith("invalid adoption status:")
    || message === "superseded adoption requires superseded_by_call_id"
    || message.startsWith("invalid related-run-id:")
    || message.startsWith("invalid superseded-by-call-id:")
    || message === "text values cannot contain null bytes"
    || message === "invalid JSON body"
    || message === "request body too large";
}

export function isConflictStudioCallAdoptionError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.startsWith("cannot transition call adoption")
    || message === "cannot mutate adoption for newer call record schema";
}

export function isInvalidStudioCallIdError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.startsWith("invalid call id:") || message === "call id cannot be empty";
}

export function isMissingStudioCallError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.startsWith("call not found:") || message.startsWith("workspace not found:");
}

function studioCallSummary(record: AgentMeshCallRecord, workspace: StudioWorkspaceRef): StudioCallSummary {
  const warnings = callWarnings(record, workspace.path);
  return {
    ...record,
    workspace,
    unsupported_schema: Boolean(record.read_only || record.schema_warning),
    warnings,
  };
}

function finalAdoptionStatus(value: unknown): "accepted" | "rejected" | "superseded" {
  if (value === "accepted" || value === "rejected" || value === "superseded") {
    return value;
  }
  throw new Error(`invalid adoption status: ${String(value)}`);
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function callWarnings(record: AgentMeshCallRecord, cwd: string): StudioCallWarning[] {
  const warnings: StudioCallWarning[] = [];
  if (record.read_only || record.schema_warning) {
    warnings.push({
      code: "unsupported_schema",
      message:
        record.schema_warning
        ?? `call record schema ${record.schema_version} is not fully supported by this Studio`,
    });
  }
  if (record.output_path) {
    const resolved = resolveWorkspacePath(cwd, record.output_path);
    if (!resolved.inside) {
      warnings.push({
        code: "invalid_output_path",
        message: `output_path escapes workspace: ${record.output_path}`,
        path: record.output_path,
      });
    } else if (!existsSync(resolved.path)) {
      warnings.push({
        code: "dangling_output_path",
        message: `output_path does not exist: ${record.output_path}`,
        path: record.output_path,
      });
    }
  }
  return warnings;
}

function groupCallsByDate(calls: StudioCallSummary[]): StudioCallGroup[] {
  const groups = new Map<string, StudioCallSummary[]>();
  for (const call of calls) {
    const date = call.created_at.slice(0, 10) || "unknown";
    groups.set(date, [...(groups.get(date) ?? []), call]);
  }
  return [...groups.entries()].map(([date, groupedCalls]) => ({
    date,
    calls: groupedCalls,
  }));
}

function visibleStudioWorkspaces(
  cwd: string,
  options: StudioCallOptions,
): { workspaces: StudioWorkspaceRef[]; diagnostics: StudioCallDiagnostic[] } {
  const diagnostics: StudioCallDiagnostic[] = [];
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

function resolveStudioWorkspace(cwd: string, options: StudioCallOptions): StudioWorkspaceRef {
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

function resolveStudioCallDirectory(callId: string, workspace: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(callId)) {
    throw new Error(`invalid call id: ${callId}`);
  }
  const callsDir = path.resolve(workspace, ".agentmesh", "calls");
  const callDir = path.resolve(callsDir, callId);
  const relative = path.relative(callsDir, callDir);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`invalid call id: ${callId}`);
  }
  if (!existsSync(path.join(callDir, "call.json"))) {
    throw new Error(`call not found: ${callId}`);
  }
  return callDir;
}

function compareStudioCalls(left: StudioCallSummary, right: StudioCallSummary): number {
  return right.created_at.localeCompare(left.created_at)
    || left.workspace.label.localeCompare(right.workspace.label)
    || left.id.localeCompare(right.id);
}

function readOutputPreview(
  cwd: string,
  callDir: string,
  record: AgentMeshCallRecord,
  previewBytes: number,
): StudioCallPreview {
  if (record.output_path) {
    const resolved = resolveWorkspacePath(cwd, record.output_path);
    if (!resolved.inside || !isReadableFile(resolved.path)) {
      return absentPreview(record.output_path, record.output_ref);
    }
    return readFilePreview(resolved.path, record.output_path, record.output_ref, previewBytes);
  }
  return readCallRefPreview(callDir, record.output_ref, previewBytes);
}

function readCallRefPreview(
  callDir: string,
  ref: CallArtifactRef | null,
  previewBytes: number,
): StudioCallPreview {
  if (!ref) {
    return absentPreview(null, null);
  }
  const resolved = resolveRelativePath(callDir, ref.path);
  if (!resolved.inside || !isReadableFile(resolved.path)) {
    return absentPreview(ref.path, ref);
  }
  return readFilePreview(resolved.path, ref.path, ref, previewBytes);
}

function readNamedCallFilePreview(
  callDir: string,
  fileName: string,
  previewBytes: number,
): StudioCallPreview {
  const resolved = resolveRelativePath(callDir, fileName);
  if (!resolved.inside || !isReadableFile(resolved.path)) {
    return absentPreview(null, null);
  }
  return readFilePreview(resolved.path, fileName, null, previewBytes);
}

function readFilePreview(
  filePath: string,
  displayPath: string,
  ref: CallArtifactRef | null,
  previewBytes: number,
): StudioCallPreview {
  const bytes = readFileSync(filePath);
  const truncated = bytes.length > previewBytes;
  return {
    present: true,
    path: displayPath,
    content: bytes.subarray(0, previewBytes).toString("utf-8"),
    truncated,
    sha256: ref?.sha256 ?? null,
    redaction_state: ref?.redaction_state ?? null,
    authoritative: ref?.authoritative ?? null,
  };
}

function absentPreview(
  displayPath: string | null,
  ref: CallArtifactRef | null,
): StudioCallPreview {
  return {
    present: false,
    path: displayPath,
    content: "",
    truncated: false,
    sha256: ref?.sha256 ?? null,
    redaction_state: ref?.redaction_state ?? null,
    authoritative: ref?.authoritative ?? null,
  };
}

function resolveWorkspacePath(
  workspace: string,
  relativePath: string,
): { inside: boolean; path: string } {
  if (path.isAbsolute(relativePath)) {
    return { inside: false, path: path.resolve(relativePath) };
  }
  return resolveContainedPath(workspace, relativePath);
}

function resolveRelativePath(root: string, relativePath: string): { inside: boolean; path: string } {
  if (!relativePath || path.isAbsolute(relativePath)) {
    return { inside: false, path: path.resolve(root, relativePath) };
  }
  return resolveContainedPath(root, relativePath);
}

function resolveContainedPath(root: string, relativePath: string): { inside: boolean; path: string } {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (!isInside(resolvedRoot, resolvedPath)) {
    return { inside: false, path: resolvedPath };
  }
  if (!existsSync(resolvedPath)) {
    return { inside: true, path: resolvedPath };
  }
  try {
    const realRoot = realpathSync(resolvedRoot);
    const realPath = realpathSync(resolvedPath);
    return { inside: isInside(realRoot, realPath), path: realPath };
  } catch {
    return { inside: true, path: resolvedPath };
  }
}

function isInside(root: string, value: string): boolean {
  const relative = path.relative(root, value);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isReadableFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isReadableDirectory(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function normalizePreviewBytes(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_CALL_PREVIEW_BYTES;
  }
  return Math.min(Math.floor(value), DEFAULT_CALL_PREVIEW_BYTES);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
