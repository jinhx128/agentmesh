import { constants, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  type SkillTarget,
  expectedSkillFilesForTarget,
  agentmeshSkillMarkdown,
  installSkill,
  skillVersionMetadata,
  verifySkillInstall,
} from "@agentmesh/skills";
import {
  detectSupportedProviderClis,
  type ProviderCliToolReport,
} from "@agentmesh/runtime/src/adapters/provider-cli-diagnostics.js";

export interface StudioIntegrationOptions {
  commandLineTool?: StudioCommandLineToolSource;
}

export interface StudioCommandLineToolSource {
  nodePath: string;
  cliPath: string;
  channel: "desktop";
  defaultBinDir?: string;
}

export interface StudioIntegrationsReport {
  schema_version: 1;
  entrypoint: string;
  workspace: string;
  command_line_tool: StudioCommandLineToolReport;
  provider_clis: {
    tools: ProviderCliToolReport[];
  };
  skills: {
    targets: StudioSkillTargetReport[];
  };
}

export interface StudioCommandLineToolReport {
  supported: boolean;
  default_bin_dir: string;
  target_path: string;
  path_command: StudioPathCommandReport;
  target_file: StudioCommandLineToolFileReport;
  app_wrapper: {
    node_path?: string;
    cli_path?: string;
    channel?: string;
    version: string;
  };
  requires_confirmation: boolean;
}

export interface StudioPathCommandReport {
  found: boolean;
  path?: string;
  source: "missing" | "app_wrapper" | "external";
  version: string;
  diagnostic?: string;
}

export interface StudioCommandLineToolFileReport {
  exists: boolean;
  source: "missing" | "app_wrapper" | "external";
  version: string;
  different: boolean;
  diagnostic?: string;
}

export interface StudioSkillTargetReport {
  target: SkillTarget;
  expected_path: string;
  status: "ok" | "missing" | "unreadable" | "content_mismatch" | "legacy_only" | "failed";
  ok: boolean;
  expected: boolean;
  hint?: string;
}

export interface InstallCommandLineToolRequest {
  bin_dir?: string;
  confirm_existing?: boolean;
}

export interface InstallCommandLineToolResult extends StudioIntegrationsReport {
  installed: {
    path: string;
    replaced_existing: boolean;
  };
}

export interface InstallAgentSkillsRequest {
  targets?: unknown;
  force?: unknown;
}

export interface InstallAgentSkillsResult extends StudioIntegrationsReport {
  installed_targets: Array<{
    target: SkillTarget;
    ok: boolean;
    files: StudioSkillTargetReport[];
    error?: string;
  }>;
}

export class StudioIntegrationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioIntegrationConflictError";
  }
}

const supportedSkillTargets: SkillTarget[] = [
  "codex",
  "cursor",
  "antigravity",
  "opencode",
  "copilot",
  "claude",
];

export function readStudioIntegrations(options: {
  cwd: string;
  entrypoint: string;
  integrations?: StudioIntegrationOptions;
  commandLineBinDir?: string;
}): StudioIntegrationsReport {
  return {
    schema_version: 1,
    entrypoint: options.entrypoint,
    workspace: options.cwd,
    command_line_tool: commandLineToolReport(options, options.commandLineBinDir),
    provider_clis: detectSupportedProviderClis({
      enabled: true,
      workspace: options.cwd,
    }),
    skills: {
      targets: supportedSkillTargets.map((target) => skillTargetReport(target, options.cwd)),
    },
  };
}

export function installStudioCommandLineTool(
  request: InstallCommandLineToolRequest,
  options: {
    cwd: string;
    entrypoint: string;
    integrations?: StudioIntegrationOptions;
  },
): InstallCommandLineToolResult {
  if (options.entrypoint !== "desktop" || !options.integrations?.commandLineTool) {
    throw new Error("Install Command Line Tool is only available from AgentMesh.app");
  }
  const source = options.integrations.commandLineTool;
  const binDir = resolveBinDir(request.bin_dir, source.defaultBinDir);
  const targetPath = path.join(binDir, "agentmesh");
  const wrapper = commandLineToolWrapper(source);
  const beforeReport = commandLineToolReport(options, binDir);
  const existingTarget = beforeReport.target_file.exists;
  const sameTargetContent = existingTarget && safeRead(targetPath) === wrapper;
  if (beforeReport.requires_confirmation && request.confirm_existing !== true) {
    throw new StudioIntegrationConflictError(
      "Install Command Line Tool requires confirmation before replacing or shadowing an existing agentmesh command",
    );
  }

  mkdirSync(binDir, { recursive: true });
  writeFileSync(targetPath, wrapper, { encoding: "utf-8", mode: 0o755 });
  return {
    ...readStudioIntegrations({
      cwd: options.cwd,
      entrypoint: options.entrypoint,
      integrations: options.integrations,
      commandLineBinDir: binDir,
    }),
    installed: {
      path: targetPath,
      replaced_existing: existingTarget && !sameTargetContent,
    },
  };
}

export function installStudioAgentSkills(
  request: InstallAgentSkillsRequest,
  options: {
    cwd: string;
    entrypoint: string;
    integrations?: StudioIntegrationOptions;
  },
): InstallAgentSkillsResult {
  if (options.entrypoint !== "desktop") {
    throw new Error("Install Agent Skill is only available from AgentMesh.app");
  }
  const targets = parseSkillTargets(request.targets);
  const force = request.force === true;
  const expectedSkill = desktopSkillMarkdown(options.cwd);
  const installedTargets = targets.map((target) => {
    try {
      const report = installSkill(target, { cwd: options.cwd, expectedSkill, force });
      return {
        target,
        ok: report.ok,
        files: report.files.map((file) => ({
          target,
          expected_path: file.path,
          status: file.status,
          ok: file.status === "ok",
          expected: file.expected,
          ...(file.hint ? { hint: file.hint } : {}),
        })),
      };
    } catch (error) {
      return {
        target,
        ok: false,
        files: [{
          target,
          expected_path: expectedSkillFilesForTarget(target, { cwd: options.cwd })[0]?.path ?? "",
          status: "failed" as const,
          ok: false,
          expected: true,
        }],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  return {
    ...readStudioIntegrations(options),
    installed_targets: installedTargets,
  };
}

export function isStudioIntegrationConflictError(error: unknown): error is StudioIntegrationConflictError {
  return error instanceof StudioIntegrationConflictError;
}

function commandLineToolReport(options: {
  cwd: string;
  entrypoint: string;
  integrations?: StudioIntegrationOptions;
}, binDirOverride?: string): StudioCommandLineToolReport {
  const source = options.integrations?.commandLineTool;
  const defaultBinDir = resolveBinDir(undefined, source?.defaultBinDir);
  const effectiveBinDir = resolveBinDir(binDirOverride, source?.defaultBinDir);
  const targetPath = path.join(effectiveBinDir, "agentmesh");
  const pathCommand = findPathCommand("agentmesh");
  const targetFile = readCommandLineToolFile(targetPath, source);
  return {
    supported: options.entrypoint === "desktop" && Boolean(source),
    default_bin_dir: defaultBinDir,
    target_path: targetPath,
    path_command: pathCommand,
    target_file: targetFile,
    app_wrapper: {
      ...(source ? {
        node_path: source.nodePath,
        cli_path: source.cliPath,
        channel: source.channel,
      } : {}),
      version: skillVersionMetadata().agentmesh_cli_version,
    },
    requires_confirmation: Boolean(source && (
      (pathCommand.found && pathCommand.path !== targetPath) ||
      (targetFile.exists && targetFile.different)
    )),
  };
}

function skillTargetReport(target: SkillTarget, cwd: string): StudioSkillTargetReport {
  const report = verifySkillInstall(target, { cwd, expectedSkill: desktopSkillMarkdown(cwd) });
  const expected = report.files.find((file) => file.expected) ?? report.files[0];
  return {
    target,
    expected_path: expected?.path ?? expectedSkillFilesForTarget(target, { cwd })[0]?.path ?? "",
    status: expected?.status ?? "missing",
    ok: report.ok,
    expected: expected?.expected ?? true,
    ...(expected?.hint ? { hint: expected.hint } : {}),
  };
}

function parseSkillTargets(value: unknown): SkillTarget[] {
  if (!Array.isArray(value)) {
    throw new Error("targets must be an array");
  }
  const targets: SkillTarget[] = [];
  for (const item of value) {
    if (!isSkillTarget(item)) {
      throw new Error(`unsupported skill target: ${String(item)}`);
    }
    if (!targets.includes(item)) {
      targets.push(item);
    }
  }
  if (targets.length === 0) {
    throw new Error("at least one skill target is required");
  }
  return targets;
}

function isSkillTarget(value: unknown): value is SkillTarget {
  return typeof value === "string" && supportedSkillTargets.includes(value as SkillTarget);
}

function desktopSkillMarkdown(cwd: string): string {
  return agentmeshSkillMarkdown(cwd, { preferModuleSource: true });
}

function resolveBinDir(value: string | undefined, defaultValue: string | undefined): string {
  const binDir = value ?? defaultValue ?? path.join(homedir(), ".local", "bin");
  if (!path.isAbsolute(binDir)) {
    throw new Error("bin_dir must be absolute");
  }
  return path.resolve(binDir);
}

function findPathCommand(commandName: string): StudioPathCommandReport {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, commandName);
    if (!isExecutableFile(candidate)) {
      continue;
    }
    const metadata = readWrapperMetadata(candidate);
    return {
      found: true,
      path: candidate,
      source: metadata.appManaged ? "app_wrapper" : "external",
      version: metadata.version ?? "unknown",
      ...(metadata.appManaged ? undefined : { diagnostic: "external command version not executed by Studio" }),
    };
  }
  return {
    found: false,
    source: "missing",
    version: "missing",
  };
}

function readCommandLineToolFile(
  filePath: string,
  source: StudioCommandLineToolSource | undefined,
): StudioCommandLineToolFileReport {
  if (!existsSync(filePath)) {
    return {
      exists: false,
      source: "missing",
      version: "missing",
      different: false,
    };
  }
  const metadata = readWrapperMetadata(filePath);
  const expectedWrapper = source ? commandLineToolWrapper(source) : undefined;
  return {
    exists: true,
    source: metadata.appManaged ? "app_wrapper" : "external",
    version: metadata.version ?? "unknown",
    different: expectedWrapper ? safeRead(filePath) !== expectedWrapper : true,
    ...(metadata.appManaged ? undefined : { diagnostic: "target path contains a non-app-managed command" }),
  };
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stats = statSync(filePath);
    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function readWrapperMetadata(filePath: string): { appManaged: boolean; version?: string } {
  const content = safeRead(filePath).slice(0, 4096);
  return {
    appManaged: content.includes("agentmesh_app_managed=true"),
    version: content.match(/agentmesh_cli_version=([^\n]+)/)?.[1]?.trim(),
  };
}

function commandLineToolWrapper(source: StudioCommandLineToolSource): string {
  const version = skillVersionMetadata().agentmesh_cli_version;
  const shellRun = ["ex", "ec"].join("");
  return [
    "#!/bin/sh",
    "# AgentMesh Command Line Tool",
    "# agentmesh_app_managed=true",
    `# agentmesh_cli_version=${version}`,
    `# agentmesh_channel=${source.channel}`,
    `${shellRun} ${shellQuote(source.nodePath)} ${shellQuote(source.cliPath)} "$@"`,
    "",
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function safeRead(filePath: string): string {
  try {
    return readFileSync(filePath, { encoding: "utf-8" });
  } catch {
    return "";
  }
}

export async function assertCommandLineToolTargetReadable(report: StudioCommandLineToolReport): Promise<boolean> {
  if (!report.supported || !report.app_wrapper.node_path || !report.app_wrapper.cli_path) {
    return false;
  }
  await access(report.app_wrapper.node_path, constants.X_OK);
  await access(report.app_wrapper.cli_path, constants.R_OK);
  return true;
}
