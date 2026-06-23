import assert from "node:assert/strict";
import { existsSync, realpathSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createFlowRun } from "../packages/runtime/src/flow/index.js";
import {
  readWorkspaceCompatibilityMetadata,
  workspaceCompatibilityDiagnostics,
  writeWorkspaceCompatibilityMetadata,
} from "../packages/runtime/src/packet/compatibility.js";
import { listRegisteredWorkspaces } from "../packages/runtime/src/workspaces/registry.js";
import { makeWorkspace, runCli, workflowHash, writeConfig } from "./helpers/write-side-runtime.js";

function workspaceRegistry(workspace: string): string {
  return path.join(workspace, ".home", ".config", "agentmesh", "workspaces.json");
}

test("workflow run accepts a temporary workflow file with packet provenance", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const workflowPath = path.join(workspace, "one-off-release.toml");
  writeFileSync(
    workflowPath,
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'name = "One Off Release"',
      'stages = ["review", "decide"]',
      'description = "Run one release review and decision."',
      'when_to_use = ["A one-off release needs a custom gate."]',
      'packet_artifacts = ["request.md", "findings.md", "decision.md"]',
      'quality_gates = ["The decider records a release verdict."]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "flow",
    "run",
    "--workflow-file",
    "one-off-release.toml",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "temporary workflow release gate",
    "--run-id",
    "temporary-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "temporary-flow", "status.json"), "utf-8"),
  );
  assert.equal(status.workflow, "one-off-release");
  assert.equal(Object.hasOwn(status, "workflow_status"), false);
  assert.deepEqual(status.stages, ["review", "decide"]);
  assert.deepEqual(status.workflow_source, {
    source: "temporary",
    path: realpathSync(workflowPath),
    hash: workflowHash(workflowPath),
    schema_version: 1,
    workflow_recipe_version: 1,
    compatible_packet_schema_versions: [1],
  });
  const assignment = readFileSync(
    path.join(workspace, ".agentmesh", "runs", "temporary-flow", "assignment.toml"),
    "utf-8",
  );
  assert.doesNotMatch(assignment, /workflow_status/);

  const list = runCli(workspace, ["workflows", "list", "--json"]);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(
    JSON.parse(list.stdout).some((workflow: { workflowId: string }) => workflow.workflowId === "one-off-release"),
    false,
  );
});

test("workflow run writes workspace compatibility metadata", () => {
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
    "compatibility metadata",
    "--run-id",
    "compatibility-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const metadata = readWorkspaceCompatibilityMetadata(workspace);
  assert.equal(metadata.schema_version, 1);
  assert.equal(metadata.packet_schema_version, 1);
  assert.equal(metadata.min_read_runtime_version, "0.1.8");
  assert.equal(metadata.min_write_runtime_version, "0.1.8");
  assert.equal(metadata.last_writer_runtime_version, "0.1.8");
  assert.equal(metadata.last_writer_entrypoint, "cli");
  assert.match(metadata.updated_at, /^\d{4}-\d{2}-\d{2}T/);

  const diagnostics = workspaceCompatibilityDiagnostics(workspace, { entrypoint: "cli" });
  assert.equal(diagnostics.decision, "read_write");
  assert.equal(diagnostics.current_runtime_version, "0.1.8");
  assert.equal(diagnostics.current_entrypoint, "cli");
});

test("workflow run records current workspace for Studio visibility", () => {
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
    "record workspace",
    "--run-id",
    "record-workspace-flow",
  ]);

  assert.equal(run.status, 0, run.stderr);
  const entries = listRegisteredWorkspaces({ registryPath: workspaceRegistry(workspace) });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, realpathSync(workspace));
  assert.equal(entries[0].enabled, true);
  assert.match(entries[0].last_recorded_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("workflow run default id uses workflow timestamp prefix", () => {
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
    "generate workflow id",
  ]);

  assert.equal(run.status, 0, run.stderr);
  const match = /^Run: (workflow-\d{14})$/m.exec(run.stdout);
  assert.ok(match, run.stdout);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", match[1])), true);
});

test("legacy workspace stays readable and first successful mutation backfills compatibility metadata", () => {
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
    "legacy workspace",
    "--run-id",
    "legacy-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);
  rmSync(path.join(workspace, ".agentmesh", "compatibility.json"));

  const readable = runCli(workspace, ["flow", "status", "legacy-flow", "--json"]);
  assert.equal(readable.status, 0, readable.stderr);
  assert.equal(workspaceCompatibilityDiagnostics(workspace).metadata_state, "missing_legacy");

  const failed = runCli(workspace, [
    "flow",
    "attach",
    "legacy-flow",
    "--stage",
    "missing",
    "--text",
    "should not backfill",
  ]);
  assert.equal(failed.status, 1);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "compatibility.json")), false);

  const attached = runCli(workspace, [
    "flow",
    "attach",
    "legacy-flow",
    "--stage",
    "plan",
    "--text",
    "backfill after success",
  ]);
  assert.equal(attached.status, 0, attached.stderr);
  const metadata = readWorkspaceCompatibilityMetadata(workspace);
  assert.equal(metadata.last_writer_entrypoint, "cli");
  assert.equal(metadata.last_writer_runtime_version, "0.1.8");
});

test("workspace compatibility diagnostics refuse unsupported reads and newer write runtimes", () => {
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
    "compatibility gates",
    "--run-id",
    "gated-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  writeWorkspaceCompatibilityMetadata(workspace, {
    schema_version: 1,
    packet_schema_version: 99,
    min_read_runtime_version: "0.1.8",
    min_write_runtime_version: "0.1.8",
    last_writer_runtime_version: "0.1.8",
    last_writer_entrypoint: "desktop",
    updated_at: "2026-05-17T00:00:00.000Z",
  });
  const refused = runCli(workspace, ["flow", "status", "gated-flow", "--json"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /workspace compatibility refused read/);
  assert.equal(workspaceCompatibilityDiagnostics(workspace).decision, "refused");

  writeWorkspaceCompatibilityMetadata(workspace, {
    schema_version: 1,
    packet_schema_version: 1,
    min_read_runtime_version: "0.1.8",
    min_write_runtime_version: "99.0.0",
    last_writer_runtime_version: "99.0.0",
    last_writer_entrypoint: "desktop",
    updated_at: "2026-05-17T00:00:00.000Z",
  });
  const readOnly = workspaceCompatibilityDiagnostics(workspace);
  assert.equal(readOnly.decision, "read_only");
  assert.match(readOnly.reasons.join("\n"), /min_write_runtime_version 99\.0\.0/);

  const cliDiagnostics = runCli(workspace, ["packet", "compatibility", "--json"]);
  assert.equal(cliDiagnostics.status, 0, cliDiagnostics.stderr);
  const cliCompatibility = JSON.parse(cliDiagnostics.stdout);
  assert.equal(cliCompatibility.decision, "read_only");
  assert.equal(cliCompatibility.current_runtime_version, "0.1.8");
  assert.equal(cliCompatibility.current_entrypoint, "cli");
  assert.equal(cliCompatibility.metadata.last_writer_entrypoint, "desktop");

  const attach = runCli(workspace, [
    "flow",
    "attach",
    "gated-flow",
    "--stage",
    "plan",
    "--text",
    "must be refused",
  ]);
  assert.equal(attach.status, 1);
  assert.match(attach.stderr, /workspace compatibility is read-only/);
  assert.equal(readWorkspaceCompatibilityMetadata(workspace).last_writer_entrypoint, "desktop");
});

test("workflow run rejects inline task and task file together", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(path.join(workspace, "task.md"), "task from file\n");

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
    "inline task",
    "--task-file",
    "task.md",
    "--run-id",
    "task-conflict-flow",
  ]);

  assert.equal(run.status, 2);
  assert.match(run.stderr, /--task and --task-file are mutually exclusive/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "task-conflict-flow")), false);
});

test("workflow run creation rejects incompatible workflow versions before writing packets", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      createFlowRun(
        {
          plan: "current",
          execute: null,
          review: [],
          decide: "current",
          stageAssignments: { plan: ["current"], decide: ["current"] },
          task: "future workflow",
          runId: "future-workflow",
          workflow: "future-workflow",
          workflowCompatibility: {
            source: "unit-test",
            schemaVersion: 2,
            workflowRecipeVersion: 1,
            compatiblePacketSchemaVersions: [1],
          },
          stages: ["plan", "decide"],
        },
        workspace,
      ),
    /workflow unit-test schema_version 2 is newer than supported workflow schema_version 1/,
  );
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "future-workflow")), false);

  await assert.rejects(
    () =>
      createFlowRun(
        {
          plan: "current",
          execute: null,
          review: [],
          decide: "current",
          stageAssignments: { plan: ["current"], decide: ["current"] },
          task: "incompatible workflow",
          runId: "incompatible-workflow",
          workflow: "incompatible-workflow",
          workflowCompatibility: {
            source: "unit-test",
            schemaVersion: 1,
            workflowRecipeVersion: 1,
            compatiblePacketSchemaVersions: [99],
          },
          stages: ["plan", "decide"],
        },
        workspace,
      ),
    /workflow unit-test compatible_packet_schema_versions must equal \[1\]/,
  );
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "incompatible-workflow")), false);
});

test("workflow run fills missing role flags from workflow defaults", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.reviewer]",
      'label = "Reviewer"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["review"]',
      "stdin = true",
      "",
      "[agents.backup_reviewer]",
      'label = "Backup Reviewer"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["review"]',
      "stdin = true",
      "",
      "[agents.decider]",
      'label = "Decider"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["decide"]',
      "stdin = true",
      "",
      "[workflow_defaults.w-67ef1b1f]",
      'review = ["reviewer", "backup_reviewer"]',
      'decide = "decider"',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow",
    "w-67ef1b1f",
    "--task",
    "release with defaults",
    "--run-id",
    "defaults-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "defaults-flow", "status.json"), "utf-8"),
  );
  assert.deepEqual(status.stages, ["review", "decide"]);
  assert.deepEqual(status.stage_assignments.review, ["reviewer", "backup_reviewer"]);
  assert.deepEqual(status.stage_assignments.decide, ["decider"]);
});

test("workflow run fills missing role flags from global default stage agents", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.planner]",
      'adapter = "command"',
      'capabilities = ["plan"]',
      "",
      "[agents.executor]",
      'adapter = "command"',
      'capabilities = ["execute"]',
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
      'execute = ["executor"]',
      'review = ["reviewer"]',
      'decide = ["decider"]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow",
    "w-7db15660",
    "--task",
    "use global defaults",
    "--run-id",
    "global-defaults-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "global-defaults-flow", "status.json"), "utf-8"),
  );
  assert.deepEqual(status.stage_assignments, {
    plan: ["planner"],
    execute: ["executor"],
    review: ["reviewer"],
    decide: ["decider"],
  });
  assert.deepEqual(status.assignment_provenance, {
    plan: "global_stage_default",
    execute: "global_stage_default",
    review: "global_stage_default",
    decide: "global_stage_default",
  });
});

test("workflow run expands CLI role flags across repeated stage node ids", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(
    path.join(workspace, "repeated-review.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["review", "decide", "review", "decide"]',
      'description = "Repeated review checkpoints."',
      'when_to_use = ["A repeated review workflow is tested."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Every checkpoint is explicit."]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "flow",
    "run",
    "--workflow-file",
    "repeated-review.toml",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "repeat role flags",
    "--run-id",
    "repeated-role-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "repeated-role-flow", "status.json"), "utf-8"),
  );
  assert.deepEqual(status.stage_assignments, {
    review: ["current"],
    decide: ["current"],
    review_2: ["current"],
    decide_2: ["current"],
  });
  assert.deepEqual(status.assignment_provenance, {
    review: "cli",
    decide: "cli",
    review_2: "cli",
    decide_2: "cli",
  });
});

test("workflow run rejects invalid resolved primary assignments", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.executor]",
      'adapter = "command"',
      'capabilities = ["execute"]',
      "",
      "[agents.other]",
      'adapter = "command"',
      'capabilities = ["plan"]',
      "",
      "[agents.reviewer]",
      'adapter = "command"',
      'capabilities = ["review"]',
      "",
      "[agents.decider]",
      'adapter = "command"',
      'capabilities = ["decide"]',
      "",
      "[default_stage_agents]",
      'agents = ["executor", "other"]',
      "",
      "[default_stage_agents.stage_types]",
      'plan = ["other"]',
      'review = ["reviewer"]',
      'decide = ["decider"]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow",
    "w-7db15660",
    "--task",
    "bad global defaults",
    "--run-id",
    "bad-global-defaults-flow",
  ]);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /stage_assignments\.execute must contain exactly one agent/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "bad-global-defaults-flow")), false);
});

test("workflow run materializes failure policy, global fallback, and timeout provenance", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.verifier]",
      'adapter = "command"',
      'capabilities = ["verify"]',
      "timeout_seconds = 600",
      "",
      "[agents.fallback_verify]",
      'adapter = "command"',
      'capabilities = ["verify"]',
      "",
      "[agents.common_backup]",
      'adapter = "command"',
      'capabilities = ["verify", "decide"]',
      "",
      "[default_stage_agents.stage_types]",
      'verify = ["verifier"]',
      'decide = ["current"]',
      "",
      "[fallback]",
      'agents = ["common_backup"]',
      "max_attempts_per_agent = 1",
      "timeout_seconds = 1000",
      "",
      "[fallback.stage_types.verify]",
      'agents = ["verifier", "fallback_verify"]',
      "inherit_common = true",
      "max_attempts_per_agent = 2",
      "timeout_seconds = 1200",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "verified-checkpoint.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["verify", "decide"]',
      'description = "Verify then decide."',
      'when_to_use = ["A verify checkpoint is tested."]',
      'packet_artifacts = ["verification.md", "decision.md"]',
      'quality_gates = ["Fallback policy is materialized."]',
      "",
      "[failure_policy.stage_types.verify]",
      'mode = "required"',
      "max_fallback_agents = 1",
      "",
      "[failure_policy.nodes.decide]",
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
    "verified-checkpoint.toml",
    "--task",
    "materialize routing",
    "--run-id",
    "routing-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "routing-flow", "status.json"), "utf-8"),
  );
  assert.deepEqual(status.stage_failure_policies, {
    verify: { mode: "required", max_fallback_agents: 1 },
    decide: { mode: "terminal" },
  });
  assert.deepEqual(status.stage_fallbacks, {
    verify: {
      agents: [{ agent: "fallback_verify", timeout_seconds: 1200 }],
      max_attempts_per_agent: 2,
    },
    decide: { agents: [], max_attempts_per_agent: 1 },
  });
  assert.deepEqual(status.fallback_provenance, {
    verify: "global_fallback",
    decide: "none",
  });
  assert.deepEqual(status.stage_invocations, {
    verify: [
      { lane_id: "verify:verifier", kind: "primary", agent: "verifier", timeout_seconds: 600 },
    ],
    decide: [
      { lane_id: "decide:current", kind: "current", agent: "current", timeout_seconds: null },
    ],
  });
  assert.deepEqual(status.timeout_provenance, {
    verify: {
      "verify:verifier": "agent",
      "verify:fallback_verify": "global_fallback",
    },
    decide: {
      "decide:current": "current",
    },
  });
});

test("workflow run materializes CLI timeout override for primary and fallback lanes", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.reviewer]",
      'adapter = "command"',
      'capabilities = ["review"]',
      "timeout_seconds = 600",
      "",
      "[agents.backup_reviewer]",
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
      "[fallback.stage_types.review]",
      'agents = ["backup_reviewer"]',
      "timeout_seconds = 1200",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "required-review.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["review", "decide"]',
      'description = "Review then decide."',
      'when_to_use = ["A required review fallback is tested."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Review fallback is materialized."]',
      "",
      "[failure_policy.stage_types.review]",
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
    "required-review.toml",
    "--timeout-seconds",
    "333",
    "--task",
    "override timeouts",
    "--run-id",
    "cli-timeout-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "cli-timeout-flow", "status.json"), "utf-8"),
  );
  assert.equal(status.stage_invocations.review[0].timeout_seconds, 333);
  assert.deepEqual(status.stage_fallbacks.review, {
    agents: [{ agent: "backup_reviewer", timeout_seconds: 333 }],
    max_attempts_per_agent: 1,
  });
  assert.deepEqual(status.timeout_provenance.review, {
    "review:reviewer": "cli",
    "review:backup_reviewer": "cli",
  });
});

test("workflow run rejects required fallback on pure current nodes", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(
    path.join(workspace, "current-required.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["review", "decide"]',
      'description = "Current required fallback is invalid."',
      'when_to_use = ["A current fallback policy is tested."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Current fallback is rejected."]',
      "",
      "[failure_policy.nodes.decide]",
      'mode = "required"',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "flow",
    "run",
    "--workflow-file",
    "current-required.toml",
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "reject current required",
    "--run-id",
    "current-required-flow",
  ]);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /stage_failure_policies\.decide requires fallback agents but decide is assigned to current/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "current-required-flow")), false);
});

test("workflow run resolves review policy profiles into reviewer assignments", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.security_reviewer]",
      'label = "Security Reviewer"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["review", "reviewer.security"]',
      "stdin = true",
      "",
      "[agents.decider]",
      'label = "Decider"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["decide"]',
      "stdin = true",
      "",
      "[review_policy.w-67ef1b1f]",
      'required_review_profiles = ["reviewer.security"]',
      "",
      "[release_policy.w-67ef1b1f]",
      'required_evidence = ["tests", "diff-check"]',
      'needs_decision_risks = ["security"]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow",
    "w-67ef1b1f",
    "--decide",
    "decider",
    "--task",
    "release with policy reviewer",
    "--run-id",
    "policy-review-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "policy-review-flow");
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.stage_assignments.review, ["security_reviewer"]);
  assert.deepEqual(status.resolved_review_release_policy.required_review_profiles, [
    "reviewer.security",
  ]);
  assert.deepEqual(status.resolved_review_release_policy.resolved_reviewers, [
    { profile: "reviewer.security", agent_ids: ["security_reviewer"] },
  ]);
  assert.deepEqual(status.resolved_review_release_policy.required_evidence, [
    "tests",
    "diff-check",
  ]);
  assert.deepEqual(status.resolved_review_release_policy.needs_decision_risks, ["security"]);
  assert.equal(status.resolved_review_release_policy.source_layers[0].source, "explicit");
});

test("workflow run resolves declared capability profile preferences", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.fast_reviewer]",
      'label = "Fast Reviewer"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["review", "long_context"]',
      "stdin = true",
      "",
      "[agents.deep_reviewer]",
      'label = "Deep Reviewer"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["review", "long_context"]',
      "stdin = true",
      "",
      "[agents.decider]",
      'label = "Decider"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["decide"]',
      "stdin = true",
      "",
      "[capability_profiles.\"reviewer.long_context\"]",
      'stage = "review"',
      'required_capabilities = ["review", "long_context"]',
      "min_count = 1",
      "",
      "[capability_profile_preferences.\"reviewer.long_context\"]",
      'agents = ["deep_reviewer"]',
      "",
      "[review_policy.w-67ef1b1f]",
      'required_review_profiles = ["reviewer.long_context"]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow",
    "w-67ef1b1f",
    "--decide",
    "decider",
    "--task",
    "release with profile preference",
    "--run-id",
    "profile-preference-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "profile-preference-flow", "status.json"), "utf-8"),
  );
  assert.deepEqual(status.stage_assignments.review, ["deep_reviewer"]);
  assert.deepEqual(status.resolved_review_release_policy.resolved_reviewers, [
    { profile: "reviewer.long_context", agent_ids: ["deep_reviewer"] },
  ]);
});

test("workflow run warns when a declared capability profile auto-selects the only match", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.deep_reviewer]",
      'label = "Deep Reviewer"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["review", "long_context"]',
      "stdin = true",
      "",
      "[agents.decider]",
      'label = "Decider"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["decide"]',
      "stdin = true",
      "",
      "[capability_profiles.\"reviewer.long_context\"]",
      'stage = "review"',
      'required_capabilities = ["review", "long_context"]',
      "min_count = 1",
      "",
      "[review_policy.w-67ef1b1f]",
      'required_review_profiles = ["reviewer.long_context"]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow",
    "w-67ef1b1f",
    "--decide",
    "decider",
    "--task",
    "release with single profile match",
    "--run-id",
    "profile-single-match-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "profile-single-match-flow", "status.json"), "utf-8"),
  );
  assert.deepEqual(status.stage_assignments.review, ["deep_reviewer"]);
  assert.deepEqual(status.resolved_review_release_policy.profile_resolution_warnings, [
    "capability_profiles.reviewer.long_context has no preference; auto-selected matching agents: deep_reviewer",
  ]);
});

test("workflow run fails fast when a declared capability profile has no matching agents", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.decider]",
      'label = "Decider"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["decide"]',
      "stdin = true",
      "",
      "[capability_profiles.\"reviewer.long_context\"]",
      'stage = "review"',
      'required_capabilities = ["review", "long_context"]',
      "min_count = 1",
      "",
      "[review_policy.w-67ef1b1f]",
      'required_review_profiles = ["reviewer.long_context"]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow",
    "w-67ef1b1f",
    "--decide",
    "decider",
    "--task",
    "release with missing declared profile",
    "--run-id",
    "profile-no-match-flow",
  ]);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /capability_profiles\.reviewer\.long_context has 0 matching agent\(s\), but min_count is 1/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "profile-no-match-flow")), false);
});

test("workflow run fails fast when review policy profiles cannot be resolved", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.decider]",
      'label = "Decider"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["decide"]',
      "stdin = true",
      "",
      "[review_policy.w-67ef1b1f]",
      'required_review_profiles = ["reviewer.security"]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow",
    "w-67ef1b1f",
    "--decide",
    "decider",
    "--task",
    "release with missing policy reviewer",
    "--run-id",
    "missing-policy-review-flow",
  ]);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /review_policy\.w-67ef1b1f required profile has no matching reviewer agent: reviewer\.security/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "missing-policy-review-flow")), false);
});

test("workflow run records resolved execution policy and config provenance", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[run_defaults]",
      "adapter_timeout_secs = 20",
      "retry_attempts = 2",
      "",
      "[execution_policy]",
      "max_adapter_timeout_secs = 10",
      "max_retry_attempts = 1",
      "require_user_gate = true",
      "allow_auto_dispatch = true",
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
    "current",
    "--decide",
    "current",
    "--task",
    "execution policy packet",
    "--run-id",
    "execution-policy-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "execution-policy-flow", "status.json"), "utf-8"),
  );
  assert.equal(status.user_gate, true);
  assert.equal(status.resolved_execution_policy.adapter_timeout_secs, 10);
  assert.equal(status.resolved_execution_policy.retry_attempts, 1);
  assert.equal(status.resolved_execution_policy.max_adapter_timeout_secs, 10);
  assert.equal(status.resolved_execution_policy.max_retry_attempts, 1);
  assert.equal(status.resolved_execution_policy.require_user_gate, true);
  assert.equal(status.resolved_execution_policy.allow_auto_dispatch, true);
  assert.equal(status.resolved_execution_policy.source_layers[0].source, "explicit");
  assert.equal(status.config_provenance.schema_version, 1);
  assert.match(status.config_provenance.layers[0].sha256, /^sha256:[a-f0-9]{64}$/);
});

test("workflow run writes resolved multi-agent stage assignments", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.planner_a]",
      'label = "Planner A"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["plan"]',
      "stdin = true",
      "",
      "[agents.planner_b]",
      'label = "Planner B"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["plan"]',
      "stdin = true",
      "",
      "[agents.worker]",
      'label = "Worker"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["execute"]',
      "stdin = true",
      "",
      "[agents.reviewer]",
      'label = "Reviewer"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["review"]',
      "stdin = true",
      "",
      "[agents.decider_a]",
      'label = "Decider A"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["decide"]',
      "stdin = true",
      "",
      "[agents.decider_b]",
      'label = "Decider B"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["decide"]',
      "stdin = true",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "multi.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["plan", "execute", "review", "decide"]',
      'description = "Exercise multi-agent assignment shape."',
      'when_to_use = ["A packet needs resolved multi-agent assignments."]',
      'packet_artifacts = ["request.md", "assignment.toml", "plan.md", "handoff.md", "findings.md", "decision.md"]',
      'quality_gates = ["Assignments are recorded before dispatch."]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow-file",
    "multi.toml",
    "--plan",
    "planner_a",
    "--plan",
    "planner_b",
    "--execute",
    "worker",
    "--review",
    "reviewer",
    "--decide",
    "decider_a",
    "--decide",
    "decider_b",
    "--task",
    "multi assignment packet",
    "--run-id",
    "multi-assignment-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "multi-assignment-flow");
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.equal(status.plan, undefined);
  assert.equal(status.execute, undefined);
  assert.equal(status.review, undefined);
  assert.equal(status.decide, undefined);
  assert.deepEqual(status.stage_assignments, {
    plan: ["planner_a", "planner_b"],
    execute: ["worker"],
    review: ["reviewer"],
    decide: ["decider_a", "decider_b"],
  });

  const assignment = readFileSync(path.join(runDir, "assignment.toml"), "utf-8");
  assert.match(assignment, /\[stage_assignments\]/);
  assert.match(assignment, /plan = \["planner_a", "planner_b"\]/);
  assert.match(assignment, /decide = \["decider_a", "decider_b"\]/);
});

test("workflow run records repeated stage nodes and node-id assignments", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.planner]",
      'label = "Planner"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["plan"]',
      "stdin = true",
      "",
      "[agents.worker]",
      'label = "Worker"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["execute"]',
      "stdin = true",
      "",
      "[agents.reviewer]",
      'label = "Reviewer"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["review"]',
      "stdin = true",
      "",
      "[agents.decider]",
      'label = "Decider"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["decide"]',
      "stdin = true",
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
      'description = "Exercise repeated workflow nodes."',
      'when_to_use = ["A delivery needs two execution and review rounds."]',
      'packet_artifacts = ["request.md", "assignment.toml", "plan.md", "handoff.md", "findings.md", "handoff_2.md", "findings_2.md", "decision.md"]',
      'quality_gates = ["Assignments are recorded per node id."]',
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
    "planner",
    "--execute",
    "worker",
    "--review",
    "reviewer",
    "--decide",
    "decider",
    "--task",
    "repeated assignment packet",
    "--run-id",
    "repeated-assignment-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "repeated-assignment-flow");
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.stages, [
    "plan",
    "execute",
    "review",
    "execute",
    "review",
    "decide",
  ]);
  assert.deepEqual(status.stage_nodes, [
    { id: "plan", type: "plan", occurrence: 1 },
    { id: "execute", type: "execute", occurrence: 1 },
    { id: "review", type: "review", occurrence: 1 },
    { id: "execute_2", type: "execute", occurrence: 2 },
    { id: "review_2", type: "review", occurrence: 2 },
    { id: "decide", type: "decide", occurrence: 1 },
  ]);
  assert.deepEqual(status.stage_assignments, {
    plan: ["planner"],
    execute: ["worker"],
    review: ["reviewer"],
    execute_2: ["worker"],
    review_2: ["reviewer"],
    decide: ["decider"],
  });
  assert.deepEqual(status.stage_state, {
    plan: "planned",
    execute: "planned",
    review: "planned",
    execute_2: "planned",
    review_2: "planned",
    decide: "planned",
  });

  const assignment = readFileSync(path.join(runDir, "assignment.toml"), "utf-8");
  assert.match(assignment, /\[\[stage_nodes\]\]\nid = "execute_2"\ntype = "execute"\noccurrence = 2/);
  assert.match(assignment, /\[stage_assignments\]\nplan = \["planner"\]/);
  assert.match(assignment, /execute_2 = \["worker"\]/);
  assert.match(assignment, /review_2 = \["reviewer"\]/);
});

test("workflow run accepts verify stage assignments without legacy verify status field", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.verifier]",
      'label = "Verifier"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["verify"]',
      "stdin = true",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "verify-flow.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'name = "Verify Flow"',
      'stages = ["plan", "execute", "verify", "review", "decide"]',
      'description = "Exercise verify runtime stage."',
      'when_to_use = ["A workflow needs explicit verification before review."]',
      'packet_artifacts = ["request.md", "plan.md", "handoff.md", "verification.md", "findings.md", "decision.md"]',
      'quality_gates = ["Verification evidence is recorded before review."]',
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
    "--review",
    "current",
    "--decide",
    "current",
    "--task",
    "temporary verify workflow",
    "--run-id",
    "verify-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const runDir = path.join(workspace, ".agentmesh", "runs", "verify-flow");
  const status = JSON.parse(readFileSync(path.join(runDir, "status.json"), "utf-8"));
  assert.deepEqual(status.stages, ["plan", "execute", "verify", "review", "decide"]);
  assert.deepEqual(status.stage_nodes, [
    { id: "plan", type: "plan", occurrence: 1 },
    { id: "execute", type: "execute", occurrence: 1 },
    { id: "verify", type: "verify", occurrence: 1 },
    { id: "review", type: "review", occurrence: 1 },
    { id: "decide", type: "decide", occurrence: 1 },
  ]);
  assert.deepEqual(status.stage_assignments, {
    plan: ["current"],
    execute: ["current"],
    verify: ["verifier"],
    review: ["current"],
    decide: ["current"],
  });
  assert.equal(Object.hasOwn(status, "verify"), false);

  const assignment = readFileSync(path.join(runDir, "assignment.toml"), "utf-8");
  assert.match(assignment, /\[\[stage_nodes\]\]\nid = "verify"\ntype = "verify"\noccurrence = 1/);
  assert.match(assignment, /verify = \["verifier"\]/);
});

test("workflow defaults support multi-agent non-review stages", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.planner_a]",
      'label = "Planner A"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["plan"]',
      "stdin = true",
      "",
      "[agents.planner_b]",
      'label = "Planner B"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["plan"]',
      "stdin = true",
      "",
      "[agents.decider]",
      'label = "Decider"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["decide"]',
      "stdin = true",
      "",
      "[workflow_defaults.w-4963ede2]",
      'plan = ["planner_a", "planner_b"]',
      'decide = "decider"',
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
    "--task",
    "defaulted multi assignment",
    "--run-id",
    "default-multi-flow",
  ]);
  assert.equal(run.status, 0, run.stderr);

  const status = JSON.parse(
    readFileSync(path.join(workspace, ".agentmesh", "runs", "default-multi-flow", "status.json"), "utf-8"),
  );
  assert.equal(status.plan, undefined);
  assert.deepEqual(status.stage_assignments.plan, ["planner_a", "planner_b"]);
  assert.deepEqual(status.stage_assignments.decide, ["decider"]);
});

test("workflow file is mutually exclusive with registry workflow id", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(
    path.join(workspace, "custom.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["plan"]',
      'description = "Custom plan."',
      'when_to_use = ["A custom plan is needed."]',
      'packet_artifacts = ["plan.md"]',
      'quality_gates = ["Plan is recorded."]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "flow",
    "run",
    "--workflow",
    "w-4963ede2",
    "--workflow-file",
    "custom.toml",
    "--plan",
    "current",
    "--decide",
    "current",
    "--task",
    "bad selector",
  ]);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--workflow and --workflow-file are mutually exclusive/);
});

test("temporary workflow run rejects unknown assigned agents before packet creation", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const config = writeConfig(
    workspace,
    [
      "[agents.known]",
      'label = "Known"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      "args = []",
      'capabilities = ["review", "decide"]',
      "stdin = true",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "custom.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["review", "decide"]',
      'description = "Custom review."',
      'when_to_use = ["A custom review is needed."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Decision is recorded."]',
      "",
    ].join("\n"),
  );

  const run = runCli(workspace, [
    "--config",
    config,
    "flow",
    "run",
    "--workflow-file",
    "custom.toml",
    "--review",
    "missing",
    "--decide",
    "known",
    "--task",
    "bad temporary workflow assignment",
    "--run-id",
    "bad-temporary-flow",
  ]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /unknown agent: missing/);
  assert.equal(existsSync(path.join(workspace, ".agentmesh", "runs", "bad-temporary-flow")), false);
});
