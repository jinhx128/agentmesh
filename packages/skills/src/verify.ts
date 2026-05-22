import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CURRENT_SCHEMA_VERSION,
  WORKFLOW_RECIPE_SCHEMA_VERSION,
} from "@agentmesh/core";

export type SkillTarget = "codex" | "claude" | "cursor" | "antigravity" | "opencode" | "copilot";

const GENERATED_METADATA_START = "<!-- agentmesh-skill-version-metadata:start -->";
const GENERATED_METADATA_END = "<!-- agentmesh-skill-version-metadata:end -->";

export interface SkillVersionMetadata {
  agentmesh_cli_version: string;
  packet_schema_version: typeof CURRENT_SCHEMA_VERSION;
  workflow_recipe_schema_version: typeof WORKFLOW_RECIPE_SCHEMA_VERSION;
}

interface VerifyOptions {
  /** Project root used for all current project-level skill install targets. */
  cwd?: string;
  /**
   * Reserved for future host-home diagnostics. Current target paths are
   * intentionally project-level and are resolved from cwd only.
   */
  homeDir?: string;
  expectedSkill?: string;
}

export interface SkillMarkdownOptions {
  preferModuleSource?: boolean;
}

interface SkillFileReport {
  path: string;
  status: "ok" | "missing" | "unreadable" | "content_mismatch" | "legacy_only";
  classification: "ok" | "missing" | "unreadable" | "content_mismatch" | "legacy_only";
  expected: boolean;
  diagnostic?: string;
  hint?: string;
}

export interface SkillVerifyReport {
  schema_version: 1;
  target: SkillTarget;
  ok: boolean;
  files: SkillFileReport[];
}

export interface SkillExpectedFile {
  path: string;
  target: SkillTarget;
  expected: true;
}

interface InstallFile {
  path: string;
  content: string;
}

export function expectedSkillFilesForTarget(
  target: SkillTarget,
  options: VerifyOptions = {},
): SkillExpectedFile[] {
  return installPathsForTarget(target, options).map((filePath) => ({
    path: filePath,
    target,
    expected: true,
  }));
}

export function verifySkillInstall(
  target: SkillTarget,
  options: VerifyOptions = {},
): SkillVerifyReport {
  const expectedFiles = installFilesForTarget(target, options).map(inspectInstallFile);
  const files = [
    ...expectedFiles,
    ...legacyFilesForTarget(target, options),
  ];
  return {
    schema_version: 1,
    target,
    ok: expectedFiles.every((file) => file.status === "ok"),
    files,
  };
}

export function installSkill(
  target: SkillTarget,
  options: VerifyOptions & { force?: boolean } = {},
): SkillVerifyReport {
  const installFiles = installFilesForTarget(target, options);
  for (const file of installFiles) {
    if (existsSync(file.path) && !options.force) {
      continue;
    }
    mkdirSync(path.dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content, { encoding: "utf-8" });
  }
  return verifySkillInstall(target, options);
}

export function agentmeshSkillMarkdown(
  cwd = process.cwd(),
  options: SkillMarkdownOptions = {},
): string {
  const projectRoot = moduleProjectRoot();
  const cwdCandidate = path.join(cwd, "packages", "skills", "agentmesh-skill", "SKILL.md");
  const moduleCandidates = [
    path.join(projectRoot, "agentmesh-skill", "SKILL.md"),
    path.join(projectRoot, "packages", "skills", "agentmesh-skill", "SKILL.md"),
  ];
  const candidates = options.preferModuleSource
    ? [...moduleCandidates, cwdCandidate]
    : [cwdCandidate, ...moduleCandidates];
  for (const candidate of candidates) {
    try {
      return withSkillVersionMetadata(
        readFileSync(candidate, { encoding: "utf-8" }),
        skillVersionMetadata(projectRoot),
      );
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("AgentMesh Skill source not found");
}

export function skillVersionMetadata(projectRoot = moduleProjectRoot()): SkillVersionMetadata {
  return {
    agentmesh_cli_version: packageVersion(projectRoot),
    packet_schema_version: CURRENT_SCHEMA_VERSION,
    workflow_recipe_schema_version: WORKFLOW_RECIPE_SCHEMA_VERSION,
  };
}

function packageVersion(projectRoot: string): string {
  try {
    const payload = JSON.parse(
      readFileSync(path.join(projectRoot, "package.json"), { encoding: "utf-8" }),
    ) as { version?: unknown };
    if (typeof payload.version === "string" && payload.version.trim() !== "") {
      return payload.version;
    }
  } catch {
    // Fall through to the explicit unknown marker.
  }
  return "unknown";
}

function withSkillVersionMetadata(
  source: string,
  metadata: SkillVersionMetadata,
): string {
  const sanitized = source
    .replace(
      new RegExp(
        `\\n?${escapeRegExp(GENERATED_METADATA_START)}[\\s\\S]*?${escapeRegExp(
          GENERATED_METADATA_END,
        )}\\n?`,
        "m",
      ),
      "\n",
    )
    .trimEnd();
  const { frontmatter, body: markdownBody } = splitSkillFrontmatter(sanitized);
  const block = [
    GENERATED_METADATA_START,
    "## Version Metadata",
    "",
    `- AgentMesh CLI version: ${metadata.agentmesh_cli_version}`,
    `- Packet schema version: ${metadata.packet_schema_version}`,
    `- Workflow recipe schema version: ${metadata.workflow_recipe_schema_version}`,
    GENERATED_METADATA_END,
    "",
  ].join("\n");

  const headingEnd = markdownBody.indexOf("\n");
  if (headingEnd === -1) {
    return `${frontmatter}${markdownBody}\n\n${block}`;
  }
  const heading = markdownBody.slice(0, headingEnd).trimEnd();
  const body = markdownBody.slice(headingEnd).replace(/^\n+/, "");
  return `${frontmatter}${heading}\n\n${block}${body}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitSkillFrontmatter(source: string): { frontmatter: string; body: string } {
  const match = source.match(/^---\n[\s\S]*?\n---\n*/);
  if (!match) {
    return { frontmatter: "", body: source };
  }
  return {
    frontmatter: `${match[0].trimEnd()}\n\n`,
    body: source.slice(match[0].length).replace(/^\n+/, ""),
  };
}

function moduleProjectRoot(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth += 1) {
    if (
      existsSync(path.join(current, "package.json")) &&
      (
        existsSync(path.join(current, "agentmesh-skill", "SKILL.md")) ||
        existsSync(path.join(current, "packages", "skills", "agentmesh-skill", "SKILL.md"))
      )
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

function installFilesForTarget(target: SkillTarget, options: VerifyOptions): InstallFile[] {
  const cwd = options.cwd ?? process.cwd();
  const expectedSkill = options.expectedSkill ?? agentmeshSkillMarkdown(cwd);
  return installPathsForTarget(target, options).map((filePath) => ({
    path: filePath,
    content: expectedSkill,
  }));
}

function installPathsForTarget(target: SkillTarget, options: VerifyOptions): string[] {
  const cwd = options.cwd ?? process.cwd();
  if (isSharedProjectTarget(target)) {
    return [path.join(cwd, ".agents", "skills", "agentmesh", "SKILL.md")];
  }
  if (target === "claude") {
    return [path.join(cwd, ".claude", "skills", "agentmesh", "SKILL.md")];
  }
  throw new Error(`unsupported skill verify target: ${target}`);
}

function isSharedProjectTarget(target: SkillTarget): boolean {
  return ["codex", "cursor", "antigravity", "opencode", "copilot"].includes(target);
}

function legacyFilesForTarget(target: SkillTarget, options: VerifyOptions): SkillFileReport[] {
  if (target !== "cursor") {
    return [];
  }
  const cwd = options.cwd ?? process.cwd();
  const legacyPath = path.join(cwd, ".cursor", "rules", "agentmesh.mdc");
  if (!existsSync(legacyPath)) {
    return [];
  }
  return [
    {
      path: legacyPath,
      status: "legacy_only",
      classification: "legacy_only",
      expected: false,
      hint:
        "legacy Cursor rule detected. It is not deleted automatically; run `agentmesh skill install --target cursor --force` to refresh the shared project Skill.",
    },
  ];
}

function inspectInstallFile(installFile: InstallFile): SkillFileReport {
  const report: SkillFileReport = {
    path: installFile.path,
    status: "ok",
    classification: "ok",
    expected: true,
  };
  try {
    const existing = readFileSync(installFile.path, { encoding: "utf-8" });
    if (existing !== installFile.content) {
      report.status = "content_mismatch";
      report.classification = "content_mismatch";
      report.hint = "Re-run `agentmesh skill install --target <host> --force` to refresh this file.";
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      report.status = "missing";
      report.classification = "missing";
      report.hint = "Run `agentmesh skill install --target <host>` for this host.";
    } else {
      report.status = "unreadable";
      report.classification = "unreadable";
      report.diagnostic = nodeError.message;
      report.hint = "Check file permissions and parent directory ownership.";
    }
  }
  return report;
}
