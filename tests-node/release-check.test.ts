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

import { loadArtifacts, PacketStatus } from "../packages/runtime/src/packet/io.js";
import {
  buildReleaseEvidenceSummary,
  refreshReleaseEvidenceSummary,
} from "../packages/runtime/src/release/check.js";

function makeReleaseRunDir(): string {
  const runDir = mkdtempSync(path.join(tmpdir(), "agentmesh-release-"));
  const status: PacketStatus = {
    schema_version: 1,
    run_id: "release-ts",
    created_at: "2026-05-14T00:00:00.000Z",
    updated_at: "2026-05-14T00:00:00.000Z",
    status: "review_completed",
    stages: ["review", "decide"],
    stage_nodes: [
      { id: "review", type: "review", occurrence: 1 },
      { id: "decide", type: "decide", occurrence: 1 },
    ],
    stage_assignments: {
      review: ["current"],
      decide: ["current"],
    },
    stage_invocations: {
      review: [{ lane_id: "review:current", kind: "current", agent: "current", timeout_seconds: null }],
      decide: [{ lane_id: "decide:current", kind: "current", agent: "current", timeout_seconds: null }],
    },
    stage_failure_policies: {
      review: { mode: "allow", max_fallback_agents: 1 },
      decide: { mode: "allow", max_fallback_agents: 1 },
    },
    stage_fallbacks: {
      review: { agents: [], max_attempts_per_agent: 1 },
      decide: { agents: [], max_attempts_per_agent: 1 },
    },
    stage_attempts: {
      review: [],
      decide: [],
    },
    assignment_provenance: {
      review: "test",
      decide: "test",
    },
    fallback_provenance: {
      review: "none",
      decide: "none",
    },
    timeout_provenance: {
      review: {},
      decide: {},
    },
    completed_stages: ["review"],
    stage_timing: {
      review: {
        started_at: "2026-05-14T00:00:00.000Z",
        completed_at: "2026-05-14T00:00:01.000Z",
        duration_ms: 1000,
        attempt_count: 1,
      },
      decide: { attempt_count: 0 },
    },
    agent_timing: {},
    user_gate: false,
    workflow: "w-67ef1b1f",
  };
  writeFileSync(path.join(runDir, "status.json"), `${JSON.stringify(status, null, 2)}\n`);
  writeFileSync(
    path.join(runDir, "artifacts.toml"),
    [
      "schema_version = 1",
      "",
      "[artifacts.context]",
      'path = "context.md"',
      'kind = "context"',
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
      "[artifacts.status]",
      'path = "status.json"',
      'kind = "status"',
      'stage = "run"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(runDir, "events.jsonl"),
    [
      JSON.stringify({
        schema_version: 1,
        timestamp: "2026-05-14T00:00:00+00:00",
        event: "run.created",
      }),
      JSON.stringify({
        schema_version: 1,
        timestamp: "2026-05-14T00:01:00+00:00",
        event: "stage.completed",
        stage: "review",
        agent: "current",
      }),
    ].join("\n") + "\n",
  );
  writeFileSync(
    path.join(runDir, "context.md"),
    [
      "# Context",
      "",
      "## Diff",
      "",
      "diff --git a/app.ts b/app.ts",
      "+fixed",
      "",
      "## Verification",
      "",
      "npm test",
      "13 passed",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(runDir, "findings.md"),
    [
      "# Findings",
      "",
      "## Accepted",
      "",
      "- No release blocker.",
      "",
      "## Needs Decision",
      "",
      "- TBD",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(runDir, "handoff.md"),
    [
      "# Handoff",
      "",
      "## Not Verified",
      "",
      "- Browser smoke was skipped.",
      "",
      "## Remaining Risk",
      "",
      "- Manual deploy still needs an operator.",
      "",
    ].join("\n"),
  );
  mkdirSync(path.join(runDir, "reviews"));
  writeFileSync(path.join(runDir, "reviews", "gemini.md"), "No blockers found.\n");
  return runDir;
}

test("builds a release evidence summary from packet evidence", () => {
  const runDir = makeReleaseRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));

  const summary = buildReleaseEvidenceSummary(runDir, status);

  assert.match(summary, /^# Release Evidence Summary/);
  assert.match(summary, /Diff evidence: present/);
  assert.match(summary, /Verification evidence: present/);
  assert.match(summary, /Review outputs: present/);
  assert.match(summary, /Classified findings: present/);
  assert.match(summary, /13 passed/);
  assert.match(summary, /Manual deploy still needs an operator/);
  assert.match(summary, /No blockers found/);
  assert.match(summary, /stage\.completed stage=review agent=current/);
});

test("release summary records review release policy diagnostics", () => {
  const runDir = makeReleaseRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(runDir, "context.md"),
    [
      "# Context",
      "",
      "## Diff",
      "",
      "diff --git a/app.ts b/app.ts",
      "+fixed",
      "",
      "## Verification",
      "",
      "- TBD",
      "",
    ].join("\n"),
  );
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  status.resolved_review_release_policy = {
    source_layers: [{ source: "project", path: "/workspace/.agentmesh/config.toml" }],
    policy_hash: "sha256:test",
    required_review_profiles: ["reviewer.security"],
    resolved_reviewers: [{ profile: "reviewer.security", agent_ids: ["security_reviewer"] }],
    required_evidence: ["tests", "diff"],
    needs_decision_risks: ["security"],
    skipped_gates: [],
    missing_evidence: [],
  };

  const result = refreshReleaseEvidenceSummary(runDir, status);
  const summary = result.summary;
  const writtenStatus = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));

  assert.match(summary, /## Review\/Release Policy/);
  assert.match(summary, /Required review profiles: reviewer\.security/);
  assert.match(summary, /Resolved reviewers: reviewer\.security -> security_reviewer/);
  assert.match(summary, /Required evidence: tests, diff/);
  assert.match(summary, /Needs-decision risks: security/);
  assert.match(summary, /Missing policy evidence: tests/);
  assert.deepEqual(status.resolved_review_release_policy.missing_evidence, ["tests"]);
  assert.deepEqual(writtenStatus.resolved_review_release_policy.missing_evidence, ["tests"]);
});

test("marks scoped git diff command-only sections as missing evidence", () => {
  const runDir = makeReleaseRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(runDir, "context.md"),
    [
      "# Context",
      "",
      "## Scoped Git Diff",
      "",
      "Command: git diff HEAD -- src",
      "(no scoped diff)",
      "",
      "## Verification",
      "",
      "- TBD",
      "",
    ].join("\n"),
  );
  rmSync(path.join(runDir, "reviews"), { recursive: true, force: true });
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));

  const summary = buildReleaseEvidenceSummary(runDir, status);

  assert.match(summary, /Diff evidence: missing/);
  assert.match(summary, /Verification evidence: missing/);
  assert.match(summary, /Review outputs: missing/);
  assert.match(summary, /No diff evidence found in context\.md/);
  assert.match(summary, /No verification evidence found in context\.md/);
  assert.match(summary, /No reviewer output has been recorded yet/);
});

test("release summary gates only controller-classified reviewer findings", () => {
  const runDir = makeReleaseRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(runDir, "reviews", "gemini.md"),
    "[Must Fix] app.ts:1 - Raw reviewer blocker that still needs controller classification.\n",
  );
  writeFileSync(
    path.join(runDir, "findings.md"),
    [
      "# Findings",
      "",
      "## Accepted",
      "",
      "- TBD",
      "",
      "## Rejected",
      "",
      "- [source: gemini] [Must Fix] app.ts:1 - Rejected false positive.",
      "",
      "## Needs Decision",
      "",
      "- [source: gemini, claude] Conflict: reviewers disagree on release readiness.",
      "",
    ].join("\n"),
  );
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));

  const summary = buildReleaseEvidenceSummary(runDir, status);

  assert.match(summary, /Classified findings: present/);
  assert.match(summary, /Release gate source: controller-classified findings only/);
  assert.match(summary, /Raw reviewer Must Fix: evidence_only/);
  assert.match(summary, /Accepted Must Fix: missing/);
  assert.match(summary, /Rejected Must Fix: present/);
  assert.match(summary, /Needs Decision Must Fix: missing/);
  assert.match(summary, /Conflict source attribution: present/);
  assert.match(summary, /Raw reviewer blocker that still needs controller classification/);
});

test("release summary flags conflicting findings that lack reviewer source attribution", () => {
  const runDir = makeReleaseRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(runDir, "findings.md"),
    [
      "# Findings",
      "",
      "## Accepted",
      "",
      "- TBD",
      "",
      "## Rejected",
      "",
      "- TBD",
      "",
      "## Needs Decision",
      "",
      "- Conflict: one reviewer says ready and another says not ready.",
      "",
    ].join("\n"),
  );
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));

  const summary = buildReleaseEvidenceSummary(runDir, status);

  assert.match(summary, /Conflict source attribution: missing/);
});

test("release summary truncates context without splitting UTF-8 characters", () => {
  const runDir = makeReleaseRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(runDir, "context.md"),
    ["# Context", "", "## Verification", "", `${"a".repeat(999_999)}中文`].join("\n"),
  );
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));

  const summary = buildReleaseEvidenceSummary(runDir, status);

  assert.match(summary, /content truncated at 1000000 bytes/);
  assert.doesNotMatch(summary, /\uFFFD/);
});

test("release summary bounds raw review outputs", () => {
  const runDir = makeReleaseRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(runDir, "reviews", "gemini.md"),
    [
      "RAW_REVIEW_PREFIX",
      "x".repeat(12_000),
      "RAW_REVIEW_TAIL_SHOULD_NOT_REPLAY",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(runDir, "findings.md"),
    [
      "# Findings",
      "",
      "## Accepted",
      "",
      "- No release blocker.",
      "- Keep this note mentioning ## Raw Review Outputs as literal text.",
      "",
      "## Raw Review Outputs",
      "",
      "### gemini",
      "",
      "RAW_REVIEW_PREFIX",
      "x".repeat(12_000),
      "RAW_REVIEW_TAIL_SHOULD_NOT_REPLAY",
      "",
    ].join("\n"),
  );
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));

  const summary = buildReleaseEvidenceSummary(runDir, status);

  assert.match(summary, /RAW_REVIEW_PREFIX/);
  assert.match(summary, /Keep this note mentioning ## Raw Review Outputs as literal text/);
  assert.doesNotMatch(summary, /RAW_REVIEW_TAIL_SHOULD_NOT_REPLAY/);
  assert.match(summary, /AgentMesh release summary truncated raw review output reviews\/gemini\.md/);
});

test("refresh writes release-summary.md and records a release_summary artifact", () => {
  const runDir = makeReleaseRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));

  const result = refreshReleaseEvidenceSummary(runDir, status);

  assert.equal(result.written, true);
  assert.equal(result.summaryPath, path.join(runDir, "release-summary.md"));
  assert.match(readFileSync(result.summaryPath, "utf-8"), /Release Evidence Summary/);
  const artifacts = loadArtifacts(runDir);
  assert.deepEqual(artifacts.release_summary, {
    path: "release-summary.md",
    kind: "release-summary",
    stage: "review",
  });
});

test("release-check summary CLI writes and reports JSON", () => {
  const runDir = makeReleaseRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));

  const result = spawnSync(
    process.execPath,
    [cliPath, "release-check", "summary", runDir, "--write", "--json"],
    { encoding: "utf-8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.written, true);
  assert.equal(payload.runDir, runDir);
  assert.match(payload.summary, /Release Evidence Summary/);
  assert.match(readFileSync(path.join(runDir, "release-summary.md"), "utf-8"), /13 passed/);
});
