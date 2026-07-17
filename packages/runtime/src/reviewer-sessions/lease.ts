import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
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
/** Later dispatch must acquire in this order to avoid run/entry deadlocks. */
export const REVIEWER_SESSION_LOCK_ORDER = ["run-mutation", "entry-lease", "provider-spawn"] as const;

const REGISTRY_KEY_PATTERN = /^rk-[a-f0-9]{32}$/;
const OWNER_TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const MONOTONIC_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const RETRY_INTERVAL_MS = 10;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

export interface ReviewerSessionLeaseOptions {
  waitMs?: number;
  heartbeatMs?: number;
  registryPath?: string;
}

interface ProcessOwner {
  pid: number;
  startIdentity: string | null;
}

type ProcessInspection =
  | { status: "same" }
  | { status: "different"; actualStartIdentity: string }
  | { status: "dead" }
  | { status: "unknown" };

export interface ReviewerSessionLeaseTestHooks {
  monotonicNow?: () => bigint;
  currentOwner?: () => ProcessOwner | undefined;
  inspectProcess?: (pid: number, expectedStartIdentity: string | null, remainingMs: number) => ProcessInspection;
  sleep?: (milliseconds: number) => Promise<void>;
  onConfigured?: (options: { waitMs: number; heartbeatMs: number }) => void;
  beforePublish?: (temporaryPath: string, publishedPath: string) => void;
  beforeRelease?: (candidatePath: string) => void;
  beforeCandidateDelete?: (candidatePath: string) => void;
  onEpochEvidenceRead?: () => void;
}

let reviewerSessionLeaseTestHooks: ReviewerSessionLeaseTestHooks | undefined;

/** Internal deterministic concurrency/process hooks for focused tests. */
export function setReviewerSessionLeaseTestHooks(
  hooks: ReviewerSessionLeaseTestHooks | undefined,
): void {
  reviewerSessionLeaseTestHooks = hooks;
}

interface LeaseCandidateMetadata {
  schema_version: 1;
  registry_key: string;
  pid: number;
  process_start_identity: string | null;
  owner_token: string;
  lease_ticket: number;
  created_monotonic_ns: string;
  heartbeat_monotonic_ns: string;
}

interface LeaseHeartbeatMetadata {
  schema_version: 1;
  registry_key: string;
  owner_token: string;
  heartbeat_monotonic_ns: string;
}

interface LeaseCandidate {
  filePath: string;
  metadata: LeaseCandidateMetadata;
  createdMonotonicNs: bigint;
  heartbeatMonotonicNs: bigint;
  heartbeatPaths: string[];
}

interface LeaseChoosingMetadata {
  schema_version: 1;
  registry_key: string;
  pid: number;
  process_start_identity: string | null;
  owner_token: string;
  created_monotonic_ns: string;
}

interface LeaseChoosingMarker {
  filePath: string;
  metadata: LeaseChoosingMetadata;
  createdMonotonicNs: bigint;
}

interface OwnedLease {
  candidatePath: string;
  ownerToken: string;
  heartbeatPaths: Set<string>;
  active: boolean;
}

type ElectionResult = "won" | "blocked" | "deadline" | "retry";

export async function withReviewerSessionLease<T>(
  registryKey: string,
  action: (lease: { epoch: number; heartbeat: () => void }) => Promise<T>,
  options: ReviewerSessionLeaseOptions = {},
): Promise<{ acquired: true; value: T } | { acquired: false; reason: "busy" }> {
  assertRegistryKey(registryKey);
  const waitMs = boundedMilliseconds(options.waitMs, REVIEWER_SESSION_LEASE_WAIT_MS, "lease wait");
  const heartbeatMs = boundedMilliseconds(options.heartbeatMs, REVIEWER_SESSION_HEARTBEAT_MS, "lease heartbeat", true);
  reviewerSessionLeaseTestHooks?.onConfigured?.({ waitMs, heartbeatMs });
  const registryPath = options.registryPath ?? reviewerSessionRegistryPath();
  if (!ensureSafeRegistryDirectory(registryPath)) {
    return busy();
  }
  const owner = reviewerSessionLeaseTestHooks?.currentOwner?.() ?? currentProcessOwner();
  if (!owner) {
    return busy();
  }
  const startedAt = monotonicNow();
  const deadline = startedAt + millisecondsToNanoseconds(waitMs);
  const ownerToken = randomBytes(16).toString("hex");
  const candidatePath = leaseCandidatePath(registryPath, registryKey, ownerToken);
  const choosingPath = leaseChoosingPath(registryPath, registryKey, ownerToken);
  if (!publishChoosing(registryPath, registryKey, ownerToken, owner, startedAt, choosingPath)) {
    return busy();
  }
  const existing = scanLeaseCandidates(registryPath, registryKey);
  const ticket = existing ? Math.max(0, ...existing.map((candidate) => candidate.metadata.lease_ticket)) + 1 : undefined;
  if (
    ticket === undefined
    || !Number.isSafeInteger(ticket)
    || !publishCandidate(registryPath, registryKey, ownerToken, owner, startedAt, ticket, candidatePath)
  ) {
    bestEffortUnlink(choosingPath);
    return busy();
  }
  bestEffortUnlink(choosingPath);
  const owned: OwnedLease = { candidatePath, ownerToken, heartbeatPaths: new Set(), active: true };

  try {
    for (;;) {
      const election = electCandidate(registryPath, registryKey, owned, heartbeatMs, deadline);
      if (election === "won") {
        break;
      }
      if (election === "deadline") {
        return busy();
      }
      if (election === "retry") {
        continue;
      }
      const remaining = remainingMilliseconds(deadline);
      if (remaining <= 0) {
        return busy();
      }
      await sleep(Math.min(RETRY_INTERVAL_MS, remaining));
    }

    const heartbeat = (): void => {
      if (!owned.active) {
        return;
      }
      publishHeartbeat(registryPath, registryKey, owned, monotonicNow());
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
      owned.active = false;
      clearInterval(timer);
    }
  } finally {
    owned.active = false;
    try {
      reviewerSessionLeaseTestHooks?.beforeRelease?.(owned.candidatePath);
    } catch {
      // Cleanup hooks cannot replace the action result.
    }
    releaseOwnedCandidate(owned);
  }
}

function electCandidate(
  registryPath: string,
  registryKey: string,
  owned: OwnedLease,
  heartbeatMs: number,
  deadline: bigint,
): ElectionResult {
  const choosing = scanChoosingMarkers(registryPath, registryKey);
  if (!choosing) {
    return "blocked";
  }
  for (const marker of choosing) {
    const elapsed = monotonicElapsed(monotonicNow(), marker.createdMonotonicNs);
    if (elapsed < millisecondsToNanoseconds(heartbeatMs * REVIEWER_SESSION_MISSED_HEARTBEATS)) {
      return "blocked";
    }
    if (monotonicNow() > deadline) return "deadline";
    const state = inspectOwnerProcess(
      marker.metadata.pid,
      marker.metadata.process_start_identity,
      Math.max(0, remainingMilliseconds(deadline)),
    );
    if (monotonicNow() > deadline) return "deadline";
    if (state.status !== "dead" && state.status !== "different") return "blocked";
    reviewerSessionLeaseTestHooks?.beforeCandidateDelete?.(marker.filePath);
    bestEffortUnlink(marker.filePath);
    return "retry";
  }
  const scan = scanLeaseCandidates(registryPath, registryKey);
  if (!scan) {
    return "blocked";
  }
  for (const candidate of scan) {
    if (candidate.metadata.owner_token === owned.ownerToken) {
      continue;
    }
    const elapsed = monotonicElapsed(monotonicNow(), candidate.heartbeatMonotonicNs);
    if (elapsed < millisecondsToNanoseconds(heartbeatMs * REVIEWER_SESSION_MISSED_HEARTBEATS)) {
      continue;
    }
    if (monotonicNow() > deadline) {
      return "deadline";
    }
    const remaining = Math.max(0, remainingMilliseconds(deadline));
    const state = inspectOwnerProcess(
      candidate.metadata.pid,
      candidate.metadata.process_start_identity,
      remaining,
    );
    if (monotonicNow() > deadline) {
      return "deadline";
    }
    if (state.status !== "dead" && state.status !== "different") {
      continue;
    }
    reviewerSessionLeaseTestHooks?.beforeCandidateDelete?.(candidate.filePath);
    if (deleteUniqueCandidate(candidate)) {
      return "retry";
    }
    return "retry";
  }
  const refreshed = scanLeaseCandidates(registryPath, registryKey);
  if (!refreshed) {
    return "blocked";
  }
  const elected = [...refreshed].sort((left, right) => {
    if (left.metadata.lease_ticket !== right.metadata.lease_ticket) {
      return left.metadata.lease_ticket - right.metadata.lease_ticket;
    }
    return left.metadata.owner_token.localeCompare(right.metadata.owner_token);
  })[0];
  return elected?.metadata.owner_token === owned.ownerToken ? "won" : "blocked";
}

function publishCandidate(
  registryPath: string,
  registryKey: string,
  ownerToken: string,
  owner: ProcessOwner,
  createdAt: bigint,
  ticket: number,
  candidatePath: string,
): boolean {
  const metadata: LeaseCandidateMetadata = {
    schema_version: 1,
    registry_key: registryKey,
    pid: owner.pid,
    process_start_identity: owner.startIdentity,
    owner_token: ownerToken,
    lease_ticket: ticket,
    created_monotonic_ns: createdAt.toString(),
    heartbeat_monotonic_ns: createdAt.toString(),
  };
  return atomicNoReplaceJson(registryPath, candidatePath, metadata, true);
}

function publishChoosing(
  registryPath: string,
  registryKey: string,
  ownerToken: string,
  owner: ProcessOwner,
  createdAt: bigint,
  choosingPath: string,
): boolean {
  const metadata: LeaseChoosingMetadata = {
    schema_version: 1,
    registry_key: registryKey,
    pid: owner.pid,
    process_start_identity: owner.startIdentity,
    owner_token: ownerToken,
    created_monotonic_ns: createdAt.toString(),
  };
  return atomicNoReplaceJson(registryPath, choosingPath, metadata, false);
}

function publishHeartbeat(
  registryPath: string,
  registryKey: string,
  owned: OwnedLease,
  tick: bigint,
): void {
  if (!owned.active || !existsRegularFile(owned.candidatePath)) {
    return;
  }
  const heartbeatPath = path.join(
    registryPath,
    `.${registryKey}.lease.${owned.ownerToken}.heartbeat.${randomBytes(12).toString("hex")}.json`,
  );
  const metadata: LeaseHeartbeatMetadata = {
    schema_version: 1,
    registry_key: registryKey,
    owner_token: owned.ownerToken,
    heartbeat_monotonic_ns: tick.toString(),
  };
  if (!atomicNoReplaceJson(registryPath, heartbeatPath, metadata, false)) {
    return;
  }
  owned.heartbeatPaths.add(heartbeatPath);
  for (const oldPath of [...owned.heartbeatPaths]) {
    if (oldPath !== heartbeatPath) {
      bestEffortUnlink(oldPath);
      owned.heartbeatPaths.delete(oldPath);
    }
  }
}

function scanLeaseCandidates(registryPath: string, registryKey: string): LeaseCandidate[] | undefined {
  let names: string[];
  try {
    names = readdirSync(registryPath);
  } catch {
    return undefined;
  }
  const candidatePattern = new RegExp(`^\\.${registryKey}\\.lease\\.([a-f0-9]{32})\\.json$`);
  const heartbeatPattern = new RegExp(`^\\.${registryKey}\\.lease\\.([a-f0-9]{32})\\.heartbeat\\.([a-f0-9]{24})\\.json$`);
  const heartbeatNames = new Map<string, string[]>();
  for (const name of names) {
    const match = heartbeatPattern.exec(name);
    if (match) {
      const paths = heartbeatNames.get(match[1]) ?? [];
      paths.push(path.join(registryPath, name));
      heartbeatNames.set(match[1], paths);
    }
  }
  const candidates: LeaseCandidate[] = [];
  for (const name of names) {
    const match = candidatePattern.exec(name);
    if (!match) continue;
    const filePath = path.join(registryPath, name);
    const metadata = readCandidate(filePath, registryKey, match[1]);
    if (!metadata) return undefined;
    let heartbeatMonotonicNs = BigInt(metadata.heartbeat_monotonic_ns);
    const heartbeatPaths = heartbeatNames.get(match[1]) ?? [];
    for (const heartbeatPath of heartbeatPaths) {
      const heartbeat = readHeartbeat(heartbeatPath, registryKey, match[1]);
      if (!heartbeat) return undefined;
      const tick = BigInt(heartbeat.heartbeat_monotonic_ns);
      if (tick > heartbeatMonotonicNs) heartbeatMonotonicNs = tick;
    }
    candidates.push({
      filePath,
      metadata,
      createdMonotonicNs: BigInt(metadata.created_monotonic_ns),
      heartbeatMonotonicNs,
      heartbeatPaths,
    });
  }
  return candidates;
}

function scanChoosingMarkers(registryPath: string, registryKey: string): LeaseChoosingMarker[] | undefined {
  let names: string[];
  try {
    names = readdirSync(registryPath);
  } catch {
    return undefined;
  }
  const pattern = new RegExp(`^\\.${registryKey}\\.lease\\.([a-f0-9]{32})\\.choosing\\.json$`);
  const markers: LeaseChoosingMarker[] = [];
  for (const name of names) {
    const match = pattern.exec(name);
    if (!match) continue;
    const filePath = path.join(registryPath, name);
    const value = readSafeJson(filePath);
    if (!isRecord(value) || Object.keys(value).sort().join(",") !== [
      "created_monotonic_ns", "owner_token", "pid", "process_start_identity", "registry_key", "schema_version",
    ].sort().join(",")) return undefined;
    if (
      value.schema_version !== 1 || value.registry_key !== registryKey || value.owner_token !== match[1]
      || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0
      || !(value.process_start_identity === null || (typeof value.process_start_identity === "string" && value.process_start_identity.length > 0))
      || typeof value.created_monotonic_ns !== "string" || !MONOTONIC_PATTERN.test(value.created_monotonic_ns)
    ) return undefined;
    const metadata = value as unknown as LeaseChoosingMetadata;
    markers.push({ filePath, metadata, createdMonotonicNs: BigInt(metadata.created_monotonic_ns) });
  }
  return markers;
}

function readCandidate(filePath: string, registryKey: string, ownerToken: string): LeaseCandidateMetadata | undefined {
  const value = readSafeJson(filePath);
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== [
    "created_monotonic_ns", "heartbeat_monotonic_ns", "lease_ticket", "owner_token", "pid",
    "process_start_identity", "registry_key", "schema_version",
  ].sort().join(",")) return undefined;
  if (
    value.schema_version !== 1 || value.registry_key !== registryKey || value.owner_token !== ownerToken
    || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0
    || typeof value.lease_ticket !== "number" || !Number.isSafeInteger(value.lease_ticket) || value.lease_ticket <= 0
    || !(value.process_start_identity === null || (typeof value.process_start_identity === "string" && value.process_start_identity.length > 0))
    || typeof value.created_monotonic_ns !== "string" || !MONOTONIC_PATTERN.test(value.created_monotonic_ns)
    || typeof value.heartbeat_monotonic_ns !== "string" || !MONOTONIC_PATTERN.test(value.heartbeat_monotonic_ns)
  ) return undefined;
  return value as unknown as LeaseCandidateMetadata;
}

function readHeartbeat(filePath: string, registryKey: string, ownerToken: string): LeaseHeartbeatMetadata | undefined {
  const value = readSafeJson(filePath);
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== [
    "heartbeat_monotonic_ns", "owner_token", "registry_key", "schema_version",
  ].sort().join(",")) return undefined;
  if (
    value.schema_version !== 1 || value.registry_key !== registryKey || value.owner_token !== ownerToken
    || typeof value.heartbeat_monotonic_ns !== "string" || !MONOTONIC_PATTERN.test(value.heartbeat_monotonic_ns)
  ) return undefined;
  return value as unknown as LeaseHeartbeatMetadata;
}

function readSafeJson(filePath: string): unknown {
  let descriptor: number | undefined;
  try {
    const initial = lstatSync(filePath);
    if (!initial.isFile() || !safeModeAndOwner(initial, 0o600)) return undefined;
    descriptor = openSync(filePath, constants.O_RDONLY | noFollowFlag());
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== initial.dev || opened.ino !== initial.ino || !safeModeAndOwner(opened, 0o600)) {
      return undefined;
    }
    return JSON.parse(readFileSync(descriptor, "utf-8"));
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) bestEffortClose(descriptor);
  }
}

function deleteUniqueCandidate(candidate: LeaseCandidate): boolean {
  let removed = false;
  try {
    unlinkSync(candidate.filePath);
    removed = true;
  } catch {
    // Another reclaimer may already have removed this unique owner path.
  }
  for (const heartbeatPath of candidate.heartbeatPaths) bestEffortUnlink(heartbeatPath);
  return removed;
}

function releaseOwnedCandidate(owned: OwnedLease): void {
  bestEffortUnlink(owned.candidatePath);
  for (const heartbeatPath of owned.heartbeatPaths) bestEffortUnlink(heartbeatPath);
}

function atomicNoReplaceJson(
  registryPath: string,
  publishedPath: string,
  value: object,
  notifyBeforePublish: boolean,
): boolean {
  const temporaryPath = path.join(registryPath, `.${path.basename(publishedPath)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  let published = false;
  try {
    descriptor = openSync(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    writeFully(descriptor, Buffer.from(`${JSON.stringify(value)}\n`, "utf-8"));
    fsyncSync(descriptor);
    if (notifyBeforePublish) reviewerSessionLeaseTestHooks?.beforePublish?.(temporaryPath, publishedPath);
    linkSync(temporaryPath, publishedPath);
    published = true;
    unlinkSync(temporaryPath);
    syncDirectory(registryPath);
    return true;
  } catch {
    if (published) bestEffortUnlink(publishedPath);
    bestEffortUnlink(temporaryPath);
    return false;
  } finally {
    if (descriptor !== undefined) bestEffortClose(descriptor);
  }
}

function currentProcessOwner(): ProcessOwner {
  const startIdentity = process.platform === "linux"
    ? linuxProcessStartIdentity(process.pid)
    : null;
  return { pid: process.pid, startIdentity };
}

function inspectOwnerProcess(pid: number, expectedStartIdentity: string | null, remainingMs: number): ProcessInspection {
  if (reviewerSessionLeaseTestHooks?.inspectProcess) {
    return reviewerSessionLeaseTestHooks.inspectProcess(pid, expectedStartIdentity, remainingMs);
  }
  return inspectReviewerSessionLeaseProcessForTest(pid, expectedStartIdentity, { remainingMs });
}

export function inspectReviewerSessionLeaseProcessForTest(
  pid: number,
  expectedStartIdentity: string | null,
  options: {
    platform?: NodeJS.Platform;
    remainingMs: number;
    killProbe?: (pid: number) => "alive" | "dead" | "unknown";
    readLinuxStat?: (pid: number) => string;
    execFile?: (file: string, args: string[], timeoutMs: number) => string;
  },
): ProcessInspection {
  const killProbe = options.killProbe ?? defaultKillProbe;
  const existence = killProbe(pid);
  if (existence === "dead") return { status: "dead" };
  if (existence !== "alive") return { status: "unknown" };
  const platform = options.platform ?? process.platform;
  if (platform === "linux") {
    if (expectedStartIdentity === null) return { status: "unknown" };
    let actual: string | undefined;
    try {
      const stat = options.readLinuxStat?.(pid) ?? readFileSync(`/proc/${pid}/stat`, "utf-8");
      actual = parseLinuxProcessStartIdentityForTest(stat);
    } catch {
      return killProbe(pid) === "dead" ? { status: "dead" } : { status: "unknown" };
    }
    if (!actual) return { status: "unknown" };
    return actual === expectedStartIdentity
      ? { status: "same" }
      : { status: "different", actualStartIdentity: actual };
  }
  if (platform === "darwin") {
    if (options.remainingMs <= 0) return { status: "unknown" };
    const timeoutMs = Math.max(1, Math.min(Math.ceil(options.remainingMs), 1_000));
    try {
      const output = options.execFile
        ? options.execFile("/bin/ps", ["-p", String(pid), "-o", "pid="], timeoutMs)
        : execFileSync("/bin/ps", ["-p", String(pid), "-o", "pid="], {
          encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: timeoutMs,
        });
      if (output.trim().length === 0 && killProbe(pid) === "dead") return { status: "dead" };
    } catch {
      if (killProbe(pid) === "dead") return { status: "dead" };
    }
    return { status: "unknown" };
  }
  return { status: "unknown" };
}

export function parseLinuxProcessStartIdentityForTest(stat: string): string | undefined {
  const closeParen = stat.lastIndexOf(")");
  if (closeParen === -1) return undefined;
  const fields = stat.slice(closeParen + 1).trim().split(/\s+/);
  const startTicks = fields[19];
  return startTicks && /^[0-9]+$/.test(startTicks) ? `linux-proc-start:${startTicks}` : undefined;
}

function linuxProcessStartIdentity(pid: number): string | null {
  try {
    return parseLinuxProcessStartIdentityForTest(readFileSync(`/proc/${pid}/stat`, "utf-8")) ?? null;
  } catch {
    return null;
  }
}

function defaultKillProbe(pid: number): "alive" | "dead" | "unknown" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error: unknown) {
    if (hasCode(error, "ESRCH")) return "dead";
    return "unknown";
  }
}

function ensureSafeRegistryDirectory(registryPath: string): boolean {
  try {
    try {
      const existing = lstatSync(registryPath);
      return existing.isDirectory() && safeModeAndOwner(existing, 0o700);
    } catch (error: unknown) {
      if (!hasCode(error, "ENOENT")) return false;
    }
    mkdirSync(registryPath, { recursive: true, mode: 0o700 });
    const created = lstatSync(registryPath);
    return created.isDirectory() && safeModeAndOwner(created, 0o700);
  } catch {
    return false;
  }
}

function existsRegularFile(filePath: string): boolean {
  try {
    const stat = lstatSync(filePath);
    return stat.isFile() && safeModeAndOwner(stat, 0o600);
  } catch {
    return false;
  }
}

function monotonicNow(): bigint {
  return reviewerSessionLeaseTestHooks?.monotonicNow?.() ?? process.hrtime.bigint();
}

function monotonicElapsed(now: bigint, heartbeat: bigint): bigint {
  return now > heartbeat ? now - heartbeat : 0n;
}

function remainingMilliseconds(deadline: bigint): number {
  const remaining = deadline - monotonicNow();
  if (remaining <= 0n) return 0;
  return Number((remaining + NANOSECONDS_PER_MILLISECOND - 1n) / NANOSECONDS_PER_MILLISECOND);
}

function millisecondsToNanoseconds(milliseconds: number): bigint {
  return BigInt(Math.ceil(milliseconds * 1_000_000));
}

function sleep(milliseconds: number): Promise<void> {
  if (reviewerSessionLeaseTestHooks?.sleep) return reviewerSessionLeaseTestHooks.sleep(milliseconds);
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function boundedMilliseconds(value: number | undefined, fallback: number, label: string, positive = false): number {
  const normalized = value ?? fallback;
  if (!Number.isFinite(normalized) || normalized < 0 || (positive && normalized === 0)) {
    throw new Error(`${label} must be ${positive ? "positive" : "non-negative"} finite`);
  }
  return normalized;
}

function writeFully(descriptor: number, data: Buffer): void {
  let offset = 0;
  while (offset < data.length) {
    const written = writeSync(descriptor, data, offset, data.length - offset, offset);
    if (written <= 0) throw new Error("unable to write reviewer session lease");
    offset += written;
  }
}

function syncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(directory, constants.O_RDONLY);
    fsyncSync(descriptor);
  } catch (error: unknown) {
    if (!["EINVAL", "ENOTSUP", "ENOSYS", "EISDIR"].some((code) => hasCode(error, code))) throw error;
  } finally {
    if (descriptor !== undefined) bestEffortClose(descriptor);
  }
}

function noFollowFlag(): number {
  return "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
}

function safeModeAndOwner(stat: { mode: number; uid: number }, mode: number): boolean {
  const getuid = process.getuid;
  return (stat.mode & 0o777) === mode && (typeof getuid !== "function" || stat.uid === getuid.call(process));
}

function assertRegistryKey(key: string): void {
  if (!REGISTRY_KEY_PATTERN.test(key)) throw new Error("reviewer session registry key is invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bestEffortClose(descriptor: number): void {
  try { closeSync(descriptor); } catch { /* cleanup */ }
}

function bestEffortUnlink(filePath: string): void {
  try { unlinkSync(filePath); } catch { /* cleanup */ }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === code;
}

function leaseCandidatePath(registryPath: string, registryKey: string, ownerToken: string): string {
  if (!OWNER_TOKEN_PATTERN.test(ownerToken)) throw new Error("reviewer session lease owner token is invalid");
  return path.join(registryPath, `.${registryKey}.lease.${ownerToken}.json`);
}

function leaseChoosingPath(registryPath: string, registryKey: string, ownerToken: string): string {
  if (!OWNER_TOKEN_PATTERN.test(ownerToken)) throw new Error("reviewer session lease owner token is invalid");
  return path.join(registryPath, `.${registryKey}.lease.${ownerToken}.choosing.json`);
}

function busy(): { acquired: false; reason: "busy" } {
  return { acquired: false, reason: "busy" };
}
