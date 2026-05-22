import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
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
  appendEvent,
  loadArtifacts,
  loadEvents,
  loadStatus,
  recordArtifact,
  saveStatus,
} from "../packages/runtime/src/packet/io.js";
import { currentPacketStatus } from "./helpers/current-packet-status.js";

function makeRunDir(): string {
  const runDir = mkdtempSync(path.join(tmpdir(), "agentmesh-packet-io-"));
  writeFileSync(path.join(runDir, "assignment.toml"), "schema_version = 1\n");
  writeFileSync(path.join(runDir, "request.md"), "# Request\n\nhello\n");
  writeFileSync(path.join(runDir, "plan.md"), "# Plan\n");
  writeFileSync(path.join(runDir, "handoff.md"), "# Handoff\n");
  writeFileSync(path.join(runDir, "findings.md"), "# Findings\n");
  writeFileSync(
    path.join(runDir, "status.json"),
    JSON.stringify(
      currentPacketStatus({
        run_id: "packet-io",
      }),
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    path.join(runDir, "artifacts.toml"),
    [
      "schema_version = 1",
      "",
      "[artifacts.assignment]",
      'path = "assignment.toml"',
      'kind = "assignment"',
      'stage = "run"',
      "",
      "[artifacts.findings]",
      'path = "findings.md"',
      'kind = "markdown"',
      'stage = "review"',
      "",
      "[artifacts.handoff]",
      'path = "handoff.md"',
      'kind = "markdown"',
      'stage = "execute"',
      "",
      "[artifacts.plan]",
      'path = "plan.md"',
      'kind = "markdown"',
      'stage = "plan"',
      "",
      "[artifacts.request]",
      'path = "request.md"',
      'kind = "request"',
      'stage = "run"',
      "",
      "[artifacts.status]",
      'path = "status.json"',
      'kind = "status"',
      'stage = "run"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(runDir, "events.jsonl"),
    JSON.stringify({
      schema_version: 1,
      timestamp: "2026-05-13T00:00:00+00:00",
      event: "created",
    }) + "\n",
  );
  return runDir;
}

test("loads and saves packet status JSON without losing extension fields", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));

  const status = loadStatus(runDir);
  status.status = "plan_completed";
  status.completed_stages = ["plan"];
  status.custom_extension = "kept";
  saveStatus(runDir, status);

  const reloaded = loadStatus(runDir);

  assert.equal(reloaded.status, "plan_completed");
  assert.deepEqual(reloaded.completed_stages, ["plan"]);
  assert.equal(reloaded.custom_extension, "kept");
  assert.match(readFileSync(path.join(runDir, "status.json"), "utf-8"), /\n$/);
});

test("appends and reads packet event JSONL", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));

  appendEvent(runDir, "flow.retry.requested", {
    stage: "plan",
    requested_by: "agentmesh",
  });
  const events = loadEvents(runDir);

  assert.equal(events.length, 2);
  assert.equal(events[1].schema_version, 1);
  assert.equal(events[1].event, "flow.retry.requested");
  assert.equal(events[1].stage, "plan");
  assert.equal(events[1].requested_by, "agentmesh");
  assert.equal(typeof events[1].timestamp, "string");
});

test("records packet artifacts using packet-relative paths", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(path.join(runDir, "reports"), { recursive: true });
  const reportPath = path.join(runDir, "reports", "review.md");
  writeFileSync(reportPath, "# Review\n");

  recordArtifact(runDir, "review-report", reportPath, "markdown", "review", "gemini");
  const artifacts = loadArtifacts(runDir);
  const manifest = readFileSync(path.join(runDir, "artifacts.toml"), "utf-8");

  assert.deepEqual(artifacts["review-report"], {
    path: "reports/review.md",
    kind: "markdown",
    stage: "review",
    agent: "gemini",
  });
  assert.match(manifest, /\[artifacts\.review-report\]/);
});

test("loads packet artifacts with inline TOML comments", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(runDir, "artifacts.toml"),
    [
      "schema_version = 1 # generated",
      "",
      "[artifacts.plan]",
      'path = "plan.md" # packet-relative path',
      'kind = "markdown" # artifact kind',
      'stage = "plan" # source stage',
      "",
    ].join("\n"),
  );

  const artifacts = loadArtifacts(runDir);

  assert.deepEqual(artifacts.plan, {
    path: "plan.md",
    kind: "markdown",
    stage: "plan",
  });
});

test("packet status, events, and artifacts CLI commands emit JSON", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));

  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const statusResult = spawnSync(
    process.execPath,
    [cliPath, "packet", "status", runDir, "--json"],
    { encoding: "utf-8" },
  );
  assert.equal(statusResult.status, 0, statusResult.stderr);
  assert.equal(JSON.parse(statusResult.stdout).status, "created");

  const eventsResult = spawnSync(
    process.execPath,
    [cliPath, "packet", "events", runDir, "--json"],
    { encoding: "utf-8" },
  );
  assert.equal(eventsResult.status, 0, eventsResult.stderr);
  assert.equal(JSON.parse(eventsResult.stdout)[0].event, "created");

  const artifactsResult = spawnSync(
    process.execPath,
    [cliPath, "packet", "artifacts", runDir, "--json"],
    { encoding: "utf-8" },
  );
  assert.equal(artifactsResult.status, 0, artifactsResult.stderr);
  assert.equal(JSON.parse(artifactsResult.stdout).status.path, "status.json");
});
