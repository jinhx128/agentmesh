import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CURRENT_PACKET_SCHEMA_VERSION,
  SUPPORTED_PACKET_SCHEMA_VERSIONS,
} from "@agentmesh/core";

export const WORKSPACE_COMPATIBILITY_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_COMPATIBILITY_RELATIVE_PATH = path.join(
  ".agentmesh",
  "compatibility.json",
);

export type WorkspaceCompatibilityDecision = "read_write" | "read_only" | "refused";
export type WorkspaceCompatibilityMetadataState =
  | "ok"
  | "missing_legacy"
  | "newer_schema"
  | "invalid";

export interface WorkspaceCompatibilityMetadata {
  schema_version: number;
  packet_schema_version: number;
  min_read_runtime_version: string;
  min_write_runtime_version: string;
  last_writer_runtime_version: string;
  last_writer_entrypoint: string;
  updated_at: string;
}

export interface WorkspaceCompatibilityOptions {
  entrypoint?: string;
  runtimeVersion?: string;
}

export interface WorkspaceCompatibilityDiagnostics {
  decision: WorkspaceCompatibilityDecision;
  metadata_state: WorkspaceCompatibilityMetadataState;
  current_runtime_version: string;
  current_entrypoint: string;
  compatibility_path: string;
  metadata: WorkspaceCompatibilityMetadata | null;
  reasons: string[];
}

export type WorkspaceCompatibilityErrorCode = "workspace_read_only" | "workspace_refused";
export type WorkspaceCompatibilityOperation = "read" | "write";

export class WorkspaceCompatibilityError extends Error {
  readonly code: WorkspaceCompatibilityErrorCode;
  readonly operation: WorkspaceCompatibilityOperation;
  readonly diagnostics: WorkspaceCompatibilityDiagnostics;

  constructor(
    code: WorkspaceCompatibilityErrorCode,
    operation: WorkspaceCompatibilityOperation,
    diagnostics: WorkspaceCompatibilityDiagnostics,
  ) {
    super(workspaceCompatibilityErrorMessage(code, operation, diagnostics));
    this.name = "WorkspaceCompatibilityError";
    this.code = code;
    this.operation = operation;
    this.diagnostics = diagnostics;
  }
}

export function isWorkspaceCompatibilityError(
  error: unknown,
): error is WorkspaceCompatibilityError {
  return error instanceof WorkspaceCompatibilityError;
}

export function readWorkspaceCompatibilityMetadata(
  workspace: string,
): WorkspaceCompatibilityMetadata {
  const filePath = workspaceCompatibilityPath(workspace);
  return parseWorkspaceCompatibilityMetadata(
    JSON.parse(readFileSync(filePath, { encoding: "utf-8" })),
    filePath,
  );
}

export function writeWorkspaceCompatibilityMetadata(
  workspace: string,
  metadata: WorkspaceCompatibilityMetadata,
): void {
  parseWorkspaceCompatibilityMetadata(metadata, WORKSPACE_COMPATIBILITY_RELATIVE_PATH);
  writeFileAtomic(
    workspaceCompatibilityPath(workspace),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
}

export function workspaceCompatibilityDiagnostics(
  workspace: string,
  options: WorkspaceCompatibilityOptions = {},
): WorkspaceCompatibilityDiagnostics {
  const compatibilityPath = workspaceCompatibilityPath(workspace);
  const runtimeVersion = options.runtimeVersion ?? currentRuntimeVersion();
  const currentEntrypoint = options.entrypoint ?? "cli";
  const base = {
    current_runtime_version: runtimeVersion,
    current_entrypoint: currentEntrypoint,
    compatibility_path: compatibilityPath,
  };

  if (!existsSync(compatibilityPath)) {
    return {
      ...base,
      decision: "read_write",
      metadata_state: "missing_legacy",
      metadata: null,
      reasons: [
        "compatibility metadata is missing; treating workspace as legacy readable until the next successful mutation backfills it",
      ],
    };
  }

  let metadata: WorkspaceCompatibilityMetadata;
  try {
    metadata = readWorkspaceCompatibilityMetadata(workspace);
  } catch (error) {
    return {
      ...base,
      decision: "refused",
      metadata_state: "invalid",
      metadata: null,
      reasons: [
        error instanceof Error ? error.message : String(error),
      ],
    };
  }

  const reasons: string[] = [];
  let decision: WorkspaceCompatibilityDecision = "read_write";
  let metadataState: WorkspaceCompatibilityMetadataState = "ok";

  if (metadata.schema_version > WORKSPACE_COMPATIBILITY_SCHEMA_VERSION) {
    metadataState = "newer_schema";
    decision = "read_only";
    reasons.push(
      `compatibility metadata schema_version ${metadata.schema_version} is newer than supported version ${WORKSPACE_COMPATIBILITY_SCHEMA_VERSION}`,
    );
  }

  if (
    !SUPPORTED_PACKET_SCHEMA_VERSIONS.includes(
      metadata.packet_schema_version as never,
    )
  ) {
    decision = "refused";
    reasons.push(
      `packet_schema_version ${metadata.packet_schema_version} is not supported by runtime ${runtimeVersion}`,
    );
  }

  if (semverGreaterThan(metadata.min_read_runtime_version, runtimeVersion)) {
    decision = "refused";
    reasons.push(
      `min_read_runtime_version ${metadata.min_read_runtime_version} is newer than current runtime ${runtimeVersion}`,
    );
  }

  if (
    decision !== "refused" &&
    semverGreaterThan(metadata.min_write_runtime_version, runtimeVersion)
  ) {
    decision = "read_only";
    reasons.push(
      `min_write_runtime_version ${metadata.min_write_runtime_version} is newer than current runtime ${runtimeVersion}`,
    );
  }

  return {
    ...base,
    decision,
    metadata_state: metadataState,
    metadata,
    reasons,
  };
}

export function assertWorkspaceReadable(
  workspace: string,
  options: WorkspaceCompatibilityOptions = {},
): void {
  const diagnostics = workspaceCompatibilityDiagnostics(workspace, options);
  if (diagnostics.decision === "refused") {
    throw new WorkspaceCompatibilityError("workspace_refused", "read", diagnostics);
  }
}

export function assertWorkspaceWritable(
  workspace: string,
  options: WorkspaceCompatibilityOptions = {},
): void {
  const diagnostics = workspaceCompatibilityDiagnostics(workspace, options);
  if (diagnostics.decision === "read_write") {
    return;
  }
  if (diagnostics.decision === "read_only") {
    throw new WorkspaceCompatibilityError("workspace_read_only", "write", diagnostics);
  }
  throw new WorkspaceCompatibilityError("workspace_refused", "write", diagnostics);
}

function lastWriterDetail(metadata: WorkspaceCompatibilityMetadata | null): string {
  return metadata
    ? `(last writer ${metadata.last_writer_entrypoint} ${metadata.last_writer_runtime_version})`
    : "(last writer unknown)";
}

function workspaceCompatibilityErrorMessage(
  code: WorkspaceCompatibilityErrorCode,
  operation: WorkspaceCompatibilityOperation,
  diagnostics: WorkspaceCompatibilityDiagnostics,
): string {
  const detail = `${diagnostics.reasons.join("; ")} ` +
    `${lastWriterDetail(diagnostics.metadata)} ` +
    `(runtime ${diagnostics.current_runtime_version}, entrypoint ${diagnostics.current_entrypoint})`;
  if (operation === "read") {
    return `workspace compatibility refused read: ${detail}`;
  }
  return code === "workspace_read_only"
    ? `workspace compatibility is read-only: ${detail}`
    : `workspace compatibility refused write: ${detail}`;
}

export function assertWorkspaceReadableForRun(
  runDir: string,
  options: WorkspaceCompatibilityOptions = {},
): void {
  const workspace = workspaceRootFromRunDir(runDir);
  if (workspace) {
    assertWorkspaceReadable(workspace, options);
  }
}

export function assertWorkspaceWritableForRun(
  runDir: string,
  options: WorkspaceCompatibilityOptions = {},
): void {
  const workspace = workspaceRootFromRunDir(runDir);
  if (workspace) {
    assertWorkspaceWritable(workspace, options);
  }
}

export function recordSuccessfulWorkspaceMutation(
  workspace: string,
  options: WorkspaceCompatibilityOptions = {},
): void {
  assertWorkspaceWritable(workspace, options);
  const now = new Date().toISOString();
  const runtimeVersion = options.runtimeVersion ?? currentRuntimeVersion();
  const entrypoint = options.entrypoint ?? "cli";
  const existing = workspaceCompatibilityDiagnostics(workspace, options).metadata;
  writeWorkspaceCompatibilityMetadata(workspace, {
    schema_version: WORKSPACE_COMPATIBILITY_SCHEMA_VERSION,
    packet_schema_version: CURRENT_PACKET_SCHEMA_VERSION,
    min_read_runtime_version:
      existing?.min_read_runtime_version ?? runtimeVersion,
    min_write_runtime_version:
      existing?.min_write_runtime_version ?? runtimeVersion,
    last_writer_runtime_version: runtimeVersion,
    last_writer_entrypoint: entrypoint,
    updated_at: now,
  });
}

export function recordSuccessfulWorkspaceMutationForRun(
  runDir: string,
  options: WorkspaceCompatibilityOptions = {},
): void {
  const workspace = workspaceRootFromRunDir(runDir);
  if (workspace) {
    recordSuccessfulWorkspaceMutation(workspace, options);
  }
}

export function workspaceRootFromRunDir(runDir: string): string | undefined {
  const resolvedRunDir = path.resolve(runDir);
  const runsDir = path.dirname(resolvedRunDir);
  const agentmeshDir = path.dirname(runsDir);
  if (path.basename(runsDir) !== "runs" || path.basename(agentmeshDir) !== ".agentmesh") {
    return undefined;
  }
  return path.dirname(agentmeshDir);
}

function workspaceCompatibilityPath(workspace: string): string {
  return path.join(path.resolve(workspace), WORKSPACE_COMPATIBILITY_RELATIVE_PATH);
}

function parseWorkspaceCompatibilityMetadata(
  value: unknown,
  label: string,
): WorkspaceCompatibilityMetadata {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const metadata = value as Record<string, unknown>;
  return {
    schema_version: numberField(metadata, "schema_version", label),
    packet_schema_version: numberField(metadata, "packet_schema_version", label),
    min_read_runtime_version: semverField(metadata, "min_read_runtime_version", label),
    min_write_runtime_version: semverField(metadata, "min_write_runtime_version", label),
    last_writer_runtime_version: semverField(metadata, "last_writer_runtime_version", label),
    last_writer_entrypoint: nonEmptyStringField(metadata, "last_writer_entrypoint", label),
    updated_at: nonEmptyStringField(metadata, "updated_at", label),
  };
}

function numberField(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (!Number.isInteger(value) || typeof value !== "number") {
    throw new Error(`${label}.${key} must be an integer`);
  }
  return value;
}

function semverField(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = nonEmptyStringField(record, key, label);
  if (!isSemver(value)) {
    throw new Error(`${label}.${key} must be a semver string`);
  }
  return value;
}

function nonEmptyStringField(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function semverGreaterThan(left: string, right: string): boolean {
  const leftParts = semverParts(left);
  const rightParts = semverParts(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts[index] - rightParts[index];
    if (diff > 0) {
      return true;
    }
    if (diff < 0) {
      return false;
    }
  }
  return false;
}

function semverParts(value: string): [number, number, number] {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

export function currentRuntimeVersion(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(current, "package.json");
    if (existsSync(candidate)) {
      try {
        const payload = JSON.parse(
          readFileSync(candidate, { encoding: "utf-8" }),
        ) as { version?: unknown };
        if (typeof payload.version === "string" && payload.version.trim() !== "") {
          return payload.version;
        }
      } catch {
        // Try the next parent.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return "0.0.0";
}

function writeFileAtomic(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(temporaryPath, content, { encoding: "utf-8" });
  renameSync(temporaryPath, filePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
