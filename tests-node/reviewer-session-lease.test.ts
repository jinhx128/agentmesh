import assert from "node:assert/strict";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  inspectReviewerSessionLeaseProcessForTest,
  parseLinuxProcessStartIdentityForTest,
  readReviewerSessionBootFingerprintForTest,
  setReviewerSessionLeaseTestHooks,
  withReviewerSessionLease,
} from "../packages/runtime/src/reviewer-sessions/lease.js";
import {
  closeReviewerSession,
  reviewerSessionInvocationFingerprint,
  reviewerSessionRef,
  sessionRegistryKey,
  upsertReviewerSession,
} from "../packages/runtime/src/reviewer-sessions/registry.js";

const KEY = "rk-0123456789abcdef0123456789abcdef";
const OWNER = { pid: 4242, startIdentity: "linux-proc-start:111" };
const SECOND_OWNER = { pid: 4343, startIdentity: "linux-proc-start:222" };
const HEARTBEAT_MS = 10_000;
const BOOT_A = "test-boot:aaaaaaaa";
const BOOT_B = "test-boot:bbbbbbbb";

function registryDirectory(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "agentmesh-session-lease-")), "reviewer-sessions");
}

function candidatePath(registryPath: string, ownerToken: string): string {
  return path.join(registryPath, `.${KEY}.lease.${ownerToken}.json`);
}

function candidatePaths(registryPath: string): string[] {
  if (!existsSync(registryPath)) {
    return [];
  }
  return readdirSync(registryPath)
    .filter((name) => new RegExp(`^\\.${KEY}\\.lease\\.[a-f0-9]{32}\\.json$`).test(name))
    .map((name) => path.join(registryPath, name));
}

function writeCandidate(
  registryPath: string,
  input: {
    ownerToken?: string;
    pid?: number;
    startIdentity?: string | null;
    createdMonotonicNs?: bigint;
    heartbeatMonotonicNs?: bigint;
    ticket?: number;
    bootFingerprint?: string;
  } = {},
): string {
  mkdirSync(registryPath, { recursive: true, mode: 0o700 });
  const ownerToken = input.ownerToken ?? "a".repeat(32);
  const filePath = candidatePath(registryPath, ownerToken);
  writeFileSync(filePath, `${JSON.stringify({
    schema_version: 1,
    registry_key: KEY,
    pid: input.pid ?? OWNER.pid,
    process_start_identity: input.startIdentity === undefined ? OWNER.startIdentity : input.startIdentity,
    owner_token: ownerToken,
    boot_fingerprint: input.bootFingerprint ?? BOOT_A,
    lease_ticket: input.ticket ?? 1,
    created_monotonic_ns: String(input.createdMonotonicNs ?? 1_000_000_000n),
    heartbeat_monotonic_ns: String(input.heartbeatMonotonicNs ?? 1_000_000_000n),
  })}\n`, { mode: 0o600 });
  return filePath;
}

function resetHooks(): void {
  setReviewerSessionLeaseTestHooks(undefined);
}

function setLeaseHooks(
  hooks: NonNullable<Parameters<typeof setReviewerSessionLeaseTestHooks>[0]>,
): void {
  setReviewerSessionLeaseTestHooks({
    bootFingerprint: () => BOOT_A,
    ...hooks,
  });
}

test("lease defaults are 5s wait and 10s heartbeat and lock order is documented", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  const observed: { waitMs?: number; heartbeatMs?: number } = {};
  setLeaseHooks({
    currentOwner: () => OWNER,
    monotonicNow: () => 1_000_000_000n,
    inspectProcess: () => ({ status: "same" }),
    onConfigured: (options) => Object.assign(observed, options),
  });

  const result = await withReviewerSessionLease(KEY, async ({ epoch }) => epoch, { registryPath });

  assert.deepEqual(result, { acquired: true, value: 0 });
  assert.deepEqual(observed, { waitMs: 5_000, heartbeatMs: 10_000 });
  const lease = await import("../packages/runtime/src/reviewer-sessions/lease.js");
  assert.deepEqual(lease.REVIEWER_SESSION_LOCK_ORDER, ["run-mutation", "entry-lease", "provider-spawn"]);
});

test("unique candidates elect one owner and serialize contenders", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  let tick = 1_000_000_000n;
  let owner = OWNER;
  setLeaseHooks({
    currentOwner: () => owner,
    monotonicNow: () => tick,
    inspectProcess: () => ({ status: "same" }),
    sleep: async (milliseconds) => { tick += BigInt(milliseconds) * 1_000_000n; },
  });
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  const order: string[] = [];
  const first = withReviewerSessionLease(KEY, async () => {
    order.push("first-start");
    await blocker;
    order.push("first-end");
  }, { registryPath, heartbeatMs: 20 });
  while (candidatePaths(registryPath).length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  owner = SECOND_OWNER;
  const busy = await withReviewerSessionLease(KEY, async () => order.push("never"), {
    registryPath,
    waitMs: 5,
    heartbeatMs: 20,
  });
  assert.deepEqual(busy, { acquired: false, reason: "busy" });
  assert.equal(candidatePaths(registryPath).length, 1, "timed-out contender removes only its candidate");
  release();
  await first;
  tick += 1_000_000n;
  const second = await withReviewerSessionLease(KEY, async () => order.push("second"), { registryPath });
  assert.equal(second.acquired, true);
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("candidate metadata is complete and 0600 before atomic publication", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  let unpublishedMetadata: Record<string, unknown> | undefined;
  setLeaseHooks({
    currentOwner: () => OWNER,
    monotonicNow: () => 12_345n,
    beforePublish: (temporaryPath, publishedPath) => {
      assert.equal(existsSync(publishedPath), false);
      assert.equal(statSync(temporaryPath).mode & 0o777, 0o600);
      unpublishedMetadata = JSON.parse(readFileSync(temporaryPath, "utf-8"));
    },
  });
  const result = await withReviewerSessionLease(KEY, async () => "ok", { registryPath });

  assert.deepEqual(result, { acquired: true, value: "ok" });
  assert.equal(unpublishedMetadata?.schema_version, 1);
  assert.equal(unpublishedMetadata?.registry_key, KEY);
  assert.equal(unpublishedMetadata?.pid, OWNER.pid);
  assert.equal(unpublishedMetadata?.process_start_identity, OWNER.startIdentity);
  assert.equal(unpublishedMetadata?.created_monotonic_ns, "12345");
  assert.equal(unpublishedMetadata?.heartbeat_monotonic_ns, "12345");
  assert.equal(unpublishedMetadata?.lease_ticket, 1);
  assert.equal(unpublishedMetadata?.boot_fingerprint, BOOT_A);
});

test("automatic and manual heartbeats publish monotonic owner pulses while active", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  setLeaseHooks({ currentOwner: () => OWNER });
  const result = await withReviewerSessionLease(KEY, async ({ heartbeat }) => {
    heartbeat();
    heartbeat();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const pulses = readdirSync(registryPath).filter((name) => name.includes(".heartbeat."));
    assert.equal(pulses.length, 1);
    const pulse = JSON.parse(readFileSync(path.join(registryPath, pulses[0]), "utf-8"));
    assert.match(pulse.heartbeat_monotonic_ns, /^[0-9]+$/);
    return "ok";
  }, { registryPath, heartbeatMs: 5 });

  assert.deepEqual(result, { acquired: true, value: "ok" });
  assert.deepEqual(readdirSync(registryPath).filter((name) => name.includes(".heartbeat.")), []);
});

test("three monotonic heartbeat misses plus proven death reclaims; live and unknown do not", async () => {
  for (const item of [
    { name: "dead", state: { status: "dead" } as const, acquired: true },
    { name: "different", state: { status: "different", actualStartIdentity: "linux-proc-start:999" } as const, acquired: true },
    { name: "live", state: { status: "same" } as const, acquired: false },
    { name: "unknown", state: { status: "unknown" } as const, acquired: false },
  ]) {
    const registryPath = registryDirectory();
    try {
      writeCandidate(registryPath);
      setLeaseHooks({
        monotonicNow: () => 31_000_000_000n,
        currentOwner: () => SECOND_OWNER,
        inspectProcess: () => item.state,
      });
      const result = await withReviewerSessionLease(KEY, async () => item.name, {
        registryPath,
        waitMs: 0,
        heartbeatMs: HEARTBEAT_MS,
      });
      assert.equal(result.acquired, item.acquired, item.name);
    } finally {
      resetHooks();
      rmSync(path.dirname(registryPath), { recursive: true, force: true });
    }
  }
});

test("wall-clock jumps never create heartbeat misses, including dead and reused owners", async () => {
  const originalNow = Date.now;
  Date.now = () => Number.MAX_SAFE_INTEGER;
  try {
    for (const state of [
      { status: "dead" } as const,
      { status: "different", actualStartIdentity: "linux-proc-start:999" } as const,
    ]) {
      const registryPath = registryDirectory();
      try {
        writeCandidate(registryPath, { heartbeatMonotonicNs: 1_000_000_000n });
        setLeaseHooks({
          monotonicNow: () => 1_001_000_000n,
          currentOwner: () => SECOND_OWNER,
          inspectProcess: () => state,
        });
        const result = await withReviewerSessionLease(KEY, async () => "stolen", {
          registryPath,
          waitMs: 0,
          heartbeatMs: HEARTBEAT_MS,
        });
        assert.deepEqual(result, { acquired: false, reason: "busy" });
      } finally {
        resetHooks();
        rmSync(path.dirname(registryPath), { recursive: true, force: true });
      }
    }
  } finally {
    Date.now = originalNow;
  }
});

test("cross-boot candidates recover after three intervals without trusting incomparable old ticks", async () => {
  for (const uptime of [29_999_999_999n, 30_000_000_000n]) {
    const registryPath = registryDirectory();
    try {
      writeCandidate(registryPath, {
        bootFingerprint: BOOT_A,
        createdMonotonicNs: 9_000_000_000_000n,
        heartbeatMonotonicNs: 9_000_000_000_000n,
      });
      let inspections = 0;
      setLeaseHooks({
        bootFingerprint: () => BOOT_B,
        monotonicNow: () => uptime,
        currentOwner: () => SECOND_OWNER,
        inspectProcess: () => {
          inspections += 1;
          return { status: "same" };
        },
      });
      const result = await withReviewerSessionLease(KEY, async () => "recovered", {
        registryPath,
        waitMs: 0,
        heartbeatMs: HEARTBEAT_MS,
      });
      assert.equal(result.acquired, uptime === 30_000_000_000n);
      assert.equal(inspections, 0, "a boot change proves the old process instance cannot still be live");
    } finally {
      resetHooks();
      rmSync(path.dirname(registryPath), { recursive: true, force: true });
    }
  }
});

test("missing boot fingerprint fails closed before publishing a candidate", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  setLeaseHooks({
    bootFingerprint: () => undefined,
    currentOwner: () => OWNER,
    monotonicNow: () => 1_000_000_000n,
  });
  const result = await withReviewerSessionLease(KEY, async () => "unsafe", { registryPath });

  assert.deepEqual(result, { acquired: false, reason: "busy" });
  assert.deepEqual(candidatePaths(registryPath), []);
});

test("boot fingerprint lookup cannot publish after the monotonic wait deadline", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  let tick = 1_000_000_000n;
  setLeaseHooks({
    monotonicNow: () => tick,
    bootFingerprint: () => {
      tick += 6_000_000n;
      return BOOT_A;
    },
    currentOwner: () => OWNER,
  });
  const result = await withReviewerSessionLease(KEY, async () => "late", {
    registryPath,
    waitMs: 5,
  });

  assert.deepEqual(result, { acquired: false, reason: "busy" });
  assert.deepEqual(candidatePaths(registryPath), []);
});

test("saved heartbeat is permanently inert after release and cannot touch a reused descriptor", async () => {
  const registryPath = registryDirectory();
  const unrelated = path.join(path.dirname(registryPath), "unrelated.txt");
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  let savedHeartbeat: (() => void) | undefined;
  let tick = 1_000_000_000n;
  setLeaseHooks({ currentOwner: () => OWNER, monotonicNow: () => tick });
  await withReviewerSessionLease(KEY, async ({ heartbeat }) => {
    savedHeartbeat = heartbeat;
  }, { registryPath });

  writeFileSync(unrelated, "unrelated", { mode: 0o600 });
  const descriptor = openSync(unrelated, "r+");
  const before = statSync(unrelated).mtimeMs;
  tick += 50_000_000_000n;
  savedHeartbeat?.();
  closeSync(descriptor);

  assert.equal(statSync(unrelated).mtimeMs, before);
  assert.deepEqual(candidatePaths(registryPath), []);
});

test("release deletes only its unique candidate when a successor appears", async () => {
  const registryPath = registryDirectory();
  const successorToken = "b".repeat(32);
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  setLeaseHooks({
    currentOwner: () => OWNER,
    monotonicNow: () => 1_000_000_000n,
    beforeRelease: () => {
      writeCandidate(registryPath, { ownerToken: successorToken, pid: SECOND_OWNER.pid, startIdentity: SECOND_OWNER.startIdentity });
    },
  });
  const result = await withReviewerSessionLease(KEY, async () => "primary", { registryPath });

  assert.deepEqual(result, { acquired: true, value: "primary" });
  assert.deepEqual(candidatePaths(registryPath), [candidatePath(registryPath, successorToken)]);
});

test("a reclaimer cannot delete a new owner created after its stale-candidate check", async () => {
  const registryPath = registryDirectory();
  const stale = writeCandidate(registryPath, { ownerToken: "a".repeat(32) });
  const successorToken = "b".repeat(32);
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  let interleaved = false;
  setLeaseHooks({
    currentOwner: () => SECOND_OWNER,
    monotonicNow: () => 31_000_000_000n,
    inspectProcess: () => ({ status: "dead" }),
    beforeCandidateDelete: (candidate) => {
      if (!interleaved && candidate === stale) {
        interleaved = true;
        unlinkSync(stale);
        writeCandidate(registryPath, {
          ownerToken: successorToken,
          pid: 4444,
          startIdentity: "linux-proc-start:444",
          createdMonotonicNs: 30_000_000_000n,
          heartbeatMonotonicNs: 30_000_000_000n,
        });
      }
    },
  });
  const result = await withReviewerSessionLease(KEY, async () => "contender", {
    registryPath,
    waitMs: 0,
    heartbeatMs: HEARTBEAT_MS,
  });

  assert.equal(interleaved, true);
  assert.deepEqual(result, { acquired: false, reason: "busy" });
  assert.equal(existsSync(candidatePath(registryPath, successorToken)), true);
});

test("cleanup failure is swallowed but leaves concrete owner evidence", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    chmodSync(registryPath, 0o700);
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  setLeaseHooks({
    currentOwner: () => OWNER,
    monotonicNow: () => 1_000_000_000n,
    beforeRelease: () => chmodSync(registryPath, 0o500),
  });
  const result = await withReviewerSessionLease(KEY, async () => "primary", { registryPath });
  chmodSync(registryPath, 0o700);

  assert.deepEqual(result, { acquired: true, value: "primary" });
  assert.equal(candidatePaths(registryPath).length, 1, "unlink really failed instead of the test merely replacing the path");
});

test("monotonic deadline is checked after expensive owner inspection", async () => {
  const registryPath = registryDirectory();
  const stale = writeCandidate(registryPath);
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  let tick = 31_000_000_000n;
  let observedBudget = 0;
  setLeaseHooks({
    currentOwner: () => SECOND_OWNER,
    monotonicNow: () => tick,
    inspectProcess: (_pid, _expected, remainingMs) => {
      observedBudget = remainingMs;
      tick += 6_000_000n;
      return { status: "dead" };
    },
  });
  const result = await withReviewerSessionLease(KEY, async () => "late", {
    registryPath,
    waitMs: 5,
    heartbeatMs: HEARTBEAT_MS,
  });

  assert.deepEqual(result, { acquired: false, reason: "busy" });
  assert.ok(observedBudget > 0 && observedBudget <= 5);
  assert.equal(existsSync(stale), true, "expired inspection cannot mutate lease state after the deadline");
});

test("Linux parser handles parenthesized commands and Darwin uses absolute ps but stays unknown", () => {
  const linuxStat = `123 (command ) with spaces) S ${Array.from({ length: 18 }, (_, index) => index + 1).join(" ")} 987654 0 0`;
  assert.equal(parseLinuxProcessStartIdentityForTest(linuxStat), "linux-proc-start:987654");

  let executable = "";
  let timeout = 0;
  const darwin = inspectReviewerSessionLeaseProcessForTest(123, null, {
    platform: "darwin",
    remainingMs: 7,
    killProbe: () => "alive",
    execFile: (file, _args, timeoutMs) => {
      executable = file;
      timeout = timeoutMs;
      return "123";
    },
  });
  assert.equal(executable, "/bin/ps");
  assert.ok(timeout > 0 && timeout <= 7);
  assert.deepEqual(darwin, { status: "unknown" });

  const unsupported = inspectReviewerSessionLeaseProcessForTest(123, null, {
    platform: "win32",
    remainingMs: 7,
    killProbe: () => "alive",
  });
  assert.deepEqual(unsupported, { status: "unknown" });

  if (process.platform === "linux") {
    const actualStat = readFileSync(`/proc/${process.pid}/stat`, "utf-8");
    const actualIdentity = parseLinuxProcessStartIdentityForTest(actualStat);
    assert.ok(actualIdentity);
    assert.deepEqual(inspectReviewerSessionLeaseProcessForTest(process.pid, actualIdentity, {
      platform: "linux",
      remainingMs: 10,
    }), { status: "same" });
  }
});

test("boot fingerprint uses trusted Linux proc or absolute Darwin sysctl and rejects malformed evidence", () => {
  const linux = readReviewerSessionBootFingerprintForTest({
    platform: "linux",
    remainingMs: 10,
    readLinuxBootId: () => "01234567-89ab-cdef-8123-456789abcdef\n",
  });
  assert.equal(linux, "linux-boot:01234567-89ab-cdef-8123-456789abcdef");

  let executable = "";
  let timeout = 0;
  const darwin = readReviewerSessionBootFingerprintForTest({
    platform: "darwin",
    remainingMs: 8,
    execFile: (file, args, timeoutMs) => {
      executable = file;
      timeout = timeoutMs;
      assert.deepEqual(args, ["-n", "kern.boottime"]);
      return "{ sec = 1780000000, usec = 123456 } Fri May 29 00:00:00 2026";
    },
  });
  assert.equal(executable, "/usr/sbin/sysctl");
  assert.ok(timeout > 0 && timeout <= 8);
  assert.equal(darwin, "darwin-boot:1780000000.123456");
  assert.equal(readReviewerSessionBootFingerprintForTest({
    platform: "darwin",
    remainingMs: 8,
    execFile: () => "malformed",
  }), undefined);
});

test("lease exposes epoch evidence and close prevents an old action from writing back", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  const invocation = {
    command: "provider", args: ["review"], capabilities: ["resume"], permissionMode: "read-only",
    contextMode: "packet", reviewerPersonaVersion: "v1", promptSchemaVersion: "v1",
    adapterPluginVersion: "v1", providerCliVersion: "v1", environmentVariableNames: ["PATH"],
  };
  const key = sessionRegistryKey({
    conversationScopeRef: "cs-1111111111111111", workspaceId: "ws-2222222222222222",
    worktreeId: "wt-3333333333333333", agentId: "reviewer", adapterId: "provider",
    model: "model", reasoningEffort: "high", invocation,
  });
  const input = {
    key, sessionRef: reviewerSessionRef(key), providerSessionId: "sensitive-native-id",
    invocationFingerprint: reviewerSessionInvocationFingerprint(invocation),
  };
  const created = upsertReviewerSession(input, { registryPath });
  assert.equal(created.status, "written");
  setLeaseHooks({ currentOwner: () => OWNER, monotonicNow: () => 1_000_000_000n });

  const result = await withReviewerSessionLease(key, async ({ epoch }) => {
    assert.equal(epoch, created.entry.epoch);
    assert.equal(closeReviewerSession(key, { registryPath, expectedEpoch: epoch }).status, "closed");
    return upsertReviewerSession({ ...input, expectedEpoch: epoch, successfulResume: true }, { registryPath });
  }, { registryPath });

  assert.equal(result.acquired, true);
  if (result.acquired) assert.equal(result.value.status, "conflict");
});

test("busy caller can choose fresh isolated without registry mutation or provider identity access", async () => {
  const registryPath = registryDirectory();
  writeCandidate(registryPath, { heartbeatMonotonicNs: 1_000_000_000n });
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  let registryEvidenceReads = 0;
  setLeaseHooks({
    monotonicNow: () => 1_001_000_000n,
    currentOwner: () => SECOND_OWNER,
    inspectProcess: () => ({ status: "same" }),
    onEpochEvidenceRead: () => { registryEvidenceReads += 1; },
  });
  let providerActionCalls = 0;
  const leased = await withReviewerSessionLease(KEY, async () => {
    providerActionCalls += 1;
    return "provider-sensitive-id";
  }, { registryPath, waitMs: 0 });

  assert.equal(leased.acquired, false);
  assert.equal(providerActionCalls, 0);
  assert.equal(registryEvidenceReads, 0);
  assert.doesNotMatch(readdirSync(registryPath).join("\n"), /provider-sensitive-id/);
});
