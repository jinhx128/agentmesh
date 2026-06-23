import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildStagePrompt } from "../packages/runtime/src/flow/prompt.js";
import { makeWorkspace } from "./helpers/write-side-runtime.js";

test("prompt assembly references context without replaying local content", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const runDir = path.join(workspace, ".agentmesh", "runs", "bounded-context-prompt");
  mkdirSync(runDir, { recursive: true });

  writeFileSync(
    path.join(runDir, "status.json"),
    JSON.stringify(
      {
        schema_version: 1,
        run_id: "bounded-context-prompt",
        workflow: "bounded-context-prompt",
        stages: ["plan"],
        stage_nodes: [{ id: "plan", type: "plan", occurrence: 1 }],
        stage_assignments: {
          plan: ["current"],
        },
        completed_stages: [],
        current_stage: "plan",
        stage_state: {},
        stage_attempts: {},
        user_gate: false,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(path.join(runDir, "request.md"), "# Request\n\nInspect bounded context.\n");
  writeFileSync(path.join(runDir, "assignment.toml"), "[stage_assignments]\nplan = [\"current\"]\n");
  const context = ["# Context", "", "CONTEXT_PREFIX", "x".repeat(50_000), "CONTEXT_TAIL_SHOULD_NOT_REPLAY"].join("\n");
  writeFileSync(path.join(runDir, "context.md"), context);

  const prompt = buildStagePrompt(runDir, "plan", workspace);

  assert.match(prompt, /Packet Directory: \.agentmesh\/runs\/bounded-context-prompt/);
  assert.match(prompt, /## Context Reference/);
  assert.match(prompt, /Context artifact: context\.md/);
  assert.match(prompt, /Context path: \.agentmesh\/runs\/bounded-context-prompt\/context\.md/);
  assert.match(prompt, new RegExp(`Context bytes: ${Buffer.byteLength(context, "utf-8")}`));
  assert.match(prompt, /Read or scan the context path above only when needed/);
  assert.doesNotMatch(prompt, /CONTEXT_PREFIX/);
  assert.doesNotMatch(prompt, /AgentMesh prompt assembly truncated context\.md/);
  assert.doesNotMatch(prompt, /CONTEXT_TAIL_SHOULD_NOT_REPLAY/);
  assert.ok(Buffer.byteLength(prompt, "utf-8") < 6_000, "prompt should reference context instead of replaying it");
});

test("prompt assembly displays absolute packet directory when run is outside cwd", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const runDir = path.join(workspace, ".agentmesh", "runs", "absolute-context-prompt");
  mkdirSync(runDir, { recursive: true });

  writeFileSync(
    path.join(runDir, "status.json"),
    JSON.stringify(
      {
        schema_version: 1,
        run_id: "absolute-context-prompt",
        workflow: "absolute-context-prompt",
        stages: ["plan"],
        stage_nodes: [{ id: "plan", type: "plan", occurrence: 1 }],
        stage_assignments: {
          plan: ["current"],
        },
        completed_stages: [],
        current_stage: "plan",
        stage_state: {},
        stage_attempts: {},
        user_gate: false,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(path.join(runDir, "request.md"), "# Request\n\nInspect absolute packet path.\n");
  writeFileSync(path.join(runDir, "assignment.toml"), "[stage_assignments]\nplan = [\"current\"]\n");

  const prompt = buildStagePrompt(runDir, "plan", path.join(workspace, "elsewhere"));
  const displayRunDir = runDir.split(path.sep).join("/");

  assert.match(prompt, new RegExp(`Packet Directory: ${escapeRegExp(displayRunDir)}`));
});

test("prompt assembly bounds large release summaries", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const runDir = path.join(workspace, ".agentmesh", "runs", "bounded-release-summary-prompt");
  mkdirSync(runDir, { recursive: true });

  writeFileSync(
    path.join(runDir, "status.json"),
    JSON.stringify(
      {
        schema_version: 1,
        run_id: "bounded-release-summary-prompt",
        workflow: "bounded-release-summary-prompt",
        stages: ["decide"],
        stage_nodes: [{ id: "decide", type: "decide", occurrence: 1 }],
        stage_assignments: {
          decide: ["current"],
        },
        completed_stages: [],
        current_stage: "decide",
        stage_state: {},
        stage_attempts: {},
        user_gate: false,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(path.join(runDir, "request.md"), "# Request\n\nInspect bounded release summary.\n");
  writeFileSync(path.join(runDir, "assignment.toml"), "[stage_assignments]\ndecide = [\"current\"]\n");
  writeFileSync(
    path.join(runDir, "release-summary.md"),
    [
      "# Release Evidence Summary",
      "",
      "RELEASE_SUMMARY_PREFIX",
      "x".repeat(50_000),
      "RELEASE_SUMMARY_TAIL_SHOULD_NOT_REPLAY",
      "",
    ].join("\n"),
  );

  const prompt = buildStagePrompt(runDir, "decide", workspace);

  assert.match(prompt, /RELEASE_SUMMARY_PREFIX/);
  assert.match(prompt, /AgentMesh prompt assembly truncated release-summary\.md/);
  assert.match(prompt, /showing 24000\/[0-9]+ bytes/);
  assert.doesNotMatch(prompt, /RELEASE_SUMMARY_TAIL_SHOULD_NOT_REPLAY/);
  assert.ok(Buffer.byteLength(prompt, "utf-8") < 30_000, "prompt should not replay full release summary");
});

test("prompt assembly truncates long prior review raw outputs while preserving ordered labels", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const runDir = path.join(workspace, ".agentmesh", "runs", "bounded-review-prompt");
  mkdirSync(path.join(runDir, "reviews", "review_2"), { recursive: true });

  const firstReview = [
    "FIRST_REVIEW_START",
    "a".repeat(9_000),
    "FIRST_REVIEW_TAIL_SHOULD_NOT_REPLAY",
  ].join("\n");
  const secondReview = [
    "SECOND_REVIEW_START",
    "b".repeat(9_000),
    "SECOND_REVIEW_TAIL_SHOULD_NOT_REPLAY",
  ].join("\n");
  const repeatedReview = [
    "REPEATED_REVIEW_START",
    "c".repeat(9_000),
    "REPEATED_REVIEW_TAIL_SHOULD_NOT_REPLAY",
  ].join("\n");

  writeFileSync(
    path.join(runDir, "status.json"),
    JSON.stringify(
      {
        schema_version: 1,
        run_id: "bounded-review-prompt",
        workflow: "bounded-review-prompt",
        stages: ["plan", "review", "decide", "review", "decide"],
        stage_nodes: [
          { id: "plan", type: "plan", occurrence: 1 },
          { id: "review", type: "review", occurrence: 1 },
          { id: "decide", type: "decide", occurrence: 1 },
          { id: "review_2", type: "review", occurrence: 2 },
          { id: "decide_2", type: "decide", occurrence: 2 },
        ],
        stage_assignments: {
          plan: ["current"],
          review: ["reviewer_a", "reviewer_b"],
          decide: ["current"],
          review_2: ["reviewer_c"],
          decide_2: ["current"],
        },
        completed_stages: ["plan", "review", "decide", "review_2"],
        current_stage: "decide_2",
        stage_state: {},
        stage_attempts: {},
        user_gate: false,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(path.join(runDir, "request.md"), "# Request\n\nShip bounded prompt evidence.\n");
  writeFileSync(path.join(runDir, "assignment.toml"), "[stage_assignments]\ndecide_2 = [\"current\"]\n");
  writeFileSync(path.join(runDir, "plan.md"), "# Plan\n\nUse ordered evidence.\n");
  writeFileSync(
    path.join(runDir, "findings.md"),
    [
      "# Findings",
      "",
      "First review summary.",
      "",
      "## Raw Review Outputs",
      "",
      "### reviewer_a",
      "",
      firstReview,
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(runDir, "decision.md"), "# Decision\n\nContinue after first review.\n");
  writeFileSync(
    path.join(runDir, "findings_2.md"),
    [
      "# Findings",
      "",
      "Repeated review summary.",
      "",
      "## Raw Review Outputs",
      "",
      "### reviewer_c",
      "",
      repeatedReview,
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(runDir, "reviews", "reviewer_a.md"), firstReview + "\n");
  writeFileSync(path.join(runDir, "reviews", "reviewer_b.md"), secondReview + "\n");
  writeFileSync(path.join(runDir, "reviews", "review_2", "reviewer_c.md"), repeatedReview + "\n");

  const prompt = buildStagePrompt(runDir, "decide_2", workspace);

  assert.match(prompt, /## Prior Output: review \(Findings\)/);
  assert.match(prompt, /## Prior Output: decide \(Decision\)/);
  assert.match(prompt, /## Prior Output: review_2 \(Findings\)/);
  assert.match(prompt, /## Prior Raw Reviews: review \(review\)/);
  assert.match(prompt, /## Prior Raw Reviews: review_2 \(review\)/);
  assert.match(prompt, /AgentMesh prompt assembly truncated/);
  assert.match(prompt, /First review summary/);
  assert.match(prompt, /Repeated review summary/);
  assert.doesNotMatch(prompt, /FIRST_REVIEW_TAIL_SHOULD_NOT_REPLAY/);
  assert.doesNotMatch(prompt, /SECOND_REVIEW_TAIL_SHOULD_NOT_REPLAY/);
  assert.doesNotMatch(prompt, /REPEATED_REVIEW_TAIL_SHOULD_NOT_REPLAY/);
  assert.ok(Buffer.byteLength(prompt, "utf-8") < 18_000, "prompt should stay bounded");
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
