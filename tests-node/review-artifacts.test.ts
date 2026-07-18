import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadArtifacts, type PacketStatus } from "../packages/runtime/src/packet/io.js";
import { buildReleaseEvidenceSummary } from "../packages/runtime/src/release/check.js";
import {
  findingsWithRawReviews,
  findingsWithReviewerSessionProvenance,
  rawReviewOutputsMarkdown,
  reviewerSessionProvenanceMarkdown,
  recordReviewAgentFailure,
  recordRawReviewOutputArtifact,
  refreshFindingsRawReviews,
  reviewOutputPath,
} from "../packages/runtime/src/review/artifacts.js";

function makeRunDir(): string {
  const runDir = mkdtempSync(path.join(tmpdir(), "agentmesh-review-artifacts-"));
  writeFileSync(path.join(runDir, "events.jsonl"), "");
  writeFileSync(path.join(runDir, "artifacts.toml"), "schema_version = 1\n");
  return runDir;
}

test("review artifact helpers record raw output and refresh controller findings", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  const reviewPath = reviewOutputPath(runDir, "Gemini 3.1 Pro");
  mkdirSync(path.dirname(reviewPath), { recursive: true });
  writeFileSync(reviewPath, "[Must Fix] src/app.ts:1 - Example finding.\n");

  recordRawReviewOutputArtifact(runDir, "Gemini 3.1 Pro", reviewPath);
  assert.deepEqual(loadArtifacts(runDir).review_Gemini_3_1_Pro, {
    path: "reviews/Gemini_3_1_Pro.md",
    kind: "review-output",
    stage: "review",
    agent: "Gemini 3.1 Pro",
  });

  const raw = rawReviewOutputsMarkdown(runDir);
  assert.match(raw, /## Raw Review Outputs/);
  assert.match(raw, /### Gemini_3_1_Pro/);
  assert.match(raw, /Example finding/);

  refreshFindingsRawReviews(runDir);
  refreshFindingsRawReviews(runDir);
  const findings = readFileSync(path.join(runDir, "findings.md"), "utf-8");
  assert.equal(findings.match(/## Raw Review Outputs/g)?.length, 1);
  assert.doesNotMatch(findings, /\n\n\n## Raw Review Outputs/);
  assert.doesNotMatch(findings, /- TBD/);
  assert.match(findings, /## Accepted/);
  assert.match(findings, /Example finding/);
});

test("review artifact helpers combine failure notes with partial raw outputs", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  const reviewPath = reviewOutputPath(runDir, "reviewer_a");
  mkdirSync(path.dirname(reviewPath), { recursive: true });
  writeFileSync(reviewPath, "reviewer_a partial evidence.\n");

  recordRawReviewOutputArtifact(runDir, "reviewer_a", reviewPath);
  recordReviewAgentFailure(runDir, "reviewer_b", 7);

  const findings = readFileSync(path.join(runDir, "findings.md"), "utf-8");
  assert.match(findings, /Reviewer reviewer_b failed during review dispatch \(exit 7\)/);
  assert.match(findings, /## Raw Review Outputs/);
  assert.match(findings, /reviewer_a partial evidence/);
});

test("review artifact helpers strip only standalone raw review heading", () => {
  const findings = [
    "# Findings",
    "",
    "## Accepted",
    "",
    "- Keep this note mentioning ## Raw Review Outputs as literal text.",
    "",
    "## Raw Review Outputs",
    "",
    "### stale",
    "",
    "STALE_RAW_REVIEW_SHOULD_BE_REMOVED",
    "",
  ].join("\n");
  const rawReviews = [
    "## Raw Review Outputs",
    "",
    "### fresh",
    "",
    "Fresh bounded review output.",
    "",
  ].join("\n");

  const merged = findingsWithRawReviews(findings, rawReviews);

  assert.match(merged, /Keep this note mentioning ## Raw Review Outputs as literal text/);
  assert.doesNotMatch(merged, /STALE_RAW_REVIEW_SHOULD_BE_REMOVED/);
  assert.match(merged, /Fresh bounded review output/);
  assert.equal(merged.match(/^## Raw Review Outputs$/gm)?.length, 1);
});

test("review findings provenance is packet-derived, deterministic, and idempotent", () => {
  const provenance = reviewerSessionProvenanceMarkdown([
    { actual_agent: "reviewer_b", lane_id: "review:b", status: "completed", session_mode: "resumed", hermetic: false, non_hermetic_reason: "session_resume", session_ref: "rs-safe" },
    { actual_agent: "reviewer_a", lane_id: "review:a", status: "completed", session_mode: "resumed", hermetic: false, non_hermetic_reason: "session_resume" },
    { actual_agent: "fresh", lane_id: "review:fresh", status: "completed", session_mode: "fresh", hermetic: true },
  ], new Set(["reviewer_a", "reviewer_b"]));
  assert.match(provenance, /## Reviewer Session Provenance/);
  assert.match(provenance, /reviewer: reviewer_a[\s\S]*reviewer: reviewer_b/);
  assert.match(provenance, /hermetic: false/);
  assert.match(provenance, /non_hermetic_reason: session_resume/);
  assert.doesNotMatch(provenance, /rs-safe|session-test-123|raw-host-token/);

  const once = findingsWithReviewerSessionProvenance("# Findings\n", provenance);
  const twice = findingsWithReviewerSessionProvenance(once, provenance);
  assert.equal(twice.match(/## Reviewer Session Provenance/g)?.length, 1);
  assert.equal(reviewerSessionProvenanceMarkdown([{ actual_agent: "fresh", lane_id: "review:fresh", status: "completed", session_mode: "fresh", hermetic: true }], new Set(["fresh"])), "");
});

test("findings refresh composes provenance before raw outputs and excludes failed resumed attempts", () => {
  const provenance = reviewerSessionProvenanceMarkdown([
    { actual_agent: "failed_resume", lane_id: "review:failed", status: "failed", session_mode: "resumed", hermetic: false, non_hermetic_reason: "session_resume" },
    { actual_agent: "fresh_fallback", lane_id: "review:fallback", status: "completed", session_mode: "fallback_fresh", hermetic: true },
    { actual_agent: "resumed", lane_id: "review:resumed", status: "completed", session_mode: "resumed", hermetic: false, non_hermetic_reason: "session_resume" },
  ], new Set(["resumed"]));
  const raw = ["## Raw Review Outputs", "", "### resumed", "", "usable raw output"].join("\n");
  const once = findingsWithRawReviews(findingsWithReviewerSessionProvenance("# Findings\n", provenance), raw);
  const twice = findingsWithRawReviews(findingsWithReviewerSessionProvenance(once, provenance), raw);

  assert.equal(twice.match(/## Reviewer Session Provenance/g)?.length, 1);
  assert.equal(twice.match(/## Raw Review Outputs/g)?.length, 1);
  assert.ok(twice.indexOf("## Reviewer Session Provenance") < twice.indexOf("## Raw Review Outputs"));
  assert.match(twice, /reviewer: resumed/);
  assert.doesNotMatch(twice, /failed_resume|fresh_fallback/);
});

test("review provenance bounds reviewer lanes with an explicit deterministic marker", () => {
  const attempts = Array.from({ length: 40 }, (_, index) => ({
    actual_agent: `reviewer_${String(index).padStart(2, "0")}`,
    lane_id: `review:${String(index).padStart(2, "0")}`,
    status: "completed",
    session_mode: "resumed",
    hermetic: false,
    non_hermetic_reason: "session_resume",
  }));
  const usable = new Set(attempts.map((attempt) => attempt.actual_agent));
  const provenance = reviewerSessionProvenanceMarkdown(attempts, usable);

  assert.match(provenance, /truncated: true; shown_count: 31; total_count: 40/);
  assert.ok(Buffer.byteLength(provenance, "utf-8") <= 4_000);
  assert.match(provenance, /reviewer: reviewer_00/);
  assert.match(provenance, /reviewer: reviewer_30/);
  assert.doesNotMatch(provenance, /reviewer: reviewer_31/);
});

test("release summary reads the unified raw review output section", () => {
  const runDir = makeRunDir();
  test.after(() => rmSync(runDir, { recursive: true, force: true }));
  const reviewPath = reviewOutputPath(runDir, "mimo");
  mkdirSync(path.dirname(reviewPath), { recursive: true });
  writeFileSync(reviewPath, "No release blockers from mimo.\n");
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
  const status: PacketStatus = {
    schema_version: 1,
    run_id: "review-artifact-summary",
    created_at: "2026-05-14T00:00:00.000Z",
    updated_at: "2026-05-14T00:00:00.000Z",
    status: "review_completed",
    stages: ["review", "decide"],
    stage_nodes: [
      { id: "review", type: "review", occurrence: 1 },
      { id: "decide", type: "decide", occurrence: 1 },
    ],
    stage_assignments: {
      review: ["mimo"],
      decide: ["current"],
    },
    stage_invocations: {
      review: [{ lane_id: "review:mimo", kind: "primary", agent: "mimo", timeout_seconds: 900 }],
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

  const summary = buildReleaseEvidenceSummary(runDir, status);

  assert.match(summary, /Review outputs: present/);
  assert.match(summary, /## Raw Review Outputs/);
  assert.match(summary, /### mimo/);
  assert.match(summary, /No release blockers from mimo/);
});
