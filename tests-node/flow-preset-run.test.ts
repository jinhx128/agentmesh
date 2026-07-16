import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_INVOCATION_TIMEOUT_SECONDS,
  PacketStatusSchema,
} from "../packages/core/src/index.js";
import {
  disableRegisteredWorkspace,
  listRegisteredWorkspaces,
  registerWorkspace,
} from "../packages/runtime/src/workspaces/registry.js";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-flow-preset-run-"));
}

function runCli(workspace: string, args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspace,
    env: {
      ...process.env,
      HOME: path.join(workspace, ".home"),
      AGENTMESH_CONFIG: undefined,
    },
    encoding: "utf-8",
  });
}

function userConfig(workspace: string): string {
  return path.join(workspace, ".home", ".config", "agentmesh", "config.toml");
}

function userPreset(workspace: string, presetId: string): string {
  return path.join(workspace, ".home", ".config", "agentmesh", "presets", `${presetId}.toml`);
}

function userWorkflow(workspace: string, workflowId: string): string {
  return path.join(workspace, ".home", ".config", "agentmesh", "workflows", `${workflowId}.toml`);
}

function workspaceRegistry(workspace: string): string {
  return path.join(workspace, ".home", ".config", "agentmesh", "workspaces.json");
}

function writeConfigAndPreset(workspace: string, presetId = "review-duo"): void {
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
    ].join("\n"),
  );
  mkdirSync(path.dirname(userPreset(workspace, presetId)), { recursive: true });
  writeFileSync(
    userPreset(workspace, presetId),
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

function writeNameReferencedPreset(workspace: string): void {
  mkdirSync(path.dirname(userConfig(workspace)), { recursive: true });
  writeFileSync(
    userConfig(workspace),
    [
      "schema_version = 1",
      "",
      "[agents.a-11111111]",
      'adapter = "command"',
      'capabilities = ["review"]',
      "",
    ].join("\n"),
  );
  mkdirSync(path.dirname(userPreset(workspace, "name-preset")), { recursive: true });
  writeFileSync(
    userPreset(workspace, "name-preset"),
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

function writeDefaultedPreset(workspace: string): void {
  mkdirSync(path.dirname(userConfig(workspace)), { recursive: true });
  writeFileSync(
    userConfig(workspace),
    [
      "schema_version = 1",
      "",
      "[agents.planner]",
      'adapter = "command"',
      'capabilities = ["plan"]',
      "",
      "[agents.executor]",
      'adapter = "command"',
      'capabilities = ["execute"]',
      "",
      "[agents.verifier]",
      'adapter = "command"',
      'capabilities = ["verify"]',
      "",
      "[agents.reviewer]",
      'adapter = "command"',
      'capabilities = ["review"]',
      "",
      "[agents.decider]",
      'adapter = "command"',
      'capabilities = ["decide"]',
      "",
      "[default_stage_agents.stage_types]",
      'plan = ["planner"]',
      'verify = ["verifier"]',
      'decide = ["decider"]',
      "",
    ].join("\n"),
  );
  mkdirSync(path.dirname(userPreset(workspace, "delivery-defaults")), { recursive: true });
  writeFileSync(
    userPreset(workspace, "delivery-defaults"),
    [
      "schema_version = 1",
      'workflow = "w-1ab330ed"',
      "",
      "[stage_assignments]",
      'execute = ["executor"]',
      "",
      "[default_stage_agents.stage_types]",
      'review = ["reviewer"]',
      "",
    ].join("\n"),
  );
}

function writeRoutingPreset(workspace: string): void {
  mkdirSync(path.dirname(userConfig(workspace)), { recursive: true });
  writeFileSync(
    userConfig(workspace),
    [
      "schema_version = 1",
      "",
      "[agents.worker]",
      'adapter = "command"',
      'capabilities = ["execute"]',
      "timeout_seconds = 700",
      "",
      "[agents.preset_backup]",
      'adapter = "command"',
      'capabilities = ["execute"]',
      "",
      "[agents.global_backup]",
      'adapter = "command"',
      'capabilities = ["execute", "review", "decide"]',
      "",
      "[agents.reviewer]",
      'adapter = "command"',
      'capabilities = ["review"]',
      "",
      "[agents.decider]",
      'adapter = "command"',
      'capabilities = ["decide"]',
      "",
      "[default_stage_agents.stage_types]",
      'review = ["reviewer"]',
      'decide = ["decider"]',
      "",
      "[fallback]",
      'agents = ["global_backup"]',
      "timeout_seconds = 1100",
      "",
    ].join("\n"),
  );
  const workflowPath = userWorkflow(workspace, "strict-execute");
  mkdirSync(path.dirname(workflowPath), { recursive: true });
  writeFileSync(
    workflowPath,
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["execute", "review", "decide"]',
      'description = "Execute with fallback."',
      'when_to_use = ["A preset fallback route is tested."]',
      'packet_artifacts = ["handoff.md", "findings.md", "decision.md"]',
      'quality_gates = ["Execute fallback is materialized."]',
      "",
    ].join("\n"),
  );
  mkdirSync(path.dirname(userPreset(workspace, "strict-execute-preset")), { recursive: true });
  writeFileSync(
    userPreset(workspace, "strict-execute-preset"),
    [
      "schema_version = 1",
      'workflow = "strict-execute"',
      "",
      "[stage_assignments]",
      'execute = ["worker"]',
      "",
      "[failure_policy.stage_types.execute]",
      'mode = "required"',
      "max_fallback_agents = 2",
      "",
      "[fallback.stage_types.execute]",
      'agents = ["worker", "preset_backup"]',
      "inherit_common = true",
      "max_attempts_per_agent = 2",
      "timeout_seconds = 1300",
      "",
    ].join("\n"),
  );
}

test("bare run resolves preset namespace and writes preset provenance", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfigAndPreset(workspace);

  const run = runCli(workspace, [
    "run",
    "review-duo",
    "--task",
    "Review the current change.",
    "--title",
    "审查当前改动",
    "--run-id",
    "preset-run",
  ]);

  assert.equal(run.status, 0, run.stderr);
  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "preset-run", "status.json"), "utf-8"),
  );
  assert.equal(status.title, "审查当前改动");
  assert.equal(status.preset, "review-duo");
  assert.equal(status.preset_source.source, "user");
  assert.equal(status.workflow, "w-9d94d0db");
  assert.deepEqual(status.stage_nodes.map((node: { id: string }) => node.id), ["review", "decide"]);
  assert.deepEqual(status.stage_assignments, {
    review: ["reviewer"],
    decide: ["current"],
  });
});

test("preset run records current workspace for Studio visibility", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfigAndPreset(workspace);

  const run = runCli(workspace, [
    "run",
    "review-duo",
    "--task",
    "Review the current change.",
    "--run-id",
    "preset-record-workspace",
  ]);

  assert.equal(run.status, 0, run.stderr);
  const entries = listRegisteredWorkspaces({ registryPath: workspaceRegistry(workspace) });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, realpathSync(workspace));
  assert.equal(entries[0].enabled, true);
  assert.match(entries[0].last_recorded_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("preset run default id uses preset timestamp prefix", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfigAndPreset(workspace);

  const run = runCli(workspace, [
    "run",
    "review-duo",
    "--task",
    "Review with generated preset id.",
  ]);

  assert.equal(run.status, 0, run.stderr);
  const match = /^Run: (preset-\d{14})$/m.exec(run.stdout);
  assert.ok(match, run.stdout);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", match[1])), true);
  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", match[1], "status.json"), "utf-8"),
  );
  assert.equal(status.title, `${path.basename(workspace)}-Review with generated preset id.`);
});

test("preset assignments must store agent ids instead of names", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeNameReferencedPreset(workspace);

  const run = runCli(workspace, [
    "run",
    "name-preset",
    "--task",
    "Review the current change.",
    "--run-id",
    "preset-name-rejected",
  ]);

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /stage_assignments\.review references unknown agent: reviewer/);
});

test("preset run rejects inline task and task file together", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfigAndPreset(workspace);
  const taskFile = path.join(workspace, "request.md");
  writeFileSync(taskFile, "Review this request from a file.");

  const run = runCli(workspace, [
    "run",
    "review-duo",
    "--task",
    "Review this inline request.",
    "--task-file",
    taskFile,
    "--run-id",
    "preset-task-conflict",
  ]);

  assert.equal(run.status, 2);
  assert.match(run.stderr, /--task and --task-file are mutually exclusive/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "preset-task-conflict")), false);
  assert.deepEqual(listRegisteredWorkspaces({ registryPath: workspaceRegistry(workspace) }), []);
});

test("preset run does not fail when workspace registry is invalid", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfigAndPreset(workspace);
  const registryPath = workspaceRegistry(workspace);
  mkdirSync(path.dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, "{nope\n");

  const run = runCli(workspace, [
    "run",
    "review-duo",
    "--task",
    "Review despite invalid registry.",
    "--run-id",
    "preset-invalid-registry",
  ]);

  assert.equal(run.status, 0, run.stderr);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "preset-invalid-registry")), true);
  assert.match(run.stdout, /Packet:/);
});

test("preset run does not re-enable a disabled workspace entry", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeConfigAndPreset(workspace);
  const registryPath = workspaceRegistry(workspace);
  const registered = registerWorkspace(workspace, {
    registryPath,
    label: "Hidden Project",
    now: "2026-06-10T13:00:00.000Z",
  });
  disableRegisteredWorkspace(registered.id, {
    registryPath,
    now: "2026-06-10T13:01:00.000Z",
  });

  const run = runCli(workspace, [
    "run",
    "review-duo",
    "--task",
    "Review without re-enabling.",
    "--run-id",
    "preset-disabled-registry",
  ]);

  assert.equal(run.status, 0, run.stderr);
  const [entry] = listRegisteredWorkspaces({ registryPath });
  assert.equal(entry.id, registered.id);
  assert.equal(entry.enabled, false);
  assert.match(entry.last_recorded_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("preset run resolves preset defaults before global defaults", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeDefaultedPreset(workspace);

  const run = runCli(workspace, [
    "run",
    "delivery-defaults",
    "--task",
    "Deliver with mixed defaults.",
    "--run-id",
    "preset-defaults-run",
  ]);

  assert.equal(run.status, 0, run.stderr);
  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "preset-defaults-run", "status.json"), "utf-8"),
  );
  assert.deepEqual(status.stage_assignments, {
    plan: ["planner"],
    execute: ["executor"],
    verify: ["verifier"],
    review: ["reviewer"],
    decide: ["decider"],
  });
  assert.deepEqual(status.assignment_provenance, {
    plan: "global_stage_default",
    execute: "preset_assignment",
    verify: "global_stage_default",
    review: "preset_stage_default",
    decide: "global_stage_default",
  });
});

test("preset run materializes preset policy and fallback before global fallback", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRoutingPreset(workspace);

  const run = runCli(workspace, [
    "run",
    "strict-execute-preset",
    "--task",
    "Execute with preset fallback.",
    "--run-id",
    "preset-routing-run",
  ]);

  assert.equal(run.status, 0, run.stderr);
  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "preset-routing-run", "status.json"), "utf-8"),
  );
  assert.deepEqual(status.stage_failure_policies.execute, {
    mode: "required",
    max_fallback_agents: 2,
  });
  assert.deepEqual(status.stage_fallbacks.execute, {
    agents: [
      { agent: "preset_backup", timeout_seconds: 1300 },
      { agent: "global_backup", timeout_seconds: 1300 },
    ],
    max_attempts_per_agent: 2,
  });
  assert.equal(status.fallback_provenance.execute, "preset_fallback");
  assert.deepEqual(status.stage_invocations.execute, [
    { lane_id: "execute:worker", kind: "primary", agent: "worker", timeout_seconds: 700 },
  ]);
  assert.deepEqual(status.timeout_provenance.execute, {
    "execute:worker": "agent",
    "execute:preset_backup": "preset_fallback",
    "execute:global_backup": "preset_fallback",
  });
});

test("preset run writes complete current packet schema routing materialization", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRoutingPreset(workspace);

  const run = runCli(workspace, [
    "run",
    "strict-execute-preset",
    "--task",
    "Create a fully materialized routing packet.",
    "--run-id",
    "preset-routing-materialized-run",
  ]);

  assert.equal(run.status, 0, run.stderr);
  const runDir = path.join(workspace, ".agentmesh", "runs", "preset-routing-materialized-run");
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  PacketStatusSchema.parse(status);

  const stageIds = ["execute", "review", "decide"];
  assert.deepEqual(status.stage_nodes.map((node: { id: string }) => node.id), stageIds);
  for (const field of [
    "stage_assignments",
    "stage_invocations",
    "stage_failure_policies",
    "stage_fallbacks",
    "stage_attempts",
    "assignment_provenance",
    "fallback_provenance",
    "timeout_provenance",
  ]) {
    assert.deepEqual(Object.keys(status[field]), stageIds, `${field} keys`);
  }

  assert.deepEqual(status.stage_assignments, {
    execute: ["worker"],
    review: ["reviewer"],
    decide: ["decider"],
  });
  assert.deepEqual(status.assignment_provenance, {
    execute: "preset_assignment",
    review: "global_stage_default",
    decide: "global_stage_default",
  });
  assert.deepEqual(status.stage_failure_policies, {
    execute: { mode: "required", max_fallback_agents: 2 },
    review: { mode: "allow", max_fallback_agents: 1 },
    decide: { mode: "allow", max_fallback_agents: 1 },
  });
  assert.deepEqual(status.stage_fallbacks, {
    execute: {
      agents: [
        { agent: "preset_backup", timeout_seconds: 1300 },
        { agent: "global_backup", timeout_seconds: 1300 },
      ],
      max_attempts_per_agent: 2,
    },
    review: {
      agents: [{ agent: "global_backup", timeout_seconds: 1100 }],
      max_attempts_per_agent: 1,
    },
    decide: {
      agents: [{ agent: "global_backup", timeout_seconds: 1100 }],
      max_attempts_per_agent: 1,
    },
  });
  assert.deepEqual(status.fallback_provenance, {
    execute: "preset_fallback",
    review: "global_fallback",
    decide: "global_fallback",
  });
  assert.deepEqual(status.stage_invocations, {
    execute: [
      { lane_id: "execute:worker", kind: "primary", agent: "worker", timeout_seconds: 700 },
    ],
    review: [
      {
        lane_id: "review:reviewer",
        kind: "primary",
        agent: "reviewer",
        timeout_seconds: DEFAULT_INVOCATION_TIMEOUT_SECONDS,
      },
    ],
    decide: [
      {
        lane_id: "decide:decider",
        kind: "primary",
        agent: "decider",
        timeout_seconds: DEFAULT_INVOCATION_TIMEOUT_SECONDS,
      },
    ],
  });
  assert.deepEqual(status.timeout_provenance, {
    execute: {
      "execute:worker": "agent",
      "execute:preset_backup": "preset_fallback",
      "execute:global_backup": "preset_fallback",
    },
    review: {
      "review:reviewer": "system_default",
      "review:global_backup": "global_fallback",
    },
    decide: {
      "decide:decider": "system_default",
      "decide:global_backup": "global_fallback",
    },
  });
  assert.deepEqual(status.stage_attempts, {
    execute: [],
    review: [],
    decide: [],
  });
  assert.deepEqual(status.stage_state, {
    execute: "planned",
    review: "planned",
    decide: "planned",
  });

  const validate = runCli(workspace, ["packet", "validate", runDir, "--json"]);
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(JSON.parse(validate.stdout).ok, true);
});

test("bare run does not resolve workflow ids without an explicit workflow flag", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const run = runCli(workspace, ["run", "w-9d94d0db", "--task", "Review this."]);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /bare run resolves presets only/);
  assert.match(run.stderr, /agentmesh run --workflow w-9d94d0db/);
});
