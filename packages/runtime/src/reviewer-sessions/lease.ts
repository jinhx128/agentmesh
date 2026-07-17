import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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
  realpathSync,
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
const BOOT_FINGERPRINT_PATTERN = /^(?:linux-boot:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|darwin-boot:[0-9]+\.[0-9]{6}|test-boot:[a-f0-9]{8,64})$/;
const RETRY_INTERVAL_MS = 10;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

export interface ReviewerSessionLeaseOptions {
  waitMs?: number;
  heartbeatMs?: number;
  registryPath?: string;
  /** Dispatch-only signal for safe fresh fallback; legacy result remains busy. */
  onUnavailable?: () => void;
}

interface ProcessOwner {
  pid: number;
  startIdentity: string | null;
}

interface FileIdentity {
  device: number | bigint;
  inode: number | bigint;
}

interface StatLike {
  mode: number;
  uid: number;
  dev: number | bigint;
  ino: number | bigint;
  isDirectory(): boolean;
  isFile(): boolean;
}

interface SafeLeaseDirectory {
  directoryPath: string;
  identity: FileIdentity;
  parentPath: string;
  parentIdentity: FileIdentity;
  anchorPath: string;
  anchorIdentity: FileIdentity;
  registryPathHash: string;
}

type ProcessInspection =
  | { status: "same" }
  | { status: "different"; actualStartIdentity: string }
  | { status: "dead" }
  | { status: "unknown" };

export interface ReviewerSessionLeaseTestHooks {
  monotonicNow?: () => bigint;
  bootFingerprint?: () => string | undefined;
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
  boot_fingerprint: string;
  lease_ticket: number;
  created_monotonic_ns: string;
  heartbeat_monotonic_ns: string;
}

interface LeaseHeartbeatMetadata {
  schema_version: 1;
  registry_key: string;
  owner_token: string;
  boot_fingerprint: string;
  heartbeat_monotonic_ns: string;
}

interface LeaseCandidate {
  filePath: string;
  identity: FileIdentity;
  metadata: LeaseCandidateMetadata;
  createdMonotonicNs: bigint;
  heartbeatMonotonicNs: bigint;
  heartbeatPaths: Array<{ filePath: string; identity: FileIdentity }>;
}

interface LeaseChoosingMetadata {
  schema_version: 1;
  registry_key: string;
  pid: number;
  process_start_identity: string | null;
  owner_token: string;
  boot_fingerprint: string;
  created_monotonic_ns: string;
}

interface LeaseChoosingMarker {
  filePath: string;
  identity: FileIdentity;
  metadata: LeaseChoosingMetadata;
  createdMonotonicNs: bigint;
}

interface OwnedLease {
  candidatePath: string;
  candidateIdentity: FileIdentity;
  ownerToken: string;
  bootFingerprint: string;
  heartbeatPaths: Map<string, FileIdentity>;
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
  const requestedRegistryPath = options.registryPath ?? reviewerSessionRegistryPath();
  const registryPath = ensureSafeRegistryDirectory(requestedRegistryPath);
  if (!registryPath) {
    options.onUnavailable?.();
    return busy();
  }
  const leaseDirectory = ensureSafeLeaseDirectory(registryPath);
  if (!leaseDirectory) {
    options.onUnavailable?.();
    return busy();
  }
  const owner = reviewerSessionLeaseTestHooks?.currentOwner?.() ?? currentProcessOwner();
  if (!owner) {
    return busy();
  }
  const startedAt = monotonicNow();
  const deadline = startedAt + millisecondsToNanoseconds(waitMs);
  const bootFingerprint = reviewerSessionLeaseTestHooks?.bootFingerprint
    ? reviewerSessionLeaseTestHooks.bootFingerprint()
    : readReviewerSessionBootFingerprintForTest({ remainingMs: remainingMilliseconds(deadline) });
  if (!bootFingerprint || !BOOT_FINGERPRINT_PATTERN.test(bootFingerprint)) {
    return busy();
  }
  if (monotonicNow() > deadline) {
    return busy();
  }
  const ownerToken = randomBytes(16).toString("hex");
  const candidatePath = leaseCandidatePath(leaseDirectory.directoryPath, registryKey, ownerToken);
  const choosingPath = leaseChoosingPath(leaseDirectory.directoryPath, registryKey, ownerToken);
  const choosingIdentity = publishChoosing(
    leaseDirectory, registryKey, ownerToken, owner, bootFingerprint, startedAt, choosingPath,
  );
  if (!choosingIdentity) {
    return busy();
  }
  const existing = scanLeaseCandidates(leaseDirectory, registryKey);
  const ticket = existing ? Math.max(0, ...existing.map((candidate) => candidate.metadata.lease_ticket)) + 1 : undefined;
  const candidateIdentity = ticket === undefined || !Number.isSafeInteger(ticket)
    ? undefined
    : publishCandidate(
      leaseDirectory, registryKey, ownerToken, owner, bootFingerprint, startedAt, ticket, candidatePath,
    );
  if (!candidateIdentity) {
    unlinkIfIdentity(leaseDirectory, choosingPath, choosingIdentity);
    return busy();
  }
  unlinkIfIdentity(leaseDirectory, choosingPath, choosingIdentity);
  const owned: OwnedLease = {
    candidatePath,
    candidateIdentity,
    ownerToken,
    bootFingerprint,
    heartbeatPaths: new Map(),
    active: true,
  };

  try {
    for (;;) {
      const election = electCandidate(leaseDirectory, registryKey, owned, heartbeatMs, deadline, bootFingerprint);
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
      publishHeartbeat(leaseDirectory, registryKey, owned, monotonicNow());
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
    releaseOwnedCandidate(leaseDirectory, owned);
  }
}

function electCandidate(
  leaseDirectory: SafeLeaseDirectory,
  registryKey: string,
  owned: OwnedLease,
  heartbeatMs: number,
  deadline: bigint,
  currentBootFingerprint: string,
): ElectionResult {
  const choosing = scanChoosingMarkers(leaseDirectory, registryKey);
  if (!choosing) {
    return "blocked";
  }
  for (const marker of choosing) {
    const elapsed = heartbeatElapsed(
      monotonicNow(),
      marker.createdMonotonicNs,
      marker.metadata.boot_fingerprint,
      currentBootFingerprint,
    );
    if (elapsed < millisecondsToNanoseconds(heartbeatMs * REVIEWER_SESSION_MISSED_HEARTBEATS)) {
      return "blocked";
    }
    if (marker.metadata.boot_fingerprint !== currentBootFingerprint) {
      reviewerSessionLeaseTestHooks?.beforeCandidateDelete?.(marker.filePath);
      unlinkIfIdentity(leaseDirectory, marker.filePath, marker.identity);
      return "retry";
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
    unlinkIfIdentity(leaseDirectory, marker.filePath, marker.identity);
    return "retry";
  }
  const scan = scanLeaseCandidates(leaseDirectory, registryKey);
  if (!scan) {
    return "blocked";
  }
  for (const candidate of scan) {
    if (candidate.metadata.owner_token === owned.ownerToken) {
      continue;
    }
    const elapsed = heartbeatElapsed(
      monotonicNow(),
      candidate.heartbeatMonotonicNs,
      candidate.metadata.boot_fingerprint,
      currentBootFingerprint,
    );
    if (elapsed < millisecondsToNanoseconds(heartbeatMs * REVIEWER_SESSION_MISSED_HEARTBEATS)) {
      continue;
    }
    if (candidate.metadata.boot_fingerprint !== currentBootFingerprint) {
      reviewerSessionLeaseTestHooks?.beforeCandidateDelete?.(candidate.filePath);
      deleteUniqueCandidate(leaseDirectory, candidate);
      return "retry";
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
    if (deleteUniqueCandidate(leaseDirectory, candidate)) {
      return "retry";
    }
    return "retry";
  }
  const refreshed = scanLeaseCandidates(leaseDirectory, registryKey);
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
  leaseDirectory: SafeLeaseDirectory,
  registryKey: string,
  ownerToken: string,
  owner: ProcessOwner,
  bootFingerprint: string,
  createdAt: bigint,
  ticket: number,
  candidatePath: string,
): FileIdentity | undefined {
  const metadata: LeaseCandidateMetadata = {
    schema_version: 1,
    registry_key: registryKey,
    pid: owner.pid,
    process_start_identity: owner.startIdentity,
    owner_token: ownerToken,
    boot_fingerprint: bootFingerprint,
    lease_ticket: ticket,
    created_monotonic_ns: createdAt.toString(),
    heartbeat_monotonic_ns: createdAt.toString(),
  };
  return atomicNoReplaceJson(leaseDirectory, candidatePath, metadata, true);
}

function publishChoosing(
  leaseDirectory: SafeLeaseDirectory,
  registryKey: string,
  ownerToken: string,
  owner: ProcessOwner,
  bootFingerprint: string,
  createdAt: bigint,
  choosingPath: string,
): FileIdentity | undefined {
  const metadata: LeaseChoosingMetadata = {
    schema_version: 1,
    registry_key: registryKey,
    pid: owner.pid,
    process_start_identity: owner.startIdentity,
    owner_token: ownerToken,
    boot_fingerprint: bootFingerprint,
    created_monotonic_ns: createdAt.toString(),
  };
  return atomicNoReplaceJson(leaseDirectory, choosingPath, metadata, false);
}

function publishHeartbeat(
  leaseDirectory: SafeLeaseDirectory,
  registryKey: string,
  owned: OwnedLease,
  tick: bigint,
): void {
  if (!owned.active || !fileStillMatches(leaseDirectory, owned.candidatePath, owned.candidateIdentity)) {
    return;
  }
  const heartbeatPath = path.join(
    leaseDirectory.directoryPath,
    `.${registryKey}.lease.${owned.ownerToken}.heartbeat.${randomBytes(12).toString("hex")}.json`,
  );
  const metadata: LeaseHeartbeatMetadata = {
    schema_version: 1,
    registry_key: registryKey,
    owner_token: owned.ownerToken,
    boot_fingerprint: owned.bootFingerprint,
    heartbeat_monotonic_ns: tick.toString(),
  };
  const heartbeatIdentity = atomicNoReplaceJson(leaseDirectory, heartbeatPath, metadata, false);
  if (!heartbeatIdentity) {
    return;
  }
  owned.heartbeatPaths.set(heartbeatPath, heartbeatIdentity);
  for (const [oldPath, oldIdentity] of [...owned.heartbeatPaths]) {
    if (oldPath !== heartbeatPath) {
      unlinkIfIdentity(leaseDirectory, oldPath, oldIdentity);
      owned.heartbeatPaths.delete(oldPath);
    }
  }
}

function scanLeaseCandidates(leaseDirectory: SafeLeaseDirectory, registryKey: string): LeaseCandidate[] | undefined {
  let names: string[];
  try {
    assertLeaseDirectoryIdentity(leaseDirectory);
    names = readdirSync(leaseDirectory.directoryPath);
    assertLeaseDirectoryIdentity(leaseDirectory);
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
      paths.push(path.join(leaseDirectory.directoryPath, name));
      heartbeatNames.set(match[1], paths);
    }
  }
  const candidates: LeaseCandidate[] = [];
  for (const name of names) {
    const match = candidatePattern.exec(name);
    if (!match) continue;
    const filePath = path.join(leaseDirectory.directoryPath, name);
    const candidate = readCandidate(leaseDirectory, filePath, registryKey, match[1]);
    if (!candidate) return undefined;
    let heartbeatMonotonicNs = BigInt(candidate.metadata.heartbeat_monotonic_ns);
    const heartbeatPaths: Array<{ filePath: string; identity: FileIdentity }> = [];
    for (const heartbeatPath of heartbeatNames.get(match[1]) ?? []) {
      const heartbeat = readHeartbeat(
        leaseDirectory, heartbeatPath, registryKey, match[1], candidate.metadata.boot_fingerprint,
      );
      if (!heartbeat) return undefined;
      heartbeatPaths.push({ filePath: heartbeatPath, identity: heartbeat.identity });
      const tick = BigInt(heartbeat.metadata.heartbeat_monotonic_ns);
      if (tick > heartbeatMonotonicNs) heartbeatMonotonicNs = tick;
    }
    candidates.push({
      filePath,
      identity: candidate.identity,
      metadata: candidate.metadata,
      createdMonotonicNs: BigInt(candidate.metadata.created_monotonic_ns),
      heartbeatMonotonicNs,
      heartbeatPaths,
    });
  }
  return candidates;
}

function scanChoosingMarkers(leaseDirectory: SafeLeaseDirectory, registryKey: string): LeaseChoosingMarker[] | undefined {
  let names: string[];
  try {
    assertLeaseDirectoryIdentity(leaseDirectory);
    names = readdirSync(leaseDirectory.directoryPath);
    assertLeaseDirectoryIdentity(leaseDirectory);
  } catch {
    return undefined;
  }
  const pattern = new RegExp(`^\\.${registryKey}\\.lease\\.([a-f0-9]{32})\\.choosing\\.json$`);
  const markers: LeaseChoosingMarker[] = [];
  for (const name of names) {
    const match = pattern.exec(name);
    if (!match) continue;
    const filePath = path.join(leaseDirectory.directoryPath, name);
    const inspected = readSafeJson(leaseDirectory, filePath);
    const value = inspected?.value;
    if (!isRecord(value) || Object.keys(value).sort().join(",") !== [
      "boot_fingerprint", "created_monotonic_ns", "owner_token", "pid", "process_start_identity", "registry_key", "schema_version",
    ].sort().join(",")) return undefined;
    if (
      value.schema_version !== 1 || value.registry_key !== registryKey || value.owner_token !== match[1]
      || typeof value.boot_fingerprint !== "string" || !BOOT_FINGERPRINT_PATTERN.test(value.boot_fingerprint)
      || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0
      || !(value.process_start_identity === null || (typeof value.process_start_identity === "string" && value.process_start_identity.length > 0))
      || typeof value.created_monotonic_ns !== "string" || !MONOTONIC_PATTERN.test(value.created_monotonic_ns)
    ) return undefined;
    const metadata = value as unknown as LeaseChoosingMetadata;
    markers.push({
      filePath,
      identity: inspected!.identity,
      metadata,
      createdMonotonicNs: BigInt(metadata.created_monotonic_ns),
    });
  }
  return markers;
}

function readCandidate(
  leaseDirectory: SafeLeaseDirectory,
  filePath: string,
  registryKey: string,
  ownerToken: string,
): { metadata: LeaseCandidateMetadata; identity: FileIdentity } | undefined {
  const inspected = readSafeJson(leaseDirectory, filePath);
  const value = inspected?.value;
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== [
    "boot_fingerprint", "created_monotonic_ns", "heartbeat_monotonic_ns", "lease_ticket", "owner_token", "pid",
    "process_start_identity", "registry_key", "schema_version",
  ].sort().join(",")) return undefined;
  if (
    value.schema_version !== 1 || value.registry_key !== registryKey || value.owner_token !== ownerToken
    || typeof value.boot_fingerprint !== "string" || !BOOT_FINGERPRINT_PATTERN.test(value.boot_fingerprint)
    || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0
    || typeof value.lease_ticket !== "number" || !Number.isSafeInteger(value.lease_ticket) || value.lease_ticket <= 0
    || !(value.process_start_identity === null || (typeof value.process_start_identity === "string" && value.process_start_identity.length > 0))
    || typeof value.created_monotonic_ns !== "string" || !MONOTONIC_PATTERN.test(value.created_monotonic_ns)
    || typeof value.heartbeat_monotonic_ns !== "string" || !MONOTONIC_PATTERN.test(value.heartbeat_monotonic_ns)
  ) return undefined;
  return { metadata: value as unknown as LeaseCandidateMetadata, identity: inspected!.identity };
}

function readHeartbeat(
  leaseDirectory: SafeLeaseDirectory,
  filePath: string,
  registryKey: string,
  ownerToken: string,
  bootFingerprint: string,
): { metadata: LeaseHeartbeatMetadata; identity: FileIdentity } | undefined {
  const inspected = readSafeJson(leaseDirectory, filePath);
  const value = inspected?.value;
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== [
    "boot_fingerprint", "heartbeat_monotonic_ns", "owner_token", "registry_key", "schema_version",
  ].sort().join(",")) return undefined;
  if (
    value.schema_version !== 1 || value.registry_key !== registryKey || value.owner_token !== ownerToken
    || value.boot_fingerprint !== bootFingerprint
    || typeof value.heartbeat_monotonic_ns !== "string" || !MONOTONIC_PATTERN.test(value.heartbeat_monotonic_ns)
  ) return undefined;
  return { metadata: value as unknown as LeaseHeartbeatMetadata, identity: inspected!.identity };
}

function readSafeJson(
  leaseDirectory: SafeLeaseDirectory,
  filePath: string,
): { value: unknown; identity: FileIdentity } | undefined {
  let descriptor: number | undefined;
  try {
    assertLeaseDirectoryIdentity(leaseDirectory);
    const initial = lstatSync(filePath);
    if (!initial.isFile() || !safeModeAndOwner(initial, 0o600)) return undefined;
    descriptor = openSync(filePath, constants.O_RDONLY | noFollowFlag());
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== initial.dev || opened.ino !== initial.ino || !safeModeAndOwner(opened, 0o600)) {
      return undefined;
    }
    const value: unknown = JSON.parse(readFileSync(descriptor, "utf-8"));
    assertLeaseDirectoryIdentity(leaseDirectory);
    return { value, identity: fileIdentity(opened) };
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) bestEffortClose(descriptor);
  }
}

function deleteUniqueCandidate(leaseDirectory: SafeLeaseDirectory, candidate: LeaseCandidate): boolean {
  const removed = unlinkIfIdentity(leaseDirectory, candidate.filePath, candidate.identity);
  for (const heartbeat of candidate.heartbeatPaths) {
    unlinkIfIdentity(leaseDirectory, heartbeat.filePath, heartbeat.identity);
  }
  return removed;
}

function releaseOwnedCandidate(leaseDirectory: SafeLeaseDirectory, owned: OwnedLease): void {
  unlinkIfIdentity(leaseDirectory, owned.candidatePath, owned.candidateIdentity);
  for (const [heartbeatPath, identity] of owned.heartbeatPaths) {
    unlinkIfIdentity(leaseDirectory, heartbeatPath, identity);
  }
}

function atomicNoReplaceJson(
  leaseDirectory: SafeLeaseDirectory,
  publishedPath: string,
  value: object,
  notifyBeforePublish: boolean,
): FileIdentity | undefined {
  const temporaryPath = path.join(
    leaseDirectory.directoryPath,
    `.${path.basename(publishedPath)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let descriptor: number | undefined;
  let publishedIdentity: FileIdentity | undefined;
  try {
    assertLeaseDirectoryIdentity(leaseDirectory);
    descriptor = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(),
      0o600,
    );
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !safeModeAndOwner(opened, 0o600)) return undefined;
    writeFully(descriptor, Buffer.from(`${JSON.stringify(value)}\n`, "utf-8"));
    fsyncSync(descriptor);
    if (notifyBeforePublish) reviewerSessionLeaseTestHooks?.beforePublish?.(temporaryPath, publishedPath);
    assertLeaseDirectoryIdentity(leaseDirectory);
    linkSync(temporaryPath, publishedPath);
    const identity = fileIdentity(opened);
    publishedIdentity = identity;
    unlinkIfIdentity(leaseDirectory, temporaryPath, identity);
    syncLeaseDirectory(leaseDirectory);
    return publishedIdentity;
  } catch {
    if (publishedIdentity) unlinkIfIdentity(leaseDirectory, publishedPath, publishedIdentity);
    return undefined;
  } finally {
    if (descriptor !== undefined) bestEffortClose(descriptor);
    try {
      const stat = lstatSync(temporaryPath);
      if (stat.isFile() && safeModeAndOwner(stat, 0o600)) {
        unlinkIfIdentity(leaseDirectory, temporaryPath, fileIdentity(stat));
      }
    } catch {
      // Cleanup is identity guarded and cannot replace the primary result.
    }
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

export function readReviewerSessionBootFingerprintForTest(options: {
  platform?: NodeJS.Platform;
  remainingMs: number;
  readLinuxBootId?: () => string;
  execFile?: (file: string, args: string[], timeoutMs: number) => string;
}): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform === "linux") {
    try {
      const bootId = (options.readLinuxBootId?.()
        ?? readFileSync("/proc/sys/kernel/random/boot_id", "utf-8")).trim().toLowerCase();
      return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(bootId)
        ? `linux-boot:${bootId}`
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (platform === "darwin") {
    if (options.remainingMs <= 0) return undefined;
    const timeoutMs = Math.max(1, Math.min(Math.ceil(options.remainingMs), 1_000));
    try {
      const output = options.execFile
        ? options.execFile("/usr/sbin/sysctl", ["-n", "kern.boottime"], timeoutMs)
        : execFileSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], {
          encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: timeoutMs,
        });
      const match = /\bsec\s*=\s*([0-9]+)\s*,\s*usec\s*=\s*([0-9]+)\b/.exec(output);
      if (!match) return undefined;
      const microseconds = Number(match[2]);
      if (!Number.isSafeInteger(microseconds) || microseconds < 0 || microseconds > 999_999) return undefined;
      return `darwin-boot:${match[1]}.${String(microseconds).padStart(6, "0")}`;
    } catch {
      return undefined;
    }
  }
  return undefined;
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

function ensureSafeRegistryDirectory(registryPath: string): string | undefined {
  try {
    try {
      const existing = lstatSync(registryPath);
      if (!existing.isDirectory() || !safeModeAndOwner(existing, 0o700)) return undefined;
    } catch (error: unknown) {
      if (!hasCode(error, "ENOENT")) return undefined;
      mkdirSync(registryPath, { recursive: true, mode: 0o700 });
    }
    const initial = lstatSync(registryPath);
    if (!initial.isDirectory() || !safeModeAndOwner(initial, 0o700)) return undefined;
    const physicalRegistryPath = realpathSync.native(registryPath);
    const physical = lstatSync(physicalRegistryPath);
    const revalidated = lstatSync(registryPath);
    if (
      !physical.isDirectory()
      || !revalidated.isDirectory()
      || !safeModeAndOwner(physical, 0o700)
      || !safeModeAndOwner(revalidated, 0o700)
      || !sameFileIdentity(fileIdentity(initial), fileIdentity(physical))
      || !sameFileIdentity(fileIdentity(initial), fileIdentity(revalidated))
    ) return undefined;
    return physicalRegistryPath;
  } catch {
    return undefined;
  }
}

/** Exposed only so focused tests can seed deterministic contender evidence. */
export function reviewerSessionLeaseCoordinationPathForTest(registryPath: string): string {
  const resolvedRegistryPath = path.resolve(registryPath);
  let physicalRegistryPath: string;
  try {
    physicalRegistryPath = realpathSync.native(resolvedRegistryPath);
  } catch {
    try {
      physicalRegistryPath = path.join(
        realpathSync.native(path.dirname(resolvedRegistryPath)),
        path.basename(resolvedRegistryPath),
      );
    } catch {
      physicalRegistryPath = resolvedRegistryPath;
    }
  }
  const registryPathHash = leaseRegistryPathHash(physicalRegistryPath);
  return path.join(path.dirname(physicalRegistryPath), `.reviewer-session-leases.${registryPathHash}`);
}

/** Internal setup helper for focused tests that seed contender evidence. */
export function initializeReviewerSessionLeaseCoordinationForTest(registryPath: string): string | undefined {
  const physicalRegistryPath = ensureSafeRegistryDirectory(registryPath);
  return physicalRegistryPath === undefined
    ? undefined
    : ensureSafeLeaseDirectory(physicalRegistryPath)?.directoryPath;
}

function ensureSafeLeaseDirectory(registryPath: string): SafeLeaseDirectory | undefined {
  try {
    const resolvedRegistryPath = path.resolve(registryPath);
    const registryPathHash = leaseRegistryPathHash(resolvedRegistryPath);
    const parentPath = path.dirname(resolvedRegistryPath);
    const parentStat = lstatSync(parentPath);
    if (!safeLeaseParent(parentStat)) return undefined;
    const parentIdentity = fileIdentity(parentStat);
    const directoryPath = reviewerSessionLeaseCoordinationPathForTest(resolvedRegistryPath);
    const anchorPath = `${directoryPath}.identity.json`;
    let directoryStat: ReturnType<typeof lstatSync>;
    try {
      directoryStat = lstatSync(directoryPath);
    } catch (error: unknown) {
      if (!hasCode(error, "ENOENT")) return undefined;
      assertPathIdentity(parentPath, parentIdentity, safeLeaseParent);
      mkdirSync(directoryPath, { mode: 0o700 });
      assertPathIdentity(parentPath, parentIdentity, safeLeaseParent);
      directoryStat = lstatSync(directoryPath);
    }
    if (!directoryStat.isDirectory() || !safeModeAndOwner(directoryStat, 0o700)) return undefined;
    const identity = fileIdentity(directoryStat);
    let anchor = readLeaseIdentityAnchor(anchorPath);
    if (!anchor) {
      if (readdirSync(directoryPath).length !== 0) return undefined;
      if (!publishLeaseIdentityAnchor(
        parentPath,
        parentIdentity,
        anchorPath,
        registryPathHash,
        identity,
      )) return undefined;
      anchor = readLeaseIdentityAnchor(anchorPath);
    }
    if (
      !anchor
      || anchor.metadata.registry_path_hash !== registryPathHash
      || anchor.metadata.directory_device !== String(identity.device)
      || anchor.metadata.directory_inode !== String(identity.inode)
    ) return undefined;
    const leaseDirectory: SafeLeaseDirectory = {
      directoryPath,
      identity,
      parentPath,
      parentIdentity,
      anchorPath,
      anchorIdentity: anchor.identity,
      registryPathHash,
    };
    assertLeaseDirectoryIdentity(leaseDirectory);
    return leaseDirectory;
  } catch {
    return undefined;
  }
}

function leaseRegistryPathHash(resolvedRegistryPath: string): string {
  return createHash("sha256")
    .update("agentmesh:reviewer-session-lease-path:v1")
    .update("\0")
    .update(resolvedRegistryPath)
    .digest("hex")
    .slice(0, 32);
}

function safeLeaseParent(stat: StatLike): boolean {
  const getuid = process.getuid;
  return stat.isDirectory()
    && (stat.mode & 0o022) === 0
    && (typeof getuid !== "function" || stat.uid === getuid.call(process));
}

function publishLeaseIdentityAnchor(
  parentPath: string,
  parentIdentity: FileIdentity,
  anchorPath: string,
  registryPathHash: string,
  directoryIdentity: FileIdentity,
): boolean {
  const temporaryPath = path.join(
    parentPath,
    `.${path.basename(anchorPath)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let descriptor: number | undefined;
  let temporaryIdentity: FileIdentity | undefined;
  try {
    assertPathIdentity(parentPath, parentIdentity, safeLeaseParent);
    descriptor = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(),
      0o600,
    );
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !safeModeAndOwner(opened, 0o600)) return false;
    temporaryIdentity = fileIdentity(opened);
    writeFully(descriptor, Buffer.from(`${JSON.stringify({
      schema_version: 1,
      registry_path_hash: registryPathHash,
      directory_device: String(directoryIdentity.device),
      directory_inode: String(directoryIdentity.inode),
    })}\n`, "utf-8"));
    fsyncSync(descriptor);
    assertPathIdentity(parentPath, parentIdentity, safeLeaseParent);
    try {
      linkSync(temporaryPath, anchorPath);
    } catch (error: unknown) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    assertPathIdentity(parentPath, parentIdentity, safeLeaseParent);
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) bestEffortClose(descriptor);
    if (temporaryIdentity) unlinkRawIfIdentity(temporaryPath, temporaryIdentity);
  }
}

function readLeaseIdentityAnchor(anchorPath: string): {
  identity: FileIdentity;
  metadata: {
    schema_version: 1;
    registry_path_hash: string;
    directory_device: string;
    directory_inode: string;
  };
} | undefined {
  let descriptor: number | undefined;
  try {
    const initial = lstatSync(anchorPath);
    if (!initial.isFile() || !safeModeAndOwner(initial, 0o600)) return undefined;
    descriptor = openSync(anchorPath, constants.O_RDONLY | noFollowFlag());
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile()
      || !safeModeAndOwner(opened, 0o600)
      || !sameFileIdentity(fileIdentity(initial), fileIdentity(opened))
    ) return undefined;
    const value: unknown = JSON.parse(readFileSync(descriptor, "utf-8"));
    if (!isRecord(value) || Object.keys(value).sort().join(",") !== [
      "directory_device", "directory_inode", "registry_path_hash", "schema_version",
    ].sort().join(",")) return undefined;
    if (
      value.schema_version !== 1
      || typeof value.registry_path_hash !== "string"
      || !/^[a-f0-9]{32}$/.test(value.registry_path_hash)
      || typeof value.directory_device !== "string"
      || !MONOTONIC_PATTERN.test(value.directory_device)
      || typeof value.directory_inode !== "string"
      || !MONOTONIC_PATTERN.test(value.directory_inode)
    ) return undefined;
    return {
      identity: fileIdentity(opened),
      metadata: value as {
        schema_version: 1;
        registry_path_hash: string;
        directory_device: string;
        directory_inode: string;
      },
    };
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) bestEffortClose(descriptor);
  }
}

function assertLeaseDirectoryIdentity(directory: SafeLeaseDirectory): void {
  assertPathIdentity(directory.parentPath, directory.parentIdentity, safeLeaseParent);
  assertPathIdentity(
    directory.directoryPath,
    directory.identity,
    (stat) => stat.isDirectory() && safeModeAndOwner(stat, 0o700),
  );
  const anchor = readLeaseIdentityAnchor(directory.anchorPath);
  if (
    !anchor
    || !sameFileIdentity(anchor.identity, directory.anchorIdentity)
    || anchor.metadata.registry_path_hash !== directory.registryPathHash
    || anchor.metadata.directory_device !== String(directory.identity.device)
    || anchor.metadata.directory_inode !== String(directory.identity.inode)
  ) throw new Error("reviewer session lease coordination changed");
}

function assertPathIdentity(
  filePath: string,
  expected: FileIdentity,
  safe: (stat: StatLike) => boolean,
): void {
  const stat = lstatSync(filePath);
  if (!safe(stat) || !sameFileIdentity(fileIdentity(stat), expected)) {
    throw new Error("reviewer session lease coordination changed");
  }
}

function fileStillMatches(
  leaseDirectory: SafeLeaseDirectory,
  filePath: string,
  expectedIdentity: FileIdentity,
): boolean {
  try {
    assertLeaseDirectoryIdentity(leaseDirectory);
    const stat = lstatSync(filePath);
    return stat.isFile()
      && safeModeAndOwner(stat, 0o600)
      && sameFileIdentity(fileIdentity(stat), expectedIdentity);
  } catch {
    return false;
  }
}

function unlinkIfIdentity(
  leaseDirectory: SafeLeaseDirectory,
  filePath: string,
  expectedIdentity: FileIdentity,
): boolean {
  try {
    assertLeaseDirectoryIdentity(leaseDirectory);
    const stat = lstatSync(filePath);
    if (
      !stat.isFile()
      || !safeModeAndOwner(stat, 0o600)
      || !sameFileIdentity(fileIdentity(stat), expectedIdentity)
    ) return false;
    unlinkSync(filePath);
    assertLeaseDirectoryIdentity(leaseDirectory);
    return true;
  } catch {
    return false;
  }
}

function unlinkRawIfIdentity(filePath: string, expectedIdentity: FileIdentity): void {
  try {
    const stat = lstatSync(filePath);
    if (stat.isFile() && sameFileIdentity(fileIdentity(stat), expectedIdentity)) unlinkSync(filePath);
  } catch {
    // Cleanup only.
  }
}

function monotonicNow(): bigint {
  return reviewerSessionLeaseTestHooks?.monotonicNow?.() ?? process.hrtime.bigint();
}

function monotonicElapsed(now: bigint, heartbeat: bigint): bigint {
  return now > heartbeat ? now - heartbeat : 0n;
}

function heartbeatElapsed(
  now: bigint,
  heartbeat: bigint,
  evidenceBootFingerprint: string,
  currentBootFingerprint: string,
): bigint {
  return evidenceBootFingerprint === currentBootFingerprint
    ? monotonicElapsed(now, heartbeat)
    : now;
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

function syncLeaseDirectory(directory: SafeLeaseDirectory): void {
  let descriptor: number | undefined;
  try {
    assertLeaseDirectoryIdentity(directory);
    descriptor = openSync(directory.directoryPath, constants.O_RDONLY | noFollowFlag());
    fsyncSync(descriptor);
    assertLeaseDirectoryIdentity(directory);
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

function fileIdentity(stat: { dev: number | bigint; ino: number | bigint }): FileIdentity {
  return { device: stat.dev, inode: stat.ino };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
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
