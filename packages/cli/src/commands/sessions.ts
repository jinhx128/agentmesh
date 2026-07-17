import { randomUUID } from "node:crypto";

import {
  closeReviewerSessionReference,
  closeReviewerSessionScope,
  inspectReviewerSessionSummary,
  listReviewerSessionSummaries,
  purgeReviewerSessions,
  type ReviewerSessionSafeSummary,
} from "@agentmesh/runtime/src/reviewer-sessions/registry.js";
import { HOST_KINDS } from "@agentmesh/runtime/src/reviewer-sessions/scope.js";

const SESSION_REF_PATTERN = /^rs-[a-f0-9]{16}$/;
const SCOPE_REF_PATTERN = /^cs-[a-f0-9]{16}$/;
const CREATABLE_HOSTS: Set<string> = new Set(HOST_KINDS.filter((host) => host !== "unknown"));
const SAFE_HOSTS: Set<string> = new Set(HOST_KINDS);
const SAFE_MODES = new Set(["auto", "interactive_continuous", "independent"]);
const REVIEWER_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const SENSITIVE_REVIEWER_PATTERN = /(?:secret|token|provider[-_.]?session|native[-_.]?id|session[-_.]?id)/i;

export function sessionsCommand(args: string[]): number {
  const [subcommand, ...rest] = args;
  if (subcommand === "scope" && rest[0] === "create") {
    return sessionsScopeCreate(rest.slice(1));
  }
  if (subcommand === "list") {
    return sessionsList(rest);
  }
  if (subcommand === "inspect") {
    return sessionsInspect(rest);
  }
  if (subcommand === "close") {
    return sessionsClose(rest);
  }
  if (subcommand === "purge") {
    return sessionsPurge(rest);
  }
  sessionsUsage();
  return 2;
}

function sessionsScopeCreate(args: string[]): number {
  const parsed = parseOptions(args, new Set(["--json"]), new Set(["--host"]));
  const host = parsed?.values.get("--host");
  if (!parsed || parsed.positionals.length !== 0 || !host || !CREATABLE_HOSTS.has(host)) {
    console.error("usage: agentmesh sessions scope create --host <host> [--json]");
    return 2;
  }
  const correlationToken = `amscope_v1:${randomUUID()}`;
  if (parsed.flags.has("--json")) {
    console.log(JSON.stringify({ host, correlation_token: correlationToken }, null, 2));
  } else {
    console.log(`Host: ${host}`);
    console.log(`Correlation token: ${correlationToken}`);
  }
  return 0;
}

function sessionsList(args: string[]): number {
  const parsed = parseOptions(args, new Set(["--json"]), new Set());
  if (!parsed || parsed.positionals.length !== 0) {
    console.error("usage: agentmesh sessions list [--json]");
    return 2;
  }
  const result = listReviewerSessionSummaries();
  if (result.status !== "ok") {
    console.error("reviewer session registry is unavailable");
    return 1;
  }
  const sessions = result.sessions.flatMap((session) => {
    const projected = safeCliSummary(session);
    return projected ? [projected] : [];
  });
  if (parsed.flags.has("--json")) {
    console.log(JSON.stringify({ schema_version: 1, sessions }, null, 2));
    return 0;
  }
  for (const session of sessions) {
    console.log(formatSummary(session));
  }
  return 0;
}

function sessionsInspect(args: string[]): number {
  const parsed = parseOptions(args, new Set(["--json"]), new Set());
  const sessionRef = parsed?.positionals[0];
  if (!parsed || parsed.positionals.length !== 1 || !sessionRef || !SESSION_REF_PATTERN.test(sessionRef)) {
    console.error("usage: agentmesh sessions inspect <session-ref> [--json]");
    return 2;
  }
  const result = inspectReviewerSessionSummary(sessionRef);
  if (result.status === "not_found") {
    console.error("reviewer session not found");
    return 1;
  }
  if (result.status === "ambiguous") {
    console.error("reviewer session reference is ambiguous");
    return 1;
  }
  if (result.status === "unavailable") {
    console.error("reviewer session registry is unavailable");
    return 1;
  }
  const session = safeCliSummary(result.session);
  if (!session) {
    console.error("reviewer session registry is unavailable");
    return 1;
  }
  if (parsed.flags.has("--json")) {
    console.log(JSON.stringify({ schema_version: 1, session }, null, 2));
  } else {
    console.log(formatSummary(session));
  }
  return 0;
}

function sessionsClose(args: string[]): number {
  const parsed = parseOptions(args, new Set(["--json"]), new Set(["--scope"]));
  if (!parsed) {
    return closeUsage();
  }
  const scopeRef = parsed.values.get("--scope");
  const sessionRef = parsed.positionals[0];
  if (
    parsed.positionals.length > 1
    || (scopeRef !== undefined && sessionRef !== undefined)
    || (scopeRef === undefined && sessionRef === undefined)
    || (scopeRef !== undefined && !SCOPE_REF_PATTERN.test(scopeRef))
    || (sessionRef !== undefined && !SESSION_REF_PATTERN.test(sessionRef))
  ) {
    return closeUsage();
  }
  const result = scopeRef !== undefined
    ? closeReviewerSessionScope(scopeRef)
    : closeReviewerSessionReference(sessionRef as string);
  if (result.status === "not_found") {
    console.error(scopeRef === undefined ? "reviewer session not found" : "reviewer session scope not found");
    return 1;
  }
  if (result.status === "ambiguous") {
    console.error("reviewer session reference is ambiguous");
    return 1;
  }
  if (result.status === "conflict") {
    console.error("reviewer session state changed; retry the operation");
    return 1;
  }
  if (result.status === "unavailable") {
    console.error("reviewer session registry is unavailable");
    return 1;
  }
  return printCloseResult(result.closed, parsed.flags.has("--json"));
}

function sessionsPurge(args: string[]): number {
  const parsed = parseOptions(args, new Set(["--expired", "--json"]), new Set());
  if (!parsed || parsed.positionals.length !== 0 || !parsed.flags.has("--expired")) {
    console.error("usage: agentmesh sessions purge --expired [--json]");
    return 2;
  }
  const result = purgeReviewerSessions();
  if (result.status !== "purged") {
    console.error("reviewer session registry is unavailable");
    return 1;
  }
  if (parsed.flags.has("--json")) {
    console.log(JSON.stringify({ removed: result.removed }, null, 2));
  } else {
    console.log(`Removed reviewer sessions: ${result.removed}`);
  }
  return 0;
}

function formatSummary(session: ReviewerSessionSafeSummary): string {
  return [
    session.session_ref,
    session.host ?? "unknown-host",
    session.scope_ref ?? "unknown-scope",
    session.reviewer ?? "unknown-reviewer",
    session.mode ?? "unknown-mode",
    `epoch=${session.epoch}`,
    `resumes=${session.resume_count}`,
    `last_used=${session.last_used_at}`,
    `expires=${session.expires_at}`,
  ].join("\t");
}

function safeCliSummary(session: ReviewerSessionSafeSummary): ReviewerSessionSafeSummary | undefined {
  if (
    !SESSION_REF_PATTERN.test(session.session_ref)
    || !Number.isSafeInteger(session.epoch) || session.epoch < 0
    || !Number.isSafeInteger(session.resume_count) || session.resume_count < 0
    || ![session.created_at, session.last_used_at, session.expires_at].every((value) => Number.isFinite(Date.parse(value)))
    || (session.scope_ref !== undefined && !SCOPE_REF_PATTERN.test(session.scope_ref))
    || (session.host !== undefined && !SAFE_HOSTS.has(session.host))
    || (session.mode !== undefined && !SAFE_MODES.has(session.mode))
    || (session.reviewer !== undefined && (
      !REVIEWER_PATTERN.test(session.reviewer) || SENSITIVE_REVIEWER_PATTERN.test(session.reviewer)
    ))
  ) return undefined;
  return {
    session_ref: session.session_ref,
    created_at: session.created_at,
    last_used_at: session.last_used_at,
    expires_at: session.expires_at,
    epoch: session.epoch,
    resume_count: session.resume_count,
    ...(session.scope_ref === undefined ? {} : { scope_ref: session.scope_ref }),
    ...(session.host === undefined ? {} : { host: session.host }),
    ...(session.reviewer === undefined ? {} : { reviewer: session.reviewer }),
    ...(session.mode === undefined ? {} : { mode: session.mode }),
  };
}

function printCloseResult(closed: number, json: boolean): number {
  if (json) {
    console.log(JSON.stringify({ closed }, null, 2));
  } else {
    console.log(`Closed reviewer sessions: ${closed}`);
  }
  return 0;
}

function closeUsage(): number {
  console.error("usage: agentmesh sessions close <session-ref> [--json]");
  console.error("       agentmesh sessions close --scope <scope-ref> [--json]");
  return 2;
}

function sessionsUsage(): void {
  console.error([
    "usage: agentmesh sessions <command>",
    "commands:",
    "  sessions scope create --host <host> [--json]",
    "  sessions list [--json]",
    "  sessions inspect <session-ref> [--json]",
    "  sessions close <session-ref> [--json]",
    "  sessions close --scope <scope-ref> [--json]",
    "  sessions purge --expired [--json]",
  ].join("\n"));
}

function parseOptions(
  args: string[],
  allowedFlags: Set<string>,
  allowedValues: Set<string>,
): { flags: Set<string>; values: Map<string, string>; positionals: string[] } | undefined {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (allowedFlags.has(arg)) {
      if (flags.has(arg)) {
        return undefined;
      }
      flags.add(arg);
      continue;
    }
    if (allowedValues.has(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--") || values.has(arg)) {
        return undefined;
      }
      values.set(arg, value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      return undefined;
    }
    positionals.push(arg);
  }
  return { flags, values, positionals };
}
