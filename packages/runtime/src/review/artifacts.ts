import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  appendEvent,
  loadStatus,
  recordArtifact,
  writeFileAtomic,
} from "../packet/io.js";
import type { StageNode } from "@agentmesh/core";

export const REVIEW_OUTPUTS_DIR = "reviews";
export const FINDINGS_FILE = "findings.md";
export const DECISION_FILE = "decision.md";
export const RAW_REVIEW_OUTPUTS_HEADING = "## Raw Review Outputs";
export const REVIEWER_SESSION_PROVENANCE_HEADING = "## Reviewer Session Provenance";

export interface RawReviewOutput {
  reviewer: string;
  fileName: string;
  path: string;
  content: string;
}

export function reviewOutputPath(runDir: string, reviewer: string): string {
  return path.join(runDir, REVIEW_OUTPUTS_DIR, `${safeReviewArtifactId(reviewer)}.md`);
}

export function reviewOutputPathForNode(
  runDir: string,
  node: StageNode,
  reviewer: string,
): string {
  if (node.occurrence === 1) {
    return reviewOutputPath(runDir, reviewer);
  }
  return path.join(
    runDir,
    REVIEW_OUTPUTS_DIR,
    node.id,
    `${safeReviewArtifactId(reviewer)}.md`,
  );
}

export function reviewArtifactName(reviewer: string, node?: StageNode): string {
  if (node) {
    return `${node.id}_${safeAgentId(reviewer)}`;
  }
  return `review_${safeAgentId(reviewer)}`;
}

export function safeAgentId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "agent";
}

export function safeReviewArtifactId(value: string): string {
  return safeAgentId(value);
}

export function recordRawReviewOutputArtifact(
  runDir: string,
  reviewer: string,
  outputPath: string,
  node?: StageNode,
): void {
  const stage = node?.id ?? "review";
  const artifact = reviewArtifactName(reviewer, node);
  recordArtifact(runDir, artifact, outputPath, "review-output", stage, reviewer);
  appendEvent(runDir, "artifact.written", {
    artifact,
    path: path.relative(runDir, outputPath).split(path.sep).join("/"),
    stage,
    ...(node ? { node_id: node.id, stage_type: node.type } : {}),
    agent: reviewer,
  });
}

// Caller must hold the run mutation lock when this helper is used from a
// mutation path; it rewrites findings.md and appends artifact events.
export function refreshFindingsRawReviews(runDir: string, node?: StageNode): void {
  const rawReviews = rawReviewOutputsMarkdown(runDir, node);
  if (!rawReviews) {
    return;
  }
  const findingsFile = node && node.occurrence > 1 ? `findings_${node.occurrence}.md` : FINDINGS_FILE;
  const findingsPath = path.join(runDir, findingsFile);
  const existing = readOptional(findingsPath) || defaultFindingsMarkdown();
  const attempts = stageAttemptsForProvenance(runDir, node?.id ?? "review");
  const provenance = reviewerSessionProvenanceMarkdown(attempts, usableRawReviewerIds(runDir, node));
  writeFileAtomic(
    findingsPath,
    findingsWithRawReviews(findingsWithReviewerSessionProvenance(existing, provenance), rawReviews),
  );
  const artifact = node && node.occurrence > 1 ? `findings_${node.occurrence}` : "findings";
  const stage = node?.id ?? "review";
  recordArtifact(runDir, artifact, findingsPath, "markdown", stage);
  appendEvent(runDir, "artifact.written", {
    artifact,
    path: findingsFile,
    stage,
    ...(node ? { node_id: node.id, stage_type: node.type } : {}),
    agent: "agentmesh",
  });
}

function stageAttemptsForProvenance(runDir: string, stage: string): Array<Record<string, unknown>> {
  try {
    return loadStatus(runDir).stage_attempts[stage] ?? [];
  } catch {
    // Artifact helpers also support standalone tests/repair tooling with no packet status.
    return [];
  }
}

export function recordReviewAgentFailure(
  runDir: string,
  reviewer: string,
  exitCode?: number,
  node?: StageNode,
): void {
  const findingsFile = node && node.occurrence > 1 ? `findings_${node.occurrence}.md` : FINDINGS_FILE;
  const findingsPath = path.join(runDir, findingsFile);
  const existing = readOptional(findingsPath) || defaultFindingsMarkdown();
  const item = `- Reviewer ${reviewer} failed during review dispatch${exitCode === undefined ? "" : ` (exit ${exitCode})`}; decider must classify partial review evidence before completion.`;
  const findings = appendNeedsDecisionItem(withoutRawReviewOutputs(existing), item);
  writeFileAtomic(findingsPath, findingsWithRawReviews(findings, rawReviewOutputsMarkdown(runDir, node)));
  const artifact = node && node.occurrence > 1 ? `findings_${node.occurrence}` : "findings";
  const stage = node?.id ?? "review";
  recordArtifact(runDir, artifact, findingsPath, "markdown", stage);
  appendEvent(runDir, "review.agent_failed", {
    stage,
    ...(node ? { node_id: node.id, stage_type: node.type } : {}),
    agent: reviewer,
    exit_code: exitCode ?? null,
  });
  appendEvent(runDir, "artifact.written", {
    artifact,
    path: findingsFile,
    stage,
    ...(node ? { node_id: node.id, stage_type: node.type } : {}),
    agent: "agentmesh",
  });
}

export function findingsWithRawReviews(findings: string, rawReviews: string): string {
  const base = (withoutRawReviewOutputs(findings) || defaultFindingsMarkdown()).trimEnd();
  if (!rawReviews) {
    return `${base}\n`;
  }
  return `${base}\n\n${rawReviews}`;
}

/** Safe packet-derived disclosure; never inspect reviewer-authored output for provenance. */
export function reviewerSessionProvenanceMarkdown(
  attempts: Array<Record<string, unknown>>,
  usableReviewerIds?: ReadonlySet<string>,
): string {
  const resumed = attempts
    .filter((attempt) => attempt.status === "completed")
    .filter((attempt) => attempt.session_mode === "resumed" || (
      attempt.hermetic === false && attempt.non_hermetic_reason === "session_resume"
    ))
    .map((attempt) => ({
      reviewer: String(attempt.actual_agent ?? "unknown"),
      lane: String(attempt.lane_id ?? "unknown"),
    }))
    .sort((left, right) => left.reviewer.localeCompare(right.reviewer) || left.lane.localeCompare(right.lane))
    .filter((entry, index, entries) => index === 0
      || entry.reviewer !== entries[index - 1]!.reviewer
      || entry.lane !== entries[index - 1]!.lane)
    .filter((entry) => !usableReviewerIds || usableReviewerIds.has(safeReviewArtifactId(entry.reviewer)));
  if (resumed.length === 0) return "";
  const bounded: typeof resumed = [];
  let bytes = 0;
  for (const entry of resumed) {
    const rendered = provenanceEntryMarkdown(entry);
    if (bounded.length >= 32 || bytes + Buffer.byteLength(rendered, "utf-8") > 3_800) break;
    bounded.push(entry);
    bytes += Buffer.byteLength(rendered, "utf-8");
  }
  return [
    REVIEWER_SESSION_PROVENANCE_HEADING,
    "",
    ...bounded.flatMap((entry) => provenanceEntryMarkdown(entry).split("\n")),
    ...(bounded.length < resumed.length
      ? [`- truncated: true; shown_count: ${bounded.length}; total_count: ${resumed.length}`]
      : []),
  ].join("\n");
}

export function findingsWithReviewerSessionProvenance(findings: string, provenance: string): string {
  const base = withoutReviewerSessionProvenance(withoutRawReviewOutputs(findings)) || defaultFindingsMarkdown().trimEnd();
  return provenance ? `${base}\n\n${provenance}\n` : `${base}\n`;
}

function provenanceEntryMarkdown({ reviewer, lane }: { reviewer: string; lane: string }): string {
  return [
    `- reviewer: ${reviewer}`,
    `- lane: ${lane}`,
    "- session_mode: resumed",
    "- hermetic: false",
    "- non_hermetic_reason: session_resume",
  ].join("\n");
}

export function usableRawReviewerIds(runDir: string, node?: StageNode): Set<string> {
  return new Set(
    listRawReviewOutputs(runDir, node)
      .filter((output) => output.content.trim().length > 0)
      .map((output) => output.reviewer),
  );
}

export function usableRawReviewerIdsForNodes(runDir: string, nodes: StageNode[]): Set<string> {
  return new Set(nodes.flatMap((node) => [...usableRawReviewerIds(runDir, node)]));
}

export function rawReviewOutputsMarkdown(runDir: string, node?: StageNode): string {
  return formatRawReviewOutputs(listRawReviewOutputs(runDir, node));
}

export function listRawReviewOutputs(runDir: string, node?: StageNode): RawReviewOutput[] {
  const reviewsDir = node && node.occurrence > 1
    ? path.join(runDir, REVIEW_OUTPUTS_DIR, node.id)
    : path.join(runDir, REVIEW_OUTPUTS_DIR);
  if (!isDirectory(reviewsDir)) {
    return [];
  }
  return readdirSync(reviewsDir)
    .filter((fileName) => fileName.endsWith(".md"))
    .sort()
    .map((fileName) => {
      const reviewPath = path.join(reviewsDir, fileName);
      return {
        reviewer: path.basename(fileName, ".md"),
        fileName,
        path: reviewPath,
        content: readFileSync(reviewPath, { encoding: "utf-8" }).trimEnd(),
      };
    });
}

export function formatRawReviewOutputs(outputs: RawReviewOutput[]): string {
  if (outputs.length === 0) {
    return "";
  }
  const sections = [RAW_REVIEW_OUTPUTS_HEADING, ""];
  for (const output of outputs) {
    sections.push(
      `### ${output.reviewer}`,
      "",
      output.content,
      "",
    );
  }
  return `${sections.join("\n").trimEnd()}\n`;
}

export function defaultFindingsMarkdown(): string {
  return [
    "# Findings",
    "",
    "## Accepted",
    "",
    "## Rejected",
    "",
    "## Needs Decision",
    "",
  ].join("\n");
}

function readOptional(filePath: string): string {
  try {
    return readFileSync(filePath, { encoding: "utf-8" });
  } catch {
    return "";
  }
}

export function withoutRawReviewOutputs(content: string): string {
  const match = content.match(/^## Raw Review Outputs[ \t]*$/m);
  if (match?.index === undefined) {
    return content;
  }
  return content.slice(0, match.index).trimEnd();
}

export function withoutReviewerSessionProvenance(content: string): string {
  return withoutMarkdownSection(content, REVIEWER_SESSION_PROVENANCE_HEADING);
}

function withoutMarkdownSection(content: string, heading: string): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return content;
  let end = start + 1;
  while (end < lines.length && !lines[end]!.startsWith("## ")) end += 1;
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").trimEnd();
}

function appendNeedsDecisionItem(findings: string, item: string): string {
  const base = findings.trimEnd() || defaultFindingsMarkdown().trimEnd();
  if (base.includes(item)) {
    return base;
  }
  const lines = base.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === "## Needs Decision");
  if (headingIndex === -1) {
    return `${base}\n\n## Needs Decision\n\n${item}`;
  }
  let insertIndex = headingIndex + 1;
  while (insertIndex < lines.length && lines[insertIndex].trim() === "") {
    insertIndex += 1;
  }
  if (lines[insertIndex]?.trim() === "- TBD") {
    lines.splice(insertIndex, 1, item);
  } else {
    lines.splice(insertIndex, 0, item);
  }
  return lines.join("\n").trimEnd();
}

function isDirectory(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}
