import {
  CURRENT_PACKET_SCHEMA_VERSION,
  deriveStageNodes,
  type StageNode,
} from "../../packages/core/src/index.js";

export function currentPacketStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const stages = (overrides.stages as string[] | undefined) ?? [
    "plan",
    "execute",
    "review",
    "decide",
  ];
  const stageNodes = (overrides.stage_nodes as StageNode[] | undefined)
    ?? deriveStageNodes(stages);
  const stageAssignments = (overrides.stage_assignments as Record<string, string[]> | undefined)
    ?? Object.fromEntries(stageNodes.map((node) => [node.id, ["current"]]));
  const firstStage = stageNodes[0]?.id;

  return {
    schema_version: CURRENT_PACKET_SCHEMA_VERSION,
    run_id: "current-packet",
    created_at: "2026-05-13T00:00:00.000Z",
    updated_at: "2026-05-13T00:00:00.000Z",
    run_status: firstStage && stageAssignments[firstStage]?.includes("current")
      ? "awaiting_current"
      : "pending",
    ...(firstStage ? { current_stage: firstStage } : {}),
    stages,
    stage_nodes: stageNodes,
    stage_status: Object.fromEntries(stageNodes.map((node) => [node.id, "planned"])),
    stage_assignments: stageAssignments,
    stage_invocations: Object.fromEntries(stageNodes.map((node) => [
      node.id,
      (stageAssignments[node.id] ?? []).map((agent) => ({
        lane_id: `${node.id}:${agent}`,
        kind: agent === "current" ? "current" : "primary",
        agent,
        timeout_seconds: agent === "current" ? null : 900,
      })),
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
