import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkProjectSpec,
  parseProjectSpecToml,
} from "../packages/runtime/src/spec/index.js";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-project-spec-"));
}

function writeProjectSpec(workspace: string, content = validProjectSpec()): string {
  const specPath = path.join(workspace, ".agentmesh", "spec", "project.toml");
  mkdirSync(path.dirname(specPath), { recursive: true });
  writeFileSync(specPath, content);
  return specPath;
}

function runCli(workspace: string, args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspace,
    encoding: "utf-8",
  });
}

test("project spec parser loads valid project facts", () => {
  const spec = parseProjectSpecToml(validProjectSpec(), "project.toml");

  assert.equal(spec.project.id, "agentmesh");
  assert.equal(spec.key_commands[0].command, "npm test");
  assert.equal(spec.constraints[0].id, "local-first");
  assert.equal(spec.risks[0].status, "active");
});

test("spec check passes valid project.toml and reports summary JSON", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const specPath = writeProjectSpec(workspace);

  const report = checkProjectSpec(specPath);
  assert.equal(report.ok, true);
  assert.equal(report.diagnostics.length, 0);
  assert.equal(report.project?.id, "agentmesh");
  assert.equal(report.project?.key_command_count, 1);

  const cli = runCli(workspace, ["spec", "check", "--json"]);
  assert.equal(cli.status, 0, cli.stderr);
  const payload = JSON.parse(cli.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.project.id, "agentmesh");
});

test("spec check reports stale project facts as actionable diagnostics", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const specPath = writeProjectSpec(
    workspace,
    validProjectSpec().replace('freshness = "fresh"', 'freshness = "stale"'),
  );

  const report = checkProjectSpec(specPath);
  assert.equal(report.ok, false);
  assert.equal(report.diagnostics[0].classification, "stale_spec");

  const cli = runCli(workspace, ["spec", "check"]);
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /stale_spec: project spec freshness is stale/);
});

test("spec check reports malformed TOML and missing required fields", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const specPath = writeProjectSpec(workspace, "schema_version = 1\n[bad]\n");

  const malformed = checkProjectSpec(specPath);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.diagnostics[0].classification, "malformed_spec");
  assert.match(malformed.diagnostics[0].message, /unsupported section/);

  writeProjectSpec(
    workspace,
    validProjectSpec().replace('id = "agentmesh"\n', ""),
  );
  const missing = runCli(workspace, ["spec", "check", "--json"]);
  assert.equal(missing.status, 1);
  const payload = JSON.parse(missing.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.diagnostics[0].classification, "missing_required_field");
  assert.match(payload.diagnostics[0].message, /project\.id/);
});

function validProjectSpec(): string {
  return [
    "schema_version = 1",
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
    "[[risks]]",
    'id = "stale-facts"',
    'statement = "Project facts can drift if not validated."',
    'status = "active"',
    'mitigation = "Run agentmesh spec check before inclusion."',
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
  ].join("\n");
}
