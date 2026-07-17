import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const workspace = process.cwd();
const runtimeRoot = path.join(workspace, "dist-node", "packages", "runtime", "src");
const cliPath = path.join(workspace, "dist-node", "packages", "cli", "src", "cli.js");
const scope = await import(path.join(runtimeRoot, "reviewer-sessions", "scope.js"));
const registry = await import(path.join(runtimeRoot, "reviewer-sessions", "registry.js"));
const lease = await import(path.join(runtimeRoot, "reviewer-sessions", "lease.js"));

const disposableRoot = mkdtempSync(path.join(os.tmpdir(), "agentmesh-task-10-manual-"));
const repository = path.join(disposableRoot, "repository");
const linkedWorktree = path.join(disposableRoot, "linked-worktree");
const disposableHome = path.join(disposableRoot, "home");
const scopeKeyPath = path.join(disposableHome, ".config", "agentmesh", "reviewer-session-scope.key");
const registryPath = path.join(disposableHome, ".config", "agentmesh", "reviewer-sessions");

let evidence;
let cleanupCompleted = false;

function ensure(condition) {
  if (!condition) throw new Error("manual verification assertion failed");
}

function runGit(args) {
  execFileSync("git", args, { stdio: "ignore" });
}

function runCli(args) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: repository,
    env: { ...process.env, HOME: disposableHome },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

try {
  mkdirSync(repository, { recursive: true, mode: 0o700 });
  mkdirSync(disposableHome, { recursive: true, mode: 0o700 });
  runGit(["init", "-q", repository]);
  runGit(["-C", repository, "config", "user.email", "task-10@example.invalid"]);
  runGit(["-C", repository, "config", "user.name", "Task 10 verifier"]);
  writeFileSync(path.join(repository, "README.md"), "disposable\n", { mode: 0o600 });
  runGit(["-C", repository, "add", "README.md"]);
  runGit(["-C", repository, "commit", "-q", "-m", "disposable"]);
  runGit(["-C", repository, "worktree", "add", "-q", "-b", "task-10-linked", linkedWorktree, "HEAD"]);

  const propagatedTokens = [
    `amscope_v1:${randomUUID()}`,
    `amscope_v1:${randomUUID()}`,
  ];
  const resolved = propagatedTokens.flatMap((propagatedScopeToken) => [repository, linkedWorktree].map((cwd) => (
    scope.resolveHostScope(
      { hostKind: "codex", propagatedScopeToken },
      cwd,
      { hmacKeyPath: scopeKeyPath },
    )
  )));
  ensure(resolved.every((item) => item.scope_source === "propagated"));
  ensure(new Set(resolved.map((item) => item.workspace_id)).size === 1);
  ensure(new Set(resolved.map((item) => item.worktree_id)).size === 2);
  ensure(new Set(resolved.map((item) => item.conversation_scope_ref)).size === 2);

  const invocation = {
    command: "disposable-provider",
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
  const registryKeys = [];
  const sessionRefs = [];
  const providerSessionIds = [];
  for (const [index, item] of resolved.entries()) {
    const key = registry.sessionRegistryKey({
      conversationScopeRef: item.conversation_scope_ref,
      workspaceId: item.workspace_id,
      worktreeId: item.worktree_id,
      agentId: `reviewer-${index}`,
      adapterId: "disposable-provider",
      model: "disposable-model",
      reasoningEffort: "high",
      invocation,
    });
    const sessionRef = registry.reviewerSessionRef(key);
    const providerSessionId = `native-${randomBytes(24).toString("hex")}`;
    const written = registry.upsertReviewerSession({
      key,
      sessionRef,
      providerSessionId,
      invocationFingerprint: registry.reviewerSessionInvocationFingerprint(invocation),
      summary: {
        scopeRef: item.conversation_scope_ref,
        hostKind: "codex",
        reviewerId: `reviewer-${index}`,
        mode: "interactive_continuous",
      },
    }, { registryPath, now: "2026-07-18T00:00:00.000Z" });
    ensure(written.status === "written");
    registryKeys.push(key);
    sessionRefs.push(sessionRef);
    providerSessionIds.push(providerSessionId);
  }
  ensure(new Set(registryKeys).size === 4);
  ensure(new Set(sessionRefs).size === 4);

  const humanList = runCli(["sessions", "list"]);
  const jsonList = runCli(["sessions", "list", "--json"]);
  const humanInspect = runCli(["sessions", "inspect", sessionRefs[0]]);
  const jsonInspect = runCli(["sessions", "inspect", sessionRefs[0], "--json"]);
  const combinedOutput = [humanList, jsonList, humanInspect, jsonInspect].join("\n");
  const forbiddenValues = [...propagatedTokens, ...providerSessionIds, ...registryKeys];
  ensure(forbiddenValues.every((value) => !combinedOutput.includes(value)));
  ensure(!/provider_session_id|registry_key|owner_token|raw_entry/i.test(combinedOutput));

  const listPayload = JSON.parse(jsonList);
  const inspectPayload = JSON.parse(jsonInspect);
  ensure(Array.isArray(listPayload.sessions) && listPayload.sessions.length === 4);
  ensure(Object.keys(inspectPayload.session).length === 10);
  ensure(listPayload.sessions.every((item) => Object.keys(item).length === 10));
  ensure(JSON.stringify(lease.REVIEWER_SESSION_LOCK_ORDER) === JSON.stringify([
    "run-mutation", "entry-lease", "provider-spawn",
  ]));

  evidence = {
    completed: true,
    canonical_repository_identity_shared: true,
    worktree_identities_distinct: true,
    propagated_scope_references_distinct: true,
    derived_registry_key_count: new Set(registryKeys).size,
    derived_session_reference_count: new Set(sessionRefs).size,
    human_projection_count: 2,
    json_projection_count: 2,
    json_safe_field_count: 10,
    forbidden_value_match_count: 0,
    lock_order_contract_passed: true,
    real_user_state_read: false,
  };
} catch {
  evidence = { completed: false };
  process.exitCode = 1;
} finally {
  rmSync(disposableRoot, { recursive: true, force: true });
  cleanupCompleted = !existsSync(disposableRoot);
}

process.stdout.write(`${JSON.stringify({ ...evidence, cleanup_completed: cleanupCompleted }, null, 2)}\n`);
