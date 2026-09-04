import { readFileSync } from "node:fs";

import {
  AgentCallError,
  agentCallOutputFromError,
  loadAgents,
  resolveAgent,
  runAgentCallAsync,
} from "@agentmesh/runtime/src/adapters.js";
import {
  assertAgentMeshWorkspace,
  completeCallRecord,
  createCallRecord,
  validateWorkspaceOutputPath,
  type CallRecordStatus,
} from "@agentmesh/runtime/src/calls/history.js";
import { optionValue } from "../flags.js";
import { recordCliWorkspaceActivity } from "../workspace-activity.js";

export async function call(args: string[], configPath?: string): Promise<number> {
  const agentName = optionValue(args, "--agent");
  if (!agentName) {
    console.error("usage: agentmesh call --agent <agent-id> [--prompt <text>] [--prompt-file <path>] [--output-file <path>] [--timeout-secs <n>] [--purpose <purpose>] [--title <title>] [--comparison-group <id>] [--json] [--no-record]");
    return 2;
  }
  if (agentName === "current") {
    throw new Error(
      "current is host-only and cannot be invoked with agentmesh call; use flow prompt and flow attach on a run stage so the current entrance agent writes an artifact.",
    );
  }
  const noRecord = args.includes("--no-record");
  const json = args.includes("--json");
  const outputFile = optionValue(args, "--output-file");
  if (!noRecord) {
    assertAgentMeshWorkspace(process.cwd());
    if (outputFile) {
      validateWorkspaceOutputPath(process.cwd(), outputFile);
    }
  } else {
    console.error("call not recorded; it will not appear in Studio");
  }

  const agents = loadAgents(configPath);
  const agent = resolveAgent(agents, agentName);
  const prompt = optionValue(args, "--prompt");
  const promptFile = optionValue(args, "--prompt-file");
  const created = noRecord
    ? undefined
    : createCallRecord({
        workspace: process.cwd(),
        cwd: process.cwd(),
        agentId: agent.id,
        adapter: agent.adapter,
        model: agent.model ?? null,
        title: optionValue(args, "--title"),
        purpose: optionValue(args, "--purpose") ?? "general",
        promptSource: promptFile ? "file" : prompt === undefined ? "unknown" : "inline",
        promptContent: promptFile
          ? readFileSync(promptFile, { encoding: "utf-8" })
          : prompt,
        comparisonGroupId: optionValue(args, "--comparison-group"),
      });
  if (created) {
    recordCliWorkspaceActivity(process.cwd());
  }

  try {
    const result = await runAgentCallAsync({
      configPath,
      agentName,
      prompt,
      promptFile,
      outputFile,
      timeoutSecs: optionalNumber(args, "--timeout-secs"),
    });
    writeCapturedOutput(json ? undefined : result.stdout, result.stderr, outputFile);
    let completed: ReturnType<typeof completeCallRecord> | undefined;
    if (created) {
      const status: CallRecordStatus = result.exitCode === 0 ? "success" : "failed";
      completed = completeCallRecord(created, {
        status,
        result,
        outputFile,
        errorKind: status === "success" ? "none" : "adapter_error",
      });
    }
    if (json) {
      console.log(JSON.stringify({
        schema_version: 1,
        call_id: completed?.id ?? null,
        status: completed?.status ?? (result.exitCode === 0 ? "success" : "failed"),
        result_status: completed?.result_status ?? null,
        exit_code: result.exitCode,
        output: result.stdout ?? "",
        stderr: result.stderr ?? "",
      }));
    }
    return result.exitCode;
  } catch (error) {
    const output = agentCallOutputFromError(error);
    writeCapturedOutput(json ? undefined : output?.stdout, output?.stderr, outputFile);
    let completed: ReturnType<typeof completeCallRecord> | undefined;
    if (created) {
      const timedOut = error instanceof AgentCallError && error.timedOut;
      completed = completeCallRecord(created, {
        status: timedOut ? "timeout" : "failed",
        stdout: output?.stdout,
        stderr: output?.stderr,
        outputFile,
        errorKind: timedOut ? "timeout" : "adapter_error",
        errorSummary: error instanceof Error ? error.message : String(error),
      });
    }
    if (json) {
      console.log(JSON.stringify({
        schema_version: 1,
        call_id: completed?.id ?? null,
        status: completed?.status ?? "failed",
        result_status: completed?.result_status ?? null,
        exit_code: completed?.exit_code ?? null,
        output: output?.stdout ?? "",
        stderr: output?.stderr ?? "",
      }));
    }
    throw error;
  }
}

function optionalNumber(args: string[], name: string): number | undefined {
  const value = optionValue(args, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

function writeCapturedOutput(
  stdout: string | undefined,
  stderr: string | undefined,
  outputFile: string | undefined,
): void {
  if (!outputFile && stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
}
