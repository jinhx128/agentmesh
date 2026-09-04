import { existsSync } from "node:fs";
import path from "node:path";

import {
  CALLS_RELATIVE_DIR,
  listCallResultEvents,
  markCallResult,
  selectCallResult,
} from "@agentmesh/runtime/src/calls/history.js";
import { optionValue, positionalArgs } from "../flags.js";

export function callsMark(args: string[]): number {
  const positional = positionalArgs(args);
  const callId = positional[0];
  const status = optionValue(args, "--status");
  if (!callId || positional.length !== 1 || (status !== "accepted" && status !== "rejected")) {
    console.error("usage: agentmesh calls mark <call-id> --status accepted|rejected [--reason <text>] [--json]");
    return 2;
  }
  const callDir = resolveCallDirectory(callId, process.cwd());
  const updated = markCallResult({
    callDir,
    status,
    updatedByEntrypoint: "cli",
    ...(optionValue(args, "--reason") !== undefined
      ? { reason: safeText(optionValue(args, "--reason") ?? "") }
      : {}),
  });
  return printResult(updated.id, updated.result_status, callDir, args.includes("--json"));
}

export function callsSelect(args: string[]): number {
  const positional = positionalArgs(args);
  const callId = positional[0];
  if (!callId || positional.length !== 1) {
    console.error("usage: agentmesh calls select <call-id> [--reason <text>] [--json]");
    return 2;
  }
  const callDir = resolveCallDirectory(callId, process.cwd());
  const updated = selectCallResult({
    callDir,
    updatedByEntrypoint: "cli",
    ...(optionValue(args, "--reason") !== undefined
      ? { reason: safeText(optionValue(args, "--reason") ?? "") }
      : {}),
  });
  return printResult(updated.id, updated.result_status, callDir, args.includes("--json"));
}

function printResult(callId: string, status: string, callDir: string, json: boolean): number {
  if (json) {
    console.log(JSON.stringify({ call_id: callId, result_status: status, result_events: listCallResultEvents(callDir) }, null, 2));
  } else {
    console.log(`Updated call result: ${callId}`);
    console.log(`Status: ${status}`);
  }
  return 0;
}

function resolveCallDirectory(callId: string, cwd: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(callId)) throw new Error(`invalid call-id: ${callId}`);
  const callsDir = path.resolve(cwd, CALLS_RELATIVE_DIR);
  const callDir = path.resolve(callsDir, callId);
  const relative = path.relative(callsDir, callDir);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`invalid call-id: ${callId}`);
  }
  if (!existsSync(path.join(callDir, "call.json"))) throw new Error(`call not found: ${callId}`);
  return callDir;
}

function safeText(value: string): string {
  if (value.includes("\0")) throw new Error("text values cannot contain null bytes");
  return value;
}
