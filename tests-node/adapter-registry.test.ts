import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { listAdapters } from "../packages/runtime/src/adapters.js";
import {
  isAiCliRuntimeAdapter,
  listRuntimeAdapters,
  lookupRuntimeAdapter,
  normalizeRuntimeAdapterId,
} from "../packages/runtime/src/adapters/registry.js";

test("runtime adapter registry looks up built-in adapters by id", () => {
  const codex = lookupRuntimeAdapter("codex-cli");

  assert.equal(codex.id, "codex-cli");
  assert.equal(codex.command, "codex");
  assert.deepEqual(codex.args, ["exec"]);
  assert.equal(codex.label, "Codex CLI");
});

test("runtime adapter registry normalizes public aliases", () => {
  assert.equal(normalizeRuntimeAdapterId("codex"), "codex-cli");
  assert.equal(normalizeRuntimeAdapterId("claude"), "claude-code-cli");
  assert.equal(normalizeRuntimeAdapterId("cursor"), "cursor-agent");
  assert.equal(normalizeRuntimeAdapterId("antigravity"), "antigravity-cli");
  assert.equal(normalizeRuntimeAdapterId("opencode"), "opencode-cli");
  assert.equal(normalizeRuntimeAdapterId("gemini"), "gemini");
  assert.equal(lookupRuntimeAdapter("cursor").label, "Cursor Agent");
  assert.equal(lookupRuntimeAdapter("antigravity").label, "Antigravity CLI");
  assert.equal(lookupRuntimeAdapter("opencode").label, "OpenCode CLI");
});

test("runtime adapter registry rejects unsupported adapters", () => {
  assert.throws(
    () => lookupRuntimeAdapter("missing-cli"),
    /unknown adapter: missing-cli/,
  );
});

test("runtime adapter registry exposes capability metadata", () => {
  const adapters = listRuntimeAdapters();
  assert.deepEqual(
    adapters.map((adapter) => adapter.id),
    ["antigravity-cli", "claude-code-cli", "codex-cli", "command", "cursor-agent", "opencode-cli"],
  );

  const command = lookupRuntimeAdapter("command");
  assert.equal(command.capabilities.supports_non_interactive, undefined);
  assert.deepEqual(command.capabilities.roles, ["planner", "worker", "verifier", "reviewer", "decider"]);
  assert.deepEqual(command.capabilities.stages, ["plan", "execute", "verify", "review", "decide"]);

  const antigravity = lookupRuntimeAdapter("antigravity-cli");
  assert.equal(antigravity.capabilities.supports_non_interactive, true);
  assert.equal(antigravity.capabilities.roles.includes("verifier"), true);
  assert.equal(antigravity.capabilities.stages.includes("verify"), true);
  assert.equal(antigravity.capabilities.stages.includes("review"), true);
  assert.equal(isAiCliRuntimeAdapter("antigravity-cli"), true);
  assert.equal(isAiCliRuntimeAdapter("gemini-cli"), false);
  assert.equal(isAiCliRuntimeAdapter("cursor-agent"), true);
  assert.equal(isAiCliRuntimeAdapter("command"), false);
});

test("legacy adapter surface is backed by the runtime registry", () => {
  assert.deepEqual(
    listAdapters().map((adapter) => adapter.name),
    listRuntimeAdapters().map((adapter) => adapter.id),
  );

  const source = readFileSync(
    path.join(process.cwd(), "packages", "runtime", "src", "adapters.ts"),
    "utf-8",
  );
  assert.doesNotMatch(source, /BUILTIN_ADAPTERS/);
  assert.match(source, /lookupRuntimeAdapter/);
});
