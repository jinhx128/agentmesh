import { existsSync } from "node:fs";
import path from "node:path";
import {
  type StageNode,
  type StageState,
  stageNodesForStatus,
} from "@agentmesh/core";
import type { PacketStatus } from "../packet/io.js";
import {
  DECISION_FILE,
  FINDINGS_FILE,
  reviewOutputPathForNode,
  safeAgentId,
} from "../review/artifacts.js";

export const DEFAULT_STAGES = ["plan", "execute", "review", "decide"];

export function stageNodes(status: PacketStatus): StageNode[] {
  return stageNodesForStatus(status);
}

export function stageNodeForId(status: PacketStatus, nodeId: string): StageNode {
  const node = stageNodes(status).find((item) => item.id === nodeId);
  if (!node) {
    throw new Error(`stage '${nodeId}' is not part of run ${status.run_id}`);
  }
  return node;
}

export function stageAgents(status: PacketStatus, nodeId: string): string[] {
  const node = stageNodeForId(status, nodeId);
  const stageAssignments = status.stage_assignments;
  if (stageAssignments && Array.isArray(stageAssignments[node.id])) {
    return [...stageAssignments[node.id]];
  }
  return [];
}

export function stageOutputPath(
  runDir: string,
  status: PacketStatus,
  nodeId: string,
  agent: string,
): string {
  const node = stageNodeForId(status, nodeId);
  if (node.type === "review") {
    return reviewOutputPathForNode(runDir, node, agent);
  }
  return canonicalStageOutputPath(runDir, status, node.id);
}

export function stageFanoutOutputPath(
  runDir: string,
  status: PacketStatus,
  nodeId: string,
  agent: string,
): string {
  const node = stageNodeForId(status, nodeId);
  if (node.type === "review") {
    return reviewOutputPathForNode(runDir, node, agent);
  }
  return path.join(runDir, "outputs", node.id, `${safeAgentId(agent)}.md`);
}

export function canonicalStageOutputPath(
  runDir: string,
  status: PacketStatus,
  nodeId: string,
): string {
  return path.join(runDir, stageArtifactFile(status, nodeId));
}

export function stageArtifactFile(status: PacketStatus, nodeId: string): string {
  const node = stageNodeForId(status, nodeId);
  if (node.type === "plan") {
    return node.occurrence === 1 ? "plan.md" : `plan_${node.occurrence}.md`;
  }
  if (node.type === "execute") {
    return node.occurrence === 1 ? "handoff.md" : `handoff_${node.occurrence}.md`;
  }
  if (node.type === "verify") {
    return node.occurrence === 1 ? "verification.md" : `verification_${node.occurrence}.md`;
  }
  if (node.type === "review") {
    return node.occurrence === 1 ? FINDINGS_FILE : `findings_${node.occurrence}.md`;
  }
  if (node.type === "decide") {
    return node.occurrence === 1 ? DECISION_FILE : `decision_${node.occurrence}.md`;
  }
  throw new Error(`unsupported stage: ${node.type}`);
}

export function stageArtifactName(status: PacketStatus, nodeId: string): string {
  const node = stageNodeForId(status, nodeId);
  if (node.type === "execute") {
    return node.occurrence === 1 ? "handoff" : `handoff_${node.occurrence}`;
  }
  if (node.type === "review") {
    return node.occurrence === 1 ? "findings" : `findings_${node.occurrence}`;
  }
  if (node.type === "verify") {
    return node.occurrence === 1 ? "verification" : `verification_${node.occurrence}`;
  }
  if (node.type === "plan") {
    return node.occurrence === 1 ? "plan" : `plan_${node.occurrence}`;
  }
  if (node.type === "decide") {
    return node.occurrence === 1 ? "decision" : `decision_${node.occurrence}`;
  }
  throw new Error(`unsupported stage: ${node.type}`);
}

export function assertStageInRun(status: PacketStatus, nodeId: string): void {
  stageNodeForId(status, nodeId);
}

export function protectCompletedArtifact(
  status: PacketStatus,
  nodeId: string,
  artifactPath: string,
): void {
  if (stageIsCompleted(status, nodeId) && existsSync(artifactPath)) {
    throw new Error(`refusing to overwrite completed ${nodeId} artifact: ${artifactPath}`);
  }
}

export function firstIncompleteStage(status: PacketStatus): string | undefined {
  return stageNodes(status).find((node) => !stageIsCompleted(status, node.id))?.id;
}

export function stageIsCompleted(status: PacketStatus, stage: string): boolean {
  return status.stage_status[stage] === "completed";
}

export function completedStageIds(status: PacketStatus): string[] {
  return stageNodes(status)
    .filter((node) => stageIsCompleted(status, node.id))
    .map((node) => node.id);
}

export function failedStageId(status: PacketStatus): string | undefined {
  if (status.current_stage && ["failed", "timed_out"].includes(status.stage_status[status.current_stage] ?? "")) {
    return status.current_stage;
  }
  return stageNodes(status).find((node) =>
    ["failed", "timed_out"].includes(status.stage_status[node.id] ?? "")
  )?.id;
}

export function setStageStatus(status: PacketStatus, stage: string, state: StageState): void {
  status.stage_status = { ...status.stage_status, [stage]: state };
}

export function setRunWaitingForStage(status: PacketStatus, stage: string): void {
  status.current_stage = stage;
  status.run_status = stageAgents(status, stage).includes("current")
    ? "awaiting_current"
    : "pending";
}
