import { existsSync } from "node:fs";
import path from "node:path";

import {
  appendCallAdoptionEvent,
  CALLS_RELATIVE_DIR,
  readCallAdoptionEvents,
  type FinalCallAdoptionStatus,
} from "@agentmesh/runtime/src/calls/history.js";
import { optionValue, positionalArgs } from "../flags.js";

export function callsAdopt(args: string[]): number {
  const json = args.includes("--json");
  const positional = positionalArgs(args);
  const callId = positional[0];
  const status = finalAdoptionStatus(optionValue(args, "--status"));
  if (!callId || positional.length !== 1 || !status) {
    console.error(
      "usage: agentmesh calls adopt <call-id> --status accepted|rejected|superseded [--entrypoint <name>] [--reason <text>] [--related-commit <commit>] [--related-run-id <run-id>] [--superseded-by-call-id <call-id>] [--json]",
    );
    return 2;
  }
  const callDir = resolveCallDirectory(callId, process.cwd());
  const updated = appendCallAdoptionEvent({
    callDir,
    status,
    updatedByEntrypoint: safeEntrypoint(optionValue(args, "--entrypoint") ?? "cli"),
    ...(optionValue(args, "--reason") !== undefined ? { reason: safeText(optionValue(args, "--reason") ?? "") } : {}),
    ...(optionValue(args, "--related-commit") !== undefined
      ? { relatedCommit: safeText(optionValue(args, "--related-commit") ?? "") }
      : {}),
    ...(optionValue(args, "--related-run-id") !== undefined
      ? { relatedRunId: safeToken(optionValue(args, "--related-run-id") ?? "", "related-run-id") }
      : {}),
    ...(optionValue(args, "--superseded-by-call-id") !== undefined
      ? { supersededByCallId: safeToken(optionValue(args, "--superseded-by-call-id") ?? "", "superseded-by-call-id") }
      : {}),
  });
  const adoptionEvents = readCallAdoptionEvents(callDir);
  if (json) {
    console.log(JSON.stringify({ call: updated, adoption_events: adoptionEvents }, null, 2));
  } else {
    console.log(`Updated call adoption: ${updated.id}`);
    console.log(`Status: ${updated.adoption_status}`);
  }
  return 0;
}

function resolveCallDirectory(callId: string, cwd: string): string {
  const value = safeToken(callId, "call-id");
  const callsDir = path.resolve(cwd, CALLS_RELATIVE_DIR);
  const callDir = path.resolve(callsDir, value);
  const relative = path.relative(callsDir, callDir);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`invalid call id: ${callId}`);
  }
  if (!existsSync(path.join(callDir, "call.json"))) {
    throw new Error(`call not found: ${callId}`);
  }
  return callDir;
}

function finalAdoptionStatus(value: string | undefined): FinalCallAdoptionStatus | undefined {
  return value === "accepted" || value === "rejected" || value === "superseded" ? value : undefined;
}

function safeEntrypoint(value: string): string {
  return safeToken(value, "entrypoint");
}

function safeToken(value: string, label: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return value;
}

function safeText(value: string): string {
  if (value.includes("\0")) {
    throw new Error("text values cannot contain null bytes");
  }
  return value;
}
