import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validatePacket } from "../packages/runtime/src/packet/validate.js";
import { currentPacketStatus } from "./helpers/current-packet-status.js";

function makeRunDir(): string {
  const runDir = mkdtempSync(path.join(tmpdir(), "agentmesh-packet-"));
  writeFileSync(path.join(runDir, "assignment.toml"), "schema_version = 1\n");
  writeFileSync(path.join(runDir, "request.md"), "# Request\n\nhello\n");
  writeFileSync(path.join(runDir, "plan.md"), "# Plan\n");
  writeFileSync(path.join(runDir, "handoff.md"), "# Handoff\n");
  writeFileSync(path.join(runDir, "findings.md"), "# Findings\n");
  writeFileSync(
    path.join(runDir, "status.json"),
    JSON.stringify(
      currentPacketStatus({
        run_id: "node-validate",
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

test("validates the current packet schema manifest shape", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));

  const result = validatePacket(runDir);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.artifactCount, 6);
  assert.equal(result.eventCount, 1);
});

test("validates the canonical fixture packet", () => {
  const runDir = path.join(
    process.cwd(),
    "tests-node",
    "fixtures",
    "packets",
    "valid-basic",
  );

  const result = validatePacket(runDir);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.artifactCount, 7);
  assert.equal(result.eventCount, 3);
});

test("rejects unsupported newer packet status files", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(runDir, "status.json"),
    `${JSON.stringify(currentPacketStatus({ schema_version: 99 }), null, 2)}\n`,
  );

  const result = validatePacket(runDir);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /status\.json\.schema_version must be 1/);
});

test("reports packet artifacts that point at missing files", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  rmSync(path.join(runDir, "plan.md"));

  const result = validatePacket(runDir);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /artifact plan path not found: plan\.md/);
});

test("reports packet artifacts that escape the run directory", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(runDir, "artifacts.toml"),
    [
      "schema_version = 1",
      "",
      "[artifacts.plan]",
      'path = "../plan.md"',
      'kind = "markdown"',
      'stage = "plan"',
      "",
    ].join("\n"),
  );

  const result = validatePacket(runDir);

  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /artifact plan path escapes run directory: \.\.\/plan\.md/,
  );
});

test("reports packet status schema errors with readable paths", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(runDir, "status.json"),
    JSON.stringify(currentPacketStatus({
      run_id: "",
      stages: ["plan"],
      completed_stages: ["review"],
    })) + "\n",
  );

  const result = validatePacket(runDir);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /status\.json\.run_id must be a non-empty string/);
  assert.match(
    result.errors.join("\n"),
    /status\.json\.completed_stages contains unknown stage: review/,
  );
});

test("validates repeated packet status against stage node ids", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  const repeatedStatus = {
    ...currentPacketStatus({
      stages: ["plan", "execute", "review", "execute", "review", "decide"],
    }),
    run_id: "repeated-validate",
    status: "execute_2_failed",
    stage_assignments: {
      plan: ["planner"],
      execute: ["worker"],
      review: ["reviewer"],
      execute_2: ["worker"],
      review_2: ["reviewer"],
      decide: ["decider"],
    },
    completed_stages: ["plan", "execute", "review"],
    failed_stage: "execute_2",
    stage_timing: {
      plan: {
        started_at: "2026-05-13T00:00:00.000Z",
        completed_at: "2026-05-13T00:00:01.000Z",
        duration_ms: 1000,
        attempt_count: 1,
      },
      execute: {
        started_at: "2026-05-13T00:00:01.000Z",
        completed_at: "2026-05-13T00:00:02.000Z",
        duration_ms: 1000,
        attempt_count: 1,
      },
      review: {
        started_at: "2026-05-13T00:00:02.000Z",
        completed_at: "2026-05-13T00:00:03.000Z",
        duration_ms: 1000,
        attempt_count: 1,
      },
      execute_2: {
        started_at: "2026-05-13T00:00:03.000Z",
        failed_at: "2026-05-13T00:00:04.000Z",
        duration_ms: 1000,
        attempt_count: 1,
        exit_code: 1,
      },
      review_2: { attempt_count: 0 },
      decide: { attempt_count: 0 },
    },
    agent_timing: {},
    user_gate: false,
  };
  writeFileSync(path.join(runDir, "status.json"), `${JSON.stringify(repeatedStatus, null, 2)}\n`);

  assert.equal(validatePacket(runDir).ok, true);

  writeFileSync(
    path.join(runDir, "status.json"),
    `${JSON.stringify({ ...repeatedStatus, failed_stage: "missing_node" }, null, 2)}\n`,
  );
  const invalid = validatePacket(runDir);
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join("\n"), /failed_stage contains unknown stage: missing_node/);
});

test("validates verify packet status and verification artifact", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeFileSync(path.join(runDir, "verification.md"), "# Verification\n\nChecks passed.\n");
  writeFileSync(
    path.join(runDir, "status.json"),
    JSON.stringify(
      currentPacketStatus({
        run_id: "verify-validate",
        status: "verify_completed",
        stages: ["plan", "execute", "verify", "review", "decide"],
        stage_assignments: {
          plan: ["planner"],
          execute: ["worker"],
          verify: ["verifier"],
          review: ["reviewer"],
          decide: ["decider"],
        },
        completed_stages: ["plan", "execute", "verify"],
        stage_state: {
          plan: "completed",
          execute: "completed",
          verify: "completed",
          review: "planned",
          decide: "planned",
        },
        stage_timing: {
          plan: { attempt_count: 1 },
          execute: { attempt_count: 1 },
          verify: {
            started_at: "2026-05-13T00:00:02.000Z",
            completed_at: "2026-05-13T00:00:03.000Z",
            duration_ms: 1000,
            attempt_count: 1,
          },
          review: { attempt_count: 0 },
          decide: { attempt_count: 0 },
        },
        agent_timing: {
          verify: {
            verifier: {
              started_at: "2026-05-13T00:00:02.000Z",
              completed_at: "2026-05-13T00:00:03.000Z",
              duration_ms: 1000,
              attempt_count: 1,
            },
          },
        },
        user_gate: false,
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
      "[artifacts.verification]",
      'path = "verification.md"',
      'kind = "markdown"',
      'stage = "verify"',
      'agent = "verifier"',
      "",
    ].join("\n"),
  );

  const result = validatePacket(runDir);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.artifactCount, 4);
});

test("reports packet event schema errors with line numbers", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(runDir, "events.jsonl"),
    JSON.stringify({
      schema_version: 1,
      timestamp: "",
      event: "",
    }) + "\n",
  );

  const result = validatePacket(runDir);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /events\.jsonl:1\.timestamp must be a non-empty string/);
  assert.match(result.errors.join("\n"), /events\.jsonl:1\.event must be a non-empty string/);
});

test("reports packet artifact manifest schema errors with artifact names", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(runDir, "artifacts.toml"),
    [
      "schema_version = 1",
      "",
      "[artifacts.plan]",
      'path = "plan.md"',
      'kind = "markdown"',
      "",
    ].join("\n"),
  );

  const result = validatePacket(runDir);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /artifact plan.stage must be a string/);
});

test("reports malformed event log lines with line numbers", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  appendFileSync(path.join(runDir, "events.jsonl"), "{bad json}\n");

  const result = validatePacket(runDir);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /events\.jsonl:2 invalid JSON/);
});

test("packet validate CLI prints a JSON readiness report", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(path.join(runDir, "nested"), { recursive: true });

  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [cliPath, "packet", "validate", runDir, "--json"],
    { encoding: "utf-8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.runDir, runDir);
  assert.equal(payload.artifactCount, 6);
  assert.equal(payload.eventCount, 1);
});
