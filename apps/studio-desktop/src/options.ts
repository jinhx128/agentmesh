import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface StudioDesktopOptions {
  host: "127.0.0.1";
  port: number;
  workspace: string;
  assetDir: string;
}

export interface StudioDesktopDefaults {
  cwd?: string;
  assetDir?: string;
  homeDir?: string;
}

const WORKSPACE_ENV = "AGENTMESH_STUDIO_WORKSPACE";

export function parseStudioDesktopArgs(
  args: string[],
  defaults: StudioDesktopDefaults = {},
): StudioDesktopOptions {
  const cwd = path.resolve(defaults.cwd ?? process.cwd());
  const homeDir = path.resolve(defaults.homeDir ?? homedir());
  const workspace = resolveWorkspace(
    optionValue(args, "--workspace") ?? environmentWorkspace() ?? defaultWorkspace(cwd, homeDir),
    cwd,
  );
  return {
    host: "127.0.0.1",
    port: parsePort(optionValue(args, "--port") ?? "0"),
    workspace,
    assetDir: resolveAssetDir(
      optionValue(args, "--asset-dir") ?? defaults.assetDir ?? defaultBundledStudioAssetDir(),
      cwd,
    ),
  };
}

function environmentWorkspace(): string | undefined {
  const value = process.env[WORKSPACE_ENV]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function defaultWorkspace(cwd: string, homeDir: string): string {
  if (cwd !== path.parse(cwd).root) {
    return cwd;
  }
  return mostRecentRegisteredWorkspace(homeDir) ?? homeDir;
}

function resolveWorkspace(value: string, cwd: string): string {
  const workspace = path.resolve(cwd, value);
  if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
    throw new Error(`invalid --workspace: ${value}`);
  }
  return workspace;
}

function resolveAssetDir(value: string, cwd: string): string {
  const assetDir = path.resolve(cwd, value);
  if (!existsSync(assetDir) || !statSync(assetDir).isDirectory()) {
    throw new Error(`invalid --asset-dir: ${value}`);
  }
  return assetDir;
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`invalid --port: ${value}`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid --port: ${value}`);
  }
  return port;
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`missing value for ${name}`);
  }
  return value;
}

export function defaultBundledStudioAssetDir(): string {
  return fileURLToPath(
    new URL(["..", "..", "studio-web", "frontend", ""].join("/"), import.meta.url),
  );
}

function mostRecentRegisteredWorkspace(homeDir: string): string | undefined {
  const registryPath = path.join(homeDir, ".config", "agentmesh", "workspaces.json");
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(registryPath, "utf-8"));
  } catch {
    return undefined;
  }
  if (!isRecord(payload) || payload.schema_version !== 1 || !Array.isArray(payload.workspaces)) {
    return undefined;
  }
  const entries = payload.workspaces.filter(isDesktopWorkspaceRegistryEntry);
  if (entries.length !== payload.workspaces.length) {
    return undefined;
  }
  // Keep launcher parsing local to preserve the Desktop -> App Server boundary.
  // This ordering mirrors runtime workspace registry ordering and is locked by tests.
  return entries
    .filter((entry) => entry.enabled && isDirectory(entry.path))
    .sort((left, right) =>
      workspaceActivity(right).localeCompare(workspaceActivity(left))
      || left.label.localeCompare(right.label)
      || left.path.localeCompare(right.path))[0]
    ?.path;
}

interface DesktopWorkspaceRegistryEntry {
  path: string;
  label: string;
  enabled: boolean;
  created_at: string;
  last_seen_at: string;
  last_recorded_at?: string;
}

function isDesktopWorkspaceRegistryEntry(value: unknown): value is DesktopWorkspaceRegistryEntry {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.path === "string"
    && path.isAbsolute(value.path)
    && typeof value.label === "string"
    && value.label.trim().length > 0
    && typeof value.enabled === "boolean"
    && typeof value.created_at === "string"
    && typeof value.last_seen_at === "string"
    && (value.last_recorded_at === undefined || typeof value.last_recorded_at === "string");
}

function workspaceActivity(entry: DesktopWorkspaceRegistryEntry): string {
  return entry.last_recorded_at ?? entry.last_seen_at ?? entry.created_at;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectory(directory: string): boolean {
  try {
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
}
