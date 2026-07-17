import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  closeReviewerSession,
  evaluateReviewerSessionLifecycle,
  purgeReviewerSessions,
  readReviewerSession,
  reviewerSessionInvocationFingerprint,
  reviewerSessionRef,
  sessionRegistryKey,
  setReviewerSessionRegistryTestHooks,
  shouldRotateForContext,
  upsertReviewerSession,
} from "../packages/runtime/src/reviewer-sessions/registry.js";

const HOUR = 60 * 60 * 1_000;
const START = "2026-07-17T00:00:00.000Z";

function registryDirectory(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "agentmesh-session-registry-")), "reviewer-sessions");
}

function invocation(overrides: Record<string, unknown> = {}) {
  return {
    command: "review-provider",
    args: ["review", "--structured"],
    capabilities: ["structured-session-id", "resume"],
    permissionMode: "read-only",
    contextMode: "packet",
    reviewerPersonaVersion: "architecture-v1",
    promptSchemaVersion: "packet-v1",
    adapterPluginVersion: "adapter-v1",
    providerCliVersion: "cli-v1",
    environmentVariableNames: ["PATH", "HOME"],
    ...overrides,
  };
}

function identity(overrides: Record<string, unknown> = {}) {
  const invocationInput = invocation();
  const keyInput = {
    conversationScopeRef: "cs-1111111111111111",
    workspaceId: "ws-2222222222222222",
    worktreeId: "wt-3333333333333333",
    agentId: "architecture-reviewer",
    adapterId: "provider-cli",
    model: "review-model",
    reasoningEffort: "high",
    invocation: invocationInput,
    ...overrides,
  };
  const key = sessionRegistryKey(keyInput);
  return {
    key,
    sessionRef: reviewerSessionRef(key),
    invocationFingerprint: reviewerSessionInvocationFingerprint(keyInput.invocation),
  };
}

function providerSessionId(): string {
  return `provider-${Buffer.alloc(24, 7).toString("hex")}`;
}

function mutationLockPath(registryPath: string, key: string): string {
  return path.join(registryPath, `.${key}.mutation`);
}

function writeMutationLock(registryPath: string, key: string, pid: number): string {
  const lockPath = mutationLockPath(registryPath, key);
  writeFileSync(lockPath, JSON.stringify({
    schema_version: 1,
    pid,
    created_at_ms: Date.now() - 60_000,
    nonce: "a".repeat(24),
  }), { mode: 0o600 });
  return lockPath;
}

function raceMutation(
  action: "update" | "close",
  registryPath: string,
  ids: ReturnType<typeof identity>,
  expectedEpoch: number,
  startAt: number,
): Promise<string> {
  const moduleUrl = pathToFileURL(path.join(
    process.cwd(),
    "dist-node",
    "packages",
    "runtime",
    "src",
    "reviewer-sessions",
    "registry.js",
  )).href;
  const program = [
    `const registry = await import(${JSON.stringify(moduleUrl)});`,
    "const wait = new Int32Array(new SharedArrayBuffer(4));",
    "while (Date.now() < Number(process.env.AGENTMESH_TEST_START_AT)) Atomics.wait(wait, 0, 0, 2);",
    "const input = JSON.parse(process.env.AGENTMESH_TEST_INPUT);",
    action === "update"
      ? "const result = registry.upsertReviewerSession(input.entry, input.options);"
      : "const result = registry.closeReviewerSession(input.entry.key, { ...input.options, expectedEpoch: input.entry.expectedEpoch });",
    "process.stdout.write(result.status);",
  ].join("\n");
  const input = JSON.stringify({
    entry: {
      ...ids,
      providerSessionId: providerSessionId(),
      expectedEpoch,
      successfulResume: true,
    },
    options: { registryPath, now: new Date(Date.parse(START) + 1_000).toISOString() },
  });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", program], {
      env: {
        ...process.env,
        AGENTMESH_TEST_INPUT: input,
        AGENTMESH_TEST_START_AT: String(startAt),
      },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8");
    });
    child.once("error", () => reject(new Error("registry race child could not start")));
    child.once("close", (code) => {
      code === 0 ? resolve(output) : reject(new Error("registry race child did not succeed"));
    });
  });
}

function createSession(registryPath: string, overrides: Record<string, unknown> = {}) {
  const ids = identity();
  const result = upsertReviewerSession({
    ...ids,
    providerSessionId: providerSessionId(),
    ...overrides,
  }, { registryPath, now: START });
  assert.equal(result.status, "written");
  return { ids, entry: result.entry };
}

test("registry keys normalize set-like invocation inputs and never include environment values", () => {
  const secretValue = `secret-${Buffer.alloc(16, 9).toString("hex")}`;
  const firstInvocation = invocation({
    capabilities: ["resume", "structured-session-id", "resume"],
    environmentVariableNames: ["PATH", "HOME", "PATH"],
  });
  const secondInvocation = invocation({
    capabilities: ["structured-session-id", "resume"],
    environmentVariableNames: ["HOME", "PATH"],
  });
  const first = sessionRegistryKey({
    conversationScopeRef: "cs-1111111111111111",
    workspaceId: "ws-2222222222222222",
    worktreeId: "wt-3333333333333333",
    agentId: "reviewer",
    adapterId: "provider-cli",
    model: "review-model",
    reasoningEffort: "high",
    invocation: firstInvocation,
  });
  const second = sessionRegistryKey({
    conversationScopeRef: "cs-1111111111111111",
    workspaceId: "ws-2222222222222222",
    worktreeId: "wt-3333333333333333",
    agentId: "reviewer",
    adapterId: "provider-cli",
    model: "review-model",
    reasoningEffort: "high",
    invocation: secondInvocation,
  });

  assert.equal(first, second);
  assert.match(first, /^rk-[a-f0-9]{32}$/);
  assert.match(reviewerSessionRef(first), /^rs-[a-f0-9]{16}$/);
  assert.doesNotMatch(first, new RegExp(secretValue));
  assert.throws(
    () => reviewerSessionInvocationFingerprint(invocation({ environmentVariableNames: [`TOKEN=${secretValue}`] })),
    /environment variable names are invalid/,
  );
});

test("scope, worktree, model, and invocation changes rotate the registry key while argument order remains significant", () => {
  const base = {
    conversationScopeRef: "cs-1111111111111111",
    workspaceId: "ws-2222222222222222",
    worktreeId: "wt-3333333333333333",
    agentId: "reviewer",
    adapterId: "provider-cli",
    model: "review-model",
    reasoningEffort: "high",
    invocation: invocation(),
  };
  const key = sessionRegistryKey(base);
  for (const changed of [
    { ...base, conversationScopeRef: "cs-aaaaaaaaaaaaaaaa" },
    { ...base, worktreeId: "wt-bbbbbbbbbbbbbbbb" },
    { ...base, model: "other-model" },
    { ...base, invocation: invocation({ permissionMode: "workspace-write" }) },
    { ...base, invocation: invocation({ args: ["--structured", "review"] }) },
  ]) {
    assert.notEqual(sessionRegistryKey(changed), key);
  }
  assert.throws(() => sessionRegistryKey({ ...base, conversationScopeRef: undefined }), /conversation scope is required/);
});

test("new registry state is user-only and provider identity is confined to the entry file", () => {
  const registryPath = registryDirectory();
  const providerId = providerSessionId();
  try {
    const ids = identity();
    const result = upsertReviewerSession({ ...ids, providerSessionId: providerId }, { registryPath, now: START });
    assert.equal(result.status, "written");

    const files = readdirSync(registryPath);
    assert.deepEqual(files.sort(), [`${ids.key}.epoch.json`, `${ids.key}.json`].sort());
    const entryPath = path.join(registryPath, `${ids.key}.json`);
    assert.equal(statSync(registryPath).mode & 0o777, 0o700);
    assert.equal(statSync(entryPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(entryPath, "utf-8").includes(providerId), true);
    assert.equal(files.join("\n").includes(providerId), false);
    assert.equal(JSON.stringify({ key: ids.key, session_ref: ids.sessionRef }).includes(providerId), false);
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  }
});

test("unsafe existing directory and entry permissions refuse reads and writes without repair", () => {
  const registryPath = registryDirectory();
  try {
    mkdirSync(registryPath, { recursive: true, mode: 0o755 });
    chmodSync(registryPath, 0o755);
    const ids = identity();
    const directoryRead = readReviewerSession(ids.key, { registryPath, now: START });
    const directoryWrite = upsertReviewerSession({ ...ids, providerSessionId: providerSessionId() }, { registryPath, now: START });
    assert.deepEqual(directoryRead, {
      status: "unavailable",
      reason: "unsafe_directory",
      diagnostic: "reviewer session registry directory is unsafe",
    });
    assert.equal(directoryWrite.status, "unavailable");
    assert.equal(statSync(registryPath).mode & 0o777, 0o755);

    chmodSync(registryPath, 0o700);
    const created = upsertReviewerSession({ ...ids, providerSessionId: providerSessionId() }, { registryPath, now: START });
    assert.equal(created.status, "written");
    const entryPath = path.join(registryPath, `${ids.key}.json`);
    chmodSync(entryPath, 0o644);
    const fileRead = readReviewerSession(ids.key, { registryPath, now: START });
    const fileWrite = upsertReviewerSession({
      ...ids,
      providerSessionId: providerSessionId(),
      expectedEpoch: created.entry.epoch,
      successfulResume: true,
    }, { registryPath, now: new Date(Date.parse(START) + 1_000) });
    assert.equal(fileRead.status, "unavailable");
    assert.equal(fileRead.reason, "unsafe_entry");
    assert.equal(fileWrite.status, "unavailable");
    assert.equal(statSync(entryPath).mode & 0o777, 0o644);
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  }
});

test("symlink and non-regular entries are unavailable without following their targets", () => {
  const registryPath = registryDirectory();
  const outside = path.join(mkdtempSync(path.join(os.tmpdir(), "agentmesh-session-outside-")), "outside.json");
  try {
    mkdirSync(registryPath, { recursive: true, mode: 0o700 });
    const ids = identity();
    writeFileSync(outside, "outside", { mode: 0o600 });
    symlinkSync(outside, path.join(registryPath, `${ids.key}.json`));
    const result = readReviewerSession(ids.key, { registryPath, now: START });
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "unsafe_entry");
    assert.equal(readFileSync(outside, "utf-8"), "outside");
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
    rmSync(path.dirname(outside), { recursive: true, force: true });
  }
});

test("atomic entries ignore incomplete temporary artifacts and strict schema rejects corrupt or newer JSON", () => {
  const registryPath = registryDirectory();
  try {
    const { ids } = createSession(registryPath);
    const entryPath = path.join(registryPath, `${ids.key}.json`);
    writeFileSync(path.join(registryPath, `.${ids.key}.interrupted.tmp`), '{"schema_version":', { mode: 0o600 });

    const available = readReviewerSession(ids.key, { registryPath, now: START });
    assert.equal(available.status, "available");
    assert.doesNotThrow(() => JSON.parse(readFileSync(entryPath, "utf-8")));

    const valid = JSON.parse(readFileSync(entryPath, "utf-8"));
    writeFileSync(entryPath, JSON.stringify({ ...valid, schema_version: 2 }), { mode: 0o600 });
    const newer = readReviewerSession(ids.key, { registryPath, now: START });
    assert.equal(newer.status, "unavailable");
    assert.equal(newer.reason, "invalid_entry");

    writeFileSync(entryPath, JSON.stringify({ ...valid, unexpected: true }), { mode: 0o600 });
    const unknownField = readReviewerSession(ids.key, { registryPath, now: START });
    assert.equal(unknownField.status, "unavailable");
    assert.equal(unknownField.reason, "invalid_entry");

    writeFileSync(entryPath, '{"schema_version":', { mode: 0o600 });
    const corrupt = readReviewerSession(ids.key, { registryPath, now: START });
    assert.equal(corrupt.status, "unavailable");
    assert.equal(corrupt.reason, "invalid_entry");
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  }
});

test("epoch CAS rejects stale updates and close cannot be undone by a stale writer", () => {
  const registryPath = registryDirectory();
  try {
    const { ids, entry } = createSession(registryPath);
    const resumed = upsertReviewerSession({
      ...ids,
      providerSessionId: providerSessionId(),
      expectedEpoch: entry.epoch,
      successfulResume: true,
    }, { registryPath, now: new Date(Date.parse(START) + 1_000) });
    assert.equal(resumed.status, "written");
    assert.equal(resumed.entry.epoch, entry.epoch + 1);
    assert.equal(resumed.entry.successful_resumes, 1);

    const stale = upsertReviewerSession({
      ...ids,
      providerSessionId: providerSessionId(),
      expectedEpoch: entry.epoch,
      successfulResume: true,
    }, { registryPath, now: new Date(Date.parse(START) + 2_000) });
    assert.equal(stale.status, "conflict");
    assert.equal(stale.reason, "epoch_mismatch");

    const closed = closeReviewerSession(ids.key, {
      registryPath,
      now: new Date(Date.parse(START) + 3_000),
      expectedEpoch: resumed.entry.epoch,
    });
    assert.equal(closed.status, "closed");
    assert.equal(closed.epoch, resumed.entry.epoch + 1);
    assert.equal(existsSync(path.join(registryPath, `${ids.key}.json`)), false);
    const closedRetry = closeReviewerSession(ids.key, {
      registryPath,
      now: new Date(Date.parse(START) + 3_001),
      expectedEpoch: resumed.entry.epoch,
    });
    assert.equal(closedRetry.status, "closed");
    assert.equal(closedRetry.epoch, closed.epoch);

    const resurrect = upsertReviewerSession({
      ...ids,
      providerSessionId: providerSessionId(),
      expectedEpoch: resumed.entry.epoch,
      successfulResume: true,
    }, { registryPath, now: new Date(Date.parse(START) + 4_000) });
    assert.equal(resurrect.status, "conflict");
    assert.equal(resurrect.reason, "epoch_mismatch");
    assert.equal(closeReviewerSession(ids.key, { registryPath, now: START }).status, "already_absent");

    const recreated = upsertReviewerSession({
      ...ids,
      providerSessionId: providerSessionId(),
    }, { registryPath, now: new Date(Date.parse(START) + 5_000) });
    assert.equal(recreated.status, "written");
    assert.equal(recreated.entry.epoch, closed.epoch + 1);
    const ancient = upsertReviewerSession({
      ...ids,
      providerSessionId: providerSessionId(),
      expectedEpoch: entry.epoch,
      successfulResume: true,
    }, { registryPath, now: new Date(Date.parse(START) + 6_000) });
    assert.equal(ancient.status, "conflict");
    assert.equal(ancient.reason, "epoch_mismatch");
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  }
});

test("expired or unsuccessful existing attempts cannot refresh idle TTL", () => {
  const registryPath = registryDirectory();
  try {
    const created = createSession(registryPath);
    const unsuccessful = upsertReviewerSession({
      ...created.ids,
      providerSessionId: providerSessionId(),
      expectedEpoch: created.entry.epoch,
      successfulResume: false,
    }, { registryPath, now: new Date(Date.parse(START) + 1_000) });
    assert.equal(unsuccessful.status, "conflict");
    assert.equal(unsuccessful.reason, "not_successful_resume");

    const expired = upsertReviewerSession({
      ...created.ids,
      providerSessionId: providerSessionId(),
      expectedEpoch: created.entry.epoch,
      successfulResume: true,
    }, { registryPath, now: new Date(Date.parse(START) + 2 * HOUR) });
    assert.equal(expired.status, "conflict");
    assert.equal(expired.reason, "expired_idle");
    const raw = JSON.parse(readFileSync(path.join(registryPath, `${created.ids.key}.json`), "utf-8"));
    assert.equal(raw.last_used_at, START);
    assert.equal(raw.epoch, created.entry.epoch);
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  }
});

test("marker-first interruption is recoverable without reopening an old epoch", () => {
  const registryPath = registryDirectory();
  try {
    const created = createSession(registryPath);
    const markerPath = path.join(registryPath, `${created.ids.key}.epoch.json`);
    const marker = JSON.parse(readFileSync(markerPath, "utf-8"));
    writeFileSync(markerPath, JSON.stringify({ ...marker, epoch: created.entry.epoch + 1 }), { mode: 0o600 });

    const unavailable = readReviewerSession(created.ids.key, { registryPath, now: START });
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.reason, "invalid_entry");
    const interruptedClose = closeReviewerSession(created.ids.key, {
      registryPath,
      expectedEpoch: created.entry.epoch,
    });
    assert.equal(interruptedClose.status, "closed");
    assert.equal(interruptedClose.epoch, created.entry.epoch + 1);

    const recreatedAfterClose = upsertReviewerSession({
      ...created.ids,
      providerSessionId: providerSessionId(),
    }, { registryPath, now: new Date(Date.parse(START) + 500) });
    assert.equal(recreatedAfterClose.status, "written");
    assert.equal(recreatedAfterClose.entry.epoch, created.entry.epoch + 2);
    const recreatedMarker = JSON.parse(readFileSync(markerPath, "utf-8"));
    writeFileSync(markerPath, JSON.stringify({ ...recreatedMarker, epoch: recreatedAfterClose.entry.epoch + 1 }), { mode: 0o600 });
    const purged = purgeReviewerSessions({ registryPath, now: START });
    assert.equal(purged.status, "purged");
    assert.equal(purged.removed, 1);

    const recreated = upsertReviewerSession({
      ...created.ids,
      providerSessionId: providerSessionId(),
    }, { registryPath, now: new Date(Date.parse(START) + 1_000) });
    assert.equal(recreated.status, "written");
    assert.equal(recreated.entry.epoch, created.entry.epoch + 5);
    const stale = upsertReviewerSession({
      ...created.ids,
      providerSessionId: providerSessionId(),
      expectedEpoch: created.entry.epoch,
      successfulResume: true,
    }, { registryPath, now: new Date(Date.parse(START) + 2_000) });
    assert.equal(stale.status, "conflict");
    assert.equal(stale.reason, "epoch_mismatch");
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  }
});

test("purge advances a tombstone before deleting an entry whose marker is missing", () => {
  const registryPath = registryDirectory();
  try {
    const created = createSession(registryPath);
    unlinkSync(path.join(registryPath, `${created.ids.key}.epoch.json`));

    const purged = purgeReviewerSessions({ registryPath, now: START });
    assert.equal(purged.status, "purged");
    assert.equal(purged.removed, 1);
    const recreated = upsertReviewerSession({
      ...created.ids,
      providerSessionId: providerSessionId(),
    }, { registryPath, now: new Date(Date.parse(START) + 1_000) });
    assert.equal(recreated.status, "written");
    assert.equal(recreated.entry.epoch, created.entry.epoch + 2);
    const ancient = upsertReviewerSession({
      ...created.ids,
      providerSessionId: providerSessionId(),
      expectedEpoch: created.entry.epoch,
      successfulResume: true,
    }, { registryPath, now: new Date(Date.parse(START) + 2_000) });
    assert.equal(ancient.status, "conflict");
    assert.equal(ancient.reason, "epoch_mismatch");
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  }
});

test("purge recovers newer and corrupt epoch markers without ancient epoch collision", () => {
  for (const markerKind of ["newer", "corrupt"] as const) {
    const registryPath = registryDirectory();
    try {
      const created = createSession(registryPath);
      const markerPath = path.join(registryPath, `${created.ids.key}.epoch.json`);
      const entryPath = path.join(registryPath, `${created.ids.key}.json`);
      if (markerKind === "newer") {
        writeFileSync(markerPath, JSON.stringify({ schema_version: 2, key: created.ids.key, epoch: 41 }), { mode: 0o600 });
      } else {
        writeFileSync(markerPath, "corrupt-marker", { mode: 0o600 });
        writeFileSync(entryPath, "corrupt-entry", { mode: 0o600 });
      }

      const purged = purgeReviewerSessions({ registryPath, now: START });
      assert.equal(purged.status, "purged");
      assert.equal(purged.removed >= 1, true);
      const recreated = upsertReviewerSession({
        ...created.ids,
        providerSessionId: providerSessionId(),
      }, { registryPath, now: new Date(Date.parse(START) + 1_000) });
      assert.equal(recreated.status, "written");
      assert.equal(recreated.entry.epoch > created.entry.epoch, true);
      const ancient = upsertReviewerSession({
        ...created.ids,
        providerSessionId: providerSessionId(),
        expectedEpoch: created.entry.epoch,
        successfulResume: true,
      }, { registryPath, now: new Date(Date.parse(START) + 2_000) });
      assert.equal(ancient.status, "conflict");
      assert.equal(ancient.reason, "epoch_mismatch");
    } finally {
      rmSync(path.dirname(registryPath), { recursive: true, force: true });
    }
  }
});

test("purge normalizes an unadvanceable future epoch into a terminal tombstone", () => {
  const registryPath = registryDirectory();
  try {
    const created = createSession(registryPath);
    const markerPath = path.join(registryPath, `${created.ids.key}.epoch.json`);
    writeFileSync(markerPath, JSON.stringify({
      schema_version: 2,
      key: created.ids.key,
      epoch: Number.MAX_SAFE_INTEGER - 1,
    }), { mode: 0o600 });

    const purged = purgeReviewerSessions({ registryPath, now: START });
    assert.equal(purged.status, "purged");
    assert.equal(purged.removed, 1);
    assert.equal(existsSync(path.join(registryPath, `${created.ids.key}.json`)), false);
    const exhausted = upsertReviewerSession({
      ...created.ids,
      providerSessionId: providerSessionId(),
    }, { registryPath, now: new Date(Date.parse(START) + 1_000) });
    assert.equal(exhausted.status, "unavailable");
    assert.equal(exhausted.reason, "invalid_entry");
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  }
});

test("an unadvanceable valid entry is unavailable and purgeable", () => {
  const registryPath = registryDirectory();
  try {
    const created = createSession(registryPath);
    const entryPath = path.join(registryPath, `${created.ids.key}.json`);
    const markerPath = path.join(registryPath, `${created.ids.key}.epoch.json`);
    const entry = JSON.parse(readFileSync(entryPath, "utf-8"));
    const terminalEpoch = Number.MAX_SAFE_INTEGER - 1;
    writeFileSync(entryPath, JSON.stringify({ ...entry, epoch: terminalEpoch }), { mode: 0o600 });
    writeFileSync(markerPath, JSON.stringify({ schema_version: 1, key: created.ids.key, epoch: terminalEpoch }), { mode: 0o600 });

    const unavailable = readReviewerSession(created.ids.key, { registryPath, now: START });
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.reason, "invalid_entry");
    const purged = purgeReviewerSessions({ registryPath, now: START });
    assert.equal(purged.status, "purged");
    assert.equal(purged.removed, 1);
    assert.equal(existsSync(entryPath), false);
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  }
});

test("mutation lock reclaims a dead owner but never steals from a live owner", () => {
  const deadRegistry = registryDirectory();
  const liveRegistry = registryDirectory();
  try {
    mkdirSync(deadRegistry, { recursive: true, mode: 0o700 });
    const deadIds = identity({ worktreeId: "wt-deaddeaddeaddead" });
    const deadLock = writeMutationLock(deadRegistry, deadIds.key, 99_999_999);
    const recovered = upsertReviewerSession({
      ...deadIds,
      providerSessionId: providerSessionId(),
    }, { registryPath: deadRegistry, now: START });
    assert.equal(recovered.status, "written");
    assert.equal(existsSync(deadLock), false);

    mkdirSync(liveRegistry, { recursive: true, mode: 0o700 });
    const liveIds = identity({ worktreeId: "wt-livelivelivelive" });
    const liveLock = writeMutationLock(liveRegistry, liveIds.key, process.pid);
    utimesSync(liveLock, new Date(0), new Date(0));
    const busy = upsertReviewerSession({
      ...liveIds,
      providerSessionId: providerSessionId(),
    }, { registryPath: liveRegistry, now: START });
    assert.equal(busy.status, "busy");
    assert.equal(existsSync(liveLock), true);
  } finally {
    rmSync(path.dirname(deadRegistry), { recursive: true, force: true });
    rmSync(path.dirname(liveRegistry), { recursive: true, force: true });
  }
});

test("directory fsync ignores only explicit unsupported errors and propagates durability failures", () => {
  const unsupportedRegistry = registryDirectory();
  const failingRegistry = registryDirectory();
  try {
    setReviewerSessionRegistryTestHooks({
      directoryFsync: () => {
        throw Object.assign(new Error("unsupported directory sync"), { code: "EINVAL" });
      },
    });
    const unsupported = createSession(unsupportedRegistry);
    assert.equal(unsupported.entry.epoch, 1);

    setReviewerSessionRegistryTestHooks({
      directoryFsync: () => {
        throw Object.assign(new Error("durability failure"), { code: "EIO" });
      },
    });
    assert.throws(
      () => createSession(failingRegistry),
      /unable to synchronize reviewer session registry directory/,
    );
  } finally {
    setReviewerSessionRegistryTestHooks(undefined);
    rmSync(path.dirname(unsupportedRegistry), { recursive: true, force: true });
    rmSync(path.dirname(failingRegistry), { recursive: true, force: true });
  }
});

test("directory replacement between validation and atomic rename aborts without redirection", () => {
  const registryPath = registryDirectory();
  const movedPath = `${registryPath}-moved`;
  try {
    const created = createSession(registryPath);
    let replaced = false;
    setReviewerSessionRegistryTestHooks({
      beforeDirectoryOperation: (operation) => {
        if (!replaced && operation === "atomic-rename") {
          replaced = true;
          renameSync(registryPath, movedPath);
          mkdirSync(registryPath, { mode: 0o700 });
        }
      },
    });
    assert.throws(
      () => upsertReviewerSession({
        ...created.ids,
        providerSessionId: providerSessionId(),
        expectedEpoch: created.entry.epoch,
        successfulResume: true,
      }, { registryPath, now: new Date(Date.parse(START) + 1_000) }),
      /reviewer session registry directory changed/,
    );
    assert.deepEqual(readdirSync(registryPath), []);
    assert.equal(existsSync(path.join(movedPath, `${created.ids.key}.json`)), true);
  } finally {
    setReviewerSessionRegistryTestHooks(undefined);
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
    rmSync(movedPath, { recursive: true, force: true });
  }
});

test("cross-process update and close competition has one CAS winner and no inconsistent entry", async () => {
  const registryPath = registryDirectory();
  try {
    const created = createSession(registryPath);
    const startAt = Date.now() + 150;
    const results = await Promise.all([
      raceMutation("update", registryPath, created.ids, created.entry.epoch, startAt),
      raceMutation("close", registryPath, created.ids, created.entry.epoch, startAt),
    ]);
    assert.equal(results.filter((status) => status === "written" || status === "closed").length, 1);
    assert.equal(results.every((status) => ["written", "closed", "conflict"].includes(status)), true);
    const final = readReviewerSession(created.ids.key, {
      registryPath,
      now: new Date(Date.parse(START) + 1_001),
    });
    assert.equal(final.status === "available" || final.reason === "missing", true);
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  }
});

test("idle and absolute TTL boundaries are deterministic and shorter provider retention wins", () => {
  const registryPath = registryDirectory();
  try {
    const local = createSession(registryPath);
    const beforeIdle = evaluateReviewerSessionLifecycle(local.entry, {
      now: new Date(Date.parse(START) + 2 * HOUR - 1),
    });
    const atIdle = evaluateReviewerSessionLifecycle(local.entry, {
      now: new Date(Date.parse(START) + 2 * HOUR),
    });
    const afterIdle = evaluateReviewerSessionLifecycle(local.entry, {
      now: new Date(Date.parse(START) + 2 * HOUR + 1),
    });
    assert.equal(beforeIdle, "reusable");
    assert.equal(atIdle, "expired_idle");
    assert.equal(afterIdle, "expired_idle");
    assert.equal(local.entry.expires_at, new Date(Date.parse(START) + 12 * HOUR).toISOString());

    const providerRegistry = registryDirectory();
    const provider = createSession(providerRegistry, {
      providerRetentionMs: 5 * HOUR,
      providerSafetyMarginMs: HOUR,
    });
    assert.equal(provider.entry.expires_at, new Date(Date.parse(START) + 4 * HOUR).toISOString());
    const firstRefresh = upsertReviewerSession({
      ...provider.ids,
      providerSessionId: providerSessionId(),
      expectedEpoch: provider.entry.epoch,
      successfulResume: true,
    }, { registryPath: providerRegistry, now: new Date(Date.parse(START) + 1.5 * HOUR) });
    assert.equal(firstRefresh.status, "written");
    const refreshed = upsertReviewerSession({
      ...provider.ids,
      providerSessionId: providerSessionId(),
      expectedEpoch: firstRefresh.entry.epoch,
      successfulResume: true,
    }, { registryPath: providerRegistry, now: new Date(Date.parse(START) + 3 * HOUR) });
    assert.equal(refreshed.status, "written");
    assert.equal(evaluateReviewerSessionLifecycle(refreshed.entry, {
      now: new Date(Date.parse(START) + 4 * HOUR - 1),
    }), "reusable");
    assert.equal(evaluateReviewerSessionLifecycle(refreshed.entry, {
      now: new Date(Date.parse(START) + 4 * HOUR),
    }), "expired_absolute");
    assert.equal(evaluateReviewerSessionLifecycle(refreshed.entry, {
      now: new Date(Date.parse(START) + 4 * HOUR + 1),
    }), "expired_absolute");
    rmSync(path.dirname(providerRegistry), { recursive: true, force: true });
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  }
});

test("eight completed resumes remain valid state but the ninth reuse is refused", () => {
  const registryPath = registryDirectory();
  try {
    const created = createSession(registryPath);
    let entry = created.entry;
    for (let resume = 1; resume <= 8; resume += 1) {
      const result = upsertReviewerSession({
        ...created.ids,
        providerSessionId: providerSessionId(),
        expectedEpoch: entry.epoch,
        successfulResume: true,
      }, { registryPath, now: new Date(Date.parse(START) + resume * 1_000) });
      assert.equal(result.status, "written");
      entry = result.entry;
      assert.equal(entry.successful_resumes, resume);
    }
    assert.equal(evaluateReviewerSessionLifecycle(entry, { now: new Date(Date.parse(START) + 9_000) }), "resume_limit");
    const ninth = upsertReviewerSession({
      ...created.ids,
      providerSessionId: providerSessionId(),
      expectedEpoch: entry.epoch,
      successfulResume: true,
    }, { registryPath, now: new Date(Date.parse(START) + 9_000) });
    assert.equal(ninth.status, "conflict");
    assert.equal(ninth.reason, "resume_limit");
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  }
});

test("purge removes expired, corrupt, and temporary artifacts without following symlinks or unrelated files", () => {
  const registryPath = registryDirectory();
  const outsideDirectory = mkdtempSync(path.join(os.tmpdir(), "agentmesh-session-gc-outside-"));
  const outside = path.join(outsideDirectory, "outside.json");
  try {
    const created = createSession(registryPath);
    const corruptKey = "rk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    writeFileSync(path.join(registryPath, `${corruptKey}.json`), "not-json", { mode: 0o600 });
    writeFileSync(path.join(registryPath, `.${created.ids.key}.orphan.tmp`), "partial", { mode: 0o600 });
    writeFileSync(path.join(registryPath, "unrelated.txt"), "keep", { mode: 0o600 });
    writeFileSync(outside, "outside", { mode: 0o600 });
    symlinkSync(outside, path.join(registryPath, "rk-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json"));

    const result = purgeReviewerSessions({
      registryPath,
      now: new Date(Date.parse(START) + 12 * HOUR),
    });
    assert.equal(result.status, "purged");
    assert.equal(result.removed, 2);
    assert.equal(existsSync(path.join(registryPath, `${created.ids.key}.json`)), false);
    assert.equal(existsSync(path.join(registryPath, `${corruptKey}.json`)), false);
    assert.equal(existsSync(path.join(registryPath, `.${created.ids.key}.orphan.tmp`)), true);
    assert.equal(readFileSync(path.join(registryPath, "unrelated.txt"), "utf-8"), "keep");
    assert.equal(lstatSync(path.join(registryPath, "rk-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json")).isSymbolicLink(), true);
    assert.equal(readFileSync(outside, "utf-8"), "outside");
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
    rmSync(outsideDirectory, { recursive: true, force: true });
  }
});

test("purge removes only dead stale registry temps while preserving active and unrelated files", () => {
  const registryPath = registryDirectory();
  try {
    const active = createSession(registryPath);
    const activeTemp = path.join(
      registryPath,
      `.${active.ids.key}.json.${process.pid}.${"b".repeat(24)}.tmp`,
    );
    writeFileSync(activeTemp, "active", { mode: 0o600 });
    utimesSync(activeTemp, new Date(0), new Date(0));
    const liveLock = writeMutationLock(registryPath, active.ids.key, process.pid);

    const orphanIds = identity({ worktreeId: "wt-orphanorphanorph" });
    const orphanTemp = path.join(
      registryPath,
      `.${orphanIds.key}.epoch.json.99999999.${"c".repeat(24)}.tmp`,
    );
    writeFileSync(orphanTemp, "orphan", { mode: 0o600 });
    utimesSync(orphanTemp, new Date(0), new Date(0));

    const unrelated = path.join(registryPath, `.${orphanIds.key}.json.123.not-a-registry-nonce.tmp`);
    writeFileSync(unrelated, "unrelated", { mode: 0o600 });

    const purged = purgeReviewerSessions({ registryPath, now: new Date() });
    assert.equal(purged.status, "purged");
    assert.equal(existsSync(activeTemp), true);
    assert.equal(existsSync(liveLock), true);
    assert.equal(existsSync(unrelated), true);
    assert.equal(existsSync(orphanTemp), false);
  } finally {
    rmSync(path.dirname(registryPath), { recursive: true, force: true });
  }
});

test("context headroom validates inputs and uses exact 60 percent warning and 80 percent rotation thresholds", () => {
  const base = { currentPacket: 100, reservedOutput: 100, reasoningHeadroom: 100, providerLimit: 1_000 };
  assert.equal(shouldRotateForContext({ ...base, estimatedHistory: 299 }), "keep");
  assert.equal(shouldRotateForContext({ ...base, estimatedHistory: 300 }), "warn");
  assert.equal(shouldRotateForContext({ ...base, estimatedHistory: 499 }), "warn");
  assert.equal(shouldRotateForContext({ ...base, estimatedHistory: 500 }), "rotate");
  assert.equal(shouldRotateForContext({ estimatedHistory: 1_000_000, currentPacket: 0, reservedOutput: 0, reasoningHeadroom: 0 }), "keep");
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.throws(() => shouldRotateForContext({ ...base, estimatedHistory: invalid }), /non-negative finite/);
  }
});
