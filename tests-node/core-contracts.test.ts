import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AdapterCapabilityMetadataSchema,
  AdapterFailureClassificationSchema,
  AdapterInvocationInputSchema,
  AdapterInvocationOutputSchema,
  BUILTIN_WORKFLOW_IDS,
  CorrectionRecordSchema,
  CorrectionStatusSchema,
  CURRENT_PACKET_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  ContextProvenanceSchema,
  DEFAULT_INVOCATION_TIMEOUT_SECONDS,
  MAX_FALLBACK_AGENTS,
  MAX_FALLBACK_ATTEMPTS_PER_AGENT,
  MAX_FANOUT_AGENTS,
  MAX_INVOCATION_TIMEOUT_SECONDS,
  McpFailureClassificationSchema,
  MIN_INVOCATION_TIMEOUT_SECONDS,
  PacketArtifactManifestSchema,
  PacketEventSchema,
  PacketStatusSchema,
  ProjectSpecSchema,
  ReleaseGateResultSchema,
  ReleaseVerdictSchema,
  RuntimeTimingSchema,
  REVIEWER_SESSION_ATTEMPT_MODES,
  REVIEW_SESSION_MODES,
  ReviewerSessionAttemptModeSchema,
  ReviewSessionModeSchema,
  STAGE_STATES,
  StageAttemptSchema,
  StageNodeSchema,
  StageTypeSchema,
  WorkflowSchema,
  assertSupportedPacketSchemaVersion,
  assertSupportedSchemaVersion,
  deriveStageNodes,
  stageNodesForStatus,
} from "../packages/core/src/index.js";
import { parseTomlDocument } from "../packages/runtime/src/toml.js";

function packetStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const stages = (overrides.stages as string[] | undefined) ?? [
    "plan",
    "execute",
    "review",
    "decide",
  ];
  const stageNodes = (overrides.stage_nodes as ReturnType<typeof deriveStageNodes> | undefined)
    ?? deriveStageNodes(stages);
  return {
    schema_version: CURRENT_PACKET_SCHEMA_VERSION,
    run_id: "contract-smoke",
    created_at: "2026-05-14T00:00:00.000Z",
    updated_at: "2026-05-14T00:00:00.000Z",
    status: "running",
    stages,
    stage_nodes: stageNodes,
    completed_stages: [],
    stage_state: Object.fromEntries(stageNodes.map((node) => [node.id, "planned"])),
    stage_assignments: Object.fromEntries(stageNodes.map((node) => [node.id, ["current"]])),
    stage_invocations: Object.fromEntries(stageNodes.map((node) => [
      node.id,
      [{
        lane_id: `${node.id}:current`,
        kind: "current",
        agent: "current",
        timeout_seconds: null,
      }],
    ])),
    stage_failure_policies: Object.fromEntries(stageNodes.map((node) => [
      node.id,
      { mode: "allow", max_fallback_agents: 1 },
    ])),
    stage_fallbacks: Object.fromEntries(stageNodes.map((node) => [
      node.id,
      { agents: [], max_attempts_per_agent: 1 },
    ])),
    stage_attempts: Object.fromEntries(stageNodes.map((node) => [node.id, []])),
    assignment_provenance: Object.fromEntries(stageNodes.map((node) => [node.id, "test"])),
    fallback_provenance: Object.fromEntries(stageNodes.map((node) => [node.id, "none"])),
    timeout_provenance: Object.fromEntries(stageNodes.map((node) => [node.id, {}])),
    stage_timing: Object.fromEntries(stageNodes.map((node) => [node.id, { attempt_count: 0 }])),
    agent_timing: {},
    user_gate: false,
    ...overrides,
  };
}

test("core exports packet contract schemas with schema version policy", () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 1);
  assert.equal(CURRENT_PACKET_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
  assert.equal(MAX_FANOUT_AGENTS, 6);
  assert.equal(MAX_FALLBACK_AGENTS, 3);
  assert.equal(MAX_FALLBACK_ATTEMPTS_PER_AGENT, 2);
  assert.equal(DEFAULT_INVOCATION_TIMEOUT_SECONDS, 900);
  assert.equal(MIN_INVOCATION_TIMEOUT_SECONDS, 30);
  assert.equal(MAX_INVOCATION_TIMEOUT_SECONDS, 3600);
  assert.deepEqual(assertSupportedSchemaVersion(1, "status.json"), 1);
  assert.throws(
    () => assertSupportedSchemaVersion(2, "status.json"),
    /status\.json\.schema_version 2 is newer than supported version 1/,
  );
  assert.deepEqual(assertSupportedPacketSchemaVersion(CURRENT_SCHEMA_VERSION, "status.json"), CURRENT_SCHEMA_VERSION);
  assert.throws(
    () => assertSupportedPacketSchemaVersion(CURRENT_SCHEMA_VERSION + 1, "status.json"),
    /unsupported packet schema version: 2/,
  );

  const status = PacketStatusSchema.parse(packetStatus({
    completed_stages: ["plan"],
    stage_timing: {
      plan: {
        started_at: "2026-05-14T00:00:00.000Z",
        completed_at: "2026-05-14T00:00:01.000Z",
        duration_ms: 1000,
        attempt_count: 1,
      },
      execute: { attempt_count: 0 },
      review: { attempt_count: 0 },
      decide: { attempt_count: 0 },
    },
    agent_timing: {
      plan: {
        planner: {
          started_at: "2026-05-14T00:00:00.000Z",
          completed_at: "2026-05-14T00:00:01.000Z",
          duration_ms: 1000,
          attempt_count: 1,
          adapter_spawn_ms: 50,
          agent_total_ms: 75,
          total_ms: 75,
        },
      },
    },
    runtime_timing: {
      config_load_ms: 12,
      mcp_connect_ms: 34,
      mcp_cache_hits: 1,
      mcp_cache_misses: 2,
      total_ms: 56,
    },
    user_gate: false,
    release_verdict: {
      value: "needs_decision",
      diagnostic: "human decision required",
    },
  }));
  assert.equal(status.title, undefined);
  assert.equal(PacketStatusSchema.parse(packetStatus({ title: "优化活动列表" })).title, "优化活动列表");
  assert.equal(status.release_verdict?.value, "needs_decision");
  assert.equal(status.stage_timing.plan.attempt_count, 1);
  assert.equal(status.agent_timing.plan.planner.duration_ms, 1000);
  assert.equal(status.agent_timing.plan.planner.adapter_spawn_ms, 50);
  assert.equal(status.runtime_timing?.config_load_ms, 12);
  assert.equal(status.runtime_timing?.mcp_cache_misses, 2);
  assert.equal(status.stage_invocations.plan[0]?.kind, "current");
  assert.equal(status.stage_failure_policies.plan.mode, "allow");
  assert.equal(RuntimeTimingSchema.parse({ total_ms: 1 }).total_ms, 1);
  assert.throws(() =>
    PacketStatusSchema.parse(packetStatus({
      stage_failure_policies: {
        plan: { mode: "allow", max_fallback_agents: 1, foo: "bar" },
        execute: { mode: "allow", max_fallback_agents: 1 },
        review: { mode: "allow", max_fallback_agents: 1 },
        decide: { mode: "allow", max_fallback_agents: 1 },
      },
    })),
  );

  const timedOutAttemptStatus = PacketStatusSchema.parse(packetStatus({
    stage_assignments: { plan: ["planner"], execute: ["current"], review: ["current"], decide: ["current"] },
    stage_invocations: {
      plan: [{ lane_id: "plan:planner", kind: "primary", agent: "planner", timeout_seconds: 30 }],
      execute: [{ lane_id: "execute:current", kind: "current", agent: "current", timeout_seconds: null }],
      review: [{ lane_id: "review:current", kind: "current", agent: "current", timeout_seconds: null }],
      decide: [{ lane_id: "decide:current", kind: "current", agent: "current", timeout_seconds: null }],
    },
    stage_attempts: {
      plan: [{
        lane_id: "plan:planner",
        primary_agent: "planner",
        requested_agent: "planner",
        actual_agent: "planner",
        lane_attempt: 1,
        attempt: 1,
        timeout_seconds: 30,
        status: "timed_out",
      }],
      execute: [],
      review: [],
      decide: [],
    },
  }));
  assert.equal(timedOutAttemptStatus.stage_attempts.plan[0]?.status, "timed_out");
  assert.throws(() =>
    PacketStatusSchema.parse(packetStatus({
      stage_invocations: {
        plan: [{ lane_id: "plan:current", kind: "current", agent: "current", timeout_seconds: 0 }],
        execute: [{ lane_id: "execute:current", kind: "current", agent: "current", timeout_seconds: null }],
        review: [{ lane_id: "review:current", kind: "current", agent: "current", timeout_seconds: null }],
        decide: [{ lane_id: "decide:current", kind: "current", agent: "current", timeout_seconds: null }],
      },
    })),
  );

  const event = PacketEventSchema.parse({
    schema_version: 1,
    timestamp: "2026-05-14T00:00:00.000Z",
    event: "stage.completed",
    stage: "plan",
  });
  assert.equal(event.stage, "plan");

  const manifest = PacketArtifactManifestSchema.parse({
    schema_version: 1,
    artifacts: {
      plan: {
        path: "plan.md",
        kind: "markdown",
        stage: "plan",
      },
    },
  });
  assert.equal(manifest.artifacts.plan.path, "plan.md");

  assert.deepEqual(STAGE_STATES, [
    "planned",
    "running",
    "completed",
    "failed",
    "skipped",
    "needs_decision",
    "handoff_ready",
  ]);
});

test("core exports workflow and release verdict schemas", () => {
  const workflow = WorkflowSchema.parse({
    schema_version: 1,
    workflow_recipe_version: 1,
    compatible_packet_schema_versions: [CURRENT_PACKET_SCHEMA_VERSION],
    name: "Bug Fix",
    stages: ["plan", "execute", "review", "decide"],
    user_gate: true,
  });
  assert.equal(BUILTIN_WORKFLOW_IDS.BUG_FIX, "w-7db15660");
  assert.deepEqual(workflow.compatible_packet_schema_versions, [CURRENT_PACKET_SCHEMA_VERSION]);
  assert.throws(() =>
    WorkflowSchema.parse({
      schema_version: 1,
      workflow_recipe_version: 1,
      compatible_packet_schema_versions: [CURRENT_PACKET_SCHEMA_VERSION],
      id: "bug-fix",
      name: "Bug Fix",
      stages: ["plan", "execute", "review", "decide"],
    }),
  );
  assert.throws(() =>
    WorkflowSchema.parse({
      schema_version: 1,
      workflow_recipe_version: 1,
      compatible_packet_schema_versions: [CURRENT_PACKET_SCHEMA_VERSION, CURRENT_PACKET_SCHEMA_VERSION + 1],
      id: "mixed-packet",
      stages: ["review", "decide"],
    }),
  );
  assert.throws(() =>
    WorkflowSchema.parse({
      schema_version: 1,
      id: "missing-version",
      stages: ["review", "decide"],
    }),
  );

  assert.equal(ReleaseVerdictSchema.parse("ready"), "ready");
  assert.equal(ReleaseVerdictSchema.parse("not_ready"), "not_ready");
  assert.equal(ReleaseVerdictSchema.parse("needs_decision"), "needs_decision");
  assert.throws(() => ReleaseVerdictSchema.parse("maybe"));

  const gate = ReleaseGateResultSchema.parse({
    schema_version: 1,
    verdict: "ready",
    decision_file: "decision.md",
    release_summary_file: "release-summary.md",
  });
  assert.equal(gate.verdict, "ready");
});

test("core derives stable stage nodes for repeated workflow stages", () => {
  assert.equal(StageTypeSchema.parse("execute"), "execute");
  assert.equal(StageTypeSchema.parse("verify"), "verify");
  assert.deepEqual(deriveStageNodes(["review", "review", "review"]), [
    { id: "review", type: "review", occurrence: 1 },
    { id: "review_2", type: "review", occurrence: 2 },
    { id: "review_3", type: "review", occurrence: 3 },
  ]);
  assert.deepEqual(
    deriveStageNodes(["plan", "execute", "verify", "review", "verify", "decide"]),
    [
      { id: "plan", type: "plan", occurrence: 1 },
      { id: "execute", type: "execute", occurrence: 1 },
      { id: "verify", type: "verify", occurrence: 1 },
      { id: "review", type: "review", occurrence: 1 },
      { id: "verify_2", type: "verify", occurrence: 2 },
      { id: "decide", type: "decide", occurrence: 1 },
    ],
  );
  assert.deepEqual(
    deriveStageNodes(["plan", "execute", "review", "execute", "review", "decide"]),
    [
      { id: "plan", type: "plan", occurrence: 1 },
      { id: "execute", type: "execute", occurrence: 1 },
      { id: "review", type: "review", occurrence: 1 },
      { id: "execute_2", type: "execute", occurrence: 2 },
      { id: "review_2", type: "review", occurrence: 2 },
      { id: "decide", type: "decide", occurrence: 1 },
    ],
  );
  assert.equal(deriveStageNodes(["plan"]).length, 1);
  assert.equal(
    deriveStageNodes([
      "plan",
      "execute",
      "review",
      "execute",
      "review",
      "plan",
      "execute",
      "review",
      "plan",
      "execute",
      "review",
      "plan",
      "execute",
      "review",
      "decide",
    ]).length,
    15,
  );
  assert.throws(() => deriveStageNodes([]), /workflow must contain at least 1 stage node/);
  assert.throws(
    () =>
      deriveStageNodes([
        "plan",
        "execute",
        "review",
        "execute",
        "review",
        "plan",
        "execute",
        "review",
        "plan",
        "execute",
        "review",
        "plan",
        "execute",
        "review",
        "plan",
        "decide",
      ]),
    /workflow must contain at most 15 stage nodes/,
  );
  assert.throws(
    () => deriveStageNodes(["plan", "deploy" as never]),
    /unsupported stage type 'deploy'/,
  );
  assert.throws(
    () => deriveStageNodes(["decide", "review"]),
    /decide must not be the first stage node/,
  );
  assert.throws(
    () => deriveStageNodes(["plan", "decide", "decide"]),
    /decide must not immediately follow decide/,
  );
  assert.deepEqual(
    deriveStageNodes(["plan", "decide", "execute", "review", "decide"]),
    [
      { id: "plan", type: "plan", occurrence: 1 },
      { id: "decide", type: "decide", occurrence: 1 },
      { id: "execute", type: "execute", occurrence: 1 },
      { id: "review", type: "review", occurrence: 1 },
      { id: "decide_2", type: "decide", occurrence: 2 },
    ],
  );

  assert.equal(
    StageNodeSchema.parse({ id: "execute_2", type: "execute", occurrence: 2 }).id,
    "execute_2",
  );
});

test("packet status schema validates mutable stage state against stage node ids", () => {
  const stages = ["plan", "execute", "review", "execute", "review", "decide"];
  const nodes = deriveStageNodes(stages);
  const status = PacketStatusSchema.parse(packetStatus({
    run_id: "repeated-status",
    status: "execute_2_failed",
    stages,
    stage_nodes: nodes,
    completed_stages: ["plan", "execute", "review"],
    failed_stage: "execute_2",
    stage_state: Object.fromEntries(nodes.map((node) => [node.id, "planned"])),
    stage_assignments: Object.fromEntries(nodes.map((node) => [node.id, ["current"]])),
    stage_timing: Object.fromEntries(nodes.map((node) => [node.id, { attempt_count: 0 }])),
  }));
  assert.equal(status.failed_stage, "execute_2");

  assert.throws(() =>
    PacketStatusSchema.parse(packetStatus({
      run_id: "missing-stage-nodes",
      stage_nodes: undefined,
    })),
  );

  assert.deepEqual(
    stageNodesForStatus({
      stages: ["plan", "execute", "review"],
    }),
    [
      { id: "plan", type: "plan", occurrence: 1 },
      { id: "execute", type: "execute", occurrence: 1 },
      { id: "review", type: "review", occurrence: 1 },
    ],
  );

  assert.throws(() =>
    PacketStatusSchema.parse(packetStatus({
      run_id: "bad-completed-stage",
      stages: ["plan", "execute"],
      stage_nodes: deriveStageNodes(["plan", "execute"]),
      completed_stages: ["execute_2"],
      stage_state: { plan: "planned", execute: "planned" },
      stage_assignments: { plan: ["current"], execute: ["current"] },
      stage_timing: { plan: { attempt_count: 0 }, execute: { attempt_count: 0 } },
    })),
  );
  assert.throws(() =>
    PacketStatusSchema.parse(packetStatus({
      run_id: "bad-failed-stage",
      stages: ["plan", "execute"],
      stage_nodes: deriveStageNodes(["plan", "execute"]),
      completed_stages: [],
      failed_stage: "missing_node",
      stage_state: { plan: "planned", execute: "planned" },
      stage_assignments: { plan: ["current"], execute: ["current"] },
      stage_timing: { plan: { attempt_count: 0 }, execute: { attempt_count: 0 } },
    })),
  );
  assert.throws(() =>
    PacketStatusSchema.parse(packetStatus({
      run_id: "empty-stage-nodes",
      stages: ["plan", "execute"],
      stage_nodes: [],
      completed_stages: [],
      stage_state: {},
      stage_assignments: {},
      stage_timing: {},
    })),
  );
  assert.throws(() =>
    PacketStatusSchema.parse(packetStatus({
      run_id: "duplicate-stage-nodes",
      stages: ["plan", "execute"],
      stage_nodes: [
        { id: "execute", type: "execute", occurrence: 1 },
        { id: "execute", type: "execute", occurrence: 1 },
      ],
      completed_stages: [],
      stage_state: { execute: "planned" },
      stage_assignments: { execute: ["current"] },
      stage_timing: { execute: { attempt_count: 0 } },
    })),
  );
  assert.throws(() =>
    PacketStatusSchema.parse(packetStatus({
      run_id: "mismatched-stage-nodes",
      stages: ["plan", "execute"],
      stage_nodes: [{ id: "review", type: "review", occurrence: 1 }],
      completed_stages: ["review"],
      stage_state: { review: "planned" },
      stage_assignments: { review: ["current"] },
      stage_timing: { review: { attempt_count: 0 } },
    })),
  );
  assert.throws(() =>
    PacketStatusSchema.parse(packetStatus({
      run_id: "bad-stage-state",
      stages: ["plan", "execute"],
      stage_nodes: deriveStageNodes(["plan", "execute"]),
      completed_stages: [],
      stage_state: { execute_2: "completed" },
      stage_assignments: { plan: ["current"], execute: ["current"] },
      stage_timing: { plan: { attempt_count: 0 }, execute: { attempt_count: 0 } },
    })),
  );
  assert.throws(() =>
    PacketStatusSchema.parse(packetStatus({
      run_id: "bad-stage-assignment",
      stages: ["plan", "execute"],
      stage_nodes: deriveStageNodes(["plan", "execute"]),
      completed_stages: [],
      stage_state: { plan: "planned", execute: "planned" },
      stage_assignments: { execute_2: ["worker"] },
      stage_timing: { plan: { attempt_count: 0 }, execute: { attempt_count: 0 } },
    })),
  );
  assert.throws(() =>
    PacketStatusSchema.parse(packetStatus({
      run_id: "missing-stage-assignment",
      stages: ["plan", "execute"],
      stage_nodes: deriveStageNodes(["plan", "execute"]),
      completed_stages: [],
      stage_state: { plan: "planned", execute: "planned" },
      stage_assignments: { plan: ["current"] },
      stage_invocations: {
        plan: [{ lane_id: "plan:current", kind: "current", agent: "current", timeout_seconds: null }],
        execute: [{ lane_id: "execute:current", kind: "current", agent: "current", timeout_seconds: null }],
      },
      stage_timing: { plan: { attempt_count: 0 }, execute: { attempt_count: 0 } },
    })),
  );
  assert.throws(() =>
    PacketStatusSchema.parse(packetStatus({
      run_id: "missing-stage-timing",
      stages: ["plan", "execute"],
      stage_nodes: deriveStageNodes(["plan", "execute"]),
      stage_state: { plan: "planned", execute: "planned" },
      stage_assignments: { plan: ["current"], execute: ["current"] },
      stage_timing: { plan: { attempt_count: 0 } },
    })),
  );
  assert.throws(() =>
    PacketStatusSchema.parse(packetStatus({
      run_id: "bad-agent-timing",
      stages: ["plan", "execute"],
      stage_nodes: deriveStageNodes(["plan", "execute"]),
      stage_state: { plan: "planned", execute: "planned" },
      stage_assignments: { plan: ["current"], execute: ["current"] },
      stage_timing: { plan: { attempt_count: 0 }, execute: { attempt_count: 0 } },
      agent_timing: { execute_2: { worker: { attempt_count: 1 } } },
    })),
  );
});

test("core exports context provenance schema", () => {
  const provenance = ContextProvenanceSchema.parse({
    schema_version: 1,
    source_type: "scoped_git_diff",
    source: "packages/runtime/src/flow/index.ts",
    source_command: "git diff HEAD -- packages/runtime/src/flow/index.ts",
    capture_timestamp: "2026-05-14T00:00:00.000Z",
    freshness: "fresh",
    owner: "unknown",
    validation_state: "ok",
    ingestion_error: null,
    redaction_state: "none",
  });

  assert.equal(provenance.source_type, "scoped_git_diff");
  assert.equal(
    ContextProvenanceSchema.parse({
      ...provenance,
      source_type: "project_spec",
      source: ".agentmesh/spec/project.toml",
    }).source_type,
    "project_spec",
  );
  assert.equal(
    ContextProvenanceSchema.parse({
      ...provenance,
      source_type: "project_correction",
      source: "correction-20260514-001",
    }).source_type,
    "project_correction",
  );
  assert.throws(() =>
    ContextProvenanceSchema.parse({
      ...provenance,
      source_type: "unsupported",
    }),
  );
});

test("core exports project spec schema", () => {
  const spec = ProjectSpecSchema.parse({
    schema_version: 1,
    project: {
      id: "agentmesh",
      name: "AgentMesh",
      description: "Local-first AI coding workflow CLI.",
    },
    key_commands: [
      {
        id: "test",
        command: "npm test",
        description: "Build and run Node tests.",
      },
    ],
    constraints: [
      {
        id: "local-first",
        statement: "Run packets remain the source of truth.",
        scope: "packet",
        owner: "AgentMesh maintainers",
      },
    ],
    risks: [
      {
        id: "stale-facts",
        statement: "Project facts can drift if not validated.",
        status: "active",
        mitigation: "Run agentmesh spec check before inclusion.",
      },
    ],
    freshness: {
      updated_at: "2026-05-14T00:00:00.000Z",
      freshness: "fresh",
      max_age_days: 30,
    },
    owner: {
      owner: "AgentMesh maintainers",
      contact: "README.md",
    },
    validation: {
      validation_state: "ok",
      checked_at: "2026-05-14T00:00:00.000Z",
      command: "npm test",
      message: "141 passed",
    },
  });

  assert.equal(spec.project.id, "agentmesh");
  assert.equal(spec.key_commands[0].command, "npm test");
  assert.throws(() =>
    ProjectSpecSchema.parse({
      ...spec,
      key_commands: [],
    }),
  );
  assert.throws(() =>
    ProjectSpecSchema.parse({
      ...spec,
      project: {
        name: "Missing id",
      },
    }),
  );
  assert.throws(() =>
    ProjectSpecSchema.parse({
      ...spec,
      risks: [
        {
          id: "bad-risk",
          statement: "Bad risk status.",
          status: "unknown",
        },
      ],
    }),
  );
});

test("core exports correction record schema", () => {
  const correction = CorrectionRecordSchema.parse({
    schema_version: 1,
    id: "correction-20260514-001",
    scope: "packages/runtime/src/context",
    statement: "Project facts enter packets only through explicit include flags.",
    source: "manual",
    created_at: "2026-05-14T00:00:00.000Z",
    supersedes: [],
    status: "active",
    owner: "AgentMesh maintainers",
  });

  assert.equal(correction.id, "correction-20260514-001");
  assert.equal(CorrectionStatusSchema.parse("superseded"), "superseded");
  assert.throws(() =>
    CorrectionRecordSchema.parse({
      ...correction,
      scope: "",
    }),
  );
  assert.throws(() =>
    CorrectionRecordSchema.parse({
      ...correction,
      statement: "",
    }),
  );
  assert.throws(() =>
    CorrectionRecordSchema.parse({
      ...correction,
      supersedes: [""],
    }),
  );
  assert.throws(() =>
    CorrectionRecordSchema.parse({
      ...correction,
      status: "archived",
    }),
  );
});

test("core exports MCP failure classifications for context ingestion", () => {
  for (const classification of [
    "server_start_failed",
    "initialize_failed",
    "resource_not_found",
    "non_text_resource",
    "resource_too_large",
    "timeout",
    "invalid_json_rpc",
    "unknown",
  ]) {
    assert.equal(McpFailureClassificationSchema.parse(classification), classification);
  }

  assert.throws(() => McpFailureClassificationSchema.parse("auth_required"));
});

test("core preserves optional reviewer session attempt provenance", () => {
  assert.deepEqual(REVIEW_SESSION_MODES, ["auto", "interactive_continuous", "independent"]);
  assert.equal(ReviewSessionModeSchema.parse("independent"), "independent");
  assert.throws(() => ReviewSessionModeSchema.parse("continuous"));
  assert.deepEqual(REVIEWER_SESSION_ATTEMPT_MODES, [
    "fresh",
    "resumed",
    "fallback_fresh",
    "fresh_isolated",
  ]);
  assert.equal(ReviewerSessionAttemptModeSchema.parse("resumed"), "resumed");

  const attempt = StageAttemptSchema.parse({
    lane_id: "review:a-test",
    primary_agent: "a-test",
    requested_agent: "a-test",
    actual_agent: "a-test",
    lane_attempt: 1,
    attempt: 1,
    timeout_seconds: 240,
    status: "completed",
    session_mode: "resumed",
    session_ref: "rs-0123456789abcdef",
    conversation_scope_ref: "cs-0123456789abcdef",
    scope_source: "propagated",
    hermetic: false,
    non_hermetic_reason: "session_resume",
    registry_write: true,
  });
  assert.equal(attempt.session_mode, "resumed");
  assert.equal(attempt.scope_source, "propagated");

  const legacyAttempt = StageAttemptSchema.parse({
    lane_id: "review:a-test",
    primary_agent: "a-test",
    requested_agent: "a-test",
    actual_agent: "a-test",
    lane_attempt: 1,
    attempt: 1,
    timeout_seconds: 240,
    status: "completed",
  });
  assert.equal(legacyAttempt.session_mode, undefined);
});

test("core exports adapter invocation interfaces without runtime coupling", () => {
  const input = AdapterInvocationInputSchema.parse({
    schema_version: 1,
    adapter_id: "claude-opus47",
    stage: "review",
    role: "reviewer",
    packet_dir: "/tmp/packet",
    prompt_file: "invoke-review.prompt.md",
    output_file: "review-claude-opus47.out",
    non_interactive: true,
    env: {
      AGENTMESH_RUN_ID: "run-1",
    },
  });
  assert.equal(input.stage, "review");

  const output = AdapterInvocationOutputSchema.parse({
    schema_version: 1,
    status: "failed",
    exit_code: 1,
    output_file: "review-claude-opus47.out",
    duration_ms: 124,
    failure: {
      classification: "auth_required",
      message: "login required",
      retryable: false,
    },
  });
  assert.equal(output.failure?.classification, "auth_required");

  for (const classification of [
    "timeout",
    "session_not_found",
    "session_expired",
    "session_incompatible",
    "context_overflow",
    "provider_busy",
  ]) {
    assert.equal(AdapterFailureClassificationSchema.parse(classification), classification);
  }
  assert.deepEqual(
    AdapterCapabilityMetadataSchema.parse({
      supports_resume: true,
      supports_structured_session_id: true,
    }),
    {
      roles: [],
      stages: [],
      supports_resume: true,
      supports_structured_session_id: true,
    },
  );
});

test("contract docs exist and describe external observation files", () => {
  const root = process.cwd();
  const docs = [
    "packet-layout.md",
    "status-json.md",
    "events-jsonl.md",
    "artifacts-toml.md",
    "config-toml.md",
    "preset-toml.md",
    "config-layering.md",
    "context-provenance.md",
    "context-policy.md",
    "review-release-policy.md",
    "execution-policy.md",
    "prompt-assembly.md",
    "run-lock.md",
    "stage-dispatch.md",
    "workflow-toml.md",
    "verify-stage.md",
    "skill-output.md",
    "reviewer-registry.md",
    "review-artifacts.md",
    "release-verdict.md",
    "adapter-invocation.md",
    "adapter-plugin.md",
    "project-spec.md",
    "corrections.md",
    "agent-registration.md",
    "app-server.md",
    "public-extension-surface.md",
  ];

  for (const doc of docs) {
    const content = readFileSync(path.join(root, "docs", "contracts", doc), {
      encoding: "utf-8",
    });
    assert.match(content, /schema_version/);
  }

  const packetLayout = readFileSync(
    path.join(root, "docs", "contracts", "packet-layout.md"),
    { encoding: "utf-8" },
  );
  for (const fileName of [
    "request.md",
    "context.md",
    "plan.md",
    "handoff.md",
    "findings.md",
    "decision.md",
    "reviews/<reviewer>.md",
    "verification.md",
    "events.jsonl",
    "status.json",
    "artifacts.toml",
    "release-summary.md",
  ]) {
    assert.match(packetLayout, new RegExp(fileName.replace(".", "\\.")));
  }

  const promptAssembly = readFileSync(
    path.join(root, "docs", "contracts", "prompt-assembly.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    "prompt snapshot",
    "live working tree",
    "verification evidence",
    "context freeze",
    "context refresh",
    "release-summary derived refresh",
    "per-stage budget",
    "per-adapter budget",
    "redaction posture",
  ]) {
    assert.match(promptAssembly, new RegExp(requiredTerm));
  }

  const verifyStage = readFileSync(
    path.join(root, "docs", "contracts", "verify-stage.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    "verification.md",
    "verification_2.md",
    "plan -> execute -> verify -> review -> decide",
    "single-agent",
    "verify capability",
    "profile schema",
    "old packet",
    "release verdict",
  ]) {
    assert.match(verifyStage, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const workflowToml = readFileSync(
    path.join(root, "docs", "contracts", "workflow-toml.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    "verify",
    "Stage Rules",
    "Direct Run Inputs",
    "`--task` and `--task-file` are mutually exclusive",
    "Legacy packet migration is unsupported",
  ]) {
    assert.match(workflowToml, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const artifactsToml = readFileSync(
    path.join(root, "docs", "contracts", "artifacts-toml.md"),
    { encoding: "utf-8" },
  );
  assert.match(artifactsToml, /verification/);

  const verifyStageDispatch = readFileSync(
    path.join(root, "docs", "contracts", "stage-dispatch.md"),
    { encoding: "utf-8" },
  );
  assert.match(verifyStageDispatch, /multi-agent verify/i);

  const reviewReleasePolicy = readFileSync(
    path.join(root, "docs", "contracts", "review-release-policy.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    "[review_policy.<workflow-id>]",
    "required_review_profiles",
    "[release_policy.<workflow-id>]",
    "required_evidence",
    "needs_decision_risks",
    "resolved_review_release_policy",
  ]) {
    assert.match(reviewReleasePolicy, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const executionPolicy = readFileSync(
    path.join(root, "docs", "contracts", "execution-policy.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    "[run_defaults]",
    "[execution_policy]",
    "resolved_execution_policy",
    "config_provenance",
    "allow_auto_dispatch",
    "max_retry_attempts",
  ]) {
    assert.match(executionPolicy, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const configToml = readFileSync(
    path.join(root, "docs", "contracts", "config-toml.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    "[default_stage_agents]",
    "[fallback]",
    "assignment_provenance",
    "fallback_provenance",
    "timeout_provenance",
    "MAX_FANOUT_AGENTS = 6",
    "30-3600",
  ]) {
    assert.match(configToml, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const presetToml = readFileSync(
    path.join(root, "docs", "contracts", "preset-toml.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    "stage_assignments",
    "preset explicit node assignment",
    "Task Input",
    "`--task` and `--task-file` are mutually exclusive",
    "failure_policy",
    "mode = \"terminal\"",
    "lane_attempt",
    "preset_fallback",
    "global_fallback",
  ]) {
    assert.match(presetToml, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const runLock = readFileSync(path.join(root, "docs", "contracts", "run-lock.md"), {
    encoding: "utf-8",
  });
  for (const requiredTerm of [
    ".agentmesh.lock/lease.json",
    "single-writer",
    "active lease",
    "expired lease",
    "status.json",
    "events.jsonl",
    "artifacts.toml",
    "stage output",
  ]) {
    assert.match(runLock, new RegExp(requiredTerm.replace(".", "\\.")));
  }

  const stageDispatch = readFileSync(
    path.join(root, "docs", "contracts", "stage-dispatch.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    "single",
    "fanout",
    "prompts/<node-id>/<agent>.md",
    "reviews/<reviewer>.md",
    "reviews/<node-id>/<reviewer>.md",
    "stage_type",
    "isolated",
    "Partial Failure",
    "Failure Policy And Fallback",
    "timed_out",
    "lane_attempt",
    "Per-Agent Retry",
    "Decider Aggregation",
  ]) {
    assert.match(stageDispatch, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const projectSpec = readFileSync(
    path.join(root, "docs", "contracts", "project-spec.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    ".agentmesh/spec/project.toml",
    "modules/*.toml",
    "commands.toml",
    "risks.md",
    "flow run --include-spec",
  ]) {
    assert.match(projectSpec, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const corrections = readFileSync(
    path.join(root, "docs", "contracts", "corrections.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    ".agentmesh/corrections/",
    "CorrectionRecordSchema",
    "supersedes",
    "status",
    "owner",
  ]) {
    assert.match(corrections, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const agentRegistration = readFileSync(
    path.join(root, "docs", "contracts", "agent-registration.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    "agents add",
    "canonical model",
    "temporary candidate agent",
    "readiness probe",
    "short internal id",
    "default label",
    "does not accept a positional",
    "unique generated agent id",
    "adapter CLI does not exist",
    "ambiguous model",
    "--skip-verify",
    "does not write config",
  ]) {
    assert.match(agentRegistration, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const readme = readFileSync(path.join(root, "README.md"), { encoding: "utf-8" });
  assert.match(readme, /短内部 id/);
  assert.doesNotMatch(readme, /agents add executor/);
  assert.doesNotMatch(readme, /agents add reviewer/);
  assert.doesNotMatch(readme, /--alias codex/);

  const appServer = readFileSync(
    path.join(root, "docs", "contracts", "app-server.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    "dynamic 127.0.0.1 port",
    "per-launch token",
    "serve Studio UI",
    "health check",
    "graceful shutdown",
    "app-bundled runtime",
    "PATH-visible agentmesh",
    "filesystem run-lock",
    "unknown lock schema",
    "unsupported newer packet schema",
    "read-only",
    "must not write packet files directly",
  ]) {
    assert.match(appServer, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const publicExtensionSurface = readFileSync(
    path.join(root, "docs", "contracts", "public-extension-surface.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    "Current consumers",
    "CLI",
    "Studio",
    "Desktop",
    "Potential consumers",
    "MCP server",
    "local scripts",
    "third-party adapter",
    "external dashboard",
    "read-only",
    "controlled write",
    "internal",
    "Read-only SDK promoted",
    "no public write API",
    "packages/sdk",
  ]) {
    assert.match(publicExtensionSurface, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("contract TOML examples parse", () => {
  const root = process.cwd();
  for (const doc of [
    "config-toml.md",
    "workflow-toml.md",
    "preset-toml.md",
  ]) {
    const content = readFileSync(path.join(root, "docs", "contracts", doc), {
      encoding: "utf-8",
    });
    const blocks = [...content.matchAll(/```toml\n([\s\S]*?)```/g)];
    assert.ok(blocks.length > 0, `${doc} should contain TOML examples`);
    for (const [index, block] of blocks.entries()) {
      parseTomlDocument(block[1], `${doc} example ${index + 1}`, "invalid contract TOML example");
    }
  }
});

test("README and landing page describe final workflow semantics", () => {
  const root = process.cwd();
  const readme = readFileSync(path.join(root, "README.md"), "utf-8");
  const landing = readFileSync(path.join(root, "index.html"), "utf-8");

  for (const requiredTerm of [
    "preset-first UX",
    "decide checkpoint",
    "current packet schema is active",
    "legacy packet migration is unsupported",
    "[default_stage_agents]",
    "[fallback]",
    "[failure_policy]",
    "agentmesh run <preset-id> --task",
    "--title <title>",
    '--title "编排并验证小修复"',
  ]) {
    assert.match(readme, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const requiredTerm of [
    "preset-first UX",
    "decide checkpoint",
    "current packet schema",
    "fallback/failure policy",
    "legacy migration unsupported",
  ]) {
    assert.match(landing, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
