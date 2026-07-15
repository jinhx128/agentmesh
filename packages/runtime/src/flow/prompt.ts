import { existsSync } from "node:fs";
import path from "node:path";
import { BUILTIN_WORKFLOW_IDS } from "@agentmesh/core";
import {
  loadStatus,
  recordArtifact,
  relativePacketPath,
  resolveRunDirectory,
  saveStatus,
  writeFileAtomic,
} from "../packet/io.js";
import type { PacketStatus } from "../packet/io.js";
import { refreshReleaseEvidenceSummary } from "../release/check.js";
import {
  listRawReviewOutputs,
  RAW_REVIEW_OUTPUTS_HEADING,
  safeReviewArtifactId,
  withoutRawReviewOutputs,
} from "../review/artifacts.js";
import { readOptional } from "./files.js";
import {
  assertStageInRun,
  stageAgents,
  stageArtifactFile,
  stageNodeForId,
  stageNodes,
} from "./state.js";

const PRIOR_ARTIFACT_CONTENT_MAX_BYTES = 6_000;
const PRIOR_RAW_REVIEW_OUTPUT_MAX_BYTES = 2_500;
const RELEASE_SUMMARY_PROMPT_CONTENT_MAX_BYTES = 24_000;

export function buildStagePrompt(
  run: string,
  stage: string,
  cwd = process.cwd(),
  agentId?: string,
): string {
  const runDir = resolveRunDirectory(run, cwd);
  const status = loadStatus(runDir);
  assertStageInRun(status, stage);
  const node = stageNodeForId(status, stage);
  if (
    status.workflow === BUILTIN_WORKFLOW_IDS.RELEASE_CHECK
    && (node.type === "review" || node.type === "decide")
  ) {
    refreshReleaseEvidenceSummary(runDir, status);
  }
  const request = readOptional(path.join(runDir, "request.md"));
  const assignment = readOptional(path.join(runDir, "assignment.toml"));
  const context = readOptional(path.join(runDir, "context.md"));
  const releaseSummary = readOptional(path.join(runDir, "release-summary.md"));
  const sections = [
    "# AgentMesh Dispatch",
    "",
    `Stage: ${node.id}`,
    `Stage Type: ${node.type}`,
    `Packet Directory: ${packetDisplayPath(runDir, cwd)}`,
    agentId ? `Agent: ${agentId}` : "",
    "",
    "## Request",
    "",
    request.trimEnd(),
    "",
    "## Assignment",
    "",
    assignment.trimEnd(),
    "",
  ];
  if (context.trim()) {
    sections.push(
      "## Context Reference",
      "",
      contextReferencePromptContent(context, `${packetDisplayPath(runDir, cwd)}/context.md`),
      "",
    );
  }
  sections.push(...orderedPriorEvidenceSections(runDir, status, node.id));
  if (releaseSummary.trim()) {
    sections.push("## Release Summary", "", releaseSummaryPromptContent(releaseSummary), "");
  }
  if (node.type === "execute") {
    sections.push(
      "## Handoff Contract",
      "",
      "Write the canonical handoff artifact using these headings: `## Changed Files`, `## Verification`, `## Not Verified`, `## Remaining Risk`, and `## Next Action`. Record behavior changes, exact verification commands and results, skipped checks with reasons, residual risk, and the recommended next action. Do not rely on unstored terminal output or private chat state as downstream evidence.",
      "",
    );
  }
  if (node.type === "verify") {
    sections.push(
      "## Verify Contract",
      "",
      "Inspect the current packet evidence, run or review the relevant checks, and write one canonical verification artifact. Include commands or evidence inspected, skipped checks with reasons, failures found, residual risk, and the next stage readiness signal.",
      "",
    );
  }
  if (
    status.workflow === BUILTIN_WORKFLOW_IDS.RELEASE_CHECK
    && (node.type === "review" || node.type === "decide")
  ) {
    sections.push(
      "## Release Check Contract",
      "",
      "Reviewers must inspect the evidence summary, note missing or skipped checks, and identify residual risk with evidence. The decider must include exactly one non-fenced verdict line: `Verdict: ready`, `Verdict: not_ready`, or `Verdict: needs_decision`.",
      "",
    );
  }
  if (node.type === "decide" && status.user_gate) {
    sections.push(
      "## User Gate",
      "",
      "This run is user-gated. Summarize accepted findings, rejected findings, and items that need user decision. Recommend the next action, but do not claim final approval without the user's explicit decision.",
      "",
    );
  }
  return sections.filter((section) => section.length > 0).join("\n");
}

export function releaseSummaryPromptContent(content: string): string {
  return boundedPromptContent(
    demoteMarkdownHeadings(content.trimEnd()),
    "release-summary.md",
    RELEASE_SUMMARY_PROMPT_CONTENT_MAX_BYTES,
  );
}

export function contextReferencePromptContent(context: string, contextPath = "context.md"): string {
  const bytes = Buffer.byteLength(context, "utf-8");
  const originalBytes = /^original_bytes = (\d+)$/m.exec(context)?.[1];
  const truncated = context.startsWith("AGENTMESH_CONTEXT_TRUNCATED");
  return [
    "Context artifact: context.md",
    `Context path: ${contextPath}`,
    `Context bytes: ${bytes}`,
    ...(truncated ? ["Context status: truncated"] : []),
    ...(truncated && originalBytes ? [`Context original bytes: ${originalBytes}`] : []),
    "Read or scan the context path above only when needed. Do not assume this prompt replays the full local context.",
  ].join("\n");
}

export function writePrompt(runDir: string, stage: string, cwd: string, agent: string): string {
  const prompt = buildStagePrompt(runDir, stage, cwd, agent);
  const status = loadStatus(runDir);
  const isFanout = stageAgents(status, stage).length > 1;
  const safeAgent = safeReviewArtifactId(agent);
  const promptPath = isFanout
    ? path.join(runDir, "prompts", stage, `${safeAgent}.md`)
    : path.join(runDir, "prompts", `${stage}.md`);
  const artifactName = isFanout ? `prompt_${stage}_${safeAgent}` : `prompt_${stage}`;
  writeFileAtomic(promptPath, prompt);
  recordArtifact(runDir, artifactName, promptPath, "prompt", stage, isFanout ? agent : undefined);
  recordPromptByteMetric(runDir, artifactName, promptPath, prompt, stage, agent, "stage");
  return promptPath;
}

export function recordPromptByteMetric(
  runDir: string,
  artifactName: string,
  promptPath: string,
  prompt: string,
  stage: string,
  agent: string | undefined,
  kind: "stage" | "synthesis",
): void {
  const status = loadStatus(runDir);
  status.prompt_bytes = {
    ...(status.prompt_bytes ?? {}),
    [artifactName]: {
      path: relativePacketPath(runDir, promptPath),
      bytes: Buffer.byteLength(prompt, "utf-8"),
      stage,
      ...(agent ? { agent } : {}),
      kind,
    },
  };
  saveStatus(runDir, status);
}

export function orderedPriorEvidenceSections(
  runDir: string,
  status: PacketStatus,
  nodeId: string,
): string[] {
  const nodes = stageNodes(status);
  const index = nodes.findIndex((node) => node.id === nodeId);
  const sections: string[] = [];
  for (const prior of nodes.slice(0, Math.max(index, 0))) {
    const artifactFile = stageArtifactFile(status, prior.id);
    const artifactPath = path.join(runDir, artifactFile);
    const content = existsSync(artifactPath)
      ? priorArtifactPromptContent(
        readOptional(artifactPath),
        artifactFile,
        prior.type,
      )
      : `> Artifact unavailable: ${artifactFile}`;
    sections.push(
      `## Prior Output: ${prior.id} (${stageSemanticLabel(prior.type)})`,
      "",
      `Artifact: ${artifactFile}`,
      "",
      content,
      "",
    );
    if (prior.type === "review") {
      const rawReviews = boundedRawReviewOutputsMarkdown(runDir, prior).trimEnd();
      if (rawReviews) {
        sections.push(
          `## Prior Raw Reviews: ${prior.id} (${prior.type})`,
          "",
          rawReviews,
          "",
        );
      }
    }
  }
  return sections;
}

function priorArtifactPromptContent(content: string, artifactFile: string, stageType: string): string {
  const trimmed = content.trimEnd();
  if (stageType !== "review") {
    return boundedPromptContent(trimmed, `artifact ${artifactFile}`, PRIOR_ARTIFACT_CONTENT_MAX_BYTES);
  }
  const withoutRaw = withoutRawReviewOutputs(trimmed);
  if (withoutRaw.length === trimmed.length) {
    return boundedPromptContent(trimmed, `artifact ${artifactFile}`, PRIOR_ARTIFACT_CONTENT_MAX_BYTES);
  }
  return [
    boundedPromptContent(withoutRaw, `artifact ${artifactFile}`, PRIOR_ARTIFACT_CONTENT_MAX_BYTES),
    "",
    `> AgentMesh prompt assembly moved raw review outputs from ${artifactFile} to the bounded Prior Raw Reviews section below.`,
  ].join("\n").trimEnd();
}

function boundedRawReviewOutputsMarkdown(
  runDir: string,
  node: ReturnType<typeof stageNodeForId>,
): string {
  const outputs = listRawReviewOutputs(runDir, node);
  if (outputs.length === 0) {
    return "";
  }
  const sections = [RAW_REVIEW_OUTPUTS_HEADING, ""];
  for (const output of outputs) {
    const sourcePath = path.relative(runDir, output.path).split(path.sep).join("/");
    sections.push(
      `### ${output.reviewer}`,
      "",
      boundedPromptContent(output.content, `raw review ${sourcePath}`, PRIOR_RAW_REVIEW_OUTPUT_MAX_BYTES),
      "",
    );
  }
  return `${sections.join("\n").trimEnd()}\n`;
}

function boundedPromptContent(content: string, source: string, maxBytes: number): string {
  const trimmed = content.trimEnd();
  const originalBytes = Buffer.byteLength(trimmed, "utf-8");
  if (originalBytes <= maxBytes) {
    return trimmed;
  }
  const excerpt = utf8HeadTail(trimmed, maxBytes).trimEnd();
  const excerptBytes = Buffer.byteLength(excerpt, "utf-8");
  return [
    excerpt,
    "",
    `> AgentMesh prompt assembly truncated ${source}: showing ${excerptBytes}/${originalBytes} bytes. Full evidence remains in the packet source.`,
  ].join("\n");
}

function utf8Prefix(content: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of content) {
    const characterBytes = Buffer.byteLength(character, "utf-8");
    if (bytes + characterBytes > maxBytes) {
      break;
    }
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function utf8HeadTail(content: string, maxBytes: number): string {
  const omission = "\n\n> AgentMesh omitted middle content; the full evidence remains in the packet source.\n\n";
  const omissionBytes = Buffer.byteLength(omission, "utf-8");
  if (omissionBytes >= maxBytes) {
    return utf8Prefix(content, maxBytes);
  }
  const excerptBytes = maxBytes - omissionBytes;
  const headBytes = Math.floor(excerptBytes * 0.6);
  const tailBytes = excerptBytes - headBytes;
  return `${utf8Prefix(content, headBytes).trimEnd()}${omission}${utf8Suffix(content, tailBytes).trimStart()}`;
}

function utf8Suffix(content: string, maxBytes: number): string {
  const encoded = Buffer.from(content, "utf-8");
  if (encoded.byteLength <= maxBytes) {
    return content;
  }
  let start = encoded.byteLength - maxBytes;
  while (start < encoded.byteLength && (encoded[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return encoded.toString("utf-8", start);
}

function stageSemanticLabel(stageType: string): string {
  if (stageType === "plan") {
    return "Current Plan";
  }
  if (stageType === "execute") {
    return "Handoff";
  }
  if (stageType === "verify") {
    return "Verification";
  }
  if (stageType === "review") {
    return "Findings";
  }
  if (stageType === "decide") {
    return "Decision";
  }
  return stageType;
}

function demoteMarkdownHeadings(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => (line.startsWith("#") ? `#${line}` : line))
    .join("\n");
}

export function packetDisplayPath(runDir: string, cwd: string): string {
  const relative = path.relative(cwd, runDir);
  const display = relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : runDir;
  return display.split(path.sep).join("/");
}
