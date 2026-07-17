import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  reviewerSessionInvocationFingerprint,
  reviewerSessionRef,
  readReviewerSession,
  sessionRegistryKey,
  upsertReviewerSession,
} from "../packages/runtime/src/reviewer-sessions/registry.js";
import { makeWorkspace, runCli } from "./helpers/write-side-runtime.js";

const SCOPE = "cs-1111111111111111";
const SECRET = "provider-native-session-secret";

function registryPath(workspace: string): string {
  return path.join(workspace, ".home", ".config", "agentmesh", "reviewer-sessions");
}

function seedSession(workspace: string, overrides: {
  scopeRef?: string;
  reviewerId?: string;
  now?: string;
  summaryOverride?: Partial<{ scopeRef: string; hostKind: string; reviewerId: string; mode: string }>;
} = {}) {
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
  const scopeRef = overrides.scopeRef ?? SCOPE;
  const reviewerId = overrides.reviewerId ?? "architecture-reviewer";
  const key = sessionRegistryKey({
    conversationScopeRef: scopeRef,
    workspaceId: "ws-2222222222222222",
    worktreeId: "wt-3333333333333333",
    agentId: reviewerId,
    adapterId: "provider",
    model: "review-model",
    reasoningEffort: "high",
    invocation,
  });
  const result = upsertReviewerSession({
    key,
    sessionRef: reviewerSessionRef(key),
    providerSessionId: SECRET,
    invocationFingerprint: reviewerSessionInvocationFingerprint(invocation),
    summary: {
      scopeRef,
      hostKind: "codex",
      reviewerId,
      mode: "interactive_continuous",
      ...overrides.summaryOverride,
    },
  }, { registryPath: registryPath(workspace), now: overrides.now ?? "2026-07-17T00:00:00.000Z" });
  assert.equal(result.status, "written");
  return { key, sessionRef: result.entry.session_ref };
}

function assertRedacted(output: string): void {
  assert.doesNotMatch(output, new RegExp(SECRET));
  assert.doesNotMatch(output, /provider_session_id|registry_key|owner_token|raw_entry/i);
  assert.doesNotMatch(output, /rk-[a-f0-9]{32}/);
}

test("sessions scope create emits an unpersisted RFC4122 propagation token", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const result = runCli(workspace, ["sessions", "scope", "create", "--host", "codex", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as { host: string; correlation_token: string };
  assert.equal(payload.host, "codex");
  assert.match(payload.correlation_token, /^amscope_v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(existsSync(registryPath(workspace)), false);
  assertRedacted(result.stdout + result.stderr);
});

test("sessions list and inspect expose only safe summaries", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const seeded = seedSession(workspace);

  const listed = runCli(workspace, ["sessions", "list", "--json"]);
  assert.equal(listed.status, 0, listed.stderr);
  const listPayload = JSON.parse(listed.stdout) as { sessions: Array<Record<string, unknown>> };
  assert.equal(listPayload.sessions.length, 1);
  assert.deepEqual(Object.keys(listPayload.sessions[0]).sort(), [
    "created_at", "epoch", "expires_at", "host", "last_used_at", "mode", "resume_count", "reviewer", "scope_ref", "session_ref",
  ]);
  assert.equal(listPayload.sessions[0].session_ref, seeded.sessionRef);

  const inspected = runCli(workspace, ["sessions", "inspect", seeded.sessionRef, "--json"]);
  assert.equal(inspected.status, 0, inspected.stderr);
  const inspectPayload = JSON.parse(inspected.stdout) as { session: Record<string, unknown> };
  assert.equal(inspectPayload.session.session_ref, seeded.sessionRef);
  assert.equal(inspectPayload.session.scope_ref, SCOPE);
  assertRedacted(listed.stdout + listed.stderr + inspected.stdout + inspected.stderr);
});

test("sessions close by ref and scope is idempotent and epoch-safe", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const first = seedSession(workspace);
  const second = seedSession(workspace, { reviewerId: "security-reviewer" });

  const one = runCli(workspace, ["sessions", "close", first.sessionRef, "--json"]);
  assert.equal(one.status, 0, one.stderr);
  assert.equal((JSON.parse(one.stdout) as { closed: number }).closed, 1);
  const retry = runCli(workspace, ["sessions", "close", first.sessionRef, "--json"]);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal((JSON.parse(retry.stdout) as { closed: number }).closed, 0);
  const scope = runCli(workspace, ["sessions", "close", "--scope", SCOPE, "--json"]);
  assert.equal(scope.status, 0, scope.stderr);
  assert.equal((JSON.parse(scope.stdout) as { closed: number }).closed, 1);
  assertRedacted(one.stdout + one.stderr + retry.stdout + retry.stderr + scope.stdout + scope.stderr);

  const missing = runCli(workspace, ["sessions", "inspect", second.sessionRef, "--json"]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr.trim(), "reviewer session not found");

  const managementFiles = readdirSync(registryPath(workspace)).filter((name) => name.includes("management"));
  assert.ok(managementFiles.length >= 2);
  const management = managementFiles.map((name) => readFileSync(path.join(registryPath(workspace), name), "utf-8")).join("\n");
  assert.doesNotMatch(management, new RegExp(SECRET));
  assert.doesNotMatch(management, /rk-[a-f0-9]{32}|provider_session_id|native_id/);
});

test("sessions close distinguishes never-seen references and scopes from idempotent retries", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const unknownRef = runCli(workspace, ["sessions", "close", "rs-aaaaaaaaaaaaaaaa", "--json"]);
  assert.equal(unknownRef.status, 1);
  assert.equal(unknownRef.stderr.trim(), "reviewer session not found");
  const unknownScope = runCli(workspace, ["sessions", "close", "--scope", "cs-aaaaaaaaaaaaaaaa", "--json"]);
  assert.equal(unknownScope.status, 1);
  assert.equal(unknownScope.stderr.trim(), "reviewer session scope not found");

  const seeded = seedSession(workspace);
  assert.equal(runCli(workspace, ["sessions", "close", seeded.sessionRef]).status, 0);
  const refRetry = runCli(workspace, ["sessions", "close", seeded.sessionRef, "--json"]);
  assert.equal(refRetry.status, 0, refRetry.stderr);
  assert.equal((JSON.parse(refRetry.stdout) as { closed: number }).closed, 0);
  const scopeRetry = runCli(workspace, ["sessions", "close", "--scope", SCOPE, "--json"]);
  assert.equal(scopeRetry.status, 0, scopeRetry.stderr);
  assert.equal((JSON.parse(scopeRetry.stdout) as { closed: number }).closed, 0);
});

test("scope close never falls back to old entries without safe scope metadata", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const invocation = {
    command: "provider", args: ["review"], capabilities: ["resume"], permissionMode: "read-only",
    contextMode: "packet", reviewerPersonaVersion: "v1", promptSchemaVersion: "v1",
    adapterPluginVersion: "v1", providerCliVersion: "v1", environmentVariableNames: ["PATH"],
  };
  const key = sessionRegistryKey({
    conversationScopeRef: SCOPE, workspaceId: "ws-2222222222222222", worktreeId: "wt-3333333333333333",
    agentId: "legacy-reviewer", adapterId: "provider", model: "review-model", reasoningEffort: "high", invocation,
  });
  const created = upsertReviewerSession({
    key, sessionRef: reviewerSessionRef(key), providerSessionId: SECRET,
    invocationFingerprint: reviewerSessionInvocationFingerprint(invocation),
  }, { registryPath: registryPath(workspace) });
  assert.equal(created.status, "written");

  const result = runCli(workspace, ["sessions", "close", "--scope", SCOPE]);
  assert.equal(result.status, 1);
  assert.equal(readReviewerSession(key, { registryPath: registryPath(workspace) }).status, "available");
});

test("safe summary rejects open-ended host mode reviewer and CLI re-projects persisted fields", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const invalidValues = [
    { hostKind: "codex\nINJECT" },
    { mode: "resume-everything" },
    { reviewerId: "provider-session-secret" },
  ];
  for (const [index, summaryOverride] of invalidValues.entries()) {
    assert.throws(
      () => seedSession(workspace, { reviewerId: `reviewer-${index}`, summaryOverride }),
      /reviewer session summary is invalid/,
    );
  }

  const seeded = seedSession(workspace);
  const entryPath = path.join(registryPath(workspace), `${seeded.key}.json`);
  const entry = JSON.parse(readFileSync(entryPath, "utf-8"));
  writeFileSync(entryPath, JSON.stringify({ ...entry, host_kind: "codex\nINJECT" }), { mode: 0o600 });
  const listed = runCli(workspace, ["sessions", "list", "--json"]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.doesNotMatch(listed.stdout + listed.stderr, /INJECT/);
});

test("sessions purge removes only expired, exhausted, or corrupt safe candidates", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  seedSession(workspace, { now: "2000-01-01T00:00:00.000Z" });
  const dir = registryPath(workspace);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, "unrelated.txt"), "keep", { mode: 0o600 });

  const result = runCli(workspace, ["sessions", "purge", "--expired", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok((JSON.parse(result.stdout) as { removed: number }).removed >= 1);
  assert.equal(readFileSync(path.join(dir, "unrelated.txt"), "utf-8"), "keep");
  assertRedacted(result.stdout + result.stderr);
});

test("sessions validation and unknown references use safe exit conventions", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const invalid = "provider-native-session-secret";
  for (const args of [
    ["sessions", "scope", "create", "--host", "unsupported"],
    ["sessions", "inspect", invalid],
    ["sessions", "close", invalid],
    ["sessions", "close", "--scope", invalid],
    ["sessions", "purge"],
  ]) {
    const result = runCli(workspace, args);
    assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    assertRedacted(result.stdout + result.stderr);
    assert.doesNotMatch(result.stderr, new RegExp(invalid));
  }

  const unknown = runCli(workspace, ["sessions", "inspect", "rs-aaaaaaaaaaaaaaaa"]);
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stderr.trim(), "reviewer session not found");
});

test("sessions help documents every lifecycle command", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const help = runCli(workspace, ["help", "sessions"]);
  assert.equal(help.status, 0, help.stderr);
  for (const command of ["scope create", "list", "inspect", "close", "purge --expired"]) {
    assert.match(help.stderr, new RegExp(command.replace(" ", "\\s+")));
  }
});
