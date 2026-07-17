import {
  existsSync,
  lstatSync,
  realpathSync,
  rmdirSync,
  type Stats,
} from "node:fs";
import path from "node:path";

import {
  cleanAnchoredDirectory,
  isAnchoredDirectoryCleanupError,
} from "@agentmesh/runtime/src/fs/anchored-directory.js";
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
  afterTargetOpen?: () => void;
  beforeFinalRmdir?: () => void;
}

interface DirectoryIdentity {
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

  try {
    cleanAnchoredDirectory({
      targetPath: target,
      expectedDev: targetIdentity.dev,
      expectedIno: targetIdentity.ino,
      afterOpen: options.afterTargetOpen,
    });
  } catch (error) {
    if (!isAnchoredDirectoryCleanupError(error)) {
      throw error;
    }
    const message = {
      changed: `${kind} directory changed during deletion`,
      unavailable: `${kind} directory anchor is unavailable`,
      timeout: `${kind} directory cleanup timed out safely`,
      cleanup_failed: `${kind} directory could not be cleaned safely`,
    }[error.reason];
    throw new StudioActivityDeletionError(400, message);
  }

  options.beforeFinalRmdir?.();
  let finalIdentity: DirectoryIdentity;
  try {
    finalIdentity = directoryIdentity(target, `${kind} directory`, 400);
  } catch {
    throw new StudioActivityDeletionError(400, `${kind} directory changed during deletion`);
  }
  if (!sameDirectoryIdentity(targetIdentity, finalIdentity)) {
    throw new StudioActivityDeletionError(400, `${kind} directory changed during deletion`);
  }
  try {
    rmdirSync(target);
  } catch {
    throw new StudioActivityDeletionError(
      400,
      `${kind} directory could not remove empty directory safely`,
    );
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
    realPath,
    dev: stat.dev,
    ino: stat.ino,
  };
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

export function isStudioActivityDeletionError(error: unknown): error is StudioActivityDeletionError {
  return error instanceof StudioActivityDeletionError;
}
