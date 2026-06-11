import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeFileAtomic } from "../packet/io.js";

export const WORKSPACE_REGISTRY_SCHEMA_VERSION = 1 as const;

export interface WorkspaceRegistryEntry {
  id: string;
  path: string;
  label: string;
  enabled: boolean;
  created_at: string;
  last_seen_at: string;
  last_recorded_at?: string;
}

export interface WorkspaceRegistryFile {
  schema_version: typeof WORKSPACE_REGISTRY_SCHEMA_VERSION;
  workspaces: WorkspaceRegistryEntry[];
}

export interface WorkspaceRegistryOptions {
  registryPath?: string;
  now?: Date | string;
  label?: string;
}

export interface WorkspaceRegistryReadOptions {
  registryPath?: string;
}

export interface WorkspaceRegistryResolveOptions extends WorkspaceRegistryReadOptions {
  currentWorkspace?: string;
}

export function workspaceRegistryPath(): string {
  return path.join(os.homedir(), ".config", "agentmesh", "workspaces.json");
}

export function workspaceIdForPath(workspacePath: string): string {
  const realWorkspacePath = realpathSync(workspacePath);
  return workspaceIdForRealpath(realWorkspacePath);
}

export function workspaceIdForRealpath(realWorkspacePath: string): string {
  const digest = createHash("sha256").update(realWorkspacePath).digest("hex").slice(0, 16);
  return `ws-${digest}`;
}

export function currentWorkspaceRegistryEntry(
  workspacePath: string,
  options: Pick<WorkspaceRegistryOptions, "now" | "label"> = {},
): WorkspaceRegistryEntry {
  const realWorkspacePath = realpathSync(workspacePath);
  const now = instant(options.now);
  return {
    id: workspaceIdForRealpath(realWorkspacePath),
    path: realWorkspacePath,
    label: normalizeLabel(options.label, realWorkspacePath),
    enabled: true,
    created_at: now,
    last_seen_at: now,
  };
}

export function registerWorkspace(
  workspacePath: string,
  options: WorkspaceRegistryOptions = {},
): WorkspaceRegistryEntry {
  const realWorkspacePath = realpathSync(workspacePath);
  const now = instant(options.now);
  return updateRegistry(options, (registry) => {
    const id = workspaceIdForRealpath(realWorkspacePath);
    assertNoWorkspaceIdConflict(registry, id, realWorkspacePath);
    const existing = registry.workspaces.find((entry) => entry.path === realWorkspacePath);
    if (existing) {
      existing.last_seen_at = now;
      existing.enabled = true;
      if (options.label !== undefined) {
        existing.label = normalizeLabel(options.label, realWorkspacePath);
      }
      return existing;
    }
    const entry: WorkspaceRegistryEntry = {
      id,
      path: realWorkspacePath,
      label: normalizeLabel(options.label, realWorkspacePath),
      enabled: true,
      created_at: now,
      last_seen_at: now,
    };
    registry.workspaces.push(entry);
    return entry;
  });
}

export function recordWorkspaceActivity(
  workspacePath: string,
  options: WorkspaceRegistryOptions = {},
): WorkspaceRegistryEntry {
  const realWorkspacePath = realpathSync(workspacePath);
  const now = instant(options.now);
  return updateRegistry(options, (registry) => {
    const id = workspaceIdForRealpath(realWorkspacePath);
    assertNoWorkspaceIdConflict(registry, id, realWorkspacePath);
    const existing = registry.workspaces.find((entry) => entry.path === realWorkspacePath);
    if (existing) {
      existing.last_seen_at = now;
      existing.last_recorded_at = now;
      existing.enabled = true;
      if (options.label !== undefined) {
        existing.label = normalizeLabel(options.label, realWorkspacePath);
      }
      return existing;
    }
    const entry: WorkspaceRegistryEntry = {
      id,
      path: realWorkspacePath,
      label: normalizeLabel(options.label, realWorkspacePath),
      enabled: true,
      created_at: now,
      last_seen_at: now,
      last_recorded_at: now,
    };
    registry.workspaces.push(entry);
    return entry;
  });
}

export function listRegisteredWorkspaces(
  options: WorkspaceRegistryReadOptions = {},
): WorkspaceRegistryEntry[] {
  return sortRegistryEntries(readRegistry(options).workspaces);
}

export function resolveRegisteredWorkspace(
  workspaceId: string,
  options: WorkspaceRegistryResolveOptions = {},
): WorkspaceRegistryEntry | undefined {
  if (options.currentWorkspace) {
    const current = currentWorkspaceRegistryEntry(options.currentWorkspace);
    if (current.id === workspaceId) {
      return current;
    }
  }
  return listRegisteredWorkspaces(options).find((entry) => entry.enabled && entry.id === workspaceId);
}

export function enableRegisteredWorkspace(
  workspaceId: string,
  options: WorkspaceRegistryOptions = {},
): WorkspaceRegistryEntry {
  return setWorkspaceEnabled(workspaceId, true, options);
}

export function disableRegisteredWorkspace(
  workspaceId: string,
  options: WorkspaceRegistryOptions = {},
): WorkspaceRegistryEntry {
  return setWorkspaceEnabled(workspaceId, false, options);
}

export function isExistingWorkspacePath(workspacePath: string): boolean {
  try {
    return statSync(workspacePath).isDirectory();
  } catch {
    return false;
  }
}

function setWorkspaceEnabled(
  workspaceId: string,
  enabled: boolean,
  options: WorkspaceRegistryOptions,
): WorkspaceRegistryEntry {
  const now = instant(options.now);
  return updateRegistry(options, (registry) => {
    const entry = registry.workspaces.find((item) => item.id === workspaceId);
    if (!entry) {
      throw new Error(`workspace not found: ${workspaceId}`);
    }
    entry.enabled = enabled;
    entry.last_seen_at = now;
    return entry;
  });
}

function updateRegistry(
  options: WorkspaceRegistryOptions,
  mutate: (registry: WorkspaceRegistryFile) => WorkspaceRegistryEntry,
): WorkspaceRegistryEntry {
  const registryPath = options.registryPath ?? workspaceRegistryPath();
  const registry = readRegistry({ registryPath });
  const entry = mutate(registry);
  registry.workspaces = sortRegistryEntries(deduplicateRegistryEntries(registry.workspaces));
  writeRegistry(registryPath, registry);
  return { ...entry };
}

function readRegistry(options: WorkspaceRegistryReadOptions): WorkspaceRegistryFile {
  const registryPath = options.registryPath ?? workspaceRegistryPath();
  if (!existsSync(registryPath)) {
    return { schema_version: WORKSPACE_REGISTRY_SCHEMA_VERSION, workspaces: [] };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(registryPath, { encoding: "utf-8" }));
  } catch {
    throw new Error(`workspace registry invalid JSON: ${registryPath}`);
  }
  if (!isRecord(payload)) {
    throw new Error(`workspace registry must be a JSON object: ${registryPath}`);
  }
  if (payload.schema_version !== WORKSPACE_REGISTRY_SCHEMA_VERSION) {
    throw new Error(`unsupported workspace registry schema: ${String(payload.schema_version)}`);
  }
  if (!Array.isArray(payload.workspaces)) {
    throw new Error(`workspace registry workspaces must be an array: ${registryPath}`);
  }
  return {
    schema_version: WORKSPACE_REGISTRY_SCHEMA_VERSION,
    workspaces: payload.workspaces.map((entry, index) =>
      parseRegistryEntry(entry, `${registryPath}.workspaces[${index}]`)),
  };
}

function writeRegistry(registryPath: string, registry: WorkspaceRegistryFile): void {
  writeFileAtomic(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

function parseRegistryEntry(value: unknown, label: string): WorkspaceRegistryEntry {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const entry = value as Partial<WorkspaceRegistryEntry>;
  if (typeof entry.id !== "string" || !/^ws-[a-f0-9]{16}$/.test(entry.id)) {
    throw new Error(`${label}.id must be a workspace id`);
  }
  if (typeof entry.path !== "string" || !path.isAbsolute(entry.path)) {
    throw new Error(`${label}.path must be an absolute path`);
  }
  if (typeof entry.label !== "string" || entry.label.trim().length === 0) {
    throw new Error(`${label}.label must be a non-empty string`);
  }
  if (typeof entry.enabled !== "boolean") {
    throw new Error(`${label}.enabled must be a boolean`);
  }
  if (typeof entry.created_at !== "string" || typeof entry.last_seen_at !== "string") {
    throw new Error(`${label} timestamps must be strings`);
  }
  if (entry.last_recorded_at !== undefined && typeof entry.last_recorded_at !== "string") {
    throw new Error(`${label}.last_recorded_at must be a string`);
  }
  return {
    id: entry.id,
    path: entry.path,
    label: entry.label,
    enabled: entry.enabled,
    created_at: entry.created_at,
    last_seen_at: entry.last_seen_at,
    ...(entry.last_recorded_at !== undefined ? { last_recorded_at: entry.last_recorded_at } : {}),
  };
}

function assertNoWorkspaceIdConflict(
  registry: WorkspaceRegistryFile,
  id: string,
  realWorkspacePath: string,
): void {
  const conflict = registry.workspaces.find((entry) => entry.id === id && entry.path !== realWorkspacePath);
  if (conflict) {
    throw new Error(`workspace id conflict: ${id} for ${realWorkspacePath} and ${conflict.path}`);
  }
}

function deduplicateRegistryEntries(entries: WorkspaceRegistryEntry[]): WorkspaceRegistryEntry[] {
  const byPath = new Map<string, WorkspaceRegistryEntry>();
  for (const entry of entries) {
    byPath.set(entry.path, entry);
  }
  return [...byPath.values()];
}

function sortRegistryEntries(entries: WorkspaceRegistryEntry[]): WorkspaceRegistryEntry[] {
  return [...entries].sort((left, right) =>
    registrySortTimestamp(right).localeCompare(registrySortTimestamp(left))
      || left.label.localeCompare(right.label)
      || left.path.localeCompare(right.path));
}

function registrySortTimestamp(entry: WorkspaceRegistryEntry): string {
  return entry.last_recorded_at ?? entry.last_seen_at ?? entry.created_at;
}

function normalizeLabel(label: string | undefined, workspacePath: string): string {
  const trimmed = label?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : path.basename(workspacePath);
}

function instant(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
