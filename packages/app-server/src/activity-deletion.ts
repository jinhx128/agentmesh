import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
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

  const collection = kind === "run" ? "runs" : "calls";
  const marker = kind === "run" ? "status.json" : "call.json";
  const managedRoot = path.resolve(workspace.path, ".agentmesh", collection);
  const target = path.resolve(managedRoot, id);
  const relative = path.relative(managedRoot, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new StudioActivityDeletionError(400, `invalid ${kind} id: ${id}`);
  }
  if (!existsSync(managedRoot) || !existsSync(target) || !existsSync(path.join(target, marker))) {
    throw new StudioActivityDeletionError(404, `${kind} not found: ${id}`);
  }

  let rootStat;
  let targetStat;
  try {
    rootStat = lstatSync(managedRoot);
    targetStat = lstatSync(target);
  } catch {
    throw new StudioActivityDeletionError(404, `${kind} not found: ${id}`);
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new StudioActivityDeletionError(400, `unsafe ${kind} management root`);
  }
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
    throw new StudioActivityDeletionError(400, `unsafe ${kind} directory: ${id}`);
  }

  const realRoot = realpathSync(managedRoot);
  const realTarget = realpathSync(target);
  const realRelative = path.relative(realRoot, realTarget);
  if (realRelative === "" || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new StudioActivityDeletionError(400, `unsafe ${kind} directory: ${id}`);
  }

  rmSync(target, { recursive: true, force: false });
  return {
    deleted: true,
    kind,
    id,
    workspace_id: workspace.id,
  };
}

export function isStudioActivityDeletionError(error: unknown): error is StudioActivityDeletionError {
  return error instanceof StudioActivityDeletionError;
}
