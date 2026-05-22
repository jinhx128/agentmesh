import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  assertWorkspaceWritableForRun,
  currentRuntimeVersion,
  recordSuccessfulWorkspaceMutationForRun,
  workspaceRootFromRunDir,
} from "./compatibility.js";

const LOCK_DIR = ".agentmesh.lock";
const LEASE_FILE = "lease.json";
const RECLAIM_DIR = ".reclaiming";
const DEFAULT_LEASE_MS = 2 * 60 * 60 * 1000;

interface RunMutationLease {
  schema_version?: number;
  lock_id?: string;
  workspace?: string;
  scope?: string;
  entrypoint?: string;
  runtime_version?: string;
  operation?: string;
  operation_id?: string;
  command?: string;
  pid?: number;
  owner_id?: string;
  created_at?: string;
  heartbeat_at?: string;
  expires_at?: string;
}

export interface RunMutationLockDetails {
  lock_dir: string;
  operation: string;
  entrypoint: string;
  runtime_version: string;
  pid?: number;
  operation_id: string;
  command: string;
  heartbeat_at: string;
  expires_at: string;
}

export class RunMutationLockError extends Error {
  readonly code = "run_locked" as const;
  readonly lock: RunMutationLockDetails;

  constructor(lock: RunMutationLockDetails) {
    super(
      `run is locked by another mutation: ${lock.operation} ` +
        `(entrypoint ${lock.entrypoint}, runtime ${lock.runtime_version}, pid ${lock.pid ?? "unknown"}, ` +
        `operation_id ${lock.operation_id}, command ${lock.command}, ` +
        `heartbeat_at ${lock.heartbeat_at}, expires_at ${lock.expires_at}). ` +
        `Retry after the current mutation finishes or remove stale lock: ${lock.lock_dir}`,
    );
    this.name = "RunMutationLockError";
    this.lock = lock;
  }
}

export function isRunMutationLockError(error: unknown): error is RunMutationLockError {
  return error instanceof RunMutationLockError;
}

export interface RunMutationLockOptions {
  entrypoint?: string;
  runtimeVersion?: string;
  operationId?: string;
  command?: string;
  heartbeatIntervalMs?: number;
  leaseMs?: number;
}

interface AcquiredRunMutationLock {
  release: () => void;
  stopHeartbeat: () => void;
}

export function withRunMutationLock<T>(
  runDir: string,
  operation: string,
  action: () => T,
  options: RunMutationLockOptions = {},
): T {
  const lock = acquireRunMutationLock(runDir, operation, options);
  try {
    const result = action();
    recordSuccessfulWorkspaceMutationForRun(runDir, {
      entrypoint: options.entrypoint,
      runtimeVersion: options.runtimeVersion,
    });
    return result;
  } finally {
    lock.stopHeartbeat();
    lock.release();
  }
}

export async function withRunMutationLockAsync<T>(
  runDir: string,
  operation: string,
  action: () => Promise<T> | T,
  options: RunMutationLockOptions = {},
): Promise<T> {
  const lock = acquireRunMutationLock(runDir, operation, options);
  try {
    const result = await action();
    recordSuccessfulWorkspaceMutationForRun(runDir, {
      entrypoint: options.entrypoint,
      runtimeVersion: options.runtimeVersion,
    });
    return result;
  } finally {
    lock.stopHeartbeat();
    lock.release();
  }
}

function acquireRunMutationLock(
  runDir: string,
  operation: string,
  options: RunMutationLockOptions,
): AcquiredRunMutationLock {
  assertRunDirectory(runDir);
  assertWorkspaceWritableForRun(runDir, {
    entrypoint: options.entrypoint,
    runtimeVersion: options.runtimeVersion,
  });
  const lockDir = path.join(runDir, LOCK_DIR);
  const lockId = `lock-${process.pid}-${Date.now()}`;
  const now = new Date();
  const workspace = workspaceRootFromRunDir(runDir) ?? path.dirname(runDir);
  const lease: RunMutationLease = {
    schema_version: 1,
    lock_id: lockId,
    workspace,
    scope: `run:${path.basename(runDir)}`,
    entrypoint: options.entrypoint ?? "cli",
    runtime_version: options.runtimeVersion ?? currentRuntimeVersion(),
    operation,
    operation_id: options.operationId ?? lockId,
    command: options.command ?? operation,
    pid: process.pid,
    owner_id: lockId,
    created_at: now.toISOString(),
    heartbeat_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (options.leaseMs ?? DEFAULT_LEASE_MS)).toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(lockDir);
      writeLease(lockDir, lease);
      return {
        release: () => releaseRunMutationLock(lockDir, lockId),
        stopHeartbeat: startHeartbeat(lockDir, lockId, options.heartbeatIntervalMs),
      };
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      const activeLease = readLease(lockDir);
      if (!leaseExpired(activeLease, Date.now())) {
        throw lockedError(lockDir, activeLease);
      }
      if (!reclaimExpiredLease(lockDir)) {
        continue;
      }
    }
  }
  throw new Error(`run is locked; could not acquire mutation lock: ${lockDir}`);
}

function releaseRunMutationLock(lockDir: string, lockId: string): void {
  const lease = readLease(lockDir);
  const activeId = lease.lock_id ?? lease.owner_id;
  if (activeId && activeId !== lockId) {
    return;
  }
  rmSync(lockDir, { recursive: true, force: true });
}

function startHeartbeat(
  lockDir: string,
  lockId: string,
  intervalMs = 30_000,
): () => void {
  if (intervalMs <= 0) {
    return () => {};
  }
  const timer = setInterval(() => {
    refreshHeartbeat(lockDir, lockId);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

function refreshHeartbeat(lockDir: string, lockId: string): void {
  const lease = readLease(lockDir);
  const activeId = lease.lock_id ?? lease.owner_id;
  if (activeId !== lockId) {
    return;
  }
  writeLease(lockDir, {
    ...lease,
    heartbeat_at: new Date().toISOString(),
  });
}

function writeLease(lockDir: string, lease: RunMutationLease): void {
  writeFileSync(path.join(lockDir, LEASE_FILE), `${JSON.stringify(lease, null, 2)}\n`, {
    encoding: "utf-8",
  });
}

function readLease(lockDir: string): RunMutationLease {
  try {
    const payload = JSON.parse(readFileSync(path.join(lockDir, LEASE_FILE), "utf-8"));
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      return payload as RunMutationLease;
    }
  } catch {
    // Missing or malformed leases are treated as active unknown locks.
  }
  return {};
}

function leaseExpired(lease: RunMutationLease, nowMs: number): boolean {
  if (!lease.expires_at) {
    return false;
  }
  const expiresAt = Date.parse(lease.expires_at);
  return Number.isFinite(expiresAt) && expiresAt <= nowMs;
}

function reclaimExpiredLease(lockDir: string): boolean {
  const reclaimDir = path.join(lockDir, RECLAIM_DIR);
  try {
    mkdirSync(reclaimDir);
  } catch (error) {
    if (isAlreadyExists(error)) {
      return false;
    }
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
  const lease = readLease(lockDir);
  if (!leaseExpired(lease, Date.now())) {
    rmSync(reclaimDir, { recursive: true, force: true });
    throw lockedError(lockDir, lease);
  }
  rmSync(lockDir, { recursive: true, force: true });
  return true;
}

function lockedError(lockDir: string, lease: RunMutationLease): Error {
  return new RunMutationLockError({
    lock_dir: lockDir,
    operation: lease.operation ?? "unknown",
    entrypoint: lease.entrypoint ?? "unknown",
    runtime_version: lease.runtime_version ?? "unknown",
    ...(lease.pid !== undefined ? { pid: lease.pid } : {}),
    operation_id: lease.operation_id ?? "unknown",
    command: lease.command ?? "unknown",
    heartbeat_at: lease.heartbeat_at ?? "unknown",
    expires_at: lease.expires_at ?? "unknown",
  });
}

function assertRunDirectory(runDir: string): void {
  try {
    if (statSync(runDir).isDirectory()) {
      return;
    }
  } catch {
    // Fall through to consistent error.
  }
  throw new Error(`run directory not found: ${runDir}`);
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "EEXIST"
  );
}

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
