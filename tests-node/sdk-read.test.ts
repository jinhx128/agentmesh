import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getRun,
  getWorkflow,
  listAgents,
  listArtifacts,
  listRunEvents,
  listRuns,
  listWorkflows,
} from "../packages/sdk/src/index.js";
import { currentPacketStatus } from "./helpers/current-packet-status.js";

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-sdk-read-"));
}

function isolateHome(workspace: string): () => void {
  const previousHome = process.env.HOME;
  process.env.HOME = path.join(workspace, ".home");
  return () => {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  };
}

function writeConfig(workspace: string): void {
  const configPath = path.join(workspace, ".home", ".config", "agentmesh", "config.toml");
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.sdk-agent]",
      'label = "SDK Agent"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      'model = "gpt-5.5"',
      'reasoning_effort = "high"',
      'capabilities = ["plan", "execute", "decide"]',
      "",
    ].join("\n"),
  );
}

function writeWorkflow(workspace: string): void {
  const workflowDir = path.join(workspace, ".home", ".config", "agentmesh", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    path.join(workflowDir, "sdk-workflow.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'name = "SDK Workflow"',
      'stages = ["plan", "execute", "decide"]',
      'description = "Exercise the public read SDK."',
      'when_to_use = ["A tool needs stable AgentMesh read APIs."]',
      'packet_artifacts = ["request.md", "plan.md", "handoff.md", "decision.md"]',
      'quality_gates = ["The SDK exposes stable read shapes."]',
      "",
    ].join("\n"),
  );
}

function writeRun(
  workspace: string,
  runId: string,
  updatedAt: string,
  events: Array<Record<string, unknown>>,
  statusOverrides: Record<string, unknown> = {},
): void {
  const runDir = path.join(workspace, ".agentmesh", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, "status.json"),
    `${JSON.stringify(
      currentPacketStatus({
        run_id: runId,
        created_at: "2026-05-16T00:00:00.000Z",
        updated_at: updatedAt,
        status: "running",
        workflow: "sdk-workflow",
        stages: ["plan", "execute", "decide"],
        completed_stages: ["plan"],
        stage_timing: {
          plan: {
            started_at: "2026-05-16T00:00:00.000Z",
            completed_at: "2026-05-16T00:00:01.000Z",
            duration_ms: 1000,
            attempt_count: 1,
          },
          execute: { attempt_count: 1 },
          decide: { attempt_count: 0 },
        },
        ...statusOverrides,
      }),
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(runDir, "events.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  writeFileSync(path.join(runDir, "plan.md"), `# Plan\n\n${runId}\n`);
  writeFileSync(
    path.join(runDir, "artifacts.toml"),
    [
      "schema_version = 1",
      "",
      "[artifacts.plan]",
      'path = "plan.md"',
      'kind = "markdown"',
      'stage = "plan"',
      'agent = "sdk-agent"',
      "",
    ].join("\n"),
  );
}

test("read SDK exposes stable workflows and agents without packet layout details", () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  writeConfig(workspace);
  writeWorkflow(workspace);
  writeRun(workspace, "older-run", "2026-05-16T00:00:01.000Z", [
    { schema_version: 1, timestamp: "2026-05-16T00:00:01.000Z", event: "run.created" },
  ]);
  writeRun(workspace, "newer-run", "2026-05-16T00:00:03.000Z", [
    { schema_version: 1, timestamp: "2026-05-16T00:00:02.000Z", event: "run.created" },
    { schema_version: 1, timestamp: "2026-05-16T00:00:03.000Z", event: "stage.started", stage: "execute" },
  ]);

  const agents = listAgents({ cwd: workspace });
  assert.deepEqual(agents.map((agent) => agent.id), ["sdk-agent"]);
  assert.equal(agents[0].adapter, "command");
  assert.equal(agents[0].model, "gpt-5.5");
  assert.equal(agents[0].verification_status, "configured");
  assert.equal(agents[0].source_layer, "user");
  assert.match(agents[0].source_path ?? "", /\.config\/agentmesh\/config\.toml$/);

  const workflow = listWorkflows({ cwd: workspace }).find(
    (item) => item.workflowId === "sdk-workflow",
  );
  assert.equal(workflow?.name, "SDK Workflow");
  assert.equal(workflow?.latest_run?.run_id, "newer-run");
  assert.equal(typeof workflow?.updated_at, "string");

  const workflowDetail = getWorkflow("sdk-workflow", { cwd: workspace });
  assert.deepEqual(workflowDetail.stages, ["plan", "execute", "decide"]);
  assert.deepEqual(workflowDetail.agents.map((agent) => agent.id), ["sdk-agent"]);
});

test("read SDK rejects the removed workflow maturity field", () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  const workflowDir = path.join(workspace, ".home", ".config", "agentmesh", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    path.join(workflowDir, "legacy-status.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'status = "mvp"',
      'stages = ["review", "decide"]',
      'description = "Legacy maturity field."',
      'when_to_use = ["A workflow still contains the removed maturity field."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Removed fields are rejected."]',
      "",
    ].join("\n"),
  );

  assert.throws(
    () => listWorkflows({ cwd: workspace }),
    /unknown top-level field: status/,
  );
});

test("read SDK list views skip unsupported future packet runs", () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  writeConfig(workspace);
  writeWorkflow(workspace);
  writeRun(
    workspace,
    "future-run",
    "2026-05-16T00:00:05.000Z",
    [
      { schema_version: 1, timestamp: "2026-05-16T00:00:05.000Z", event: "run.created" },
    ],
    { schema_version: 2 },
  );
  writeRun(workspace, "current-run", "2026-05-16T00:00:04.000Z", [
    { schema_version: 1, timestamp: "2026-05-16T00:00:04.000Z", event: "run.created" },
  ], { title: "读取当前运行" });
  writeRun(workspace, "legacy-run", "2026-05-16T00:00:03.000Z", [
    { schema_version: 1, timestamp: "2026-05-16T00:00:03.000Z", event: "run.created" },
  ]);

  const listedRuns = listRuns({ cwd: workspace }).runs;
  const currentRun = listedRuns[0];
  assert.equal(currentRun.run_id, "current-run");
  assert.equal(currentRun.title, "读取当前运行");
  assert.equal(getRun("current-run", { cwd: workspace }).summary.title, "读取当前运行");
  const legacyRun = listedRuns.find((run) => run.run_id === "legacy-run");
  assert.equal(Object.hasOwn(legacyRun ?? {}, "title"), false);
  assert.equal(Object.hasOwn(getRun("legacy-run", { cwd: workspace }).summary, "title"), false);
  const workflow = listWorkflows({ cwd: workspace }).find(
    (item) => item.workflowId === "sdk-workflow",
  );
  assert.equal(workflow?.latest_run?.run_id, "current-run");
  assert.throws(
    () => getRun("future-run", { cwd: workspace }),
    /unsupported packet schema version: 2/,
  );
});

test("read SDK exposes current packet schema stage node assignments and execution facts", () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  writeConfig(workspace);
  writeRun(
    workspace,
    "current-run",
    "2026-05-16T00:00:06.000Z",
    [
      { schema_version: 1, timestamp: "2026-05-16T00:00:01.000Z", event: "stage.completed", stage: "review" },
    ],
    {
      workflow: "checkpoint-flow",
      stages: ["plan", "decide", "execute", "verify", "review", "decide"],
      completed_stages: ["plan", "decide", "execute", "verify", "review"],
      stage_assignments: {
        plan: ["planner"],
        decide: ["architect"],
        execute: ["worker"],
        verify: ["verifier"],
        review: ["reviewer"],
        decide_2: ["release-decider"],
      },
      stage_failure_policies: {
        plan: { mode: "allow", max_fallback_agents: 1 },
        decide: { mode: "allow", max_fallback_agents: 1 },
        execute: { mode: "required", max_fallback_agents: 2 },
        verify: { mode: "required", max_fallback_agents: 2 },
        review: { mode: "required", max_fallback_agents: 1 },
        decide_2: { mode: "terminal" },
      },
      stage_fallbacks: {
        plan: { agents: [], max_attempts_per_agent: 1 },
        decide: { agents: [], max_attempts_per_agent: 1 },
        execute: {
          agents: [{ agent: "backup-worker", timeout_seconds: 900 }],
          max_attempts_per_agent: 1,
        },
        verify: {
          agents: [{ agent: "backup-verifier", timeout_seconds: 900 }],
          max_attempts_per_agent: 1,
        },
        review: {
          agents: [{ agent: "fallback-reviewer", timeout_seconds: 900 }],
          max_attempts_per_agent: 2,
        },
        decide_2: { agents: [], max_attempts_per_agent: 1 },
      },
      stage_attempts: {
        plan: [],
        decide: [],
        execute: [],
        verify: [],
        review: [{
          lane_id: "review:reviewer",
          primary_agent: "reviewer",
          requested_agent: "fallback-reviewer",
          actual_agent: "fallback-reviewer",
          fallback_from: "reviewer",
          lane_attempt: 1,
          attempt: 1,
          timeout_seconds: 900,
          status: "failed",
          error: "review failed",
        }],
        decide_2: [],
      },
      assignment_provenance: {
        plan: "preset",
        decide: "preset",
        execute: "preset",
        verify: "default_stage_agents.stage_types.verify",
        review: "default_stage_agents.stage_types.review",
        decide_2: "preset",
      },
      fallback_provenance: {
        plan: "none",
        decide: "none",
        execute: "preset_fallback",
        verify: "preset_fallback",
        review: "workflow_failure_policy",
        decide_2: "none",
      },
      timeout_provenance: {
        plan: { current: "none" },
        decide: { architect: "preset_timeout" },
        execute: { worker: "preset_timeout" },
        verify: { verifier: "workflow_timeout" },
        review: { reviewer: "workflow_timeout" },
        decide_2: { "release-decider": "preset_timeout" },
      },
      stage_timing: {
        plan: { attempt_count: 1 },
        decide: { attempt_count: 1 },
        execute: { attempt_count: 1 },
        verify: { attempt_count: 1 },
        review: { attempt_count: 1 },
        decide_2: { attempt_count: 0 },
      },
    },
  );

  const detail = getRun("current-run", { cwd: workspace });

  assert.deepEqual(detail.summary.stage_nodes?.map((node) => node.id), [
    "plan",
    "decide",
    "execute",
    "verify",
    "review",
    "decide_2",
  ]);
  assert.deepEqual(detail.summary.stage_nodes?.map((node) => node.type), [
    "plan",
    "decide",
    "execute",
    "verify",
    "review",
    "decide",
  ]);
  assert.equal(detail.summary.current_stage, "decide_2");
  assert.deepEqual(detail.summary.stage_timing.map((timing) => timing.stage), [
    "plan",
    "decide",
    "execute",
    "verify",
    "review",
    "decide_2",
  ]);
  assert.deepEqual(detail.summary.stage_assignments?.decide_2, ["release-decider"]);
  assert.equal(detail.summary.stage_invocations?.decide_2?.[0]?.kind, "primary");
  assert.deepEqual(detail.summary.stage_failure_policies?.decide_2, { mode: "terminal" });
  assert.deepEqual(detail.summary.stage_fallbacks?.review, {
    agents: [{ agent: "fallback-reviewer", timeout_seconds: 900 }],
    max_attempts_per_agent: 2,
  });
  assert.equal(detail.summary.stage_attempts?.review?.[0]?.status, "failed");
  assert.equal(detail.summary.assignment_provenance?.decide_2, "preset");
  assert.equal(detail.summary.fallback_provenance?.review, "workflow_failure_policy");
  assert.deepEqual(detail.summary.timeout_provenance?.decide_2, {
    "release-decider": "preset_timeout",
  });
});

test("read SDK projects only safe reviewer session summaries for a run", () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  writeConfig(workspace);
  writeRun(
    workspace,
    "session-run",
    "2026-05-16T00:00:06.000Z",
    [{ schema_version: 1, timestamp: "2026-05-16T00:00:06.000Z", event: "reviewer_session.resumed" }],
    {
      stages: ["review", "decide"],
      completed_stages: ["review"],
      stage_attempts: {
        review: [{
          lane_id: "review:a-reviewer",
          primary_agent: "a-reviewer",
          requested_agent: "a-reviewer",
          actual_agent: "a-reviewer",
          lane_attempt: 1,
          attempt: 1,
          timeout_seconds: 240,
          status: "completed",
          session_mode: "resumed",
          session_ref: "rs-0123456789abcdef",
          hermetic: false,
          non_hermetic_reason: "session_resume",
          registry_write: true,
        }],
      },
    },
  );

  const detail = getRun("session-run", {
    cwd: workspace,
    reviewerSessions: [{
      session_ref: "rs-0123456789abcdef",
      host_kind: "claude-code",
      agent_id: "a-reviewer",
      mode: "interactive_continuous",
      last_used_at: "2026-05-16T00:00:05.000Z",
      expires_at: "2026-05-16T02:00:00.000Z",
      provider_session_id: "provider-session-must-not-project",
    } as unknown as {
      session_ref: string;
      host_kind: string;
      agent_id: string;
      mode: string;
      last_used_at: string;
      expires_at: string;
    }],
  });

  assert.deepEqual(detail.summary.reviewer_sessions, [{
    session_ref: "rs-0123456789abcdef",
    host_kind: "claude-code",
    agent_id: "a-reviewer",
    mode: "interactive_continuous",
    last_used_at: "2026-05-16T00:00:05.000Z",
    expires_at: "2026-05-16T02:00:00.000Z",
    hermetic: false,
  }]);
  assert.deepEqual(Object.keys(detail.summary.reviewer_sessions?.[0] ?? {}).sort(), [
    "agent_id",
    "expires_at",
    "hermetic",
    "host_kind",
    "last_used_at",
    "mode",
    "session_ref",
  ]);
  assert.doesNotMatch(
    JSON.stringify(detail.summary.reviewer_sessions),
    /provider-session-must-not-project|provider_session_id|native|registry_key/i,
  );
});

test("read SDK paginates runs and events while keeping artifact content out of indexes", () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  writeConfig(workspace);
  writeWorkflow(workspace);
  writeRun(
    workspace,
    "paged-run",
    "2026-05-16T00:00:05.000Z",
    Array.from({ length: 5 }, (_, index) => ({
      schema_version: 1,
      timestamp: `2026-05-16T00:00:0${index + 1}.000Z`,
      event: `event-${index + 1}`,
    })),
  );

  const runs = listRuns({ cwd: workspace, page: 1, pageSize: 1 });
  assert.equal(runs.total, 1);
  assert.equal(runs.page, 1);
  assert.equal(runs.page_size, 1);
  assert.deepEqual(runs.runs.map((run) => run.run_id), ["paged-run"]);
  assert.equal(runs.runs[0].current_stage, "execute");
  assert.equal(runs.runs[0].latest_event, "event-5");

  const detail = getRun("paged-run", { cwd: workspace, eventTail: 2 });
  assert.equal(detail.summary.run_id, "paged-run");
  assert.deepEqual(detail.events.map((event) => event.event), ["event-4", "event-5"]);
  assert.deepEqual(detail.events_page, { offset: 3, limit: 2, total: 5 });

  const eventPage = listRunEvents("paged-run", { cwd: workspace, page: 2, pageSize: 2 });
  assert.deepEqual(eventPage.events.map((event) => event.event), ["event-3", "event-4"]);
  assert.equal(eventPage.total, 5);

  const artifacts = listArtifacts("paged-run", { cwd: workspace });
  assert.deepEqual(artifacts, [
    {
      name: "plan",
      path: "plan.md",
      kind: "markdown",
      stage: "plan",
      agent: "sdk-agent",
    },
  ]);
  assert.equal(Object.hasOwn(artifacts[0], "content"), false);
});
