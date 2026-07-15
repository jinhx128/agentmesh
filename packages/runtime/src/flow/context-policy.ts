import { spawnSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";

import type { ContextPolicyConfig } from "../config.js";
import { listCorrections } from "../corrections/index.js";
import { projectSpecPath } from "../spec/index.js";
import type { FlowRunInput } from "./types.js";

export interface ResolvedContextPolicy extends ContextPolicyConfig {}

export interface ContextPolicyPreparedInput {
  contextFiles: string[];
  policy: ResolvedContextPolicy;
}

const INTERNAL_RUN_PATHSPECS = [
  ":(exclude).agentmesh/runs",
  ":(exclude).agentmesh/runs/**",
];

export function scopedGitPathspecs(scopes: string[]): string[] {
  return [...scopes, ...INTERNAL_RUN_PATHSPECS];
}

export function isInternalRunPath(filePath: string, cwd?: string): boolean {
  const relativePath = path.isAbsolute(filePath) && cwd
    ? path.relative(cwd, filePath)
    : filePath;
  const normalized = path.posix
    .normalize(relativePath.replaceAll("\\", "/"))
    .replace(/^\.\//, "");
  return normalized === ".agentmesh/runs" || normalized.startsWith(".agentmesh/runs/");
}

export function prepareContextPolicyInput(
  input: Pick<
    FlowRunInput,
    | "contextFiles"
    | "diffFile"
    | "verificationFile"
    | "scopes"
    | "includeSpec"
    | "excludeCorrections"
  >,
  policy: ResolvedContextPolicy,
  cwd: string,
): ContextPolicyPreparedInput {
  const requiredSources = [...policy.required_sources];
  const contextFiles = uniqueStrings([...requiredSources, ...(input.contextFiles ?? [])]);
  const fileSources = uniqueResolvedSources([
    ...contextFiles,
    ...(input.diffFile ? [input.diffFile] : []),
    ...(input.verificationFile ? [input.verificationFile] : []),
  ], cwd);
  const policySources = uniqueResolvedSources([
    ...fileSources,
    ...(input.scopes ?? []).filter((scope) => !isInternalRunPath(scope, cwd)),
    ...generatedFileSources(input, cwd),
  ], cwd);
  assertRedactPatterns(policy.redact_patterns);
  assertDeniedPaths(policySources, policy, cwd);
  assertScopedPathsAllowed(input.scopes ?? [], policy, cwd);
  assertRequiredSources(requiredSources, cwd);
  assertFileLimits(fileSources, policy, cwd);
  return {
    contextFiles,
    policy,
  };
}

export function hasContextPolicy(policy: ResolvedContextPolicy): boolean {
  return (
    policy.max_bytes !== undefined ||
    policy.max_files !== undefined ||
    policy.freshness_max_age_seconds !== undefined ||
    policy.required_sources.length > 0 ||
    policy.denied_paths.length > 0 ||
    policy.redact_patterns.length > 0
  );
}

export function contextPolicyMarkdown(policy: ResolvedContextPolicy): string {
  const lines = ["## Resolved Context Policy", ""];
  if (policy.max_bytes !== undefined) {
    lines.push(`max_bytes = ${policy.max_bytes}`);
  }
  if (policy.max_files !== undefined) {
    lines.push(`max_files = ${policy.max_files}`);
  }
  if (policy.freshness_max_age_seconds !== undefined) {
    lines.push(`freshness_max_age_seconds = ${policy.freshness_max_age_seconds}`);
  }
  lines.push(`required_sources = ${jsonArray(policy.required_sources)}`);
  lines.push(`denied_paths = ${jsonArray(policy.denied_paths)}`);
  lines.push(`redact_patterns = ${jsonArray(policy.redact_patterns)}`);
  lines.push("");
  return lines.join("\n");
}

export function redactContextContent(content: string, policy: ResolvedContextPolicy): {
  content: string;
  redacted: boolean;
} {
  let redactedContent = content;
  let redacted = false;
  for (const pattern of policy.redact_patterns) {
    const next = redactedContent.replace(new RegExp(pattern, "g"), (match) => {
      redacted = true;
      const equalsIndex = match.indexOf("=");
      return equalsIndex === -1 ? "[REDACTED]" : `${match.slice(0, equalsIndex + 1)}[REDACTED]`;
    });
    redactedContent = next;
  }
  return { content: redactedContent, redacted };
}

function assertRedactPatterns(patterns: string[]): void {
  for (const pattern of patterns) {
    try {
      new RegExp(pattern);
    } catch (error) {
      throw new Error(
        `context_policy.redact_patterns contains invalid regex: ${pattern} (${errorMessage(error)})`,
      );
    }
  }
}

function assertDeniedPaths(
  sources: string[],
  policy: ResolvedContextPolicy,
  cwd: string,
): void {
  for (const source of sources) {
    if (isDeniedPath(source, policy.denied_paths, cwd)) {
      throw new Error(`context source is denied by context_policy: ${source}`);
    }
  }
}

function assertScopedPathsAllowed(
  scopes: string[],
  policy: ResolvedContextPolicy,
  cwd: string,
): void {
  if (scopes.length === 0 || policy.denied_paths.length === 0) {
    return;
  }
  const pathspecs = scopedGitPathspecs(scopes);
  const result = spawnSync("git", ["diff", "--name-only", "-z", "HEAD", "--", ...pathspecs], {
    cwd,
    encoding: "utf-8",
    timeout: 10_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `cannot validate scoped context against context_policy.denied_paths: ${result.error?.message ?? result.stderr ?? `git exit ${result.status ?? "unknown"}`}`,
    );
  }
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspecs], {
    cwd,
    encoding: "utf-8",
    timeout: 10_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (untracked.error || untracked.status !== 0) {
    throw new Error(
      `cannot validate untracked scoped context against context_policy.denied_paths: ${untracked.error?.message ?? untracked.stderr ?? `git exit ${untracked.status ?? "unknown"}`}`,
    );
  }
  const changedPaths = [
    ...(result.stdout ?? "").split("\0").filter(Boolean),
    ...(untracked.stdout ?? "").split("\0").filter(Boolean),
  ].filter((filePath) => !isInternalRunPath(filePath, cwd));
  assertDeniedPaths(changedPaths, policy, cwd);
}

function generatedFileSources(
  input: Pick<FlowRunInput, "includeSpec" | "excludeCorrections">,
  cwd: string,
): string[] {
  const sources = input.includeSpec ? [projectSpecPath(cwd)] : [];
  const excluded = new Set(input.excludeCorrections ?? []);
  sources.push(
    ...listCorrections({ status: "active" }, cwd)
      .filter((entry) => !excluded.has(entry.record.id))
      .map((entry) => entry.path),
  );
  return sources;
}

function assertRequiredSources(sources: string[], cwd: string): void {
  for (const source of sources) {
    try {
      if (!statSync(path.resolve(cwd, source)).isFile()) {
        throw new Error("not a file");
      }
    } catch {
      throw new Error(`required context source not found: ${source}`);
    }
  }
}

function assertFileLimits(
  sources: string[],
  policy: ResolvedContextPolicy,
  cwd: string,
): void {
  if (policy.max_files !== undefined && sources.length > policy.max_files) {
    throw new Error(
      `context_policy max_files exceeded: ${sources.length} > ${policy.max_files}`,
    );
  }
  if (policy.max_bytes === undefined) {
    return;
  }
  const totalBytes = sources.reduce((total, source) => total + fileSizeIfReadable(source, cwd), 0);
  if (totalBytes > policy.max_bytes) {
    throw new Error(
      `context_policy max_bytes exceeded: ${totalBytes} > ${policy.max_bytes}`,
    );
  }
}

function uniqueResolvedSources(sources: string[], cwd: string): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const resolved = path.resolve(cwd, source);
    const comparison = existingPath(resolved);
    if (seen.has(comparison)) {
      continue;
    }
    seen.add(comparison);
    output.push(source);
  }
  return output;
}

function fileSizeIfReadable(source: string, cwd: string): number {
  try {
    const stat = statSync(path.resolve(cwd, source));
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function isDeniedPath(source: string, deniedPaths: string[], cwd: string): boolean {
  const resolvedSource = existingPath(path.resolve(cwd, source));
  return deniedPaths.some((deniedPath) => {
    const resolvedDenied = existingPath(path.resolve(cwd, deniedPath));
    const relative = path.relative(resolvedDenied, resolvedSource);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function existingPath(candidate: string): string {
  try {
    return realpathSync.native(candidate);
  } catch {
    return candidate;
  }
}

function uniqueStrings(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

function jsonArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
