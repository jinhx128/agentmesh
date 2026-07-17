import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  reviewerSessionInvocationFingerprint,
  reviewerSessionRef,
  sessionRegistryKey,
  upsertReviewerSession,
} from "../packages/runtime/src/reviewer-sessions/registry.js";
import { makeWorkspace, runCli } from "./helpers/write-side-runtime.js";

const SCOPE = "cs-1111111111111111";
const SECRET = "provider-native-session-secret";

function registryPath(workspace: string): string {
  return path.join(workspace, ".home", ".config", "agentmesh", "reviewer-sessions");
}

function seedSession(workspace: string, overrides: { scopeRef?: string; reviewerId?: string; now?: string } = {}) {
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
