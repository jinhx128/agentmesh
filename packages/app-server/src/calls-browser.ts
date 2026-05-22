import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { appendCallAdoptionEvent } from "@agentmesh/runtime/src/calls/history.js";
import {
  getCall,
  listCallAdoptionEvents,
  listCalls,
  resolveCallDirectory,
  type AgentMeshCallAdoptionEvent,
  type AgentMeshCallReadOptions,
  type AgentMeshCallRecord,
} from "@agentmesh/sdk";

const DEFAULT_CALL_PREVIEW_BYTES = 24 * 1024;

type CallArtifactRef = NonNullable<AgentMeshCallRecord["prompt_ref"]>;

type StudioCallOptions = AgentMeshCallReadOptions;

export interface StudioCallWarning {
  code: string;
  message: string;
  path?: string;
}

export interface StudioCallSummary extends AgentMeshCallRecord {
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

export function listStudioCalls(options: AgentMeshCallReadOptions = {}): StudioCallIndex {
  const cwd = options.cwd ?? process.cwd();
  const calls = listCalls({ cwd }).map((record) => studioCallSummary(record, cwd));
  return {
    schema_version: 1,
    total: calls.length,
    calls,
    groups: groupCallsByDate(calls),
  };
}

export function readStudioCall(
  callId: string,
  options: AgentMeshCallReadOptions & { previewBytes?: number } = {},
): StudioCallDetail {
  const cwd = options.cwd ?? process.cwd();
  const callDir = resolveCallDirectory(callId, cwd);
  const record = getCall(callDir, { cwd });
  const call = studioCallSummary(record, cwd);
  const previewBytes = normalizePreviewBytes(options.previewBytes);
  return {
    schema_version: 1,
    call,
    prompt: readCallRefPreview(callDir, record.prompt_ref, previewBytes),
    output: readOutputPreview(cwd, callDir, record, previewBytes),
    stderr: readNamedCallFilePreview(callDir, "stderr.txt", previewBytes),
    adoption_events: listCallAdoptionEvents(callDir, { cwd }),
    warnings: call.warnings,
  };
}

export function adoptStudioCall(
  callId: string,
  request: StudioCallAdoptionRequest,
  options: StudioCallOptions = {},
): StudioCallDetail {
  const cwd = options.cwd ?? process.cwd();
  const callDir = resolveCallDirectory(callId, cwd);
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
  return readStudioCall(callId, { cwd });
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
  return errorMessage(error).startsWith("call not found:");
}

function studioCallSummary(record: AgentMeshCallRecord, cwd: string): StudioCallSummary {
  const warnings = callWarnings(record, cwd);
  return {
    ...record,
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

function normalizePreviewBytes(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_CALL_PREVIEW_BYTES;
  }
  return Math.min(Math.floor(value), DEFAULT_CALL_PREVIEW_BYTES);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
