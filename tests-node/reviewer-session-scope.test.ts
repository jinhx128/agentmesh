import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveHostScope } from "../packages/runtime/src/reviewer-sessions/scope.js";

const SCOPE_TOKEN = "amscope_v1:11111111-1111-4111-8111-111111111111";

function makeRepository(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agentmesh-reviewer-scope-"));
  execFileSync("git", ["init"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "scope@example.test"], { cwd: directory });
  execFileSync("git", ["config", "user.name", "Scope Test"], { cwd: directory });
  execFileSync("git", ["commit", "--allow-empty", "-m", "initial"], { cwd: directory });
  return directory;
}

function scopeKeyPath(parent: string): string {
  return path.join(parent, ".config", "agentmesh", "reviewer-session-scope.key");
}

test("native host identity takes precedence without exposing native or propagated input", () => {
  const repository = makeRepository();
  const keyParent = mkdtempSync(path.join(os.tmpdir(), "agentmesh-reviewer-key-"));
  const nativeId = "provider-native-conversation-4c9b2a";
  try {
    const resolved = resolveHostScope({
      hostKind: "codex",
      nativeConversationId: nativeId,
      propagatedScopeToken: SCOPE_TOKEN,
    }, repository, { hmacKeyPath: scopeKeyPath(keyParent) });

    const serialized = JSON.stringify(resolved);
    assert.equal(resolved.host_kind, "codex");
    assert.equal(resolved.scope_source, "native");
    assert.match(resolved.conversation_scope_ref ?? "", /^cs-[a-f0-9]{16}$/);
    assert.doesNotMatch(serialized, new RegExp(nativeId));
    assert.doesNotMatch(serialized, new RegExp(SCOPE_TOKEN));
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(keyParent, { recursive: true, force: true });
  }
});

test("a valid propagated token produces a stable ref while invalid or missing tokens stay fresh", () => {
  const repository = makeRepository();
  const keyParent = mkdtempSync(path.join(os.tmpdir(), "agentmesh-reviewer-key-"));
  try {
    const options = { hmacKeyPath: scopeKeyPath(keyParent) };
    const first = resolveHostScope({ hostKind: "cursor", propagatedScopeToken: SCOPE_TOKEN }, repository, options);
    const second = resolveHostScope({ hostKind: "cursor", propagatedScopeToken: SCOPE_TOKEN }, repository, options);
    const invalid = resolveHostScope({ hostKind: "cursor", propagatedScopeToken: "amscope_v1:not-a-uuid" }, repository, options);
    const missing = resolveHostScope({ hostKind: "not-a-host" }, repository, options);

    assert.equal(first.scope_source, "propagated");
    assert.equal(first.conversation_scope_ref, second.conversation_scope_ref);
    assert.match(first.conversation_scope_ref ?? "", /^cs-[a-f0-9]{16}$/);
    assert.doesNotMatch(JSON.stringify(first), new RegExp(SCOPE_TOKEN));
    assert.deepEqual(
      { host_kind: invalid.host_kind, scope_source: invalid.scope_source, conversation_scope_ref: invalid.conversation_scope_ref },
      { host_kind: "cursor", scope_source: "missing", conversation_scope_ref: undefined },
    );
    assert.equal(missing.host_kind, "unknown");
    assert.equal(missing.scope_source, "missing");
    assert.equal(missing.conversation_scope_ref, undefined);
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(keyParent, { recursive: true, force: true });
  }
});

test("scope key is user-only, outside the checkout, and stable when reused", () => {
  const repository = makeRepository();
  const keyParent = mkdtempSync(path.join(os.tmpdir(), "agentmesh-reviewer-key-"));
  const keyPath = scopeKeyPath(keyParent);
  try {
    const first = resolveHostScope({ hostKind: "codex", nativeConversationId: "native-a" }, repository, { hmacKeyPath: keyPath });
    const initialKey = readFileSync(keyPath);
    const second = resolveHostScope({ hostKind: "codex", nativeConversationId: "native-a" }, repository, { hmacKeyPath: keyPath });

    assert.equal(first.conversation_scope_ref, second.conversation_scope_ref);
    assert.deepEqual(readFileSync(keyPath), initialKey);
    assert.equal(path.relative(repository, keyPath).startsWith(".."), true);
    assert.equal(statSync(keyPath).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(keyPath)).mode & 0o777, 0o700);
    assert.equal(lstatSync(keyPath).isSymbolicLink(), false);
    assert.doesNotMatch(JSON.stringify(first), /native-a/);
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(keyParent, { recursive: true, force: true });
  }
});

test("a symlinked checkout has the same canonical workspace and worktree identities", () => {
  const repository = makeRepository();
  const linkParent = mkdtempSync(path.join(os.tmpdir(), "agentmesh-reviewer-link-"));
  const keyParent = mkdtempSync(path.join(os.tmpdir(), "agentmesh-reviewer-key-"));
  const link = path.join(linkParent, "checkout");
  symlinkSync(repository, link);
  try {
    const options = { hmacKeyPath: scopeKeyPath(keyParent) };
    const direct = resolveHostScope({}, repository, options);
    const throughLink = resolveHostScope({}, link, options);

    assert.equal(direct.workspace_id, throughLink.workspace_id);
    assert.equal(direct.worktree_id, throughLink.worktree_id);
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(linkParent, { recursive: true, force: true });
    rmSync(keyParent, { recursive: true, force: true });
  }
});

test("linked worktrees share a workspace identity but remain worktree-isolated", () => {
  const repository = makeRepository();
  const worktreeParent = mkdtempSync(path.join(os.tmpdir(), "agentmesh-reviewer-worktree-"));
  const linkedWorktree = path.join(worktreeParent, "linked");
  const keyParent = mkdtempSync(path.join(os.tmpdir(), "agentmesh-reviewer-key-"));
  execFileSync("git", ["worktree", "add", "-b", "reviewer-scope-linked", linkedWorktree], { cwd: repository });
  try {
    const options = { hmacKeyPath: scopeKeyPath(keyParent) };
    const main = resolveHostScope({}, repository, options);
    const linked = resolveHostScope({}, linkedWorktree, options);

    assert.equal(main.workspace_id, linked.workspace_id);
    assert.notEqual(main.worktree_id, linked.worktree_id);
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", linkedWorktree], { cwd: repository });
    rmSync(repository, { recursive: true, force: true });
    rmSync(worktreeParent, { recursive: true, force: true });
    rmSync(keyParent, { recursive: true, force: true });
  }
});
