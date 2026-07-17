import {
  redactAdapterStructuredResult,
  type AdapterSessionDirective,
  type AdapterStructuredResult,
} from "../adapters/session.js";

export interface ReviewerSessionInvocationResult {
  exitCode: number;
  outputText: string;
  session: {
    mode: "fresh" | "resumed" | "fresh_isolated";
    hermetic: boolean;
    nonHermeticReason?: "session_resume";
    registryWrite: boolean;
    sessionRef?: string;
    conversationScopeRef?: string;
    scopeSource?: "native" | "propagated" | "missing";
  };
}

export interface ResolvedReviewerSessionScope {
  hostKind: string;
  conversationScopeRef: string;
  workspaceId: string;
  worktreeId: string;
  scopeSource: "native" | "propagated" | "missing";
}

export interface ReviewerSessionDispatchEntry {
  providerSessionId: string;
  sessionRef: string;
  epoch: number;
}

export interface ReviewerSessionInvocationOptions {
  effectiveMode: "interactive_continuous" | "independent";
  invokeFresh: () => Promise<{ exitCode: number; outputText: string }>;
  invokeStructured: (directive: AdapterSessionDirective) => Promise<{
    exitCode: number;
    result: AdapterStructuredResult;
  }>;
  sessionDependencies: {
    resolveScope: () => ResolvedReviewerSessionScope | undefined;
    supportsStructuredSessions: () => boolean;
    registryKey: (scope: ResolvedReviewerSessionScope) => string;
    withLease: <T>(key: string, action: () => Promise<T>) => Promise<
      { acquired: true; value: T } | { acquired: false; reason: "busy" | "unavailable" }
    >;
    read: (key: string) => ReviewerSessionDispatchEntry | undefined;
    writeFresh: (key: string, providerSessionId: string) => ReviewerSessionDispatchEntry | undefined;
    writeResume: (
      key: string,
      expectedEpoch: number,
      providerSessionId: string,
    ) => ReviewerSessionDispatchEntry | undefined;
    onEvent?: (event: "reviewer_session.created" | "reviewer_session.resumed" | "reviewer_session.fresh_isolated", payload: Record<string, unknown>) => void;
  };
}

/**
 * Canonical reviewer-session boundary. Independent review is deliberately the
 * first branch: it must not even inspect scope or registry collaborators.
 */
export async function invokeReviewerWithSession(
  _runDir: string,
  options: ReviewerSessionInvocationOptions,
): Promise<ReviewerSessionInvocationResult> {
  if (options.effectiveMode === "independent") {
    const fresh = await options.invokeFresh();
    return {
      ...fresh,
      session: { mode: "fresh", hermetic: true, registryWrite: false },
    };
  }

  const scope = options.sessionDependencies.resolveScope();
  if (!scope || scope.scopeSource === "missing" || !options.sessionDependencies.supportsStructuredSessions()) {
    return freshWithoutRegistry(options);
  }
  let key: string;
  try {
    key = options.sessionDependencies.registryKey(scope);
  } catch {
    return freshWithoutRegistry(options);
  }
  let leased: { acquired: true; value: ReviewerSessionInvocationResult } | { acquired: false; reason: "busy" | "unavailable" };
  try {
    leased = await options.sessionDependencies.withLease(key, async () => {
      let existing: ReviewerSessionDispatchEntry | undefined;
      try {
        existing = options.sessionDependencies.read(key);
      } catch {
        return freshWithoutRegistry(options);
      }
      if (existing) {
        return resumeExisting(options, scope, key, existing);
      }
      return startContinuous(options, scope, key);
    });
  } catch {
    return freshWithoutRegistry(options);
  }
  if (leased.acquired) return leased.value;
  if (leased.reason === "unavailable") return freshWithoutRegistry(options);

  const fresh = await options.invokeFresh();
  const result: ReviewerSessionInvocationResult = {
    ...fresh,
    session: scopeSession("fresh_isolated", scope, false),
  };
  options.sessionDependencies.onEvent?.("reviewer_session.fresh_isolated", safeEventPayload(result.session));
  return result;
}

async function startContinuous(
  options: ReviewerSessionInvocationOptions,
  scope: ResolvedReviewerSessionScope,
  key: string,
): Promise<ReviewerSessionInvocationResult> {
  const invocation = await options.invokeStructured({ mode: "fresh" });
  const safe = redactAdapterStructuredResult(invocation.result, { mode: "fresh" });
  if (invocation.exitCode !== 0 || invocation.result.failure || !invocation.result.providerSessionId) {
    return {
      exitCode: invocation.exitCode,
      outputText: safe.outputText,
      session: scopeSession("fresh", scope, false),
    };
  }
  const entry = options.sessionDependencies.writeFresh(key, invocation.result.providerSessionId);
  const session = scopeSession("fresh", scope, Boolean(entry), entry?.sessionRef);
  const result = { exitCode: invocation.exitCode, outputText: safe.outputText, session };
  if (entry) options.sessionDependencies.onEvent?.("reviewer_session.created", safeEventPayload(session));
  return result;
}

async function resumeExisting(
  options: ReviewerSessionInvocationOptions,
  scope: ResolvedReviewerSessionScope,
  key: string,
  entry: ReviewerSessionDispatchEntry,
): Promise<ReviewerSessionInvocationResult> {
  const invocation = await options.invokeStructured({ mode: "resume", providerSessionId: entry.providerSessionId });
  const safe = redactAdapterStructuredResult(invocation.result, {
    mode: "resume",
    providerSessionId: entry.providerSessionId,
  });
  if (invocation.exitCode !== 0 || invocation.result.failure || !invocation.result.providerSessionId) {
    return {
      exitCode: invocation.exitCode,
      outputText: safe.outputText,
      session: scopeSession("resumed", scope, false, entry.sessionRef),
    };
  }
  const updated = options.sessionDependencies.writeResume(key, entry.epoch, invocation.result.providerSessionId);
  const session = scopeSession("resumed", scope, Boolean(updated), entry.sessionRef);
  const result = { exitCode: invocation.exitCode, outputText: safe.outputText, session };
  if (updated) options.sessionDependencies.onEvent?.("reviewer_session.resumed", safeEventPayload(session));
  return result;
}

async function freshWithoutRegistry(options: ReviewerSessionInvocationOptions): Promise<ReviewerSessionInvocationResult> {
  const fresh = await options.invokeFresh();
  return { ...fresh, session: { mode: "fresh", hermetic: true, registryWrite: false } };
}

function scopeSession(
  mode: "fresh" | "resumed" | "fresh_isolated",
  scope: ResolvedReviewerSessionScope,
  registryWrite: boolean,
  sessionRef?: string,
): ReviewerSessionInvocationResult["session"] {
  return {
    mode,
    hermetic: mode !== "resumed",
    ...(mode === "resumed" ? { nonHermeticReason: "session_resume" as const } : {}),
    registryWrite,
    ...(sessionRef ? { sessionRef } : {}),
    conversationScopeRef: scope.conversationScopeRef,
    scopeSource: scope.scopeSource,
  };
}

function safeEventPayload(session: ReviewerSessionInvocationResult["session"]): Record<string, unknown> {
  return {
    session_mode: session.mode,
    ...(session.sessionRef ? { session_ref: session.sessionRef } : {}),
    ...(session.conversationScopeRef ? { conversation_scope_ref: session.conversationScopeRef } : {}),
    ...(session.scopeSource ? { scope_source: session.scopeSource } : {}),
    hermetic: session.hermetic,
    ...(session.nonHermeticReason ? { non_hermetic_reason: session.nonHermeticReason } : {}),
    registry_write: session.registryWrite,
  };
}
