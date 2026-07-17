import type { AdapterCapabilityMetadata } from "@agentmesh/core";
import type { RuntimeAdapterMetadata } from "./registry.js";
import { type ModelResolution } from "./models.js";
import type { AdapterSessionDirective, AdapterStructuredResult } from "./session.js";

export interface AdapterPluginAgentConfig {
  id: string;
  label: string;
  adapter: string;
  command: string;
  args: string[];
  env: string[];
  aliases: string[];
  capabilities: string[];
  model?: string;
  reasoning_effort?: string;
  prompt_file_arg?: string;
  prompt_arg?: string;
  output_file_arg?: string;
  stdin?: boolean;
}

export interface AdapterPluginAgentInput {
  agentId: string;
  label?: string;
  command?: string;
  args?: string[];
  env?: string[];
  aliases?: string[];
  capabilities?: string[];
  model: string;
  reasoningEffort?: string;
  promptFileArg?: string;
  promptArg?: string;
  outputFileArg?: string;
  stdin?: boolean;
}

export interface AdapterPluginManifest {
  id: string;
  aliases: string[];
  label: string;
  description: string;
  capabilities: AdapterCapabilityMetadata;
}

export interface AdapterPluginDetectRequest {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

export type AdapterPluginDetectResult =
  | { status: "available"; message?: string }
  | { status: "missing" | "unknown"; message: string };

export interface AdapterPluginProbeRequest {
  agent: AdapterPluginAgentConfig;
  timeoutSecs?: number;
}

export interface AdapterPluginProbeResult {
  ok: boolean;
  status: "ready" | "not_ready" | "unknown";
  message?: string;
  hints?: string[];
}

export interface AdapterPluginInvocationRequest {
  agent: AdapterPluginAgentConfig;
  prompt?: string;
  promptFile?: string;
  outputFile?: string;
}

export interface AdapterPluginInvocation {
  adapterId: string;
  command: string[];
  env?: Record<string, string>;
  stdin?: string;
  outputFile?: string;
  captureStdout: boolean;
  nonInteractive: boolean;
}

export interface AdapterPluginSessionInvocationRequest extends AdapterPluginInvocationRequest {
  session: AdapterSessionDirective;
}

export interface AdapterPluginResultOutput {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
}

export interface AdapterPluginParsedResult {
  ok: boolean;
  status: "ok" | "failed" | "timeout";
  stdout?: string;
  stderr?: string;
  message?: string;
}

export interface AdapterPlugin extends AdapterPluginManifest {
  command?: string;
  args?: string[];
  detect(request: AdapterPluginDetectRequest): AdapterPluginDetectResult;
  resolveModel(input: string): ModelResolution;
  probe(request: AdapterPluginProbeRequest): AdapterPluginProbeResult;
  buildInvocation(request: AdapterPluginInvocationRequest): AdapterPluginInvocation;
  parseResult(output: AdapterPluginResultOutput): AdapterPluginParsedResult;
  buildSessionInvocation?(request: AdapterPluginSessionInvocationRequest): AdapterPluginInvocation;
  parseStructuredSessionResult?(output: AdapterPluginResultOutput): AdapterStructuredResult;
}

export function defineAdapterPlugin(plugin: AdapterPlugin): AdapterPlugin {
  validateAdapterPluginId(plugin.id);
  for (const alias of plugin.aliases) {
    validateAdapterPluginId(alias);
  }
  return {
    ...plugin,
    aliases: [...plugin.aliases],
    args: plugin.args ? [...plugin.args] : undefined,
    capabilities: cloneCapabilities(plugin.capabilities),
  };
}

export function adapterPluginManifest(plugin: AdapterPlugin): AdapterPluginManifest {
  return {
    id: plugin.id,
    aliases: [...plugin.aliases],
    label: plugin.label,
    description: plugin.description,
    capabilities: cloneCapabilities(plugin.capabilities),
  };
}

export function adapterPluginManifestFromRuntimeAdapter(
  adapter: RuntimeAdapterMetadata,
): AdapterPluginManifest {
  return {
    id: adapter.id,
    aliases: [...adapter.aliases],
    label: adapter.label,
    description: adapter.description,
    capabilities: cloneCapabilities(adapter.capabilities),
  };
}

export function buildAdapterPluginAgentConfig(
  plugin: AdapterPlugin,
  input: AdapterPluginAgentInput,
): AdapterPluginAgentConfig {
  const resolution = plugin.resolveModel(input.model);
  if (resolution.status !== "resolved") {
    throw new Error(`could not resolve model for adapter plugin ${plugin.id}: ${input.model}`);
  }
  const command = input.command ?? plugin.command;
  if (!command) {
    throw new Error(`command is required for adapter plugin ${plugin.id}`);
  }
  const model = resolution.canonicalModel;
  return {
    id: input.agentId,
    label: input.label ?? `${plugin.label} (${model})`,
    adapter: plugin.id,
    command,
    args: input.args ? [...input.args] : [...(plugin.args ?? [])],
    env: [...(input.env ?? [])],
    aliases: [...(input.aliases ?? [])],
    capabilities: input.capabilities?.length ? [...input.capabilities] : [...plugin.capabilities.stages],
    model,
    reasoning_effort: input.reasoningEffort ?? "high",
    ...(input.promptFileArg ? { prompt_file_arg: input.promptFileArg } : {}),
    ...(input.promptArg ? { prompt_arg: input.promptArg } : {}),
    ...(input.outputFileArg ? { output_file_arg: input.outputFileArg } : {}),
    ...(input.stdin === true ? { stdin: true } : {}),
  };
}

function validateAdapterPluginId(value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(
      `adapter plugin id must start with a letter and contain only letters, numbers, dot, underscore, or dash: ${value}`,
    );
  }
}

function cloneCapabilities(capabilities: AdapterCapabilityMetadata): AdapterCapabilityMetadata {
  return {
    roles: [...capabilities.roles],
    stages: [...capabilities.stages],
    ...(capabilities.supports_non_interactive === undefined
      ? {}
      : { supports_non_interactive: capabilities.supports_non_interactive }),
    ...(capabilities.supports_resume === undefined
      ? {}
      : { supports_resume: capabilities.supports_resume }),
    ...(capabilities.supports_structured_session_id === undefined
      ? {}
      : { supports_structured_session_id: capabilities.supports_structured_session_id }),
  };
}
