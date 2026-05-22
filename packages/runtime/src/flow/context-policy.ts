import { statSync } from "node:fs";
import path from "node:path";

import type { ContextPolicyConfig } from "../config.js";
import type { FlowRunInput } from "./types.js";

export interface ResolvedContextPolicy extends ContextPolicyConfig {}

export interface ContextPolicyPreparedInput {
  contextFiles: string[];
  policy: ResolvedContextPolicy;
}

export function prepareContextPolicyInput(
  input: Pick<FlowRunInput, "contextFiles" | "diffFile" | "verificationFile" | "scopes">,
  policy: ResolvedContextPolicy,
  cwd: string,
): ContextPolicyPreparedInput {
  const requiredSources = [...policy.required_sources];
  const contextFiles = uniqueStrings([...requiredSources, ...(input.contextFiles ?? [])]);
  const fileSources = [
    ...contextFiles,
    ...(input.diffFile ? [input.diffFile] : []),
    ...(input.verificationFile ? [input.verificationFile] : []),
    ...(input.scopes ?? []),
  ];
  assertRedactPatterns(policy.redact_patterns);
  assertDeniedPaths(fileSources, policy, cwd);
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

function fileSizeIfReadable(source: string, cwd: string): number {
  try {
    const stat = statSync(path.resolve(cwd, source));
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function isDeniedPath(source: string, deniedPaths: string[], cwd: string): boolean {
  const resolvedSource = path.resolve(cwd, source);
  return deniedPaths.some((deniedPath) => {
    const resolvedDenied = path.resolve(cwd, deniedPath);
    const relative = path.relative(resolvedDenied, resolvedSource);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
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
