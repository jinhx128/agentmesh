import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  CURRENT_SCHEMA_VERSION,
  assertSupportedPacketSchemaVersion,
  assertSupportedSchemaVersion,
  type PacketArtifact,
  type PacketEvent,
  type PacketStatus,
} from "@agentmesh/core";
import { assertWorkspaceReadableForRun } from "./compatibility.js";
import { parseTomlDocument, stringifyTomlDocument } from "../toml.js";

export type { PacketArtifact, PacketEvent, PacketStatus };

export const EVENTS_FILE = "events.jsonl";
export const ARTIFACTS_FILE = "artifacts.toml";
export const STATUS_FILE = "status.json";

export function validateRunId(runId: string): string {
  if (runId.length === 0) {
    throw new Error("run id cannot be empty");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new Error(
      "run id may only contain letters, numbers, dot, underscore, and dash: " +
        runId,
    );
  }
  if (runId === "." || runId === "..") {
    throw new Error(`unsafe run id: ${runId}`);
  }
  return runId;
}

export function resolveRunDirectory(runIdOrDir: string, cwd = process.cwd()): string {
  const directPath = path.resolve(cwd, runIdOrDir);
  if (isDirectory(directPath)) {
    return directPath;
  }
  return path.resolve(cwd, ".agentmesh", "runs", validateRunId(runIdOrDir));
}

export function loadStatus(runDir: string): PacketStatus {
  assertWorkspaceReadableForRun(runDir);
  const payload = readJsonObject(path.join(runDir, STATUS_FILE), STATUS_FILE);
  if (typeof payload.schema_version !== "number") {
    throw new Error(`${STATUS_FILE}.schema_version must be a number`);
  }
  assertSupportedPacketSchemaVersion(payload.schema_version, STATUS_FILE);
  return payload as PacketStatus;
}

export function saveStatus(runDir: string, status: PacketStatus): void {
  writeFileAtomic(
    path.join(runDir, STATUS_FILE),
    `${JSON.stringify(status, null, 2)}\n`,
  );
}

export function loadEvents(runDir: string): PacketEvent[] {
  assertWorkspaceReadableForRun(runDir);
  const eventsPath = path.join(runDir, EVENTS_FILE);
  if (!isFile(eventsPath)) {
    throw new Error(`${EVENTS_FILE} not found`);
  }
  const events: PacketEvent[] = [];
  const lines = readFileSync(eventsPath, { encoding: "utf-8" }).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) {
      continue;
    }
    const label = `${EVENTS_FILE}:${index + 1}`;
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      throw new Error(`${label} invalid JSON`);
    }
    if (!isRecord(payload)) {
      throw new Error(`${label} must be a JSON object`);
    }
    events.push(payload as PacketEvent);
  }
  return events;
}

export function appendEvent(
  runDir: string,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const payload: PacketEvent = {
    schema_version: CURRENT_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    event,
    ...fields,
  };
  appendFileSync(path.join(runDir, EVENTS_FILE), `${stableJson(payload)}\n`, {
    encoding: "utf-8",
  });
}

export function loadArtifacts(runDir: string): Record<string, PacketArtifact> {
  assertWorkspaceReadableForRun(runDir);
  const manifestPath = path.join(runDir, ARTIFACTS_FILE);
  if (!isFile(manifestPath)) {
    return {};
  }
  const manifest = parseArtifactsToml(
    readFileSync(manifestPath, { encoding: "utf-8" }),
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error(`${ARTIFACTS_FILE}.schema_version must be ${CURRENT_SCHEMA_VERSION}`);
  }
  return manifest.artifacts;
}

export function writeArtifacts(
  runDir: string,
  artifacts: Record<string, PacketArtifact>,
): void {
  const manifest: Record<string, unknown> = {
    schema_version: CURRENT_SCHEMA_VERSION,
    artifacts: {},
  };
  const artifactTables = manifest.artifacts as Record<string, Record<string, string>>;
  for (const name of Object.keys(artifacts).sort()) {
    const artifact = artifacts[name];
    const artifactTable: Record<string, string> = {};
    for (const key of Object.keys(artifact).sort() as Array<keyof PacketArtifact>) {
      const value = artifact[key];
      if (typeof value === "string") {
        artifactTable[key] = value;
      }
    }
    artifactTables[name] = artifactTable;
  }
  writeFileAtomic(path.join(runDir, ARTIFACTS_FILE), stringifyTomlDocument(manifest));
}

export function recordArtifact(
  runDir: string,
  name: string,
  artifactPath: string,
  kind: string,
  stage: string,
  agent?: string,
): void {
  const artifacts = loadArtifacts(runDir);
  artifacts[name] = {
    path: relativePacketPath(runDir, artifactPath),
    kind,
    stage,
    ...(agent ? { agent } : {}),
  };
  writeArtifacts(runDir, artifacts);
}

export function relativePacketPath(runDir: string, artifactPath: string): string {
  const resolvedPath = path.resolve(artifactPath);
  const relativePath = path.relative(path.resolve(runDir), resolvedPath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return relativePath.split(path.sep).join("/");
  }
  return artifactPath;
}

export function parseArtifactsToml(content: string): {
  schemaVersion?: unknown;
  artifacts: Record<string, PacketArtifact>;
} {
  const payload = parseTomlDocument(content, ARTIFACTS_FILE, `invalid ${ARTIFACTS_FILE}`);
  const schemaVersion = payload.schema_version;
  const artifactsPayload = payload.artifacts;
  const artifacts: Record<string, Partial<PacketArtifact>> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key !== "schema_version" && key !== "artifacts") {
      throw new Error(`${ARTIFACTS_FILE} unsupported section or key: ${key}`);
    }
    if (key === "schema_version" && typeof value !== "number") {
      throw new Error(`${ARTIFACTS_FILE}.schema_version must be a number`);
    }
  }
  if (artifactsPayload !== undefined && !isRecord(artifactsPayload)) {
    throw new Error(`${ARTIFACTS_FILE}.artifacts must be a table`);
  }
  for (const [name, artifact] of Object.entries(artifactsPayload ?? {})) {
    if (!isRecord(artifact)) {
      throw new Error(`${ARTIFACTS_FILE}.artifacts.${name} must be a table`);
    }
    artifacts[name] = {};
    for (const [key, value] of Object.entries(artifact)) {
      if (typeof value !== "string") {
        throw new Error(`${ARTIFACTS_FILE}.artifacts.${name}.${key} must be a string`);
      }
      artifacts[name][key as keyof PacketArtifact] = value;
    }
  }

  return {
    schemaVersion,
    artifacts: Object.fromEntries(
      Object.entries(artifacts).map(([name, artifact]) => [
        name,
        artifact as PacketArtifact,
      ]),
    ),
  };
}

export function resolveArtifactPath(
  runDir: string,
  artifactPath: string,
): { path: string; insideRunDir: boolean } {
  const resolvedPath = path.isAbsolute(artifactPath)
    ? path.resolve(artifactPath)
    : path.resolve(runDir, artifactPath);
  const relative = path.relative(runDir, resolvedPath);
  return {
    path: resolvedPath,
    insideRunDir:
      relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)),
  };
}

export function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

export function writeFileAtomic(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(temporaryPath, content, { encoding: "utf-8" });
  renameSync(temporaryPath, filePath);
}

function readJsonObject(filePath: string, label: string): Record<string, unknown> {
  if (!isFile(filePath)) {
    throw new Error(`${label} not found`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(filePath, { encoding: "utf-8" }));
  } catch {
    throw new Error(`${label} invalid JSON`);
  }
  if (!isRecord(payload)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return payload;
}

function stableJson(payload: PacketEvent): string {
  const sorted = Object.fromEntries(
    Object.keys(payload)
      .sort()
      .map((key) => [key, payload[key]]),
  );
  return JSON.stringify(sorted);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
