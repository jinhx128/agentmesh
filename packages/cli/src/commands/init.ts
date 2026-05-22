import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BUILTIN_WORKFLOW_IDS } from "@agentmesh/core";

import { optionValue } from "../flags.js";

const DEFAULT_CONFIG_TEMPLATE = `schema_version = 1

# Checkout-local AgentMesh config.
#
# agentmesh init keeps .agentmesh/ in .gitignore. Each teammate should create
# their own local config after cloning or pulling the repository; this file is
# not meant to be shared through normal project commits.
#
# Register personal CLI agents once with:
# agentmesh agents add --adapter <adapter> --model <model-or-alias>
# AgentMesh generates a short internal id, derives the default label from the
# canonical model, and runs a readiness probe before writing config.
# --skip-verify is diagnostic-only and does not write config; run without it
# after readiness succeeds.
# This writes to ~/.config/agentmesh/config.toml by default so agents can be
# reused across projects.
#
# Put reusable personal workflows in:
# ~/.config/agentmesh/workflows/
#
# Put reusable personal presets in:
# ~/.config/agentmesh/presets/
#
# Put reusable personal MCP servers in:
# ~/.config/agentmesh/config.toml
#
# Common checkout-local project sections:
#
# [workflow_defaults.${BUILTIN_WORKFLOW_IDS.BUG_FIX}]
# plan = "planner"
# execute = "executor"
# verify = "verifier"
# review = ["reviewer"]
# decide = "decider"
#
# Optional context budget guardrail. Bytes are a conservative token-cost proxy,
# not exact tokenizer output. Keep this commented until the project agrees on
# defaults that fit its normal run shape.
#
# [context_policy]
# max_files = 12
# max_bytes = 262144
# denied_paths = [".agentmesh/runs", "docs/archive", "dist-node", "node_modules"]
# redact_patterns = ["API_KEY=[A-Za-z0-9]+"]
`;

export function init(args: string[]): number {
  const output = optionValue(args, "--output") ?? ".agentmesh/config.toml";
  const force = args.includes("--force");
  const outputPath = path.resolve(output);
  if (existsSync(outputPath) && !force) {
    throw new Error(`config already exists: ${output}`);
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, DEFAULT_CONFIG_TEMPLATE, { encoding: "utf-8" });
  console.log(`Wrote: ${output}`);
  const gitignorePath = path.join(projectRootForInit(outputPath), ".gitignore");
  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, { encoding: "utf-8" })
    : "";
  const nextGitignore = agentmeshGitignoreContent(existing);
  if (nextGitignore !== existing) {
    writeFileSync(gitignorePath, nextGitignore, { encoding: "utf-8" });
    console.log(`Ignored: ${path.relative(process.cwd(), gitignorePath) || ".gitignore"}`);
  }
  return 0;
}

function agentmeshGitignoreContent(content: string): string {
  const lines = content.split(/\r?\n/);
  const alreadyIgnoresAgentmesh = lines.some((line) => isAgentmeshIgnore(line.trim()));
  let insertedAgentmeshIgnore = alreadyIgnoresAgentmesh;
  let changed = false;
  const nextLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (isLegacyAgentmeshRunsIgnore(trimmed)) {
      changed = true;
      if (!insertedAgentmeshIgnore) {
        nextLines.push(line.replace(trimmed, agentmeshIgnoreForLegacy(trimmed)));
        insertedAgentmeshIgnore = true;
      }
      continue;
    }
    nextLines.push(line);
  }
  if (insertedAgentmeshIgnore) {
    return changed ? nextLines.join("\n") : content;
  }
  return `${content}${content && !content.endsWith("\n") ? "\n" : ""}.agentmesh/\n`;
}

function isAgentmeshIgnore(trimmedLine: string): boolean {
  return trimmedLine === ".agentmesh"
    || trimmedLine === ".agentmesh/"
    || trimmedLine === "/.agentmesh"
    || trimmedLine === "/.agentmesh/";
}

function isLegacyAgentmeshRunsIgnore(trimmedLine: string): boolean {
  return trimmedLine === ".agentmesh/runs"
    || trimmedLine === ".agentmesh/runs/"
    || trimmedLine === "/.agentmesh/runs"
    || trimmedLine === "/.agentmesh/runs/";
}

function agentmeshIgnoreForLegacy(trimmedLine: string): string {
  return trimmedLine.startsWith("/") ? "/.agentmesh/" : ".agentmesh/";
}

function projectRootForInit(outputPath: string): string {
  const outputDir = path.dirname(outputPath);
  return path.basename(outputDir) === ".agentmesh" ? path.dirname(outputDir) : outputDir;
}
