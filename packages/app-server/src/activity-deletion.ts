import {
  existsSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  type Stats,
} from "node:fs";
import path from "node:path";

import {
  currentWorkspaceRegistryEntry,
  resolveRegisteredWorkspace,
} from "@agentmesh/runtime/src/workspaces/registry.js";

export type StudioActivityKind = "run" | "call";

export interface StudioActivityDeletionResult {
  deleted: true;
  kind: StudioActivityKind;
  id: string;
  workspace_id: string;
}

export interface StudioActivityDeletionOptions {
  cwd: string;
  workspaceId?: string;
  registryPath?: string;
  beforeIsolation?: () => void;
}

interface DirectoryIdentity {
  path: string;
  realPath: string;
  dev: Stats["dev"];
  ino: Stats["ino"];
}

export class StudioActivityDeletionError extends Error {
  readonly status: 400 | 404;

  constructor(status: 400 | 404, message: string) {
    super(message);
    this.name = "StudioActivityDeletionError";
    this.status = status;
  }
}

export function deleteStudioActivity(
  kind: StudioActivityKind,
  id: string,
  options: StudioActivityDeletionOptions,
): StudioActivityDeletionResult {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new StudioActivityDeletionError(400, `invalid ${kind} id: ${id}`);
  }
  const workspace = options.workspaceId
    ? resolveRegisteredWorkspace(options.workspaceId, {
        currentWorkspace: options.cwd,
        registryPath: options.registryPath,
      })
    : currentWorkspaceRegistryEntry(options.cwd);
  if (!workspace) {
    throw new StudioActivityDeletionError(404, `workspace not found: ${options.workspaceId}`);
  }

  const workspaceRoot = path.resolve(workspace.path);
  const agentmeshRoot = path.join(workspaceRoot, ".agentmesh");
  const collection = kind === "run" ? "runs" : "calls";
  const marker = kind === "run" ? "status.json" : "call.json";
  const managedRoot = path.join(agentmeshRoot, collection);
  const target = path.resolve(managedRoot, id);
  const relative = path.relative(managedRoot, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new StudioActivityDeletionError(400, `invalid ${kind} id: ${id}`);
  }
  const workspaceIdentity = directoryIdentity(workspaceRoot, "workspace ancestor", 400);
  const agentmeshIdentity = directoryIdentity(agentmeshRoot, ".agentmesh ancestor", 404);
  const managedRootIdentity = directoryIdentity(managedRoot, `${kind} management root`, 404);
  const targetIdentity = directoryIdentity(target, `${kind} directory: ${id}`, 404);
  assertContainedIdentity(workspaceIdentity, agentmeshIdentity, ".agentmesh ancestor");
  assertContainedIdentity(agentmeshIdentity, managedRootIdentity, `${kind} management root`);
  assertContainedIdentity(managedRootIdentity, targetIdentity, `${kind} directory: ${id}`);
  if (!existsSync(path.join(target, marker))) {
    throw new StudioActivityDeletionError(404, `${kind} not found: ${id}`);
  }

  const quarantine = mkdtempSync(path.join(workspaceRoot, ".agentmesh-delete-"));
  const quarantineIdentity = directoryIdentity(quarantine, "deletion quarantine", 400);
  assertContainedIdentity(workspaceIdentity, quarantineIdentity, "deletion quarantine");
  const isolatedTarget = path.join(quarantine, `${kind}-${id}`);
  let isolated = false;
  let preserveQuarantine = false;
  try {
    options.beforeIsolation?.();
    assertDirectoryUnchanged(workspaceIdentity, "workspace ancestor");
    assertDirectoryUnchanged(agentmeshIdentity, ".agentmesh ancestor");
    assertDirectoryUnchanged(managedRootIdentity, `${kind} management root`);
    try {
      renameSync(target, isolatedTarget);
      isolated = true;
    } catch (error) {
      throw new StudioActivityDeletionError(
        400,
        `${kind} directory could not be isolated safely: ${errorMessage(error)}`,
      );
    }

    const isolatedIdentity = directoryIdentity(isolatedTarget, `isolated ${kind} directory`, 400);
    if (!sameFileIdentity(targetIdentity, isolatedIdentity)) {
      preserveQuarantine = true;
      throw new StudioActivityDeletionError(400, `${kind} directory changed during deletion`);
    }
    assertDirectoryUnchanged(workspaceIdentity, "workspace ancestor");
    assertDirectoryUnchanged(quarantineIdentity, "deletion quarantine");
    assertContainedIdentity(quarantineIdentity, isolatedIdentity, `isolated ${kind} directory`);
    rmSync(quarantine, { recursive: true, force: false });
  } finally {
    if (!isolated && !preserveQuarantine) {
      try {
        rmdirSync(quarantine);
      } catch {
        // An unexpected non-empty quarantine is preserved rather than recursively removed.
      }
    }
  }
  return {
    deleted: true,
    kind,
    id,
    workspace_id: workspace.id,
  };
}

function directoryIdentity(
  directory: string,
  label: string,
  missingStatus: 400 | 404,
): DirectoryIdentity {
  let stat: Stats;
  try {
    stat = lstatSync(directory);
  } catch {
    throw new StudioActivityDeletionError(missingStatus, `${label} not found`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new StudioActivityDeletionError(400, `unsafe ${label}`);
  }
  let realPath: string;
  try {
    realPath = realpathSync(directory);
  } catch {
    throw new StudioActivityDeletionError(400, `unsafe ${label}`);
  }
  if (realPath !== path.resolve(directory)) {
    throw new StudioActivityDeletionError(400, `unsafe ${label}`);
  }
  return {
    path: path.resolve(directory),
    realPath,
    dev: stat.dev,
    ino: stat.ino,
  };
}

function assertDirectoryUnchanged(identity: DirectoryIdentity, label: string): void {
  const current = directoryIdentity(identity.path, label, 400);
  if (!sameDirectoryIdentity(identity, current)) {
    throw new StudioActivityDeletionError(400, `${label} changed during deletion`);
  }
}

function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return sameFileIdentity(left, right) && left.realPath === right.realPath;
}

function sameFileIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertContainedIdentity(
  parent: DirectoryIdentity,
  child: DirectoryIdentity,
  label: string,
): void {
  const relative = path.relative(parent.realPath, child.realPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new StudioActivityDeletionError(400, `unsafe ${label}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isStudioActivityDeletionError(error: unknown): error is StudioActivityDeletionError {
  return error instanceof StudioActivityDeletionError;
}
