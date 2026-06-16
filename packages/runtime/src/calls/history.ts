import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { AgentCallResult } from "../adapters.js";
import { formatLocalTimestamp, reserveTimestampedId } from "../generated-id.js";
import { writeFileAtomic } from "../packet/io.js";

export const CALL_RECORD_SCHEMA_VERSION = 1 as const;
export const CALLS_RELATIVE_DIR = path.join(".agentmesh", "calls");
const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

export type CallRecordStatus =
  | "running"
  | "success"
  | "failed"
  | "aborted"
  | "timeout"
  | "stale";
export type CallErrorKind =
  | "none"
  | "adapter_error"
  | "provider_auth"
  | "provider_missing"
  | "network"
  | "timeout"
  | "schema"
  | "user_aborted"
  | "internal"
  | "unknown";
export type CallPromptSource = "inline" | "stdin" | "file" | "generated" | "unknown";
export type CallAdoptionStatus = "unreviewed" | "accepted" | "rejected" | "superseded";
export type FinalCallAdoptionStatus = Exclude<CallAdoptionStatus, "unreviewed">;

export interface CallArtifactRef {
  kind: "file";
  path: string;
  sha256: string | null;
  redaction_state: string;
  authoritative: boolean;
}

export interface DirectCallRecord {
  schema_version: number;
  id: string;
  agent_id: string | null;
  adapter: string;
  model: string | null;
  purpose: string;
  status: CallRecordStatus;
  cwd: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  heartbeat_at: string | null;
  prompt_source: CallPromptSource;
  prompt_ref: CallArtifactRef | null;
  output_ref: CallArtifactRef | null;
  output_path: string | null;
  exit_code: number | null;
  error_kind: CallErrorKind;
  error_summary: string | null;
  redaction_state: string;
  redactions_applied: string[];
  related_files: string[];
  related_run_ids: string[];
  related_call_ids: string[];
  tokens_in: number | null;
  tokens_out: number | null;
  cost_estimate_usd: number | null;
  adoption_status: CallAdoptionStatus;
  read_only?: boolean;
  schema_warning?: string;
}

export interface CallAdoptionEvent {
  schema_version: number;
  call_id: string;
  previous_status: CallAdoptionStatus;
  status: FinalCallAdoptionStatus;
  updated_at: string;
  updated_by_entrypoint: string;
  reason: string | null;
  related_commit: string | null;
  related_run_id: string | null;
  superseded_by_call_id: string | null;
}

export interface CreateCallRecordInput {
  workspace: string;
  cwd: string;
  agentId: string | null;
  adapter: string;
  model?: string | null;
  purpose?: string;
  promptSource: CallPromptSource;
  promptContent?: string;
  createdAt?: Date | string;
}

export interface CreatedCallRecord {
  callDir: string;
  record: DirectCallRecord;
}

export interface CompleteCallRecordInput {
  status: Exclude<CallRecordStatus, "running" | "stale">;
  result?: AgentCallResult;
  stdout?: string;
  stderr?: string;
  outputFile?: string;
  errorKind?: CallErrorKind;
  errorSummary?: string;
}

export interface AppendCallAdoptionInput {
  callDir: string;
  status: FinalCallAdoptionStatus;
  updatedByEntrypoint: string;
  reason?: string;
  relatedCommit?: string;
  relatedRunId?: string;
  supersededByCallId?: string;
  updatedAt?: string;
}

export function isAgentMeshWorkspace(cwd: string): boolean {
  return existsSync(path.join(cwd, "agentmesh.toml")) || existsSync(path.join(cwd, ".agentmesh"));
}

export function assertAgentMeshWorkspace(cwd: string): void {
  if (!isAgentMeshWorkspace(cwd)) {
    throw new Error(
      `not an AgentMesh workspace: ${cwd}. Run from a workspace or pass --no-record to make this call intentionally invisible in Studio.`,
    );
  }
}

export function validateWorkspaceOutputPath(workspace: string, outputFile: string): string {
  return workspaceRelativePath(workspace, outputFile, "output file");
}

export function createCallRecord(input: CreateCallRecordInput): CreatedCallRecord {
  const createdAt = input.createdAt === undefined ? new Date() : new Date(input.createdAt);
  const reservation = reserveTimestampedId("call", path.join(input.workspace, CALLS_RELATIVE_DIR), createdAt);
  const id = reservation.id;
  const callDir = reservation.path;
  const now = createdAt.toISOString();

  let promptRef: CallArtifactRef | null = null;
  if (input.promptContent !== undefined) {
    const promptPath = path.join(callDir, "prompt.md");
    writeFileAtomic(promptPath, input.promptContent);
    promptRef = localRef("prompt.md", promptPath, true);
  }

  const record: DirectCallRecord = {
    schema_version: CALL_RECORD_SCHEMA_VERSION,
    id,
    agent_id: input.agentId,
    adapter: input.adapter,
    model: input.model ?? null,
    purpose: input.purpose ?? "general",
    status: "running",
    cwd: input.cwd,
    created_at: now,
    started_at: now,
    completed_at: null,
    duration_ms: null,
    heartbeat_at: now,
    prompt_source: input.promptSource,
    prompt_ref: promptRef,
    output_ref: null,
    output_path: null,
    exit_code: null,
    error_kind: "none",
    error_summary: null,
    redaction_state: "not_applied",
    redactions_applied: [],
    related_files: [],
    related_run_ids: [],
    related_call_ids: [],
    tokens_in: null,
    tokens_out: null,
    cost_estimate_usd: null,
    adoption_status: "unreviewed",
  };
  writeCallRecord(callDir, record);
  return { callDir, record };
}

export function formatCallIdTimestamp(date: Date): string {
  return formatLocalTimestamp(date);
}

export function completeCallRecord(
  created: CreatedCallRecord,
  input: CompleteCallRecordInput,
): DirectCallRecord {
  const completedAt = new Date().toISOString();
  const stdout = input.stdout ?? input.result?.stdout ?? "";
  const stderr = input.stderr ?? input.result?.stderr ?? "";
  let outputRef: CallArtifactRef | null = null;
  let outputPath: string | null = null;

  if (input.outputFile) {
    outputPath = workspaceRelativePath(
      workspaceFromCallDir(created.callDir),
      input.outputFile,
      "output file",
    );
    outputRef = externalRef(outputPath, input.outputFile, true);
  } else {
    const outputFile = path.join(created.callDir, "output.md");
    writeFileAtomic(outputFile, stdout);
    outputRef = localRef("output.md", outputFile, true);
  }

  if (stderr.trim().length > 0 || input.status !== "success") {
    writeFileAtomic(path.join(created.callDir, "stderr.txt"), stderr);
  }

  const record: DirectCallRecord = {
    ...created.record,
    status: input.status,
    completed_at: completedAt,
    duration_ms: Date.parse(completedAt) - Date.parse(created.record.started_at ?? completedAt),
    heartbeat_at: completedAt,
    output_ref: outputRef,
    output_path: outputPath,
    exit_code: input.result?.exitCode ?? null,
    error_kind: input.errorKind ?? (input.status === "success" ? "none" : "adapter_error"),
    error_summary:
      input.errorSummary
      ?? (input.status === "success" ? null : boundedSummary(stderr || stdout)),
  };
  writeCallRecord(created.callDir, record);
  return record;
}

export function readCallRecord(callDir: string): DirectCallRecord {
  const record = parseCallRecord(
    JSON.parse(readFileSync(path.join(callDir, "call.json"), "utf-8")),
    path.join(callDir, "call.json"),
  );
  if (record.status === "running" && isStale(record.heartbeat_at)) {
    return { ...record, status: "stale" };
  }
  return record;
}

export function listCallRecords(workspace: string): DirectCallRecord[] {
  const callsDir = path.join(workspace, CALLS_RELATIVE_DIR);
  if (!existsSync(callsDir)) {
    return [];
  }
  return readdirSync(callsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(callsDir, entry.name))
    .filter((callDir) => existsSync(path.join(callDir, "call.json")))
    .map((callDir) => readCallRecord(callDir))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function appendCallAdoptionEvent(input: AppendCallAdoptionInput): DirectCallRecord {
  validateCallAdoptionInput(input);
  const record = readCallRecord(input.callDir);
  if (record.read_only) {
    throw new Error("cannot mutate adoption for newer call record schema");
  }
  if (record.adoption_status !== "unreviewed") {
    throw new Error(
      `cannot transition call adoption from ${record.adoption_status} to ${input.status}`,
    );
  }
  if (input.status === "superseded" && !input.supersededByCallId) {
    throw new Error("superseded adoption requires superseded_by_call_id");
  }

  const event: CallAdoptionEvent = {
    schema_version: CALL_RECORD_SCHEMA_VERSION,
    call_id: record.id,
    previous_status: record.adoption_status,
    status: input.status,
    updated_at: input.updatedAt ?? new Date().toISOString(),
    updated_by_entrypoint: input.updatedByEntrypoint,
    reason: input.reason ?? null,
    related_commit: input.relatedCommit ?? null,
    related_run_id: input.relatedRunId ?? null,
    superseded_by_call_id: input.supersededByCallId ?? null,
  };
  appendFileSync(
    path.join(input.callDir, "adoption.jsonl"),
    `${JSON.stringify(event)}\n`,
    { encoding: "utf-8" },
  );

  const updated: DirectCallRecord = {
    ...record,
    adoption_status: input.status,
    related_run_ids: addUnique(record.related_run_ids, input.relatedRunId),
    related_call_ids: addUnique(record.related_call_ids, input.supersededByCallId),
  };
  writeCallRecord(input.callDir, updated);
  return updated;
}

function validateCallAdoptionInput(input: AppendCallAdoptionInput): void {
  validateAdoptionToken(input.updatedByEntrypoint, "entrypoint");
  validateAdoptionText(input.reason);
  validateAdoptionText(input.relatedCommit);
  if (input.relatedRunId !== undefined) {
    validateAdoptionToken(input.relatedRunId, "related-run-id");
  }
  if (input.supersededByCallId !== undefined) {
    validateAdoptionToken(input.supersededByCallId, "superseded-by-call-id");
  }
}

function validateAdoptionToken(value: string, label: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
}

function validateAdoptionText(value: string | undefined): void {
  if (value?.includes("\0")) {
    throw new Error("text values cannot contain null bytes");
  }
}

export function readCallAdoptionEvents(callDir: string): CallAdoptionEvent[] {
  const eventsPath = path.join(callDir, "adoption.jsonl");
  if (!existsSync(eventsPath)) {
    return [];
  }
  return readFileSync(eventsPath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => parseCallAdoptionEvent(line, `${eventsPath}:${index + 1}`));
}

function writeCallRecord(callDir: string, record: DirectCallRecord): void {
  writeFileAtomic(path.join(callDir, "call.json"), `${JSON.stringify(record, null, 2)}\n`);
}

function parseCallRecord(value: unknown, label: string): DirectCallRecord {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const record = value as unknown as DirectCallRecord;
  if (record.schema_version > CALL_RECORD_SCHEMA_VERSION) {
    return {
      ...record,
      read_only: true,
      schema_warning:
        `${label}.schema_version ${record.schema_version} is newer than supported version ${CALL_RECORD_SCHEMA_VERSION}`,
    };
  }
  return record;
}

function parseCallAdoptionEvent(line: string, label: string): CallAdoptionEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`${label} invalid JSON`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as unknown as CallAdoptionEvent;
}

function addUnique(values: string[], value: string | undefined): string[] {
  if (!value || values.includes(value)) {
    return values;
  }
  return [...values, value];
}

function localRef(pathValue: string, filePath: string, authoritative: boolean): CallArtifactRef {
  return {
    kind: "file",
    path: pathValue,
    sha256: fileSha256(filePath),
    redaction_state: "not_applied",
    authoritative,
  };
}

function externalRef(pathValue: string, filePath: string, authoritative: boolean): CallArtifactRef {
  return {
    kind: "file",
    path: pathValue,
    sha256: existsSync(filePath) ? fileSha256(filePath) : null,
    redaction_state: "not_applied",
    authoritative,
  };
}

function workspaceRelativePath(workspace: string, filePath: string, label: string): string {
  const resolvedWorkspace = canonicalContainmentPath(workspace);
  const resolved = canonicalContainmentPath(filePath);
  const relative = path.relative(resolvedWorkspace, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes workspace: ${filePath}`);
  }
  return relative.split(path.sep).join("/");
}

function canonicalContainmentPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    return realpathSync(resolved);
  } catch {
    const parent = path.dirname(resolved);
    try {
      return path.join(realpathSync(parent), path.basename(resolved));
    } catch {
      return resolved;
    }
  }
}

function workspaceFromCallDir(callDir: string): string {
  return path.dirname(path.dirname(path.dirname(path.resolve(callDir))));
}

function fileSha256(filePath: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(filePath)).digest("hex")}`;
}

function boundedSummary(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed;
}

function isStale(heartbeatAt: string | null): boolean {
  if (!heartbeatAt) {
    return true;
  }
  const parsed = Date.parse(heartbeatAt);
  return !Number.isFinite(parsed) || Date.now() - parsed > STALE_RUNNING_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
