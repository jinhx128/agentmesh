import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  futimesSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import {
  readReviewerSessionEpochEvidence,
  reviewerSessionRegistryPath,
} from "./registry.js";

export const REVIEWER_SESSION_LEASE_WAIT_MS = 5_000;
export const REVIEWER_SESSION_HEARTBEAT_MS = 10_000;
export const REVIEWER_SESSION_MISSED_HEARTBEATS = 3;

/** Required acquisition order for later dispatch integration. */
export const REVIEWER_SESSION_LOCK_ORDER = ["run-mutation", "entry-lease", "provider-spawn"] as const;

const REGISTRY_KEY_PATTERN = /^rk-[a-f0-9]{32}$/;
const OWNER_TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const RETRY_INTERVAL_MS = 10;

export interface ReviewerSessionLeaseOptions {
  waitMs?: number;
  heartbeatMs?: number;
  registryPath?: string;
}

interface ProcessOwner {
  pid: number;
  startIdentity: string;
}

type ProcessInspection =
  | { status: "same" }
  | { status: "different"; actualStartIdentity: string }
  | { status: "dead" }
  | { status: "unknown" };

export interface ReviewerSessionLeaseTestHooks {
  now?: () => number;
  currentOwner?: () => ProcessOwner | undefined;
  inspectProcess?: (pid: number, expectedStartIdentity: string) => ProcessInspection;
  sleep?: (milliseconds: number) => Promise<void>;
  onConfigured?: (options: { waitMs: number; heartbeatMs: number }) => void;
  beforePublish?: (temporaryPath: string, publishedPath: string) => void;
  beforeRelease?: (publishedPath: string) => void;
  onEpochEvidenceRead?: () => void;
}

let reviewerSessionLeaseTestHooks: ReviewerSessionLeaseTestHooks | undefined;

/** Deterministic process/clock injection for focused lease tests only. */
export function setReviewerSessionLeaseTestHooks(
  hooks: ReviewerSessionLeaseTestHooks | undefined,
): void {
  reviewerSessionLeaseTestHooks = hooks;
}

interface FileIdentity {
  device: number | bigint;
  inode: number | bigint;
}

interface LeaseMetadata {
  schema_version: 1;
  registry_key: string;
  pid: number;
  process_start_identity: string;
  owner_token: string;
  heartbeat_at_ms: number;
}

interface OwnedLease {
  descriptor: number;
  identity: FileIdentity;
  filePath: string;
}

interface ExistingLease {
  identity: FileIdentity;
  metadata: LeaseMetadata;
  mtimeMs: number;
}

export async function withReviewerSessionLease<T>(
  registryKey: string,
  action: (lease: { epoch: number; heartbeat: () => void }) => Promise<T>,
  options: ReviewerSessionLeaseOptions = {},
): Promise<{ acquired: true; value: T } | { acquired: false; reason: "busy" }> {
  assertRegistryKey(registryKey);
  const waitMs = boundedMilliseconds(options.waitMs, REVIEWER_SESSION_LEASE_WAIT_MS, "lease wait");
  const heartbeatMs = boundedMilliseconds(
    options.heartbeatMs,
    REVIEWER_SESSION_HEARTBEAT_MS,
    "lease heartbeat",
    true,
  );
  reviewerSessionLeaseTestHooks?.onConfigured?.({ waitMs, heartbeatMs });
  const registryPath = options.registryPath ?? reviewerSessionRegistryPath();
  const directory = ensureSafeRegistryDirectory(registryPath);
  if (!directory) {
    return { acquired: false, reason: "busy" };
  }
  const owner = reviewerSessionLeaseTestHooks?.currentOwner?.() ?? currentProcessOwner();
  if (!owner) {
    return { acquired: false, reason: "busy" };
  }
  const startedAt = now();
  const deadline = startedAt + waitMs;
  let owned: OwnedLease | undefined;
  for (;;) {
    owned = tryPublishLease(directory, registryKey, owner);
    if (owned) {
      break;
    }
    const reclaimed = tryReclaimStaleLease(directory, registryKey, heartbeatMs);
    if (reclaimed) {
      continue;
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      return { acquired: false, reason: "busy" };
    }
    await sleep(Math.min(RETRY_INTERVAL_MS, remaining));
  }

  const heartbeat = (): void => {
    try {
      const instant = new Date(now());
      futimesSync(owned!.descriptor, instant, instant);
    } catch {
      // A lost/reclaimed inode is intentionally not allowed to affect a successor.
    }
  };
  const timer = setInterval(heartbeat, heartbeatMs);
  timer.unref();
  try {
    reviewerSessionLeaseTestHooks?.onEpochEvidenceRead?.();
    const evidence = readReviewerSessionEpochEvidence(registryKey, { registryPath });
    if (evidence.status !== "available") {
      throw new Error("reviewer session epoch evidence is unavailable");
    }
    const value = await action({ epoch: evidence.epoch, heartbeat });
    return { acquired: true, value };
  } finally {
    clearInterval(timer);
    try {
      reviewerSessionLeaseTestHooks?.beforeRelease?.(owned.filePath);
    } catch {
      // Test hooks and cleanup cannot replace the action result.
    }
    releaseOwnedLease(owned);
  }
}

function ensureSafeRegistryDirectory(registryPath: string): string | undefined {
  try {
    try {
      const existing = lstatSync(registryPath);
      return existing.isDirectory() && safeModeAndOwner(existing, 0o700) ? registryPath : undefined;
    } catch (error: unknown) {
      if (!hasCode(error, "ENOENT")) {
        return undefined;
      }
    }
    mkdirSync(registryPath, { recursive: true, mode: 0o700 });
    const created = lstatSync(registryPath);
    return created.isDirectory() && safeModeAndOwner(created, 0o700) ? registryPath : undefined;
  } catch {
    return undefined;
  }
}

function tryPublishLease(
  registryPath: string,
  registryKey: string,
  owner: ProcessOwner,
): OwnedLease | undefined {
  const filePath = leaseFilePath(registryPath, registryKey);
  const temporaryPath = path.join(
    registryPath,
    `.${registryKey}.lease.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let descriptor: number | undefined;
  let publishedIdentity: FileIdentity | undefined;
  try {
    descriptor = openSync(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
    const heartbeatAt = now();
    const metadata: LeaseMetadata = {
      schema_version: 1,
      registry_key: registryKey,
      pid: owner.pid,
      process_start_identity: owner.startIdentity,
      owner_token: randomBytes(16).toString("hex"),
      heartbeat_at_ms: heartbeatAt,
    };
    writeFully(descriptor, Buffer.from(`${JSON.stringify(metadata)}\n`, "utf-8"));
    fsyncSync(descriptor);
    const instant = new Date(heartbeatAt);
    futimesSync(descriptor, instant, instant);
    reviewerSessionLeaseTestHooks?.beforePublish?.(temporaryPath, filePath);
    try {
      linkSync(temporaryPath, filePath);
    } catch (error: unknown) {
      if (hasCode(error, "EEXIST")) {
        closeSync(descriptor);
        descriptor = undefined;
        bestEffortUnlink(temporaryPath);
        return undefined;
      }
      throw error;
    }
    const identity = fileIdentity(fstatSync(descriptor));
    publishedIdentity = identity;
    unlinkSync(temporaryPath);
    syncDirectory(registryPath);
    return { descriptor, identity, filePath };
  } catch {
    if (descriptor !== undefined) {
      bestEffortClose(descriptor);
    }
    if (publishedIdentity !== undefined) {
      try {
        const published = lstatSync(filePath);
        if (published.isFile() && sameFileIdentity(fileIdentity(published), publishedIdentity)) {
          unlinkSync(filePath);
        }
      } catch {
        // Best effort cleanup.
      }
    }
    bestEffortUnlink(temporaryPath);
    return undefined;
  }
}

function tryReclaimStaleLease(
  registryPath: string,
  registryKey: string,
  heartbeatMs: number,
): boolean {
  const filePath = leaseFilePath(registryPath, registryKey);
  const initial = inspectLease(filePath, registryKey);
  if (!initial || now() - initial.mtimeMs < heartbeatMs * REVIEWER_SESSION_MISSED_HEARTBEATS) {
    return false;
  }
  const processState = inspectOwnerProcess(
    initial.metadata.pid,
    initial.metadata.process_start_identity,
  );
  if (processState.status !== "dead" && processState.status !== "different") {
    return false;
  }
  const current = inspectLease(filePath, registryKey);
  if (
    !current
    || !sameFileIdentity(initial.identity, current.identity)
    || current.mtimeMs !== initial.mtimeMs
    || now() - current.mtimeMs < heartbeatMs * REVIEWER_SESSION_MISSED_HEARTBEATS
  ) {
    return false;
  }
  const revalidatedProcess = inspectOwnerProcess(
    current.metadata.pid,
    current.metadata.process_start_identity,
  );
  if (revalidatedProcess.status !== "dead" && revalidatedProcess.status !== "different") {
    return false;
  }
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || !sameFileIdentity(fileIdentity(stat), current.identity)) {
      return false;
    }
    unlinkSync(filePath);
    syncDirectory(registryPath);
    return true;
  } catch {
    return false;
  }
}

function inspectLease(filePath: string, registryKey: string): ExistingLease | undefined {
  let descriptor: number | undefined;
  try {
    const initial = lstatSync(filePath);
    if (!initial.isFile() || !safeModeAndOwner(initial, 0o600)) {
      return undefined;
    }
    const identity = fileIdentity(initial);
    descriptor = openSync(filePath, constants.O_RDONLY | noFollowFlag());
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFileIdentity(identity, fileIdentity(opened)) || !safeModeAndOwner(opened, 0o600)) {
      return undefined;
    }
    const value: unknown = JSON.parse(readFileSync(descriptor, "utf-8"));
    const metadata = parseLeaseMetadata(value, registryKey);
    return metadata ? { identity, metadata, mtimeMs: opened.mtimeMs } : undefined;
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) {
      bestEffortClose(descriptor);
    }
  }
}

function parseLeaseMetadata(value: unknown, registryKey: string): LeaseMetadata | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== [
    "heartbeat_at_ms",
    "owner_token",
    "pid",
    "process_start_identity",
    "registry_key",
    "schema_version",
  ].join(",")) {
    return undefined;
  }
  if (
    record.schema_version !== 1
    || record.registry_key !== registryKey
    || typeof record.pid !== "number"
    || !Number.isSafeInteger(record.pid)
    || record.pid <= 0
    || typeof record.process_start_identity !== "string"
    || record.process_start_identity.length === 0
    || typeof record.owner_token !== "string"
    || !OWNER_TOKEN_PATTERN.test(record.owner_token)
    || typeof record.heartbeat_at_ms !== "number"
    || !Number.isFinite(record.heartbeat_at_ms)
  ) {
    return undefined;
  }
  return record as unknown as LeaseMetadata;
}

function currentProcessOwner(): ProcessOwner | undefined {
  const startIdentity = platformProcessStartIdentity(process.pid);
  return startIdentity ? { pid: process.pid, startIdentity } : undefined;
}

function inspectOwnerProcess(pid: number, expectedStartIdentity: string): ProcessInspection {
  if (reviewerSessionLeaseTestHooks?.inspectProcess) {
    return reviewerSessionLeaseTestHooks.inspectProcess(pid, expectedStartIdentity);
  }
  if (!pidExists(pid)) {
    return { status: "dead" };
  }
  const actualStartIdentity = platformProcessStartIdentity(pid);
  if (!actualStartIdentity) {
    return { status: "unknown" };
  }
  return actualStartIdentity === expectedStartIdentity
    ? { status: "same" }
    : { status: "different", actualStartIdentity };
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !hasCode(error, "ESRCH");
  }
}

function platformProcessStartIdentity(pid: number): string | undefined {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
      const closeParen = stat.lastIndexOf(")");
      if (closeParen === -1) {
        return undefined;
      }
      const fields = stat.slice(closeParen + 1).trim().split(/\s+/);
      const startTicks = fields[19];
      return startTicks && /^[0-9]+$/.test(startTicks) ? `linux-proc-start:${startTicks}` : undefined;
    } catch {
      return undefined;
    }
  }
  if (process.platform === "darwin") {
    try {
      const output = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1_000,
      }).trim().replace(/\s+/g, " ");
      return output.length > 0 ? `darwin-ps-lstart:${output}` : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function releaseOwnedLease(owned: OwnedLease): void {
  try {
    const stat = lstatSync(owned.filePath);
    if (stat.isFile() && sameFileIdentity(fileIdentity(stat), owned.identity)) {
      unlinkSync(owned.filePath);
      syncDirectory(path.dirname(owned.filePath));
    }
  } catch {
    // Cleanup must not replace a successful action or its primary error.
  } finally {
    bestEffortClose(owned.descriptor);
  }
}

function leaseFilePath(registryPath: string, registryKey: string): string {
  return path.join(registryPath, `.${registryKey}.lease`);
}

function now(): number {
  return reviewerSessionLeaseTestHooks?.now?.() ?? Date.now();
}

function sleep(milliseconds: number): Promise<void> {
  if (reviewerSessionLeaseTestHooks?.sleep) {
    return reviewerSessionLeaseTestHooks.sleep(milliseconds);
  }
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function boundedMilliseconds(
  value: number | undefined,
  fallback: number,
  label: string,
  requirePositive = false,
): number {
  const normalized = value ?? fallback;
  if (!Number.isFinite(normalized) || normalized < 0 || (requirePositive && normalized === 0)) {
    throw new Error(`${label} must be ${requirePositive ? "positive" : "non-negative"} finite`);
  }
  return normalized;
}

function writeFully(descriptor: number, data: Buffer): void {
  let offset = 0;
  while (offset < data.length) {
    const written = writeSync(descriptor, data, offset, data.length - offset, offset);
    if (written <= 0) {
      throw new Error("unable to write reviewer session lease");
    }
    offset += written;
  }
}

function syncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(directory, constants.O_RDONLY);
    fsyncSync(descriptor);
  } catch (error: unknown) {
    if (!["EINVAL", "ENOTSUP", "ENOSYS", "EISDIR"].some((code) => hasCode(error, code))) {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) {
      bestEffortClose(descriptor);
    }
  }
}

function noFollowFlag(): number {
  return "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
}

function safeModeAndOwner(stat: { mode: number; uid: number }, mode: number): boolean {
  const getuid = process.getuid;
  return (stat.mode & 0o777) === mode && (typeof getuid !== "function" || stat.uid === getuid.call(process));
}

function fileIdentity(stat: { dev: number | bigint; ino: number | bigint }): FileIdentity {
  return { device: stat.dev, inode: stat.ino };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function assertRegistryKey(key: string): void {
  if (!REGISTRY_KEY_PATTERN.test(key)) {
    throw new Error("reviewer session registry key is invalid");
  }
}

function bestEffortClose(descriptor: number): void {
  try {
    closeSync(descriptor);
  } catch {
    // Best effort cleanup.
  }
}

function bestEffortUnlink(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Best effort cleanup.
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === code;
}
