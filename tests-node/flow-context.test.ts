import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  fakeServerPath,
  makeWorkspace,
  runCli,
  writeConfig,
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
