import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

import type { AgentConfig } from "../adapters.js";
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
      parser?: "lines" | "codex-json";
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
  commandRunner?: (command: string[]) => {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
  };
  commandPathResolver?: (command: string) => string | undefined;
  providerToolDiscovery?: ProviderToolDiscoveryOptions | false;
  userDataTextProvider?: (adapterId: string) => string[];
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
    strategy: "executable-strings",
    commandName: "agy",
    calibratedBy: ["agy", "--help"],
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

const ANTIGRAVITY_USER_MODEL_TEXT_MAX_FILES = 20;
const ANTIGRAVITY_USER_MODEL_TEXT_MAX_BYTES = 1024 * 1024;

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
    if (isExplicitModelId(input)) {
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
    : spawnModelDiscoveryCommand(command, options.timeoutMs);
  if (result.status !== 0) {
    return [];
  }
  return hook.parser === "codex-json"
    ? parseCodexModelCatalog(result.stdout)
    : parseModelDiscoveryOutput(result.stdout);
}

function spawnModelDiscoveryCommand(
  command: string[],
  timeoutMs = 5000,
): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const result = spawnSync(command[0], command.slice(1), {
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
    : spawnModelDiscoveryCommand(stringsCommand, options.timeoutMs);
  const executableText = result.status === 0 ? result.stdout : readTextFile(commandPath);
  const executableModels = executableText ? extractExecutableModelIds(hook.adapterId, executableText) : [];
  if (hook.adapterId !== "antigravity-cli") {
    return executableModels;
  }
  return uniqueSorted([
    ...executableModels,
    ...discoverAntigravityUserDataModels(options),
  ]);
}

function extractExecutableModelIds(adapterId: string, text: string): string[] {
  return adapterId === "antigravity-cli"
    ? extractAntigravityModelIds(text)
    : extractClaudeModelIds(text);
}

function discoverAntigravityUserDataModels(options: AdapterModelDiscoveryOptions): string[] {
  const texts = options.userDataTextProvider
    ? options.userDataTextProvider("antigravity-cli")
    : readAntigravityUserModelTexts();
  return extractAntigravityModelIds(texts.join("\n"));
}

function readAntigravityUserModelTexts(): string[] {
  const home = process.env.HOME;
  if (!home) {
    return [];
  }
  return [
    join(home, ".gemini", "antigravity-cli", "log"),
    join(home, ".gemini", "antigravity"),
  ].flatMap(readRecentAntigravityTextFiles);
}

function readRecentAntigravityTextFiles(directory: string): string[] {
  if (!isDirectory(directory)) {
    return [];
  }
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  return entries
    .map((name) => join(directory, name))
    .filter(isAntigravityUserModelTextFile)
    .flatMap((filePath) => {
      const stat = safeStat(filePath);
      if (
        !stat?.isFile()
        || stat.size <= 0
        || stat.size > ANTIGRAVITY_USER_MODEL_TEXT_MAX_BYTES
      ) {
        return [];
      }
      return [{ filePath, mtimeMs: Number(stat.mtimeMs) }];
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, ANTIGRAVITY_USER_MODEL_TEXT_MAX_FILES)
    .map((entry) => readTextFile(entry.filePath))
    .filter((text): text is string => Boolean(text));
}

function isAntigravityUserModelTextFile(filePath: string): boolean {
  return /(?:\.log|\.pbtxt|\.json|\.txt)$/i.test(filePath)
    || /(?:^|\/)(?:Preferences|app_storage\.json)$/i.test(filePath);
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
  const result = spawnModelDiscoveryCommand(lookupCommand, options.timeoutMs);
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

function safeStat(filePath: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(filePath);
  } catch {
    return undefined;
  }
}

function isDirectory(filePath: string): boolean {
  return safeStat(filePath)?.isDirectory() ?? false;
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
