import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { AgentConfig } from "../adapters.js";
import { buildAgentProcessEnv } from "../process-env.js";
import { resolveProviderTool, type ProviderToolDiscoveryOptions } from "./provider-tools.js";
import { lookupRuntimeAdapter, normalizeRuntimeAdapterId } from "./registry.js";

export type ModelDiscoverySource = "adapter-cli" | "unsupported";

export type AdapterModelDiscovery =
  | {
      status: "discovered";
      adapterId: string;
      source: "adapter-cli";
      models: string[];
      command?: string[];
    }
  | {
      status: "unsupported";
      adapterId: string;
      source: "unsupported";
      reason: string;
    };

export type AdapterModelDiscoveryHook =
  | {
      status: "supported";
      adapterId: string;
      source: "adapter-cli";
      strategy: "command";
      command: string[];
      parser?: "lines" | "codex-json" | "antigravity-lines";
      calibratedBy: string[];
    }
  | {
      status: "supported";
      adapterId: string;
      source: "adapter-cli";
      strategy: "executable-strings";
      commandName: string;
      calibratedBy: string[];
    }
  | {
      status: "unsupported";
      adapterId: string;
      source: "unsupported";
      reason: string;
      calibratedBy: string[];
    };

export interface AdapterModelDiscoveryOptions {
  runCli?: boolean;
  /** Overrides the adapter's local model configuration path. Intended for embedding and tests. */
  modelConfigPath?: string;
  commandRunner?: (command: string[]) => {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
  };
  commandPathResolver?: (command: string) => string | undefined;
  providerToolDiscovery?: ProviderToolDiscoveryOptions | false;
  timeoutMs?: number;
}

export type ModelResolutionOptions = AdapterModelDiscoveryOptions;

export type ModelResolution =
  | {
      status: "resolved";
      canonicalModel: string;
    }
  | {
      status: "ambiguous";
      input: string;
      candidates: string[];
    }
  | {
      status: "not_found";
      input: string;
    };

export interface ModelAliasConfig {
  adapter: string;
  model: string;
}

const KNOWN_MODEL_RESOLUTION_FIXTURES: Record<string, string[]> = {
  "codex-cli": ["gpt-5.4", "gpt-5.5", "gpt-5.5-mini"],
  "claude-code-cli": ["opus-4.7", "claude-opus-4-7", "claude-sonnet-4.5", "claude-sonnet-4-6"],
  "cursor-agent": ["auto", "composer-2", "composer-2-fast", "grok-4.3", "kimi-k2.5"],
  "opencode-cli": ["openai/gpt-5.5", "zhuanzhuan/deepseek-v4-pro"],
};

const CLI_MODEL_DISCOVERY_HOOKS: Record<string, AdapterModelDiscoveryHook> = {
  "codex-cli": {
    status: "supported",
    adapterId: "codex-cli",
    source: "adapter-cli",
    strategy: "command",
    command: ["codex", "debug", "models", "--bundled"],
    parser: "codex-json",
    calibratedBy: ["codex", "debug", "models", "--help"],
  },
  "claude-code-cli": {
    status: "supported",
    adapterId: "claude-code-cli",
    source: "adapter-cli",
    strategy: "executable-strings",
    commandName: "claude",
    calibratedBy: ["claude", "--help"],
  },
  "cursor-agent": {
    status: "supported",
    adapterId: "cursor-agent",
    source: "adapter-cli",
    strategy: "command",
    command: ["cursor-agent", "models"],
    calibratedBy: ["cursor-agent", "--help"],
  },
  "antigravity-cli": {
    status: "supported",
    adapterId: "antigravity-cli",
    source: "adapter-cli",
    strategy: "command",
    command: ["agy", "models"],
    parser: "antigravity-lines",
    calibratedBy: ["agy", "models", "--help"],
  },
  "opencode-cli": {
    status: "supported",
    adapterId: "opencode-cli",
    source: "adapter-cli",
    strategy: "command",
    command: ["opencode", "models"],
    calibratedBy: ["opencode", "models", "--help"],
  },
};

export function resolveKnownAdapterModel(
  adapterIdOrAlias: string,
  userInput: string,
): ModelResolution {
  return resolveKnownAdapterModelWithAliases(adapterIdOrAlias, userInput, {});
}

export function resolveKnownAdapterModelWithAliases(
  adapterIdOrAlias: string,
  userInput: string,
  aliases: Record<string, ModelAliasConfig>,
  options: ModelResolutionOptions = {},
): ModelResolution {
  const adapterId = normalizeRuntimeAdapterId(adapterIdOrAlias);
  if (adapterId === "antigravity-cli" && normalizeModelKey(userInput) === "current") {
    return {
      status: "resolved",
      canonicalModel: "current",
    };
  }
  const discovery = discoverAdapterModels(adapterIdOrAlias, options);
  if (discovery.status === "discovered") {
    const discovered = resolveAdapterModel(discovery.adapterId, userInput, discovery.models);
    if (discovered.status !== "not_found") {
      return discovered;
    }
    const fixtureResolved = resolveKnownModelFixture(adapterId, userInput);
    if (fixtureResolved.status !== "not_found") {
      return fixtureResolved;
    }
    return resolveExplicitModelAlias(adapterIdOrAlias, userInput, aliases) ?? discovered;
  }
  const knownModels = KNOWN_MODEL_RESOLUTION_FIXTURES[adapterId] ?? [];
  if (knownModels.length > 0) {
    const fixtureResolved = resolveAdapterModel(adapterId, userInput, knownModels);
    if (fixtureResolved.status !== "not_found") {
      return fixtureResolved;
    }
    return resolveExplicitModelAlias(adapterIdOrAlias, userInput, aliases) ?? fixtureResolved;
  }
  const alias = resolveExplicitModelAlias(adapterIdOrAlias, userInput, aliases);
  if (alias) {
    return alias;
  }
  if (modelDiscoveryHook(adapterId).status === "supported") {
    const input = userInput.trim();
    if (adapterId !== "antigravity-cli" && isExplicitModelId(input)) {
      return { status: "resolved", canonicalModel: input };
    }
    return { status: "not_found", input };
  }
  return {
    status: "resolved",
    canonicalModel: userInput.trim(),
  };
}

function resolveKnownModelFixture(adapterId: string, userInput: string): ModelResolution {
  const models = KNOWN_MODEL_RESOLUTION_FIXTURES[adapterId] ?? [];
  return models.length > 0
    ? resolveAdapterModel(adapterId, userInput, models)
    : { status: "not_found", input: userInput.trim() };
}

function resolveExplicitModelAlias(
  adapterIdOrAlias: string,
  userInput: string,
  aliases: Record<string, ModelAliasConfig>,
): Extract<ModelResolution, { status: "resolved" }> | undefined {
  const alias = aliases[userInput.trim()];
  if (
    !alias ||
    normalizeRuntimeAdapterId(alias.adapter) !== normalizeRuntimeAdapterId(adapterIdOrAlias)
  ) {
    return undefined;
  }
  return {
    status: "resolved",
    canonicalModel: alias.model.trim(),
  };
}
export function discoverAdapterModels(
  adapterIdOrAlias: string,
  options: AdapterModelDiscoveryOptions = {},
): AdapterModelDiscovery {
  const adapterId = normalizeRuntimeAdapterId(adapterIdOrAlias);
  const hook = modelDiscoveryHook(adapterId);
  if (options.runCli && hook.status === "supported") {
    const cliModels = discoverCliModels(hook, options);
    if (cliModels.length > 0) {
      return {
        status: "discovered",
        adapterId,
        source: "adapter-cli",
        models: uniqueSorted(cliModels),
        ...(hook.strategy === "command" ? { command: modelDiscoveryCommand(hook, options) } : {}),
      };
    }
  }
  return {
    status: "unsupported",
    adapterId,
    source: "unsupported",
    reason: hook.status === "unsupported"
      ? hook.reason
      : `adapter ${adapterId} model discovery returned no models`,
  };
}

function discoverCliModels(
  hook: Extract<AdapterModelDiscoveryHook, { status: "supported"; source: "adapter-cli" }>,
  options: AdapterModelDiscoveryOptions,
): string[] {
  if (hook.strategy === "executable-strings") {
    return discoverExecutableStringModels(hook, options);
  }
  const command = modelDiscoveryCommand(hook, options);
  const result = options.commandRunner
    ? options.commandRunner(hook.command)
    : spawnModelDiscoveryCommand(command, options.timeoutMs, hook.adapterId);
  const cliModels = result.status !== 0
    ? []
    : hook.parser === "codex-json"
      ? parseCodexModelCatalog(result.stdout)
      : hook.parser === "antigravity-lines"
        ? parseAntigravityModelCatalog(result.stdout)
        : parseModelDiscoveryOutput(result.stdout);
  return uniqueSorted([...cliModels, ...discoverConfiguredModels(hook.adapterId, options)]);
}

function spawnModelDiscoveryCommand(
  command: string[],
  timeoutMs = 15_000,
  adapterId?: string,
): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const result = spawnSync(command[0], command.slice(1), {
    env: buildAgentProcessEnv(undefined, { adapterId }),
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    ...(result.error ? { error: result.error } : {}),
  };
}

function parseModelDiscoveryOutput(stdout: string): string[] {
  const models: string[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("Tip:") || /^available models$/i.test(line)) {
      continue;
    }
    const model = line.includes(" - ") ? line.split(" - ", 1)[0].trim() : line;
    if (isModelId(model)) {
      models.push(model);
    }
  }
  return uniqueSorted(models);
}

function parseAntigravityModelCatalog(stdout: string): string[] {
  return uniqueSorted(stdout.split(/\r?\n/)
    .map((line) => line.trim().replace(/^>\s*/, ""))
    .filter((line) => line.length > 0)
    .filter((line) => !/^available models$/i.test(line) && !/^tip:/i.test(line))
    .filter((line) => /^[A-Za-z][A-Za-z0-9][A-Za-z0-9 ._:/-]*(?:\s+\([^\r\n)]+\))?$/.test(line)));
}

function parseCodexModelCatalog(stdout: string): string[] {
  try {
    const payload = JSON.parse(stdout) as {
      models?: Array<string | { slug?: unknown; id?: unknown; name?: unknown; visibility?: unknown }>;
    };
    const models = Array.isArray(payload.models) ? payload.models : [];
    return uniqueSorted(models.flatMap((item) => {
      if (typeof item === "string") {
        return isModelId(item) ? [item] : [];
      }
      const visibility = typeof item.visibility === "string" ? item.visibility : "";
      if (visibility.toLowerCase() === "hidden" || visibility.toLowerCase() === "hide") {
        return [];
      }
      const value = [item.slug, item.id, item.name].find((candidate): candidate is string =>
        typeof candidate === "string" && isModelId(candidate)
      );
      return value ? [value] : [];
    }));
  } catch {
    return [];
  }
}

function discoverExecutableStringModels(
  hook: Extract<AdapterModelDiscoveryHook, { strategy: "executable-strings" }>,
  options: AdapterModelDiscoveryOptions,
): string[] {
  const commandPath = resolveCommandPath(hook.commandName, options, hook.adapterId);
  if (!commandPath) {
    return [];
  }
  const stringsCommand = ["strings", commandPath];
  const result = options.commandRunner
    ? options.commandRunner(stringsCommand)
    : spawnModelDiscoveryCommand(stringsCommand, options.timeoutMs, hook.adapterId);
  const executableText = result.status === 0 ? result.stdout : readTextFile(commandPath);
  const executableModels = executableText ? extractExecutableModelIds(hook.adapterId, executableText) : [];
  if (hook.adapterId === "claude-code-cli") {
    return uniqueSorted([...executableModels, ...discoverConfiguredModels(hook.adapterId, options)]);
  }
  return executableModels;
}

const CLAUDE_MODEL_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
] as const;

function discoverConfiguredModels(adapterId: string, options: AdapterModelDiscoveryOptions): string[] {
  // An injected runner represents a fully controlled discovery fixture. Only merge host
  // configuration when the caller also supplies the fixture's explicit config path.
  if (options.commandRunner && !options.modelConfigPath) {
    return [];
  }
  if (adapterId === "claude-code-cli") {
    return discoverConfiguredClaudeModels(options);
  }
  const configPath = options.modelConfigPath ?? defaultModelConfigPath(adapterId);
  const configText = readTextFile(configPath);
  if (!configText) return [];
  try {
    if (adapterId === "codex-cli") return discoverConfiguredCodexModels(configPath, configText);
    const config = JSON.parse(configText) as Record<string, unknown>;
    if (adapterId === "cursor-agent") return discoverConfiguredCursorModels(config);
    if (adapterId === "opencode-cli") return discoverConfiguredOpenCodeModels(config);
    if (adapterId === "antigravity-cli") return discoverConfiguredAntigravityModels(config);
  } catch {
    return [];
  }
  return [];
}

function discoverConfiguredCodexModels(configPath: string, configText: string): string[] {
  const model = configText.match(/^model\s*=\s*["']([^"']+)["']/m)?.[1];
  const catalogPath = configText.match(/^model_catalog_json\s*=\s*["']([^"']+)["']/m)?.[1];
  const catalogModels = catalogPath
    ? parseCodexModelCatalog(readTextFile(path.resolve(path.dirname(configPath), catalogPath)) ?? "")
    : [];
  return uniqueSorted([...(model && isModelId(model) ? [model] : []), ...catalogModels]);
}

function discoverConfiguredCursorModels(config: Record<string, unknown>): string[] {
  const ids = [
    nestedString(config, ["model", "modelId"]),
    nestedString(config, ["selectedModel", "modelId"]),
    ...Object.keys(asRecord(config.modelParameters) ?? {}),
  ];
  return ids.filter((value): value is string => Boolean(value && isModelId(value)));
}

function discoverConfiguredOpenCodeModels(config: Record<string, unknown>): string[] {
  const disabled = new Set(asStringArray(config.disabled_providers));
  const providers = asRecord(config.provider) ?? {};
  return Object.entries(providers).flatMap(([provider, raw]) => {
    if (disabled.has(provider)) return [];
    const models = asRecord(asRecord(raw)?.models) ?? {};
    return Object.keys(models).filter(isModelId).map((model) => `${provider}/${model}`);
  });
}

function discoverConfiguredAntigravityModels(config: Record<string, unknown>): string[] {
  const model = nestedString(config, ["model"]);
  return model && isAntigravityConfiguredModel(model) ? [model] : [];
}

function discoverConfiguredClaudeModels(options: AdapterModelDiscoveryOptions): string[] {
  const settingsPath = options.modelConfigPath ?? path.join(homedir(), ".claude", "settings.json");
  const settingsText = readTextFile(settingsPath);
  if (!settingsText) {
    return [];
  }
  try {
    const settings = JSON.parse(settingsText) as { env?: unknown };
    const env = settings.env;
    if (!env || typeof env !== "object" || Array.isArray(env)) {
      return [];
    }
    return CLAUDE_MODEL_ENV_KEYS.flatMap((key) => {
      const value = (env as Record<string, unknown>)[key];
      return typeof value === "string" && isConfiguredClaudeModelId(value) ? [value.trim()] : [];
    });
  } catch {
    return [];
  }
}

function defaultModelConfigPath(adapterId: string): string {
  switch (adapterId) {
    case "codex-cli": return path.join(homedir(), ".codex", "config.toml");
    case "cursor-agent": return path.join(homedir(), ".cursor", "cli-config.json");
    case "opencode-cli": return path.join(homedir(), ".config", "opencode", "opencode.json");
    case "antigravity-cli": return path.join(homedir(), ".gemini", "antigravity-cli", "settings.json");
    default: return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nestedString(value: unknown, keys: string[]): string | undefined {
  let current: unknown = value;
  for (const key of keys) current = asRecord(current)?.[key];
  return typeof current === "string" ? current.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isAntigravityConfiguredModel(value: string): boolean {
  return /^(?:Gemini|Claude|GPT-OSS)\s+[A-Za-z0-9 .-]+(?:\s+\((?:Current|High|Medium|Low|Thinking|None)\))?$/i.test(value.trim());
}

function isConfiguredClaudeModelId(value: string): boolean {
  const withoutVariant = value.trim().replace(/\[[^\]]+\]$/, "");
  return /^(?:[a-z0-9._-]+-)?claude-(?:opus|sonnet|haiku)-[a-z0-9._-]+$/i.test(withoutVariant);
}

function extractExecutableModelIds(adapterId: string, text: string): string[] {
  return adapterId === "antigravity-cli"
    ? extractAntigravityModelIds(text)
    : extractClaudeModelIds(text);
}

function modelDiscoveryCommand(
  hook: Extract<AdapterModelDiscoveryHook, { strategy: "command" }>,
  options: AdapterModelDiscoveryOptions,
): string[] {
  if (options.commandRunner) {
    return [...hook.command];
  }
  const commandPath = resolveCommandPath(hook.command[0], options, hook.adapterId);
  return [commandPath ?? hook.command[0], ...hook.command.slice(1)];
}

function resolveCommandPath(
  command: string,
  options: AdapterModelDiscoveryOptions,
  adapterId?: string,
): string | undefined {
  const resolved = options.commandPathResolver?.(command);
  if (resolved) {
    return resolved;
  }
  if ((command.includes("/") || command.includes("\\")) && existsSync(command)) {
    return command;
  }
  const providerResolved = adapterId ? resolveProviderCommandPath(adapterId, command, options) : undefined;
  if (providerResolved) {
    return providerResolved;
  }
  const lookupCommand = process.platform === "win32" ? ["where", command] : ["which", command];
  const result = spawnModelDiscoveryCommand(lookupCommand, options.timeoutMs, adapterId);
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function resolveProviderCommandPath(
  adapterId: string,
  command: string,
  options: AdapterModelDiscoveryOptions,
): string | undefined {
  if (options.providerToolDiscovery === false) {
    return undefined;
  }
  let adapter;
  try {
    adapter = lookupRuntimeAdapter(adapterId);
  } catch {
    return undefined;
  }
  if (adapter.command !== command) {
    return undefined;
  }
  const agent: AgentConfig = {
    id: adapter.id,
    label: adapter.label,
    adapter: adapter.id,
    command: adapter.command,
    args: [...adapter.args],
    env: [],
    capabilities: [],
  };
  const resolution = resolveProviderTool(agent, {
    ...(options.providerToolDiscovery ?? {}),
    enabled: options.providerToolDiscovery?.enabled ?? true,
    workspace: options.providerToolDiscovery?.workspace ?? process.cwd(),
  });
  return resolution.path;
}

function extractClaudeModelIds(text: string): string[] {
  const matches = text.match(/\bclaude-[a-z0-9][a-z0-9._-]*\b/gi) ?? [];
  return uniqueSorted(matches.map((value) => value.toLowerCase()).filter(isClaudeCliModelId));
}

function isClaudeCliModelId(value: string): boolean {
  if (!/(opus|sonnet|haiku)/.test(value)) {
    return false;
  }
  if (!/^claude-(?:3|opus|sonnet|haiku)-/.test(value)) {
    return false;
  }
  return !/(?:code|cli|plugin|api|desktop|settings|prompt|context|agent|mcp|http|socks|folder|review|local|native|swift|dev|feedback|marketplace|directory|browser|chrome|token|releases|guide|daemon|hidden|channel)/.test(value);
}

function extractAntigravityModelIds(text: string): string[] {
  return uniqueSorted([
    ...matchesFor(text, /gemini-(?:2\.5-(?:flash-lite|flash|pro)|3(?:\.1|\.5)?-(?:flash-lite|flash|pro))(?:-(?:preview|image-preview|1p-thoughts|windsurf(?:-debug)?))?/gi),
    ...matchesFor(text, /claude-(?:opus|sonnet|haiku)-[0-9](?:-[0-9])?/gi),
    ...matchesFor(text, /gpt-oss-(?:20b|120b)-maas/gi),
    ...extractAntigravityModelLabelIds(text),
  ].map((value) => value.toLowerCase()).filter(isAntigravityCliModelId));
}

function matchesFor(text: string, pattern: RegExp): string[] {
  return Array.from(text.matchAll(pattern), (match) => match[0]);
}

function extractAntigravityModelLabelIds(text: string): string[] {
  const quotedLabels = Array.from(
    text.matchAll(/\blabel="([^"]+)"/gi),
    (match) => match[1],
  );
  const lineLabels = text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*>?\s*((?:Gemini|Claude|GPT-OSS)\s+[A-Za-z0-9 .-]+(?:\s+\([^)]+\))?)/i);
    return match ? [match[1]] : [];
  });
  return [...quotedLabels, ...lineLabels]
    .map(antigravityModelIdFromLabel)
    .filter((model): model is string => Boolean(model));
}

function antigravityModelIdFromLabel(label: string): string | undefined {
  let value = label.trim();
  for (;;) {
    const next = value.replace(/\s+\((?:current|high|medium|low|thinking|none)\)\s*$/i, "").trim();
    if (next === value) {
      break;
    }
    value = next;
  }
  const gemini = value.match(/^gemini\s+([0-9]+(?:\.[0-9]+)?)\s+(pro|flash|flash\s+lite)$/i);
  if (gemini) {
    return `gemini-${gemini[1]}-${gemini[2].toLowerCase().replace(/\s+/g, "-")}`;
  }
  const claude = value.match(/^claude\s+(opus|sonnet|haiku)\s+([0-9]+(?:\.[0-9]+)?)$/i);
  if (claude) {
    return `claude-${claude[1].toLowerCase()}-${claude[2].replace(/\./g, "-")}`;
  }
  const gptOss = value.match(/^gpt-oss\s+([0-9]+b)$/i);
  if (gptOss) {
    return `gpt-oss-${gptOss[1].toLowerCase()}-maas`;
  }
  return undefined;
}

function isAntigravityCliModelId(value: string): boolean {
  if (/(?:debug|windsurf|thoughts|image-preview)$/.test(value)) {
    return false;
  }
  return /^(?:gemini-(?:2\.5-(?:pro|flash|flash-lite)|3(?:\.1|\.5)?-(?:pro|flash|flash-lite)(?:-preview)?)|claude-(?:opus|sonnet|haiku)-[0-9](?:-[0-9])?|gpt-oss-(?:20b|120b)-maas)$/.test(value);
}

function readTextFile(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function isModelId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._/-]*$/i.test(value);
}

function isExplicitModelId(value: string): boolean {
  return isModelId(value) && /[0-9._/-]/.test(value);
}

export function modelDiscoveryHook(adapterIdOrAlias: string): AdapterModelDiscoveryHook {
  const adapterId = normalizeRuntimeAdapterId(adapterIdOrAlias);
  return CLI_MODEL_DISCOVERY_HOOKS[adapterId] ?? unsupportedHook(
    adapterId,
    `adapter ${adapterId} does not provide model discovery`,
    [],
  );
}

export function resolveAdapterModel(
  adapterIdOrAlias: string,
  userInput: string,
  discoveredModels: string[],
): ModelResolution;
export function resolveAdapterModel(
  userInput: string,
  discoveredModels: string[],
): ModelResolution;
export function resolveAdapterModel(
  adapterOrUserInput: string,
  userInputOrDiscoveredModels: string | string[],
  maybeDiscoveredModels?: string[],
): ModelResolution {
  const userInput = Array.isArray(userInputOrDiscoveredModels)
    ? adapterOrUserInput
    : userInputOrDiscoveredModels;
  const adapterId = Array.isArray(userInputOrDiscoveredModels)
    ? undefined
    : normalizeRuntimeAdapterId(adapterOrUserInput);
  const discoveredModels = maybeDiscoveredModels ?? (
    Array.isArray(userInputOrDiscoveredModels) ? userInputOrDiscoveredModels : []
  );
  const input = userInput.trim();
  if (!input) {
    return { status: "not_found", input: userInput };
  }
  const models = uniqueSorted(discoveredModels.map((model) => model.trim()).filter(Boolean));
  const exact = models.find((model) => model.toLowerCase() === input.toLowerCase());
  if (exact) {
    return { status: "resolved", canonicalModel: exact };
  }

  const inputKey = normalizeModelKey(input);
  if (!inputKey) {
    return { status: "not_found", input };
  }
  const inputCompactKey = compactModelKey(input);
  const exactKeyMatches = models.filter((model) => {
    const keys = modelAliasKeys(model, adapterId);
    return keys.includes(inputKey) || Boolean(inputCompactKey && keys.includes(inputCompactKey));
  });
  if (exactKeyMatches.length === 1) {
    return { status: "resolved", canonicalModel: exactKeyMatches[0] };
  }
  if (exactKeyMatches.length > 1) {
    return ambiguous(input, exactKeyMatches);
  }

  const prefixMatches = models.filter((model) => modelAliasKeys(model, adapterId).some((key) =>
    key.startsWith(inputKey) || Boolean(inputCompactKey && key.startsWith(inputCompactKey))
  ));
  if (prefixMatches.length === 1) {
    return { status: "resolved", canonicalModel: prefixMatches[0] };
  }
  if (prefixMatches.length > 1) {
    return ambiguous(input, prefixMatches);
  }

  return { status: "not_found", input };
}

export function normalizeModelKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function modelSlugSegment(canonicalModel: string): string {
  const segment = canonicalModel.split("/").filter(Boolean).at(-1) ?? canonicalModel;
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function modelAliasKeys(model: string, adapterId?: string): string[] {
  const finalSegment = model.split("/").filter(Boolean).at(-1) ?? model;
  const normalized = normalizeModelKey(model);
  const normalizedSegment = normalizeModelKey(finalSegment);
  return uniqueSorted([
    normalized,
    compactModelKey(model),
    normalizedSegment,
    compactModelKey(finalSegment),
    ...composerSpellingAliasKeys(normalized, adapterId),
    ...composerSpellingAliasKeys(normalizedSegment, adapterId),
  ].filter(Boolean));
}

function compactModelKey(value: string): string {
  return normalizeModelKey(value).replace(/-/g, "");
}

function composerSpellingAliasKeys(normalizedKey: string, adapterId?: string): string[] {
  if (adapterId !== "cursor-agent" || !normalizedKey.includes("composer")) {
    return [];
  }
  const composeKey = normalizedKey.replace(/composer/g, "compose");
  return [composeKey, composeKey.replace(/-/g, "")];
}

function ambiguous(input: string, candidates: string[]): ModelResolution {
  return {
    status: "ambiguous",
    input,
    candidates: uniqueSorted(candidates),
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function unsupportedHook(
  adapterId: string,
  reason: string,
  calibratedBy: string[],
): AdapterModelDiscoveryHook {
  return {
    status: "unsupported",
    adapterId,
    source: "unsupported",
    reason,
    calibratedBy,
  };
}
