import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  addCorrection,
  correctionRecordPath,
  listCorrections,
  loadCorrection,
  supersedeCorrection,
} from "../packages/runtime/src/corrections/index.js";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-corrections-"));
}

function runCli(workspace: string, args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspace,
    encoding: "utf-8",
  });
}

test("correction add writes a stable local record", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const result = addCorrection(
    {
      id: "project-facts-explicit",
      scope: "packages/runtime/src/context",
      statement: "Project facts enter packets only through explicit include flags.",
      source: "manual",
      owner: "AgentMesh maintainers",
      createdAt: new Date("2026-05-14T00:00:00.000Z"),
    },
    workspace,
  );

  assert.equal(
    result.path,
    path.join(workspace, ".agentmesh", "corrections", "project-facts-explicit.toml"),
  );
  assert.equal(existsSync(result.path), true);
  const record = loadCorrection(result.path);
  assert.equal(record.id, "project-facts-explicit");
  assert.equal(record.status, "active");
  assert.deepEqual(record.supersedes, []);
  assert.equal(record.created_at, "2026-05-14T00:00:00.000Z");
  assert.match(readFileSync(result.path, "utf-8"), /schema_version = 1/);
});

test("correction session impact is explicit, preserved on supersede, and legacy records stay data", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const added = addCorrection({
    id: "persona-contract",
    scope: "review",
    statement: "Use the approved reviewer persona.",
    sessionImpact: "persona",
  }, workspace);
  assert.equal(added.record.session_impact, "persona");

  const replacement = supersedeCorrection("persona-contract", {
    id: "persona-contract-v2",
    statement: "Use the updated approved reviewer persona.",
  }, workspace);
  assert.equal(replacement.replacement.record.session_impact, "persona");

  writeFileSync(correctionRecordPath("legacy", workspace), [
    "schema_version = 1",
    'id = "legacy"',
    'scope = "review"',
    'statement = "Ordinary packet data."',
    'source = "manual"',
    'created_at = "2026-05-14T00:00:00.000Z"',
    "supersedes = []",
    'status = "active"',
    'owner = "maintainers"',
    "",
  ].join("\n"));
  assert.equal(loadCorrection(correctionRecordPath("legacy", workspace)).session_impact ?? "data", "data");
});

test("correction add rejects unsafe ids and duplicate records", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  assert.throws(() => correctionRecordPath("../escape", workspace), /correction id may only/);
  addCorrection(
    {
      id: "duplicate",
      scope: "runtime",
      statement: "First record wins.",
    },
    workspace,
  );
  assert.throws(
    () =>
      addCorrection(
        {
          id: "duplicate",
          scope: "runtime",
          statement: "Second record must not overwrite.",
        },
        workspace,
      ),
    /correction already exists: duplicate/,
  );
});

test("correction add CLI writes JSON and rejects empty or unscoped corrections", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const added = runCli(workspace, [
    "correction",
    "add",
    "--id",
    "cli-record",
    "--scope",
    "docs",
    "--statement",
    "Corrections must be explicit project facts.",
    "--source",
    "manual",
    "--owner",
    "AgentMesh maintainers",
    "--json",
  ]);
  assert.equal(added.status, 0, added.stderr);
  const payload = JSON.parse(added.stdout);
  assert.equal(payload.record.id, "cli-record");
  assert.equal(payload.record.scope, "docs");
  assert.match(payload.path, /\.agentmesh\/corrections\/cli-record\.toml$/);

  const missingScope = runCli(workspace, [
    "correction",
    "add",
    "--statement",
    "Missing scope.",
  ]);
  assert.equal(missingScope.status, 2);
  assert.match(missingScope.stderr, /usage: agentmesh correction add/);

  const emptyStatement = runCli(workspace, [
    "correction",
    "add",
    "--scope",
    "docs",
    "--statement",
    "",
  ]);
  assert.equal(emptyStatement.status, 2);
  assert.match(emptyStatement.stderr, /usage: agentmesh correction add/);

  const blankScope = runCli(workspace, [
    "correction",
    "add",
    "--scope",
    " ",
    "--statement",
    "Whitespace scope is invalid.",
  ]);
  assert.equal(blankScope.status, 1);
  assert.match(blankScope.stderr, /scope is required and cannot be empty/);
});

test("correction list supports human and JSON output with filters", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  addCorrection(
    {
      id: "docs-active",
      scope: "docs",
      statement: "Docs corrections are explicit.",
      owner: "Docs team",
      createdAt: new Date("2026-05-14T00:00:00.000Z"),
    },
    workspace,
  );
  addCorrection(
    {
      id: "runtime-active",
      scope: "runtime",
      statement: "Runtime corrections are explicit.",
      createdAt: new Date("2026-05-14T00:01:00.000Z"),
    },
    workspace,
  );
  writeFileSync(
    path.join(workspace, ".agentmesh", "corrections", "docs-old.toml"),
    [
      "schema_version = 1",
      'id = "docs-old"',
      'scope = "docs"',
      'statement = "Old docs correction."',
      'source = "manual"',
      'created_at = "2026-05-14T00:02:00.000Z"',
      "supersedes = []",
      'status = "superseded"',
      'owner = "Docs team"',
      "",
    ].join("\n"),
  );

  assert.deepEqual(
    listCorrections({ scope: "docs" }, workspace).map((entry) => entry.record.id),
    ["docs-active", "docs-old"],
  );
  assert.deepEqual(
    listCorrections({ status: "superseded" }, workspace).map((entry) => entry.record.id),
    ["docs-old"],
  );
  assert.throws(() => listCorrections({ status: "archived" }, workspace));

  const human = runCli(workspace, ["correction", "list", "--scope", "docs"]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /docs-active\tactive\tdocs\tDocs team\tDocs corrections are explicit\./);
  assert.match(human.stdout, /docs-old\tsuperseded\tdocs\tDocs team\tOld docs correction\./);
  assert.doesNotMatch(human.stdout, /runtime-active/);

  const json = runCli(workspace, ["correction", "list", "--status", "active", "--json"]);
  assert.equal(json.status, 0, json.stderr);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.schema_version, 1);
  assert.deepEqual(
    payload.corrections.map((correction: { id: string }) => correction.id),
    ["docs-active", "runtime-active"],
  );
  assert.match(payload.corrections[0].path, /\.agentmesh\/corrections\/docs-active\.toml$/);

  const emptyWorkspace = makeWorkspace();
  test.after(() => rmSync(emptyWorkspace, { recursive: true, force: true }));
  const empty = runCli(emptyWorkspace, ["correction", "list", "--json"]);
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout).corrections, []);
});

test("correction supersede keeps old records readable and prefers active records", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const old = addCorrection(
    {
      id: "old-correction",
      scope: "runtime",
      statement: "Old runtime correction.",
      owner: "Runtime team",
      createdAt: new Date("2026-05-14T00:00:00.000Z"),
    },
    workspace,
  );
  writeFileSync(
    old.path,
    readFileSync(old.path, "utf-8").replace(
      'status = "active"',
      '# keep this operator note\nstatus = "active" # keep trailing note',
    ),
  );

  const result = supersedeCorrection(
    "old-correction",
    {
      id: "new-correction",
      statement: "New runtime correction.",
      createdAt: new Date("2026-05-14T00:01:00.000Z"),
    },
    workspace,
  );

  assert.equal(result.superseded.record.status, "superseded");
  assert.equal(result.replacement.record.status, "active");
  assert.deepEqual(result.replacement.record.supersedes, ["old-correction"]);
  assert.equal(result.replacement.record.scope, "runtime");
  assert.equal(result.replacement.record.owner, "Runtime team");
  assert.match(readFileSync(old.path, "utf-8"), /# keep this operator note/);
  assert.match(readFileSync(old.path, "utf-8"), /status = "superseded" # keep trailing note/);
  assert.deepEqual(
    listCorrections({ status: "active" }, workspace).map((entry) => entry.record.id),
    ["new-correction"],
  );
  assert.deepEqual(
    listCorrections({ status: "superseded" }, workspace).map((entry) => entry.record.id),
    ["old-correction"],
  );
  assert.equal(loadCorrection(old.path).statement, "Old runtime correction.");
});

test("correction supersede CLI writes replacement JSON and rejects invalid targets", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  addCorrection(
    {
      id: "cli-old",
      scope: "docs",
      statement: "Old docs correction.",
    },
    workspace,
  );
  const supersede = runCli(workspace, [
    "correction",
    "supersede",
    "cli-old",
    "--id",
    "cli-new",
    "--statement",
    "New docs correction.",
    "--json",
  ]);
  assert.equal(supersede.status, 0, supersede.stderr);
  const payload = JSON.parse(supersede.stdout);
  assert.equal(payload.superseded.id, "cli-old");
  assert.equal(payload.superseded.status, "superseded");
  assert.equal(payload.replacement.id, "cli-new");
  assert.deepEqual(payload.replacement.supersedes, ["cli-old"]);

  const active = runCli(workspace, ["correction", "list", "--status", "active", "--json"]);
  assert.equal(active.status, 0, active.stderr);
  assert.deepEqual(
    JSON.parse(active.stdout).corrections.map((correction: { id: string }) => correction.id),
    ["cli-new"],
  );

  const missing = runCli(workspace, [
    "correction",
    "supersede",
    "missing",
    "--statement",
    "No target.",
  ]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /correction not found: missing/);

  const again = runCli(workspace, [
    "correction",
    "supersede",
    "cli-old",
    "--statement",
    "Already superseded.",
  ]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /correction already superseded: cli-old/);
});
