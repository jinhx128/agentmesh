import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendCallAdoptionEvent,
  CALLS_RELATIVE_DIR,
  completeCallRecord,
  createCallRecord,
  type DirectCallRecord,
  readCallRecord,
} from "../packages/runtime/src/calls/history.js";
import { registerWorkspace } from "../packages/runtime/src/workspaces/registry.js";
import {
  listStudioRuns,
  readStudioArtifactPreview,
  readStudioRun,
} from "../packages/app-server/src/packet-browser.js";
import { writeWorkspaceCompatibilityMetadata } from "../packages/runtime/src/packet/compatibility.js";
import { readStudioCatalog } from "../packages/app-server/src/catalog.js";
import {
  bootstrapStudio,
} from "../apps/studio-web/src/api/bootstrap.js";
import {
  createStudioApiClient,
  StudioApiError,
} from "../apps/studio-web/src/api/client.js";
import {
  runStudioMutation,
  studioMutationCommand,
} from "../packages/app-server/src/mutations.js";
import { createStudioServer } from "../packages/app-server/src/server.js";
import { studioPresetLifecycleCommand } from "../packages/app-server/src/preset-lifecycle.js";
import { studioWorkflowLifecycleCommand } from "../packages/app-server/src/workflow-lifecycle.js";
import { currentPacketStatus } from "./helpers/current-packet-status.js";

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-studio-"));
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

function writeFakeProviderCli(binDir: string, command: string, output: string): string {
  mkdirSync(binDir, { recursive: true });
  const filePath = path.join(binDir, command);
  writeFileSync(filePath, [
    "#!/bin/sh",
    `if [ "$1" = "models" ]; then printf '%s\\n' ${JSON.stringify(output)}; exit 0; fi`,
    "exit 0",
    "",
  ].join("\n"));
  chmodSync(filePath, 0o755);
  return filePath;
}

function writeRun(
  workspace: string,
  runId: string,
  status: Record<string, unknown>,
  events: Array<Record<string, unknown>>,
): string {
  const runDir = path.join(workspace, ".agentmesh", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, "status.json"),
    JSON.stringify(
      currentPacketStatus({
        run_id: runId,
        created_at: "2026-05-14T00:00:00.000Z",
        updated_at: "2026-05-14T00:00:01.000Z",
        status: "created",
        workflow: "w-4963ede2",
        stages: ["plan", "decide"],
        completed_stages: [],
        stage_timing: {
          plan: {
            started_at: "2026-05-14T00:00:00.000Z",
            completed_at: "2026-05-14T00:00:01.000Z",
            duration_ms: 1000,
            attempt_count: 1,
          },
          decide: { attempt_count: 0 },
        },
        agent_timing: {},
        user_gate: false,
        ...status,
      }),
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    path.join(runDir, "events.jsonl"),
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
  );
  writeFileSync(path.join(runDir, "request.md"), `# Request\n\n${runId}\n`);
  writeFileSync(path.join(runDir, "plan.md"), `# Plan\n\n${runId} plan\n`);
  writeFileSync(
    path.join(runDir, "artifacts.toml"),
    [
      "schema_version = 1",
      "",
      "[artifacts.request]",
      'path = "request.md"',
      'kind = "request"',
      'stage = "run"',
      "",
      "[artifacts.plan]",
      'path = "plan.md"',
      'kind = "markdown"',
      'stage = "plan"',
      "",
    ].join("\n"),
  );
  return runDir;
}

function writeConfig(workspace: string): string {
  const configPath = path.join(workspace, "agentmesh.toml");
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.studio-agent]",
      'label = "Studio Agent"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      'model = "gpt-5.5"',
      'capabilities = ["plan", "execute", "review", "decide"]',
      "",
      "[mcp_servers.docs]",
      'command = "docs-mcp"',
      'args = ["--stdio"]',
      'resource_hints = ["memory://configured"]',
      "",
    ].join("\n"),
  );
  return configPath;
}

function writeUserWorkflow(workspace: string): string {
  const workflowDir = path.join(workspace, ".home", ".config", "agentmesh", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  const workflowPath = path.join(workflowDir, "studio-visible-workflow.toml");
  writeFileSync(
    workflowPath,
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'name = "Studio Visible Workflow"',
      'stages = ["plan", "execute", "verify", "review", "decide"]',
      'description = "Plan, execute, verify, review, and decide a documentation artifact."',
      'when_to_use = ["A docs artifact needs focused review."]',
      'packet_artifacts = ["request.md", "plan.md", "handoff.md", "verification.md", "findings.md", "decision.md"]',
      'quality_gates = ["The decider records accepted and rejected findings."]',
      "",
    ].join("\n"),
  );
  return workflowPath;
}

function writeUserPreset(workspace: string): string {
  const presetDir = path.join(workspace, ".home", ".config", "agentmesh", "presets");
  mkdirSync(presetDir, { recursive: true });
  const presetPath = path.join(presetDir, "studio-review.toml");
  writeFileSync(
    presetPath,
    [
      "schema_version = 1",
      'workflow = "w-9d94d0db"',
      'description = "Review gate using the Studio test agent."',
      "",
      "[stage_assignments]",
      'review = ["studio-agent"]',
      'decide = ["studio-agent"]',
      "",
    ].join("\n"),
  );
  return presetPath;
}

function writePresetSource(workspace: string, presetId = "studio-created-preset"): string {
  const presetPath = path.join(workspace, `${presetId}.toml`);
  writeFileSync(
    presetPath,
    [
      "schema_version = 1",
      'name = "Studio Created Preset"',
      'workflow = "w-9d94d0db"',
      'description = "Studio-created review gate preset."',
      "",
      "[stage_assignments]",
      'review = ["current"]',
      'decide = ["current"]',
      "",
    ].join("\n"),
  );
  return presetPath;
}

function writeWorkflowSource(workspace: string, workflowId = "studio-created-workflow"): string {
  const workflowPath = path.join(workspace, `${workflowId}.toml`);
  writeFileSync(
    workflowPath,
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'name = "Studio Created Workflow"',
      'stages = ["plan", "review", "decide"]',
      'description = "Plan, review, and decide a Studio-created workflow."',
      'when_to_use = ["A local workflow TOML should be registered from Studio."]',
      'packet_artifacts = ["request.md", "plan.md", "findings.md", "decision.md"]',
      'quality_gates = ["The decider records accepted and rejected findings."]',
      "",
    ].join("\n"),
  );
  return workflowPath;
}

function writeCallRecordPatch(
  callDir: string,
  patch: Partial<DirectCallRecord>,
): DirectCallRecord {
  const record = {
    ...readCallRecord(callDir),
    ...patch,
  };
  writeFileSync(path.join(callDir, "call.json"), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

test("Studio packet browser lists runs and reads packet details", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(
    workspace,
    "run-old",
    { status: "completed", completed_stages: ["plan", "decide"] },
    [
      {
        schema_version: 1,
        timestamp: "2026-05-14T00:00:00.000Z",
        event: "run.created",
      },
    ],
  );
  writeRun(
    workspace,
    "run-new",
    {
      status: "needs_decision",
      completed_stages: ["plan"],
      resolved_context_policy: {
        max_bytes: 4096,
        max_files: 3,
        required_sources: ["required.md"],
        denied_paths: ["secrets"],
        redact_patterns: ["API_KEY=[A-Za-z0-9]+"],
      },
      resolved_execution_policy: {
        adapter_timeout_secs: 10,
        retry_attempts: 1,
        max_adapter_timeout_secs: 10,
        max_retry_attempts: 1,
        require_user_gate: true,
        allow_auto_dispatch: false,
      },
    },
    [
      {
        schema_version: 1,
        timestamp: "2026-05-14T01:00:00.000Z",
        event: "run.created",
      },
      {
        schema_version: 1,
        timestamp: "2026-05-14T01:01:00.000Z",
        event: "stage.completed",
        stage: "plan",
      },
    ],
  );

  const runs = listStudioRuns({ cwd: workspace, scope: "current" });
  assert.deepEqual(runs.map((run) => run.run_id), ["run-new", "run-old"]);
  assert.equal(runs[0].status, "needs_decision");
  assert.equal(runs[0].latest_event, "stage.completed");

  const detail = readStudioRun("run-new", { cwd: workspace, eventTail: 1 });
  assert.equal(detail.summary.run_id, "run-new");
  assert.equal(detail.summary.created_at, "2026-05-14T00:00:00.000Z");
  assert.equal(detail.summary.updated_at, "2026-05-14T00:00:01.000Z");
  assert.deepEqual(detail.summary.stage_timing.map((timing) => timing.stage), ["plan", "decide"]);
  assert.equal(detail.summary.stage_timing[0].duration_ms, 1000);
  assert.equal(detail.summary.stage_timing[0].attempt_count, 1);
  assert.deepEqual(detail.summary.resolved_context_policy, {
    max_bytes: 4096,
    max_files: 3,
    required_sources: ["required.md"],
    denied_paths: ["secrets"],
    redact_patterns: ["API_KEY=[A-Za-z0-9]+"],
  });
  assert.deepEqual(detail.summary.resolved_execution_policy, {
    adapter_timeout_secs: 10,
    retry_attempts: 1,
    max_adapter_timeout_secs: 10,
    max_retry_attempts: 1,
    require_user_gate: true,
    allow_auto_dispatch: false,
  });
  assert.equal(detail.events.length, 1);
  assert.equal(detail.events[0].event, "stage.completed");
  assert.deepEqual(detail.artifacts.map((artifact) => artifact.name), ["plan", "request"]);

  const preview = readStudioArtifactPreview("run-new", "plan", { cwd: workspace });
  assert.equal(preview.name, "plan");
  assert.match(preview.content, /run-new plan/);
  assert.equal(preview.truncated, false);
});

test("Studio packet browser paginates events while preserving latest summary", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(
    workspace,
    "paged-run",
    { status: "running" },
    Array.from({ length: 7 }, (_, index) => ({
      schema_version: 1,
      timestamp: `2026-05-14T00:00:0${index + 1}.000Z`,
      event: `event-${index + 1}`,
    })),
  );

  const latestPage = readStudioRun("paged-run", { cwd: workspace, eventLimit: 3 });
  assert.deepEqual(latestPage.events.map((event) => event.event), ["event-5", "event-6", "event-7"]);
  assert.deepEqual(latestPage.events_page, { offset: 4, limit: 3, total: 7 });
  assert.equal(latestPage.summary.latest_event, "event-7");

  const olderPage = readStudioRun("paged-run", { cwd: workspace, eventOffset: 1, eventLimit: 2 });
  assert.deepEqual(olderPage.events.map((event) => event.event), ["event-2", "event-3"]);
  assert.deepEqual(olderPage.events_page, { offset: 1, limit: 2, total: 7 });
  assert.equal(olderPage.summary.latest_event, "event-7");
});

test("Studio packet browser rejects artifact paths that escape the packet", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const runDir = writeRun(
    workspace,
    "escape-run",
    {},
    [
      {
        schema_version: 1,
        timestamp: "2026-05-14T00:00:00.000Z",
        event: "run.created",
      },
    ],
  );
  writeFileSync(
    path.join(runDir, "artifacts.toml"),
    [
      "schema_version = 1",
      "",
      "[artifacts.escape]",
      'path = "../outside.md"',
      'kind = "markdown"',
      'stage = "plan"',
      "",
    ].join("\n"),
  );

  assert.throws(
    () => readStudioArtifactPreview("escape-run", "escape", { cwd: workspace }),
    /artifact path escapes run directory/,
  );
});

test("Studio packet browser reads release and review evidence", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const runDir = writeRun(
    workspace,
    "release-run",
    {
      status: "needs_decision",
      workflow: "w-67ef1b1f",
      release_verdict: {
        value: "needs_decision",
        diagnostic: "manual approval required",
      },
    },
    [
      {
        schema_version: 1,
        timestamp: "2026-05-14T00:00:00.000Z",
        event: "run.created",
      },
    ],
  );
  writeFileSync(
    path.join(runDir, "findings.md"),
    [
      "# Findings",
      "",
      "## Accepted",
      "",
      "- [Must Fix] src/app.ts:1 - Accepted blocker.",
      "",
      "## Rejected",
      "",
      "- [source: reviewer] False positive.",
      "",
      "## Needs Decision",
      "",
      "- Release needs owner approval.",
      "",
      "## Raw Review Outputs",
      "",
      "### claude",
      "",
      "[Nit] Embedded raw review note.",
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
      "- Mobile smoke not run.",
      "",
      "## Remaining Risk",
      "",
      "- Manual deploy still pending.",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(runDir, "release-summary.md"),
    [
      "# Release Evidence Summary",
      "",
      "## Run",
      "",
      "- Status: needs_decision",
      "- Release verdict: needs_decision",
      "",
      "## Skipped Or Missing Evidence",
      "",
      "- Browser smoke was skipped.",
      "",
      "## Residual Risk Signals",
      "",
      "### Not Verified",
      "",
      "- Mobile smoke not run.",
      "",
      "### Remaining Risk",
      "",
      "- Manual deploy still pending.",
      "",
      "## Review Findings",
      "",
      "# Findings",
      "",
    ].join("\n"),
  );
  mkdirSync(path.join(runDir, "reviews"));
  writeFileSync(path.join(runDir, "reviews", "gemini.md"), "[Should Fix] Review note.\n");
  writeFileSync(
    path.join(workspace, "agentmesh.toml"),
    [
      "schema_version = 1",
      "",
      "[agents.gemini]",
      'label = "Gemini Reviewer"',
      'adapter = "command"',
      'capabilities = ["review"]',
      "",
    ].join("\n"),
  );

  const detail = readStudioRun("release-run", { cwd: workspace });

  assert.equal(detail.review_release.release_verdict?.value, "needs_decision");
  assert.equal(detail.review_release.release_verdict?.diagnostic, "manual approval required");
  assert.deepEqual(detail.review_release.findings.accepted, [
    "[Must Fix] src/app.ts:1 - Accepted blocker.",
  ]);
  assert.deepEqual(detail.review_release.findings.rejected, [
    "[source: reviewer] False positive.",
  ]);
  assert.deepEqual(detail.review_release.findings.needs_decision, [
    "Release needs owner approval.",
  ]);
  assert.deepEqual(detail.review_release.skipped_checks, ["Browser smoke was skipped."]);
  assert.deepEqual(detail.review_release.residual_risk, [
    "Mobile smoke not run.",
    "Manual deploy still pending.",
  ]);
  assert.deepEqual(detail.review_release.raw_reviews.map((review) => review.reviewer), [
    "gemini",
    "claude",
  ]);
  assert.equal(detail.review_release.raw_reviews[0].reviewer_label, "Gemini Reviewer");
  assert.equal(detail.review_release.raw_reviews[1].reviewer_label, undefined);
  assert.match(detail.review_release.raw_reviews[0].content, /Review note/);
  assert.match(detail.review_release.raw_reviews[1].content, /Embedded raw review note/);
  assert.equal(
    detail.review_release.release_summary.sections.some((section) => section.heading === "Run"),
    true,
  );
});

test("Studio packet browser ignores placeholder review findings", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const runDir = writeRun(
    workspace,
    "placeholder-findings-run",
    {
      status: "review_completed",
      workflow: "w-9d94d0db",
    },
    [
      {
        schema_version: 1,
        timestamp: "2026-05-14T00:00:00.000Z",
        event: "run.created",
      },
    ],
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
      "- TBD",
      "",
      "## Needs Decision",
      "",
      "- TBD",
      "",
      "## Raw Review Outputs",
      "",
      "### claude",
      "",
      "[Should Fix] Show the concrete accepted item instead of a placeholder count.",
      "",
    ].join("\n"),
  );

  const detail = readStudioRun("placeholder-findings-run", { cwd: workspace });

  assert.deepEqual(detail.review_release.findings.accepted, []);
  assert.deepEqual(detail.review_release.findings.rejected, []);
  assert.deepEqual(detail.review_release.findings.needs_decision, []);
  assert.equal(detail.review_release.raw_reviews.length, 1);
  assert.match(detail.review_release.raw_reviews[0].content, /placeholder count/);
});

test("Studio packet browser exposes verify stage timing and verification artifacts", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const runDir = writeRun(
    workspace,
    "verify-run",
    {
      status: "verify_completed",
      workflow: "w-1ab330ed",
      stages: ["plan", "execute", "verify", "review", "decide"],
      stage_nodes: [
        { id: "plan", type: "plan", occurrence: 1 },
        { id: "execute", type: "execute", occurrence: 1 },
        { id: "verify", type: "verify", occurrence: 1 },
        { id: "review", type: "review", occurrence: 1 },
        { id: "decide", type: "decide", occurrence: 1 },
      ],
      completed_stages: ["plan", "execute", "verify"],
      stage_timing: {
        plan: {
          started_at: "2026-05-14T00:00:00.000Z",
          completed_at: "2026-05-14T00:00:01.000Z",
          duration_ms: 1000,
          attempt_count: 1,
        },
        execute: {
          started_at: "2026-05-14T00:00:01.000Z",
          completed_at: "2026-05-14T00:00:02.000Z",
          duration_ms: 1000,
          attempt_count: 1,
        },
        verify: {
          started_at: "2026-05-14T00:00:02.000Z",
          completed_at: "2026-05-14T00:00:03.000Z",
          duration_ms: 1000,
          attempt_count: 1,
        },
        review: { attempt_count: 0 },
        decide: { attempt_count: 0 },
      },
    },
    [
      {
        schema_version: 1,
        timestamp: "2026-05-14T00:00:03.000Z",
        event: "stage.completed",
        stage: "verify",
      },
    ],
  );
  writeFileSync(path.join(runDir, "verification.md"), "# Verification\n\nTests passed.\n");
  writeFileSync(
    path.join(runDir, "artifacts.toml"),
    [
      "schema_version = 1",
      "",
      "[artifacts.request]",
      'path = "request.md"',
      'kind = "request"',
      'stage = "run"',
      "",
      "[artifacts.plan]",
      'path = "plan.md"',
      'kind = "markdown"',
      'stage = "plan"',
      "",
      "[artifacts.verification]",
      'path = "verification.md"',
      'kind = "markdown"',
      'stage = "verify"',
      'agent = "verifier"',
      "",
    ].join("\n"),
  );

  const detail = readStudioRun("verify-run", { cwd: workspace });

  assert.deepEqual(detail.summary.stages, ["plan", "execute", "verify", "review", "decide"]);
  assert.deepEqual(detail.summary.stage_timing.map((timing) => timing.stage), [
    "plan",
    "execute",
    "verify",
    "review",
    "decide",
  ]);
  assert.equal(detail.summary.stage_timing[2].stage, "verify");
  assert.equal(detail.summary.stage_timing[2].duration_ms, 1000);
  assert.deepEqual(
    detail.artifacts.find((artifact) => artifact.name === "verification"),
    {
      name: "verification",
      path: "verification.md",
      kind: "markdown",
      stage: "verify",
      agent: "verifier",
    },
  );

  const preview = readStudioArtifactPreview("verify-run", "verification", { cwd: workspace });
  assert.match(preview.content, /Tests passed/);
});

test("Studio mutations describe runtime actions without accepting unsafe tokens", () => {
  const cwd = "/tmp/workspace";

  assert.deepEqual(
    studioMutationCommand(
      { action: "dispatch", run_id: "run-1", stage: "all" },
      { cwd },
    ),
    ["runtime", "flow", "dispatch", "run-1", "--stage", "all"],
  );
  assert.deepEqual(
    studioMutationCommand(
      { action: "retry", run_id: "run-1", stage: "review" },
      { cwd },
    ),
    ["runtime", "flow", "retry", "run-1", "--stage", "review"],
  );
  assert.deepEqual(
    studioMutationCommand(
      { action: "resume", run_id: "run-1" },
      { cwd },
    ),
    ["runtime", "flow", "resume", "run-1"],
  );
  assert.deepEqual(
    studioMutationCommand(
      {
        action: "attach",
        run_id: "run-1",
        stage: "decide",
        agent: "current",
        text: "ship it",
      },
      { cwd },
    ),
    [
      "runtime",
      "flow",
      "attach",
      "run-1",
      "--stage",
      "decide",
      "--agent",
      "current",
      "--text",
      "ship it",
    ],
  );
  assert.throws(
    () =>
      studioMutationCommand(
        { action: "dispatch", run_id: "../run", stage: "all" },
        { cwd },
      ),
    /run_id contains unsupported characters/,
  );
  assert.throws(
    () =>
      studioMutationCommand(
        { action: "dispatch", run_id: "run-1", stage: undefined } as never,
        { cwd },
      ),
    /stage must be a string/,
  );
  assert.throws(
    () =>
      studioMutationCommand(
        { action: "attach", run_id: "run-1", stage: "decide" },
        { cwd },
      ),
    /attach requires text or file/,
  );
});

test("Studio mutations execute through runtime APIs without a CLI subprocess", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(workspace, "run-1", {
    stage_assignments: {
      plan: ["current"],
    },
  }, []);

  const result = await runStudioMutation(
    { action: "attach", run_id: "run-1", stage: "plan", text: "ship it" },
    { cwd: workspace },
  );

  assert.equal(result.exit_code, 0);
  assert.match(result.stdout, /Attached:/);
  assert.deepEqual(result.command, [
    "runtime",
    "flow",
    "attach",
    "run-1",
    "--stage",
    "plan",
    "--text",
    "ship it",
  ]);
  assert.equal(readFileSync(path.join(workspace, ".agentmesh", "runs", "run-1", "plan.md"), "utf-8"), "ship it\n");
});

test("Studio server exposes read-only packet browser endpoints", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(
    workspace,
    "server-run",
    { status: "running", title: "浏览运行记录" },
    [
      {
        schema_version: 1,
        timestamp: "2026-05-14T00:00:00.000Z",
        event: "run.created",
      },
    ],
  );
  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const html = await fetchText(`${url}/`);
  assert.match(html, /AgentMesh/);
  assert.doesNotMatch(html, /AgentMesh Studio/);

  const runs = await fetchJson(`${url}/api/runs?scope=current`) as {
    runs: Array<{ run_id: string; title?: string }>;
  };
  assert.deepEqual(runs.runs.map((run) => run.run_id), ["server-run"]);
  assert.equal(runs.runs[0].title, "浏览运行记录");

  const detail = await fetchJson(`${url}/api/runs/server-run?event_offset=0&event_limit=1`) as {
    summary: { status: string };
    events: Array<{ event: string }>;
    events_page: { offset: number; limit: number; total: number };
    artifacts: Array<{ name: string }>;
    review_release: { findings: { present: boolean } };
  };
  assert.equal(detail.summary.status, "running");
  assert.deepEqual(detail.events.map((event) => event.event), ["run.created"]);
  assert.deepEqual(detail.events_page, { offset: 0, limit: 1, total: 1 });
  assert.deepEqual(detail.artifacts.map((artifact) => artifact.name), ["plan", "request"]);
  assert.equal(detail.review_release.findings.present, false);

  const preview = await fetchJson(`${url}/api/runs/server-run/artifacts/request`) as {
    content: string;
  };
  assert.match(preview.content, /server-run/);
});

test("Studio server aggregates runs from registered workspaces", async () => {
  const currentWorkspace = makeWorkspace();
  const remoteWorkspace = makeWorkspace();
  test.after(() => {
    rmSync(currentWorkspace, { recursive: true, force: true });
    rmSync(remoteWorkspace, { recursive: true, force: true });
  });
  const restoreHome = isolateHome(currentWorkspace);
  try {
    writeRun(
      currentWorkspace,
      "current-run",
      {
        status: "running",
        created_at: "2026-06-10T08:00:00.000Z",
        updated_at: "2026-06-10T08:01:00.000Z",
      },
      [
        {
          schema_version: 1,
          timestamp: "2026-06-10T08:00:00.000Z",
          event: "run.created",
        },
      ],
    );
    writeRun(
      remoteWorkspace,
      "remote-run",
      {
        status: "needs_decision",
        created_at: "2026-06-10T09:00:00.000Z",
        updated_at: "2026-06-10T09:01:00.000Z",
      },
      [
        {
          schema_version: 1,
          timestamp: "2026-06-10T09:00:00.000Z",
          event: "run.created",
        },
        {
          schema_version: 1,
          timestamp: "2026-06-10T09:01:00.000Z",
          event: "stage.completed",
          stage: "plan",
        },
      ],
    );
    const remoteEntry = registerWorkspace(remoteWorkspace, {
      label: "Remote Runs",
      now: "2026-06-10T09:02:00.000Z",
    });

    const { server, url } = await listen(createStudioServer({ cwd: currentWorkspace }));
    try {
      const index = await fetchJson(`${url}/api/runs`) as {
        runs: Array<{
          run_id: string;
          workspace: { id: string; label: string; path: string; current: boolean };
        }>;
        workspaces: Array<{ id: string; current: boolean }>;
        diagnostics: unknown[];
      };
      assert.deepEqual(index.runs.map((run) => run.run_id), ["remote-run", "current-run"]);
      assert.equal(index.runs[0].workspace.id, remoteEntry.id);
      assert.equal(index.runs[0].workspace.label, "Remote Runs");
      assert.equal(index.runs[0].workspace.path, realpathSync(remoteWorkspace));
      assert.equal(index.runs[0].workspace.current, false);
      assert.equal(index.runs[1].workspace.current, true);
      assert.equal(index.runs.some((run) => Object.hasOwn(run, "title")), false);
      assert.equal(index.workspaces.length, 2);
      assert.deepEqual(index.diagnostics, []);

      const localOnlyDetail = await fetch(`${url}/api/runs/remote-run`);
      assert.equal(localOnlyDetail.status, 404);
      assert.match(await localOnlyDetail.text(), /run not found/);

      const detail = await fetchJson(
        `${url}/api/runs/remote-run?workspace_id=${remoteEntry.id}&event_offset=0&event_limit=2`,
      ) as {
        summary: { run_id: string; workspace: { id: string }; latest_event: string };
        events: Array<{ event: string }>;
      };
      assert.equal(detail.summary.workspace.id, remoteEntry.id);
      assert.equal(detail.summary.latest_event, "stage.completed");
      assert.deepEqual(detail.events.map((event) => event.event), ["run.created", "stage.completed"]);

      const preview = await fetchJson(
        `${url}/api/runs/remote-run/artifacts/request?workspace_id=${remoteEntry.id}`,
      ) as { content: string };
      assert.match(preview.content, /remote-run/);
    } finally {
      server.close();
    }
  } finally {
    restoreHome();
  }
});

test("Studio server deletes only the selected AgentMesh run or call directory", async () => {
  const workspace = makeWorkspace();
  const remoteWorkspace = makeWorkspace();
  const externalRoot = makeWorkspace();
  test.after(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(remoteWorkspace, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  });
  const restoreHome = isolateHome(workspace);

  try {
    const runDir = writeRun(workspace, "delete-run", {
      related_call_ids: ["cross-linked-call"],
      output_path: path.join(externalRoot, "run-output.md"),
    }, []);
    mkdirSync(path.join(runDir, "nested", "evidence"), { recursive: true });
    writeFileSync(path.join(runDir, "nested", "evidence", "result.md"), "managed evidence\n");
    const preservedRunDir = writeRun(workspace, "preserved-run", {}, []);
    const externalRunOutput = path.join(externalRoot, "run-output.md");
    const userSource = path.join(workspace, "src", "owned-by-user.ts");
    mkdirSync(path.dirname(userSource), { recursive: true });
    writeFileSync(externalRunOutput, "external run output\n");
    writeFileSync(userSource, "export const userOwned = true;\n");

    const linkedCall = createCallRecord({
      workspace,
      cwd: workspace,
      agentId: "reviewer",
      adapter: "command",
      purpose: "review",
      promptSource: "inline",
      promptContent: "linked call",
    });
    writeCallRecordPatch(linkedCall.callDir, { related_run_ids: ["delete-run"] });

    const externalCallOutput = path.join(workspace, "outputs", "call-output.md");
    mkdirSync(path.dirname(externalCallOutput), { recursive: true });
    writeFileSync(externalCallOutput, "external call output\n");
    const deletedCall = createCallRecord({
      workspace,
      cwd: workspace,
      agentId: "worker",
      adapter: "command",
      purpose: "general",
      promptSource: "inline",
      promptContent: "delete this call record only",
    });
    completeCallRecord(deletedCall, {
      status: "success",
      stdout: "done\n",
      outputFile: externalCallOutput,
    });
    mkdirSync(path.join(deletedCall.callDir, "nested"), { recursive: true });
    writeFileSync(path.join(deletedCall.callDir, "nested", "managed.txt"), "managed\n");

    const remoteEntry = registerWorkspace(remoteWorkspace, {
      registryPath: path.join(workspace, ".home", ".config", "agentmesh", "workspaces.json"),
      label: "Remote Delete Target",
      now: "2026-06-10T09:00:00.000Z",
    });
    const localTarget = writeRun(workspace, "targeted-run", {}, []);
    const remoteTarget = writeRun(remoteWorkspace, "targeted-run", {}, []);

    const escapedRun = writeRun(externalRoot, "escaped-run", {}, []);
    symlinkSync(escapedRun, path.join(workspace, ".agentmesh", "runs", "symlink-run"));

    const { server, url } = await listen(createStudioServer({ cwd: workspace }));
    test.after(() => server.close());

    const deleteRun = await fetch(`${url}/api/runs/delete-run`, { method: "DELETE" });
    assert.equal(deleteRun.status, 200, await deleteRun.clone().text());
    assert.deepEqual(await deleteRun.json(), {
      deleted: true,
      kind: "run",
      id: "delete-run",
      workspace_id: (await fetchJson(`${url}/api/runs`) as { workspaces: Array<{ id: string; current: boolean }> })
        .workspaces.find((entry) => entry.current)?.id,
    });
    assert.equal(existsSync(runDir), false);
    assert.equal(existsSync(preservedRunDir), true);
    assert.equal(existsSync(linkedCall.callDir), true);
    assert.equal(readFileSync(externalRunOutput, "utf-8"), "external run output\n");
    assert.equal(readFileSync(userSource, "utf-8"), "export const userOwned = true;\n");

    const deleteCall = await fetch(`${url}/api/calls/${encodeURIComponent(deletedCall.record.id)}`, {
      method: "DELETE",
    });
    assert.equal(deleteCall.status, 200, await deleteCall.text());
    assert.equal(existsSync(deletedCall.callDir), false);
    assert.equal(existsSync(linkedCall.callDir), true);
    assert.equal(readFileSync(externalCallOutput, "utf-8"), "external call output\n");

    const targeted = await fetch(
      `${url}/api/runs/targeted-run?workspace_id=${encodeURIComponent(remoteEntry.id)}`,
      { method: "DELETE" },
    );
    assert.equal(targeted.status, 200, await targeted.text());
    assert.equal(existsSync(remoteTarget), false);
    assert.equal(existsSync(localTarget), true);

    for (const [requestPath, expectedStatus] of [
      ["/api/runs/missing-run", 404],
      ["/api/calls/missing-call", 404],
      ["/api/runs/%2E%2E%2Fescape", 400],
      ["/api/calls/%2E%2E%2Fescape", 400],
      ["/api/runs/%E0%A4%A", 400],
      ["/api/runs/symlink-run", 400],
      ["/api/runs/preserved-run?workspace_id=missing-workspace", 404],
    ] as const) {
      const response = await fetch(`${url}${requestPath}`, { method: "DELETE" });
      assert.equal(response.status, expectedStatus, `${requestPath}: ${await response.text()}`);
    }
    assert.equal(existsSync(escapedRun), true);
    assert.equal(existsSync(preservedRunDir), true);
  } finally {
    restoreHome();
  }
});

test("Studio deletion rejects a symlinked AgentMesh management root", async () => {
  const workspace = makeWorkspace();
  const externalRoot = makeWorkspace();
  test.after(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  });
  const externalRun = writeRun(externalRoot, "outside-run", {}, []);
  mkdirSync(path.join(workspace, ".agentmesh"), { recursive: true });
  symlinkSync(path.join(externalRoot, ".agentmesh", "runs"), path.join(workspace, ".agentmesh", "runs"));

  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());
  const response = await fetch(`${url}/api/runs/outside-run`, { method: "DELETE" });
  assert.equal(response.status, 400, await response.text());
  assert.equal(existsSync(externalRun), true);
});

test("Studio server exposes read-only direct call index and details", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const callsDir = path.join(workspace, CALLS_RELATIVE_DIR);
  const restoreHome = isolateHome(workspace);

  try {
    const adopted = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "caller",
    adapter: "command",
    model: "gpt-test",
    purpose: "review",
    promptSource: "inline",
    promptContent: "Summarize the API contract.",
  });
  completeCallRecord(adopted, {
    status: "success",
    stdout: "# Result\n\nCall output evidence.\n",
    stderr: "",
    result: {
      stdout: "# Result\n\nCall output evidence.\n",
      stderr: "",
      exitCode: 0,
      timing: {
        config_load_ms: 0,
        adapter_spawn_ms: 0,
        agent_total_ms: 1,
        total_ms: 1,
      },
    },
  });
  writeCallRecordPatch(adopted.callDir, {
    created_at: "2026-05-17T02:00:00.000Z",
    started_at: "2026-05-17T02:00:00.000Z",
    completed_at: "2026-05-17T02:00:01.000Z",
    heartbeat_at: "2026-05-17T02:00:01.000Z",
    related_files: ["apps/studio/src/server.ts"],
    related_run_ids: ["run-linked"],
    related_call_ids: ["call-linked"],
  });
  appendCallAdoptionEvent({
    callDir: adopted.callDir,
    status: "accepted",
    updatedByEntrypoint: "studio-test",
    reason: "covered by server API test",
    relatedCommit: "abc1234",
    updatedAt: "2026-05-17T02:10:00.000Z",
  });

  const stale = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "slow-agent",
    adapter: "command",
    purpose: "general",
    promptSource: "inline",
    promptContent: "still running",
  });
  writeCallRecordPatch(stale.callDir, {
    title: undefined,
    created_at: "2026-05-17T01:00:00.000Z",
    started_at: "2026-05-17T01:00:00.000Z",
    heartbeat_at: "1970-01-01T00:00:00.000Z",
  });

  const newer = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "future-agent",
    adapter: "command",
    purpose: "general",
    promptSource: "inline",
    promptContent: "future schema",
  });
  writeCallRecordPatch(newer.callDir, {
    schema_version: 99,
    status: "success",
    created_at: "2026-05-16T10:00:00.000Z",
    completed_at: "2026-05-16T10:00:01.000Z",
    heartbeat_at: "2026-05-16T10:00:01.000Z",
  });

  const outputFile = path.join(workspace, "outputs", "missing-call.md");
  mkdirSync(path.dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, "external output before deletion\n");
  const dangling = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "file-agent",
    adapter: "command",
    purpose: "general",
    promptSource: "inline",
    promptContent: "write an external output",
  });
  completeCallRecord(dangling, {
    status: "success",
    stdout: "external output before deletion\n",
    outputFile,
  });
  rmSync(outputFile, { force: true });
  writeCallRecordPatch(dangling.callDir, {
    created_at: "2026-05-15T09:00:00.000Z",
    completed_at: "2026-05-15T09:00:01.000Z",
    heartbeat_at: "2026-05-15T09:00:01.000Z",
  });

  mkdirSync(path.join(callsDir, "tmp-writing"), { recursive: true });
  mkdirSync(path.join(workspace, "docs", "reviews"), { recursive: true });
  writeFileSync(
    path.join(workspace, "docs", "reviews", "fake-call.md"),
    JSON.stringify({ id: "review-only", status: "success" }),
  );

  const adoptedPromptBefore = readFileSync(path.join(adopted.callDir, "prompt.md"), "utf-8");
  const adoptedOutputBefore = readFileSync(path.join(adopted.callDir, "output.md"), "utf-8");
  const staleRecordBefore = readFileSync(path.join(stale.callDir, "call.json"), "utf-8");
  const newerRecordBefore = readFileSync(path.join(newer.callDir, "call.json"), "utf-8");

  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const index = await fetchJson(`${url}/api/calls`) as {
    total: number;
    calls: Array<{
      id: string;
      title?: string;
      status: string;
      adoption_status: string;
      read_only?: boolean;
      unsupported_schema?: boolean;
      schema_warning?: string;
    }>;
    groups: Array<{
      date: string;
      calls: Array<{ id: string }>;
    }>;
  };
  assert.equal(index.total, 4);
  assert.deepEqual(
    index.calls.map((call) => call.id),
    [adopted.record.id, stale.record.id, newer.record.id, dangling.record.id],
  );
  assert.equal(index.calls[0].title, adopted.record.title);
  assert.deepEqual(index.groups.map((group) => group.date), [
    "2026-05-17",
    "2026-05-16",
    "2026-05-15",
  ]);
  assert.deepEqual(index.groups[0].calls.map((call) => call.id), [
    adopted.record.id,
    stale.record.id,
  ]);
  assert.equal(index.calls.find((call) => call.id === stale.record.id)?.status, "stale");
  assert.equal(Object.hasOwn(index.calls.find((call) => call.id === stale.record.id) ?? {}, "title"), false);
  const newerSummary = index.calls.find((call) => call.id === newer.record.id);
  assert.equal(newerSummary?.read_only, true);
  assert.equal(newerSummary?.unsupported_schema, true);
  assert.match(newerSummary?.schema_warning ?? "", /newer than supported/);
  assert.equal(index.calls.some((call) => call.id === "review-only"), false);
  assert.equal(index.calls.some((call) => call.id === "tmp-writing"), false);
  assert.equal(readFileSync(path.join(stale.callDir, "call.json"), "utf-8"), staleRecordBefore);
  assert.equal(readFileSync(path.join(newer.callDir, "call.json"), "utf-8"), newerRecordBefore);

  const detail = await fetchJson(`${url}/api/calls/${encodeURIComponent(adopted.record.id)}`) as {
    call: {
      id: string;
      adoption_status: string;
      related_files: string[];
      related_run_ids: string[];
      related_call_ids: string[];
    };
    prompt: { present: boolean; path: string | null; content: string; truncated: boolean };
    output: { present: boolean; path: string | null; content: string; truncated: boolean };
    stderr: { present: boolean; path: string | null; content: string; truncated: boolean };
    adoption_events: Array<{ status: string; reason: string | null }>;
    warnings: Array<{ code: string; message: string; path?: string }>;
  };
  assert.equal(detail.call.id, adopted.record.id);
  assert.equal(detail.call.adoption_status, "accepted");
  assert.deepEqual(detail.call.related_files, ["apps/studio/src/server.ts"]);
  assert.deepEqual(detail.call.related_run_ids, ["run-linked"]);
  assert.deepEqual(detail.call.related_call_ids, ["call-linked"]);
  assert.equal(detail.prompt.present, true);
  assert.equal(detail.prompt.path, "prompt.md");
  assert.match(detail.prompt.content, /Summarize the API contract/);
  assert.equal(detail.prompt.truncated, false);
  assert.equal(detail.output.present, true);
  assert.equal(detail.output.path, "output.md");
  assert.match(detail.output.content, /Call output evidence/);
  assert.equal(detail.stderr.present, false);
  assert.deepEqual(detail.adoption_events.map((event) => event.status), ["accepted"]);
  assert.deepEqual(detail.warnings, []);
  assert.equal(readFileSync(path.join(adopted.callDir, "prompt.md"), "utf-8"), adoptedPromptBefore);
  assert.equal(readFileSync(path.join(adopted.callDir, "output.md"), "utf-8"), adoptedOutputBefore);

  const danglingDetail = await fetchJson(`${url}/api/calls/${encodeURIComponent(dangling.record.id)}`) as {
    call: { output_path: string | null };
    output: { present: boolean; path: string | null; content: string };
    warnings: Array<{ code: string; path?: string }>;
  };
  assert.equal(danglingDetail.call.output_path, "outputs/missing-call.md");
  assert.equal(danglingDetail.output.present, false);
  assert.equal(danglingDetail.output.path, "outputs/missing-call.md");
  assert.equal(danglingDetail.output.content, "");
  assert.deepEqual(
    danglingDetail.warnings.map((warning) => [warning.code, warning.path]),
    [["dangling_output_path", "outputs/missing-call.md"]],
  );

  const missing = await fetch(`${url}/api/calls/missing-call`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /call not found/);

    const invalid = await fetch(`${url}/api/calls/bad%2fid`);
    assert.equal(invalid.status, 400);
    assert.match(await invalid.text(), /invalid call id/);
  } finally {
    restoreHome();
  }
});

test("Studio server aggregates direct calls from registered workspaces", async () => {
  const currentWorkspace = makeWorkspace();
  const remoteWorkspace = makeWorkspace();
  test.after(() => {
    rmSync(currentWorkspace, { recursive: true, force: true });
    rmSync(remoteWorkspace, { recursive: true, force: true });
  });
  const restoreHome = isolateHome(currentWorkspace);
  try {
    const current = createCallRecord({
      workspace: currentWorkspace,
      cwd: currentWorkspace,
      agentId: "current-agent",
      adapter: "command",
      purpose: "review",
      promptSource: "inline",
      promptContent: "current prompt",
      createdAt: "2026-06-10T08:00:00.000Z",
    });
    completeCallRecord(current, {
      status: "success",
      stdout: "current output\n",
    });
    writeCallRecordPatch(current.callDir, {
      created_at: "2026-06-10T08:00:00.000Z",
      started_at: "2026-06-10T08:00:00.000Z",
      completed_at: "2026-06-10T08:00:01.000Z",
      heartbeat_at: "2026-06-10T08:00:01.000Z",
    });

    const remote = createCallRecord({
      workspace: remoteWorkspace,
      cwd: remoteWorkspace,
      agentId: "remote-agent",
      adapter: "command",
      purpose: "review",
      promptSource: "inline",
      promptContent: "remote prompt",
      createdAt: "2026-06-10T09:00:00.000Z",
    });
    completeCallRecord(remote, {
      status: "success",
      stdout: "remote output\n",
    });
    writeCallRecordPatch(remote.callDir, {
      created_at: "2026-06-10T09:00:00.000Z",
      started_at: "2026-06-10T09:00:00.000Z",
      completed_at: "2026-06-10T09:00:01.000Z",
      heartbeat_at: "2026-06-10T09:00:01.000Z",
    });
    const remoteEntry = registerWorkspace(remoteWorkspace, {
      label: "Remote Workspace",
      now: "2026-06-10T09:01:00.000Z",
    });

    const { server, url } = await listen(createStudioServer({ cwd: currentWorkspace }));
    try {
      const index = await fetchJson(`${url}/api/calls`) as {
        calls: Array<{
          id: string;
          workspace: { id: string; label: string; path: string; current: boolean };
        }>;
        workspaces: Array<{ id: string; current: boolean }>;
        diagnostics: unknown[];
      };

      assert.deepEqual(index.calls.map((call) => call.id), [remote.record.id, current.record.id]);
      assert.equal(index.calls[0].workspace.id, remoteEntry.id);
      assert.equal(index.calls[0].workspace.label, "Remote Workspace");
      assert.equal(index.calls[0].workspace.path, realpathSync(remoteWorkspace));
      assert.equal(index.calls[0].workspace.current, false);
      assert.equal(index.calls[1].workspace.current, true);
      assert.equal(index.workspaces.length, 2);
      assert.deepEqual(index.diagnostics, []);

      const localOnlyDetail = await fetch(`${url}/api/calls/${remote.record.id}`);
      assert.equal(localOnlyDetail.status, 404);
      assert.match(await localOnlyDetail.text(), /call not found/);

      const remoteDetail = await fetchJson(
        `${url}/api/calls/${remote.record.id}?workspace_id=${remoteEntry.id}`,
      ) as { call: { workspace: { id: string } }; output: { content: string } };
      assert.equal(remoteDetail.call.workspace.id, remoteEntry.id);
      assert.match(remoteDetail.output.content, /remote output/);

      const adopted = await postJson(
        `${url}/api/calls/${remote.record.id}/adoption?workspace_id=${remoteEntry.id}`,
        { status: "accepted", reason: "used from global Studio" },
      ) as { call: { adoption_status: string; workspace: { id: string } } };
      assert.equal(adopted.call.adoption_status, "accepted");
      assert.equal(adopted.call.workspace.id, remoteEntry.id);
    } finally {
      server.close();
    }
  } finally {
    restoreHome();
  }
});

test("Studio server appends direct call adoption actions without touching artifacts", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const accepted = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "reviewer",
    adapter: "command",
    purpose: "review",
    promptSource: "inline",
    promptContent: "accept this call",
  });
  completeCallRecord(accepted, {
    status: "success",
    stdout: "accepted output\n",
  });
  const acceptedPromptBefore = readFileSync(path.join(accepted.callDir, "prompt.md"), "utf-8");
  const acceptedOutputBefore = readFileSync(path.join(accepted.callDir, "output.md"), "utf-8");

  const rejected = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "reviewer",
    adapter: "command",
    purpose: "review",
    promptSource: "inline",
    promptContent: "reject this call",
  });
  completeCallRecord(rejected, {
    status: "failed",
    stdout: "",
    stderr: "bad output\n",
    errorKind: "adapter_error",
    errorSummary: "bad output",
  });

  const superseded = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "reviewer",
    adapter: "command",
    purpose: "review",
    promptSource: "inline",
    promptContent: "supersede this call",
  });
  completeCallRecord(superseded, {
    status: "success",
    stdout: "old output\n",
  });

  const invalidMetadata = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "reviewer",
    adapter: "command",
    purpose: "review",
    promptSource: "inline",
    promptContent: "invalid metadata",
  });
  completeCallRecord(invalidMetadata, {
    status: "success",
    stdout: "metadata output\n",
  });

  const newer = createCallRecord({
    workspace,
    cwd: workspace,
    agentId: "future",
    adapter: "command",
    purpose: "review",
    promptSource: "inline",
    promptContent: "future schema",
  });
  writeCallRecordPatch(newer.callDir, { schema_version: 99 });

  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const acceptedDetail = await postJson(`${url}/api/calls/${accepted.record.id}/adoption`, {
    status: "accepted",
    reason: "used in implementation",
    related_commit: "abc1234",
    related_run_id: "run-linked",
  }) as {
    call: { adoption_status: string; related_run_ids: string[] };
    adoption_events: Array<{
      status: string;
      reason: string | null;
      related_commit: string | null;
      related_run_id: string | null;
      updated_by_entrypoint: string;
    }>;
  };
  assert.equal(acceptedDetail.call.adoption_status, "accepted");
  assert.deepEqual(acceptedDetail.call.related_run_ids, ["run-linked"]);
  assert.deepEqual(acceptedDetail.adoption_events.map((event) => event.status), ["accepted"]);
  assert.equal(acceptedDetail.adoption_events[0].reason, "used in implementation");
  assert.equal(acceptedDetail.adoption_events[0].related_commit, "abc1234");
  assert.equal(acceptedDetail.adoption_events[0].related_run_id, "run-linked");
  assert.equal(acceptedDetail.adoption_events[0].updated_by_entrypoint, "studio");
  assert.equal(readFileSync(path.join(accepted.callDir, "prompt.md"), "utf-8"), acceptedPromptBefore);
  assert.equal(readFileSync(path.join(accepted.callDir, "output.md"), "utf-8"), acceptedOutputBefore);

  const eventLogBefore = readFileSync(path.join(accepted.callDir, "adoption.jsonl"), "utf-8");
  const invalidTransition = await fetch(`${url}/api/calls/${accepted.record.id}/adoption`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "rejected", reason: "changed my mind" }),
  });
  assert.equal(invalidTransition.status, 409);
  assert.match(await invalidTransition.text(), /cannot transition call adoption from accepted to rejected/);
  assert.equal(readFileSync(path.join(accepted.callDir, "adoption.jsonl"), "utf-8"), eventLogBefore);

  const rejectedDetail = await postJson(`${url}/api/calls/${rejected.record.id}/adoption`, {
    status: "rejected",
    reason: "not used",
  }) as { call: { adoption_status: string }; adoption_events: Array<{ status: string }> };
  assert.equal(rejectedDetail.call.adoption_status, "rejected");
  assert.deepEqual(rejectedDetail.adoption_events.map((event) => event.status), ["rejected"]);

  const supersededDetail = await postJson(`${url}/api/calls/${superseded.record.id}/adoption`, {
    status: "superseded",
    reason: "newer call used",
    superseded_by_call_id: accepted.record.id,
  }) as {
    call: { adoption_status: string; related_call_ids: string[] };
    adoption_events: Array<{ status: string; superseded_by_call_id: string | null }>;
  };
  assert.equal(supersededDetail.call.adoption_status, "superseded");
  assert.deepEqual(supersededDetail.call.related_call_ids, [accepted.record.id]);
  assert.equal(supersededDetail.adoption_events[0].superseded_by_call_id, accepted.record.id);

  const invalidStatus = await fetch(`${url}/api/calls/${superseded.record.id}/adoption`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "unreviewed" }),
  });
  assert.equal(invalidStatus.status, 400);
  assert.match(await invalidStatus.text(), /invalid adoption status/);

  const invalidRelatedRun = await fetch(`${url}/api/calls/${invalidMetadata.record.id}/adoption`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "accepted", related_run_id: "../escape" }),
  });
  assert.equal(invalidRelatedRun.status, 400);
  assert.match(await invalidRelatedRun.text(), /invalid related-run-id/);

  const invalidReason = await fetch(`${url}/api/calls/${invalidMetadata.record.id}/adoption`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "accepted", reason: "bad\0reason" }),
  });
  assert.equal(invalidReason.status, 400);
  assert.match(await invalidReason.text(), /text values cannot contain null bytes/);
  assert.equal(existsSync(path.join(invalidMetadata.callDir, "adoption.jsonl")), false);

  const readOnly = await fetch(`${url}/api/calls/${newer.record.id}/adoption`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "accepted", reason: "future schema" }),
  });
  assert.equal(readOnly.status, 409);
  assert.match(await readOnly.text(), /cannot mutate adoption for newer call record schema/);
  assert.equal(existsSync(path.join(newer.callDir, "adoption.jsonl")), false);
});

test("Studio server can serve a built Vite frontend without taking over APIs", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(
    workspace,
    "built-asset-run",
    { status: "running" },
    [
      {
        schema_version: 1,
        timestamp: "2026-05-14T00:00:00.000Z",
        event: "run.created",
      },
    ],
  );
  const assetDir = path.join(workspace, "frontend-dist");
  mkdirSync(path.join(assetDir, "assets"), { recursive: true });
  writeFileSync(
    path.join(assetDir, "index.html"),
    [
      "<!doctype html>",
      '<html lang="zh-Hans">',
      "<head>",
      '<meta charset="utf-8" />',
      '<title>AgentMesh</title>',
      '<script type="module" crossorigin src="/assets/studio-react.js"></script>',
      '<link rel="stylesheet" crossorigin href="/assets/studio-react.css">',
      "</head>",
      "<body>",
      '<div id="root"></div>',
      "</body>",
      "</html>",
    ].join("\n"),
  );
  writeFileSync(
    path.join(assetDir, "assets", "studio-react.js"),
    'document.querySelector("#root").textContent = "AgentMesh React shell";\n',
  );
  writeFileSync(
    path.join(assetDir, "assets", "studio-react.css"),
    "body { color: #111827; }\n",
  );

  const { server, url } = await listen(createStudioServer({ cwd: workspace, assetDir }));
  test.after(() => server.close());

  const html = await fetchText(`${url}/`);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/assets\/studio-react\.js/);

  const script = await fetch(`${url}/assets/studio-react.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") ?? "", /javascript/);
  assert.match(await script.text(), /AgentMesh React shell/);

  const stylesheet = await fetch(`${url}/assets/studio-react.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get("content-type") ?? "", /text\/css/);

  const escaped = await fetch(`${url}/assets/%2e%2e/index.html`);
  assert.equal(escaped.status, 404);

  const runs = await fetchJson(`${url}/api/runs?scope=current`) as {
    runs: Array<{ run_id: string }>;
  };
  assert.deepEqual(runs.runs.map((run) => run.run_id), ["built-asset-run"]);
});

test("Studio frontend API client owns token headers cookie fallback and redacted errors", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const okFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const tokenClient = createStudioApiClient({
    baseUrl: "http://127.0.0.1:6123",
    token: "secret-token",
    fetch: okFetch,
  });
  assert.deepEqual(await tokenClient.getJson<{ ok: boolean }>("/api/health"), { ok: true });
  assert.equal(requests[0].url, "http://127.0.0.1:6123/api/health");
  assert.equal(new Headers(requests[0].init.headers).get("authorization"), "Bearer secret-token");
  assert.equal(requests[0].init.credentials, "same-origin");

  const cookieClient = createStudioApiClient({
    baseUrl: "http://127.0.0.1:7345",
    fetch: okFetch,
  });
  await cookieClient.getJson<{ ok: boolean }>("/api/health");
  assert.equal(requests[1].url, "http://127.0.0.1:7345/api/health");
  assert.equal(new Headers(requests[1].init.headers).has("authorization"), false);
  assert.equal(requests[1].init.credentials, "same-origin");

  const originalFetch = globalThis.fetch;
  let defaultFetchThis: unknown;
  try {
    globalThis.fetch = (async function boundSensitiveFetch(this: unknown) {
      defaultFetchThis = this;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const defaultClient = createStudioApiClient({ baseUrl: "http://127.0.0.1:7456" });
    assert.deepEqual(await defaultClient.getJson<{ ok: boolean }>("/api/health"), { ok: true });
    assert.equal(defaultFetchThis, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const failingClient = createStudioApiClient({
    baseUrl: "http://127.0.0.1:6123",
    token: "secret-token",
    fetch: async () =>
      new Response(JSON.stringify({ error: "server echoed secret-token" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
  });
  await assert.rejects(
    () => failingClient.getJson("/api/bootstrap?token=secret-token"),
    (error) => {
      assert.equal(error instanceof StudioApiError, true);
      const apiError = error as StudioApiError;
      assert.equal(apiError.kind, "http");
      assert.equal(apiError.status, 500);
      assert.equal(apiError.url, "http://127.0.0.1:6123/api/bootstrap?token=<redacted>");
      assert.doesNotMatch(apiError.message, /secret-token/);
      return true;
    },
  );
});

test("Studio frontend bootstrap uses launch URL bearer token with cookie fallback", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(
      JSON.stringify({
        schema_version: 1,
        authenticated: true,
        workspace: "/tmp/project",
        api_base_url: "",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const tokenUrlBootstrap = await bootstrapStudio({
    location: new URL("http://127.0.0.1:6123/?token=launch-token"),
    fetch: fetchImpl,
  });
  assert.equal(calls[0].url, "http://127.0.0.1:6123/api/bootstrap");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer launch-token");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(tokenUrlBootstrap.bootstrap.workspace, "/tmp/project");
  assert.doesNotMatch(JSON.stringify(tokenUrlBootstrap), /launch-token/);
  await tokenUrlBootstrap.client.getJson("/api/health");
  assert.equal(calls[1].url, "http://127.0.0.1:6123/api/health");
  assert.equal(new Headers(calls[1].init.headers).get("authorization"), "Bearer launch-token");

  const cleanedUrls: string[] = [];
  await bootstrapStudio({
    location: new URL("http://127.0.0.1:6123/?token=launch-token&view=runs#top"),
    history: {
      replaceState: (_data: unknown, _title: string, url?: string | URL | null) => {
        cleanedUrls.push(String(url));
      },
    },
    fetch: fetchImpl,
  });
  assert.equal(calls[2].url, "http://127.0.0.1:6123/api/bootstrap");
  assert.equal(new Headers(calls[2].init.headers).get("authorization"), "Bearer launch-token");
  assert.deepEqual(cleanedUrls, ["http://127.0.0.1:6123/?view=runs#top"]);

  const cookieBootstrap = await bootstrapStudio({
    location: new URL("http://127.0.0.1:7345/"),
    fetch: fetchImpl,
  });
  assert.equal(calls[3].url, "http://127.0.0.1:7345/api/bootstrap");
  assert.equal(new Headers(calls[3].init.headers).has("authorization"), false);
  assert.equal(calls[3].init.credentials, "same-origin");
  assert.equal(cookieBootstrap.bootstrap.authenticated, true);
});

test("Studio frontend API client performs health and bootstrap smoke against App Server", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const { server, url } = await listen(createStudioServer({
    cwd: workspace,
    authToken: "client-token",
  }));
  test.after(() => server.close());

  const client = createStudioApiClient({ baseUrl: url, token: "client-token" });
  assert.deepEqual(await client.getJson("/api/health"), { ok: true });

  const cookieFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("cookie", "agentmesh_studio_token=client-token");
    return fetch(input, {
      ...init,
      headers,
    });
  };
  const bootstrapped = await bootstrapStudio({
    baseUrl: url,
    location: new URL(`${url}/`),
    fetch: cookieFetch,
  });
  assert.equal(bootstrapped.bootstrap.authenticated, true);
  assert.equal(bootstrapped.bootstrap.workspace, workspace);

  const cookieOnlyClient = createStudioApiClient({ baseUrl: url });
  await assert.rejects(
    () => cookieOnlyClient.getJson("/api/bootstrap"),
    (error) => {
      assert.equal(error instanceof StudioApiError, true);
      const apiError = error as StudioApiError;
      assert.equal(apiError.kind, "auth");
      assert.equal(apiError.status, 401);
      assert.doesNotMatch(apiError.message, /client-token/);
      return true;
    },
  );
});

test("Studio browser bootstrap can be explicitly served without launch auth", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const browserStudio = await listen(createStudioServer({
    cwd: workspace,
    allowUnauthenticatedBootstrap: true,
  }));
  test.after(() => browserStudio.server.close());

  const bootstrap = await fetch(`${browserStudio.url}/api/bootstrap`);
  assert.equal(bootstrap.status, 200);
  const payload = await bootstrap.json() as {
    schema_version: number;
    authenticated: boolean;
    workspace: string;
    api_base_url: string;
  };
  assert.deepEqual(payload, {
    schema_version: 1,
    authenticated: false,
    workspace,
    api_base_url: "",
  });
});

test("Studio bootstrap endpoint never falls back to unauthenticated same-origin access", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const unauthenticated = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => unauthenticated.server.close());

  const unconfigured = await fetch(`${unauthenticated.url}/api/bootstrap`);
  assert.equal(unconfigured.status, 401);

  const authenticated = await listen(createStudioServer({
    cwd: workspace,
    authToken: "bootstrap-token",
  }));
  test.after(() => authenticated.server.close());

  const missingToken = await fetch(`${authenticated.url}/api/bootstrap`);
  assert.equal(missingToken.status, 401);

  const queryBootstrap = await fetch(`${authenticated.url}/api/bootstrap?token=bootstrap-token`);
  assert.equal(queryBootstrap.status, 401);

  const bootstrap = await fetch(`${authenticated.url}/api/bootstrap`, {
    headers: { cookie: "agentmesh_studio_token=bootstrap-token" },
  });
  assert.equal(bootstrap.status, 200);
  const payload = await bootstrap.json() as {
    schema_version: number;
    authenticated: boolean;
    workspace: string;
    api_base_url: string;
  };
  assert.deepEqual(payload, {
    schema_version: 1,
    authenticated: true,
    workspace,
    api_base_url: "",
  });
  assert.doesNotMatch(JSON.stringify(payload), /bootstrap-token/);
});

test("Studio server exposes workspace compatibility diagnostics", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeWorkspaceCompatibilityMetadata(workspace, {
    schema_version: 1,
    packet_schema_version: 1,
    min_read_runtime_version: "0.1.8",
    min_write_runtime_version: "99.0.0",
    last_writer_runtime_version: "99.0.0",
    last_writer_entrypoint: "desktop",
    updated_at: "2026-05-17T00:00:00.000Z",
  });
  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const compatibility = await fetchJson(`${url}/api/compatibility`) as {
    decision: string;
    metadata_state: string;
    current_runtime_version: string;
    current_entrypoint: string;
    metadata: { last_writer_entrypoint: string };
    reasons: string[];
  };

  assert.equal(compatibility.decision, "read_only");
  assert.equal(compatibility.metadata_state, "ok");
  assert.equal(compatibility.current_runtime_version, "0.1.13");
  assert.equal(compatibility.current_entrypoint, "cli");
  assert.equal(compatibility.metadata.last_writer_entrypoint, "desktop");
  assert.match(compatibility.reasons.join("\n"), /min_write_runtime_version 99\.0\.0/);
});

test("Studio server exposes AgentMesh update diagnostics", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  await withReleaseServer(releasePayload("0.1.14"), async (releaseUrl) => {
    const previousReleaseUrl = process.env.AGENTMESH_UPDATE_RELEASE_URL;
    process.env.AGENTMESH_UPDATE_RELEASE_URL = releaseUrl;
    const { server, url } = await listen(createStudioServer({ cwd: workspace }));
    try {
      const update = await fetchJson(`${url}/api/v1/update/check`) as {
        schema_version: number;
        current_version: string;
        latest_version: string;
        update_available: boolean;
        cli: { status: string; install_command?: string[] };
        desktop: { status: string; asset_url?: string };
      };

      assert.equal(update.schema_version, 1);
      assert.equal(update.current_version, "0.1.13");
      assert.equal(update.latest_version, "0.1.14");
      assert.equal(update.update_available, true);
      assert.equal(update.cli.status, "update_available");
      assert.deepEqual(update.cli.install_command, [
        "npm",
        "install",
        "-g",
        "https://example.invalid/agentmesh-0.1.14.tgz",
      ]);
      assert.equal(update.desktop.status, "manual_update_available");
      assert.equal(update.desktop.asset_url, "https://example.invalid/AgentMesh_0.1.14_aarch64.dmg");
    } finally {
      if (previousReleaseUrl === undefined) {
        delete process.env.AGENTMESH_UPDATE_RELEASE_URL;
      } else {
        process.env.AGENTMESH_UPDATE_RELEASE_URL = previousReleaseUrl;
      }
      server.close();
    }
  });
});

test("Studio mutation endpoint surfaces read-only compatibility as a stable UI error", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(workspace, "readonly-run", {}, []);
  writeWorkspaceCompatibilityMetadata(workspace, {
    schema_version: 1,
    packet_schema_version: 1,
    min_read_runtime_version: "0.1.8",
    min_write_runtime_version: "99.0.0",
    last_writer_runtime_version: "99.0.0",
    last_writer_entrypoint: "desktop",
    updated_at: "2026-05-17T00:00:00.000Z",
  });
  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const response = await fetch(`${url}/api/mutations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "attach",
      run_id: "readonly-run",
      stage: "plan",
      text: "must not write",
    }),
  });

  assert.equal(response.status, 409);
  const payload = await response.json() as {
    error_code?: string;
    retryable?: boolean;
    stderr?: string;
  };
  assert.equal(payload.error_code, "workspace_read_only");
  assert.equal(payload.retryable, false);
  assert.match(payload.stderr ?? "", /workspace compatibility is read-only/);
  assert.match(payload.stderr ?? "", /last writer/i);
});

test("Studio mutation endpoint surfaces refused compatibility as a stable UI error", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(workspace, "refused-run", {}, []);
  writeWorkspaceCompatibilityMetadata(workspace, {
    schema_version: 1,
    packet_schema_version: 1,
    min_read_runtime_version: "99.0.0",
    min_write_runtime_version: "99.0.0",
    last_writer_runtime_version: "99.0.0",
    last_writer_entrypoint: "desktop",
    updated_at: "2026-05-17T00:00:00.000Z",
  });
  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const response = await fetch(`${url}/api/mutations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "attach",
      run_id: "refused-run",
      stage: "plan",
      text: "must not write",
    }),
  });

  assert.equal(response.status, 409);
  const payload = await response.json() as {
    error_code?: string;
    retryable?: boolean;
    stderr?: string;
  };
  assert.equal(payload.error_code, "workspace_refused");
  assert.equal(payload.retryable, false);
  assert.match(payload.stderr ?? "", /workspace compatibility refused write/);
  assert.match(payload.stderr ?? "", /last writer desktop 99\.0\.0/);
});

test("Studio server keeps a narrow API boundary without generic command routes", async () => {
  const root = process.cwd();
  const studioSrc = path.join(root, "apps", "studio-web", "src");
  const files = readdirSync(studioSrc, { recursive: true })
    .map((file) => String(file))
    .filter((file) => /\.(ts|tsx)$/.test(file));

  assert.ok(files.length > 0);
  for (const file of files) {
    const content = readFileSync(path.join(studioSrc, file), { encoding: "utf-8" });
    assert.doesNotMatch(content, /packages\/runtime|@agentmesh\/runtime/);
  }

  const serverSource = readFileSync(path.join(root, "packages", "app-server", "src", "server.ts"), {
    encoding: "utf-8",
  });
  for (const route of ["/api/runs", "/api/catalog", "/api/mutations", "/api/compatibility"]) {
    assert.match(serverSource, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(serverSource, /\/api\/files|\/api\/command|\/api\/shell/);

  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const genericCommand = await fetch(`${url}/api/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "agentmesh" }),
  });
  assert.equal(genericCommand.status, 404);
});

test("Studio server exposes configured agents and workflows", async () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  const configPath = writeConfig(workspace);
  writeUserWorkflow(workspace);
  const presetPath = writeUserPreset(workspace);
  const { server, url } = await listen(createStudioServer({ cwd: workspace, configPath }));
  test.after(() => server.close());

  const catalog = await fetchJson(`${url}/api/catalog`) as {
    agents: Array<{
      id: string;
      label: string;
      adapter: string;
      model?: string;
      capabilities: string[];
      source_layer?: string;
    }>;
    workflows: Array<{
      workflowId: string;
      name: string;
      status: string;
      source: string;
      stages: string[];
    }>;
    presets: Array<{
      presetId: string;
      name: string;
      workflowId: string;
      description?: string;
      source: string;
      path?: string;
      stageAssignments: Record<string, string[]>;
      validationWarnings: string[];
    }>;
    mcpServers: Array<{
      id: string;
      command: string;
      args: string[];
      resource_hints: string[];
      source_layer?: string;
      source_path?: string;
    }>;
    diagnostics: Array<{ target: string; message: string }>;
  };

  const agent = catalog.agents.find((entry) => entry.id === "studio-agent");
  assert.ok(agent);
  assert.equal(agent.label, "Studio Agent");
  assert.equal(agent.adapter, "command");
  assert.equal(agent.model, "gpt-5.5");
  assert.deepEqual(agent.capabilities, ["plan", "execute", "review", "decide"]);
  assert.equal(agent.source_layer, "explicit");
  const workflow = catalog.workflows.find((entry) => entry.workflowId === "studio-visible-workflow");
  assert.ok(workflow);
  assert.equal(workflow.name, "Studio Visible Workflow");
  assert.equal(workflow.source, "user");
  assert.deepEqual(workflow.stages, ["plan", "execute", "verify", "review", "decide"]);
  const preset = catalog.presets.find((entry) => entry.presetId === "studio-review");
  assert.ok(preset);
  assert.equal(preset.name, "Studio Review");
  assert.equal(preset.workflowId, "w-9d94d0db");
  assert.equal(preset.description, "Review gate using the Studio test agent.");
  assert.equal(preset.source, "user");
  assert.equal(preset.path, realpathSync(presetPath));
  assert.deepEqual(preset.stageAssignments, {
    review: ["studio-agent"],
    decide: ["studio-agent"],
  });
  assert.deepEqual(preset.validationWarnings, []);
  const mcpServer = catalog.mcpServers.find((entry) => entry.id === "docs");
  assert.ok(mcpServer);
  assert.equal(mcpServer.command, "docs-mcp");
  assert.deepEqual(mcpServer.args, ["--stdio"]);
  assert.deepEqual(mcpServer.resource_hints, ["memory://configured"]);
  assert.equal(mcpServer.source_layer, "explicit");
  assert.equal(mcpServer.source_path, realpathSync(configPath));
  assert.deepEqual(catalog.diagnostics, []);
});

test("Studio catalog uses runtime reads without requiring a CLI artifact", () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  const configPath = writeConfig(workspace);
  writeUserWorkflow(workspace);
  writeUserPreset(workspace);

  const catalog = readStudioCatalog({
    cwd: workspace,
    configPath,
  });

  assert.equal(catalog.agents.some((agent) => agent.id === "studio-agent"), true);
  assert.equal(catalog.workflows.some((workflow) => workflow.workflowId === "studio-visible-workflow"), true);
  assert.equal(catalog.presets.some((preset) => preset.presetId === "studio-review"), true);
  assert.equal(catalog.mcpServers.some((server) => server.id === "docs"), true);
  assert.deepEqual(catalog.diagnostics, []);
});

test("Studio catalog treats a missing first-run config as an empty resource registry", () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });

  const catalog = readStudioCatalog({ cwd: workspace });

  assert.deepEqual(catalog.agents, []);
  assert.equal(catalog.workflows.length > 0, true);
  assert.deepEqual(catalog.presets, []);
  assert.deepEqual(catalog.mcpServers, []);
  assert.deepEqual(catalog.diagnostics, []);
});

test("Studio catalog surfaces missing explicit config overlays", () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  const missingConfig = path.join(workspace, "missing.toml");

  const catalog = readStudioCatalog({ cwd: workspace, configPath: missingConfig });

  assert.deepEqual(catalog.agents, []);
  assert.equal(catalog.workflows.length > 0, true);
  assert.deepEqual(catalog.mcpServers, []);
  assert.equal(catalog.diagnostics.some((diagnostic) =>
    diagnostic.target === "agents" && diagnostic.message.includes("missing.toml")), true);
  assert.equal(catalog.diagnostics.some((diagnostic) =>
    diagnostic.target === "mcp" && diagnostic.message.includes("missing.toml")), true);
});

test("Studio server exposes runtime-backed mutation endpoint", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(
    workspace,
    "server-run",
    { status: "running" },
    [
      {
        schema_version: 1,
        timestamp: "2026-05-14T00:00:00.000Z",
        event: "run.created",
      },
    ],
  );
  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const mutation = await postJson(`${url}/api/mutations`, {
    action: "attach",
    run_id: "server-run",
    stage: "plan",
    text: "server attach",
  }) as {
    command: string[];
    exit_code: number;
    stdout: string;
  };

  assert.equal(mutation.exit_code, 0);
  assert.deepEqual(mutation.command, [
    "runtime",
    "flow",
    "attach",
    "server-run",
    "--stage",
    "plan",
    "--text",
    "server attach",
  ]);
  assert.match(mutation.stdout, /Attached:/);

  const invalid = await fetch(`${url}/api/mutations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "dispatch",
      run_id: "../server-run",
      stage: "all",
    }),
  });
  assert.equal(invalid.status, 400);
});

test("Studio server preserves failed mutation stdout stderr and exit code", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(workspace, "failed-run", { status: "failed" }, []);
  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const response = await fetch(`${url}/api/mutations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "retry",
      run_id: "failed-run",
      stage: "review",
    }),
  });
  const payload = await response.json() as {
    command: string[];
    exit_code: number;
    stdout: string;
    stderr: string;
  };

  assert.equal(response.status, 409);
  assert.deepEqual(payload.command, [
    "runtime",
    "flow",
    "retry",
    "failed-run",
    "--stage",
    "review",
  ]);
  assert.equal(payload.exit_code, 1);
  assert.equal(payload.stdout, "");
  assert.match(payload.stderr, /cannot retry completed stage|stage failed|no failed stage|is not part of run/);
});

test("Studio server exposes runtime-backed agent lifecycle endpoints", async () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  const userConfigDir = path.join(workspace, ".home", ".config", "agentmesh");
  mkdirSync(userConfigDir, { recursive: true });
  const userConfigPath = path.join(userConfigDir, "config.toml");
  writeFileSync(
    userConfigPath,
    [
      "schema_version = 1",
      "",
      "[agents.studio-agent]",
      'label = "Studio Agent"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      'args = ["--version"]',
      'model = "local-model"',
      'capabilities = ["plan"]',
      "",
    ].join("\n"),
  );
  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const agents = await fetchJson(`${url}/api/v1/agents`) as {
    agents: Array<{ id: string; status: string }>;
  };
  assert.ok(
    agents.agents.map((agent) => `${agent.id}:${agent.status}`).includes("studio-agent:enabled"),
  );

  const knownModelsResponse = await fetch(`${url}/api/v1/agents/models?adapter=command`);
  assert.equal(knownModelsResponse.status, 200);
  const knownModels = await knownModelsResponse.json() as {
    adapter_id: string;
    status: string;
    models: string[];
  };
  assert.equal(knownModels.adapter_id, "command");
  assert.equal(knownModels.status, "unsupported");
  assert.deepEqual(knownModels.models, []);

  const missingModelsResponse = await fetch(`${url}/api/v1/agents/models`);
  assert.equal(missingModelsResponse.status, 400);
  assert.match(await missingModelsResponse.text(), /adapter is required/);

  const created = await postJson(`${url}/api/v1/agents`, {
    adapter: "command",
    model: "local-model",
    label: "New Agent",
    capabilities: ["plan", "review"],
    command: process.execPath,
    args: ["--version"],
  }) as { operation_id: string; command: string[]; status: string; exit_code: number; stdout: string; agent_id: string };
  assert.equal(created.status, "succeeded");
  assert.match(created.agent_id, /^a-[0-9a-f]{8}$/);
  assert.deepEqual(created.command.slice(0, 3), [
    "runtime",
    "agents",
    "add",
  ]);
  assert.deepEqual(created.command.slice(3), [
    "--adapter",
    "command",
    "--model",
    "local-model",
    "--label",
    "New Agent",
    "--capability",
    "plan",
    "--capability",
    "review",
    "--command",
    process.execPath,
    "--arg",
    "--version",
  ]);
  assert.match(created.stdout, new RegExp(`Added agent: ${created.agent_id}`));
  const configAfterCreate = readFileSync(userConfigPath, "utf-8");
  assert.match(configAfterCreate, new RegExp(`\\[agents\\.${created.agent_id}\\]`));

  const updated = await putJson(`${url}/api/v1/agents/studio-agent`, {
    adapter: "command",
    model: "local-model-updated",
    label: "Studio Agent Updated",
    capabilities: ["review"],
    command: process.execPath,
    args: ["--version"],
  }) as { operation_id: string; command: string[]; status: string; stdout: string };
  assert.equal(updated.status, "succeeded");
  assert.deepEqual(updated.command, [
    "runtime",
    "agents",
    "update",
    "studio-agent",
    "--adapter",
    "command",
    "--model",
    "local-model-updated",
    "--label",
    "Studio Agent Updated",
    "--capability",
    "review",
    "--command",
    process.execPath,
    "--arg",
    "--version",
  ]);
  assert.match(updated.stdout, /Updated agent: studio-agent/);
  const updatedConfig = readFileSync(userConfigPath, "utf-8");
  assert.match(updatedConfig, /label = "Studio Agent Updated"/);
  assert.match(updatedConfig, /model = "local-model-updated"/);
  assert.match(updatedConfig, /\[agents\.studio-agent\][\s\S]*capabilities = \[ "review" \]/);
  assert.doesNotMatch(updatedConfig, /\[agents\.renamed-studio-agent\]/);
  assert.doesNotMatch(updatedConfig, /\[agents\.studio-agent\][\s\S]*capabilities = \[ "plan" \]/);

  const disabled = await postJson(`${url}/api/v1/agents/studio-agent/disable`, {}) as { operation_id: string; command: string[]; status: string; stdout: string };
  assert.equal(disabled.status, "succeeded");
  assert.deepEqual(disabled.command, [
    "runtime",
    "agents",
    "disable",
    "studio-agent",
  ]);
  assert.match(disabled.stdout, /Disabled agent: studio-agent/);

  const operation = await fetchJson(`${url}/api/v1/agents/operations/${disabled.operation_id}`) as {
    operation_id: string;
    status: string;
  };
  assert.equal(operation.operation_id, disabled.operation_id);
  assert.equal(operation.status, "succeeded");

  const removed = await fetch(`${url}/api/v1/agents/studio-agent`, {
    method: "DELETE",
  });
  assert.equal(removed.status, 200);
  const removedPayload = await removed.json() as { command: string[]; status: string };
  assert.equal(removedPayload.status, "succeeded");
  assert.deepEqual(removedPayload.command, [
    "runtime",
    "agents",
    "remove",
    "studio-agent",
  ]);

  writeRun(
    workspace,
    "active-run",
    {
      status: "running",
      stage_assignments: {
        plan: ["studio-agent"],
      },
    },
    [],
  );
  const blockedDelete = await fetch(`${url}/api/v1/agents/studio-agent`, {
    method: "DELETE",
  });
  assert.equal(blockedDelete.status, 409);
  assert.match(await blockedDelete.text(), /agent studio-agent is assigned to active run active-run/);
});

test("Studio server exposes user advanced settings", async () => {
  const workspace = makeWorkspace();
  const previousHome = process.env.HOME;
  const home = path.join(workspace, ".home");
  process.env.HOME = home;
  test.after(() => {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(workspace, { recursive: true, force: true });
  });

  const userConfigDir = path.join(home, ".config", "agentmesh");
  mkdirSync(userConfigDir, { recursive: true });
  const userConfigPath = path.join(userConfigDir, "config.toml");
  writeFileSync(
    userConfigPath,
    [
      "schema_version = 1",
      "",
      "[agents.codex-gpt-5-5]",
      'label = "Codex GPT-5.5"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      'args = ["--version"]',
      'model = "local-model"',
      'capabilities = ["plan", "execute", "review", "decide"]',
      "",
      "[default_stage_agents.stage_types.review]",
      'agents = ["codex-gpt-5-5"]',
      "",
      "[fallback]",
      'agents = ["codex-gpt-5-5"]',
      "max_attempts_per_agent = 1",
      "",
      "[run_defaults]",
      "retry_attempts = 1",
      "",
    ].join("\n"),
  );

  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const initial = await fetchJson(`${url}/api/v1/settings/advanced`) as {
    user_config_path: string;
    user: {
      default_stage_agents: {
        stage_types: {
          review?: { agents?: string[] };
          plan?: { agents?: string[] };
          execute?: { agents?: string[] };
        };
      };
      fallback: { agents?: string[]; max_attempts_per_agent?: number };
      run_defaults: { retry_attempts?: number };
    };
    resolved: {
      fallback: { agents?: string[] };
    };
  };
  assert.equal(initial.user_config_path, userConfigPath);
  assert.deepEqual(initial.user.default_stage_agents.stage_types.review?.agents, ["codex-gpt-5-5"]);
  assert.deepEqual(initial.user.fallback.agents, ["codex-gpt-5-5"]);
  assert.equal(initial.user.fallback.max_attempts_per_agent, 1);
  assert.equal(initial.user.run_defaults.retry_attempts, 1);
  assert.deepEqual(initial.resolved.fallback.agents, ["codex-gpt-5-5"]);

  const updated = await putJson(`${url}/api/v1/settings/advanced`, {
    default_stage_agents: {
      agents: ["codex-gpt-5-5"],
      stage_types: {
        plan: { agents: ["codex-gpt-5-5"] },
        execute: { agents: ["codex-gpt-5-5"] },
        review: { agents: null },
      },
    },
    fallback: {
      agents: ["codex-gpt-5-5"],
      max_attempts_per_agent: 2,
      timeout_seconds: 900,
    },
    run_defaults: {
      retry_attempts: 3,
      adapter_timeout_secs: 600,
    },
    execution_policy: {
      allow_auto_dispatch: false,
      require_user_gate: true,
    },
  }) as {
    user: {
      default_stage_agents: {
        agents?: string[];
        stage_types: {
          plan?: { agents?: string[] };
          execute?: { agents?: string[] };
          review?: { agents?: string[] };
        };
      };
      fallback: { max_attempts_per_agent?: number; timeout_seconds?: number };
      execution_policy: { allow_auto_dispatch?: boolean; require_user_gate?: boolean };
    };
  };

  assert.deepEqual(updated.user.default_stage_agents.agents, ["codex-gpt-5-5"]);
  assert.deepEqual(updated.user.default_stage_agents.stage_types.plan?.agents, ["codex-gpt-5-5"]);
  assert.deepEqual(updated.user.default_stage_agents.stage_types.execute?.agents, ["codex-gpt-5-5"]);
  assert.equal(updated.user.default_stage_agents.stage_types.review, undefined);
  assert.equal(updated.user.fallback.max_attempts_per_agent, 2);
  assert.equal(updated.user.fallback.timeout_seconds, 900);
  assert.equal(updated.user.execution_policy.allow_auto_dispatch, false);
  assert.equal(updated.user.execution_policy.require_user_gate, true);
  const content = readFileSync(userConfigPath, "utf-8");
  assert.match(content, /\[default_stage_agents\]/);
  assert.match(content, /agents = \[ "codex-gpt-5-5" \]/);
  assert.match(content, /\[default_stage_agents\.stage_types\.plan\]/);
  assert.match(content, /\[default_stage_agents\.stage_types\.execute\]/);
  assert.doesNotMatch(content, /\[default_stage_agents\.stage_types\.review\]/);
  assert.match(content, /\[fallback\]/);
  assert.match(content, /max_attempts_per_agent = 2/);
  assert.match(content, /\[execution_policy\]/);
  assert.match(content, /allow_auto_dispatch = false/);
});

test("Studio server exposes runtime-backed workflow creation endpoint", async () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  const workflowSource = writeWorkflowSource(workspace);
  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const created = await postJson(`${url}/api/v1/workflows`, {
    workflow_file: workflowSource,
  }) as {
    operation_id: string;
    action: string;
    status: string;
    command: string[];
    stdout: string;
    workflow_id: string;
  };

  assert.equal(created.action, "create");
  assert.equal(created.status, "succeeded");
  assert.match(created.workflow_id, /^w-[0-9a-f]{8}$/);
  const createdWorkflowId = created.workflow_id;
  assert.deepEqual(created.command, [
    "runtime",
    "workflows",
    "add",
    workflowSource,
  ]);
  assert.match(created.stdout, new RegExp(`Added workflow: ${createdWorkflowId}`));
  assert.equal(
    existsSync(path.join(workspace, ".home", ".config", "agentmesh", "workflows", `${createdWorkflowId}.toml`)),
    true,
  );

  const updatedWorkflowSource = writeWorkflowSource(workspace, "studio-updated-workflow");
  const updatedWorkflowToml = readFileSync(updatedWorkflowSource, { encoding: "utf-8" })
    .replace("Studio Created Workflow", "Studio Updated Workflow");
  const updated = await putJson(`${url}/api/v1/workflows/${createdWorkflowId}`, {
    workflow_toml: updatedWorkflowToml,
    source_name: "studio-updated-workflow.toml",
  }) as {
    action: string;
    status: string;
    command: string[];
    workflow_id: string;
    stdout: string;
  };
  assert.equal(updated.action, "update");
  assert.equal(updated.status, "succeeded");
  assert.equal(updated.workflow_id, createdWorkflowId);
  assert.deepEqual(updated.command, [
    "runtime",
    "workflows",
    "update",
    createdWorkflowId,
    "uploaded:studio-updated-workflow.toml",
  ]);
  assert.match(updated.stdout, new RegExp(`Updated workflow: ${createdWorkflowId}`));
  assert.match(
    readFileSync(path.join(workspace, ".home", ".config", "agentmesh", "workflows", `${createdWorkflowId}.toml`), "utf-8"),
    /Studio Updated Workflow/,
  );
  const scopedDelete = await fetch(`${url}/api/v1/workflows/${createdWorkflowId}?scope=project`, {
    method: "DELETE",
  });
  assert.equal(scopedDelete.status, 400);
  assert.match(await scopedDelete.text(), /workflow scope is not supported/);
  assert.equal(
    existsSync(path.join(workspace, ".home", ".config", "agentmesh", "workflows", `${createdWorkflowId}.toml`)),
    true,
  );
  const deleted = await deleteJson(`${url}/api/v1/workflows/${createdWorkflowId}`) as {
    action: string;
    status: string;
    command: string[];
    workflow_id: string;
    stdout: string;
  };
  assert.equal(deleted.action, "delete");
  assert.equal(deleted.status, "succeeded");
  assert.equal(deleted.workflow_id, createdWorkflowId);
  assert.deepEqual(deleted.command, [
    "runtime",
    "workflows",
    "remove",
    createdWorkflowId,
  ]);
  assert.match(deleted.stdout, new RegExp(`Removed workflow: ${createdWorkflowId}`));
  assert.equal(
    existsSync(path.join(workspace, ".home", ".config", "agentmesh", "workflows", `${createdWorkflowId}.toml`)),
    false,
  );

  const uploadedWorkflowSource = writeWorkflowSource(workspace, "studio-uploaded-workflow");
  const uploaded = await postJson(`${url}/api/v1/workflows`, {
    workflow_toml: readFileSync(uploadedWorkflowSource, { encoding: "utf-8" }),
    source_name: "studio-uploaded-workflow.toml",
  }) as {
    status: string;
    command: string[];
    workflow_id: string;
  };
  assert.equal(uploaded.status, "succeeded");
  assert.match(uploaded.workflow_id, /^w-[0-9a-f]{8}$/);
  const uploadedWorkflowId = uploaded.workflow_id;
  assert.deepEqual(uploaded.command, [
    "runtime",
    "workflows",
    "add",
    "uploaded:studio-uploaded-workflow.toml",
  ]);
  assert.equal(
    existsSync(path.join(workspace, ".home", ".config", "agentmesh", "workflows", `${uploadedWorkflowId}.toml`)),
    true,
  );

  const catalog = await fetchJson(`${url}/api/catalog`) as {
    workflows: Array<{ workflowId: string; source: string }>;
  };
  const catalogWorkflow = catalog.workflows.find((workflow) => workflow.workflowId === uploadedWorkflowId);
  assert.ok(catalogWorkflow);
  assert.equal(catalogWorkflow.source, "user");

  const secondCreate = await postJson(`${url}/api/v1/workflows`, {
    workflow_file: workflowSource,
  }) as { status: string; workflow_id: string };
  assert.equal(secondCreate.status, "succeeded");
  assert.match(secondCreate.workflow_id, /^w-[0-9a-f]{8}$/);
  assert.notEqual(secondCreate.workflow_id, createdWorkflowId);
});

test("Studio server exposes runtime-backed preset creation endpoint", async () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  const presetSource = writePresetSource(workspace);
  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const created = await postJson(`${url}/api/v1/presets`, {
    preset_file: presetSource,
  }) as {
    operation_id: string;
    action: string;
    status: string;
    command: string[];
    stdout: string;
    preset_id: string;
  };

  assert.equal(created.action, "create");
  assert.equal(created.status, "succeeded");
  assert.match(created.preset_id, /^p-[0-9a-f]{8}$/);
  const createdPresetId = created.preset_id;
  assert.deepEqual(created.command, [
    "runtime",
    "preset",
    "add",
    presetSource,
  ]);
  assert.match(created.stdout, new RegExp(`Added preset: ${createdPresetId}`));
  assert.equal(
    existsSync(path.join(workspace, ".home", ".config", "agentmesh", "presets", `${createdPresetId}.toml`)),
    true,
  );

  const updatedPresetSource = writePresetSource(workspace, "studio-updated-preset");
  const updatedPresetToml = readFileSync(updatedPresetSource, { encoding: "utf-8" })
    .replace("Studio Created Preset", "Studio Updated Preset");
  const updated = await putJson(`${url}/api/v1/presets/${createdPresetId}`, {
    preset_toml: updatedPresetToml,
    source_name: "studio-updated-preset.toml",
  }) as {
    action: string;
    status: string;
    command: string[];
    preset_id: string;
    stdout: string;
  };
  assert.equal(updated.action, "update");
  assert.equal(updated.status, "succeeded");
  assert.equal(updated.preset_id, createdPresetId);
  assert.deepEqual(updated.command, [
    "runtime",
    "preset",
    "update",
    createdPresetId,
    "uploaded:studio-updated-preset.toml",
  ]);
  assert.match(updated.stdout, new RegExp(`Updated preset: ${createdPresetId}`));
  assert.match(
    readFileSync(path.join(workspace, ".home", ".config", "agentmesh", "presets", `${createdPresetId}.toml`), "utf-8"),
    /Studio Updated Preset/,
  );
  const scopedDelete = await fetch(`${url}/api/v1/presets/${createdPresetId}?project_dir=/tmp/project`, {
    method: "DELETE",
  });
  assert.equal(scopedDelete.status, 400);
  assert.match(await scopedDelete.text(), /preset scope is not supported/);
  assert.equal(
    existsSync(path.join(workspace, ".home", ".config", "agentmesh", "presets", `${createdPresetId}.toml`)),
    true,
  );
  const deleted = await deleteJson(`${url}/api/v1/presets/${createdPresetId}`) as {
    action: string;
    status: string;
    command: string[];
    preset_id: string;
    stdout: string;
  };
  assert.equal(deleted.action, "delete");
  assert.equal(deleted.status, "succeeded");
  assert.equal(deleted.preset_id, createdPresetId);
  assert.deepEqual(deleted.command, [
    "runtime",
    "preset",
    "remove",
    createdPresetId,
  ]);
  assert.match(deleted.stdout, new RegExp(`Removed preset: ${createdPresetId}`));
  assert.equal(
    existsSync(path.join(workspace, ".home", ".config", "agentmesh", "presets", `${createdPresetId}.toml`)),
    false,
  );

  const uploadedPresetSource = writePresetSource(workspace, "studio-uploaded-preset");
  const uploaded = await postJson(`${url}/api/v1/presets`, {
    preset_toml: readFileSync(uploadedPresetSource, { encoding: "utf-8" }),
    source_name: "studio-uploaded-preset.toml",
  }) as {
    status: string;
    command: string[];
    preset_id: string;
  };
  assert.equal(uploaded.status, "succeeded");
  assert.match(uploaded.preset_id, /^p-[0-9a-f]{8}$/);
  const uploadedPresetId = uploaded.preset_id;
  assert.deepEqual(uploaded.command, [
    "runtime",
    "preset",
    "add",
    "uploaded:studio-uploaded-preset.toml",
  ]);
  assert.equal(
    existsSync(path.join(workspace, ".home", ".config", "agentmesh", "presets", `${uploadedPresetId}.toml`)),
    true,
  );

  const catalog = await fetchJson(`${url}/api/catalog`) as {
    presets: Array<{ presetId: string; name: string; source: string }>;
  };
  const catalogPreset = catalog.presets.find((preset) => preset.presetId === uploadedPresetId);
  assert.ok(catalogPreset);
  assert.equal(catalogPreset.source, "user");

  const secondCreate = await postJson(`${url}/api/v1/presets`, {
    preset_file: presetSource,
  }) as { status: string; preset_id: string };
  assert.equal(secondCreate.status, "succeeded");
  assert.match(secondCreate.preset_id, /^p-[0-9a-f]{8}$/);
  assert.notEqual(secondCreate.preset_id, createdPresetId);
});

test("Studio workflow and preset command traces use global user registries", () => {
  const configPath = path.join(tmpdir(), "agentmesh-config.toml");

  assert.deepEqual(
    studioWorkflowLifecycleCommand({
      action: "create",
      create: {
        workflow_toml: "workflow_id = \"trace-workflow\"",
        source_name: "trace-workflow.toml",
      },
    }, { configPath }),
    [
      "runtime",
      "workflows",
      "add",
      "uploaded:trace-workflow.toml",
      "--config",
      configPath,
    ],
  );
  assert.deepEqual(
    studioWorkflowLifecycleCommand({
      action: "update",
      workflowId: "w-12345678",
      update: {
        workflow_toml: "name = \"Trace Workflow\"",
        source_name: "trace-workflow.toml",
      },
    }, { configPath }),
    [
      "runtime",
      "workflows",
      "update",
      "w-12345678",
      "uploaded:trace-workflow.toml",
      "--config",
      configPath,
    ],
  );
  assert.deepEqual(
    studioWorkflowLifecycleCommand({
      action: "delete",
      workflowId: "w-12345678",
    }, { configPath }),
    [
      "runtime",
      "workflows",
      "remove",
      "w-12345678",
      "--config",
      configPath,
    ],
  );
  assert.deepEqual(
    studioPresetLifecycleCommand({
      action: "create",
      create: {
        preset_toml: "preset_id = \"trace-preset\"",
        source_name: "trace-preset.toml",
      },
    }, { configPath }),
    [
      "runtime",
      "preset",
      "add",
      "uploaded:trace-preset.toml",
      "--config",
      configPath,
    ],
  );
  assert.deepEqual(
    studioPresetLifecycleCommand({
      action: "update",
      presetId: "p-12345678",
      update: {
        preset_toml: "schema_version = 1",
        source_name: "trace-preset.toml",
      },
    }, { configPath }),
    [
      "runtime",
      "preset",
      "update",
      "p-12345678",
      "uploaded:trace-preset.toml",
      "--config",
      configPath,
    ],
  );
  assert.deepEqual(
    studioPresetLifecycleCommand({
      action: "delete",
      presetId: "p-12345678",
    }, { configPath }),
    [
      "runtime",
      "preset",
      "remove",
      "p-12345678",
      "--config",
      configPath,
    ],
  );
});

test("Studio agent lifecycle failures are stored as failed operations", async () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  const userConfigDir = path.join(workspace, ".home", ".config", "agentmesh");
  mkdirSync(userConfigDir, { recursive: true });
  writeFileSync(
    path.join(userConfigDir, "config.toml"),
    [
      "schema_version = 1",
      "",
      "[agents.broken",
      "",
    ].join("\n"),
  );
  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  test.after(() => server.close());

  const response = await fetch(`${url}/api/v1/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_id: "new-agent",
      adapter: "command",
      model: "local-model",
      command: process.execPath,
      args: ["--version"],
    }),
  });
  assert.equal(response.status, 422);
  const failed = await response.json() as {
    operation_id: string;
    status: string;
    exit_code: number;
    stderr: string;
  };
  assert.equal(failed.status, "failed");
  assert.equal(failed.exit_code, 1);
  assert.ok(failed.stderr.trim().length > 0);

  const operation = await fetchJson(`${url}/api/v1/agents/operations/${failed.operation_id}`) as {
    operation_id: string;
    status: string;
    stderr: string;
  };
  assert.equal(operation.operation_id, failed.operation_id);
  assert.equal(operation.status, "failed");
  assert.equal(operation.stderr, failed.stderr);
});

test("Studio agent model endpoint discovers provider CLIs outside PATH", async () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  const home = process.env.HOME as string;
  const opencodePath = writeFakeProviderCli(
    path.join(home, ".opencode", "bin"),
    "opencode",
    "zhuanzhuan/deepseek-v4-pro",
  );
  const previousPath = process.env.PATH;
  const previousShell = process.env.SHELL;
  process.env.PATH = "";
  process.env.SHELL = path.join(workspace, "missing-shell");
  const { server, url } = await listen(createStudioServer({ cwd: workspace }));
  try {
    const models = await fetchJson(`${url}/api/v1/agents/models?adapter=opencode-cli`) as {
      adapter_id: string;
      status: string;
      models: string[];
      command?: string[];
    };
    assert.equal(models.adapter_id, "opencode-cli");
    assert.equal(models.status, "discovered");
    assert.deepEqual(models.models, ["zhuanzhuan/deepseek-v4-pro"]);
    assert.deepEqual(models.command, [opencodePath, "models"]);
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    if (previousShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = previousShell;
    }
    server.close();
  }
});

test("Studio agent lifecycle discovers provider CLIs outside PATH during update", async () => {
  const workspace = makeWorkspace();
  const restoreHome = isolateHome(workspace);
  test.after(() => {
    restoreHome();
    rmSync(workspace, { recursive: true, force: true });
  });
  const home = process.env.HOME as string;
  const userConfigDir = path.join(home, ".config", "agentmesh");
  mkdirSync(userConfigDir, { recursive: true });
  writeFakeProviderCli(path.join(home, ".local", "bin"), "claude", "claude-opus-4-7");
  writeFileSync(
    path.join(userConfigDir, "config.toml"),
    [
      "schema_version = 1",
      "",
      "[agents.claude-agent]",
      'label = "Claude Agent"',
      'adapter = "claude-code-cli"',
      'command = "claude"',
      'args = ["-p"]',
      'model = "claude-opus-4-7"',
      'reasoning_effort = "high"',
      'capabilities = ["plan"]',
      "",
    ].join("\n"),
  );
  const previousPath = process.env.PATH;
  const previousShell = process.env.SHELL;
  process.env.PATH = "";
  process.env.SHELL = path.join(workspace, "missing-shell");
  let server: Server | undefined;
  try {
    const started = await listen(createStudioServer({ cwd: workspace }));
    server = started.server;
    const response = await fetch(`${started.url}/api/v1/agents/claude-agent`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        adapter: "claude-code-cli",
        model: "claude-opus-4-7",
        label: "Claude Agent Updated",
        capabilities: ["plan", "execute"],
        reasoning_effort: "high",
      }),
    });
    const updated = await response.json() as {
      status: string;
      exit_code: number;
      stdout: string;
      stderr: string;
    };

    assert.equal(response.status, 200, updated.stderr);
    assert.equal(updated.status, "succeeded");
    assert.equal(updated.exit_code, 0);
    assert.match(updated.stdout, /Updated agent: claude-agent/);
    assert.equal(updated.stderr, "");
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    if (previousShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = previousShell;
    }
    server?.close();
  }
});

async function listen(server: Server): Promise<{ server: Server; url: string }> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://${address.address}:${address.port}`,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.text();
}

async function withReleaseServer(
  payload: unknown,
  fn: (releaseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    await fn(`http://${address.address}:${address.port}/latest`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function releasePayload(version: string): unknown {
  return {
    tag_name: `v${version}`,
    html_url: `https://example.invalid/releases/tag/v${version}`,
    assets: [
      {
        name: `agentmesh-${version}.tgz`,
        browser_download_url: `https://example.invalid/agentmesh-${version}.tgz`,
      },
      {
        name: `AgentMesh_${version}_aarch64.dmg`,
        browser_download_url: `https://example.invalid/AgentMesh_${version}_aarch64.dmg`,
      },
    ],
  };
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function putJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function deleteJson(url: string): Promise<unknown> {
  const response = await fetch(url, { method: "DELETE" });
  assert.equal(response.status, 200);
  return response.json();
}
