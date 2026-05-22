import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { makeWorkspace, runCli, writeConfig, writeExecutable } from "./helpers/write-side-runtime.js";

test("retry records retry events and protects completed artifacts", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const flaky = path.join(workspace, "flaky-agent.sh");
  writeExecutable(
    flaky,
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
      "if grep -q 'Stage: execute' \"$prompt_file\" && [[ ! -f fail-once.done ]]; then",
      "  touch fail-once.done",
      "  exit 7",
      "fi",
      "printf '# Output\\n\\nStage completed.\\n' > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.flaky]",
      'label = "Flaky"',
      'adapter = "command"',
      `command = "${flaky}"`,
      "args = []",
      'capabilities = ["plan", "execute", "review", "decide"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );
  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--plan",
    "flaky",
    "--execute",
    "flaky",
    "--review",
    "flaky",
    "--decide",
    "flaky",
    "--task",
    "exercise retry",
    "--run-id",
    "retry-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const attachPlan = runCli(workspace, [
    "flow",
    "attach",
    "retry-flow",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nReady for retry exercise.",
  ]);
  assert.equal(attachPlan.status, 0, attachPlan.stderr);

  const failed = runCli(workspace, ["--config", config, "flow", "dispatch", "retry-flow", "--stage", "execute"]);
  assert.equal(failed.status, 1);
  let status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "retry-flow", "status.json"), "utf-8"),
  );
  assert.equal(status.failed_stage, "execute");

  const retried = runCli(workspace, ["--config", config, "flow", "retry", "retry-flow"]);
  assert.equal(retried.status, 0, retried.stderr);
  assert.match(retried.stdout, /Dispatched: execute/);

  const protectedRetry = runCli(workspace, [
    "--config",
    config,
    "flow",
    "retry",
    "retry-flow",
    "--stage",
    "execute",
  ]);
  assert.equal(protectedRetry.status, 1);
  assert.match(protectedRetry.stderr, /completed stage/);

  const resumed = runCli(workspace, ["--config", config, "flow", "resume", "retry-flow", "--stage", "review"]);
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stdout, /Dispatched: review, decide/);

  status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "retry-flow", "status.json"), "utf-8"),
  );
  assert.deepEqual(status.completed_stages, ["plan", "execute", "review", "decide"]);
  assert.deepEqual(status.stage_attempts.execute.map((attempt: { lane_id: string }) => attempt.lane_id), [
    "execute:flaky",
    "execute:flaky",
  ]);
  assert.deepEqual(status.stage_attempts.execute.map((attempt: { lane_attempt: number }) => attempt.lane_attempt), [
    1,
    2,
  ]);
  assert.deepEqual(status.stage_attempts.execute.map((attempt: { status: string }) => attempt.status), [
    "failed",
    "completed",
  ]);
  const events = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "retry-flow", "events.jsonl"),
    "utf-8",
  );
  assert.match(events, /stage.retry_requested/);
  const runDir = path.join(workspace, ".agentmesh", "runs", "retry-flow");
  const findings = readFileSync(path.join(runDir, "findings.md"), "utf-8");
  assert.match(findings, /Raw Review Outputs/);
  assert.match(findings, /Stage completed/);
  const decidePrompt = readFileSync(path.join(runDir, "prompts", "decide.md"), "utf-8");
  assert.match(decidePrompt, /## Assignment/);
  assert.match(decidePrompt, /Prior Output: execute \(Handoff\)/);
  assert.match(decidePrompt, /Prior Output: review \(Findings\)/);
  assert.match(decidePrompt, /Stage completed/);
});

test("retry and resume target repeated stage node ids exactly", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const flaky = path.join(workspace, "repeated-flaky.sh");
  writeExecutable(
    flaky,
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
      "case \"$output_file\" in",
      "  */plan.md) printf '# Plan\\n\\nRepeated plan.\\n' > \"$output_file\" ;;",
      "  */handoff.md) printf '# Handoff\\n\\nFirst execute stable.\\n' > \"$output_file\" ;;",
      "  */reviews/flaky.md) printf '# Review\\n\\nFirst review stable.\\n' > \"$output_file\" ;;",
      "  */handoff_2.md)",
      "    if [[ ! -f execute_2.failed ]]; then touch execute_2.failed; exit 7; fi",
      "    grep -q 'findings.md' \"$prompt_file\"",
      "    printf '# Handoff\\n\\nSecond execute after retry.\\n' > \"$output_file\" ;;",
      "  */reviews/review_2/flaky.md) printf '# Review\\n\\nSecond review after retry.\\n' > \"$output_file\" ;;",
      "  */decision.md) printf '# Decision\\n\\nRepeated decision.\\n' > \"$output_file\" ;;",
      "  *) echo \"unexpected output path: $output_file\" >&2; exit 8 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.flaky]",
      'label = "Flaky"',
      'adapter = "command"',
      `command = "${flaky}"`,
      "args = []",
      'capabilities = ["plan", "execute", "review", "decide"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "repeated.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["plan", "execute", "review", "execute", "review", "decide"]',
      'description = "Exercise repeated retry and resume."',
      'when_to_use = ["A second execute may need retry."]',
      'packet_artifacts = ["request.md", "plan.md", "handoff.md", "findings.md", "handoff_2.md", "findings_2.md", "decision.md"]',
      'quality_gates = ["Retry targets node ids."]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow-file",
    "repeated.toml",
    "--plan",
    "flaky",
    "--execute",
    "flaky",
    "--review",
    "flaky",
    "--decide",
    "flaky",
    "--task",
    "repeated retry",
    "--run-id",
    "repeated-retry-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const failed = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "repeated-retry-flow",
    "--stage",
    "all",
  ]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /stage 'execute_2' failed for agent 'flaky' with exit code 7/);

  const runDir = path.join(workspace, ".agentmesh", "runs", "repeated-retry-flow");
  let status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.equal(status.failed_stage, "execute_2");
  assert.deepEqual(status.completed_stages, ["plan", "execute", "review"]);
  assert.match(readFileSync(path.join(runDir, "handoff.md"), "utf-8"), /First execute stable/);

  const wrongRetry = runCli(workspace, [
    "--config",
    config,
    "flow",
    "retry",
    "repeated-retry-flow",
    "--stage",
    "execute",
  ]);
  assert.equal(wrongRetry.status, 1);
  assert.match(wrongRetry.stderr, /cannot retry completed stage/);

  const retried = runCli(workspace, [
    "--config",
    config,
    "flow",
    "retry",
    "repeated-retry-flow",
  ]);
  assert.equal(retried.status, 0, retried.stderr);
  assert.match(retried.stdout, /Dispatched: execute_2/);
  assert.match(readFileSync(path.join(runDir, "handoff_2.md"), "utf-8"), /Second execute after retry/);

  const resumed = runCli(workspace, [
    "--config",
    config,
    "flow",
    "resume",
    "repeated-retry-flow",
    "--stage",
    "review_2",
  ]);
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stdout, /Dispatched: review_2, decide/);

  status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.completed_stages, [
    "plan",
    "execute",
    "review",
    "execute_2",
    "review_2",
    "decide",
  ]);
  assert.match(readFileSync(path.join(runDir, "findings_2.md"), "utf-8"), /Second review after retry/);
});
