import { readFileSync } from "node:fs";

import type {
  AdapterPlugin,
  AdapterPluginAgentConfig,
  AdapterPluginInvocation,
} from "./plugin.js";
import { lookupRuntimeAdapter } from "./registry.js";
import type { AdapterSessionDirective } from "./session.js";

export interface AdapterInvocationAgent {
  id: string;
  adapter: string;
  command: string;
  args: string[];
  env?: string[];
  model?: string;
  reasoning_effort?: string;
  prompt_file_arg?: string;
  prompt_arg?: string;
  output_file_arg?: string;
  stdin?: boolean;
}

export interface AdapterInvocationOptions {
  prompt?: string;
  promptFile?: string;
  outputFile?: string;
}

export interface PreparedAdapterInvocation {
  adapterId: string;
  command: string[];
  env?: Record<string, string>;
  stdin?: string;
  outputFile?: string;
  captureStdout: boolean;
  nonInteractive: boolean;
}

export function prepareAdapterPluginSessionInvocation(
  plugin: AdapterPlugin,
  agent: AdapterPluginAgentConfig,
  options: AdapterInvocationOptions,
  session: AdapterSessionDirective,
): AdapterPluginInvocation {
  if (
    plugin.capabilities.supports_resume === true &&
    plugin.capabilities.supports_structured_session_id === true &&
    plugin.buildSessionInvocation &&
    plugin.parseStructuredSessionResult
  ) {
    return plugin.buildSessionInvocation({ ...options, agent, session });
  }
  return plugin.buildInvocation({ ...options, agent });
}

export function prepareAdapterInvocation(
  agent: AdapterInvocationAgent,
  options: AdapterInvocationOptions,
): PreparedAdapterInvocation {
  const metadata = lookupRuntimeAdapter(agent.adapter);
  const prepared =
    metadata.id === "command"
      ? prepareCommandInvocation(agent, options)
      : prepareAiCliInvocation(agent, metadata.id, options);
  if (agent.output_file_arg && options.outputFile) {
    prepared.command.push(agent.output_file_arg, options.outputFile);
  }
  return {
    adapterId: metadata.id,
    command: prepared.command,
    env: prepareAdapterEnvironment(agent),
    stdin: prepared.stdin,
    outputFile: options.outputFile,
    captureStdout: Boolean(options.outputFile && !agent.output_file_arg),
    nonInteractive: metadata.capabilities.supports_non_interactive === true,
  };
}

export function prepareAdapterEnvironment(
  agent: AdapterInvocationAgent,
): Record<string, string> | undefined {
  if (!agent.env?.length) {
    return undefined;
  }
  const env: Record<string, string> = {};
  for (const entry of agent.env) {
    const separatorIndex = entry.indexOf("=");
    const key = separatorIndex === -1 ? "" : entry.slice(0, separatorIndex);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(
        `agent ${agent.id}: env entries must be KEY=value strings with shell-compatible keys`,
      );
    }
    env[key] = entry.slice(separatorIndex + 1);
  }
  return env;
}

function prepareCommandInvocation(
  agent: AdapterInvocationAgent,
  options: AdapterInvocationOptions,
): { command: string[]; stdin?: string } {
  const command = [agent.command, ...agent.args];
  let stdin: string | undefined;
  if (agent.prompt_file_arg && options.promptFile) {
    command.push(agent.prompt_file_arg, options.promptFile);
  } else if (agent.prompt_arg) {
    command.push(agent.prompt_arg, readPrompt(options.promptFile, options.prompt));
  } else if (agent.stdin) {
    stdin = readPrompt(options.promptFile, options.prompt);
  } else if (options.promptFile || options.prompt !== undefined) {
    stdin = readPrompt(options.promptFile, options.prompt);
  }
  return { command, stdin };
}

function prepareAiCliInvocation(
  agent: AdapterInvocationAgent,
  adapterId: string,
  options: AdapterInvocationOptions,
): { command: string[]; stdin?: string } {
  if (adapterId !== "antigravity-cli" && !agent.model) {
    throw new Error(`agent ${agent.id}: model is required for ${adapterId}`);
  }
  const command = [agent.command, ...agent.args, ...modelArgs(adapterId, agent)];
  const prompt = readPrompt(options.promptFile, options.prompt);
  if (adapterId === "antigravity-cli") {
    command.push("-p", prompt);
    return { command };
  }
  if (adapterId === "opencode-cli") {
    command.push(prompt);
    return { command };
  }
  if (adapterId === "cursor-agent") {
    if (!prompt.trim()) {
      throw new Error(`agent ${agent.id}: prompt is required for cursor-agent`);
    }
    command.push(prompt);
    return { command };
  }
  if (adapterId === "codex-cli") {
    command.push("-");
  }
  return { command, stdin: prompt };
}

function modelArgs(adapterId: string, agent: AdapterInvocationAgent): string[] {
  const model = agent.model ?? "";
  const effort = agent.reasoning_effort ?? "none";
  if (adapterId === "codex-cli") {
    return effort === "none"
      ? ["-m", model]
      : ["-m", model, "-c", `model_reasoning_effort=${JSON.stringify(effort)}`];
  }
  if (adapterId === "claude-code-cli") {
    return effort === "none" ? ["--model", model] : ["--model", model, "--effort", effort];
  }
  if (adapterId === "antigravity-cli") {
    return model && model !== "current" ? ["--model", model] : [];
  }
  if (adapterId === "opencode-cli") {
    return effort === "none"
      ? ["--model", model]
      : ["--model", model, "--variant", effort === "xhigh" ? "max" : effort];
  }
  if (adapterId === "cursor-agent") {
    return ["--model", model];
  }
  return [];
}

function readPrompt(promptFile: string | undefined, prompt: string | undefined): string {
  if (promptFile) {
    return readFileSync(promptFile, { encoding: "utf-8" });
  }
  return prompt ?? "";
}
