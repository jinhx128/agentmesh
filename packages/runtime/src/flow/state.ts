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
  if (status.completed_stages.includes(nodeId) && existsSync(artifactPath)) {
    throw new Error(`refusing to overwrite completed ${nodeId} artifact: ${artifactPath}`);
  }
}

export function firstIncompleteStage(status: PacketStatus): string | undefined {
  return stageNodes(status).find((node) => !status.completed_stages.includes(node.id))?.id;
}

export function setStageState(status: PacketStatus, stage: string, state: StageState): void {
  const stageState = isStageStateMap(status.stage_state) ? status.stage_state : {};
  status.stage_state = { ...stageState, [stage]: state };
}

export function stringField(status: PacketStatus, key: string): string | undefined {
  const value = status[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStageStateMap(value: unknown): value is Record<string, StageState> {
  return isRecord(value);
}
