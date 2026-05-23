import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

import type { AgentConfig } from "../adapters.js";

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

  const found = searchPath(command);
  if (found) {
    return {
      ok: true,
      command,
      path: found,
      source: "path",
      diagnostics: [`PATH provider command found: ${found}`],
    };
  }
  if (discovery.enabled !== true) {
    return {
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
          path.join(home, ".bun", "bin", command),
          path.join(home, ".npm-global", "bin", command),
          path.join(home, `.${command}`, "bin", command),
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
