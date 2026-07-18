import {
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { BUILTIN_WORKFLOW_IDS } from "@agentmesh/core";

import {
  PacketEvent,
  PacketStatus,
  loadArtifacts,
  loadEvents,
  recordArtifact,
  saveStatus,
} from "../packet/io.js";
import {
  RAW_REVIEW_OUTPUTS_HEADING,
  listRawReviewOutputs,
  reviewerSessionProvenanceMarkdown,
  usableRawReviewerIdsForNodes,
  type RawReviewOutput,
  withoutRawReviewOutputs,
} from "../review/artifacts.js";
import {
  applyReleasePolicyEvidence,
  type ReleasePolicyEvidenceInventory,
  type ResolvedReviewReleasePolicy,
} from "../review/policy.js";

const RELEASE_SUMMARY_FILE = "release-summary.md";
const NO_SCOPED_DIFF_MARKER = "(no scoped diff)";
const MAX_CONTEXT_FILE_BYTES = 1_000_000;
const MAX_RELEASE_RAW_REVIEW_OUTPUT_BYTES = 2_500;

export interface ReleaseSummaryResult {
  runDir: string;
  summaryPath: string;
  summary: string;
  written: boolean;
}

export function buildReleaseEvidenceSummary(
  runDir: string,
  status: PacketStatus,
): string {
  const context = readRunFile(runDir, "context.md");
  const findings = readRunFile(runDir, "findings.md");
  const handoff = readRunFile(runDir, "handoff.md");
  const artifacts = safeLoadArtifacts(runDir);
  const events = safeLoadEvents(runDir);

  const hasDiff =
    sectionHasEvidence(markdownSection(context, "Diff")) ||
    scopedGitDiffHasEvidence(markdownSection(context, "Scoped Git Diff"));
  const hasVerification = sectionHasEvidence(markdownSection(context, "Verification"));
  const rawReviewOutputs = listRawReviewOutputs(runDir);
  const rawReviews = boundedRawReviewOutputsMarkdown(runDir, rawReviewOutputs);
  const rawReviewEvidence = rawReviewOutputs.map((output) => output.content).join("\n");
  const reviewFindings = reviewFindingsContent(findings, rawReviews);
  const controllerVerification = controllerVerificationContent(findings, rawReviewEvidence);
  const hasReviews = rawReviewOutputs.length > 0;
  const hasFindings =
    sectionHasEvidence(markdownSection(findings, "Accepted")) ||
    sectionHasEvidence(markdownSection(findings, "Rejected")) ||
    sectionHasEvidence(markdownSection(findings, "Needs Decision"));
  let reviewReleasePolicy = reviewReleasePolicyWithEvidence(status, {
    diff: hasDiff,
    verification: hasVerification,
    reviewOutputs: hasReviews,
    classifiedFindings: hasFindings,
  });
  const reviewerSessionProvenance = reviewerSessionProvenanceMarkdown(
    Object.values(status.stage_attempts).flat() as Array<Record<string, unknown>>,
    usableRawReviewerIdsForNodes(runDir, status.stage_nodes.filter((node) => node.type === "review")),
  );
  const independentResumedEvidence = Boolean(reviewerSessionProvenance)
    && status.resolved_reviewer_session_policy?.effective_mode === "independent";
  if (independentResumedEvidence && reviewReleasePolicy) {
    reviewReleasePolicy = {
      ...reviewReleasePolicy,
      needs_decision_risks: [...new Set([...reviewReleasePolicy.needs_decision_risks, "session_resume"])].sort(),
    };
    (status as Record<string, unknown>).resolved_review_release_policy = reviewReleasePolicy;
  }

  const releaseVerdict = status.release_verdict;
  let verdictValue = "-";
  let verdictDiagnostic = "";
  if (isRecord(releaseVerdict)) {
    verdictValue = String(releaseVerdict.value ?? "-");
    verdictDiagnostic = String(releaseVerdict.diagnostic ?? "");
  }

  const skipped: string[] = [];
  if (!hasDiff) {
    skipped.push("No diff evidence found in context.md.");
  }
  if (!hasVerification) {
    skipped.push("No verification evidence found in context.md.");
  }
  if (!hasReviews) {
    skipped.push("No reviewer output has been recorded yet.");
  }
  if (skipped.length === 0) {
    skipped.push("No missing evidence detected by AgentMesh.");
  }

  const recentEvents = limitEvents(events, 10);
  const lines = [
    "# Release Evidence Summary",
    "",
    "## Run",
    "",
    `- Status: ${status.status ?? "-"}`,
    `- Workflow: ${String(status.workflow ?? "-")}`,
    `- Completed stages: ${status.completed_stages?.join(", ") || "-"}`,
    `- Failed stage: ${String(status.failed_stage ?? "-")}`,
    `- Release verdict: ${verdictValue}`,
  ];
  if (verdictDiagnostic) {
    lines.push(`- Release verdict diagnostic: ${verdictDiagnostic}`);
  }
  lines.push(
    "",
    "## Evidence Inventory",
    "",
    `- Diff evidence: ${hasDiff ? "present" : "missing"}`,
    `- Verification evidence: ${hasVerification ? "present" : "missing"}`,
    `- Review outputs: ${hasReviews ? "present" : "missing"}`,
    `- Classified findings: ${hasFindings ? "present" : "missing"}`,
    `- Artifacts: ${Object.keys(artifacts).sort().join(", ") || "-"}`,
    `- Events recorded: ${events.length}`,
    "",
    "## Skipped Or Missing Evidence",
    "",
    ...skipped.map((item) => `- ${item}`),
    "",
    ...reviewReleasePolicySection(reviewReleasePolicy),
    ...releaseReviewerSessionProvenanceSection(reviewerSessionProvenance, independentResumedEvidence),
    "## Verification Evidence",
    "",
    summarizeSection(context, "Verification"),
    "",
    "## Residual Risk Signals",
    "",
    "### Not Verified",
    "",
    summarizeSection(handoff, "Not Verified"),
    "",
    "### Remaining Risk",
    "",
    summarizeSection(handoff, "Remaining Risk"),
    "",
    "## Controller Verification",
    "",
    controllerVerification,
    "",
    "## Review Findings",
    "",
    reviewFindings,
    "",
    "## Recent Events",
    "",
  );
  if (recentEvents.length > 0) {
    lines.push(...recentEvents.map((event) => `- ${formatEvent(event)}`));
  } else {
    lines.push("- none recorded");
  }
  lines.push("");
  return lines.join("\n");
}

function releaseReviewerSessionProvenanceSection(
  provenance: string,
  independentResumedEvidence: boolean,
): string[] {
  if (!provenance) return [];
  return [
    provenance,
    "",
    "- current_packet_evidence_remains_authoritative: true",
    "- hidden_provider_history: advisory",
    ...(independentResumedEvidence
      ? ["- independent_release_risk: needs_decision (session_resume)"]
      : []),
    "",
  ];
}

function reviewFindingsContent(findings: string, rawReviews: string): string {
  const content = withoutRawReviewOutputs(findings).trimEnd();
  if (!rawReviews) {
    return content || "- none recorded";
  }
  return `${content || "# Findings"}\n\n${rawReviews.trimEnd()}`;
}

function boundedRawReviewOutputsMarkdown(
  runDir: string,
  outputs: RawReviewOutput[],
): string {
  if (outputs.length === 0) {
    return "";
  }
  const sections = [RAW_REVIEW_OUTPUTS_HEADING, ""];
  for (const output of outputs) {
    const sourcePath = path.relative(runDir, output.path).split(path.sep).join("/");
    sections.push(
      `### ${output.reviewer}`,
      "",
      boundedRawReviewOutput(output.content, sourcePath),
      "",
    );
  }
  return `${sections.join("\n").trimEnd()}\n`;
}

function boundedRawReviewOutput(content: string, source: string): string {
  const trimmed = content.trimEnd();
  const originalBytes = Buffer.byteLength(trimmed, "utf-8");
  if (originalBytes <= MAX_RELEASE_RAW_REVIEW_OUTPUT_BYTES) {
    return trimmed;
  }
  const encoded = Buffer.from(trimmed, "utf-8");
  const end = utf8Boundary(encoded, MAX_RELEASE_RAW_REVIEW_OUTPUT_BYTES);
  const excerpt = encoded.toString("utf-8", 0, end).trimEnd();
  const excerptBytes = Buffer.byteLength(excerpt, "utf-8");
  return [
    excerpt,
    "",
    `> AgentMesh release summary truncated raw review output ${source}: showing ${excerptBytes}/${originalBytes} bytes. Full reviewer output remains in ${source}.`,
  ].join("\n");
}

function controllerVerificationContent(findings: string, rawReviews: string): string {
  const accepted = markdownSection(findings, "Accepted");
  const rejected = markdownSection(findings, "Rejected");
  const needsDecision = markdownSection(findings, "Needs Decision");
  return [
    "- Release gate source: controller-classified findings only",
    `- Raw reviewer Must Fix: ${containsMustFix(rawReviews) ? "evidence_only" : "missing"}`,
    `- Accepted Must Fix: ${containsMustFix(accepted) ? "present" : "missing"}`,
    `- Rejected Must Fix: ${containsMustFix(rejected) ? "present" : "missing"}`,
    `- Needs Decision Must Fix: ${containsMustFix(needsDecision) ? "present" : "missing"}`,
    `- Conflict source attribution: ${conflictSourceAttribution(findings)}`,
  ].join("\n");
}

export function refreshReleaseEvidenceSummary(
  runDir: string,
  status: PacketStatus,
): ReleaseSummaryResult {
  const summaryPath = path.join(runDir, RELEASE_SUMMARY_FILE);
  if (status.workflow !== BUILTIN_WORKFLOW_IDS.RELEASE_CHECK) {
    return {
      runDir,
      summaryPath,
      summary: "",
      written: false,
    };
  }
  const summary = buildReleaseEvidenceSummary(runDir, status);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(summaryPath, summary, { encoding: "utf-8" });
  saveStatus(runDir, status);
  recordArtifact(runDir, "release_summary", summaryPath, "release-summary", "review");
  return {
    runDir,
    summaryPath,
    summary,
    written: true,
  };
}

function reviewReleasePolicyWithEvidence(
  status: PacketStatus,
  inventory: ReleasePolicyEvidenceInventory,
): ResolvedReviewReleasePolicy | undefined {
  const policy = (status as Record<string, unknown>).resolved_review_release_policy;
  if (!isReviewReleasePolicy(policy)) {
    return undefined;
  }
  const resolved = applyReleasePolicyEvidence(policy, inventory);
  (status as Record<string, unknown>).resolved_review_release_policy = resolved;
  return resolved;
}

function isReviewReleasePolicy(value: unknown): value is ResolvedReviewReleasePolicy {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Array.isArray(value.source_layers) &&
    typeof value.policy_hash === "string" &&
    Array.isArray(value.required_review_profiles) &&
    Array.isArray(value.resolved_reviewers) &&
    Array.isArray(value.required_evidence) &&
    Array.isArray(value.needs_decision_risks)
  );
}

function reviewReleasePolicySection(
  policy: ResolvedReviewReleasePolicy | undefined,
): string[] {
  if (!policy) {
    return [];
  }
  const missingEvidence = policy.missing_evidence.length
    ? policy.missing_evidence.join(", ")
    : "none";
  const skippedGates = policy.skipped_gates.length
    ? policy.skipped_gates.join(", ")
    : "none";
  const policyWarnings = policy.profile_resolution_warnings?.length
    ? policy.profile_resolution_warnings.join(", ")
    : "none";
  return [
    "## Review/Release Policy",
    "",
    `- Source layers: ${formatSourceLayers(policy.source_layers)}`,
    `- Policy hash: ${policy.policy_hash}`,
    `- Required review profiles: ${policy.required_review_profiles.join(", ") || "-"}`,
    `- Resolved reviewers: ${formatResolvedReviewers(policy)}`,
    `- Policy warnings: ${policyWarnings}`,
    `- Required evidence: ${policy.required_evidence.join(", ") || "-"}`,
    `- Needs-decision risks: ${policy.needs_decision_risks.join(", ") || "-"}`,
    `- Missing policy evidence: ${missingEvidence}`,
    `- Skipped gates: ${skippedGates}`,
    "",
  ];
}

function formatSourceLayers(sources: ResolvedReviewReleasePolicy["source_layers"]): string {
  if (sources.length === 0) {
    return "-";
  }
  return sources.map((source) => `${source.source}:${source.path}`).join(", ");
}

function formatResolvedReviewers(policy: ResolvedReviewReleasePolicy): string {
  if (policy.resolved_reviewers.length === 0) {
    return "-";
  }
  return policy.resolved_reviewers
    .map((entry) => `${entry.profile} -> ${entry.agent_ids.join(", ") || "-"}`)
    .join("; ");
}

export function markdownSection(content: string, heading: string): string {
  const target = `## ${heading}`.toLocaleLowerCase();
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLocaleLowerCase() === target);
  if (start === -1) {
    return "";
  }
  const sectionLines: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    sectionLines.push(line);
  }
  return sectionLines.join("\n").trim();
}

export function sectionHasEvidence(section: string): boolean {
  const ignoredLines = new Set(["- TBD", "TBD", NO_SCOPED_DIFF_MARKER]);
  for (const line of section.split(/\r?\n/)) {
    const stripped = line.trim();
    if (stripped.length === 0) {
      continue;
    }
    if (stripped.startsWith("```")) {
      continue;
    }
    if (stripped.startsWith("### ")) {
      continue;
    }
    if (stripped.startsWith("Source: ")) {
      continue;
    }
    if (ignoredLines.has(stripped)) {
      continue;
    }
    return true;
  }
  return false;
}

function containsMustFix(content: string): boolean {
  return /\bmust\s+fix\b/i.test(content);
}

function conflictSourceAttribution(findings: string): "none" | "present" | "missing" {
  const conflictLines = classifiedFindingLines(findings).filter((line) =>
    /\b(conflict|contradict|contradiction)\b|矛盾/i.test(line),
  );
  if (conflictLines.length === 0) {
    return "none";
  }
  return conflictLines.every(hasReviewerSourceAttribution) ? "present" : "missing";
}

function classifiedFindingLines(findings: string): string[] {
  return ["Accepted", "Rejected", "Needs Decision"].flatMap((heading) =>
    markdownSection(findings, heading)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- ") && line !== "- TBD"),
  );
}

function hasReviewerSourceAttribution(line: string): boolean {
  return /\b(source|reviewer)\s*:/i.test(line);
}

export function scopedGitDiffHasEvidence(section: string): boolean {
  const withoutCommand = section
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("Command: "))
    .join("\n");
  return sectionHasEvidence(withoutCommand);
}

function summarizeSection(content: string, heading: string): string {
  const section = markdownSection(content, heading);
  if (!sectionHasEvidence(section)) {
    return "- none recorded";
  }
  return truncateContextContent(section).trimEnd();
}

function readRunFile(runDir: string, name: string): string {
  const filePath = path.join(runDir, name);
  if (!isFile(filePath)) {
    return "";
  }
  return readFileSync(filePath, { encoding: "utf-8" });
}

function safeLoadArtifacts(runDir: string): Record<string, unknown> {
  try {
    return loadArtifacts(runDir);
  } catch {
    return {};
  }
}

function safeLoadEvents(runDir: string): PacketEvent[] {
  try {
    return loadEvents(runDir);
  } catch {
    return [];
  }
}

function limitEvents(events: PacketEvent[], limit: number): PacketEvent[] {
  return events.slice(-limit);
}

function formatEvent(event: PacketEvent): string {
  const parts = [String(event.timestamp ?? "-"), String(event.event ?? "-")];
  for (const key of [
    "stage",
    "agent",
    "status",
    "artifact",
    "path",
    "exit_code",
    "failed_stage",
  ]) {
    if (key in event) {
      parts.push(`${key}=${String(event[key])}`);
    }
  }
  return parts.join(" ");
}

function truncateContextContent(content: string): string {
  const encoded = Buffer.from(content, "utf-8");
  if (encoded.byteLength <= MAX_CONTEXT_FILE_BYTES) {
    return content;
  }
  const end = utf8Boundary(encoded, MAX_CONTEXT_FILE_BYTES);
  return `${encoded.toString("utf-8", 0, end).trimEnd()}\n\n[AgentMesh: content truncated at ${MAX_CONTEXT_FILE_BYTES} bytes]`;
}

function utf8Boundary(encoded: Buffer, maxBytes: number): number {
  let end = Math.min(maxBytes, encoded.byteLength);
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return end;
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
