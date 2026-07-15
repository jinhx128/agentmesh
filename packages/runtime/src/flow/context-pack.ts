import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  statSync,
} from "node:fs";
import path from "node:path";
import type {
  CorrectionRecord,
  ContextProvenance,
  ContextSourceType,
  ProjectSpec,
} from "@agentmesh/core";
import { listCorrections } from "../corrections/index.js";
import {
  McpClientError,
  closeMcpClientCache,
  createMcpClientCache,
  mcpIngestionError,
  readMcpTextResources,
  type McpClientTiming,
  type McpTextResource,
  type StdioMcpServerConfig,
} from "../mcp/client.js";
import type { McpResourceSpec } from "../mcp/resource.js";
import {
  contextPolicyMarkdown,
  hasContextPolicy,
  isInternalRunPath,
  redactContextContent,
  scopedGitPathspecs,
} from "./context-policy.js";
import {
  checkProjectSpec,
  loadProjectSpec,
  projectSpecPath,
} from "../spec/index.js";
import type { FlowRunInput } from "./types.js";

interface ContextEntry {
  provenance: ContextProvenance;
  content: string;
}

export async function buildContextPack(
  input: FlowRunInput,
  cwd: string,
  runtimeTiming?: FlowRunInput["runtimeTiming"],
): Promise<string> {
  const sections: string[] = [];
  if (input.contextPolicy && hasContextPolicy(input.contextPolicy)) {
    sections.push(contextPolicyMarkdown(input.contextPolicy));
  }
  for (const contextFile of input.contextFiles ?? []) {
    sections.push(contextEntrySection(
      "Context File",
      fileContextEntry(
        contextFile,
        "file",
        cwd,
        input.contextPolicy?.freshness_max_age_seconds,
      ),
      input.contextPolicy,
    ));
  }
  if (input.diffFile) {
    sections.push(contextEntrySection(
      "Diff",
      fileContextEntry(
        input.diffFile,
        "diff_file",
        cwd,
        input.contextPolicy?.freshness_max_age_seconds,
      ),
      input.contextPolicy,
    ));
  }
  if (input.scopes?.length) {
    sections.push(contextEntrySection(
      "Scoped Git Diff",
      scopedGitDiffContextEntry(input.scopes, cwd, input.contextPolicy?.max_bytes),
      input.contextPolicy,
    ));
  }
  if (input.verificationFile) {
    sections.push(
      contextEntrySection(
        "Verification",
        fileContextEntry(
          input.verificationFile,
          "verification_file",
          cwd,
          input.contextPolicy?.freshness_max_age_seconds,
        ),
        input.contextPolicy,
      ),
    );
  }
  for (const entry of await mcpResourceContextEntries(
    input.mcpResources ?? [],
    input.mcpServers ?? {},
    runtimeTiming,
  )) {
    sections.push(contextEntrySection("MCP Resource", entry, input.contextPolicy));
  }
  if (input.includeSpec) {
    sections.push(contextEntrySection("Project Spec", projectSpecContextEntry(cwd), input.contextPolicy));
  }
  for (const entry of correctionContextEntries(cwd, input.excludeCorrections ?? [])) {
    sections.push(contextEntrySection("Project Correction", entry, input.contextPolicy));
  }
  if (sections.length === 0) {
    return "";
  }
  return enforceGeneratedContextBudget(
    ["# Context", "", ...sections].join("\n").trimEnd() + "\n",
    input.contextPolicy,
  );
}

function projectSpecContextEntry(cwd: string): ContextEntry {
  const specPath = projectSpecPath(cwd);
  const report = checkProjectSpec(specPath);
  if (
    report.diagnostics.some((diagnostic) =>
      blocksProjectSpecIngestion(diagnostic.classification),
    )
  ) {
    return {
      provenance: contextProvenance({
        source: PROJECT_SPEC_CONTEXT_SOURCE,
        sourceType: "project_spec",
        sourcePath: specPath,
        validationState: "failed",
        ingestionError: report.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
      }),
      content: "(project spec unavailable)",
    };
  }
  try {
    const spec = loadProjectSpec(specPath);
    const validationState = report.ok ? "ok" : "failed";
    return {
      provenance: contextProvenance({
        source: PROJECT_SPEC_CONTEXT_SOURCE,
        sourceType: "project_spec",
        sourcePath: specPath,
        validationState,
        ingestionError: report.ok
          ? undefined
          : report.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
        freshness: spec.freshness.freshness,
        owner: spec.owner.owner,
      }),
      content: projectSpecMarkdown(spec),
    };
  } catch (error) {
    return {
      provenance: contextProvenance({
        source: PROJECT_SPEC_CONTEXT_SOURCE,
        sourceType: "project_spec",
        sourcePath: specPath,
        validationState: "failed",
        ingestionError: errorMessage(error),
      }),
      content: "(project spec unavailable)",
    };
  }
}

function correctionContextEntries(cwd: string, excludeIds: string[]): ContextEntry[] {
  const excluded = new Set(excludeIds);
  return listCorrections({ status: "active" }, cwd)
    .filter((entry) => !excluded.has(entry.record.id))
    .map((entry) => ({
      provenance: contextProvenance({
        source: entry.record.id,
        sourceType: "project_correction",
        sourcePath: entry.path,
        validationState: "ok",
        owner: entry.record.owner,
      }),
      content: correctionMarkdown(entry.record),
    }));
}

function fileContextEntry(
  source: string,
  sourceType: ContextSourceType,
  cwd: string,
  freshnessMaxAgeSeconds?: number,
): ContextEntry {
  const resolvedPath = path.resolve(cwd, source);
  try {
    return {
      provenance: contextProvenance({
        source,
        sourceType,
        sourcePath: resolvedPath,
        validationState: "ok",
        freshness: fileFreshness(resolvedPath, freshnessMaxAgeSeconds),
      }),
      content: readFileSync(resolvedPath, { encoding: "utf-8" }).trimEnd(),
    };
  } catch (error) {
    return {
      provenance: contextProvenance({
        source,
        sourceType,
        sourcePath: resolvedPath,
        validationState: "failed",
        ingestionError: errorMessage(error),
      }),
      content: "(context source unavailable)",
    };
  }
}

function fileFreshness(
  sourcePath: string,
  freshnessMaxAgeSeconds: number | undefined,
): ContextProvenance["freshness"] {
  if (freshnessMaxAgeSeconds === undefined) {
    return "fresh";
  }
  try {
    const ageMs = Math.max(0, Date.now() - statSync(sourcePath).mtimeMs);
    return ageMs > freshnessMaxAgeSeconds * 1000 ? "stale" : "fresh";
  } catch {
    return "unknown";
  }
}

function scopedGitDiffContextEntry(
  scopes: string[],
  cwd: string,
  policyMaxBytes?: number,
): ContextEntry {
  const maxBuffer = 64 * 1024 * 1024;
  const command = `git diff HEAD -- ${scopes.join(" ")}`;
  const pathspecs = scopedGitPathspecs(scopes);
  const result = spawnSync("git", ["diff", "HEAD", "--", ...pathspecs], {
    cwd,
    encoding: "utf-8",
    timeout: 10_000,
    maxBuffer,
  });
  if (result.error) {
    return {
      provenance: contextProvenance({
        source: scopes.join(", "),
        sourceType: "scoped_git_diff",
        sourceCommand: command,
        validationState: "failed",
        ingestionError: result.error.message,
      }),
      content: `git diff failed: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    const content = `git diff failed with exit code ${result.status ?? "unknown"}\n${result.stderr ?? ""}`.trimEnd();
    return {
      provenance: contextProvenance({
        source: scopes.join(", "),
        sourceType: "scoped_git_diff",
        sourceCommand: command,
        validationState: "failed",
        ingestionError: content,
      }),
      content,
    };
  }
  const untracked = spawnSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspecs],
    {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer,
    },
  );
  const trackedDiff = (result.stdout ?? "").trimEnd();
  if (untracked.error || untracked.status !== 0) {
    const ingestionError = gitCommandError("git ls-files", untracked);
    const content = [
      trackedDiff,
      [
        "AGENTMESH_UNTRACKED_ENUMERATION_FAILED",
        `error = ${JSON.stringify(ingestionError)}`,
      ].join("\n"),
    ].filter(Boolean).join("\n\n");
    return {
      provenance: contextProvenance({
        source: scopes.join(", "),
        sourceType: "scoped_git_diff",
        sourceCommand: command,
        validationState: "failed",
        ingestionError,
      }),
      content,
    };
  }
  const untrackedPaths = (untracked.stdout ?? "")
    .split("\0")
    .filter(Boolean)
    .filter((filePath) => !isInternalRunPath(filePath, cwd));
  const untrackedCaptures = captureUntrackedFiles(untrackedPaths, cwd, policyMaxBytes);
  const untrackedDiff = untrackedCaptures
    .map((capture) => capture.content)
    .filter(Boolean)
    .join("\n\n");
  const diff = [
    trackedDiff,
    untrackedDiff,
  ].filter(Boolean).join("\n\n");
  const captureErrors = untrackedCaptures
    .map((capture) => capture.error)
    .filter((error): error is string => error !== undefined);
  return {
    provenance: contextProvenance({
      source: scopes.join(", "),
      sourceType: "scoped_git_diff",
      sourceCommand: command,
      validationState: captureErrors.length === 0 ? "ok" : "failed",
      ingestionError: captureErrors.length === 0 ? undefined : captureErrors.join("; "),
    }),
    content: diff || "(no scoped diff)",
  };
}

interface UntrackedFileCapture {
  content: string;
  capturedBytes: number;
  error?: string;
}

class UntrackedCaptureError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "UntrackedCaptureError";
  }
}

const DEFAULT_UNTRACKED_FILE_MAX_BYTES = 256 * 1024;
const DEFAULT_UNTRACKED_TOTAL_MAX_BYTES = 1024 * 1024;
const DEFAULT_UNTRACKED_MAX_FILES = 128;

type UntrackedFileCaptureResult =
  | { kind: "captured"; capture: UntrackedFileCapture }
  | { kind: "aggregate_byte_limit"; requiredBytes: number };

function captureUntrackedFiles(
  filePaths: string[],
  cwd: string,
  policyMaxBytes?: number,
): UntrackedFileCapture[] {
  const maxFileBytes = Math.min(
    policyMaxBytes ?? DEFAULT_UNTRACKED_FILE_MAX_BYTES,
    DEFAULT_UNTRACKED_FILE_MAX_BYTES,
  );
  const maxTotalBytes = Math.min(
    policyMaxBytes ?? DEFAULT_UNTRACKED_TOTAL_MAX_BYTES,
    DEFAULT_UNTRACKED_TOTAL_MAX_BYTES,
  );
  const captures: UntrackedFileCapture[] = [];
  let capturedBytes = 0;
  for (let index = 0; index < filePaths.length; index += 1) {
    if (captures.length >= DEFAULT_UNTRACKED_MAX_FILES) {
      captures.push(untrackedCaptureLimitMarker({
        reason: "file_count_limit",
        processedFiles: captures.length,
        capturedBytes,
        omittedFiles: filePaths.length - index,
        maxFiles: DEFAULT_UNTRACKED_MAX_FILES,
        maxBytes: maxTotalBytes,
      }));
      break;
    }
    const result = untrackedFileDiff(
      filePaths[index],
      cwd,
      maxFileBytes,
      maxTotalBytes - capturedBytes,
    );
    if (result.kind === "aggregate_byte_limit") {
      captures.push(untrackedCaptureLimitMarker({
        reason: "byte_limit",
        processedFiles: captures.length,
        capturedBytes,
        omittedFiles: filePaths.length - index,
        maxFiles: DEFAULT_UNTRACKED_MAX_FILES,
        maxBytes: maxTotalBytes,
        nextFileBytes: result.requiredBytes,
      }));
      break;
    }
    captures.push(result.capture);
    capturedBytes += result.capture.capturedBytes;
  }
  return captures;
}

function untrackedFileDiff(
  filePath: string,
  cwd: string,
  maxFileBytes: number,
  remainingTotalBytes: number,
): UntrackedFileCaptureResult {
  const resolvedPath = path.resolve(cwd, filePath);
  try {
    const initialStat = lstatSync(resolvedPath);
    if (initialStat.isSymbolicLink()) {
      const linkTarget = readlinkSync(resolvedPath);
      const linkTargetBytes = Buffer.byteLength(linkTarget, "utf-8");
      if (linkTargetBytes > remainingTotalBytes) {
        return { kind: "aggregate_byte_limit", requiredBytes: linkTargetBytes };
      }
      return {
        kind: "captured",
        capture: {
          content: renderUntrackedTextDiff(filePath, linkTarget, "120000"),
          capturedBytes: linkTargetBytes,
        },
      };
    }
    if (!initialStat.isFile()) {
      return {
        kind: "captured",
        capture: omittedUntrackedFile(
          filePath,
          "unsupported_file_type",
          `untracked path is not a regular file: ${filePath}`,
        ),
      };
    }

    const descriptor = openUntrackedRegularFileForCapture(
      resolvedPath,
      constants.O_NOFOLLOW as number | undefined,
    );
    try {
      const openedStat = fstatSync(descriptor);
      if (!openedStat.isFile()) {
        return {
          kind: "captured",
          capture: omittedUntrackedFile(
            filePath,
            "unsupported_file_type",
            `untracked path changed before capture: ${filePath}`,
          ),
        };
      }
      const fileMode = openedStat.mode & 0o111 ? "100755" : "100644";
      if (openedStat.size > maxFileBytes) {
        return {
          kind: "captured",
          capture: omittedUntrackedFile(
            filePath,
            "file_too_large",
            `untracked file exceeds capture limit: ${filePath} (${openedStat.size} > ${maxFileBytes} bytes)`,
            { sizeBytes: openedStat.size, maxBytes: maxFileBytes },
            fileMode,
          ),
        };
      }
      if (openedStat.size > remainingTotalBytes) {
        return { kind: "aggregate_byte_limit", requiredBytes: openedStat.size };
      }
      const content = readBoundedFile(descriptor, openedStat.size);
      if (content.includes(0)) {
        return {
          kind: "captured",
          capture: omittedUntrackedFile(
            filePath,
            "binary_file",
            `untracked binary file omitted: ${filePath}`,
            { sizeBytes: content.byteLength },
            fileMode,
            `Binary files /dev/null and b/${filePath} differ`,
            content.byteLength,
          ),
        };
      }
      return {
        kind: "captured",
        capture: {
          content: renderUntrackedTextDiff(filePath, content.toString("utf-8"), fileMode),
          capturedBytes: content.byteLength,
        },
      };
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    const message = `untracked file capture failed: ${filePath}: ${errorMessage(error)}`;
    const reason = error instanceof UntrackedCaptureError
      ? error.reason
      : "capture_failed";
    return {
      kind: "captured",
      capture: omittedUntrackedFile(filePath, reason, message),
    };
  }
}

export function openUntrackedRegularFileForCapture(
  resolvedPath: string,
  noFollowFlag: number | undefined,
): number {
  if (noFollowFlag === undefined) {
    throw new UntrackedCaptureError(
      "no_secure_open",
      "secure no-follow open is unavailable on this platform",
    );
  }
  return openSync(resolvedPath, constants.O_RDONLY | noFollowFlag);
}

function readBoundedFile(descriptor: number, size: number): Buffer {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const bytesRead = readSync(descriptor, buffer, offset, buffer.byteLength - offset, offset);
    if (bytesRead === 0) {
      break;
    }
    offset += bytesRead;
  }
  return offset === buffer.byteLength ? buffer : buffer.subarray(0, offset);
}

function renderUntrackedTextDiff(filePath: string, content: string, fileMode: string): string {
  const header = [
    `diff --git a/${filePath} b/${filePath}`,
    `new file mode ${fileMode}`,
  ];
  if (content.length === 0) {
    return header.join("\n");
  }
  const endsWithNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (endsWithNewline) {
    lines.pop();
  }
  const normalizedLines = lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
  const lineCount = normalizedLines.length;
  const hunkRange = lineCount === 1 ? "+1" : `+1,${lineCount}`;
  return [
    ...header,
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 ${hunkRange} @@`,
    ...normalizedLines.map((line) => `+${line}`),
    ...(!endsWithNewline ? ["\\ No newline at end of file"] : []),
  ].join("\n");
}

function omittedUntrackedFile(
  filePath: string,
  reason: string,
  error: string,
  details: { sizeBytes?: number; maxBytes?: number } = {},
  fileMode = "100644",
  diffMarker?: string,
  capturedBytes = 0,
): UntrackedFileCapture {
  return {
    content: [
      `diff --git a/${filePath} b/${filePath}`,
      `new file mode ${fileMode}`,
      ...(diffMarker ? [diffMarker] : []),
      "AGENTMESH_UNTRACKED_FILE_OMITTED",
      `path = ${JSON.stringify(filePath)}`,
      `reason = ${JSON.stringify(reason)}`,
      ...(details.sizeBytes === undefined ? [] : [`size_bytes = ${details.sizeBytes}`]),
      ...(details.maxBytes === undefined ? [] : [`max_bytes = ${details.maxBytes}`]),
    ].join("\n"),
    capturedBytes,
    error,
  };
}

function untrackedCaptureLimitMarker(input: {
  reason: "file_count_limit" | "byte_limit";
  processedFiles: number;
  capturedBytes: number;
  omittedFiles: number;
  maxFiles: number;
  maxBytes: number;
  nextFileBytes?: number;
}): UntrackedFileCapture {
  const error = `untracked capture ${input.reason} reached after processing ${input.processedFiles} files and ${input.capturedBytes} bytes`;
  return {
    content: [
      "AGENTMESH_UNTRACKED_CAPTURE_LIMIT_REACHED",
      `reason = ${JSON.stringify(input.reason)}`,
      `processed_files = ${input.processedFiles}`,
      `captured_bytes = ${input.capturedBytes}`,
      `omitted_files = ${input.omittedFiles}`,
      `max_files = ${input.maxFiles}`,
      `max_bytes = ${input.maxBytes}`,
      ...(input.nextFileBytes === undefined
        ? []
        : [`next_file_bytes = ${input.nextFileBytes}`]),
    ].join("\n"),
    capturedBytes: 0,
    error,
  };
}

function gitCommandError(
  command: string,
  result: ReturnType<typeof spawnSync>,
): string {
  if (result.error) {
    return `${command} failed: ${result.error.message}`;
  }
  const stderr = typeof result.stderr === "string"
    ? result.stderr.trim()
    : result.stderr?.toString("utf-8").trim();
  return `${command} failed with exit code ${result.status ?? "unknown"}${stderr ? `: ${stderr}` : ""}`;
}

function enforceGeneratedContextBudget(
  context: string,
  policy: FlowRunInput["contextPolicy"],
): string {
  const maxBytes = policy?.max_bytes;
  if (maxBytes === undefined) {
    return context;
  }
  const originalBytes = Buffer.byteLength(context, "utf-8");
  if (originalBytes <= maxBytes) {
    return context;
  }
  return truncateContextWithBudgetMarker(context, maxBytes, originalBytes);
}

function truncateContextWithBudgetMarker(
  context: string,
  maxBytes: number,
  originalBytes: number,
): string {
  const marker = [
    "AGENTMESH_CONTEXT_TRUNCATED",
    `max_bytes = ${maxBytes}`,
    `original_bytes = ${originalBytes}`,
    ...sourceReferenceMarkerLines(context),
    "",
  ].join("\n");
  const markerBytes = Buffer.byteLength(marker, "utf-8");
  if (markerBytes >= maxBytes) {
    return truncateUtf8(marker, maxBytes).trimEnd();
  }
  const omission = "\n\nAGENTMESH_CONTEXT_OMITTED\n\n";
  const omissionBytes = Buffer.byteLength(omission, "utf-8");
  if (markerBytes + omissionBytes >= maxBytes) {
    return `${marker}${truncateUtf8(context, maxBytes - markerBytes)}`.trimEnd();
  }
  const excerptBudget = maxBytes - markerBytes - omissionBytes;
  const headBudget = Math.floor(excerptBudget * 0.6);
  const tailBudget = excerptBudget - headBudget;
  const truncated = [
    marker,
    truncateUtf8(context, headBudget).trimEnd(),
    omission,
    truncateUtf8Tail(context, tailBudget).trimStart(),
  ].join("");
  return Buffer.byteLength(truncated, "utf-8") <= maxBytes
    ? truncated
    : truncateUtf8(truncated, maxBytes).trimEnd();
}

function sourceReferenceMarkerLines(context: string): string[] {
  const matches = [...context.matchAll(/^(source_path|source_uri|source_command) = (.+)$/gm)];
  return matches.slice(0, 6).map((match) => `${match[1]} = ${match[2]}`);
}

function truncateUtf8(content: string, maxBytes: number): string {
  const encoded = Buffer.from(content, "utf-8");
  if (encoded.byteLength <= maxBytes) {
    return content;
  }
  let end = Math.min(maxBytes, encoded.byteLength);
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return encoded.toString("utf-8", 0, end);
}

function truncateUtf8Tail(content: string, maxBytes: number): string {
  const encoded = Buffer.from(content, "utf-8");
  if (encoded.byteLength <= maxBytes) {
    return content;
  }
  let start = Math.max(0, encoded.byteLength - maxBytes);
  while (start < encoded.byteLength && (encoded[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return encoded.toString("utf-8", start);
}

async function mcpResourceContextEntries(
  specs: McpResourceSpec[],
  mcpServers: Record<string, Record<string, unknown>>,
  runtimeTiming?: FlowRunInput["runtimeTiming"],
): Promise<ContextEntry[]> {
  const entries = new Array<ContextEntry>(specs.length);
  const cache = createMcpClientCache();
  const grouped = new Map<string, Array<{ spec: McpResourceSpec; index: number }>>();
  specs.forEach((spec, index) => {
    const group = grouped.get(spec.serverId) ?? [];
    group.push({ spec, index });
    grouped.set(spec.serverId, group);
  });

  try {
    for (const [serverId, group] of grouped.entries()) {
      const serverConfig = mcpServers[serverId];
      if (!serverConfig) {
        for (const item of group) {
          entries[item.index] = failedMcpResourceContextEntry(
            item.spec,
            new McpClientError("unknown", `MCP server config unavailable: ${serverId}`),
          );
        }
        continue;
      }
      for (const item of group) {
        try {
          const resources = await readMcpTextResources(
            stdioMcpServerConfig(serverConfig),
            [item.spec.resourceUri],
            {
              cache,
              onTiming: (timing) => recordMcpTiming(runtimeTiming, timing),
            },
          );
          entries[item.index] = capturedMcpResourceContextEntry(
            item.spec,
            resources[0],
          );
        } catch (error) {
          entries[item.index] = failedMcpResourceContextEntry(item.spec, error);
        }
      }
    }
  } finally {
    await closeMcpClientCache(cache);
  }

  return entries;
}

function recordMcpTiming(
  runtimeTiming: FlowRunInput["runtimeTiming"],
  timing: McpClientTiming,
): void {
  if (!runtimeTiming) {
    return;
  }
  runtimeTiming.mcp_connect_ms = (runtimeTiming.mcp_connect_ms ?? 0) + timing.mcp_connect_ms;
  if (timing.cache_hit) {
    runtimeTiming.mcp_cache_hits = (runtimeTiming.mcp_cache_hits ?? 0) + 1;
  } else {
    runtimeTiming.mcp_cache_misses = (runtimeTiming.mcp_cache_misses ?? 0) + 1;
  }
}

function capturedMcpResourceContextEntry(
  spec: McpResourceSpec,
  resource: McpTextResource,
): ContextEntry {
  return {
    provenance: contextProvenance({
      source: spec.raw,
      sourceType: "mcp_resource",
      sourceUri: resource.uri,
      validationState: "ok",
    }),
    content: resource.text.trimEnd(),
  };
}

function failedMcpResourceContextEntry(spec: McpResourceSpec, error: unknown): ContextEntry {
  return {
    provenance: contextProvenance({
      source: spec.raw,
      sourceType: "mcp_resource",
      sourceUri: spec.resourceUri,
      validationState: "failed",
      ingestionError: mcpIngestionError(error),
    }),
    content: "(mcp resource unavailable)",
  };
}

function stdioMcpServerConfig(config: Record<string, unknown>): StdioMcpServerConfig {
  return {
    command: config.command as string,
    args: Array.isArray(config.args) ? config.args.filter(isString) : [],
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function contextEntrySection(
  title: string,
  entry: ContextEntry,
  policy?: FlowRunInput["contextPolicy"],
): string {
  const redacted = policy
    ? redactContextContent(entry.content, policy)
    : { content: entry.content, redacted: false };
  const provenance = redacted.redacted
    ? { ...entry.provenance, redaction_state: "redacted" as const }
    : entry.provenance;
  return [
    `## ${title}`,
    "",
    "### Provenance",
    "",
    provenanceToml(provenance),
    "",
    "### Content",
    "",
    redacted.content,
    "",
  ].join("\n");
}

function contextProvenance(input: {
  source: string;
  sourceType: ContextSourceType;
  sourcePath?: string;
  sourceUri?: string;
  sourceCommand?: string;
  validationState: ContextProvenance["validation_state"];
  ingestionError?: string;
  freshness?: ContextProvenance["freshness"];
  owner?: string;
}): ContextProvenance {
  return {
    schema_version: 1,
    source_type: input.sourceType,
    source: input.source,
    ...(input.sourcePath ? { source_path: input.sourcePath } : {}),
    ...(input.sourceUri ? { source_uri: input.sourceUri } : {}),
    ...(input.sourceCommand ? { source_command: input.sourceCommand } : {}),
    capture_timestamp: new Date().toISOString(),
    freshness: input.freshness ?? (input.validationState === "ok" ? "fresh" : "unknown"),
    owner: input.owner ?? "unknown",
    validation_state: input.validationState,
    ingestion_error: input.ingestionError ?? null,
    redaction_state: "none",
  };
}

const PROJECT_SPEC_CONTEXT_SOURCE = ".agentmesh/spec/project.toml";

function blocksProjectSpecIngestion(classification: string): boolean {
  return [
    "malformed_spec",
    "missing_required_field",
    "missing_spec",
  ].includes(classification);
}

function projectSpecMarkdown(spec: ProjectSpec): string {
  const lines = [
    `Project: ${spec.project.name ?? spec.project.id}`,
    `Project ID: ${spec.project.id}`,
  ];
  if (spec.project.description) {
    lines.push(`Description: ${spec.project.description}`);
  }
  lines.push("", "Key Commands:");
  for (const command of spec.key_commands) {
    const details = command.description ? ` — ${command.description}` : "";
    lines.push(`- ${command.id}: \`${command.command}\`${details}`);
  }
  lines.push("", "Constraints:");
  if (spec.constraints.length === 0) {
    lines.push("- None recorded.");
  } else {
    for (const constraint of spec.constraints) {
      const scope = constraint.scope ? ` [${constraint.scope}]` : "";
      lines.push(`- ${constraint.id}${scope}: ${constraint.statement}`);
    }
  }
  lines.push("", "Known Risks:");
  if (spec.risks.length === 0) {
    lines.push("- None recorded.");
  } else {
    for (const risk of spec.risks) {
      const mitigation = risk.mitigation ? ` Mitigation: ${risk.mitigation}` : "";
      lines.push(`- ${risk.id} (${risk.status}): ${risk.statement}${mitigation}`);
    }
  }
  lines.push(
    "",
    `Freshness: ${spec.freshness.freshness} (updated_at: ${spec.freshness.updated_at})`,
    `Owner: ${spec.owner.owner}`,
    `Validation: ${spec.validation.validation_state}`,
  );
  if (spec.validation.message) {
    lines.push(`Validation Message: ${spec.validation.message}`);
  }
  return lines.join("\n");
}

function correctionMarkdown(correction: CorrectionRecord): string {
  const lines = [
    `Correction ID: ${correction.id}`,
    `Scope: ${correction.scope}`,
    `Statement: ${correction.statement}`,
    `Source: ${correction.source}`,
    `Created At: ${correction.created_at}`,
    `Status: ${correction.status}`,
  ];
  if (correction.supersedes.length > 0) {
    lines.push(`Supersedes: ${correction.supersedes.join(", ")}`);
  }
  return lines.join("\n");
}

function provenanceToml(provenance: ContextProvenance): string {
  const orderedKeys: Array<keyof ContextProvenance> = [
    "schema_version",
    "source_type",
    "source",
    "source_path",
    "source_uri",
    "source_command",
    "capture_timestamp",
    "freshness",
    "owner",
    "validation_state",
    "ingestion_error",
    "redaction_state",
  ];
  const lines = ["```toml"];
  for (const key of orderedKeys) {
    const value = provenance[key];
    if (value === undefined) {
      continue;
    }
    lines.push(`${key} = ${JSON.stringify(value)}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
