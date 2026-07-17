import { readFileSync } from "node:fs";

import type {
  AdapterPlugin,
  AdapterPluginAgentConfig,
  AdapterPluginInvocation,
  AdapterPluginResultOutput,
} from "./plugin.js";
import { lookupRuntimeAdapter } from "./registry.js";
import type { AdapterSessionDirective, AdapterStructuredResult } from "./session.js";

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
  workspace?: string;
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

/**
 * Prepares the narrow V1 structured session invocation supported by the
 * capability matrix. Adapters without both verified capabilities always use
 * their existing fresh invocation, even when a caller supplies a resume ID.
 */
export function prepareAdapterSessionInvocation(
  agent: AdapterInvocationAgent,
  options: AdapterInvocationOptions,
  session: AdapterSessionDirective,
): PreparedAdapterInvocation {
  const adapter = lookupRuntimeAdapter(agent.adapter);
  if (
    adapter.capabilities.supports_resume !== true
    || adapter.capabilities.supports_structured_session_id !== true
  ) {
    return prepareAdapterInvocation(agent, options);
  }
  const prompt = readPrompt(options.promptFile, options.prompt);
  const command = sessionCommand(adapter.id, agent.command, prompt, session, options.workspace);
  return {
    adapterId: adapter.id,
    command,
    env: prepareAdapterEnvironment(agent),
    captureStdout: true,
    nonInteractive: true,
  };
}

/**
 * Parses only the documented structured output of a matrix-verified adapter.
 * It intentionally never consults provider state or guesses a session ID from
 * free text.
 */
export function parseAdapterStructuredSessionResult(
  adapterIdOrAlias: string,
  output: AdapterPluginResultOutput,
): AdapterStructuredResult {
  const adapter = lookupRuntimeAdapter(adapterIdOrAlias);
  if (
    adapter.capabilities.supports_resume !== true
    || adapter.capabilities.supports_structured_session_id !== true
  ) {
    return invalidStructuredOutput("adapter does not support structured session output");
  }
  const providerFailure = structuredProviderFailure(adapter.id, output);
  if (providerFailure) {
    return { outputText: "", failure: providerFailure };
  }
  const records = parseStructuredJsonLines(output.stdout);
  if (!records) {
    return invalidStructuredOutput("provider produced invalid structured session output");
  }
  if (adapter.id === "claude-code-cli") {
    return parseClaudeStructuredSessionResult(records);
  }
  if (adapter.id === "opencode-cli") {
    return parseOpenCodeStructuredSessionResult(records);
  }
  return invalidStructuredOutput("adapter does not support structured session output");
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

function sessionCommand(
  adapterId: string,
  command: string,
  prompt: string,
  session: AdapterSessionDirective,
  workspace: string | undefined,
): string[] {
  if (adapterId === "claude-code-cli") {
    return [
      command,
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "plan",
      "--safe-mode",
      "--no-chrome",
      ...(session.mode === "resume" ? ["--resume", session.providerSessionId] : []),
      prompt,
    ];
  }
  if (adapterId === "opencode-cli") {
    return [
      command,
      "run",
      "--format",
      "json",
      "--dir",
      workspace ?? process.cwd(),
      ...(session.mode === "resume" ? ["--session", session.providerSessionId] : []),
      prompt,
    ];
  }
  throw new Error(`adapter ${adapterId} has no verified structured session invocation`);
}

function parseClaudeStructuredSessionResult(records: Record<string, unknown>[]): AdapterStructuredResult {
  let sessionId: string | undefined;
  let resultText: string | undefined;
  for (const record of records) {
    const type = record.type;
    if (type === "system") {
      if (record.subtype !== "init") {
        return invalidStructuredOutput("provider produced an unrecognized structured session event");
      }
      const observed = structuredSessionId(record, "session_id");
      if (observed === null || observed === undefined || !sameStructuredSessionId(sessionId, observed)) {
        return invalidStructuredOutput("provider produced an invalid structured session ID");
      }
      sessionId = observed;
      continue;
    }
    if (type === "assistant") {
      if (!isRecord(record.message)) {
        return invalidStructuredOutput("provider produced an unrecognized structured session event");
      }
      const observed = structuredSessionId(record, "session_id");
      if (observed === null || observed === undefined || !sameStructuredSessionId(sessionId, observed)) {
        return invalidStructuredOutput("provider produced an invalid structured session ID");
      }
      sessionId ??= observed;
      continue;
    }
    if (type === "result") {
      if (record.subtype !== "success" || record.is_error === true || typeof record.result !== "string") {
        return invalidStructuredOutput("provider produced an unrecognized structured session event");
      }
      const observed = structuredSessionId(record, "session_id");
      if (observed === null || observed === undefined || !sameStructuredSessionId(sessionId, observed)) {
        return invalidStructuredOutput("provider produced an invalid structured session ID");
      }
      sessionId ??= observed;
      if (resultText !== undefined) {
        return invalidStructuredOutput("provider produced conflicting structured session results");
      }
      resultText = record.result;
      continue;
    }
    return invalidStructuredOutput("provider produced an unrecognized structured session event");
  }
  return sessionId && resultText !== undefined
    ? { providerSessionId: sessionId, outputText: resultText }
    : invalidStructuredOutput("provider produced no structured session result");
}

function parseOpenCodeStructuredSessionResult(records: Record<string, unknown>[]): AdapterStructuredResult {
  let sessionId: string | undefined;
  const text: string[] = [];
  for (const record of records) {
    const type = record.type;
    if (type !== "step_start" && type !== "text" && type !== "step_finish") {
      return invalidStructuredOutput("provider produced an unrecognized structured session event");
    }
    const observed = structuredSessionId(record, "sessionID");
    if (observed === null || observed === undefined || !sameStructuredSessionId(sessionId, observed)) {
      return invalidStructuredOutput("provider produced an invalid structured session ID");
    }
    sessionId ??= observed;
    if (type === "text") {
      if (!isRecord(record.part) || record.part.type !== "text" || typeof record.part.text !== "string") {
        return invalidStructuredOutput("provider produced an unrecognized structured session event");
      }
      text.push(record.part.text);
    } else if (!isRecord(record.part)) {
      return invalidStructuredOutput("provider produced an unrecognized structured session event");
    }
  }
  return sessionId && text.length > 0
    ? { providerSessionId: sessionId, outputText: text.join("") }
    : invalidStructuredOutput("provider produced no structured session result");
}

function structuredProviderFailure(
  adapterId: string,
  output: AdapterPluginResultOutput,
): AdapterStructuredResult["failure"] | undefined {
  if (output.timedOut === true) {
    return { classification: "timeout", message: "provider session invocation timed out", retryable: true };
  }
  if (output.exitCode === 0) {
    return undefined;
  }
  const evidence = `${output.stderr ?? ""}\n${output.stdout ?? ""}`;
  if (
    (adapterId === "claude-code-cli" && /No conversation found with session ID:/i.test(evidence))
    || (adapterId === "opencode-cli" && /Error:\s*Session not found/i.test(evidence))
  ) {
    return {
      classification: "session_not_found",
      message: "provider session was not found",
      retryable: false,
    };
  }
  if (/auth(?:entication)?|login|unauthori[sz]ed|forbidden|api[ _-]?key/i.test(evidence)) {
    return { classification: "auth_required", message: "provider authentication is required", retryable: false };
  }
  if (/rate limit|too many requests|\b429\b/i.test(evidence)) {
    return { classification: "provider_busy", message: "provider is rate limited", retryable: true };
  }
  if (/network|connection|dns|socket|econn/i.test(evidence)) {
    return { classification: "unknown", message: "provider network request failed", retryable: true };
  }
  return invalidStructuredOutput("provider did not return a valid structured session result").failure;
}

function parseStructuredJsonLines(value: string | undefined): Record<string, unknown>[] | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }
  const lines = value.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  if (lines.length === 0 || lines.some((line) => !line.trim())) {
    return undefined;
  }
  try {
    const records = lines.map((line) => JSON.parse(line) as unknown);
    return records.every(isRecord) ? records : undefined;
  } catch {
    return undefined;
  }
}

function structuredSessionId(
  record: Record<string, unknown>,
  field: "session_id" | "sessionID",
): string | null | undefined {
  if (!Object.hasOwn(record, field)) {
    return undefined;
  }
  const value = record[field];
  return typeof value === "string" && value.trim() ? value : null;
}

function sameStructuredSessionId(current: string | undefined, observed: string | undefined): boolean {
  return observed === undefined || current === undefined || current === observed;
}

function invalidStructuredOutput(message: string): AdapterStructuredResult {
  return {
    outputText: "",
    failure: { classification: "invalid_output", message, retryable: false },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
