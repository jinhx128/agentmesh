import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
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
const OWNER = { pid: 4242, startIdentity: "test-owner-start" };

function registryDirectory(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "agentmesh-session-lease-")), "reviewer-sessions");
}

function leasePath(registryPath: string): string {
  return path.join(registryPath, `.${KEY}.lease`);
}

function writeLease(
  registryPath: string,
  input: { pid?: number; startIdentity?: string; ownerToken?: string; heartbeatAt?: number } = {},
): string {
  mkdirSync(registryPath, { recursive: true, mode: 0o700 });
  const filePath = leasePath(registryPath);
  writeFileSync(filePath, `${JSON.stringify({
    schema_version: 1,
    registry_key: KEY,
    pid: input.pid ?? OWNER.pid,
    process_start_identity: input.startIdentity ?? OWNER.startIdentity,
    owner_token: input.ownerToken ?? "a".repeat(32),
    heartbeat_at_ms: input.heartbeatAt ?? 1_000,
  })}\n`, { mode: 0o600 });
  const heartbeatAt = input.heartbeatAt ?? 1_000;
  utimesSync(filePath, new Date(heartbeatAt), new Date(heartbeatAt));
  return filePath;
}

function resetHooks(): void {
  setReviewerSessionLeaseTestHooks(undefined);
}

test("lease defaults are 5s wait and 10s heartbeat and lock order is documented", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  const observed: { waitMs?: number; heartbeatMs?: number } = {};
  setReviewerSessionLeaseTestHooks({
    currentOwner: () => OWNER,
    inspectProcess: () => ({ status: "same" }),
    onConfigured: (options) => Object.assign(observed, options),
  });

  const result = await withReviewerSessionLease(KEY, async ({ epoch }) => epoch, { registryPath });

  assert.deepEqual(result, { acquired: true, value: 0 });
  assert.deepEqual(observed, { waitMs: 5_000, heartbeatMs: 10_000 });
  const lease = await import("../packages/runtime/src/reviewer-sessions/lease.js");
  assert.deepEqual(lease.REVIEWER_SESSION_LOCK_ORDER, ["run-mutation", "entry-lease", "provider-spawn"]);
});

test("provider actions serialize per registry key and a bounded contender returns busy", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  setReviewerSessionLeaseTestHooks({
    currentOwner: () => OWNER,
    inspectProcess: () => ({ status: "same" }),
  });
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  const order: string[] = [];
  const first = withReviewerSessionLease(KEY, async () => {
    order.push("first-start");
    await blocker;
    order.push("first-end");
  }, { registryPath, heartbeatMs: 20 });
  while (!existsSync(leasePath(registryPath))) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const busy = await withReviewerSessionLease(KEY, async () => order.push("never"), {
    registryPath,
    waitMs: 5,
    heartbeatMs: 20,
  });
  assert.deepEqual(busy, { acquired: false, reason: "busy" });
  release();
  await first;
  const second = await withReviewerSessionLease(KEY, async () => order.push("second"), { registryPath });
  assert.equal(second.acquired, true);
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("metadata is complete and 0600 before atomic no-replace publication and heartbeats refresh", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  let unpublishedMetadata: Record<string, unknown> | undefined;
  setReviewerSessionLeaseTestHooks({
    currentOwner: () => OWNER,
    inspectProcess: () => ({ status: "same" }),
    beforePublish: (temporaryPath, publishedPath) => {
      assert.equal(existsSync(publishedPath), false);
      assert.equal(statSync(temporaryPath).mode & 0o777, 0o600);
      unpublishedMetadata = JSON.parse(readFileSync(temporaryPath, "utf-8"));
    },
  });
  let initialMtime = 0;
  const result = await withReviewerSessionLease(KEY, async ({ heartbeat }) => {
    const filePath = leasePath(registryPath);
    initialMtime = statSync(filePath).mtimeMs;
    heartbeat();
    heartbeat();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(statSync(filePath).mtimeMs > initialMtime);
    return "ok";
  }, { registryPath, heartbeatMs: 5 });

  assert.deepEqual(result, { acquired: true, value: "ok" });
  assert.equal(unpublishedMetadata?.schema_version, 1);
  assert.equal(unpublishedMetadata?.registry_key, KEY);
  assert.equal(unpublishedMetadata?.pid, OWNER.pid);
  assert.equal(unpublishedMetadata?.process_start_identity, OWNER.startIdentity);
  assert.match(String(unpublishedMetadata?.owner_token), /^[a-f0-9]{32}$/);
});

test("three missed heartbeats plus proven death reclaims, but live, unknown, and clock jumps do not", async () => {
  const cases = [
    { name: "dead", state: { status: "dead" } as const, acquired: true },
    { name: "live", state: { status: "same" } as const, acquired: false },
    { name: "unknown", state: { status: "unknown" } as const, acquired: false },
  ];
  for (const item of cases) {
    const registryPath = registryDirectory();
    try {
      writeLease(registryPath, { heartbeatAt: 1_000 });
      setReviewerSessionLeaseTestHooks({
        now: () => 31_000,
        currentOwner: () => ({ pid: OWNER.pid + 1, startIdentity: "contender" }),
        inspectProcess: () => item.state,
      });
      const result = await withReviewerSessionLease(KEY, async () => item.name, {
        registryPath,
        waitMs: 0,
        heartbeatMs: 10_000,
      });
      assert.equal(result.acquired, item.acquired, item.name);
    } finally {
      resetHooks();
      rmSync(path.dirname(registryPath), { recursive: true, force: true });
    }
  }

  const jumped = registryDirectory();
  try {
    writeLease(jumped, { heartbeatAt: 1_000 });
    setReviewerSessionLeaseTestHooks({
      now: () => Number.MAX_SAFE_INTEGER,
      currentOwner: () => ({ pid: OWNER.pid + 1, startIdentity: "contender" }),
      inspectProcess: () => ({ status: "same" }),
    });
    const result = await withReviewerSessionLease(KEY, async () => "stolen", {
      registryPath: jumped,
      waitMs: 0,
      heartbeatMs: 10_000,
    });
    assert.deepEqual(result, { acquired: false, reason: "busy" });
  } finally {
    resetHooks();
    rmSync(path.dirname(jumped), { recursive: true, force: true });
  }
});

test("PID reuse proves the old identity dead only after three misses", async () => {
  for (const now of [30_999, 31_000]) {
    const registryPath = registryDirectory();
    try {
      writeLease(registryPath, { heartbeatAt: 1_000 });
      setReviewerSessionLeaseTestHooks({
        now: () => now,
        currentOwner: () => ({ pid: OWNER.pid + 1, startIdentity: "contender" }),
        inspectProcess: (_pid, expected) => {
          assert.equal(expected, OWNER.startIdentity);
          return { status: "different", actualStartIdentity: "reused-pid-start" };
        },
      });
      const result = await withReviewerSessionLease(KEY, async () => "reclaimed", {
        registryPath,
        waitMs: 0,
        heartbeatMs: 10_000,
      });
      assert.equal(result.acquired, now === 31_000);
    } finally {
      resetHooks();
      rmSync(path.dirname(registryPath), { recursive: true, force: true });
    }
  }
});

test("old owner cleanup cannot unlink a successor and cleanup errors preserve the primary result", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  setReviewerSessionLeaseTestHooks({
    currentOwner: () => OWNER,
    inspectProcess: () => ({ status: "same" }),
    beforeRelease: (publishedPath) => {
      unlinkSync(publishedPath);
      writeLease(registryPath, {
        pid: OWNER.pid + 1,
        startIdentity: "successor",
        ownerToken: "b".repeat(32),
      });
      chmodSync(path.dirname(publishedPath), 0o500);
    },
  });
  const result = await withReviewerSessionLease(KEY, async () => "primary", { registryPath });
  chmodSync(registryPath, 0o700);

  assert.deepEqual(result, { acquired: true, value: "primary" });
  assert.equal(existsSync(leasePath(registryPath)), true);
  const successor = JSON.parse(readFileSync(leasePath(registryPath), "utf-8"));
  assert.equal(successor.process_start_identity, "successor");
});

test("lease exposes epoch evidence and close prevents an old action from writing back", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  const invocation = {
    command: "provider",
    args: ["review"],
    capabilities: ["resume"],
    permissionMode: "read-only",
    contextMode: "packet",
    reviewerPersonaVersion: "v1",
    promptSchemaVersion: "v1",
    adapterPluginVersion: "v1",
    providerCliVersion: "v1",
    environmentVariableNames: ["PATH"],
  };
  const key = sessionRegistryKey({
    conversationScopeRef: "cs-1111111111111111",
    workspaceId: "ws-2222222222222222",
    worktreeId: "wt-3333333333333333",
    agentId: "reviewer",
    adapterId: "provider",
    model: "model",
    reasoningEffort: "high",
    invocation,
  });
  const input = {
    key,
    sessionRef: reviewerSessionRef(key),
    providerSessionId: "sensitive-native-id",
    invocationFingerprint: reviewerSessionInvocationFingerprint(invocation),
  };
  const created = upsertReviewerSession(input, { registryPath });
  assert.equal(created.status, "written");
  setReviewerSessionLeaseTestHooks({
    currentOwner: () => OWNER,
    inspectProcess: () => ({ status: "same" }),
  });

  const result = await withReviewerSessionLease(key, async ({ epoch }) => {
    assert.equal(epoch, created.entry.epoch);
    const closed = closeReviewerSession(key, { registryPath, expectedEpoch: epoch });
    assert.equal(closed.status, "closed");
    return upsertReviewerSession({ ...input, expectedEpoch: epoch, successfulResume: true }, { registryPath });
  }, { registryPath });

  assert.equal(result.acquired, true);
  if (result.acquired) {
    assert.equal(result.value.status, "conflict");
  }
});

test("busy caller can choose fresh isolated without registry mutation or provider identity access", async () => {
  const registryPath = registryDirectory();
  test.after(() => {
    resetHooks();
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  });
  writeLease(registryPath, { heartbeatAt: 1_000 });
  let registryEvidenceReads = 0;
  setReviewerSessionLeaseTestHooks({
    now: () => 1_001,
    currentOwner: () => ({ pid: OWNER.pid + 1, startIdentity: "contender" }),
    inspectProcess: () => ({ status: "same" }),
    onEpochEvidenceRead: () => { registryEvidenceReads += 1; },
  });
  let providerActionCalls = 0;
  const leased = await withReviewerSessionLease(KEY, async () => {
    providerActionCalls += 1;
    return "provider-sensitive-id";
  }, { registryPath, waitMs: 0 });
  const fallback = leased.acquired ? leased.value : "fresh-isolated";

  assert.equal(fallback, "fresh-isolated");
  assert.equal(providerActionCalls, 0);
  assert.equal(registryEvidenceReads, 0);
  assert.deepEqual(readdirSync(registryPath), [`.${KEY}.lease`]);
  assert.doesNotMatch(readFileSync(leasePath(registryPath), "utf-8"), /provider-sensitive-id/);
});
