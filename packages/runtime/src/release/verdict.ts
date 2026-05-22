import { BUILTIN_WORKFLOW_IDS } from "@agentmesh/core";
import {
  appendEvent,
  loadStatus,
  saveStatus,
  type PacketStatus,
} from "../packet/io.js";
import { setStageState, stageNodeForId, stageNodes } from "../flow/state.js";

type ReleaseVerdictValue = "ready" | "not_ready" | "needs_decision";

// Pure verdict parser/constants.
const VALID_VERDICTS = new Set<ReleaseVerdictValue>([
  "ready",
  "not_ready",
  "needs_decision",
]);
const RELEASE_VERDICT_LINE_PATTERN =
  /^\s*(?:[-*+]\s+)?(?:\*\*)?\s*verdict\s*(?:\*\*)?\s*:\s*(.+?)\s*$/i;
const RELEASE_VERDICT_VALUE_PATTERN =
  /^\s*(?:\*\*)?\s*`?\s*(needs[_ -]+decision|not[_ -]+ready|ready)\s*`?\s*(?:\*\*)?(?=$|[\s,.;:!?()[\]{}])/i;

export function isReleaseVerdictNode(status: PacketStatus, stageId: string): boolean {
  if (status.workflow !== BUILTIN_WORKFLOW_IDS.RELEASE_CHECK) {
    return false;
  }
  const node = stageNodeForId(status, stageId);
  const lastNode = stageNodes(status).at(-1);
  return node.type === "decide" && lastNode?.id === stageId;
}

// Packet side effect: persist release-check verdict state and events.
export function updateReleaseVerdict(
  runDir: string,
  stageId: string,
  decisionContent: string,
): void {
  const status = loadStatus(runDir);
  if (!isReleaseVerdictNode(status, stageId)) {
    return;
  }
  const verdict = parseReleaseVerdict(decisionContent);
  status.release_verdict = verdict;
  if (!verdict.value) {
    status.status = `${stageId}_failed`;
    status.failed_stage = stageId;
    status.completed_stages = status.completed_stages.filter((stage) => stage !== stageId);
    setStageState(status, stageId, "failed");
    saveStatus(runDir, status);
    appendEvent(runDir, "release.verdict_invalid", {
      diagnostic: verdict.diagnostic,
      stage: stageId,
      node_id: stageId,
    });
    throw new Error(verdict.diagnostic);
  }
  saveStatus(runDir, status);
  appendEvent(runDir, "release.verdict_recorded", {
    verdict: verdict.value,
    stage: stageId,
    node_id: stageId,
  });
}

function parseReleaseVerdict(
  content: string,
): { value?: ReleaseVerdictValue; diagnostic: string } {
  const verdicts = unfencedMarkdownLines(content).flatMap((line) => {
    const match = RELEASE_VERDICT_LINE_PATTERN.exec(line);
    if (!match) {
      return [];
    }
    return [normalizeReleaseVerdictValue(match[1])];
  });
  if (verdicts.length !== 1) {
    return {
      diagnostic: `release decision must contain exactly one Verdict line; found ${verdicts.length}`,
    };
  }
  const verdict = verdicts[0];
  if (!isReleaseVerdict(verdict)) {
    return {
      diagnostic: `release verdict must be ready, not_ready, or needs_decision; got ${verdict}`,
    };
  }
  return { value: verdict, diagnostic: "ok" };
}

function isReleaseVerdict(value: string): value is ReleaseVerdictValue {
  return VALID_VERDICTS.has(value as ReleaseVerdictValue);
}

function normalizeReleaseVerdictValue(rawValue: string): string {
  const match = RELEASE_VERDICT_VALUE_PATTERN.exec(rawValue);
  const value = match ? match[1] : rawValue;
  return value.trim().toLowerCase().replace(/[_ -]+/g, "_");
}

function unfencedMarkdownLines(content: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  let fenceMarker = "";
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      const marker = trimmed.slice(0, 3);
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (!inFence) {
      lines.push(stripMarkdownBlockquotePrefix(line));
    }
  }
  return lines;
}

function stripMarkdownBlockquotePrefix(line: string): string {
  let stripped = line.trimStart();
  const indentation = line.slice(0, line.length - stripped.length);
  while (stripped.startsWith(">")) {
    stripped = stripped.slice(1).trimStart();
  }
  return `${indentation}${stripped}`;
}
