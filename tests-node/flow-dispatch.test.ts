import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadArtifacts } from "../packages/runtime/src/packet/io.js";
import { withRunMutationLockAsync } from "../packages/runtime/src/packet/lock.js";
import { dispatchFlowStage } from "../packages/runtime/src/flow/dispatch.js";
import { addCorrection, supersedeCorrection } from "../packages/runtime/src/corrections/index.js";
import {
  listRegisteredWorkspaces,
  recordWorkspaceActivity,
} from "../packages/runtime/src/workspaces/registry.js";
import {
  makeWorkspace,
  runCli,
  writeConfig,
  writeExecutable,
  writeRunMutationLock,
} from "./helpers/write-side-runtime.js";

// Session state-machine integration uses disposable fake CLIs. Production
// dispatch remains fresh-only unless this explicit experimental gate is set.
process.env.AGENTMESH_ENABLE_EXPERIMENTAL_REVIEWER_SESSIONS = "1";

function bashString(value: string): string {
  return JSON.stringify(value);
}

function workspaceRegistry(workspace: string): string {
  return path.join(workspace, ".home", ".config", "agentmesh", "workspaces.json");
}

function resetRecordedAt(workspace: string, timestamp: string): void {
  recordWorkspaceActivity(workspace, {
    registryPath: workspaceRegistry(workspace),
    now: timestamp,
  });
}

function assertWorkspaceRecordRefreshed(workspace: string, staleTimestamp: string): void {
  const entries = listRegisteredWorkspaces({ registryPath: workspaceRegistry(workspace) });
  const entry = entries.find((item) => item.path === realpathSync(workspace));
  assert.ok(entry, "workspace should be registered");
  assert.equal(entry.enabled, true);
  assert.notEqual(entry.last_recorded_at, staleTimestamp);
  assert.match(entry.last_recorded_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
}

function writeOutputAgent(scriptPath: string, body: string): void {
  writeExecutable(
    scriptPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "mkdir -p \"$(dirname \"$output_file\")\"",
      body,
      "",
    ].join("\n"),
  );
}

function generatedRunText(runDir: string): string {
  const files = readdirSync(runDir, { recursive: true })
    .map((entry) => path.join(runDir, entry.toString()))
    .filter((filePath) => statSync(filePath).isFile());
  return files.map((filePath) => readFileSync(filePath, "utf-8")).join("\n");
}

test("flow dispatch refreshes current workspace registry activity", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const staleTimestamp = "2026-06-10T00:00:00.000Z";
  const planner = path.join(workspace, "planner.sh");
  writeOutputAgent(planner, "printf '# Plan\\n\\nDispatched.\\n' > \"$output_file\"");
  const config = writeConfig(
    workspace,
    [
      "[agents.planner]",
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
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
    "planner",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "dispatch records workspace",
    "--run-id",
    "dispatch-records-workspace",
  ]);
  assert.equal(run.status, 0, run.stderr);
  resetRecordedAt(workspace, staleTimestamp);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "dispatch-records-workspace",
    "--stage",
    "plan",
  ]);

  assert.equal(dispatch.status, 0, dispatch.stderr);
  assertWorkspaceRecordRefreshed(workspace, staleTimestamp);
});

test("continuous review dispatch writes safe provenance then resumes without leaking the provider ID", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const reviewer = path.join(workspace, "reviewer-session.sh");
  const workflow = path.join(workspace, "review-only.toml");
  writeFileSync(workflow, [
    "schema_version = 1",
    "workflow_recipe_version = 1",
    "compatible_packet_schema_versions = [1]",
    'name = "Review Only"',
    'stages = ["review"]',
    'description = "Dispatch one review stage."',
    'when_to_use = ["Focused session dispatch test."]',
    'packet_artifacts = ["findings.md"]',
    'quality_gates = ["Review output exists."]',
    "",
  ].join("\n"));
  writeExecutable(
    reviewer,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "session='session-test-123'",
      "if [[ \"$*\" == *\"--resume\"* ]]; then printf 'resume\\n' >> \"$0.resume-marker\"; fi",
      "printf '%s\\n' \\",
      "  \"{\\\"type\\\":\\\"system\\\",\\\"subtype\\\":\\\"init\\\",\\\"session_id\\\":\\\"$session\\\"}\" \\",
      "  \"{\\\"type\\\":\\\"assistant\\\",\\\"session_id\\\":\\\"$session\\\",\\\"message\\\":{\\\"content\\\":[{\\\"type\\\":\\\"text\\\",\\\"text\\\":\\\"review output\\\"}]}}\" \\",
      "  \"{\\\"type\\\":\\\"result\\\",\\\"subtype\\\":\\\"success\\\",\\\"is_error\\\":false,\\\"session_id\\\":\\\"$session\\\",\\\"result\\\":\\\"review output\\\"}\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.reviewer]",
      'adapter = "claude-code-cli"',
      `command = "${reviewer}"`,
      "args = []",
      'model = "claude-sonnet-4-6"',
      'reasoning_effort = "high"',
      'capabilities = ["review"]',
      "",
    ].join("\n"),
  );
  const scope = "amscope_v1:11111111-1111-4111-8111-111111111111";
  for (const runId of ["session-first", "session-second"]) {
    const run = runCli(workspace, [
      "--config", config,
      "flow", "run",
      "--workflow-file", workflow, "--review", "reviewer",
      "--task", "session dispatch",
      "--review-session-mode", "interactive_continuous",
      "--host-kind", "codex", "--conversation-scope", scope,
      "--run-id", runId,
    ]);
    assert.equal(run.status, 0, run.stderr);
    const dispatch = runCli(workspace, ["--config", config, "flow", "dispatch", runId, "--stage", "review"]);
    assert.equal(dispatch.status, 0, dispatch.stderr);
  }
  const first = JSON.parse(readFileSync(path.join(workspace, ".agentmesh", "runs", "session-first", "status.json"), "utf-8"));
  const secondDir = path.join(workspace, ".agentmesh", "runs", "session-second");
  const second = JSON.parse(readFileSync(path.join(secondDir, "status.json"), "utf-8"));
  assert.equal(first.stage_attempts.review[0].session_mode, "fresh");
  assert.equal(first.stage_attempts.review[0].registry_write, true);
  assert.equal(second.stage_attempts.review[0].session_mode, "resumed");
  assert.equal(second.stage_attempts.review[0].hermetic, false);
  assert.equal(second.stage_attempts.review[0].non_hermetic_reason, "session_resume");
  const resumedPrompt = readFileSync(path.join(secondDir, "prompts", "review.md"), "utf-8");
  assert.equal(resumedPrompt.match(/## Since Last Reviewer Session Turn/g)?.length, 1);
  assert.match(resumedPrompt, /- previous_file_line_references_are_stale: true/);
  assert.match(resumedPrompt, /- authoritative_evidence: current packet request\/diff\/verification\/corrections/);
  assert.doesNotMatch(resumedPrompt, /session-test-123/);
  assert.equal(readFileSync(`${reviewer}.resume-marker`, "utf-8"), "resume\n");
  assert.doesNotMatch(readFileSync(`${reviewer}.resume-marker`, "utf-8"), /session-test-123/);
  const packetText = [
    readFileSync(path.join(secondDir, "status.json"), "utf-8"),
    readFileSync(path.join(secondDir, "events.jsonl"), "utf-8"),
    readFileSync(path.join(secondDir, "findings.md"), "utf-8"),
  ].join("\n");
  assert.doesNotMatch(packetText, /session-test-123/);
  assert.doesNotMatch(generatedRunText(secondDir), /session-test-123/);
});

test("correction impact controls real continuous dispatch resume without fingerprinting correction text", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const reviewer = path.join(workspace, "correction-reviewer.sh");
  const workflow = path.join(workspace, "review-only.toml");
  writeFileSync(workflow, [
    "schema_version = 1", "workflow_recipe_version = 1", "compatible_packet_schema_versions = [1]",
    'name = "Review Only"', 'stages = ["review"]', 'description = "Correction session test."',
    'when_to_use = ["Correction impact."]', 'packet_artifacts = ["findings.md"]', 'quality_gates = ["Review output exists."]', "",
  ].join("\n"));
  writeExecutable(reviewer, [
    "#!/usr/bin/env bash", "set -euo pipefail", "session='session-test-123'",
    "if [[ \"$*\" == *\"--resume\"* ]]; then printf 'resume\\n' >> \"$0.resume-marker\"; fi",
    "printf '%s\\n' \\",
    "  \"{\\\"type\\\":\\\"system\\\",\\\"subtype\\\":\\\"init\\\",\\\"session_id\\\":\\\"$session\\\"}\" \\",
    "  \"{\\\"type\\\":\\\"assistant\\\",\\\"session_id\\\":\\\"$session\\\",\\\"message\\\":{\\\"content\\\":[{\\\"type\\\":\\\"text\\\",\\\"text\\\":\\\"review output\\\"}]}}\" \\",
    "  \"{\\\"type\\\":\\\"result\\\",\\\"subtype\\\":\\\"success\\\",\\\"is_error\\\":false,\\\"session_id\\\":\\\"$session\\\",\\\"result\\\":\\\"review output\\\"}\"",
    "",
  ].join("\n"));
  const config = writeConfig(workspace, [
    "[agents.reviewer]", 'adapter = "claude-code-cli"', `command = "${reviewer}"`, "args = []",
    'model = "claude-sonnet-4-6"', 'reasoning_effort = "high"', 'capabilities = ["review"]', "",
  ].join("\n"));
  const scope = "amscope_v1:44444444-4444-4444-8444-444444444444";
  const run = (id: string) => {
    const created = runCli(workspace, ["--config", config, "flow", "run", "--workflow-file", workflow, "--review", "reviewer", "--task", "correction impact", "--review-session-mode", "interactive_continuous", "--host-kind", "codex", "--conversation-scope", scope, "--run-id", id]);
    assert.equal(created.status, 0, created.stderr);
    const dispatched = runCli(workspace, ["--config", config, "flow", "dispatch", id, "--stage", "review"]);
    assert.equal(dispatched.status, 0, dispatched.stderr);
    return path.join(workspace, ".agentmesh", "runs", id);
  };

  run("correction-first");
  addCorrection({ id: "data", scope: "review", statement: "DATA_CORRECTION", sessionImpact: "data" }, workspace);
  const dataRun = run("correction-data");
  assert.equal(JSON.parse(readFileSync(path.join(dataRun, "status.json"), "utf-8")).stage_attempts.review[0].session_mode, "resumed");
  assert.match(readFileSync(path.join(dataRun, "prompts", "review.md"), "utf-8"), /DATA_CORRECTION/);

  addCorrection({ id: "persona", scope: "review", statement: "PERSONA_TEXT_MUST_NOT_FINGERPRINT", sessionImpact: "persona" }, workspace);
  const personaRun = run("correction-persona");
  assert.equal(JSON.parse(readFileSync(path.join(personaRun, "status.json"), "utf-8")).stage_attempts.review[0].session_mode, "fresh");
  supersedeCorrection("persona", { id: "persona-v2", statement: "PERSONA_V2_TEXT", sessionImpact: "persona" }, workspace);
  const supersededRun = run("correction-supersede");
  assert.equal(JSON.parse(readFileSync(path.join(supersededRun, "status.json"), "utf-8")).stage_attempts.review[0].session_mode, "fresh");
  supersedeCorrection("persona-v2", { id: "persona-removed", statement: "ordinary data replacement", sessionImpact: "data" }, workspace);
  const removedRun = run("correction-removal");
  assert.equal(JSON.parse(readFileSync(path.join(removedRun, "status.json"), "utf-8")).stage_attempts.review[0].session_mode, "fresh");
  addCorrection({ id: "system", scope: "review", statement: "SYSTEM_TEXT_MUST_NOT_FINGERPRINT", sessionImpact: "system" }, workspace);
  const systemRun = run("correction-system");
  assert.equal(JSON.parse(readFileSync(path.join(systemRun, "status.json"), "utf-8")).stage_attempts.review[0].session_mode, "fresh");
  assert.equal(readFileSync(`${reviewer}.resume-marker`, "utf-8"), "resume\n");
  assert.doesNotMatch(generatedRunText(systemRun), /session-test-123/);
});

test("expired continuous reviewer resume recovers once before the existing lane can succeed", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const reviewer = path.join(workspace, "reviewer-expired-session.sh");
  const workflow = path.join(workspace, "review-only.toml");
  writeFileSync(workflow, [
    "schema_version = 1",
    "workflow_recipe_version = 1",
    "compatible_packet_schema_versions = [1]",
    'name = "Review Only"',
    'stages = ["review"]',
    'description = "Dispatch one review stage."',
    'when_to_use = ["Focused session failure recovery test."]',
    'packet_artifacts = ["findings.md"]',
    'quality_gates = ["Review output exists."]',
    "",
  ].join("\n"));
  writeExecutable(
    reviewer,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "session='session-test-123'",
      "if [[ \"$*\" == *\"--resume\"* ]]; then",
      "  printf 'resume\\n' >> \"$0.resume-marker\"",
      "  printf 'No conversation found with session ID: %s\\n' \"$session\" >&2",
      "  exit 1",
      "fi",
      "printf '%s\\n' \\",
      "  \"{\\\"type\\\":\\\"system\\\",\\\"subtype\\\":\\\"init\\\",\\\"session_id\\\":\\\"$session\\\"}\" \\",
      "  \"{\\\"type\\\":\\\"assistant\\\",\\\"session_id\\\":\\\"$session\\\",\\\"message\\\":{\\\"content\\\":[{\\\"type\\\":\\\"text\\\",\\\"text\\\":\\\"review output\\\"}]}}\" \\",
      "  \"{\\\"type\\\":\\\"result\\\",\\\"subtype\\\":\\\"success\\\",\\\"is_error\\\":false,\\\"session_id\\\":\\\"$session\\\",\\\"result\\\":\\\"review output\\\"}\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(workspace, [
    "[agents.reviewer]",
    'adapter = "claude-code-cli"',
    `command = "${reviewer}"`,
    "args = []",
    'model = "claude-sonnet-4-6"',
    'reasoning_effort = "high"',
    'capabilities = ["review"]',
    "",
  ].join("\n"));
  const scope = "amscope_v1:22222222-2222-4222-8222-222222222222";
  for (const runId of ["expired-first", "expired-second"]) {
    const run = runCli(workspace, [
      "--config", config,
      "flow", "run",
      "--workflow-file", workflow, "--review", "reviewer",
      "--task", "session expiry recovery",
      "--review-session-mode", "interactive_continuous",
      "--host-kind", "codex", "--conversation-scope", scope,
      "--run-id", runId,
    ]);
    assert.equal(run.status, 0, run.stderr);
    const dispatch = runCli(workspace, ["--config", config, "flow", "dispatch", runId, "--stage", "review"]);
    assert.equal(dispatch.status, 0, dispatch.stderr);
  }
  const secondDir = path.join(workspace, ".agentmesh", "runs", "expired-second");
  const second = JSON.parse(readFileSync(path.join(secondDir, "status.json"), "utf-8"));
  assert.equal(second.stage_attempts.review[0].session_mode, "fallback_fresh");
  assert.equal(second.stage_attempts.review[0].registry_write, true);
  assert.doesNotMatch(readFileSync(path.join(secondDir, "prompts", "review.md"), "utf-8"), /Since Last Reviewer Session Turn/);
  const events = readFileSync(path.join(secondDir, "events.jsonl"), "utf-8");
  assert.match(events, /reviewer_session\.resume_failed/);
  assert.match(events, /reviewer_session\.closed/);
  assert.match(events, /reviewer_session\.rotated/);
  assert.match(events, /reviewer_session\.fallback_fresh/);
  assert.equal(readFileSync(`${reviewer}.resume-marker`, "utf-8"), "resume\n");
  assert.doesNotMatch(readFileSync(`${reviewer}.resume-marker`, "utf-8"), /session-test-123/);
  assert.doesNotMatch([
    readFileSync(path.join(secondDir, "status.json"), "utf-8"),
    events,
    readFileSync(path.join(secondDir, "findings.md"), "utf-8"),
  ].join("\n"), /session-test-123/);
  assert.doesNotMatch(generatedRunText(secondDir), /session-test-123/);
});

test("timed-out structured resume keeps timeout provenance and does not fresh recover", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const reviewer = path.join(workspace, "reviewer-timeout-session.sh");
  const workflow = path.join(workspace, "review-only.toml");
  writeFileSync(workflow, [
    "schema_version = 1", "workflow_recipe_version = 1", "compatible_packet_schema_versions = [1]",
    'name = "Review Only"', 'stages = ["review"]', 'description = "Timeout test."',
    'when_to_use = ["Timeout provenance."]', 'packet_artifacts = ["findings.md"]', 'quality_gates = ["Review."]', "",
  ].join("\n"));
  writeExecutable(reviewer, [
    "#!/usr/bin/env bash", "set -euo pipefail", "session='session-test-123'",
    "if [[ \"$*\" == *\"--resume\"* ]]; then sleep 2; exit 0; fi",
    "printf '%s\\n' \\",
    "  \"{\\\"type\\\":\\\"system\\\",\\\"subtype\\\":\\\"init\\\",\\\"session_id\\\":\\\"$session\\\"}\" \\",
    "  \"{\\\"type\\\":\\\"assistant\\\",\\\"session_id\\\":\\\"$session\\\",\\\"message\\\":{\\\"content\\\":[{\\\"type\\\":\\\"text\\\",\\\"text\\\":\\\"review output\\\"}]}}\" \\",
    "  \"{\\\"type\\\":\\\"result\\\",\\\"subtype\\\":\\\"success\\\",\\\"is_error\\\":false,\\\"session_id\\\":\\\"$session\\\",\\\"result\\\":\\\"review output\\\"}\"",
    "",
  ].join("\n"));
  const config = writeConfig(workspace, [
    "[agents.reviewer]", 'adapter = "claude-code-cli"', `command = "${reviewer}"`, "args = []",
    'model = "claude-sonnet-4-6"', 'reasoning_effort = "high"', 'capabilities = ["review"]', "",
  ].join("\n"));
  const scope = "amscope_v1:33333333-3333-4333-8333-333333333333";
  const run = (runId: string) => runCli(workspace, ["--config", config, "flow", "run", "--workflow-file", workflow, "--review", "reviewer", "--task", "timeout", "--review-session-mode", "interactive_continuous", "--host-kind", "codex", "--conversation-scope", scope, "--run-id", runId]);
  const firstRun = run("timeout-first");
  assert.equal(firstRun.status, 0, firstRun.stderr);
  const firstDispatch = runCli(workspace, ["--config", config, "flow", "dispatch", "timeout-first", "--stage", "review", "--timeout-secs", "1"]);
  assert.equal(firstDispatch.status, 0, firstDispatch.stderr);
  assert.equal(run("timeout-second").status, 0);
  const dispatch = runCli(workspace, ["--config", config, "flow", "dispatch", "timeout-second", "--stage", "review", "--timeout-secs", "1"]);
  assert.notEqual(dispatch.status, 0);
  const status = JSON.parse(readFileSync(path.join(workspace, ".agentmesh", "runs", "timeout-second", "status.json"), "utf-8"));
  const attempt = status.stage_attempts.review[0];
  assert.equal(attempt.status, "timed_out");
  assert.equal(attempt.error_kind, "timeout");
  assert.equal(attempt.session_mode, "resumed");
  assert.equal(attempt.registry_write, false);
});

test("flow attach refreshes current workspace registry activity", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const staleTimestamp = "2026-06-10T00:01:00.000Z";
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
    "attach records workspace",
    "--run-id",
    "attach-records-workspace",
  ]);
  assert.equal(run.status, 0, run.stderr);
  resetRecordedAt(workspace, staleTimestamp);

  const attach = runCli(workspace, [
    "flow",
    "attach",
    "attach-records-workspace",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nAttached.",
  ]);

  assert.equal(attach.status, 0, attach.stderr);
  assertWorkspaceRecordRefreshed(workspace, staleTimestamp);
});

test("flow resume refreshes current workspace registry activity", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const staleTimestamp = "2026-06-10T00:02:00.000Z";
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
    "resume records workspace",
    "--run-id",
    "resume-records-workspace",
  ]);
  assert.equal(run.status, 0, run.stderr);
  resetRecordedAt(workspace, staleTimestamp);

  const resume = runCli(workspace, [
    "flow",
    "resume",
    "resume-records-workspace",
    "--stage",
    "plan",
  ]);

  assert.equal(resume.status, 0, resume.stderr);
  assertWorkspaceRecordRefreshed(workspace, staleTimestamp);
});

test("flow retry refreshes current workspace registry activity", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const staleTimestamp = "2026-06-10T00:03:00.000Z";
  const planner = path.join(workspace, "retry-planner.sh");
  const modeFile = path.join(workspace, "retry-mode.txt");
  writeFileSync(modeFile, "fail\n");
  writeOutputAgent(
    planner,
    [
      `mode_file=${bashString(modeFile)}`,
      "if grep -q fail \"$mode_file\"; then",
      "  echo 'planned failure' >&2",
      "  exit 7",
      "fi",
      "printf '# Plan\\n\\nRetried.\\n' > \"$output_file\"",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner]",
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
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
    "planner",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "retry records workspace",
    "--run-id",
    "retry-records-workspace",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const failedDispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "retry-records-workspace",
    "--stage",
    "plan",
  ]);
  assert.equal(failedDispatch.status, 1);
  writeFileSync(modeFile, "pass\n");
  resetRecordedAt(workspace, staleTimestamp);

  const retry = runCli(workspace, [
    "--config",
    config,
    "flow",
    "retry",
    "retry-records-workspace",
    "--stage",
    "plan",
  ]);

  assert.equal(retry.status, 0, retry.stderr);
  assertWorkspaceRecordRefreshed(workspace, staleTimestamp);
});

test("plan fanout writes isolated outputs and synthesizes canonical plan", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const planner = path.join(workspace, "planner.sh");
  writeExecutable(
    planner,
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
      "if [[ \"$output_file\" == */plan.md ]]; then",
      "  grep -q \"## Fanout Outputs\" \"$prompt_file\"",
      "  grep -q \"planner_a candidate\" \"$prompt_file\"",
      "  grep -q \"planner_b candidate\" \"$prompt_file\"",
      "  printf '# Plan\\n\\nSynthesized from planner_a and planner_b.\\n' > \"$output_file\"",
      "else",
      "  grep -q \"Agent: ${agent_name}\" \"$prompt_file\"",
      "  printf '# Plan\\n\\n%s candidate.\\n' \"$agent_name\" > \"$output_file\"",
      "fi",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner_a]",
      'label = "Planner A"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.planner_b]",
      'label = "Planner B"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
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
    "planner_a",
    "--plan",
    "planner_b",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "plan fanout",
    "--run-id",
    "plan-fanout-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  await dispatchFlowStage(
    "plan-fanout-flow",
    "plan",
    {
      configPath: path.join(workspace, ".home", ".config", "agentmesh", "config.toml"),
    },
    workspace,
  );

  const runDir = path.join(workspace, ".agentmesh", "runs", "plan-fanout-flow");
  assert.match(readFileSync(path.join(runDir, "outputs", "plan", "planner_a.md"), "utf-8"), /planner_a candidate/);
  assert.match(readFileSync(path.join(runDir, "outputs", "plan", "planner_b.md"), "utf-8"), /planner_b candidate/);
  assert.match(readFileSync(path.join(runDir, "plan.md"), "utf-8"), /Synthesized from planner_a and planner_b/);

  const artifacts = loadArtifacts(runDir);
  assert.equal(artifacts.output_plan_planner_a.path, "outputs/plan/planner_a.md");
  assert.equal(artifacts.output_plan_planner_b.path, "outputs/plan/planner_b.md");
  assert.equal(artifacts.plan.path, "plan.md");
  assert.equal(artifacts.prompt_plan_synthesis.path, "prompts/plan/synthesis.md");

  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.equal(status.context_bytes, 0);
  assert.equal(status.prompt_bytes.prompt_plan_planner_a.path, "prompts/plan/planner_a.md");
  assert.equal(status.prompt_bytes.prompt_plan_planner_a.stage, "plan");
  assert.equal(status.prompt_bytes.prompt_plan_planner_a.agent, "planner_a");
  assert.ok(status.prompt_bytes.prompt_plan_planner_a.bytes > 0);
  assert.equal(status.prompt_bytes.prompt_plan_planner_b.path, "prompts/plan/planner_b.md");
  assert.equal(status.prompt_bytes.prompt_plan_synthesis.path, "prompts/plan/synthesis.md");
  assert.equal(status.prompt_bytes.prompt_plan_synthesis.kind, "synthesis");
  assert.ok(status.prompt_bytes.prompt_plan_synthesis.bytes > status.prompt_bytes.prompt_plan_planner_a.bytes);

  const statusJson = runCli(workspace, ["flow", "status", "plan-fanout-flow", "--json"]);
  assert.equal(statusJson.status, 0, statusJson.stderr);
  assert.equal(JSON.parse(statusJson.stdout).prompt_bytes.prompt_plan_synthesis.bytes, status.prompt_bytes.prompt_plan_synthesis.bytes);

  const synthesisPrompt = readFileSync(path.join(runDir, "prompts", "plan", "synthesis.md"), "utf-8");
  assert.match(synthesisPrompt, /Packet Directory: \.agentmesh\/runs\/plan-fanout-flow/);
  assert.ok(synthesisPrompt.indexOf("### planner_a") < synthesisPrompt.indexOf("### planner_b"));
});

test("plan fanout starts candidate agents concurrently", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const planner = path.join(workspace, "concurrent-planner.sh");
  const markerDir = path.join(workspace, "plan-markers");
  writeExecutable(
    planner,
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
      `marker_dir=${bashString(markerDir)}`,
      "mkdir -p \"$marker_dir\"",
      "agent_name=$(basename \"$output_file\" .md)",
      "if [[ \"$output_file\" == */plan.md ]]; then",
      "  grep -q \"planner_a concurrent candidate\" \"$prompt_file\"",
      "  grep -q \"planner_b concurrent candidate\" \"$prompt_file\"",
      "  printf '# Plan\\n\\nSynthesized concurrent candidates.\\n' > \"$output_file\"",
      "  exit 0",
      "fi",
      "case \"$agent_name\" in",
      "  planner_a) other_agent='planner_b' ;;",
      "  planner_b) other_agent='planner_a' ;;",
      "  *) echo \"unexpected planner: $agent_name\" >&2; exit 8 ;;",
      "esac",
      "run_dir=$(dirname \"$(dirname \"$(dirname \"$output_file\")\")\")",
      "grep -q \"Agent: ${agent_name}\" \"$prompt_file\"",
      "test -f \"$run_dir/prompts/plan/planner_a.md\"",
      "test -f \"$run_dir/prompts/plan/planner_b.md\"",
      "touch \"$marker_dir/${agent_name}.started\"",
      "deadline=$((SECONDS + 5))",
      "while [[ ! -f \"$marker_dir/${other_agent}.started\" ]]; do",
      "  if (( SECONDS >= deadline )); then",
      "    echo \"timed out waiting for ${other_agent}\" >&2",
      "    exit 9",
      "  fi",
      "  sleep 0.05",
      "done",
      "printf '# Plan\\n\\n%s concurrent candidate.\\n' \"$agent_name\" > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner_a]",
      'label = "Planner A"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.planner_b]",
      'label = "Planner B"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
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
    "planner_a",
    "--plan",
    "planner_b",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "concurrent plan fanout",
    "--run-id",
    "concurrent-plan-fanout-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "concurrent-plan-fanout-flow",
    "--stage",
    "plan",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "concurrent-plan-fanout-flow");
  assert.match(readFileSync(path.join(runDir, "plan.md"), "utf-8"), /Synthesized concurrent candidates/);
});

test("plan fanout prompts reference context without replaying it", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const planner = path.join(workspace, "context-aware-planner.sh");
  writeExecutable(
    planner,
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
      "if [[ \"$output_file\" == */plan.md ]]; then",
      "  grep -q \"## Fanout Outputs\" \"$prompt_file\"",
      "  grep -q \"planner_a candidate\" \"$prompt_file\"",
      "  grep -q \"planner_b candidate\" \"$prompt_file\"",
      "  printf '# Plan\\n\\nSynthesized without replaying context.\\n' > \"$output_file\"",
      "else",
      "  grep -q \"Context artifact: context.md\" \"$prompt_file\"",
      "  ! grep -q \"CONTEXT_SENTINEL\" \"$prompt_file\"",
      "  printf '# Plan\\n\\n%s candidate.\\n' \"$agent_name\" > \"$output_file\"",
      "fi",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "large-context.md"),
    ["CONTEXT_SENTINEL", "x".repeat(8_000), ""].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner_a]",
      'label = "Planner A"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.planner_b]",
      'label = "Planner B"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
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
    "planner_a",
    "--plan",
    "planner_b",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--context-file",
    "large-context.md",
    "--task",
    "plan fanout with large context",
    "--run-id",
    "plan-fanout-context-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "plan-fanout-context-flow",
    "--stage",
    "plan",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "plan-fanout-context-flow");
  const candidatePrompt = readFileSync(path.join(runDir, "prompts", "plan", "planner_a.md"), "utf-8");
  const synthesisPrompt = readFileSync(path.join(runDir, "prompts", "plan", "synthesis.md"), "utf-8");
  assert.match(candidatePrompt, /Context artifact: context\.md/);
  assert.match(candidatePrompt, /Context path: \.agentmesh\/runs\/plan-fanout-context-flow\/context\.md/);
  assert.doesNotMatch(candidatePrompt, /CONTEXT_SENTINEL/);
  assert.match(synthesisPrompt, /Packet Directory: \.agentmesh\/runs\/plan-fanout-context-flow/);
  assert.match(synthesisPrompt, /Context artifact: context\.md/);
  assert.match(synthesisPrompt, /Context path: \.agentmesh\/runs\/plan-fanout-context-flow\/context\.md/);
  assert.match(synthesisPrompt, /Context bytes: [0-9]+/);
  assert.doesNotMatch(synthesisPrompt, /was already provided to the candidate fanout prompts/);
  assert.doesNotMatch(synthesisPrompt, /CONTEXT_SENTINEL/);
  assert.match(synthesisPrompt, /context\.md/);

  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.ok(status.prompt_bytes.prompt_plan_planner_a.bytes < status.context_bytes);
  assert.ok(
    status.prompt_bytes.prompt_plan_synthesis.bytes < status.context_bytes,
    "synthesis prompt should avoid replaying full context",
  );
});

test("plan fanout synthesis prompt bounds long candidate outputs", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const planner = path.join(workspace, "long-output-planner.sh");
  writeExecutable(
    planner,
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
      "if [[ \"$output_file\" == */plan.md ]]; then",
      "  grep -q \"## Fanout Outputs\" \"$prompt_file\"",
      "  grep -q \"LONG_OUTPUT_PREFIX\" \"$prompt_file\"",
      "  grep -q \"LONG_OUTPUT_TAIL_SHOULD_NOT_REPLAY\" \"$prompt_file\"",
      "  grep -q \"AgentMesh synthesis prompt truncated fanout output\" \"$prompt_file\"",
      "  grep -q \"RELEASE_SUMMARY_PREFIX\" \"$prompt_file\"",
      "  grep -q \"RELEASE_SUMMARY_TAIL_SHOULD_NOT_REPLAY\" \"$prompt_file\"",
      "  grep -q \"AgentMesh prompt assembly truncated release-summary.md\" \"$prompt_file\"",
      "  printf '# Plan\\n\\nSynthesized bounded candidate outputs.\\n' > \"$output_file\"",
      "else",
      "  printf '# Plan\\n\\nLONG_OUTPUT_PREFIX %s\\n' \"$agent_name\" > \"$output_file\"",
      "  head -c 12000 /dev/zero | tr '\\0' x >> \"$output_file\"",
      "  printf '\\nLONG_OUTPUT_TAIL_SHOULD_NOT_REPLAY\\n' >> \"$output_file\"",
      "fi",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner_a]",
      'label = "Planner A"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.planner_b]",
      'label = "Planner B"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
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
    "planner_a",
    "--plan",
    "planner_b",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "plan fanout with long candidate outputs",
    "--run-id",
    "plan-fanout-long-output-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const runDir = path.join(workspace, ".agentmesh", "runs", "plan-fanout-long-output-flow");
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

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "plan-fanout-long-output-flow",
    "--stage",
    "plan",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const synthesisPrompt = readFileSync(path.join(runDir, "prompts", "plan", "synthesis.md"), "utf-8");
  assert.match(synthesisPrompt, /LONG_OUTPUT_PREFIX/);
  assert.match(synthesisPrompt, /LONG_OUTPUT_TAIL_SHOULD_NOT_REPLAY/);
  assert.match(synthesisPrompt, /AgentMesh synthesis prompt truncated fanout output/);
  assert.match(synthesisPrompt, /RELEASE_SUMMARY_PREFIX/);
  assert.match(synthesisPrompt, /RELEASE_SUMMARY_TAIL_SHOULD_NOT_REPLAY/);
  assert.match(synthesisPrompt, /AgentMesh prompt assembly truncated release-summary\.md/);

  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.ok(status.prompt_bytes.prompt_plan_synthesis.bytes < 45_000);
});

test("fanout concurrency limit runs candidate agents without overlap", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const planner = path.join(workspace, "limited-planner.sh");
  const stateDir = path.join(workspace, "limited-state");
  writeExecutable(
    planner,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      `state_dir=${bashString(stateDir)}`,
      "mkdir -p \"$state_dir\"",
      "agent_name=$(basename \"$output_file\" .md)",
      "if [[ \"$output_file\" == */plan.md ]]; then",
      "  printf '# Plan\\n\\nSynthesized after limited fanout.\\n' > \"$output_file\"",
      "  exit 0",
      "fi",
      "if ! mkdir \"$state_dir/active\"; then",
      "  echo \"overlap detected for ${agent_name}\" >&2",
      "  exit 11",
      "fi",
      "trap 'rmdir \"$state_dir/active\"' EXIT",
      "sleep 0.2",
      "printf '# Plan\\n\\n%s limited candidate.\\n' \"$agent_name\" > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner_a]",
      'label = "Planner A"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      'output_file_arg = "--output-file"',
      "",
      "[agents.planner_b]",
      'label = "Planner B"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      'output_file_arg = "--output-file"',
      "",
      "[execution_policy]",
      "max_fanout_concurrency = 1",
      "",
    ].join("\n"),
  );
  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--plan",
    "planner_a",
    "--plan",
    "planner_b",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "limited plan fanout",
    "--run-id",
    "limited-plan-fanout-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "limited-plan-fanout-flow",
    "--stage",
    "plan",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "limited-plan-fanout-flow");
  assert.match(readFileSync(path.join(runDir, "plan.md"), "utf-8"), /Synthesized after limited fanout/);
});

test("dispatch records run, stage, and agent timing in status", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const planner = path.join(workspace, "planner.sh");
  writeExecutable(
    planner,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "printf '# Plan\\n\\nTimed plan.\\n' > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner]",
      'label = "Planner"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
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
    "planner",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "record timing",
    "--run-id",
    "timed-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "timed-flow",
    "--stage",
    "plan",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "timed-flow", "status.json"), "utf-8"),
  );
  assert.match(status.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(status.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(status.stage_timing.plan.attempt_count, 1);
  assert.match(status.stage_timing.plan.started_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(status.stage_timing.plan.completed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(status.stage_timing.plan.failed_at, undefined);
  assert.equal(typeof status.stage_timing.plan.duration_ms, "number");
  assert.equal(status.stage_timing.execute.attempt_count, 0);
  assert.equal(typeof status.runtime_timing.config_load_ms, "number");
  assert.equal(typeof status.runtime_timing.total_ms, "number");
  assert.equal(status.agent_timing.plan.planner.attempt_count, 1);
  assert.match(status.agent_timing.plan.planner.started_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(status.agent_timing.plan.planner.completed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof status.agent_timing.plan.planner.duration_ms, "number");
  assert.equal(typeof status.agent_timing.plan.planner.config_load_ms, "number");
  assert.equal(typeof status.agent_timing.plan.planner.adapter_spawn_ms, "number");
  assert.equal(typeof status.agent_timing.plan.planner.agent_total_ms, "number");
  assert.equal(typeof status.agent_timing.plan.planner.total_ms, "number");
  assert.equal(status.agent_timing.plan.planner.first_output_ms, undefined);

  const statusJson = runCli(workspace, ["flow", "status", "timed-flow", "--json"]);
  assert.equal(statusJson.status, 0, statusJson.stderr);
  const statusPayload = JSON.parse(statusJson.stdout);
  assert.equal(typeof statusPayload.runtime_timing.total_ms, "number");
  assert.equal(typeof statusPayload.agent_timing.plan.planner.adapter_spawn_ms, "number");
});

test("dispatch enforces resolved execution policy from packet status", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const planner = path.join(workspace, "planner.sh");
  writeExecutable(
    planner,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "printf '# Plan\\n\\nPolicy run.\\n' > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner]",
      'label = "Planner"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      'output_file_arg = "--output-file"',
      "",
      "[execution_policy]",
      "max_adapter_timeout_secs = 1",
      "",
    ].join("\n"),
  );
  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--plan",
    "planner",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "timeout policy",
    "--run-id",
    "timeout-policy-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "timeout-policy-flow",
    "--stage",
    "plan",
    "--timeout-secs",
    "2",
  ]);
  assert.equal(dispatch.status, 1);
  assert.match(dispatch.stderr, /execution_policy max_adapter_timeout_secs exceeded: 2 > 1/);
});

test("dispatch records fallback attempts from packet routing", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const primary = path.join(workspace, "primary.sh");
  const backup = path.join(workspace, "backup.sh");
  writeExecutable(
    primary,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "echo primary failed >&2",
      "exit 7",
      "",
    ].join("\n"),
  );
  writeExecutable(
    backup,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "printf '# Handoff\\n\\nBackup completed.\\n' > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.primary]",
      'label = "Primary"',
      'adapter = "command"',
      `command = "${primary}"`,
      "args = []",
      'capabilities = ["execute"]',
      'output_file_arg = "--output-file"',
      "",
      "[agents.backup]",
      'label = "Backup"',
      'adapter = "command"',
      `command = "${backup}"`,
      "args = []",
      'capabilities = ["execute"]',
      "timeout_seconds = 31",
      'output_file_arg = "--output-file"',
      "",
      "[default_stage_agents.stage_types]",
      'execute = ["primary"]',
      'decide = ["current"]',
      "",
      "[fallback.stage_types.execute]",
      'agents = ["backup"]',
      "timeout_seconds = 31",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "fallback-execute.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["execute", "decide"]',
      'description = "Fallback execute."',
      'when_to_use = ["An execute fallback is tested."]',
      'packet_artifacts = ["request.md", "handoff.md", "decision.md"]',
      'quality_gates = ["Fallback attempts are recorded."]',
      "",
      "[failure_policy.stage_types.execute]",
      'mode = "required"',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow-file",
    "fallback-execute.toml",
    "--task",
    "fallback attempts",
    "--run-id",
    "fallback-attempt-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "fallback-attempt-flow",
    "--stage",
    "execute",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "fallback-attempt-flow");
  assert.match(readFileSync(path.join(runDir, "handoff.md"), "utf-8"), /Backup completed/);
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.stage_attempts.execute.map((attempt: { status: string }) => attempt.status), [
    "failed",
    "completed",
  ]);
  assert.deepEqual(status.stage_attempts.execute.map((attempt: { lane_id: string }) => attempt.lane_id), [
    "execute:primary",
    "execute:backup",
  ]);
  assert.equal(status.stage_attempts.execute[0].primary_agent, "primary");
  assert.equal(status.stage_attempts.execute[0].requested_agent, "primary");
  assert.equal(status.stage_attempts.execute[0].actual_agent, "primary");
  assert.equal(status.stage_attempts.execute[0].attempt, 1);
  assert.equal(status.stage_attempts.execute[0].lane_attempt, 1);
  assert.equal(status.stage_attempts.execute[1].primary_agent, "primary");
  assert.equal(status.stage_attempts.execute[1].requested_agent, "backup");
  assert.equal(status.stage_attempts.execute[1].actual_agent, "backup");
  assert.equal(status.stage_attempts.execute[1].fallback_from, "primary");
  assert.equal(status.stage_attempts.execute[1].timeout_seconds, 31);
  assert.equal(status.stage_attempts.execute[1].attempt, 1);
  assert.equal(status.stage_attempts.execute[1].lane_attempt, 1);
});

test("dispatch records timed out attempts without fallback on terminal policy", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const sleepy = path.join(workspace, "sleepy.sh");
  writeExecutable(
    sleepy,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "sleep 2",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.sleepy]",
      'label = "Sleepy"',
      'adapter = "command"',
      `command = "${sleepy}"`,
      "args = []",
      'capabilities = ["plan"]',
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "terminal-plan.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["plan", "decide"]',
      'description = "Terminal plan timeout."',
      'when_to_use = ["A terminal timeout is tested."]',
      'packet_artifacts = ["request.md", "plan.md", "decision.md"]',
      'quality_gates = ["Timeout attempts are recorded."]',
      "",
      "[failure_policy.stage_types.plan]",
      'mode = "terminal"',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow-file",
    "terminal-plan.toml",
    "--plan",
    "sleepy",
    "--decide",
    "current",
    "--task",
    "timeout attempt",
    "--run-id",
    "timeout-attempt-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "timeout-attempt-flow",
    "--stage",
    "plan",
    "--timeout-secs",
    "1",
  ]);
  assert.equal(dispatch.status, 1);
  assert.match(dispatch.stderr, /timed out/);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "timeout-attempt-flow", "status.json"), "utf-8"),
  );
  assert.equal(status.failed_stage, "plan");
  assert.equal(status.stage_attempts.plan.length, 1);
  assert.equal(status.stage_attempts.plan[0].lane_id, "plan:sleepy");
  assert.equal(status.stage_attempts.plan[0].status, "timed_out");
  assert.equal(status.stage_attempts.plan[0].timeout_seconds, 1);
  assert.equal(status.stage_attempts.plan[0].error_kind, "timeout");
});

test("dispatch rejects automatic agent invocation when policy disallows it", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const planner = path.join(workspace, "planner.sh");
  writeExecutable(
    planner,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf '# Plan\\n\\nShould not run.\\n' > \"$2\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner]",
      'label = "Planner"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      'output_file_arg = "--output-file"',
      "",
      "[execution_policy]",
      "allow_auto_dispatch = false",
      "",
    ].join("\n"),
  );
  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--plan",
    "planner",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "manual dispatch policy",
    "--run-id",
    "manual-dispatch-policy-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "manual-dispatch-policy-flow",
    "--stage",
    "plan",
  ]);
  assert.equal(dispatch.status, 1);
  assert.match(dispatch.stderr, /execution_policy allow_auto_dispatch is false/);
  assert.equal(
    existsSync(path.join(workspace, ".agentmesh", "runs", "manual-dispatch-policy-flow", "plan.md")),
    false,
  );
});

test("retry enforces resolved max retry attempts from packet status", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const planner = path.join(workspace, "planner.sh");
  writeExecutable(
    planner,
    [
      "#!/usr/bin/env bash",
      "exit 7",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner]",
      'label = "Planner"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      "",
      "[execution_policy]",
      "max_retry_attempts = 0",
      "",
    ].join("\n"),
  );
  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--plan",
    "planner",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "retry policy",
    "--run-id",
    "retry-policy-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "retry-policy-flow",
    "--stage",
    "plan",
  ]);
  assert.equal(dispatch.status, 1);
  assert.match(dispatch.stderr, /stage 'plan' failed for agent 'planner' with exit code 7/);
  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "retry-policy-flow", "status.json"), "utf-8"),
  );
  assert.match(status.stage_timing.plan.failed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof status.stage_timing.plan.duration_ms, "number");
  assert.match(status.agent_timing.plan.planner.failed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof status.agent_timing.plan.planner.adapter_spawn_ms, "number");
  assert.equal(typeof status.agent_timing.plan.planner.agent_total_ms, "number");

  const retry = runCli(workspace, [
    "--config",
    config,
    "flow",
    "retry",
    "retry-policy-flow",
  ]);
  assert.equal(retry.status, 1);
  assert.match(retry.stderr, /execution_policy max_retry_attempts exceeded for stage plan: 0 >= 0/);
});

test("run creation rejects execute multi-agent fanout", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const worker = path.join(workspace, "worker.sh");
  writeExecutable(
    worker,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "printf '# Handoff\\n\\nDone.\\n' > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.worker_a]",
      'label = "Worker A"',
      'adapter = "command"',
      `command = "${worker}"`,
      "args = []",
      'capabilities = ["plan", "execute", "review", "decide"]',
      'output_file_arg = "--output-file"',
      "",
      "[agents.worker_b]",
      'label = "Worker B"',
      'adapter = "command"',
      `command = "${worker}"`,
      "args = []",
      'capabilities = ["execute"]',
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
    "current",
    "--execute",
    "worker_a",
    "--execute",
    "worker_b",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "defer execute fanout",
    "--run-id",
    "deferred-execute-fanout-flow",
  ]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /stage_assignments\.execute must contain exactly one agent/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "deferred-execute-fanout-flow")), false);
});

test("plan fanout records fallback attempts and synthesizes fallback output", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const plannerA = path.join(workspace, "planner-a.sh");
  const plannerB = path.join(workspace, "planner-b.sh");
  const backup = path.join(workspace, "backup-planner.sh");
  writeExecutable(
    plannerA,
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
      "  */outputs/plan/planner_a.md)",
      "    echo 'planner_a failed' >&2",
      "    exit 7 ;;",
      "  */plan.md)",
      "    grep -q 'backup candidate' \"$prompt_file\"",
      "    grep -q 'planner_b candidate' \"$prompt_file\"",
      "    printf '# Plan\\n\\nSynthesized with fallback evidence.\\n' > \"$output_file\" ;;",
      "  *) exit 8 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  writeExecutable(
    plannerB,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "printf '# Plan\\n\\nplanner_b candidate.\\n' > \"$output_file\"",
      "",
    ].join("\n"),
  );
  writeExecutable(
    backup,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "printf '# Plan\\n\\nbackup candidate.\\n' > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner_a]",
      'label = "Planner A"',
      'adapter = "command"',
      `command = "${plannerA}"`,
      "args = []",
      'capabilities = ["plan"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.planner_b]",
      'label = "Planner B"',
      'adapter = "command"',
      `command = "${plannerB}"`,
      "args = []",
      'capabilities = ["plan"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.backup]",
      'label = "Backup Planner"',
      'adapter = "command"',
      `command = "${backup}"`,
      "args = []",
      'capabilities = ["plan"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[fallback.stage_types.plan]",
      'agents = ["backup"]',
      "timeout_seconds = 31",
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--plan",
    "planner_a",
    "--plan",
    "planner_b",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "fanout fallback",
    "--run-id",
    "fanout-fallback-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "fanout-fallback-flow",
    "--stage",
    "plan",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "fanout-fallback-flow");
  assert.match(readFileSync(path.join(runDir, "outputs", "plan", "planner_a.md"), "utf-8"), /backup candidate/);
  assert.match(readFileSync(path.join(runDir, "plan.md"), "utf-8"), /Synthesized with fallback evidence/);
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.ok(status.stage_attempts.plan.some((attempt: { lane_id: string; actual_agent: string; status: string }) =>
    attempt.lane_id === "plan:planner_a" &&
    attempt.actual_agent === "planner_a" &&
    attempt.status === "failed"
  ));
  assert.ok(status.stage_attempts.plan.some((attempt: { lane_id: string; actual_agent: string; fallback_from?: string; status: string }) =>
    attempt.lane_id === "plan:backup" &&
    attempt.actual_agent === "backup" &&
    attempt.fallback_from === "planner_a" &&
    attempt.status === "completed"
  ));
});

test("decide fanout writes isolated outputs and synthesizes canonical decision", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const decider = path.join(workspace, "decider.sh");
  writeExecutable(
    decider,
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
      "  grep -q \"decider_a recommendation\" \"$prompt_file\"",
      "  grep -q \"decider_b recommendation\" \"$prompt_file\"",
      "  printf '# Decision\\n\\nFinal decision synthesized from decider_a and decider_b.\\n' > \"$output_file\"",
      "else",
      "  grep -q \"Agent: ${agent_name}\" \"$prompt_file\"",
      "  printf '# Decision\\n\\n%s recommendation.\\n' \"$agent_name\" > \"$output_file\"",
      "fi",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.decider_a]",
      'label = "Decider A"',
      'adapter = "command"',
      `command = "${decider}"`,
      "args = []",
      'capabilities = ["decide"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.decider_b]",
      'label = "Decider B"',
      'adapter = "command"',
      `command = "${decider}"`,
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
    "flow",
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "current",
    "--decide",
    "decider_a",
    "--decide",
    "decider_b",
    "--task",
    "decide fanout",
    "--run-id",
    "decide-fanout-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const attachPlan = runCli(workspace, [
    "flow",
    "attach",
    "decide-fanout-flow",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nAttached plan.",
  ]);
  assert.equal(attachPlan.status, 0, attachPlan.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "decide-fanout-flow",
    "--stage",
    "decide",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "decide-fanout-flow");
  assert.match(readFileSync(path.join(runDir, "outputs", "decide", "decider_a.md"), "utf-8"), /decider_a recommendation/);
  assert.match(readFileSync(path.join(runDir, "outputs", "decide", "decider_b.md"), "utf-8"), /decider_b recommendation/);
  assert.match(readFileSync(path.join(runDir, "decision.md"), "utf-8"), /Final decision synthesized/);

  const artifacts = loadArtifacts(runDir);
  assert.equal(artifacts.output_decide_decider_a.path, "outputs/decide/decider_a.md");
  assert.equal(artifacts.output_decide_decider_b.path, "outputs/decide/decider_b.md");
  assert.equal(artifacts.decision.path, "decision.md");
  assert.equal(artifacts.prompt_decide_synthesis.path, "prompts/decide/synthesis.md");

  const synthesisPrompt = readFileSync(path.join(runDir, "prompts", "decide", "synthesis.md"), "utf-8");
  assert.ok(synthesisPrompt.indexOf("### decider_a") < synthesisPrompt.indexOf("### decider_b"));
});

test("decide fanout starts candidate agents concurrently", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const decider = path.join(workspace, "concurrent-decider.sh");
  const markerDir = path.join(workspace, "decide-markers");
  writeExecutable(
    decider,
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
      `marker_dir=${bashString(markerDir)}`,
      "mkdir -p \"$marker_dir\"",
      "agent_name=$(basename \"$output_file\" .md)",
      "if [[ \"$output_file\" == */decision.md ]]; then",
      "  grep -q \"decider_a concurrent recommendation\" \"$prompt_file\"",
      "  grep -q \"decider_b concurrent recommendation\" \"$prompt_file\"",
      "  printf '# Decision\\n\\nSynthesized concurrent recommendations.\\n' > \"$output_file\"",
      "  exit 0",
      "fi",
      "case \"$agent_name\" in",
      "  decider_a) other_agent='decider_b' ;;",
      "  decider_b) other_agent='decider_a' ;;",
      "  *) echo \"unexpected decider: $agent_name\" >&2; exit 8 ;;",
      "esac",
      "run_dir=$(dirname \"$(dirname \"$(dirname \"$output_file\")\")\")",
      "grep -q \"Agent: ${agent_name}\" \"$prompt_file\"",
      "test -f \"$run_dir/prompts/decide/decider_a.md\"",
      "test -f \"$run_dir/prompts/decide/decider_b.md\"",
      "touch \"$marker_dir/${agent_name}.started\"",
      "deadline=$((SECONDS + 5))",
      "while [[ ! -f \"$marker_dir/${other_agent}.started\" ]]; do",
      "  if (( SECONDS >= deadline )); then",
      "    echo \"timed out waiting for ${other_agent}\" >&2",
      "    exit 9",
      "  fi",
      "  sleep 0.05",
      "done",
      "printf '# Decision\\n\\n%s concurrent recommendation.\\n' \"$agent_name\" > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.decider_a]",
      'label = "Decider A"',
      'adapter = "command"',
      `command = "${decider}"`,
      "args = []",
      'capabilities = ["decide"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.decider_b]",
      'label = "Decider B"',
      'adapter = "command"',
      `command = "${decider}"`,
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
    "flow",
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "current",
    "--decide",
    "decider_a",
    "--decide",
    "decider_b",
    "--task",
    "concurrent decide fanout",
    "--run-id",
    "concurrent-decide-fanout-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(runCli(workspace, [
    "flow",
    "attach",
    "concurrent-decide-fanout-flow",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nReady for concurrent decide fanout.",
  ]).status, 0);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "concurrent-decide-fanout-flow",
    "--stage",
    "decide",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "concurrent-decide-fanout-flow");
  assert.match(readFileSync(path.join(runDir, "decision.md"), "utf-8"), /Synthesized concurrent recommendations/);
});

test("plan fanout retry preserves completed agent outputs", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const planner = path.join(workspace, "retry-planner.sh");
  writeExecutable(
    planner,
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
      "state_dir=$(dirname \"$0\")",
      "if [[ \"$output_file\" == */plan.md ]]; then",
      "  printf '# Plan\\n\\nSynthesized after retry.\\n' > \"$output_file\"",
      "  exit 0",
      "fi",
      "count_file=\"$state_dir/${agent_name}.count\"",
      "count=0",
      "if [[ -f \"$count_file\" ]]; then count=$(cat \"$count_file\"); fi",
      "count=$((count + 1))",
      "printf '%s' \"$count\" > \"$count_file\"",
      "if [[ \"$agent_name\" == \"planner_b\" && ! -f \"$state_dir/planner_b.failed\" ]]; then",
      "  printf '# Plan\\n\\npartial failed output.\\n' > \"$output_file\"",
      "  touch \"$state_dir/planner_b.failed\"",
      "  exit 7",
      "fi",
      "grep -q \"Agent: ${agent_name}\" \"$prompt_file\"",
      "printf '# Plan\\n\\n%s attempt %s.\\n' \"$agent_name\" \"$count\" > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner_a]",
      'label = "Planner A"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.planner_b]",
      'label = "Planner B"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
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
    "--workflow",
    "w-4963ede2",
    "--plan",
    "planner_a",
    "--plan",
    "planner_b",
    "--decide",
    "current",
    "--task",
    "retry plan fanout",
    "--run-id",
    "retry-plan-fanout-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const firstDispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "retry-plan-fanout-flow",
    "--stage",
    "plan",
  ]);
  assert.equal(firstDispatch.status, 1);
  assert.match(firstDispatch.stderr, /stage 'plan' failed for agent 'planner_b' with exit code 7/);

  const runDir = path.join(workspace, ".agentmesh", "runs", "retry-plan-fanout-flow");
  assert.equal(existsSync(path.join(runDir, "plan.md")), false);
  assert.equal(existsSync(path.join(runDir, "prompts", "plan", "synthesis.md")), false);
  assert.match(readFileSync(path.join(runDir, "outputs", "plan", "planner_a.md"), "utf-8"), /planner_a attempt 1/);

  const retry = runCli(workspace, [
    "--config",
    config,
    "flow",
    "retry",
    "retry-plan-fanout-flow",
    "--stage",
    "plan",
  ]);
  assert.equal(retry.status, 0, retry.stderr);

  assert.match(readFileSync(path.join(runDir, "outputs", "plan", "planner_a.md"), "utf-8"), /planner_a attempt 1/);
  assert.match(readFileSync(path.join(runDir, "outputs", "plan", "planner_b.md"), "utf-8"), /planner_b attempt 2/);
  assert.equal(readFileSync(path.join(workspace, "planner_a.count"), "utf-8"), "1");
  assert.equal(readFileSync(path.join(workspace, "planner_b.count"), "utf-8"), "2");
  assert.match(readFileSync(path.join(runDir, "plan.md"), "utf-8"), /Synthesized after retry/);
});

test("plan fanout synthesis failure marks stage failed", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const planner = path.join(workspace, "synthesis-fail-planner.sh");
  writeExecutable(
    planner,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "agent_name=$(basename \"$output_file\" .md)",
      "if [[ \"$output_file\" == */plan.md ]]; then",
      "  exit 9",
      "fi",
      "printf '# Plan\\n\\n%s candidate.\\n' \"$agent_name\" > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner_a]",
      'label = "Planner A"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      'output_file_arg = "--output-file"',
      "",
      "[agents.planner_b]",
      'label = "Planner B"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );
  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "planner_a",
    "--plan",
    "planner_b",
    "--decide",
    "current",
    "--task",
    "synthesis failure",
    "--run-id",
    "synthesis-failure-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "synthesis-failure-flow",
    "--stage",
    "plan",
  ]);
  assert.equal(dispatch.status, 1);
  assert.match(dispatch.stderr, /stage 'plan' synthesis failed for agent 'planner_a' with exit code 9/);

  const status = JSON.parse(readFileSync(path.join(workspace, ".agentmesh", "runs", "synthesis-failure-flow", "status.json"), "utf-8"));
  assert.equal(status.failed_stage, "plan");
  assert.deepEqual(status.completed_stages, []);
});

test("plan fanout synthesis retry reuses completed candidate outputs", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const planner = path.join(workspace, "retry-synthesis-planner.sh");
  const stateDir = path.join(workspace, "synthesis-state");
  writeExecutable(
    planner,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      `state_dir=${bashString(stateDir)}`,
      "mkdir -p \"$state_dir\"",
      "agent_name=$(basename \"$output_file\" .md)",
      "if [[ \"$output_file\" == */plan.md ]]; then",
      "  count_file=\"$state_dir/synthesis.count\"",
      "  count=0",
      "  if [[ -f \"$count_file\" ]]; then count=$(cat \"$count_file\"); fi",
      "  count=$((count + 1))",
      "  printf '%s' \"$count\" > \"$count_file\"",
      "  if [[ ! -f \"$state_dir/allow-synthesis\" ]]; then",
      "    exit 9",
      "  fi",
      "  printf '# Plan\\n\\nSynthesized on retry.\\n' > \"$output_file\"",
      "  exit 0",
      "fi",
      "count_file=\"$state_dir/${agent_name}.count\"",
      "count=0",
      "if [[ -f \"$count_file\" ]]; then count=$(cat \"$count_file\"); fi",
      "count=$((count + 1))",
      "printf '%s' \"$count\" > \"$count_file\"",
      "printf '# Plan\\n\\n%s candidate run %s.\\n' \"$agent_name\" \"$count\" > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner_a]",
      'label = "Planner A"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      'output_file_arg = "--output-file"',
      "",
      "[agents.planner_b]",
      'label = "Planner B"',
      'adapter = "command"',
      `command = "${planner}"`,
      "args = []",
      'capabilities = ["plan"]',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );
  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "planner_a",
    "--plan",
    "planner_b",
    "--decide",
    "current",
    "--task",
    "retry synthesis only",
    "--run-id",
    "retry-synthesis-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const failed = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "retry-synthesis-flow",
    "--stage",
    "plan",
  ]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /stage 'plan' synthesis failed for agent 'planner_a' with exit code 9/);
  assert.equal(readFileSync(path.join(stateDir, "planner_a.count"), "utf-8"), "1");
  assert.equal(readFileSync(path.join(stateDir, "planner_b.count"), "utf-8"), "1");
  assert.equal(readFileSync(path.join(stateDir, "synthesis.count"), "utf-8"), "1");

  writeFileSync(path.join(stateDir, "allow-synthesis"), "true\n");
  const retried = runCli(workspace, [
    "--config",
    config,
    "flow",
    "retry",
    "retry-synthesis-flow",
    "--stage",
    "plan",
  ]);
  assert.equal(retried.status, 0, retried.stderr);

  assert.equal(readFileSync(path.join(stateDir, "planner_a.count"), "utf-8"), "1");
  assert.equal(readFileSync(path.join(stateDir, "planner_b.count"), "utf-8"), "1");
  assert.equal(readFileSync(path.join(stateDir, "synthesis.count"), "utf-8"), "2");
  const runDir = path.join(workspace, ".agentmesh", "runs", "retry-synthesis-flow");
  assert.match(readFileSync(path.join(runDir, "plan.md"), "utf-8"), /Synthesized on retry/);
});

test("dispatch rejects current stages while prompt and attach remain supported", () => {
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
    "--task",
    "host-only current",
    "--run-id",
    "current-host-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const attachPlan = runCli(workspace, [
    "flow",
    "attach",
    "current-host-flow",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nReady for current execute.",
  ]);
  assert.equal(attachPlan.status, 0, attachPlan.stderr);

  const dispatch = runCli(workspace, [
    "flow",
    "dispatch",
    "current-host-flow",
    "--stage",
    "execute",
  ]);
  assert.equal(dispatch.status, 1);
  assert.match(dispatch.stderr, /current is host-only/);
  assert.match(dispatch.stderr, /flow prompt/);
  assert.match(dispatch.stderr, /flow attach/);

  const prompt = runCli(workspace, ["flow", "prompt", "current-host-flow", "--stage", "execute"]);
  assert.equal(prompt.status, 0, prompt.stderr);
  assert.match(prompt.stdout, /host-only current/);

  const attach = runCli(workspace, [
    "flow",
    "attach",
    "current-host-flow",
    "--stage",
    "execute",
    "--text",
    "# Execution\n\nDone by current.",
  ]);
  assert.equal(attach.status, 0, attach.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "current-host-flow", "status.json"), "utf-8"),
  );
  assert.deepEqual(status.completed_stages, ["plan", "execute"]);
  assert.deepEqual(status.stage_attempts.plan, []);
  assert.deepEqual(status.stage_attempts.execute, []);
});

test("run mutation lock rejects dispatch attach and retry with an active lease", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const run = runCli(workspace, [
    "flow",
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "current",
    "--decide",
    "current",
    "--task",
    "exercise lock",
    "--run-id",
    "locked-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const runDir = path.join(workspace, ".agentmesh", "runs", "locked-flow");
  writeRunMutationLock(runDir, "external-test", new Date(Date.now() + 60_000));

  const dispatch = runCli(workspace, ["flow", "dispatch", "locked-flow", "--stage", "plan"]);
  assert.equal(dispatch.status, 1);
  assert.match(dispatch.stderr, /run is locked/);
  assert.match(dispatch.stderr, /external-test/);
  assert.match(dispatch.stderr, /entrypoint unknown/);
  assert.match(dispatch.stderr, /runtime unknown/);
  assert.match(dispatch.stderr, /operation_id unknown/);

  const attach = runCli(workspace, [
    "flow",
    "attach",
    "locked-flow",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nLocked.",
  ]);
  assert.equal(attach.status, 1);
  assert.match(attach.stderr, /run is locked/);

  const retry = runCli(workspace, ["flow", "retry", "locked-flow", "--stage", "plan"]);
  assert.equal(retry.status, 1);
  assert.match(retry.stderr, /run is locked/);
});

test("run mutation lock writes owner metadata and refreshes heartbeat", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const run = runCli(workspace, [
    "flow",
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "current",
    "--decide",
    "current",
    "--task",
    "exercise owner lock",
    "--run-id",
    "owner-lock-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const runDir = path.join(workspace, ".agentmesh", "runs", "owner-lock-flow");
  const leasePath = path.join(runDir, ".agentmesh.lock", "lease.json");

  await withRunMutationLockAsync(
    runDir,
    "owner-metadata",
    async () => {
      const firstLease = JSON.parse(readFileSync(leasePath, "utf-8"));
      assert.equal(firstLease.schema_version, 1);
      assert.equal(firstLease.workspace, workspace);
      assert.equal(firstLease.scope, "run:owner-lock-flow");
      assert.equal(firstLease.entrypoint, "desktop");
      assert.equal(firstLease.runtime_version, "0.1.14");
      assert.equal(firstLease.operation, "owner-metadata");
      assert.equal(firstLease.operation_id, "operation-123");
      assert.equal(firstLease.command, "flow.dispatch:plan");
      assert.match(firstLease.lock_id, /^lock-/);
      assert.match(firstLease.created_at, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(firstLease.heartbeat_at, firstLease.created_at);
      assert.match(firstLease.expires_at, /^\d{4}-\d{2}-\d{2}T/);

      const attach = runCli(workspace, [
        "flow",
        "attach",
        "owner-lock-flow",
        "--stage",
        "plan",
        "--text",
        "# Plan\n\nShould be locked.",
      ]);
      assert.equal(attach.status, 1);
      assert.match(attach.stderr, /entrypoint desktop/);
      assert.match(attach.stderr, /runtime 0\.1\.14/);
      assert.match(attach.stderr, /operation_id operation-123/);
      assert.match(attach.stderr, /command flow\.dispatch:plan/);

      await new Promise((resolve) => setTimeout(resolve, 30));
      const refreshedLease = JSON.parse(readFileSync(leasePath, "utf-8"));
      assert.notEqual(refreshedLease.heartbeat_at, firstLease.heartbeat_at);
      assert.equal(refreshedLease.lock_id, firstLease.lock_id);
    },
    {
      entrypoint: "desktop",
      runtimeVersion: "0.1.14",
      operationId: "operation-123",
      command: "flow.dispatch:plan",
      heartbeatIntervalMs: 5,
    },
  );

  assert.equal(existsSync(path.dirname(leasePath)), false);
});

test("run mutation lock reclaims expired leases", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const run = runCli(workspace, [
    "flow",
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "current",
    "--decide",
    "current",
    "--task",
    "exercise expired lock",
    "--run-id",
    "expired-lock-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const runDir = path.join(workspace, ".agentmesh", "runs", "expired-lock-flow");
  const lockDir = writeRunMutationLock(
    runDir,
    "stale-test",
    new Date(Date.now() - 60_000),
  );

  const attach = runCli(workspace, [
    "flow",
    "attach",
    "expired-lock-flow",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nExpired lock reclaimed.",
  ]);
  assert.equal(attach.status, 0, attach.stderr);
  assert.equal(existsSync(lockDir), false);
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.completed_stages, ["plan"]);
});

test("async run mutation lock releases after awaited success and failure", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const run = runCli(workspace, [
    "flow",
    "run",
    "--workflow",
    "w-4963ede2",
    "--plan",
    "current",
    "--decide",
    "current",
    "--task",
    "exercise async lock",
    "--run-id",
    "async-lock-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const runDir = path.join(workspace, ".agentmesh", "runs", "async-lock-flow");
  const lockDir = path.join(runDir, ".agentmesh.lock");

  const result = await withRunMutationLockAsync(runDir, "async-success", async () => {
    assert.equal(existsSync(lockDir), true);
    await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(existsSync(lockDir), true);
    return "released";
  });
  assert.equal(result, "released");
  assert.equal(existsSync(lockDir), false);

  await assert.rejects(
    () =>
      withRunMutationLockAsync(runDir, "async-failure", async () => {
        assert.equal(existsSync(lockDir), true);
        await new Promise((resolve) => setTimeout(resolve, 1));
        throw new Error("async lock failure");
      }),
    /async lock failure/,
  );
  assert.equal(existsSync(lockDir), false);
});

test("run creation rejects agents whose capabilities exclude the requested stage", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const fake = path.join(workspace, "plan-only.sh");
  writeExecutable(
    fake,
    [
      "#!/usr/bin/env bash",
      "printf '# Output\\n\\nDone.\\n'",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.planner]",
      'label = "Planner"',
      'adapter = "command"',
      `command = "${fake}"`,
      "args = []",
      'capabilities = ["plan"]',
      "stdin = true",
      "",
    ].join("\n"),
  );
  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--plan",
    "planner",
    "--execute",
    "planner",
    "--review",
    "planner",
    "--decide",
    "planner",
    "--task",
    "exercise capability gate",
    "--run-id",
    "capability-flow",
  ]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /stage_assignments\.execute references agent without execute capability: planner/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "capability-flow")), false);
});

test("verify dispatch writes canonical verification artifact and timing", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const verifier = path.join(workspace, "verifier.sh");
  writeExecutable(
    verifier,
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
      "grep -q 'Stage Type: verify' \"$prompt_file\"",
      "grep -q 'Prior Output: plan (Current Plan)' \"$prompt_file\"",
      "grep -q 'Prior Output: execute (Handoff)' \"$prompt_file\"",
      "grep -q '## Verify Contract' \"$prompt_file\"",
      "printf '# Verification\\n\\nVerified by verifier.\\n' > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.verifier]",
      'label = "Verifier"',
      'adapter = "command"',
      `command = "${verifier}"`,
      "args = []",
      'capabilities = ["verify"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "verify-flow.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["plan", "execute", "verify", "decide"]',
      'description = "Exercise verify dispatch."',
      'when_to_use = ["A workflow needs a verification artifact."]',
      'packet_artifacts = ["request.md", "plan.md", "handoff.md", "verification.md", "decision.md"]',
      'quality_gates = ["Verification evidence is recorded."]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow-file",
    "verify-flow.toml",
    "--plan",
    "current",
    "--execute",
    "current",
    "--verify",
    "verifier",
    "--decide",
    "current",
    "--task",
    "verify dispatch",
    "--run-id",
    "verify-dispatch-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const attachPlan = runCli(workspace, [
    "flow",
    "attach",
    "verify-dispatch-flow",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nReady for verification.",
  ]);
  assert.equal(attachPlan.status, 0, attachPlan.stderr);

  const attachExecute = runCli(workspace, [
    "flow",
    "attach",
    "verify-dispatch-flow",
    "--stage",
    "execute",
    "--text",
    "# Handoff\n\nImplementation ready.",
  ]);
  assert.equal(attachExecute.status, 0, attachExecute.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "verify-dispatch-flow",
    "--stage",
    "verify",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "verify-dispatch-flow");
  assert.match(readFileSync(path.join(runDir, "verification.md"), "utf-8"), /Verified by verifier/);

  const artifacts = loadArtifacts(runDir);
  assert.equal(artifacts.verification.path, "verification.md");
  assert.equal(artifacts.verification.kind, "markdown");
  assert.equal(artifacts.verification.stage, "verify");
  assert.equal(artifacts.verification.agent, "verifier");

  const events = readFileSync(path.join(runDir, "events.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(
    events.some((event) =>
      event.event === "artifact.written" &&
      event.artifact === "verification" &&
      event.path === "verification.md" &&
      event.stage === "verify" &&
      event.stage_type === "verify"
    ),
    true,
  );

  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.completed_stages, ["plan", "execute", "verify"]);
  assert.equal(status.stage_timing.verify.attempt_count, 1);
  assert.match(status.stage_timing.verify.completed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(status.agent_timing.verify.verifier.attempt_count, 1);
  assert.match(status.agent_timing.verify.verifier.completed_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("dispatch all writes repeated verify artifacts without collisions", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const verifier = path.join(workspace, "repeated-verifier.sh");
  writeExecutable(
    verifier,
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
      "  */verification.md)",
      "    grep -q 'Artifact: handoff.md' \"$prompt_file\"",
      "    printf '# Verification\\n\\nFirst verification output.\\n' > \"$output_file\" ;;",
      "  */verification_2.md)",
      "    grep -q 'Artifact: verification.md' \"$prompt_file\"",
      "    printf '# Verification\\n\\nSecond verification output.\\n' > \"$output_file\" ;;",
      "  *)",
      "    echo \"unexpected output path: $output_file\" >&2",
      "    exit 8 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.verifier]",
      'label = "Verifier"',
      'adapter = "command"',
      `command = "${verifier}"`,
      "args = []",
      'capabilities = ["verify"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "repeated-verify.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["plan", "execute", "verify", "verify", "decide"]',
      'description = "Exercise repeated verify dispatch."',
      'when_to_use = ["A workflow needs repeated verification."]',
      'packet_artifacts = ["request.md", "plan.md", "handoff.md", "verification.md", "verification_2.md", "decision.md"]',
      'quality_gates = ["Repeated verify nodes use unique artifacts."]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow-file",
    "repeated-verify.toml",
    "--plan",
    "current",
    "--execute",
    "current",
    "--verify",
    "verifier",
    "--decide",
    "current",
    "--task",
    "repeated verify dispatch",
    "--run-id",
    "repeated-verify-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  assert.equal(runCli(workspace, [
    "flow",
    "attach",
    "repeated-verify-flow",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nReady.",
  ]).status, 0);
  assert.equal(runCli(workspace, [
    "flow",
    "attach",
    "repeated-verify-flow",
    "--stage",
    "execute",
    "--text",
    "# Handoff\n\nReady.",
  ]).status, 0);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "repeated-verify-flow",
    "--stage",
    "all",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);
  assert.match(dispatch.stdout, /Dispatched: verify, verify_2/);
  assert.match(dispatch.stdout, /Awaiting current: decide/);

  const runDir = path.join(workspace, ".agentmesh", "runs", "repeated-verify-flow");
  assert.match(readFileSync(path.join(runDir, "verification.md"), "utf-8"), /First verification output/);
  assert.match(readFileSync(path.join(runDir, "verification_2.md"), "utf-8"), /Second verification output/);

  const artifacts = loadArtifacts(runDir);
  assert.equal(artifacts.verification.path, "verification.md");
  assert.equal(artifacts.verification_2.path, "verification_2.md");

  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.completed_stages, ["plan", "execute", "verify", "verify_2"]);
  assert.equal(status.stage_timing.verify.attempt_count, 1);
  assert.equal(status.stage_timing.verify_2.attempt_count, 1);
});

test("run creation rejects verify agents whose capabilities exclude verify", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const worker = path.join(workspace, "worker.sh");
  writeExecutable(
    worker,
    [
      "#!/usr/bin/env bash",
      "printf '# Verification\\n\\nShould not run.\\n' > \"$2\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.worker]",
      'label = "Worker"',
      'adapter = "command"',
      `command = "${worker}"`,
      "args = []",
      'capabilities = ["execute"]',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "verify-only.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["verify", "decide"]',
      'description = "Exercise verify capability gate."',
      'when_to_use = ["A workflow starts with verification."]',
      'packet_artifacts = ["request.md", "verification.md", "decision.md"]',
      'quality_gates = ["Verifier must support verify."]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow-file",
    "verify-only.toml",
    "--verify",
    "worker",
    "--decide",
    "current",
    "--task",
    "verify capability gate",
    "--run-id",
    "verify-capability-flow",
  ]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /stage_assignments\.verify references agent without verify capability: worker/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "verify-capability-flow")), false);
});

test("verify fanout starts agents concurrently and writes aggregate evidence", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const verifier = path.join(workspace, "verifier.sh");
  const markerDir = path.join(workspace, "verify-markers");
  writeExecutable(
    verifier,
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
      `marker_dir=${bashString(markerDir)}`,
      "mkdir -p \"$marker_dir\"",
      "agent_name=$(basename \"$output_file\" .md)",
      "case \"$agent_name\" in",
      "  verifier_a) other_agent='verifier_b' ;;",
      "  verifier_b) other_agent='verifier_a' ;;",
      "  *) echo \"unexpected verifier: $agent_name\" >&2; exit 8 ;;",
      "esac",
      "grep -q \"Agent: ${agent_name}\" \"$prompt_file\"",
      "test -f \"$(dirname \"$(dirname \"$(dirname \"$output_file\")\")\")/prompts/verify/verifier_a.md\"",
      "test -f \"$(dirname \"$(dirname \"$(dirname \"$output_file\")\")\")/prompts/verify/verifier_b.md\"",
      "touch \"$marker_dir/${agent_name}.started\"",
      "deadline=$((SECONDS + 5))",
      "while [[ ! -f \"$marker_dir/${other_agent}.started\" ]]; do",
      "  if (( SECONDS >= deadline )); then",
      "    echo \"timed out waiting for ${other_agent}\" >&2",
      "    exit 9",
      "  fi",
      "  sleep 0.05",
      "done",
      "printf '# Verification\\n\\n%s concurrent evidence.\\n' \"$agent_name\" > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.verifier_a]",
      'label = "Verifier A"',
      'adapter = "command"',
      `command = "${verifier}"`,
      "args = []",
      'capabilities = ["verify"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.verifier_b]",
      'label = "Verifier B"',
      'adapter = "command"',
      `command = "${verifier}"`,
      "args = []",
      'capabilities = ["verify"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "verify-fanout.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["verify", "decide"]',
      'description = "Exercise verify fanout."',
      'when_to_use = ["A workflow tries multi-agent verification."]',
      'packet_artifacts = ["request.md", "verification.md", "decision.md"]',
      'quality_gates = ["Verify fanout evidence is aggregated."]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow-file",
    "verify-fanout.toml",
    "--verify",
    "verifier_a",
    "--verify",
    "verifier_b",
    "--decide",
    "current",
    "--task",
    "verify fanout",
    "--run-id",
    "verify-fanout-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "verify-fanout-flow",
    "--stage",
    "verify",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "verify-fanout-flow");
  assert.match(
    readFileSync(path.join(runDir, "outputs", "verify", "verifier_a.md"), "utf-8"),
    /verifier_a concurrent evidence/,
  );
  assert.match(
    readFileSync(path.join(runDir, "outputs", "verify", "verifier_b.md"), "utf-8"),
    /verifier_b concurrent evidence/,
  );
  const verification = readFileSync(path.join(runDir, "verification.md"), "utf-8");
  assert.match(verification, /verifier_a: completed/);
  assert.match(verification, /verifier_b: completed/);
  assert.match(verification, /verifier_a concurrent evidence/);
  assert.match(verification, /verifier_b concurrent evidence/);
  const artifacts = loadArtifacts(runDir);
  assert.equal(artifacts.output_verify_verifier_a.path, "outputs/verify/verifier_a.md");
  assert.equal(artifacts.output_verify_verifier_b.path, "outputs/verify/verifier_b.md");
  assert.equal(artifacts.verification.path, "verification.md");

  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.completed_stages, ["verify"]);
  assert.equal(status.stage_timing.verify.attempt_count, 1);
  assert.equal(status.agent_timing.verify.verifier_a.attempt_count, 1);
  assert.equal(status.agent_timing.verify.verifier_b.attempt_count, 1);
});

test("verify fanout preserves partial evidence and retry reuses completed outputs", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const verifier = path.join(workspace, "partial-verifier.sh");
  const stateDir = path.join(workspace, "verify-state");
  writeExecutable(
    verifier,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      `state_dir=${bashString(stateDir)}`,
      "mkdir -p \"$state_dir\"",
      "agent_name=$(basename \"$output_file\" .md)",
      "count_file=\"$state_dir/${agent_name}.count\"",
      "count=0",
      "if [[ -f \"$count_file\" ]]; then count=$(cat \"$count_file\"); fi",
      "count=$((count + 1))",
      "printf '%s' \"$count\" > \"$count_file\"",
      "if [[ \"$agent_name\" == \"verifier_b\" && ! -f \"$state_dir/allow-b\" ]]; then",
      "  exit 7",
      "fi",
      "printf '# Verification\\n\\n%s evidence run %s.\\n' \"$agent_name\" \"$count\" > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.verifier_a]",
      'label = "Verifier A"',
      'adapter = "command"',
      `command = "${verifier}"`,
      "args = []",
      'capabilities = ["verify"]',
      'output_file_arg = "--output-file"',
      "",
      "[agents.verifier_b]",
      'label = "Verifier B"',
      'adapter = "command"',
      `command = "${verifier}"`,
      "args = []",
      'capabilities = ["verify"]',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "verify-retry.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["verify", "decide"]',
      'description = "Exercise verify fanout retry."',
      'when_to_use = ["A workflow retries partial verification."]',
      'packet_artifacts = ["request.md", "verification.md", "decision.md"]',
      'quality_gates = ["Verify retry reuses completed evidence."]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow-file",
    "verify-retry.toml",
    "--verify",
    "verifier_a",
    "--verify",
    "verifier_b",
    "--decide",
    "current",
    "--task",
    "verify fanout retry",
    "--run-id",
    "verify-retry-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const failed = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "verify-retry-flow",
    "--stage",
    "verify",
  ]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /stage 'verify' failed for agent 'verifier_b' with exit code 7/);

  const runDir = path.join(workspace, ".agentmesh", "runs", "verify-retry-flow");
  assert.match(
    readFileSync(path.join(runDir, "outputs", "verify", "verifier_a.md"), "utf-8"),
    /verifier_a evidence run 1/,
  );
  const partialVerification = readFileSync(path.join(runDir, "verification.md"), "utf-8");
  assert.match(partialVerification, /verifier_a: completed/);
  assert.match(partialVerification, /verifier_b: failed \(exit 7\)/);
  assert.equal(readFileSync(path.join(stateDir, "verifier_a.count"), "utf-8"), "1");

  writeFileSync(path.join(stateDir, "allow-b"), "true\n");
  const retried = runCli(workspace, [
    "--config",
    config,
    "flow",
    "retry",
    "verify-retry-flow",
    "--stage",
    "verify",
  ]);
  assert.equal(retried.status, 0, retried.stderr);

  assert.equal(readFileSync(path.join(stateDir, "verifier_a.count"), "utf-8"), "1");
  assert.equal(readFileSync(path.join(stateDir, "verifier_b.count"), "utf-8"), "2");
  const verification = readFileSync(path.join(runDir, "verification.md"), "utf-8");
  assert.match(verification, /verifier_a: completed/);
  assert.match(verification, /verifier_b: completed/);
  assert.doesNotMatch(verification, /failed \(exit 7\)/);

  const events = readFileSync(path.join(runDir, "events.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const reused = events.find((event) =>
    event.event === "stage.agent_reused" && event.agent === "verifier_a"
  );
  assert.equal(reused.stage, "verify");
  assert.equal(reused.path, "outputs/verify/verifier_a.md");
  assert.equal(reused.exit_code, 0);
  assert.equal(reused.timed_out, false);
  assert.equal(reused.duration_ms, 0);

  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.completed_stages, ["verify"]);
  assert.equal(status.failed_stage, undefined);
});

test("dispatch all runs repeated workflow nodes in order without artifact collisions", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const runner = path.join(workspace, "runner.sh");
  writeExecutable(
    runner,
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
      "stage=$(awk -F': ' '/^Stage: / { print $2; exit }' \"$prompt_file\")",
      "case \"$output_file\" in",
      "  */plan.md)",
      "    printf '# Plan\\n\\nPlan output for %s.\\n' \"$stage\" > \"$output_file\" ;;",
      "  */handoff.md)",
      "    printf '# Handoff\\n\\nFirst execute output.\\n' > \"$output_file\" ;;",
      "  */handoff_2.md)",
      "    grep -q 'decision.md' \"$prompt_file\"",
      "    printf '# Handoff\\n\\nSecond execute output.\\n' > \"$output_file\" ;;",
      "  */reviews/review_2/runner.md)",
      "    grep -q 'handoff_2.md' \"$prompt_file\"",
      "    printf '# Review\\n\\nSecond review output.\\n' > \"$output_file\" ;;",
      "  */reviews/runner.md)",
      "    printf '# Review\\n\\nFirst review output.\\n' > \"$output_file\" ;;",
      "  */decision.md)",
      "    grep -q 'findings.md' \"$prompt_file\"",
      "    printf '# Decision\\n\\nFirst checkpoint decision.\\n' > \"$output_file\" ;;",
      "  */decision_2.md)",
      "    grep -q 'findings_2.md' \"$prompt_file\"",
      "    grep -q 'decision.md' \"$prompt_file\"",
      "    printf '# Decision\\n\\nDecision output.\\n' > \"$output_file\" ;;",
      "  *)",
      "    echo \"unexpected output path: $output_file\" >&2",
      "    exit 8 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.runner]",
      'label = "Runner"',
      'adapter = "command"',
      `command = "${runner}"`,
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
      'stages = ["plan", "execute", "review", "decide", "execute", "review", "decide"]',
      'description = "Exercise repeated dispatch."',
      'when_to_use = ["A delivery needs a second execution round."]',
      'packet_artifacts = ["request.md", "plan.md", "handoff.md", "findings.md", "decision.md", "handoff_2.md", "findings_2.md", "decision_2.md"]',
      'quality_gates = ["Repeated nodes use unique ids."]',
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
    "runner",
    "--execute",
    "runner",
    "--review",
    "runner",
    "--decide",
    "runner",
    "--task",
    "repeated dispatch",
    "--run-id",
    "repeated-dispatch-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const humanStatus = runCli(workspace, ["flow", "status", "repeated-dispatch-flow"]);
  assert.equal(humanStatus.status, 0, humanStatus.stderr);
  assert.match(
    humanStatus.stdout,
    /Stages: plan, execute, review, decide, execute_2, review_2, decide_2/,
  );

  const outOfOrder = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "repeated-dispatch-flow",
    "--stage",
    "execute_2",
  ]);
  assert.equal(outOfOrder.status, 1);
  assert.match(outOfOrder.stderr, /cannot dispatch execute_2 before predecessor stage 'plan' is completed/);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "repeated-dispatch-flow",
    "--stage",
    "all",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);
  assert.match(dispatch.stdout, /Dispatched: plan, execute, review, decide, execute_2, review_2, decide_2/);

  const runDir = path.join(workspace, ".agentmesh", "runs", "repeated-dispatch-flow");
  assert.match(readFileSync(path.join(runDir, "handoff.md"), "utf-8"), /First execute output/);
  assert.match(readFileSync(path.join(runDir, "handoff_2.md"), "utf-8"), /Second execute output/);
  assert.match(readFileSync(path.join(runDir, "reviews", "runner.md"), "utf-8"), /First review output/);
  assert.match(readFileSync(path.join(runDir, "reviews", "review_2", "runner.md"), "utf-8"), /Second review output/);
  assert.match(readFileSync(path.join(runDir, "findings.md"), "utf-8"), /First review output/);
  assert.match(readFileSync(path.join(runDir, "findings_2.md"), "utf-8"), /Second review output/);
  assert.match(readFileSync(path.join(runDir, "decision.md"), "utf-8"), /First checkpoint decision/);
  assert.match(readFileSync(path.join(runDir, "decision_2.md"), "utf-8"), /Decision output/);

  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.completed_stages, [
    "plan",
    "execute",
    "review",
    "decide",
    "execute_2",
    "review_2",
    "decide_2",
  ]);
  assert.equal(status.status, "decide_2_completed");

  const artifacts = loadArtifacts(runDir);
  assert.equal(artifacts.handoff.path, "handoff.md");
  assert.equal(artifacts.handoff_2.path, "handoff_2.md");
  assert.equal(artifacts.review_runner.path, "reviews/runner.md");
  assert.equal(artifacts.review_2_runner.path, "reviews/review_2/runner.md");
  assert.equal(artifacts.findings.path, "findings.md");
  assert.equal(artifacts.findings_2.path, "findings_2.md");
  assert.equal(artifacts.decision.path, "decision.md");
  assert.equal(artifacts.decision_2.path, "decision_2.md");

  const events = readFileSync(path.join(runDir, "events.jsonl"), "utf-8");
  assert.match(events, /"stage":"execute_2"/);
  assert.match(events, /"node_id":"execute_2"/);
  assert.match(events, /"stage_type":"execute"/);
});

test("flow attach rejects repeated successor nodes until predecessors complete", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(
    path.join(workspace, "repeated-current.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["plan", "execute", "review", "execute", "review", "decide"]',
      'description = "Exercise current-owned repeated nodes."',
      'when_to_use = ["A current host owns every stage."]',
      'packet_artifacts = ["request.md", "assignment.toml", "plan.md", "handoff.md", "findings.md", "handoff_2.md", "findings_2.md", "decision.md"]',
      'quality_gates = ["Later current attachments require prior evidence."]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "flow",
    "run",
    "--workflow-file",
    "repeated-current.toml",
    "--plan",
    "current",
    "--execute",
    "current",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "attach repeated successor",
    "--run-id",
    "attach-repeated-successor-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const attach = runCli(workspace, [
    "flow",
    "attach",
    "attach-repeated-successor-flow",
    "--stage",
    "execute_2",
    "--text",
    "# Handoff\n\nSecond execute before predecessors.",
  ]);
  assert.equal(attach.status, 1);
  assert.match(
    attach.stderr,
    /cannot attach execute_2 before predecessor stage 'plan' is completed/,
  );

  const runDir = path.join(workspace, ".agentmesh", "runs", "attach-repeated-successor-flow");
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.completed_stages, []);
  assert.equal(existsSync(path.join(runDir, "handoff_2.md")), false);
});

test("review fanout starts agents concurrently after writing all prompts", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const reviewer = path.join(workspace, "concurrent-reviewer.sh");
  const markerDir = path.join(workspace, "review-markers");
  writeExecutable(
    reviewer,
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
      `marker_dir=${bashString(markerDir)}`,
      "mkdir -p \"$marker_dir\"",
      "agent_name=$(basename \"$output_file\" .md)",
      "case \"$agent_name\" in",
      "  reviewer_a) other_agent='reviewer_b' ;;",
      "  reviewer_b) other_agent='reviewer_a' ;;",
      "  *) echo \"unexpected reviewer: $agent_name\" >&2; exit 8 ;;",
      "esac",
      "run_dir=$(dirname \"$(dirname \"$output_file\")\")",
      "grep -q \"Agent: ${agent_name}\" \"$prompt_file\"",
      "test -f \"$run_dir/prompts/review/reviewer_a.md\"",
      "test -f \"$run_dir/prompts/review/reviewer_b.md\"",
      "touch \"$marker_dir/${agent_name}.started\"",
      "deadline=$((SECONDS + 5))",
      "while [[ ! -f \"$marker_dir/${other_agent}.started\" ]]; do",
      "  if (( SECONDS >= deadline )); then",
      "    echo \"timed out waiting for ${other_agent}\" >&2",
      "    exit 9",
      "  fi",
      "  sleep 0.05",
      "done",
      "printf '# Review\\n\\n%s concurrent output.\\n' \"$agent_name\" > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.reviewer_a]",
      'label = "Reviewer A"',
      'adapter = "command"',
      `command = "${reviewer}"`,
      "args = []",
      'capabilities = ["review"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.reviewer_b]",
      'label = "Reviewer B"',
      'adapter = "command"',
      `command = "${reviewer}"`,
      "args = []",
      'capabilities = ["review"]',
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
    "current",
    "--execute",
    "current",
    "--review",
    "reviewer_a",
    "--review",
    "reviewer_b",
    "--decide",
    "current",
    "--task",
    "exercise concurrent review fanout",
    "--run-id",
    "concurrent-review-fanout-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  assert.equal(runCli(workspace, [
    "flow",
    "attach",
    "concurrent-review-fanout-flow",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nReady for concurrent review fanout.",
  ]).status, 0);
  assert.equal(runCli(workspace, [
    "flow",
    "attach",
    "concurrent-review-fanout-flow",
    "--stage",
    "execute",
    "--text",
    "# Handoff\n\nReady for concurrent review fanout.",
  ]).status, 0);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "concurrent-review-fanout-flow",
    "--stage",
    "review",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "concurrent-review-fanout-flow");
  assert.match(readFileSync(path.join(runDir, "reviews", "reviewer_a.md"), "utf-8"), /reviewer_a concurrent output/);
  assert.match(readFileSync(path.join(runDir, "reviews", "reviewer_b.md"), "utf-8"), /reviewer_b concurrent output/);
  const findings = readFileSync(path.join(runDir, "findings.md"), "utf-8");
  assert.match(findings, /reviewer_a concurrent output/);
  assert.match(findings, /reviewer_b concurrent output/);
});

test("fanout records per-agent events and logs without stream interleaving", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const reviewer = path.join(workspace, "logged-reviewer.sh");
  writeExecutable(
    reviewer,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "output_file=''",
      "while [[ $# -gt 0 ]]; do",
      "  case \"$1\" in",
      "    --output-file) output_file=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "agent_name=$(basename \"$output_file\" .md)",
      "printf 'stdout %s one\\nstdout %s two\\n' \"$agent_name\" \"$agent_name\"",
      "printf 'stderr %s one\\nstderr %s two\\n' \"$agent_name\" \"$agent_name\" >&2",
      "printf '# Review\\n\\n%s logged output.\\n' \"$agent_name\" > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.reviewer_a]",
      'label = "Reviewer A"',
      'adapter = "command"',
      `command = "${reviewer}"`,
      "args = []",
      'capabilities = ["review"]',
      'output_file_arg = "--output-file"',
      "",
      "[agents.reviewer_b]",
      'label = "Reviewer B"',
      'adapter = "command"',
      `command = "${reviewer}"`,
      "args = []",
      'capabilities = ["review"]',
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
    "current",
    "--execute",
    "current",
    "--review",
    "reviewer_a",
    "--review",
    "reviewer_b",
    "--decide",
    "current",
    "--task",
    "logged review fanout",
    "--run-id",
    "logged-review-fanout-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(runCli(workspace, [
    "flow",
    "attach",
    "logged-review-fanout-flow",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nReady.",
  ]).status, 0);
  assert.equal(runCli(workspace, [
    "flow",
    "attach",
    "logged-review-fanout-flow",
    "--stage",
    "execute",
    "--text",
    "# Handoff\n\nReady.",
  ]).status, 0);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "logged-review-fanout-flow",
    "--stage",
    "review",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "logged-review-fanout-flow");
  const events = readFileSync(path.join(runDir, "events.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const started = events.filter((event) => event.event === "stage.agent_started");
  const completed = events.filter((event) => event.event === "stage.agent_completed");
  assert.equal(started.length, 2);
  assert.equal(completed.length, 2);
  for (const event of [...started, ...completed]) {
    assert.equal(event.stage, "review");
    assert.match(event.agent, /^reviewer_[ab]$/);
    assert.match(event.path, /^reviews\/reviewer_[ab]\.md$/);
    assert.equal(event.timed_out, false);
  }
  for (const event of completed) {
    assert.equal(event.exit_code, 0);
    assert.equal(typeof event.duration_ms, "number");
  }

  const reviewerAStdout = readFileSync(path.join(runDir, "logs", "review", "reviewer_a.stdout.log"), "utf-8");
  const reviewerAStderr = readFileSync(path.join(runDir, "logs", "review", "reviewer_a.stderr.log"), "utf-8");
  const reviewerBStdout = readFileSync(path.join(runDir, "logs", "review", "reviewer_b.stdout.log"), "utf-8");
  const reviewerBStderr = readFileSync(path.join(runDir, "logs", "review", "reviewer_b.stderr.log"), "utf-8");
  assert.match(reviewerAStdout, /stdout reviewer_a one/);
  assert.doesNotMatch(reviewerAStdout, /reviewer_b/);
  assert.match(reviewerAStderr, /stderr reviewer_a one/);
  assert.doesNotMatch(reviewerAStderr, /reviewer_b/);
  assert.match(reviewerBStdout, /stdout reviewer_b one/);
  assert.doesNotMatch(reviewerBStdout, /reviewer_a/);
  assert.match(reviewerBStderr, /stderr reviewer_b one/);
  assert.doesNotMatch(reviewerBStderr, /reviewer_a/);
});

test("review fanout writes isolated prompt and output slots per reviewer", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const reviewer = path.join(workspace, "reviewer.sh");
  writeExecutable(
    reviewer,
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
      "grep -q \"Agent: ${agent_name}\" \"$prompt_file\"",
      "printf '# Review\\n\\n%s output.\\n' \"$agent_name\" > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.reviewer_a]",
      'label = "Reviewer A"',
      'adapter = "command"',
      `command = "${reviewer}"`,
      "args = []",
      'capabilities = ["review"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.reviewer_b]",
      'label = "Reviewer B"',
      'adapter = "command"',
      `command = "${reviewer}"`,
      "args = []",
      'capabilities = ["review"]',
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
    "current",
    "--execute",
    "current",
    "--review",
    "reviewer_a",
    "--review",
    "reviewer_b",
    "--decide",
    "current",
    "--task",
    "exercise review fanout",
    "--run-id",
    "review-fanout-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const attachPlan = runCli(workspace, [
    "flow",
    "attach",
    "review-fanout-flow",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nReady for review fanout.",
  ]);
  assert.equal(attachPlan.status, 0, attachPlan.stderr);
  const attachExecute = runCli(workspace, [
    "flow",
    "attach",
    "review-fanout-flow",
    "--stage",
    "execute",
    "--text",
    "# Handoff\n\nReady for review fanout.",
  ]);
  assert.equal(attachExecute.status, 0, attachExecute.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "review-fanout-flow",
    "--stage",
    "review",
  ]);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "review-fanout-flow");
  assert.match(
    readFileSync(path.join(runDir, "prompts", "review", "reviewer_a.md"), "utf-8"),
    /Agent: reviewer_a/,
  );
  assert.match(
    readFileSync(path.join(runDir, "prompts", "review", "reviewer_b.md"), "utf-8"),
    /Agent: reviewer_b/,
  );
  assert.match(readFileSync(path.join(runDir, "reviews", "reviewer_a.md"), "utf-8"), /reviewer_a output/);
  assert.match(readFileSync(path.join(runDir, "reviews", "reviewer_b.md"), "utf-8"), /reviewer_b output/);

  const findings = readFileSync(path.join(runDir, "findings.md"), "utf-8");
  assert.match(findings, /### reviewer_a/);
  assert.match(findings, /### reviewer_b/);

  const artifacts = loadArtifacts(runDir);
  assert.equal(artifacts.prompt_review_reviewer_a.path, "prompts/review/reviewer_a.md");
  assert.equal(artifacts.prompt_review_reviewer_b.path, "prompts/review/reviewer_b.md");
  assert.equal(artifacts.review_reviewer_a.path, "reviews/reviewer_a.md");
  assert.equal(artifacts.review_reviewer_b.path, "reviews/reviewer_b.md");
});

test("review fanout failure preserves partial evidence for the decider", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const reviewer = path.join(workspace, "partial-reviewer.sh");
  writeExecutable(
    reviewer,
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
      "grep -q \"Agent: ${agent_name}\" \"$prompt_file\"",
      "if [[ \"$agent_name\" == \"reviewer_b\" ]]; then",
      "  echo 'reviewer_b failed stderr' >&2",
      "  exit 7",
      "fi",
      "printf '# Review\\n\\n%s output before partial failure.\\n' \"$agent_name\" > \"$output_file\"",
      "",
    ].join("\n"),
  );
  const config = writeConfig(
    workspace,
    [
      "[agents.reviewer_a]",
      'label = "Reviewer A"',
      'adapter = "command"',
      `command = "${reviewer}"`,
      "args = []",
      'capabilities = ["review"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
      "[agents.reviewer_b]",
      'label = "Reviewer B"',
      'adapter = "command"',
      `command = "${reviewer}"`,
      "args = []",
      'capabilities = ["review"]',
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
    "current",
    "--execute",
    "current",
    "--review",
    "reviewer_a",
    "--review",
    "reviewer_b",
    "--decide",
    "current",
    "--task",
    "exercise partial review fanout",
    "--run-id",
    "partial-review-fanout-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const attachPlan = runCli(workspace, [
    "flow",
    "attach",
    "partial-review-fanout-flow",
    "--stage",
    "plan",
    "--text",
    "# Plan\n\nReady for partial review fanout.",
  ]);
  assert.equal(attachPlan.status, 0, attachPlan.stderr);
  const attachExecute = runCli(workspace, [
    "flow",
    "attach",
    "partial-review-fanout-flow",
    "--stage",
    "execute",
    "--text",
    "# Handoff\n\nReady for partial review fanout.",
  ]);
  assert.equal(attachExecute.status, 0, attachExecute.stderr);

  const dispatch = runCli(workspace, [
    "--config",
    config,
    "flow",
    "dispatch",
    "partial-review-fanout-flow",
    "--stage",
    "review",
  ]);
  assert.equal(dispatch.status, 1);
  assert.match(dispatch.stderr, /stage 'review' failed for agent 'reviewer_b' with exit code 7/);

  const runDir = path.join(workspace, ".agentmesh", "runs", "partial-review-fanout-flow");
  assert.match(
    readFileSync(path.join(runDir, "reviews", "reviewer_a.md"), "utf-8"),
    /reviewer_a output before partial failure/,
  );
  assert.equal(existsSync(path.join(runDir, "reviews", "reviewer_b.md")), false);

  const findings = readFileSync(path.join(runDir, "findings.md"), "utf-8");
  assert.match(findings, /Reviewer reviewer_b failed during review dispatch \(exit 7\)/);
  assert.match(findings, /reviewer_a output before partial failure/);
  assert.match(
    readFileSync(path.join(runDir, "logs", "review", "reviewer_b.stderr.log"), "utf-8"),
    /reviewer_b failed stderr/,
  );

  const decidePrompt = runCli(workspace, [
    "flow",
    "prompt",
    "partial-review-fanout-flow",
    "--stage",
    "decide",
  ]);
  assert.equal(decidePrompt.status, 0, decidePrompt.stderr);
  assert.match(decidePrompt.stdout, /Reviewer reviewer_b failed during review dispatch \(exit 7\)/);
  assert.match(decidePrompt.stdout, /reviewer_a output before partial failure/);

  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.equal(status.failed_stage, "review");
  assert.deepEqual(status.completed_stages, ["plan", "execute"]);
  const events = readFileSync(path.join(runDir, "events.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const failedEvent = events.find((event) =>
    event.event === "stage.agent_failed" && event.agent === "reviewer_b"
  );
  assert.equal(failedEvent.stage, "review");
  assert.equal(failedEvent.path, "reviews/reviewer_b.md");
  assert.equal(failedEvent.exit_code, 7);
  assert.equal(failedEvent.timed_out, false);
  assert.equal(typeof failedEvent.duration_ms, "number");
});
