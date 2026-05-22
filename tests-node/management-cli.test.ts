import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
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

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-management-cli-"));
}

function runCli(
  workspace: string,
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspace,
    env: {
      ...process.env,
      HOME: path.join(workspace, ".home"),
      AGENTMESH_CONFIG: undefined,
      ...envOverrides,
    },
    encoding: "utf-8",
  });
}

function userConfig(workspace: string): string {
  return path.join(workspace, ".home", ".config", "agentmesh", "config.toml");
}

function addedAgentId(output: string): string {
  const match = output.match(/Added agent: (a-[0-9a-f]{8})/);
  assert.ok(match, `expected generated agent id in output:\n${output}`);
  return match[1];
}

function addedWorkflowId(output: string): string {
  const match = output.match(/Added workflow: (w-[0-9a-f]{8})/);
  assert.ok(match, `expected generated workflow id in output:\n${output}`);
  return match[1];
}

function addedPresetId(output: string): string {
  const match = output.match(/Added preset: (p-[0-9a-f]{8})/);
  assert.ok(match, `expected generated preset id in output:\n${output}`);
  return match[1];
}

function userWorkflow(workspace: string, workflowId: string): string {
  return path.join(workspace, ".home", ".config", "agentmesh", "workflows", `${workflowId}.toml`);
}

function userPreset(workspace: string, presetId: string): string {
  return path.join(workspace, ".home", ".config", "agentmesh", "presets", `${presetId}.toml`);
}

function writeWorkflow(filePath: string, workflowId = "docs-delivery"): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'name = "Docs Delivery"',
      'stages = ["plan", "review", "decide"]',
      'description = "Plan, review, and decide a documentation artifact."',
      'when_to_use = ["A docs artifact needs focused review."]',
      'packet_artifacts = ["request.md", "plan.md", "findings.md", "decision.md"]',
      'quality_gates = ["The decider records accepted and rejected findings."]',
      "",
    ].join("\n"),
  );
}

function writePreset(filePath: string, presetId = "review-duo"): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "schema_version = 1",
      'workflow = "w-9d94d0db"',
      "",
      "[stage_assignments]",
      'review = ["reviewer"]',
      'decide = ["current"]',
      "",
    ].join("\n"),
  );
}

function writePresetAgentConfig(workspace: string): void {
  mkdirSync(path.dirname(userConfig(workspace)), { recursive: true });
  writeFileSync(
    userConfig(workspace),
    [
      "schema_version = 1",
      "",
      "[agents.reviewer]",
      'adapter = "command"',
      'capabilities = ["review"]',
      "",
      "[agents.decider]",
      'adapter = "command"',
      'capabilities = ["decide"]',
      "",
    ].join("\n"),
  );
}

function writeAiCliShim(binDir: string, commandName: string): void {
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    path.join(binDir, commandName),
    [
      "#!/usr/bin/env bash",
      "if [[ \"$1\" == \"--version\" || \"$*\" == *\"--help\"* ]]; then exit 0; fi",
      "cat >/dev/null",
      "printf 'OK\\n'",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(path.join(binDir, commandName), 0o755);
}

test("agents remove deletes a user-level global agent only", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  writeAiCliShim(binDir, "codex");
  writeAiCliShim(binDir, "agy");
  const env = { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` };

  const addUser = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt-5.5",
  ], env);
  assert.equal(addUser.status, 0, addUser.stderr);
  const userAgentId = addedAgentId(addUser.stdout);
  const addSecond = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "antigravity",
    "--model",
    "gemini-3.1-pro",
  ], env);
  assert.equal(addSecond.status, 0, addSecond.stderr);
  const secondAgentId = addedAgentId(addSecond.stdout);

  const remove = runCli(workspace, ["agents", "remove", userAgentId]);
  assert.equal(remove.status, 0, remove.stderr);
  assert.match(remove.stdout, new RegExp(`Removed agent: ${userAgentId}`));

  assert.doesNotMatch(readFileSync(userConfig(workspace), "utf-8"), new RegExp(`\\[agents\\.${userAgentId}\\]`));
  assert.match(readFileSync(userConfig(workspace), "utf-8"), new RegExp(`\\[agents\\.${secondAgentId}\\]`));

  const list = runCli(workspace, ["agents", "list", "--json"]);
  assert.equal(list.status, 0, list.stderr);
  const agents = JSON.parse(list.stdout);
  assert.deepEqual(agents.map((agent: { id: string }) => agent.id), [secondAgentId]);
  assert.equal(agents[0].source_layer, "user");
});

test("agents remove reports a missing user-level agent without changing the registry", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.dirname(userConfig(workspace)), { recursive: true });
  writeFileSync(
    userConfig(workspace),
    [
      "schema_version = 1",
      "# keep this comment",
      "",
      "[agents.planner]",
      'adapter = "codex-cli"',
      'command = "codex"',
      'args = ["exec"]',
      'model = "gpt-5.5"',
      "",
    ].join("\n"),
  );

  const before = readFileSync(userConfig(workspace), "utf-8");
  const remove = runCli(workspace, ["agents", "remove", "executor"]);

  assert.equal(remove.status, 1);
  assert.match(remove.stderr, /agent not found in user config: executor/);
  assert.equal(readFileSync(userConfig(workspace), "utf-8"), before);
});

test("agents show enable and disable expose lifecycle status", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.dirname(userConfig(workspace)), { recursive: true });
  writeFileSync(
    userConfig(workspace),
    [
      "schema_version = 1",
      "",
      "[agents.planner]",
      'label = "Planner"',
      'adapter = "command"',
      'command = "node"',
      'args = ["-e", "process.exit(0)"]',
      'model = "local"',
      'capabilities = ["plan"]',
      "",
    ].join("\n"),
  );

  const disabled = runCli(workspace, ["agents", "disable", "planner"]);
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.match(disabled.stdout, /Disabled agent: planner/);
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /disabled = true/);

  const showDisabled = runCli(workspace, ["agents", "show", "planner", "--json"]);
  assert.equal(showDisabled.status, 0, showDisabled.stderr);
  const disabledAgent = JSON.parse(showDisabled.stdout);
  assert.equal(disabledAgent.id, "planner");
  assert.equal(disabledAgent.status, "disabled");
  assert.equal(disabledAgent.disabled, true);

  const listDisabled = runCli(workspace, ["agents", "list", "--json"]);
  assert.equal(listDisabled.status, 0, listDisabled.stderr);
  assert.equal(JSON.parse(listDisabled.stdout)[0].status, "disabled");

  const enabled = runCli(workspace, ["agents", "enable", "planner"]);
  assert.equal(enabled.status, 0, enabled.stderr);
  assert.match(enabled.stdout, /Enabled agent: planner/);
  assert.match(readFileSync(userConfig(workspace), "utf-8"), /disabled = false/);

  const showEnabled = runCli(workspace, ["agents", "show", "planner", "--json"]);
  assert.equal(showEnabled.status, 0, showEnabled.stderr);
  const enabledAgent = JSON.parse(showEnabled.stdout);
  assert.equal(enabledAgent.status, "enabled");
  assert.equal(enabledAgent.disabled, false);
});

test("workflows add update and remove manage the user-level global registry", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, "docs-delivery.toml");
  writeWorkflow(source);

  const addUser = runCli(workspace, ["workflows", "add", source]);
  assert.equal(addUser.status, 0, addUser.stderr);
  const userWorkflowId = addedWorkflowId(addUser.stdout);
  assert.equal(existsSync(userWorkflow(workspace, userWorkflowId)), true);

  const listUser = runCli(workspace, ["workflows", "list", "--json"]);
  assert.equal(listUser.status, 0, listUser.stderr);
  assert.ok(
    JSON.parse(listUser.stdout).some(
      (workflow: { workflowId: string; source: string }) =>
        workflow.workflowId === userWorkflowId && workflow.source === "user",
    ),
  );

  const updatedSource = path.join(workspace, "docs-delivery-updated.toml");
  writeFileSync(
    updatedSource,
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'name = "Docs Delivery Updated"',
      'stages = ["plan", "review", "decide"]',
      'description = "Updated documentation delivery workflow."',
      'when_to_use = ["A docs artifact needs updated review."]',
      'packet_artifacts = ["request.md", "plan.md", "findings.md", "decision.md"]',
      'quality_gates = ["The updated decider records accepted and rejected findings."]',
      "",
    ].join("\n"),
  );
  const updateUser = runCli(workspace, ["workflows", "update", userWorkflowId, updatedSource]);
  assert.equal(updateUser.status, 0, updateUser.stderr);
  assert.match(updateUser.stdout, new RegExp(`Updated workflow: ${userWorkflowId}`));
  const showUpdated = runCli(workspace, ["workflows", "show", userWorkflowId]);
  assert.equal(showUpdated.status, 0, showUpdated.stderr);
  assert.match(showUpdated.stdout, /# Docs Delivery Updated/);

  const removeUser = runCli(workspace, ["workflows", "remove", userWorkflowId]);
  assert.equal(removeUser.status, 0, removeUser.stderr);
  assert.match(removeUser.stdout, new RegExp(`Removed workflow: ${userWorkflowId}`));
  assert.equal(existsSync(userWorkflow(workspace, userWorkflowId)), false);

});

test("workflows remove rejects built-in workflows", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const remove = runCli(workspace, ["workflows", "remove", "w-7db15660"]);
  assert.equal(remove.status, 1);
  assert.match(remove.stderr, /cannot remove built-in workflow: w-7db15660/);
});

test("workflows update rejects built-in workflows", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, "docs-delivery.toml");
  writeWorkflow(source);

  const update = runCli(workspace, ["workflows", "update", "w-7db15660", source]);
  assert.equal(update.status, 1);
  assert.match(update.stderr, /cannot update built-in workflow: w-7db15660/);
});

test("workflows add generates a new id instead of overwriting by source name", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const existingPath = userWorkflow(workspace, "incoming");
  writeWorkflow(existingPath, "keep-me");
  const before = readFileSync(existingPath, "utf-8");
  const source = path.join(workspace, "incoming.toml");
  writeWorkflow(source, "incoming");

  const add = runCli(workspace, ["workflows", "add", source]);

  assert.equal(add.status, 0, add.stderr);
  const workflowId = addedWorkflowId(add.stdout);
  assert.notEqual(workflowId, "incoming");
  assert.equal(existsSync(userWorkflow(workspace, workflowId)), true);
  assert.equal(readFileSync(existingPath, "utf-8"), before);
});

test("workflows add rejects invalid workflow files before copying", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, "invalid.toml");
  writeFileSync(
    source,
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["plan", "review", "decide"]',
      'description = "Invalid workflow."',
      'when_to_use = ["Invalid workflow file is tested."]',
      'packet_artifacts = ["plan.md", "decision.md"]',
      'quality_gates = ["Invalid workflow is rejected."]',
      "",
    ].join("\n"),
  );

  const add = runCli(workspace, ["workflows", "add", source]);

  assert.equal(add.status, 1);
  assert.match(add.stderr, /packet_artifacts missing canonical artifact findings\.md for review/);
  assert.equal(existsSync(userWorkflow(workspace, "invalid-workflow")), false);
});

test("workflows remove rejects explicit scope flags because workflows are global", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const workflowPath = userWorkflow(workspace, "docs-delivery");
  writeWorkflow(workflowPath);

  const remove = runCli(workspace, [
    "workflows",
    "remove",
    "docs-delivery",
    "--scope",
    "user",
  ]);

  assert.equal(remove.status, 2);
  assert.match(remove.stderr, /workflows are global user-level resources; --scope is not supported/);
  assert.equal(existsSync(workflowPath), true);
});

test("preset init emits workflow-derived node placeholders", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const init = runCli(workspace, ["preset", "init", "--workflow", "w-1ab330ed"]);

  assert.equal(init.status, 0, init.stderr);
  assert.doesNotMatch(init.stdout, /id = /);
  assert.match(init.stdout, /workflow = "w-1ab330ed"/);
  assert.match(init.stdout, /\[stage_assignments\]/);
  assert.match(init.stdout, /plan = \[\]/);
  assert.match(init.stdout, /execute = \[\]/);
  assert.match(init.stdout, /verify = \[\]/);
  assert.match(init.stdout, /review = \[\]/);
  assert.match(init.stdout, /decide = \[\]/);
  assert.match(init.stdout, /\[failure_policy\.nodes\.plan\]/);
  assert.match(init.stdout, /\[fallback\.nodes\.plan\]/);
});

test("preset add list show doctor update and remove manage the user-level global registry", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writePresetAgentConfig(workspace);
  const source = path.join(workspace, "review-duo.toml");
  writePreset(source);

  const add = runCli(workspace, ["preset", "add", source]);
  assert.equal(add.status, 0, add.stderr);
  const presetId = addedPresetId(add.stdout);
  assert.equal(existsSync(userPreset(workspace, presetId)), true);

  const list = runCli(workspace, ["preset", "list", "--json"]);
  assert.equal(list.status, 0, list.stderr);
  assert.ok(
    JSON.parse(list.stdout).some(
      (preset: { presetId: string; workflowId: string; source: string }) =>
        preset.presetId === presetId &&
        preset.workflowId === "w-9d94d0db" &&
        preset.source === "user",
    ),
  );

  const show = runCli(workspace, ["preset", "show", presetId, "--json"]);
  assert.equal(show.status, 0, show.stderr);
  const preset = JSON.parse(show.stdout);
  assert.equal(preset.presetId, presetId);
  assert.deepEqual(preset.stageAssignments, {
    review: ["reviewer"],
    decide: ["current"],
  });

  const updatedSource = path.join(workspace, "review-duo-updated.toml");
  writeFileSync(
    updatedSource,
    [
      "schema_version = 1",
      'name = "Review Duo Updated"',
      'workflow = "w-9d94d0db"',
      "",
      "[stage_assignments]",
      'review = ["reviewer"]',
      'decide = ["decider"]',
      "",
    ].join("\n"),
  );
  const update = runCli(workspace, ["preset", "update", presetId, updatedSource]);
  assert.equal(update.status, 0, update.stderr);
  assert.match(update.stdout, new RegExp(`Updated preset: ${presetId}`));
  const showUpdated = runCli(workspace, ["preset", "show", presetId, "--json"]);
  assert.equal(showUpdated.status, 0, showUpdated.stderr);
  assert.deepEqual(JSON.parse(showUpdated.stdout).stageAssignments, {
    review: ["reviewer"],
    decide: ["decider"],
  });

  const doctor = runCli(workspace, ["preset", "doctor", presetId, "--json"]);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.deepEqual(JSON.parse(doctor.stdout), {
    preset_id: presetId,
    workflow_id: "w-9d94d0db",
    ok: true,
    warnings: [],
  });

  const remove = runCli(workspace, ["preset", "remove", presetId]);
  assert.equal(remove.status, 0, remove.stderr);
  assert.match(remove.stdout, new RegExp(`Removed preset: ${presetId}`));
  assert.equal(existsSync(userPreset(workspace, presetId)), false);
});

test("preset add rejects invalid node ids with derived node guidance", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writePresetAgentConfig(workspace);
  const source = path.join(workspace, "invalid-preset.toml");
  writeFileSync(
    source,
    [
      "schema_version = 1",
      'workflow = "w-9d94d0db"',
      "",
      "[stage_assignments]",
      'execute = ["reviewer"]',
      "",
    ].join("\n"),
  );

  const add = runCli(workspace, ["preset", "add", source]);

  assert.equal(add.status, 1);
  assert.match(add.stderr, /unknown stage_assignments node id 'execute'; valid node ids: review, decide/);
  assert.equal(existsSync(userPreset(workspace, "invalid-preset")), false);
});

test("resource add commands reject explicit scope flags", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, "docs-delivery.toml");
  writeWorkflow(source);

  const addAgent = runCli(workspace, [
    "agents",
    "add",
    "--adapter",
    "codex",
    "--model",
    "gpt-5.5",
    "--scope",
  ]);
  assert.equal(addAgent.status, 2);
  assert.match(addAgent.stderr, /agents are global user-level resources; --scope is not supported/);
  assert.equal(existsSync(userConfig(workspace)), false);

  const addWorkflow = runCli(workspace, ["workflows", "add", source, "--scope"]);
  assert.equal(addWorkflow.status, 2);
  assert.match(addWorkflow.stderr, /workflows are global user-level resources; --scope is not supported/);
  assert.equal(existsSync(userWorkflow(workspace, "docs-delivery")), false);

  const presetSource = path.join(workspace, "review-duo.toml");
  writePreset(presetSource);
  const addPreset = runCli(workspace, ["preset", "add", presetSource, "--scope"]);
  assert.equal(addPreset.status, 2);
  assert.match(addPreset.stderr, /presets are global user-level resources; --scope is not supported/);
  assert.equal(existsSync(userPreset(workspace, "review-duo")), false);
});
