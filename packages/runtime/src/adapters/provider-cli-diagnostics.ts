import { spawnSync } from "node:child_process";

import type { AgentConfig } from "../adapters.js";
import { resolveProviderTool, type ProviderToolDiscoveryOptions, type ProviderToolResolutionSource } from "./provider-tools.js";
import { lookupRuntimeAdapter } from "./registry.js";

export type SupportedProviderCliTool = "codex" | "claude" | "cursor" | "antigravity" | "opencode";

export interface ProviderCliDetectionOptions extends ProviderToolDiscoveryOptions {
  versionTimeoutMs?: number;
}

export interface ProviderCliDetectionReport {
  schema_version: 1;
  tools: ProviderCliToolReport[];
}

export interface ProviderCliToolReport {
  tool: SupportedProviderCliTool;
  adapter: string;
  label: string;
  command: string;
  found: boolean;
  source: ProviderToolResolutionSource;
  path?: string;
  version: string;
  diagnostics: string[];
  diagnostic?: string;
}

const SUPPORTED_PROVIDER_CLIS: Array<{
  tool: SupportedProviderCliTool;
  adapter: string;
}> = [
  { tool: "codex", adapter: "codex-cli" },
  { tool: "claude", adapter: "claude-code-cli" },
  { tool: "cursor", adapter: "cursor-agent" },
  { tool: "antigravity", adapter: "antigravity-cli" },
  { tool: "opencode", adapter: "opencode-cli" },
];

export function detectSupportedProviderClis(
  options: ProviderCliDetectionOptions = {},
): ProviderCliDetectionReport {
  return {
    schema_version: 1,
    tools: SUPPORTED_PROVIDER_CLIS.map((provider) => detectProviderCli(provider, options)),
  };
}

function detectProviderCli(
  provider: { tool: SupportedProviderCliTool; adapter: string },
  options: ProviderCliDetectionOptions,
): ProviderCliToolReport {
  const adapter = lookupRuntimeAdapter(provider.adapter);
  const agent: AgentConfig = {
    id: provider.tool,
    label: adapter.label,
    adapter: adapter.id,
    command: adapter.command,
    args: [...adapter.args],
    env: [],
    capabilities: [],
  };
  const resolution = resolveProviderTool(agent, {
    ...options,
    enabled: options.enabled ?? true,
  });
  const versionProbe = resolution.path
    ? providerCliVersion(resolution.path, options.versionTimeoutMs)
    : { version: "missing", diagnostics: [] };
  const diagnostics = [...resolution.diagnostics, ...versionProbe.diagnostics];
  return {
    tool: provider.tool,
    adapter: adapter.id,
    label: adapter.label,
    command: adapter.command,
    found: resolution.ok,
    source: resolution.source,
    ...(resolution.path ? { path: resolution.path } : {}),
    version: versionProbe.version,
    diagnostics,
    ...(diagnostics[0] ? { diagnostic: diagnostics[0] } : {}),
  };
}

function providerCliVersion(commandPath: string, timeoutMs = 5_000): {
  version: string;
  diagnostics: string[];
} {
  const result = spawnSync(commandPath, ["--version"], {
    encoding: "utf-8",
    timeout: timeoutMs,
  });
  if (result.error) {
    return {
      version: "unknown",
      diagnostics: [`version probe failed: ${result.error.message}`],
    };
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (result.status !== 0) {
    return {
      version: output ?? "unknown",
      diagnostics: [`version probe exited with code ${result.status ?? "unknown"}`],
    };
  }
  return {
    version: output ?? "unknown",
    diagnostics: output ? [] : ["version probe returned no output"],
  };
}
