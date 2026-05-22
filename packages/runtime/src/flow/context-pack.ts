import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  redactContextContent,
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
      fileContextEntry(contextFile, "file", cwd),
      input.contextPolicy,
    ));
  }
  if (input.diffFile) {
    sections.push(contextEntrySection(
      "Diff",
      fileContextEntry(input.diffFile, "diff_file", cwd),
      input.contextPolicy,
    ));
  } else if (input.scopes?.length) {
    sections.push(contextEntrySection(
      "Scoped Git Diff",
      scopedGitDiffContextEntry(input.scopes, cwd),
      input.contextPolicy,
    ));
  }
  if (input.verificationFile) {
    sections.push(
      contextEntrySection(
        "Verification",
        fileContextEntry(input.verificationFile, "verification_file", cwd),
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
): ContextEntry {
  const resolvedPath = path.resolve(cwd, source);
  try {
    return {
      provenance: contextProvenance({
        source,
        sourceType,
        sourcePath: resolvedPath,
        validationState: "ok",
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

function scopedGitDiffContextEntry(scopes: string[], cwd: string): ContextEntry {
  const command = `git diff HEAD -- ${scopes.join(" ")}`;
  const result = spawnSync("git", ["diff", "HEAD", "--", ...scopes], {
    cwd,
    encoding: "utf-8",
    timeout: 10_000,
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
  return {
    provenance: contextProvenance({
      source: scopes.join(", "),
      sourceType: "scoped_git_diff",
      sourceCommand: command,
      validationState: "ok",
    }),
    content: (result.stdout ?? "").trimEnd() || "(no scoped diff)",
  };
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
    ...sourceCommandMarkerLines(context),
    "",
  ].join("\n");
  const markerBytes = Buffer.byteLength(marker, "utf-8");
  if (markerBytes >= maxBytes) {
    return truncateUtf8(marker, maxBytes).trimEnd();
  }
  const prefixBudget = maxBytes - markerBytes;
  const truncated = `${marker}${truncateUtf8(context, prefixBudget).trimEnd()}`;
  return Buffer.byteLength(truncated, "utf-8") <= maxBytes
    ? truncated
    : truncateUtf8(truncated, maxBytes).trimEnd();
}

function sourceCommandMarkerLines(context: string): string[] {
  const matches = [...context.matchAll(/^source_command = "([^"]+)"$/gm)];
  return matches.slice(0, 3).map((match) => `source_command = ${JSON.stringify(match[1])}`);
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
      try {
        const resources = await readMcpTextResources(
          stdioMcpServerConfig(serverConfig),
          group.map((item) => item.spec.resourceUri),
          {
            cache,
            onTiming: (timing) => recordMcpTiming(runtimeTiming, timing),
          },
        );
        group.forEach((item, resourceIndex) => {
          entries[item.index] = capturedMcpResourceContextEntry(
            item.spec,
            resources[resourceIndex],
          );
        });
      } catch (error) {
        for (const item of group) {
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
