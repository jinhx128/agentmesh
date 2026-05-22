import { readFileSync } from "node:fs";
import path from "node:path";
import type { ZodIssue } from "zod";
import {
  CURRENT_PACKET_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  PacketArtifactManifestSchema,
  PacketEventSchema,
  PacketStatusSchema,
} from "@agentmesh/core";
import {
  ARTIFACTS_FILE,
  EVENTS_FILE,
  STATUS_FILE,
  isDirectory,
  isFile,
  loadEvents,
  parseArtifactsToml,
  resolveArtifactPath,
  resolveRunDirectory,
} from "./io.js";

export interface PacketValidationResult {
  ok: boolean;
  runDir: string;
  errors: string[];
  artifactCount: number;
  eventCount: number;
}

export function validatePacket(runIdOrDir: string, cwd = process.cwd()): PacketValidationResult {
  const errors: string[] = [];
  let artifactCount = 0;
  let eventCount = 0;
  let runDir: string;

  try {
    runDir = resolveRunDirectory(runIdOrDir, cwd);
  } catch (error) {
    runDir = path.resolve(cwd, runIdOrDir);
    errors.push(errorMessage(error));
    return { ok: false, runDir, errors, artifactCount, eventCount };
  }

  if (!isDirectory(runDir)) {
    errors.push(`run directory not found: ${runDir}`);
    return { ok: false, runDir, errors, artifactCount, eventCount };
  }

  validateStatusFile(runDir, errors);
  artifactCount = validateArtifactsFile(runDir, errors);
  eventCount = validateEventsFile(runDir, errors);

  return {
    ok: errors.length === 0,
    runDir,
    errors,
    artifactCount,
    eventCount,
  };
}

function validateStatusFile(runDir: string, errors: string[]): void {
  const statusPath = path.join(runDir, STATUS_FILE);
  const payload = readJsonObject(statusPath, `${STATUS_FILE}`, errors);
  if (!payload) {
    return;
  }
  const parsed = PacketStatusSchema.safeParse(payload);
  if (!parsed.success) {
    errors.push(...zodIssuesToErrors(
      STATUS_FILE,
      parsed.error.issues,
      CURRENT_PACKET_SCHEMA_VERSION,
    ));
  }
}

function validateArtifactsFile(runDir: string, errors: string[]): number {
  const manifestPath = path.join(runDir, ARTIFACTS_FILE);
  if (!isFile(manifestPath)) {
    errors.push(`${ARTIFACTS_FILE} not found`);
    return 0;
  }

  let manifest: ReturnType<typeof parseArtifactsToml>;
  try {
    manifest = parseArtifactsToml(readText(manifestPath));
  } catch (error) {
    errors.push(errorMessage(error));
    return 0;
  }

  const artifactNames = Object.keys(manifest.artifacts);
  const parsed = PacketArtifactManifestSchema.safeParse({
    schema_version: manifest.schemaVersion,
    artifacts: manifest.artifacts,
  });
  if (!parsed.success) {
    errors.push(...zodIssuesToErrors(
      ARTIFACTS_FILE,
      parsed.error.issues,
      CURRENT_SCHEMA_VERSION,
    ));
    return artifactNames.length;
  }

  for (const name of artifactNames) {
    const artifactPath = parsed.data.artifacts[name].path;
    const resolved = resolveArtifactPath(runDir, artifactPath);
    if (!resolved.insideRunDir && !path.isAbsolute(artifactPath)) {
      errors.push(`artifact ${name} path escapes run directory: ${artifactPath}`);
      continue;
    }
    if (!isFile(resolved.path)) {
      errors.push(`artifact ${name} path not found: ${artifactPath}`);
    }
  }

  return artifactNames.length;
}

function validateEventsFile(runDir: string, errors: string[]): number {
  let events;
  try {
    events = loadEvents(runDir);
  } catch (error) {
    errors.push(errorMessage(error));
    return 0;
  }
  for (const [index, event] of events.entries()) {
    const label = `${EVENTS_FILE}:${index + 1}`;
    const parsed = PacketEventSchema.safeParse(event);
    if (!parsed.success) {
      errors.push(...zodIssuesToErrors(label, parsed.error.issues, CURRENT_SCHEMA_VERSION));
    }
  }
  return events.length;
}

function readJsonObject(
  filePath: string,
  label: string,
  errors: string[],
): Record<string, unknown> | undefined {
  if (!isFile(filePath)) {
    errors.push(`${label} not found`);
    return undefined;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(readText(filePath));
  } catch {
    errors.push(`${label} invalid JSON`);
    return undefined;
  }
  if (!isRecord(payload)) {
    errors.push(`${label} must be a JSON object`);
    return undefined;
  }
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function zodIssuesToErrors(
  label: string,
  issues: ZodIssue[],
  expectedSchemaVersion: number,
): string[] {
  return issues.map((issue) => {
    if (issue.code === "custom") {
      return `${label}.${issue.message}`;
    }
    return `${zodIssuePath(label, issue)} ${zodIssueMessage(issue, expectedSchemaVersion)}`;
  });
}

function zodIssuePath(label: string, issue: ZodIssue): string {
  const parts = issue.path.map(String);
  if (label === ARTIFACTS_FILE && parts[0] === "artifacts" && parts.length >= 3) {
    return `artifact ${parts[1]}.${parts.slice(2).join(".")}`;
  }
  return parts.length === 0 ? label : `${label}.${parts.join(".")}`;
}

function zodIssueMessage(issue: ZodIssue, expectedSchemaVersion: number): string {
  if (issue.code === "invalid_value" && issue.path.at(-1) === "schema_version") {
    return `must be ${expectedSchemaVersion}`;
  }
  if (issue.code === "too_small" && "origin" in issue && issue.origin === "string") {
    return "must be a non-empty string";
  }
  if (issue.code === "invalid_type" && "expected" in issue) {
    if (issue.expected === "array") {
      return "must be an array";
    }
    return `must be a ${issue.expected}`;
  }
  return `is invalid: ${issue.message}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readText(filePath: string): string {
  return readFileSync(filePath, { encoding: "utf-8" });
}
