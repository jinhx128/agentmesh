import { existsSync, readdirSync, statSync } from "node:fs";
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
const MAX_WORKSPACE_DISCOVERY_DEPTH = 4;
const MAX_WORKSPACE_DISCOVERY_DIRS = 2000;

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
  return discoverAgentMeshWorkspace(homeDir) ?? homeDir;
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

function discoverAgentMeshWorkspace(homeDir: string): string | undefined {
  const candidateRoots = uniquePaths([
    path.join(homeDir, "Documents", "WebStorm"),
    path.join(homeDir, "Documents"),
    path.join(homeDir, "Developer"),
    path.join(homeDir, "Code"),
    path.join(homeDir, "Projects"),
    homeDir,
  ]).filter(isDirectory);
  const found: WorkspaceCandidate[] = [];
  let scanned = 0;
  for (const root of candidateRoots) {
    scanWorkspaceCandidates(root, MAX_WORKSPACE_DISCOVERY_DEPTH, found, () => {
      scanned += 1;
      return scanned <= MAX_WORKSPACE_DISCOVERY_DIRS;
    });
    if (scanned > MAX_WORKSPACE_DISCOVERY_DIRS) {
      break;
    }
  }
  found.sort((left, right) =>
    right.score - left.score
    || right.updatedAtMs - left.updatedAtMs
    || left.workspace.localeCompare(right.workspace)
  );
  return found[0]?.workspace;
}

interface WorkspaceCandidate {
  workspace: string;
  score: number;
  updatedAtMs: number;
}

function scanWorkspaceCandidates(
  directory: string,
  depth: number,
  found: WorkspaceCandidate[],
  shouldContinue: () => boolean,
): void {
  if (!shouldContinue()) {
    return;
  }
  const candidate = workspaceCandidate(directory);
  if (candidate) {
    found.push(candidate);
  }
  if (depth <= 0) {
    return;
  }
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || shouldSkipWorkspaceDiscoveryEntry(entry.name)) {
      continue;
    }
    scanWorkspaceCandidates(path.join(directory, entry.name), depth - 1, found, shouldContinue);
  }
}

function workspaceCandidate(directory: string): WorkspaceCandidate | undefined {
  const runRoot = path.join(directory, ".agentmesh", "runs");
  const runTimestamp = newestStatusTimestamp(runRoot);
  if (runTimestamp !== undefined) {
    return { workspace: directory, score: 3, updatedAtMs: runTimestamp };
  }
  const configPath = path.join(directory, ".agentmesh", "config.toml");
  if (isFile(configPath)) {
    return { workspace: directory, score: 2, updatedAtMs: fileMtimeMs(configPath) };
  }
  const rootConfigPath = path.join(directory, "agentmesh.toml");
  if (isFile(rootConfigPath)) {
    return { workspace: directory, score: 1, updatedAtMs: fileMtimeMs(rootConfigPath) };
  }
  return undefined;
}

function newestStatusTimestamp(runRoot: string): number | undefined {
  let newest = 0;
  for (const statusPath of statusFiles(runRoot)) {
    newest = Math.max(newest, fileMtimeMs(statusPath));
  }
  return newest > 0 ? newest : undefined;
}

function statusFiles(runRoot: string): string[] {
  let entries;
  try {
    entries = readdirSync(runRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runRoot, entry.name, "status.json"))
    .filter(isFile);
}

function shouldSkipWorkspaceDiscoveryEntry(name: string): boolean {
  return name === "node_modules"
    || name === ".git"
    || name === "dist-node"
    || name === "target"
    || name === "Library"
    || name === "Applications";
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((value) => path.resolve(value)))];
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directory: string): boolean {
  try {
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function fileMtimeMs(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}
