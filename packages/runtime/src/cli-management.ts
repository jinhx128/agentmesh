import { execFile, spawnSync } from "node:child_process";

import type { AgentConfig } from "./adapters.js";
import {
  resolveProviderTool,
  type ProviderToolDiscoveryOptions,
  type ProviderToolResolutionSource,
} from "./adapters/provider-tools.js";

export const AGENTMESH_CLI_PACKAGE = "@jinhx128/agentmesh";
const AGENTMESH_CLI_LATEST_URL = "https://registry.npmjs.org/@jinhx128%2Fagentmesh/latest";

export interface AgentMeshCliManagementOptions {
  workspace: string;
  registryFetch?: typeof fetch;
  checkRegistry?: boolean;
  commandTimeoutMs?: number;
  installTimeoutMs?: number;
  discovery?: ProviderToolDiscoveryOptions;
}

export interface AgentMeshCliReport {
  package_name: typeof AGENTMESH_CLI_PACKAGE;
  installed: boolean;
  path?: string;
  source: ProviderToolResolutionSource;
  installed_version: string;
  latest_version: string;
  status: "missing" | "current" | "update_available" | "unknown";
  diagnostics: string[];
}

export interface AgentMeshCliInstallResult {
  report: AgentMeshCliReport;
  operation: {
    npm_path: string;
    args: string[];
    exit_code: number;
    stdout: string;
    stderr: string;
  };
}

export async function detectAgentMeshCli(
  options: AgentMeshCliManagementOptions,
): Promise<AgentMeshCliReport> {
  const resolution = resolveDesktopCommand("agentmesh", options);
  const diagnostics = resolution.ok ? [] : [...resolution.diagnostics];
  const installedVersion = resolution.path
    ? probeVersion(resolution.path, options.commandTimeoutMs ?? 5_000, diagnostics)
    : "missing";
  const latestVersion = options.checkRegistry === false
    ? "unknown"
    : await readLatestCliVersion(options.registryFetch, diagnostics);
  const installed = Boolean(resolution.ok && resolution.path);
  return {
    package_name: AGENTMESH_CLI_PACKAGE,
    installed,
    ...(resolution.path ? { path: resolution.path } : {}),
    source: resolution.source,
    installed_version: installedVersion,
    latest_version: latestVersion,
    status: cliStatus(installed, installedVersion, latestVersion),
    diagnostics,
  };
}

export async function installLatestAgentMeshCli(
  options: AgentMeshCliManagementOptions,
): Promise<AgentMeshCliInstallResult> {
  const npm = resolveDesktopCommand("npm", options);
  if (!npm.ok || !npm.path) {
    throw new Error("npm was not found. Install Node.js with npm and make it visible to your login shell.");
  }
  const args = [
    "install",
    "--global",
    `${AGENTMESH_CLI_PACKAGE}@latest`,
    "--no-audit",
    "--no-fund",
  ];
  const operation = await executeFile(npm.path, args, options.installTimeoutMs ?? 120_000);
  if (operation.exitCode !== 0) {
    throw new Error(npmInstallDiagnostic(operation));
  }
  const report = await detectAgentMeshCli(options);
  if (!report.installed) {
    throw new Error(
      "npm completed, but agentmesh is still not visible to the login shell. Check npm's global bin directory and PATH order.",
    );
  }
  return {
    report,
    operation: {
      npm_path: npm.path,
      args,
      exit_code: operation.exitCode,
      stdout: operation.stdout,
      stderr: operation.stderr,
    },
  };
}

function resolveDesktopCommand(command: string, options: AgentMeshCliManagementOptions) {
  const agent: AgentConfig = {
    id: command,
    label: command,
    adapter: "command",
    command,
    args: [],
    env: [],
    capabilities: [],
  };
  return resolveProviderTool(agent, {
    ...options.discovery,
    enabled: true,
    workspace: options.workspace,
  });
}

function probeVersion(commandPath: string, timeoutMs: number, diagnostics: string[]): string {
  const result = spawnSync(commandPath, ["--version"], { encoding: "utf-8", timeout: timeoutMs });
  if (result.error) {
    diagnostics.push(`version probe failed: ${result.error.message}`);
    return "unknown";
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    diagnostics.push(`version probe exited with code ${result.status ?? "unknown"}: ${bounded(output)}`);
    return "unknown";
  }
  const version = output.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)?.[1];
  if (!version) {
    diagnostics.push(`version probe returned no semantic version: ${bounded(output)}`);
    return "unknown";
  }
  return version;
}

async function readLatestCliVersion(
  registryFetch: typeof fetch | undefined,
  diagnostics: string[],
): Promise<string> {
  try {
    const response = await (registryFetch ?? fetch)(AGENTMESH_CLI_LATEST_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json() as { version?: unknown };
    if (typeof payload.version !== "string" || !parseSemver(payload.version)) {
      throw new Error("response did not contain a semantic version");
    }
    return payload.version;
  } catch (error) {
    diagnostics.push(`registry check failed: ${error instanceof Error ? error.message : String(error)}`);
    return "unknown";
  }
}

function cliStatus(
  installed: boolean,
  installedVersion: string,
  latestVersion: string,
): AgentMeshCliReport["status"] {
  if (!installed) return "missing";
  const installedSemver = parseSemver(installedVersion);
  const latestSemver = parseSemver(latestVersion);
  if (!installedSemver || !latestSemver) return "unknown";
  return compareSemver(installedSemver, latestSemver) < 0 ? "update_available" : "current";
}

type SemverIdentifier = number | string;

interface ParsedSemver {
  core: [number, number, number];
  prerelease: SemverIdentifier[];
}

function parseSemver(value: string): ParsedSemver | undefined {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]
      ? match[4].split(".").map((identifier) => /^\d+$/.test(identifier) ? Number(identifier) : identifier)
      : [],
  };
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] - right.core[index];
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    if (typeof leftIdentifier === "number" && typeof rightIdentifier === "number") {
      return leftIdentifier - rightIdentifier;
    }
    if (typeof leftIdentifier === "number") return -1;
    if (typeof rightIdentifier === "number") return 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

function executeFile(
  commandPath: string,
  args: string[],
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(commandPath, args, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      const code = error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
        ? (error as NodeJS.ErrnoException & { code: number }).code
        : error ? 1 : 0;
      resolve({
        exitCode: code,
        stdout: bounded(stdout),
        stderr: bounded(error && !stderr ? error.message : stderr),
      });
    });
  });
}

function npmInstallDiagnostic(operation: { exitCode: number; stdout: string; stderr: string }): string {
  const detail = bounded(operation.stderr || operation.stdout || "no output");
  if (/EACCES|permission denied/i.test(detail)) {
    return `npm could not write to its global prefix. Configure a user-writable npm prefix, then retry. ${detail}`;
  }
  if (/ENET|ECONN|ETIMEDOUT|network/i.test(detail)) {
    return `npm could not reach the public registry. Check the network or proxy, then retry. ${detail}`;
  }
  return `npm install exited with code ${operation.exitCode}. ${detail}`;
}

function bounded(value: string): string {
  const normalized = value.trim();
  return normalized.length > 2_000 ? `${normalized.slice(0, 2_000)}...` : normalized;
}
