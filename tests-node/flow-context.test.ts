import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import * as contextPackModule from "../packages/runtime/src/flow/context-pack.js";
import {
  fakeServerPath,
  makeWorkspace,
  runCli,
  writeConfig,
  writeExecutable,
} from "./helpers/write-side-runtime.js";

test("workflow run creates dynamic stage packets with context inputs", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[mcp_servers.docs]",
      'command = "docs-mcp"',
      "args = []",
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(workspace, "notes.md"), "Important implementation note.\n");
  writeFileSync(path.join(workspace, "diff.txt"), "diff --git a/a.ts b/a.ts\n+ok\n");
  writeFileSync(path.join(workspace, "verify.txt"), "npm test\n47 passed\n");

  const run = runCli(workspace, [
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "current",
    "--decide",
    "current",
    "--context-file",
    "notes.md",
    "--diff-file",
    "diff.txt",
    "--verification-file",
    "verify.txt",
    "--mcp-resource",
    "docs:file:///missing.md",
    "--task",
    "Plan a safe change",
    "--run-id",
    "context-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "context-flow", "status.json"), "utf-8"),
  );
  assert.deepEqual(status.stages, ["plan", "decide"]);
  assert.deepEqual(status.stage_assignments, {
    plan: ["current"],
    decide: ["current"],
  });
  assert.equal(status.execute, undefined);
  assert.equal(status.review, undefined);
  assert.equal(typeof status.context_bytes, "number");
  assert.ok(status.context_bytes > 0);

  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "context-flow", "context.md"),
    "utf-8",
  );
  assert.match(context, /Important implementation note/);
  assert.match(context, /source_type = "file"/);
  assert.match(context, /source_type = "diff_file"/);
  assert.match(context, /source_type = "verification_file"/);
  assert.match(context, /source_type = "mcp_resource"/);
  assert.match(context, /validation_state = "failed"/);
  assert.match(context, /ingestion_error = "server_start_failed: /);
  assert.match(context, /47 passed/);

  const validate = runCli(workspace, ["packet", "validate", "context-flow", "--json"]);
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(JSON.parse(validate.stdout).ok, true);

  const flowStatus = runCli(workspace, ["flow", "status", "context-flow", "--json"]);
  assert.equal(flowStatus.status, 0, flowStatus.stderr);
  assert.equal(JSON.parse(flowStatus.stdout).context_bytes, status.context_bytes);
});

test("workflow run captures MCP text resources into context", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[mcp_servers.docs]",
      `command = ${JSON.stringify(process.execPath)}`,
      `args = ${JSON.stringify([fakeServerPath])}`,
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "current",
    "--decide",
    "current",
    "--mcp-resource",
    "docs:memory://hello",
    "--task",
    "Read MCP context",
    "--run-id",
    "mcp-context-success",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "mcp-context-success", "context.md"),
    "utf-8",
  );
  assert.match(context, /source_type = "mcp_resource"/);
  assert.match(context, /source = "docs:memory:\/\/hello"/);
  assert.match(context, /source_uri = "memory:\/\/hello"/);
  assert.match(context, /validation_state = "ok"/);
  assert.match(context, /ingestion_error = null/);
  assert.match(context, /Hello from fake MCP: memory:\/\/hello/);
  assert.doesNotMatch(context, /mcp resource not captured/);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "mcp-context-success", "status.json"), "utf-8"),
  );
  assert.equal(typeof status.runtime_timing.mcp_connect_ms, "number");
  assert.equal(status.runtime_timing.mcp_cache_hits ?? 0, 0);
  assert.equal(status.runtime_timing.mcp_cache_misses, 1);
  assert.equal(typeof status.runtime_timing.total_ms, "number");

  const validate = runCli(workspace, ["packet", "validate", "mcp-context-success", "--json"]);
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(JSON.parse(validate.stdout).ok, true);
});

test("workflow run preserves successful MCP resources when a sibling resource fails", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[mcp_servers.docs]",
      `command = ${JSON.stringify(process.execPath)}`,
      `args = ${JSON.stringify([fakeServerPath, "--resource-not-found-uri", "memory://missing"])}`,
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--mcp-resource",
    "docs:memory://ok",
    "--mcp-resource",
    "docs:memory://missing",
    "--task",
    "Preserve partial MCP context",
    "--run-id",
    "mcp-context-partial",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "mcp-context-partial", "context.md"),
    "utf-8",
  );
  assert.match(context, /Hello from fake MCP: memory:\/\/ok/);
  assert.match(context, /source_uri = "memory:\/\/ok"[\s\S]*validation_state = "ok"/);
  assert.match(context, /source_uri = "memory:\/\/missing"[\s\S]*validation_state = "failed"/);
});

test("workflow run keeps failed MCP provenance when resource read fails", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[mcp_servers.docs]",
      `command = ${JSON.stringify(process.execPath)}`,
      `args = ${JSON.stringify([fakeServerPath, "--resource-not-found"])}`,
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "current",
    "--decide",
    "current",
    "--mcp-resource",
    "docs:memory://missing",
    "--task",
    "Keep failed MCP context visible",
    "--run-id",
    "mcp-context-failure",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "mcp-context-failure", "context.md"),
    "utf-8",
  );
  assert.match(context, /source_type = "mcp_resource"/);
  assert.match(context, /source_uri = "memory:\/\/missing"/);
  assert.match(context, /validation_state = "failed"/);
  assert.match(context, /ingestion_error = "resource_not_found: /);
  assert.match(context, /\(mcp resource unavailable\)/);

  const validate = runCli(workspace, ["packet", "validate", "mcp-context-failure", "--json"]);
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(JSON.parse(validate.stdout).ok, true);
});

test("workflow run includes project spec facts with provenance", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeProjectSpec(workspace);

  const run = runCli(workspace, [
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "current",
    "--decide",
    "current",
    "--include-spec",
    "--task",
    "Use project facts",
    "--run-id",
    "project-spec-context",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "project-spec-context", "context.md"),
    "utf-8",
  );
  assert.match(context, /## Project Spec/);
  assert.match(context, /source_type = "project_spec"/);
  assert.match(context, /source = "\.agentmesh\/spec\/project\.toml"/);
  assert.match(context, /validation_state = "ok"/);
  assert.match(context, /freshness = "fresh"/);
  assert.match(context, /owner = "AgentMesh maintainers"/);
  assert.match(context, /Project: AgentMesh/);
  assert.match(context, /- test: `npm test`/);
  assert.match(context, /Run packets remain the source of truth/);

  const validate = runCli(workspace, ["packet", "validate", "project-spec-context", "--json"]);
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(JSON.parse(validate.stdout).ok, true);
});

test("workflow run keeps failed project spec provenance visible", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const run = runCli(workspace, [
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "current",
    "--decide",
    "current",
    "--include-spec",
    "--task",
    "Missing project facts stay visible",
    "--run-id",
    "project-spec-context-missing",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "project-spec-context-missing", "context.md"),
    "utf-8",
  );
  assert.match(context, /source_type = "project_spec"/);
  assert.match(context, /validation_state = "failed"/);
  assert.match(context, /ingestion_error = "project spec not found: /);
  assert.match(context, /\(project spec unavailable\)/);
});

test("workflow run includes active corrections with provenance and explicit exclusions", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const docsCorrection = runCli(workspace, [
    "correction",
    "add",
    "--id",
    "docs-active",
    "--scope",
    "docs",
    "--statement",
    "Docs corrections enter context unless excluded.",
    "--owner",
    "Docs team",
  ]);
  assert.equal(docsCorrection.status, 0, docsCorrection.stderr);
  const runtimeCorrection = runCli(workspace, [
    "correction",
    "add",
    "--id",
    "runtime-old",
    "--scope",
    "runtime",
    "--statement",
    "Old runtime correction.",
    "--owner",
    "Runtime team",
  ]);
  assert.equal(runtimeCorrection.status, 0, runtimeCorrection.stderr);
  const supersede = runCli(workspace, [
    "correction",
    "supersede",
    "runtime-old",
    "--id",
    "runtime-active",
    "--statement",
    "Runtime corrections prefer the active replacement.",
  ]);
  assert.equal(supersede.status, 0, supersede.stderr);

  const run = runCli(workspace, [
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "current",
    "--decide",
    "current",
    "--exclude-correction",
    "docs-active",
    "--task",
    "Use correction context",
    "--run-id",
    "correction-context",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "correction-context", "context.md"),
    "utf-8",
  );
  assert.match(context, /## Project Correction/);
  assert.match(context, /source_type = "project_correction"/);
  assert.match(context, /source = "runtime-active"/);
  assert.match(context, /source_path = ".*\.agentmesh\/corrections\/runtime-active\.toml"/);
  assert.match(context, /owner = "Runtime team"/);
  assert.match(context, /Statement: Runtime corrections prefer the active replacement\./);
  assert.match(context, /Supersedes: runtime-old/);
  assert.doesNotMatch(context, /docs-active/);
  assert.doesNotMatch(context, /Old runtime correction/);

  const invalidExclude = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--exclude-correction",
    "../escape",
    "--task",
    "Reject unsafe correction exclusion",
    "--run-id",
    "bad-correction-exclude",
  ]);
  assert.equal(invalidExclude.status, 1);
  assert.match(invalidExclude.stderr, /correction id may only contain/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "bad-correction-exclude")), false);
});

test("workflow run rejects malformed MCP resource specs before packet creation", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--mcp-resource",
    "bad-resource-spec",
    "--task",
    "Reject malformed MCP resource",
    "--run-id",
    "bad-mcp-resource",
  ]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--mcp-resource must be <server-id>:<resource-uri>/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "bad-mcp-resource")), false);
});

function writeProjectSpec(workspace: string): string {
  const specPath = path.join(workspace, ".agentmesh", "spec", "project.toml");
  mkdirSync(path.dirname(specPath), { recursive: true });
  writeFileSync(
    specPath,
    [
      "schema_version = 1",
      "risks = []",
      "",
      "[project]",
      'id = "agentmesh"',
      'name = "AgentMesh"',
      'description = "Local-first AI coding workflow CLI."',
      "",
      "[[key_commands]]",
      'id = "test"',
      'command = "npm test"',
      'description = "Build and run Node tests."',
      "",
      "[[constraints]]",
      'id = "local-first"',
      'statement = "Run packets remain the source of truth."',
      'scope = "packet"',
      'owner = "AgentMesh maintainers"',
      "",
      "[freshness]",
      'updated_at = "2026-05-14"',
      'freshness = "fresh"',
      "max_age_days = 30",
      "",
      "[owner]",
      'owner = "AgentMesh maintainers"',
      'contact = "README.md"',
      "",
      "[validation]",
      'validation_state = "ok"',
      'checked_at = "2026-05-14"',
      'command = "npm test"',
      'message = "141 passed"',
      "",
    ].join("\n"),
  );
  return specPath;
}

test("workflow run rejects unknown MCP resource server ids before packet creation", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[mcp_servers.docs]",
      'command = "docs-mcp"',
      "args = []",
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--mcp-resource",
    "missing:file:///repo/README.md",
    "--task",
    "Reject unknown MCP server",
    "--run-id",
    "unknown-mcp-server",
  ]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /unknown MCP server id: missing/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "unknown-mcp-server")), false);
});

test("workflow run rejects more than ten MCP resources before packet creation", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[mcp_servers.docs]",
      'command = "docs-mcp"',
      "args = []",
      "",
    ].join("\n"),
  );

  const resources = Array.from({ length: 11 }, (_, index) => [
    "--mcp-resource",
    `docs:file:///repo/${index}.md`,
  ]).flat();
  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    ...resources,
    "--task",
    "Reject too many MCP resources",
    "--run-id",
    "too-many-mcp-resources",
  ]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /at most 10 MCP resources/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "too-many-mcp-resources")), false);
});

test("workflow run records scoped git diff provenance", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  assert.equal(spawnSync("git", ["init"], { cwd: workspace }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.email", "agentmesh@example.test"], { cwd: workspace }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.name", "AgentMesh"], { cwd: workspace }).status, 0);
  writeFileSync(path.join(workspace, "tracked.txt"), "before\n");
  assert.equal(spawnSync("git", ["add", "tracked.txt"], { cwd: workspace }).status, 0);
  assert.equal(spawnSync("git", ["commit", "-m", "seed"], { cwd: workspace }).status, 0);
  writeFileSync(path.join(workspace, "tracked.txt"), "after\n");

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    "tracked.txt",
    "--task",
    "Capture scoped diff",
    "--run-id",
    "scoped-context",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "scoped-context", "context.md"),
    "utf-8",
  );
  assert.match(context, /source_type = "scoped_git_diff"/);
  assert.match(context, /source_command = "git diff HEAD -- tracked\.txt"/);
  assert.match(context, /validation_state = "ok"/);
  assert.match(context, /-before/);
  assert.match(context, /\+after/);
});

test("workflow run captures explicit and scoped diff evidence together", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(workspace, "");
  writeFileSync(path.join(workspace, "tracked.txt"), "before\n");
  writeFileSync(path.join(workspace, "diff.txt"), "EXPLICIT_DIFF_EVIDENCE\n");
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["add", "tracked.txt"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  writeFileSync(path.join(workspace, "tracked.txt"), "after\n");

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--diff-file",
    "diff.txt",
    "--scope",
    "tracked.txt",
    "--task",
    "Capture both diff sources",
    "--run-id",
    "combined-diff-context",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "combined-diff-context", "context.md"),
    "utf-8",
  );
  assert.match(context, /EXPLICIT_DIFF_EVIDENCE/);
  assert.match(context, /## Scoped Git Diff/);
  assert.match(context, /-before/);
  assert.match(context, /\+after/);
});

test("workflow run truncates scoped git diff context when stdout exceeds byte budget", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[context_policy]",
      "max_bytes = 180",
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(workspace, "tracked.txt"), "before\n");
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["add", "tracked.txt"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  writeFileSync(path.join(workspace, "tracked.txt"), `${"x".repeat(120)}\n`);

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    "tracked.txt",
    "--task",
    "Capture bounded scoped diff",
    "--run-id",
    "scoped-context-truncated",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "scoped-context-truncated");
  const context = readFileSync(path.join(runDir, "context.md"), "utf-8");
  assert.match(context, /AGENTMESH_CONTEXT_TRUNCATED/);
  assert.match(context, /source_command = "git diff HEAD -- tracked\.txt"/);
  assert.match(context, /original_bytes = /);
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.ok(status.context_bytes <= 180);
});

test("workflow run records resolved context policy and required sources", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[context_policy]",
      "max_bytes = 4096",
      "max_files = 3",
      'required_sources = ["required.md"]',
      'redact_patterns = ["API_KEY=[A-Za-z0-9]+"]',
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(workspace, "required.md"), "Required facts\nAPI_KEY=abcdef\n");

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "Use policy context",
    "--run-id",
    "policy-context",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "policy-context");
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.resolved_context_policy, {
    max_bytes: 4096,
    max_files: 3,
    required_sources: ["required.md"],
    denied_paths: [],
    redact_patterns: ["API_KEY=[A-Za-z0-9]+"],
  });
  const context = readFileSync(path.join(runDir, "context.md"), "utf-8");
  assert.match(context, /## Resolved Context Policy/);
  assert.match(context, /max_bytes = 4096/);
  assert.match(context, /source = "required\.md"/);
  assert.match(context, /Required facts/);
  assert.match(context, /API_KEY=\[REDACTED\]/);
  assert.match(context, /redaction_state = "redacted"/);
});

test("context policy marks old file-backed sources as stale", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[context_policy]",
      "freshness_max_age_seconds = 60",
      "",
    ].join("\n"),
  );
  const sourcePath = path.join(workspace, "old-context.md");
  writeFileSync(sourcePath, "Old but readable context.\n");
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(sourcePath, old, old);

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--context-file",
    "old-context.md",
    "--task",
    "Record stale file context",
    "--run-id",
    "stale-file-context",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "stale-file-context", "context.md"),
    "utf-8",
  );
  assert.match(context, /source = "old-context\.md"[\s\S]*freshness = "stale"/);
});

test("context policy max_files does not count generated scoped diff sources", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[context_policy]",
      "max_files = 1",
      'required_sources = ["required.md"]',
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(workspace, "required.md"), "Required evidence.\n");
  writeFileSync(path.join(workspace, "tracked.txt"), "before\n");
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["add", "tracked.txt"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  writeFileSync(path.join(workspace, "tracked.txt"), "after\n");

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    "tracked.txt",
    "--task",
    "Do not count scope as a file input",
    "--run-id",
    "scope-not-file-count",
  ]);
  assert.equal(run.status, 0, run.stderr);
});

test("workflow run applies final byte budget to generated correction context", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[context_policy]",
      "max_bytes = 512",
      "",
    ].join("\n"),
  );
  const correction = runCli(workspace, [
    "correction",
    "add",
    "--id",
    "oversized-correction",
    "--scope",
    "docs",
    "--statement",
    "Generated correction budget marker " + "x".repeat(2000),
  ]);
  assert.equal(correction.status, 0, correction.stderr);

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "Capture bounded generated context",
    "--run-id",
    "generated-context-truncated",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "generated-context-truncated");
  const context = readFileSync(path.join(runDir, "context.md"), "utf-8");
  assert.match(context, /AGENTMESH_CONTEXT_TRUNCATED/);
  assert.match(context, /max_bytes = 512/);
  assert.match(context, /Status: active/);
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.ok(status.context_bytes <= 512);
});

test("workflow run rejects denied and oversized context policy inputs before packet creation", () => {
  const deniedWorkspace = makeWorkspace();
  test.after(() => rmSync(deniedWorkspace, { recursive: true, force: true }));
  writeConfig(
    deniedWorkspace,
    [
      "[context_policy]",
      'required_sources = ["secrets/token.txt"]',
      'denied_paths = ["secrets"]',
      "",
    ].join("\n"),
  );
  mkdirSync(path.join(deniedWorkspace, "secrets"), { recursive: true });
  writeFileSync(path.join(deniedWorkspace, "secrets", "token.txt"), "secret\n");

  const deniedRun = runCli(deniedWorkspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "Reject denied policy context",
    "--run-id",
    "denied-policy-context",
  ]);
  assert.equal(deniedRun.status, 1);
  assert.match(deniedRun.stderr, /context source is denied by context_policy: secrets\/token\.txt/);
  assert.equal(existsSync(path.join(deniedWorkspace, ".agentmesh", "runs", "denied-policy-context")), false);

  const oversizedWorkspace = makeWorkspace();
  test.after(() => rmSync(oversizedWorkspace, { recursive: true, force: true }));
  writeConfig(
    oversizedWorkspace,
    [
      "[context_policy]",
      "max_bytes = 4",
      'required_sources = ["required.md"]',
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(oversizedWorkspace, "required.md"), "too large\n");

  const oversizedRun = runCli(oversizedWorkspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "Reject oversized policy context",
    "--run-id",
    "oversized-policy-context",
  ]);
  assert.equal(oversizedRun.status, 1);
  assert.match(oversizedRun.stderr, /context_policy max_bytes exceeded/);
  assert.equal(existsSync(path.join(oversizedWorkspace, ".agentmesh", "runs", "oversized-policy-context")), false);
});

test("context policy rejects symlinked files that resolve into denied paths", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[context_policy]",
      'denied_paths = ["secrets"]',
      "",
    ].join("\n"),
  );
  mkdirSync(path.join(workspace, "safe"), { recursive: true });
  mkdirSync(path.join(workspace, "secrets"), { recursive: true });
  writeFileSync(path.join(workspace, "secrets", "token.txt"), "TOPSECRET\n");
  symlinkSync("../secrets/token.txt", path.join(workspace, "safe", "link.txt"));

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--context-file",
    "safe/link.txt",
    "--task",
    "Reject symlinked denied context",
    "--run-id",
    "denied-symlink-context",
  ]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /context source is denied by context_policy/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "denied-symlink-context")), false);
});

test("context policy rejects scopes that include denied descendants", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[context_policy]",
      'denied_paths = ["secrets"]',
      "",
    ].join("\n"),
  );
  mkdirSync(path.join(workspace, "secrets"), { recursive: true });
  writeFileSync(path.join(workspace, "secrets", "token.txt"), "before\n");
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["add", "secrets/token.txt"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  writeFileSync(path.join(workspace, "secrets", "token.txt"), "after-secret\n");

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    ".",
    "--task",
    "Reject broad scope containing denied files",
    "--run-id",
    "denied-broad-scope",
  ]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /context source is denied by context_policy/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "denied-broad-scope")), false);
});

test("context policy applies denied paths to generated project spec sources", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[context_policy]",
      'denied_paths = [".agentmesh/spec"]',
      "",
    ].join("\n"),
  );
  writeProjectSpec(workspace);

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--include-spec",
    "--task",
    "Reject denied generated project spec",
    "--run-id",
    "denied-generated-spec",
  ]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /context source is denied by context_policy/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "denied-generated-spec")), false);
});

test("scoped context includes untracked files", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(workspace, "");
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "--allow-empty", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  writeFileSync(path.join(workspace, "new-file.ts"), "export const added = true;\n");

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    ".",
    "--task",
    "Capture untracked scoped context",
    "--run-id",
    "untracked-scoped-context",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "untracked-scoped-context", "context.md"),
    "utf-8",
  );
  assert.match(context, /new-file\.ts/);
  assert.match(context, /export const added = true;/);
  assert.doesNotMatch(context, /\.agentmesh\/runs\/untracked-scoped-context/);
});

test("scoped context captures an untracked symlink without reading its target", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(workspace, "");
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "--allow-empty", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  writeFileSync(path.join(workspace, "outside-target.txt"), "SYMLINK_TARGET_SECRET\n");
  symlinkSync("outside-target.txt", path.join(workspace, "new-link.txt"));

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    "new-link.txt",
    "--task",
    "Capture symlink metadata safely",
    "--run-id",
    "untracked-symlink-context",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "untracked-symlink-context", "context.md"),
    "utf-8",
  );
  assert.match(context, /new file mode 120000/);
  assert.match(context, /\+outside-target\.txt/);
  assert.doesNotMatch(context, /SYMLINK_TARGET_SECRET/);
});

test("scoped context omits oversized untracked file content before loading it", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(workspace, "");
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "--allow-empty", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  writeFileSync(path.join(workspace, "large.txt"), "L".repeat(300 * 1024));

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    "large.txt",
    "--task",
    "Bound untracked file capture",
    "--run-id",
    "oversized-untracked-context",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "oversized-untracked-context", "context.md"),
    "utf-8",
  );
  assert.match(context, /AGENTMESH_UNTRACKED_FILE_OMITTED/);
  assert.match(context, /reason = "file_too_large"/);
  assert.match(context, /max_bytes = 262144/);
  assert.doesNotMatch(context, /L{1024}/);
});

test("scoped context marks binary untracked files without UTF-8 decoding them", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(workspace, "");
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "--allow-empty", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  writeFileSync(path.join(workspace, "binary.dat"), Buffer.from([0x41, 0x00, 0x42, 0xff]));

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    "binary.dat",
    "--task",
    "Mark binary untracked context",
    "--run-id",
    "binary-untracked-context",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "binary-untracked-context", "context.md"),
    "utf-8",
  );
  assert.match(context, /AGENTMESH_UNTRACKED_FILE_OMITTED/);
  assert.match(context, /reason = "binary_file"/);
  assert.match(context, /Binary files \/dev\/null and b\/binary\.dat differ/);
  assert.doesNotMatch(context, /\u0000/);
});

test("scoped context renders accurate hunks for untracked text newline variants", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(workspace, "");
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "--allow-empty", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  writeFileSync(path.join(workspace, "trailing.txt"), "one\ntwo\n");
  writeFileSync(path.join(workspace, "unterminated.txt"), "one\ntwo");
  writeFileSync(path.join(workspace, "empty.txt"), "");

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    ".",
    "--task",
    "Render untracked diff hunks accurately",
    "--run-id",
    "untracked-newline-context",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "untracked-newline-context", "context.md"),
    "utf-8",
  );
  assert.match(
    context,
    /diff --git a\/trailing\.txt b\/trailing\.txt[\s\S]*?@@ -0,0 \+1,2 @@\n\+one\n\+two\n+(?=diff --git|##|$)/,
  );
  assert.match(
    context,
    /diff --git a\/unterminated\.txt b\/unterminated\.txt[\s\S]*?@@ -0,0 \+1,2 @@\n\+one\n\+two\n\\ No newline at end of file/,
  );
  const emptyDiff = context.match(/diff --git a\/empty\.txt b\/empty\.txt[\s\S]*?(?=diff --git|\n##|$)/)?.[0];
  assert.ok(emptyDiff, "expected an empty-file diff entry");
  assert.doesNotMatch(emptyDiff, /@@ -0,0/);
  assert.doesNotMatch(emptyDiff, /^\+$/m);
});

test("scoped context excludes tracked internal run artifacts", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(workspace, "");
  mkdirSync(path.join(workspace, ".agentmesh", "runs", "historic"), { recursive: true });
  writeFileSync(path.join(workspace, ".agentmesh", "runs", "historic", "result.md"), "before\n");
  writeFileSync(path.join(workspace, "tracked.txt"), "before\n");
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["add", ".agentmesh/runs/historic/result.md", "tracked.txt"], {
    cwd: workspace,
    encoding: "utf-8",
  });
  spawnSync("git", ["commit", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  writeFileSync(path.join(workspace, ".agentmesh", "runs", "historic", "result.md"), "INTERNAL_RUN_SECRET\n");
  writeFileSync(path.join(workspace, "tracked.txt"), "after\n");

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    ".",
    "--task",
    "Exclude internal run artifacts",
    "--run-id",
    "tracked-internal-run-context",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "tracked-internal-run-context", "context.md"),
    "utf-8",
  );
  assert.match(context, /\+after/);
  assert.doesNotMatch(context, /INTERNAL_RUN_SECRET/);
  assert.doesNotMatch(context, /\.agentmesh\/runs\/historic\/result\.md/);
});

test("context policy ignores internal run artifacts that scoped capture excludes", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[context_policy]",
      'denied_paths = [".agentmesh/runs"]',
      "",
    ].join("\n"),
  );
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "--allow-empty", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  mkdirSync(path.join(workspace, ".agentmesh", "runs", "historic"), { recursive: true });
  writeFileSync(
    path.join(workspace, ".agentmesh", "runs", "historic", "result.md"),
    "INTERNAL_POLICY_SECRET\n",
  );
  writeFileSync(path.join(workspace, "visible.txt"), "visible\n");

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    ".",
    "--task",
    "Apply one internal-run exclusion policy",
    "--run-id",
    "policy-internal-run-context",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "policy-internal-run-context", "context.md"),
    "utf-8",
  );
  assert.match(context, /\+visible/);
  assert.doesNotMatch(context, /INTERNAL_POLICY_SECRET/);
});

test("scoped context keeps tracked diff and failed provenance when untracked enumeration fails", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(workspace, "");
  writeFileSync(path.join(workspace, "tracked.txt"), "before\n");
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["add", "tracked.txt"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  writeFileSync(path.join(workspace, "tracked.txt"), "after\n");

  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf-8" }).stdout.trim();
  assert.ok(realGit, "expected git on PATH");
  const binDir = path.join(workspace, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  writeExecutable(
    path.join(binDir, "git"),
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"ls-files\" ]; then",
      "  echo 'simulated ls-files failure' >&2",
      "  exit 23",
      "fi",
      `exec ${JSON.stringify(realGit)} \"$@\"`,
      "",
    ].join("\n"),
  );

  const run = runCli(
    workspace,
    [
      "flow",
      "run",
      "--plan",
      "current",
      "--execute",
      "current",
      "--review",
      "current",
      "--decide",
      "current",
      "--scope",
      "tracked.txt",
      "--task",
      "Expose partial scoped capture",
      "--run-id",
      "partial-scoped-context",
    ],
    { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` },
  );
  assert.equal(run.status, 0, run.stderr);
  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "partial-scoped-context", "context.md"),
    "utf-8",
  );
  assert.match(context, /validation_state = "failed"/);
  assert.match(context, /ingestion_error = "[^"]*simulated ls-files failure/);
  assert.match(context, /-before/);
  assert.match(context, /\+after/);
  assert.match(context, /AGENTMESH_UNTRACKED_ENUMERATION_FAILED/);
});

test("untracked regular-file capture fails closed without O_NOFOLLOW", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const sourcePath = path.join(workspace, "regular.txt");
  writeFileSync(sourcePath, "safe content\n");
  const openForCapture = (
    contextPackModule as unknown as {
      openUntrackedRegularFileForCapture?: (
        filePath: string,
        noFollowFlag: number | undefined,
      ) => number;
    }
  ).openUntrackedRegularFileForCapture;

  assert.equal(typeof openForCapture, "function");
  assert.throws(
    () => openForCapture?.(sourcePath, undefined),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /secure no-follow open is unavailable/);
      assert.equal((error as Error & { reason?: string }).reason, "no_secure_open");
      return true;
    },
  );
});

test("scoped context caps the number of untracked files captured", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(workspace, "");
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "--allow-empty", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  mkdirSync(path.join(workspace, "untracked"));
  for (let index = 0; index < 129; index += 1) {
    writeFileSync(
      path.join(workspace, "untracked", `file-${String(index).padStart(3, "0")}.txt`),
      `${index}\n`,
    );
  }

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    "untracked",
    "--task",
    "Cap untracked file count",
    "--run-id",
    "untracked-count-budget",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "untracked-count-budget", "context.md"),
    "utf-8",
  );
  assert.ok(context.includes("AGENTMESH_UNTRACKED_CAPTURE_LIMIT_REACHED"));
  assert.match(context, /reason = "file_count_limit"/);
  assert.match(context, /max_files = 128/);
  assert.match(context, /processed_files = 128/);
  assert.doesNotMatch(context, /captured_files = /);
  assert.match(context, /omitted_files = 1/);
  assert.match(context, /validation_state = "failed"/);
  assert.doesNotMatch(context, /file-128\.txt/);
});

test("scoped context caps aggregate untracked bytes before final context assembly", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(workspace, "");
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "--allow-empty", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  mkdirSync(path.join(workspace, "untracked"));
  for (let index = 0; index < 5; index += 1) {
    writeFileSync(
      path.join(workspace, "untracked", `chunk-${index}.txt`),
      String(index).repeat(240 * 1024),
    );
  }

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    "untracked",
    "--task",
    "Cap aggregate untracked bytes",
    "--run-id",
    "untracked-byte-budget",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const context = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "untracked-byte-budget", "context.md"),
    "utf-8",
  );
  assert.ok(context.includes("AGENTMESH_UNTRACKED_CAPTURE_LIMIT_REACHED"));
  assert.match(context, /reason = "byte_limit"/);
  assert.match(context, /max_bytes = 1048576/);
  assert.match(context, /processed_files = 4/);
  assert.doesNotMatch(context, /captured_files = /);
  assert.match(context, /captured_bytes = 983040/);
  assert.match(context, /omitted_files = 1/);
  assert.match(context, /validation_state = "failed"/);
  assert.doesNotMatch(context, /chunk-4\.txt/);
});

test("context policy max_bytes tightens aggregate untracked capture", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfig(
    workspace,
    [
      "[context_policy]",
      "max_bytes = 4096",
      "",
    ].join("\n"),
  );
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf-8" });
  spawnSync("git", ["commit", "--allow-empty", "-m", "base"], {
    cwd: workspace,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  mkdirSync(path.join(workspace, "untracked"));
  for (let index = 0; index < 3; index += 1) {
    writeFileSync(
      path.join(workspace, "untracked", `policy-${index}.txt`),
      String(index).repeat(1800),
    );
  }

  const run = runCli(workspace, [
    "flow",
    "run",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--scope",
    "untracked",
    "--task",
    "Tighten aggregate untracked bytes with policy",
    "--run-id",
    "policy-untracked-byte-budget",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const runDir = path.join(workspace, ".agentmesh", "runs", "policy-untracked-byte-budget");
  const context = readFileSync(path.join(runDir, "context.md"), "utf-8");
  assert.match(context, /AGENTMESH_CONTEXT_TRUNCATED/);
  assert.match(context, /AGENTMESH_UNTRACKED_CAPTURE_LIMIT_REACHED/);
  assert.match(context, /reason = "byte_limit"/);
  assert.match(context, /processed_files = 2/);
  assert.match(context, /captured_bytes = 3600/);
  assert.match(context, /omitted_files = 1/);
  assert.match(context, /max_bytes = 4096/);
  assert.match(context, /validation_state = "failed"/);
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.ok(status.context_bytes <= 4096);
});
