import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { ConfigSourceRef, loadConfigWithSources } from "../config.js";
import { listWorkflows, workflowSearchDirs } from "../workflow/registry.js";
import { normalizeAgents, resolveAgent, type AgentConfig } from "../adapters.js";
import {
  prepareAdapterEnvironment,
  prepareAdapterInvocation,
} from "../adapters/invocation.js";
import { lookupRuntimeAdapter } from "../adapters/registry.js";
import { buildAgentProcessEnv } from "../process-env.js";

const DOCTOR_AUTH_PROMPT = "AgentMesh doctor authentication probe. Reply with OK.";
const DEFAULT_DOCTOR_PROBE_TIMEOUT_SECS = 30;
const DOCTOR_HELP_TIMEOUT_SECS = 5;
const DOCTOR_VERSION_TIMEOUT_SECS = 5;
const DOCTOR_OUTPUT_DETAIL_MAX_CHARS = 240;
const COMMAND_OK_NO_AUTH_PROBE = "command ok (no auth probe)";
const COMMAND_OK_AUTH_NOT_CHECKED = "command ok (auth not checked)";
const DOCTOR_OK_STATUSES = new Set([
  "ok",
  COMMAND_OK_NO_AUTH_PROBE,
  COMMAND_OK_AUTH_NOT_CHECKED,
]);

type Readiness = "ready" | "unknown" | "not_ready";
type DoctorClassification =
  | "ready"
  | "unknown"
  | "command_not_found"
  | "auth_failed"
  | "auth_timeout"
  | "model_unavailable"
  | "help_failed"
  | "version_failed";

interface AvailabilityStatus {
  status: string;
  environmentError?: string;
  agent?: AgentConfig;
  toolResolution: ProviderToolResolution;
}

export type ProviderToolResolutionSource =
  | "configured_path"
  | "path"
  | "app_preference"
  | "well_known"
  | "login_shell_probe"
  | "missing";

export interface ProviderToolDiscoveryOptions {
  enabled?: boolean;
  appPreferencePaths?: Record<string, string>;
  wellKnownPaths?: string[];
  homeDir?: string;
  workspace?: string;
  shellPath?: string;
  shellEnv?: NodeJS.ProcessEnv;
  probeTimeoutMs?: number;
}

export interface ProviderToolResolution {
  ok: boolean;
  command: string;
  path?: string;
  source: ProviderToolResolutionSource;
  diagnostics: string[];
}

export interface DoctorAgentReport {
  id: string;
  label: string;
  adapter: string;
  command: string;
  configured_command?: string;
  provider_tool_source: ProviderToolResolutionSource;
  provider_tool_path?: string;
  provider_tool_diagnostics: string[];
  status: string;
  ok: boolean;
  readiness: Readiness;
  ready: boolean | null;
  classification: DoctorClassification;
  non_interactive: Readiness;
  auth_probe: string;
  help_probe: string;
  version_probe: string;
  source_layer?: string;
  source_path?: string;
  hints: string[];
}

export interface DoctorDiagnostic {
  classification: string;
  message: string;
  hint: string;
}

export interface DoctorReport {
  schema_version: 1;
  config: string;
  config_layers: ConfigSourceRef[];
  probe_auth: boolean;
  ok: boolean;
  diagnostics: DoctorDiagnostic[];
  agents: DoctorAgentReport[];
}

export interface DoctorReportOptions {
  probeAuth?: boolean;
  probeTimeoutSecs?: number;
  agents?: string[];
  providerToolDiscovery?: ProviderToolDiscoveryOptions;
}

export interface AgentReadinessProbeOptions {
  probeAuth?: boolean;
  probeTimeoutSecs?: number;
  providerToolDiscovery?: ProviderToolDiscoveryOptions;
}

export function buildDoctorReport(
  configPath?: string,
  options: DoctorReportOptions = {},
): DoctorReport {
  const loaded = loadConfigWithSources(configPath);
  const resolvedAgents = normalizeAgents(loaded.config, loaded.agentSources);
  const probeAuth = options.probeAuth ?? true;
  const timeoutSecs = options.probeTimeoutSecs ?? DEFAULT_DOCTOR_PROBE_TIMEOUT_SECS;
  const agents = selectDoctorAgents(resolvedAgents, options.agents)
    .map((agent) => probeAgentReadiness(agent, {
      probeAuth,
      probeTimeoutSecs: timeoutSecs,
      providerToolDiscovery: options.providerToolDiscovery,
    }));
  const diagnostics = workflowRegistryDiagnostics(configPath);
  return {
    schema_version: 1,
    config: loaded.layers.map((layer) => layer.path).join(", "),
    config_layers: loaded.layers,
    probe_auth: probeAuth,
    ok: agents.every((agent) => agent.ok) && diagnostics.length === 0,
    diagnostics,
    agents,
  };
}

export function probeAgentReadiness(
  agent: AgentConfig,
  options: AgentReadinessProbeOptions = {},
): DoctorAgentReport {
  const probeAuth = options.probeAuth ?? true;
  const timeoutSecs = options.probeTimeoutSecs ?? DEFAULT_DOCTOR_PROBE_TIMEOUT_SECS;
  const availability = availabilityStatus(
    agent,
    probeAuth,
    timeoutSecs,
    options.providerToolDiscovery,
  );
  return buildDoctorAgentReport(agent, availability);
}

function selectDoctorAgents(
  agents: Record<string, AgentConfig>,
  targets: string[] = [],
): AgentConfig[] {
  if (targets.length === 0) {
    return Object.keys(agents)
      .sort()
      .map((agentId) => agents[agentId]);
  }
  const selected: AgentConfig[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const agent = resolveAgent(agents, target);
    if (seen.has(agent.id)) {
      continue;
    }
    seen.add(agent.id);
    selected.push(agent);
  }
  return selected;
}

function workflowRegistryDiagnostics(configPath?: string): DoctorDiagnostic[] {
  try {
    listWorkflows(workflowSearchDirs(process.cwd(), configPath));
    return [];
  } catch (error) {
    return [
      {
        classification: "workflow_registry_error",
        message: error instanceof Error ? error.message : String(error),
        hint: "Run `agentmesh workflows list --json` and rename or remove duplicate workflow ids.",
      },
    ];
  }
}

function buildDoctorAgentReport(
  agent: AgentConfig,
  availability: AvailabilityStatus,
): DoctorAgentReport {
  const effectiveAgent = availability.agent ?? agent;
  const status = availability.status;
  const { readiness, ready, authProbe } = doctorReadiness(status);
  const helpProbe = doctorHelpProbe(effectiveAgent, status, availability.environmentError);
  const versionProbe = doctorVersionProbe(effectiveAgent, status, availability.environmentError);
  const classification = doctorClassification(status, readiness, helpProbe, versionProbe);
  return {
    id: effectiveAgent.id,
    label: effectiveAgent.label,
    adapter: effectiveAgent.adapter,
    command: effectiveAgent.command,
    configured_command:
      effectiveAgent.command === agent.command ? undefined : agent.command,
    provider_tool_source: availability.toolResolution.source,
    provider_tool_path: availability.toolResolution.path,
    provider_tool_diagnostics: availability.toolResolution.diagnostics,
    status,
    ok: DOCTOR_OK_STATUSES.has(status),
    readiness,
    ready,
    classification,
    non_interactive: doctorNonInteractiveState(agent, authProbe),
    auth_probe: authProbe,
    help_probe: helpProbe,
    version_probe: versionProbe,
    source_layer: effectiveAgent.source_layer,
    source_path: effectiveAgent.source_path,
    hints: doctorHints(effectiveAgent, status, readiness, helpProbe, versionProbe),
  };
}

function doctorClassification(
  status: string,
  readiness: Readiness,
  helpProbe: string,
  versionProbe: string,
): DoctorClassification {
  if (status === "command not found") {
    return "command_not_found";
  }
  if (status.startsWith("auth probe timed out")) {
    return "auth_timeout";
  }
  if (
    status.startsWith("auth probe failed")
    && /model/i.test(status)
    && /invalid|not found|unknown|unavailable|unsupported/i.test(status)
  ) {
    return "model_unavailable";
  }
  if (status.startsWith("auth probe failed")) {
    return "auth_failed";
  }
  if (helpProbe.startsWith("failed") || helpProbe.startsWith("timeout")) {
    return "help_failed";
  }
  if (versionProbe.startsWith("failed") || versionProbe.startsWith("timeout")) {
    return "version_failed";
  }
  if (readiness === "ready") {
    return "ready";
  }
  return "unknown";
}

function availabilityStatus(
  agent: AgentConfig,
  probeAuth: boolean,
  timeoutSecs: number,
  providerToolDiscovery?: ProviderToolDiscoveryOptions,
): AvailabilityStatus {
  const toolResolution = resolveProviderTool(agent, providerToolDiscovery);
  if (!toolResolution.ok || !toolResolution.path) {
    return { status: "command not found", toolResolution };
  }
  const effectiveAgent: AgentConfig = {
    ...agent,
    command: toolResolution.path,
  };
  if (lookupRuntimeAdapter(agent.adapter).id === "command") {
    return { status: COMMAND_OK_NO_AUTH_PROBE, agent: effectiveAgent, toolResolution };
  }
  if (!probeAuth) {
    return { status: COMMAND_OK_AUTH_NOT_CHECKED, agent: effectiveAgent, toolResolution };
  }
  let prepared: ReturnType<typeof prepareAdapterInvocation>;
  try {
    prepared = prepareAdapterInvocation(effectiveAgent, { prompt: DOCTOR_AUTH_PROMPT });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: `auth probe failed (${message})`,
      environmentError: isAdapterEnvironmentError(message) ? message : undefined,
      agent: effectiveAgent,
      toolResolution,
    };
  }
  const result = spawnSync(prepared.command[0], prepared.command.slice(1), {
    env: buildAgentProcessEnv(prepared.env),
    input: prepared.stdin,
    encoding: "utf-8",
    timeout: timeoutSecs * 1000,
  });
  if (result.error) {
    if (isTimeoutError(result.error)) {
      return {
        status: `auth probe timed out after ${timeoutSecs}s`,
        agent: effectiveAgent,
        toolResolution,
      };
    }
    return {
      status: `auth probe failed (${result.error.message})`,
      agent: effectiveAgent,
      toolResolution,
    };
  }
  if (result.status === 0) {
    const adapterId = lookupRuntimeAdapter(agent.adapter).id;
    if (adapterId === "antigravity-cli" && !hasProbeResponse(result.stdout ?? "")) {
      return {
        status: "auth probe failed (empty response; Antigravity CLI did not confirm model readiness)",
        agent: effectiveAgent,
        toolResolution,
      };
    }
    return { status: "ok", agent: effectiveAgent, toolResolution };
  }
  const detail = firstDiagnosticLine(
    result.stderr ?? "",
    result.stdout ?? "",
    DOCTOR_OUTPUT_DETAIL_MAX_CHARS,
  );
  const status = `auth probe failed (exit ${result.status ?? "unknown"})`;
  return {
    status: detail ? `${status}: ${detail}` : status,
    agent: effectiveAgent,
    toolResolution,
  };
}

function hasProbeResponse(output: string): boolean {
  return output.trim().length > 0;
}

function doctorReadiness(status: string): {
  readiness: Readiness;
  ready: boolean | null;
  authProbe: string;
} {
  if (status === "ok") {
    return { readiness: "ready", ready: true, authProbe: "passed" };
  }
  if (status === COMMAND_OK_NO_AUTH_PROBE) {
    return { readiness: "ready", ready: true, authProbe: "not_applicable" };
  }
  if (status === COMMAND_OK_AUTH_NOT_CHECKED) {
    return { readiness: "unknown", ready: null, authProbe: "skipped" };
  }
  if (status === "command not found") {
    return { readiness: "not_ready", ready: false, authProbe: "not_run" };
  }
  if (status.startsWith("auth probe timed out")) {
    return { readiness: "not_ready", ready: false, authProbe: "timeout" };
  }
  return { readiness: "not_ready", ready: false, authProbe: "failed" };
}

function doctorNonInteractiveState(agent: AgentConfig, authProbe: string): Readiness {
  const supportsNonInteractive =
    lookupRuntimeAdapter(agent.adapter).capabilities.supports_non_interactive === true;
  if (!supportsNonInteractive) {
    return "unknown";
  }
  if (authProbe === "passed") {
    return "ready";
  }
  if (["failed", "timeout", "not_run"].includes(authProbe)) {
    return "not_ready";
  }
  return "unknown";
}

function doctorHelpProbe(
  agent: AgentConfig,
  availabilityStatusValue: string,
  environmentError?: string,
): string {
  if (lookupRuntimeAdapter(agent.adapter).id === "command") {
    return "not_applicable";
  }
  if (availabilityStatusValue === "command not found") {
    return "not_run";
  }
  if (environmentError) {
    return `not_run (${environmentError})`;
  }
  const probeEnv = probeEnvironment(agent);
  if (probeEnv.error) {
    return `failed (${probeEnv.error})`;
  }
  return runProbe(
    [agent.command, ...agent.args, "--help"],
    DOCTOR_HELP_TIMEOUT_SECS,
    probeEnv.env,
  );
}

function doctorVersionProbe(
  agent: AgentConfig,
  availabilityStatusValue: string,
  environmentError?: string,
): string {
  if (lookupRuntimeAdapter(agent.adapter).id === "command") {
    return "not_applicable";
  }
  if (availabilityStatusValue === "command not found") {
    return "not_run";
  }
  if (environmentError) {
    return `not_run (${environmentError})`;
  }
  const probeEnv = probeEnvironment(agent);
  if (probeEnv.error) {
    return `failed (${probeEnv.error})`;
  }
  return runProbe([agent.command, "--version"], DOCTOR_VERSION_TIMEOUT_SECS, probeEnv.env);
}

function probeEnvironment(agent: AgentConfig): {
  env?: Record<string, string>;
  error?: string;
} {
  try {
    return { env: prepareAdapterEnvironment(agent) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function runProbe(command: string[], timeoutSecs: number, env?: Record<string, string>): string {
  const result = spawnSync(command[0], command.slice(1), {
    env: buildAgentProcessEnv(env),
    encoding: "utf-8",
    timeout: timeoutSecs * 1000,
  });
  if (result.error) {
    if (isTimeoutError(result.error)) {
      return `timeout after ${timeoutSecs}s`;
    }
    return `failed (${result.error.message})`;
  }
  if (result.status === 0) {
    return "ok";
  }
  return `failed (exit ${result.status ?? "unknown"})`;
}

function doctorHints(
  agent: AgentConfig,
  status: string,
  readiness: Readiness,
  helpProbe: string,
  versionProbe: string,
): string[] {
  const hints: string[] = [];
  if (status === "command not found") {
    hints.push(
      `Install the ${agent.adapter} CLI or set this agent command to an executable path: ${agent.command}`,
    );
  } else if (status === COMMAND_OK_AUTH_NOT_CHECKED) {
    hints.push(
      "Run `agentmesh doctor` without `--skip-auth-probe` before dispatching this AI CLI.",
    );
  } else if (status.startsWith("auth probe timed out")) {
    hints.push(
      `Check whether \`${agent.command}\` waits for interactive input; refresh login state or increase --probe-timeout-secs.`,
    );
  } else if (status.startsWith("auth probe failed")) {
    hints.push(adapterLoginHint(agent.adapter, agent.command));
    hints.push("Confirm the configured model is available for this account.");
  }
  if (helpProbe.startsWith("failed") || helpProbe.startsWith("timeout")) {
    hints.push(
      `\`${agent.command} --help\` did not complete cleanly; check the CLI install and PATH.`,
    );
  }
  if (versionProbe.startsWith("failed") || versionProbe.startsWith("timeout")) {
    hints.push(
      `\`${agent.command} --version\` did not complete cleanly; check the CLI install and PATH.`,
    );
  }
  if (readiness === "ready" && helpProbe === "not_applicable") {
    hints.push(
      "Generic command adapters do not have an auth probe; test the command non-interactively before using it as a worker.",
    );
  }
  return hints;
}

function adapterLoginHint(adapter: string, command: string): string {
  const label = lookupRuntimeAdapter(adapter).label;
  return `Open ${label} once on this machine, refresh its login state, then verify \`${command}\` can run non-interactively.`;
}

export function resolveProviderTool(
  agent: AgentConfig,
  discovery: ProviderToolDiscoveryOptions = {},
): ProviderToolResolution {
  const command = agent.command;
  const diagnostics: string[] = [];
  if (hasPathSeparator(command)) {
    const resolvedCommand = path.resolve(command.replace(/[\\/]/g, path.sep));
    if (isExecutableFile(resolvedCommand)) {
      return {
        ok: true,
        command,
        path: resolvedCommand,
        source: "configured_path",
        diagnostics: [`configured provider path found: ${resolvedCommand}`],
      };
    }
    return {
      ok: false,
      command,
      source: "missing",
      diagnostics: [`configured provider path is not executable: ${resolvedCommand}`],
    };
  }

  if (discovery.enabled !== true) {
    const found = searchPath(command);
    return found
      ? {
          ok: true,
          command,
          path: found,
          source: "path",
          diagnostics: [`PATH provider command found: ${found}`],
        }
      : {
          ok: false,
          command,
          source: "missing",
          diagnostics: [`provider command not found on PATH: ${command}`],
        };
  }

  const appPreference = discovery.appPreferencePaths?.[agent.adapter]
    ?? discovery.appPreferencePaths?.[command];
  if (appPreference) {
    const resolved = validateProviderPath(
      appPreference,
      "app preference",
      diagnostics,
      discovery,
      false,
    );
    if (resolved) {
      return {
        ok: true,
        command,
        path: resolved,
        source: "app_preference",
        diagnostics: [`app preference provider path found: ${resolved}`, ...diagnostics],
      };
    }
  }

  for (const candidate of wellKnownProviderPaths(command, discovery)) {
    const resolved = validateProviderPath(
      candidate,
      "well-known provider path",
      diagnostics,
      discovery,
      false,
    );
    if (resolved) {
      return {
        ok: true,
        command,
        path: resolved,
        source: "well_known",
        diagnostics: [`well-known provider path found: ${resolved}`],
      };
    }
  }

  const shellResolved = loginShellProviderPath(command, discovery, diagnostics);
  if (shellResolved) {
    return {
      ok: true,
      command,
      path: shellResolved,
      source: "login_shell_probe",
      diagnostics: [`login-shell probe provider path found: ${shellResolved}`, ...diagnostics],
    };
  }
  return {
    ok: false,
    command,
    source: "missing",
    diagnostics: diagnostics.length
      ? diagnostics
      : [`provider command not found through desktop resolver: ${command}`],
  };
}

function hasPathSeparator(command: string): boolean {
  return /[\\/]/.test(command);
}

function searchPath(command: string): string | undefined {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    for (const candidate of commandCandidates(directory, command)) {
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function commandCandidates(directory: string, command: string): string[] {
  const direct = path.join(directory, command);
  if (path.extname(command)) {
    return [direct];
  }
  return [
    direct,
    ...pathExtensions().map((extension) => path.join(directory, `${command}${extension}`)),
  ];
}

function pathExtensions(): string[] {
  return (process.env.PATHEXT ?? "")
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean)
    .map((extension) => (extension.startsWith(".") ? extension : `.${extension}`));
}

function wellKnownProviderPaths(
  command: string,
  discovery: ProviderToolDiscoveryOptions,
): string[] {
  if (discovery.wellKnownPaths?.length) {
    return discovery.wellKnownPaths.map((directory) => path.join(directory, command));
  }
  const home = discovery.homeDir ?? process.env.HOME;
  return [
    ...(home
      ? [
          path.join(home, ".local", "bin", command),
          path.join(home, "bin", command),
        ]
      : []),
    path.join("/opt/homebrew/bin", command),
    path.join("/usr/local/bin", command),
    path.join("/usr/bin", command),
  ];
}

function loginShellProviderPath(
  command: string,
  discovery: ProviderToolDiscoveryOptions,
  diagnostics: string[],
): string | undefined {
  const shellPath = discovery.shellPath ?? process.env.SHELL ?? "/bin/zsh";
  if (!path.isAbsolute(shellPath) || !isExecutableFile(shellPath)) {
    diagnostics.push(`login-shell probe unavailable; shell is not executable: ${shellPath}`);
    return undefined;
  }
  const home = discovery.homeDir ?? process.env.HOME ?? process.cwd();
  const result = spawnSync(shellPath, ["-lc", `command -v ${shellQuote(command)}`], {
    cwd: home,
    env: {
      HOME: home,
      SHELL: shellPath,
      PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      ...(discovery.shellEnv ?? {}),
    },
    encoding: "utf-8",
    timeout: discovery.probeTimeoutMs ?? 3000,
  });
  if (result.error) {
    diagnostics.push(`login-shell probe failed: ${result.error.message}`);
    return undefined;
  }
  if (result.status !== 0) {
    diagnostics.push(`login-shell probe did not find ${command}`);
    return undefined;
  }
  const lines = (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    diagnostics.push(`login-shell probe returned no path for ${command}`);
    return undefined;
  }
  if (lines.length > 1) {
    diagnostics.push(`login-shell probe must return a single path; got ${lines.length} lines`);
    return undefined;
  }
  return validateProviderPath(lines[0], "login-shell probe", diagnostics, discovery, true);
}

function validateProviderPath(
  candidate: string,
  sourceLabel: string,
  diagnostics: string[],
  discovery: ProviderToolDiscoveryOptions,
  rejectWorkspaceLocal: boolean,
): string | undefined {
  if (!path.isAbsolute(candidate)) {
    diagnostics.push(`${sourceLabel} returned a value that is not an absolute executable path: ${candidate}`);
    return undefined;
  }
  const resolved = path.resolve(candidate);
  if (
    rejectWorkspaceLocal
    && discovery.workspace
    && isInsideDirectory(discovery.workspace, resolved)
  ) {
    diagnostics.push(`${sourceLabel} returned a path inside the current workspace: ${resolved}`);
    return undefined;
  }
  if (!isExecutableFile(resolved)) {
    diagnostics.push(`${sourceLabel} is not executable: ${resolved}`);
    return undefined;
  }
  return resolved;
}

function isExecutableFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isInsideDirectory(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function firstDiagnosticLine(primaryOutput: string, secondaryOutput: string, maxChars: number): string {
  for (const output of [primaryOutput, secondaryOutput]) {
    for (const line of output.split(/\r?\n/)) {
      const detail = line.trim();
      if (!detail) {
        continue;
      }
      return detail.length <= maxChars ? detail : `${detail.slice(0, maxChars - 3)}...`;
    }
  }
  return "";
}

function isTimeoutError(error: Error): boolean {
  return "code" in error && (error as NodeJS.ErrnoException).code === "ETIMEDOUT";
}

function isAdapterEnvironmentError(message: string): boolean {
  return message.includes("env entries must be KEY=value strings");
}
