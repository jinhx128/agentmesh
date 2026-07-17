import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  closeSync,
  chmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import type { HostScopeInput } from "../flow/types.js";

export const HOST_KINDS = [
  "codex",
  "cursor",
  "claude-code",
  "antigravity",
  "opencode",
  "studio-desktop",
  "headless-cli",
  "unknown",
] as const;

export type HostKind = (typeof HOST_KINDS)[number];

export interface ResolvedHostScope {
  host_kind: HostKind;
  conversation_scope_ref?: string;
  workspace_id: string;
  worktree_id: string;
  scope_source: "native" | "propagated" | "missing";
}

export interface HostScopeOptions {
  hmacKeyPath?: string;
}

const PROPAGATED_SCOPE_TOKEN_PATTERN = /^amscope_v1:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const SCOPE_KEY_FILE_NAME = "reviewer-session-scope.key";
const SCOPE_KEY_BYTES = 32;
const LOCK_RETRY_MILLISECONDS = 10;
const LOCK_RETRY_ATTEMPTS = 500;
const REPAIR_LOCK_STALE_MILLISECONDS = 30_000;
const lockWaitArray = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

interface FileIdentity {
  device: number | bigint;
  inode: number | bigint;
}

interface ScopeKeyState {
  kind: "valid" | "invalid" | "missing";
  key?: Buffer;
  identity?: FileIdentity;
}

interface RepairLock {
  descriptor: number;
  identity: FileIdentity;
}

export function resolveHostScope(
  input: HostScopeInput,
  cwd: string,
  options: HostScopeOptions = {},
): ResolvedHostScope {
  const identities = resolveCheckoutIdentities(cwd);
  const hostKind = normalizeHostKind(input.hostKind);
  const nativeConversationId = nonEmptyString(input.nativeConversationId);
  if (nativeConversationId) {
    return {
      host_kind: hostKind,
      conversation_scope_ref: scopeReference(hostKind, "native", nativeConversationId, options),
      ...identities,
      scope_source: "native",
    };
  }

  const propagatedScopeToken = normalizedPropagatedScopeToken(input.propagatedScopeToken);
  if (propagatedScopeToken) {
    return {
      host_kind: hostKind,
      conversation_scope_ref: scopeReference(hostKind, "propagated", propagatedScopeToken, options),
      ...identities,
      scope_source: "propagated",
    };
  }

  return {
    host_kind: hostKind,
    ...identities,
    scope_source: "missing",
  };
}

export function hostScopeKeyPath(): string {
  return path.join(os.homedir(), ".config", "agentmesh", SCOPE_KEY_FILE_NAME);
}

function normalizeHostKind(value: string | undefined): HostKind {
  return typeof value === "string" && HOST_KINDS.includes(value as HostKind)
    ? value as HostKind
    : "unknown";
}

function normalizedPropagatedScopeToken(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = PROPAGATED_SCOPE_TOKEN_PATTERN.exec(value);
  return match ? `amscope_v1:${match[1].toLowerCase()}` : undefined;
}

function nonEmptyString(value: string | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function scopeReference(
  hostKind: HostKind,
  source: "native" | "propagated",
  value: string,
  options: HostScopeOptions,
): string {
  const key = loadOrCreateScopeKey(options.hmacKeyPath ?? hostScopeKeyPath());
  const digest = createHmac("sha256", key)
    .update("agentmesh:reviewer-session-scope:v1\0")
    .update(hostKind)
    .update("\0")
    .update(source)
    .update("\0")
    .update(value)
    .digest("hex")
    .slice(0, 16);
  return `cs-${digest}`;
}

function loadOrCreateScopeKey(keyPath: string): Buffer {
  const parent = path.dirname(keyPath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  return ensureScopeKey(keyPath);
}

function ensureScopeKey(keyPath: string): Buffer {
  const state = inspectScopeKey(keyPath);
  if (state.kind === "valid") {
    return state.key as Buffer;
  }
  if (state.kind === "missing") {
    return createAndPublishScopeKey(keyPath);
  }
  return repairInvalidScopeKey(keyPath);
}

function inspectScopeKey(keyPath: string): ScopeKeyState {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(keyPath);
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return { kind: "missing" };
    }
    throw new Error("unable to inspect reviewer session scope key");
  }
  if (!stat.isFile()) {
    throw new Error("reviewer session scope key is unsafe");
  }
  chmodSync(keyPath, 0o600);
  const key = readFileSync(keyPath);
  if (key.length === SCOPE_KEY_BYTES) {
    return { kind: "valid", key, identity: fileIdentity(stat) };
  }
  return { kind: "invalid", identity: fileIdentity(stat) };
}

function repairInvalidScopeKey(keyPath: string): Buffer {
  const lockPath = `${keyPath}.lock`;
  return withRepairLock(lockPath, (lockIdentity) => {
    for (;;) {
      const state = inspectScopeKey(keyPath);
      if (state.kind === "valid") {
        return state.key as Buffer;
      }
      if (state.kind === "missing") {
        return createAndPublishScopeKey(keyPath);
      }
      if (removeInvalidScopeKey(keyPath, state.identity as FileIdentity, lockPath, lockIdentity)) {
        return createAndPublishScopeKey(keyPath);
      }
    }
  });
}

function removeInvalidScopeKey(
  keyPath: string,
  expectedIdentity: FileIdentity,
  lockPath: string,
  lockIdentity: FileIdentity,
): boolean {
  const current = inspectScopeKey(keyPath);
  if (current.kind !== "invalid" || !sameFileIdentity(current.identity as FileIdentity, expectedIdentity)) {
    return false;
  }
  const revalidated = inspectScopeKey(keyPath);
  if (revalidated.kind !== "invalid" || !sameFileIdentity(revalidated.identity as FileIdentity, expectedIdentity)) {
    return false;
  }
  if (!isRepairLockCurrent(lockPath, lockIdentity)) {
    return false;
  }
  try {
    unlinkSync(keyPath);
    return true;
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return false;
    }
    throw new Error("unable to repair reviewer session scope key");
  }
}

function createAndPublishScopeKey(keyPath: string): Buffer {
  const key = randomBytes(SCOPE_KEY_BYTES);
  const temporaryPath = uniqueTemporaryKeyPath(keyPath);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFully(descriptor, key);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporaryPath, 0o600);
    try {
      linkSync(temporaryPath, keyPath);
    } catch (error: unknown) {
      if (!isAlreadyExists(error)) {
        throw new Error("unable to publish reviewer session scope key");
      }
      return ensureScopeKey(keyPath);
    }
    syncDirectory(path.dirname(keyPath));
    return key;
  } finally {
    if (descriptor !== undefined) {
      bestEffortClose(descriptor);
    }
    bestEffortUnlink(temporaryPath);
  }
}

function writeFully(descriptor: number, data: Buffer): void {
  let offset = 0;
  while (offset < data.length) {
    const written = writeSync(descriptor, data, offset, data.length - offset, offset);
    if (written === 0) {
      throw new Error("unable to write reviewer session scope key");
    }
    offset += written;
  }
}

function uniqueTemporaryKeyPath(keyPath: string): string {
  return path.join(
    path.dirname(keyPath),
    `.${path.basename(keyPath)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
}

function withRepairLock<T>(lockPath: string, operation: (lockIdentity: FileIdentity) => T): T {
  const lock = acquireRepairLock(lockPath);
  try {
    return operation(lock.identity);
  } finally {
    bestEffortClose(lock.descriptor);
    removeRepairLockIfCurrent(lockPath, lock.identity);
  }
}

function acquireRepairLock(lockPath: string): RepairLock {
  for (let attempt = 0; attempt < LOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return createRepairLock(lockPath);
    } catch (error: unknown) {
      if (!isAlreadyExists(error)) {
        throw new Error("unable to lock reviewer session scope key");
      }
      if (reclaimStaleRepairLock(lockPath)) {
        continue;
      }
      Atomics.wait(lockWaitArray, 0, 0, LOCK_RETRY_MILLISECONDS);
    }
  }
  throw new Error("timed out waiting for reviewer session scope key");
}

function createRepairLock(lockPath: string): RepairLock {
  const descriptor = openSync(lockPath, "wx", 0o600);
  let identity: FileIdentity | undefined;
  try {
    const stat = lstatSync(lockPath);
    if (!stat.isFile()) {
      throw new Error("reviewer session repair lock is unsafe");
    }
    identity = fileIdentity(stat);
    const metadata = Buffer.from(JSON.stringify({ pid: process.pid, created_at_ms: Date.now() }));
    writeFully(descriptor, metadata);
    fsyncSync(descriptor);
    return { descriptor, identity };
  } catch (error) {
    bestEffortClose(descriptor);
    if (identity) {
      removeRepairLockIfCurrent(lockPath, identity);
    } else {
      bestEffortUnlink(lockPath);
    }
    throw error;
  }
}

function reclaimStaleRepairLock(lockPath: string): boolean {
  const candidate = inspectRepairLock(lockPath);
  if (!candidate || !isRepairLockStale(lockPath, candidate)) {
    return false;
  }
  const revalidated = inspectRepairLock(lockPath);
  if (!revalidated || !sameFileIdentity(candidate, revalidated) || !isRepairLockStale(lockPath, revalidated)) {
    return false;
  }
  try {
    unlinkSync(lockPath);
    return true;
  } catch (error: unknown) {
    return isNotFound(error);
  }
}

function inspectRepairLock(lockPath: string): FileIdentity | undefined {
  try {
    const stat = lstatSync(lockPath);
    return stat.isFile() ? fileIdentity(stat) : undefined;
  } catch {
    return undefined;
  }
}

function isRepairLockStale(lockPath: string, expectedIdentity: FileIdentity): boolean {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(lockPath);
  } catch {
    return false;
  }
  if (!stat.isFile() || !sameFileIdentity(fileIdentity(stat), expectedIdentity)) {
    return false;
  }
  const owner = readRepairLockOwner(lockPath);
  if (owner !== undefined) {
    return !isProcessAlive(owner);
  }
  return Date.now() - stat.mtimeMs >= REPAIR_LOCK_STALE_MILLISECONDS;
}

function readRepairLockOwner(lockPath: string): number | undefined {
  try {
    const payload: unknown = JSON.parse(readFileSync(lockPath, "utf-8"));
    if (
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as { pid?: unknown }).pid === "number" &&
      Number.isSafeInteger((payload as { pid: number }).pid) &&
      (payload as { pid: number }).pid > 0
    ) {
      return (payload as { pid: number }).pid;
    }
  } catch {
    // An unreadable lock relies on the conservative mtime stale check.
  }
  return undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !(typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ESRCH");
  }
}

function removeRepairLockIfCurrent(lockPath: string, expectedIdentity: FileIdentity): void {
  try {
    const stat = lstatSync(lockPath);
    if (stat.isFile() && sameFileIdentity(fileIdentity(stat), expectedIdentity)) {
      unlinkSync(lockPath);
    }
  } catch {
    // Lock cleanup is best effort and must not replace the operation result.
  }
}

function isRepairLockCurrent(lockPath: string, expectedIdentity: FileIdentity): boolean {
  try {
    const stat = lstatSync(lockPath);
    return stat.isFile() && sameFileIdentity(fileIdentity(stat), expectedIdentity);
  } catch {
    return false;
  }
}

function syncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(directory, "r");
    fsyncSync(descriptor);
  } catch {
    // Directory syncing is unavailable on some supported filesystems.
  } finally {
    if (descriptor !== undefined) {
      bestEffortClose(descriptor);
    }
  }
}

function bestEffortClose(descriptor: number): void {
  try {
    closeSync(descriptor);
  } catch {
    // Cleanup failures must not replace a successful key operation.
  }
}

function bestEffortUnlink(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Cleanup failures must not replace a successful key operation.
  }
}

function fileIdentity(stat: { dev: number | bigint; ino: number | bigint }): FileIdentity {
  return { device: stat.dev, inode: stat.ino };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function resolveCheckoutIdentities(cwd: string): { workspace_id: string; worktree_id: string } {
  const realCwd = realpathSync.native(cwd);
  const git = gitCheckoutIdentity(realCwd);
  if (!git) {
    return {
      workspace_id: opaqueIdentity("ws", "non-git-workspace", realCwd),
      worktree_id: opaqueIdentity("wt", "non-git-worktree", realCwd),
    };
  }
  return {
    workspace_id: opaqueIdentity("ws", "git-workspace", git.commonDir),
    worktree_id: opaqueIdentity("wt", "git-worktree", git.topLevel, git.gitDir),
  };
}

function gitCheckoutIdentity(cwd: string): { topLevel: string; commonDir: string; gitDir: string } | undefined {
  try {
    const output = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--git-dir"],
      { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const [topLevel, commonDir, gitDir] = output.trim().split("\n");
    if (!topLevel || !commonDir || !gitDir) {
      return undefined;
    }
    return {
      topLevel: realpathSync.native(topLevel),
      commonDir: realpathSync.native(commonDir),
      gitDir: realpathSync.native(gitDir),
    };
  } catch {
    return undefined;
  }
}

function opaqueIdentity(prefix: "ws" | "wt", domain: string, ...parts: string[]): string {
  const hash = createHash("sha256");
  hash.update(`agentmesh:${domain}:v1\0`);
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return `${prefix}-${hash.digest("hex").slice(0, 16)}`;
}
