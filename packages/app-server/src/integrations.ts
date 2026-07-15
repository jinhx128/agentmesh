import {
  type SkillTarget,
  expectedSkillFilesForTarget,
  agentmeshSkillMarkdown,
  installSkill,
  verifySkillInstall,
} from "@agentmesh/skills";
import {
  detectAgentMeshCli,
  installLatestAgentMeshCli,
  type AgentMeshCliManagementOptions,
  type AgentMeshCliReport,
} from "@agentmesh/runtime/src/cli-management.js";
import {
  detectSupportedProviderClis,
  type ProviderCliToolReport,
} from "@agentmesh/runtime/src/adapters/provider-cli-diagnostics.js";

export type StudioIntegrationOptions = Omit<AgentMeshCliManagementOptions, "workspace">;

export interface StudioIntegrationsReport {
  schema_version: 1;
  entrypoint: string;
  workspace: string;
  command_line_tool: StudioCommandLineToolReport;
  provider_clis: { tools: ProviderCliToolReport[] };
  skills: { targets: StudioSkillTargetReport[] };
}

export interface StudioCommandLineToolReport extends AgentMeshCliReport {
  supported: boolean;
}

export interface StudioSkillTargetReport {
  target: SkillTarget;
  expected_path: string;
  status: "ok" | "missing" | "unreadable" | "content_mismatch" | "legacy_only" | "failed";
  ok: boolean;
  expected: boolean;
  hint?: string;
}

export type InstallCommandLineToolRequest = Record<string, never>;

export interface InstallCommandLineToolResult extends StudioIntegrationsReport {
  operation: {
    npm_path: string;
    args: string[];
    exit_code: number;
    stdout: string;
    stderr: string;
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

const supportedSkillTargets: SkillTarget[] = [
  "codex",
  "cursor",
  "antigravity",
  "opencode",
  "claude",
];

export async function readStudioIntegrations(options: {
  cwd: string;
  entrypoint: string;
  integrations?: StudioIntegrationOptions;
}): Promise<StudioIntegrationsReport> {
  const commandLineTool = await detectAgentMeshCli({
    workspace: options.cwd,
    ...options.integrations,
  });
  return {
    schema_version: 1,
    entrypoint: options.entrypoint,
    workspace: options.cwd,
    command_line_tool: {
      supported: options.entrypoint === "desktop",
      ...commandLineTool,
    },
    provider_clis: detectSupportedProviderClis({ enabled: true, workspace: options.cwd }),
    skills: {
      targets: supportedSkillTargets.map((target) => skillTargetReport(target, options.cwd)),
    },
  };
}

export async function installStudioCommandLineTool(
  _request: InstallCommandLineToolRequest,
  options: {
    cwd: string;
    entrypoint: string;
    integrations?: StudioIntegrationOptions;
  },
): Promise<InstallCommandLineToolResult> {
  if (options.entrypoint !== "desktop") {
    throw new Error("Install Command Line Tool is only available from AgentMesh.app");
  }
  const installed = await installLatestAgentMeshCli({
    workspace: options.cwd,
    ...options.integrations,
  });
  const report = await readStudioIntegrations(options);
  return {
    ...report,
    command_line_tool: {
      supported: true,
      ...installed.report,
    },
    operation: installed.operation,
  };
}

export async function installStudioAgentSkills(
  request: InstallAgentSkillsRequest,
  options: {
    cwd: string;
    entrypoint: string;
    integrations?: StudioIntegrationOptions;
  },
): Promise<InstallAgentSkillsResult> {
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
    ...await readStudioIntegrations(options),
    installed_targets: installedTargets,
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
  if (!Array.isArray(value)) throw new Error("targets must be an array");
  const targets: SkillTarget[] = [];
  for (const item of value) {
    if (!isSkillTarget(item)) throw new Error(`unsupported skill target: ${String(item)}`);
    if (!targets.includes(item)) targets.push(item);
  }
  if (targets.length === 0) throw new Error("at least one skill target is required");
  return targets;
}

function isSkillTarget(value: unknown): value is SkillTarget {
  return typeof value === "string" && supportedSkillTargets.includes(value as SkillTarget);
}

function desktopSkillMarkdown(cwd: string): string {
  return agentmeshSkillMarkdown(cwd, { preferModuleSource: true });
}
