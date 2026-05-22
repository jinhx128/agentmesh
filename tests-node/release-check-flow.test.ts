import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { BUILTIN_WORKFLOW_IDS } from "@agentmesh/core";
import { makeWorkspace, runCli, writeConfig, writeExecutable } from "./helpers/write-side-runtime.js";

test("dispatch all writes release-check summary and records release verdict", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const agent = path.join(workspace, "release-agent.sh");
  writeExecutable(
    agent,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "prompt_file=''",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --prompt-file) prompt_file=\"$2\"; shift 2 ;;",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "if grep -q 'Stage: decide' \"$prompt_file\"; then",
      "  printf '# Decision\\n\\nVerdict: ready\\n' > \"$output_file\"",
      "else",
      "  printf '# Review\\n\\nNo blockers.\\n' > \"$output_file\"",
      "fi",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.worker]",
      'label = "Worker"',
      'adapter = "command"',
      `command = "${agent}"`,
      "args = []",
      'capabilities = ["review", "decide"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(workspace, "diff.txt"), "diff --git a/a.ts b/a.ts\n+ok\n");
  writeFileSync(path.join(workspace, "verify.txt"), "make check\n47 passed\n");

  const run = runCli(workspace, [
    "--config",
    config,
    "run",
    "--workflow",
    "w-67ef1b1f",
    "--review",
    "worker",
    "--decide",
    "worker",
    "--diff-file",
    "diff.txt",
    "--verification-file",
    "verify.txt",
    "--task",
    "release gate",
    "--run-id",
    "release-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, ["--config", config, "flow", "dispatch", "release-flow", "--stage", "all"]);
  assert.equal(dispatch.status, 0, dispatch.stderr);
  assert.match(dispatch.stdout, /Dispatched: review, decide/);

  const runDir = path.join(workspace, ".agentmesh", "runs", "release-flow");
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.completed_stages, ["review", "decide"]);
  assert.equal(status.release_verdict.value, "ready");
  assert.match(readFileSync(path.join(runDir, "release-summary.md"), "utf-8"), /47 passed/);
  assert.equal(existsSync(path.join(runDir, "reviews", "worker.md")), true);
});

test("release verdict is recorded only for the final release-check decide node", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const releaseCheckWorkflowFile = "release-check.toml";
  writeFileSync(
    path.join(workspace, releaseCheckWorkflowFile),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["review", "decide", "review", "decide"]',
      'description = "Release check with an intermediate decision checkpoint."',
      'when_to_use = ["A release needs two decision checkpoints."]',
      'packet_artifacts = ["request.md", "findings.md", "decision.md", "findings_2.md", "decision_2.md"]',
      'quality_gates = ["Only the final decide records release verdict."]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
      "flow",
      "run",
      "--workflow-file",
      releaseCheckWorkflowFile,
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "checkpoint release gate",
    "--run-id",
    "checkpoint-release-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "checkpoint-release-flow");
  const createdStatus = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  writeFileSync(
    path.join(runDir, "status.json"),
    JSON.stringify({ ...createdStatus, workflow: BUILTIN_WORKFLOW_IDS.RELEASE_CHECK }, null, 2),
  );

  assert.equal(
    runCli(workspace, [
      "flow",
      "attach",
      "checkpoint-release-flow",
      "--stage",
      "review",
      "--text",
      "# Findings\n\nNo blockers yet.",
    ]).status,
    0,
  );
  assert.equal(
    runCli(workspace, [
      "flow",
      "attach",
      "checkpoint-release-flow",
      "--stage",
      "decide",
      "--text",
      "# Decision\n\nContinue to second review.",
    ]).status,
    0,
  );

  const afterCheckpoint = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.equal(afterCheckpoint.release_verdict, undefined);
  assert.equal(existsSync(path.join(runDir, "decision.md")), true);

  assert.equal(
    runCli(workspace, [
      "flow",
      "attach",
      "checkpoint-release-flow",
      "--stage",
      "review_2",
      "--text",
      "# Findings\n\nSecond review complete.",
    ]).status,
    0,
  );
  assert.equal(
    runCli(workspace, [
      "flow",
      "attach",
      "checkpoint-release-flow",
      "--stage",
      "decide_2",
      "--text",
      "# Decision\n\nVerdict: ready",
    ]).status,
    0,
  );

  const finalStatus = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.equal(finalStatus.release_verdict.value, "ready");
  assert.deepEqual(finalStatus.completed_stages, ["review", "decide", "review_2", "decide_2"]);
  assert.match(readFileSync(path.join(runDir, "decision_2.md"), "utf-8"), /Verdict: ready/);
});

test("release-check decide fanout records verdict from synthesized decision", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const agent = path.join(workspace, "release-fanout-agent.sh");
  writeExecutable(
    agent,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "prompt_file=''",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --prompt-file) prompt_file=\"$2\"; shift 2 ;;",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "agent_name=$(basename \"$output_file\" .md)",
      "if [[ \"$output_file\" == */decision.md ]]; then",
      "  grep -q \"## Fanout Outputs\" \"$prompt_file\"",
      "  grep -q \"decider_a says ready\" \"$prompt_file\"",
      "  grep -q \"decider_b says not ready\" \"$prompt_file\"",
      "  printf '# Decision\\n\\nVerdict: ready\\n\\nSynthesized release decision.\\n' > \"$output_file\"",
      "elif grep -q 'Stage: decide' \"$prompt_file\"; then",
      "  if [[ \"$agent_name\" == \"decider_b\" ]]; then",
      "    printf '# Decision\\n\\nVerdict: not_ready\\n\\n%s says not ready.\\n' \"$agent_name\" > \"$output_file\"",
      "  else",
      "    printf '# Decision\\n\\n%s says ready.\\n' \"$agent_name\" > \"$output_file\"",
      "  fi",
      "else",
      "  printf '# Review\\n\\nNo blockers.\\n' > \"$output_file\"",
      "fi",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.reviewer]",
      'label = "Reviewer"',
      'adapter = "command"',
      `command = "${agent}"`,
      "args = []",
      'capabilities = ["review"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.decider_a]",
      'label = "Decider A"',
      'adapter = "command"',
      `command = "${agent}"`,
      "args = []",
      'capabilities = ["decide"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.decider_b]",
      'label = "Decider B"',
      'adapter = "command"',
      `command = "${agent}"`,
      "args = []",
      'capabilities = ["decide"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "run",
    "--workflow",
    "w-67ef1b1f",
    "--review",
    "reviewer",
    "--decide",
    "decider_a",
    "--decide",
    "decider_b",
    "--task",
    "release gate fanout",
    "--run-id",
    "release-decide-fanout-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "release-decide-fanout-flow",
    "--stage",
    "all",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);
  assert.match(dispatch.stdout, /Dispatched: review, decide/);

  const runDir = path.join(workspace, ".agentmesh", "runs", "release-decide-fanout-flow");
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.equal(status.release_verdict.value, "ready");
  assert.match(readFileSync(path.join(runDir, "decision.md"), "utf-8"), /Synthesized release decision/);
  assert.match(
    readFileSync(path.join(runDir, "outputs", "decide", "decider_a.md"), "utf-8"),
    /decider_a says ready/,
  );
  assert.match(
    readFileSync(path.join(runDir, "outputs", "decide", "decider_b.md"), "utf-8"),
    /Verdict: not_ready/,
  );
});

test("release-check decide fanout records non-ready synthesized verdicts", () => {
  for (const verdict of ["not_ready", "needs_decision"]) {
    const workspace = makeWorkspace();
    test.after(() => rmSync(workspace, { recursive: true, force: true }));
    const agent = path.join(workspace, "release-fanout-agent.sh");
    writeExecutable(
      agent,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "prompt_file=''",
        "output_file=''",
        "while [[ $# -gt 0 ]]; do",
        "  case \"$1\" in",
        "    --prompt-file) prompt_file=\"$2\"; shift 2 ;;",
        "    --output-file) output_file=\"$2\"; shift 2 ;;",
        "    *) shift ;;",
        "  esac",
        "done",
        "if [[ \"$output_file\" == */decision.md ]]; then",
        `  printf '# Decision\\n\\nVerdict: ${verdict}\\n\\nSynthesized release decision.\\n' > "$output_file"`,
        "elif grep -q 'Stage: decide' \"$prompt_file\"; then",
        "  printf '# Decision\\n\\nRaw decision evidence.\\n' > \"$output_file\"",
        "else",
        "  printf '# Review\\n\\nNo blockers.\\n' > \"$output_file\"",
        "fi",
        "",
      ].join("\n"),
    );
    const config = writeConfig(
      workspace,
      [
        "[agents.reviewer]",
        'label = "Reviewer"',
        'adapter = "command"',
        `command = "${agent}"`,
        "args = []",
        'capabilities = ["review"]',
        'prompt_file_arg = "--prompt-file"',
        'output_file_arg = "--output-file"',
        "",
        "[agents.decider_a]",
        'label = "Decider A"',
        'adapter = "command"',
        `command = "${agent}"`,
        "args = []",
        'capabilities = ["decide"]',
        'prompt_file_arg = "--prompt-file"',
        'output_file_arg = "--output-file"',
        "",
        "[agents.decider_b]",
        'label = "Decider B"',
        'adapter = "command"',
        `command = "${agent}"`,
        "args = []",
        'capabilities = ["decide"]',
        'prompt_file_arg = "--prompt-file"',
        'output_file_arg = "--output-file"',
        "",
      ].join("\n"),
    );
    const runId = `release-decide-fanout-${verdict}-flow`;
    const run = runCli(workspace, [
      "--config",
      config,
      "run",
      "--workflow",
      "w-67ef1b1f",
      "--review",
      "reviewer",
      "--decide",
      "decider_a",
      "--decide",
      "decider_b",
      "--task",
      `release gate fanout ${verdict}`,
      "--run-id",
      runId,
    ]);
    assert.equal(run.status, 0, run.stderr);

    const dispatch = runCli(workspace, ["--config", config, "flow", "dispatch", runId, "--stage", "all"]);
    assert.equal(dispatch.status, 0, dispatch.stderr);

    const status = JSON.parse(readFileSync(path.join(workspace, ".agentmesh", "runs", runId, "status.json"), "utf-8"));
    assert.equal(status.release_verdict.value, verdict);
  }
});

test("release-check decide fanout rejects synthesized decision without verdict", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const agent = path.join(workspace, "release-invalid-agent.sh");
  writeExecutable(
    agent,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "prompt_file=''",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --prompt-file) prompt_file=\"$2\"; shift 2 ;;",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "if [[ \"$output_file\" == */decision.md ]]; then",
      "  printf '# Decision\\n\\nSynthesized without release verdict.\\n' > \"$output_file\"",
      "elif grep -q 'Stage: decide' \"$prompt_file\"; then",
      "  printf '# Decision\\n\\nRaw decision evidence.\\n' > \"$output_file\"",
      "else",
      "  printf '# Review\\n\\nNo blockers.\\n' > \"$output_file\"",
      "fi",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.reviewer]",
      'label = "Reviewer"',
      'adapter = "command"',
      `command = "${agent}"`,
      "args = []",
      'capabilities = ["review"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.decider_a]",
      'label = "Decider A"',
      'adapter = "command"',
      `command = "${agent}"`,
      "args = []",
      'capabilities = ["decide"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.decider_b]",
      'label = "Decider B"',
      'adapter = "command"',
      `command = "${agent}"`,
      "args = []",
      'capabilities = ["decide"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );
  const run = runCli(workspace, [
    "--config",
    config,
    "run",
    "--workflow",
    "w-67ef1b1f",
    "--review",
    "reviewer",
    "--decide",
    "decider_a",
    "--decide",
    "decider_b",
    "--task",
    "release gate invalid fanout",
    "--run-id",
    "release-decide-fanout-invalid-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "release-decide-fanout-invalid-flow",
    "--stage",
    "all",
  ]);
  assert.equal(dispatch.status, 1);
  assert.match(dispatch.stderr, /release decision must contain exactly one Verdict line; found 0/);

  const status = JSON.parse(readFileSync(path.join(workspace, ".agentmesh", "runs", "release-decide-fanout-invalid-flow", "status.json"), "utf-8"));
  assert.equal(status.status, "decide_failed");
  assert.equal(status.failed_stage, "decide");
  assert.deepEqual(status.completed_stages, ["review"]);
  assert.equal(status.release_verdict.value, undefined);
  const events = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "release-decide-fanout-invalid-flow", "events.jsonl"),
    "utf-8",
  );
  assert.match(events, /"event":"release\.verdict_invalid"/);
  assert.match(events, /"node_id":"decide"/);
});

test("release verdict parsing ignores fenced examples and normalizes markdown values", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const run = runCli(workspace, [
    "run",
    "--workflow",
    "w-67ef1b1f",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "release gate",
    "--run-id",
    "verdict-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const attachReview = runCli(workspace, [
    "flow",
    "attach",
    "verdict-flow",
    "--stage",
    "review",
    "--text",
    "# Review\n\nReady for decision.",
  ]);
  assert.equal(attachReview.status, 0, attachReview.stderr);

  const attach = runCli(workspace, [
    "flow",
    "attach",
    "verdict-flow",
    "--stage",
    "decide",
    "--text",
    [
      "# Decision",
      "",
      "```md",
      "Verdict: not_ready",
      "```",
      "",
      "- **Verdict**: `ready`",
      "",
    ].join("\n"),
  ]);
  assert.equal(attach.status, 0, attach.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "verdict-flow", "status.json"), "utf-8"),
  );
  assert.equal(status.release_verdict.value, "ready");
});
