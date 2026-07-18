import {
  redactAdapterStructuredResult,
  type AdapterSessionDirective,
  type AdapterStructuredResult,
} from "../adapters/session.js";

type ReviewerSessionMode = "fresh" | "resumed" | "fallback_fresh" | "fresh_isolated";
type ReviewerSessionEvent =
  | "reviewer_session.created"
  | "reviewer_session.resumed"
  | "reviewer_session.fresh_isolated"
  | "reviewer_session.fallback_fresh"
  | "reviewer_session.rotated"
  | "reviewer_session.resume_failed"
  | "reviewer_session.closed"
  | "reviewer_session.expired";

const RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 5_000;

export interface ReviewerSessionInvocationTiming {
  config_load_ms?: number;
  adapter_spawn_ms?: number;
  agent_total_ms?: number;
  total_ms?: number;
  first_output_ms?: number;
}

interface StructuredSessionInvocation {
  exitCode: number;
  result: AdapterStructuredResult;
  timedOut?: boolean;
  timing?: ReviewerSessionInvocationTiming;
}

export interface ReviewerSessionInvocationResult {
  exitCode: number;
  outputText: string;
  timedOut?: boolean;
  timing?: ReviewerSessionInvocationTiming;
  session: {
    mode: ReviewerSessionMode;
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

export type ReviewerSessionReadDecision =
  | { kind: "entry"; entry: ReviewerSessionDispatchEntry }
  | { kind: "missing" }
  | { kind: "lifecycle"; entry: ReviewerSessionDispatchEntry; reason: "expired_idle" | "expired_absolute" | "resume_limit" }
  | { kind: "unavailable" };

export interface ReviewerSessionInvocationContext {
  timeoutSecs?: number;
  idempotencyKey?: string;
}

export interface ReviewerSessionInvocationOptions {
  effectiveMode: "interactive_continuous" | "independent";
  attemptIdentity?: { runId: string; laneId: string; attempt: number };
  invokeFresh: (context?: ReviewerSessionInvocationContext) => Promise<{ exitCode: number; outputText: string }>;
  invokeStructured: (directive: AdapterSessionDirective, context?: ReviewerSessionInvocationContext) => Promise<{
    exitCode: number;
    result: AdapterStructuredResult;
  }>;
  /** Runs only after a registry hit selects resume and immediately before spawn. */
  prepareResumedPrompt?: () => void;
  /** Restores the canonical fresh prompt before any fresh recovery spawn. */
  prepareFreshPrompt?: () => void;
  sessionDependencies: {
    resolveScope: () => ResolvedReviewerSessionScope | undefined;
    supportsStructuredSessions: () => boolean;
    registryKey: (scope: ResolvedReviewerSessionScope) => string;
    withLease: <T>(key: string, action: () => Promise<T>) => Promise<
      { acquired: true; value: T } | { acquired: false; reason: "busy" | "unavailable" }
    >;
    read: (key: string) => ReviewerSessionReadDecision;
    writeFresh: (key: string, providerSessionId: string) => ReviewerSessionDispatchEntry | undefined;
    writeResume: (
      key: string,
      expectedEpoch: number,
      providerSessionId: string,
    ) => ReviewerSessionDispatchEntry | undefined;
    /** Advances the stale entry's epoch; it never exposes registry diagnostics. */
    close?: (key: string, expectedEpoch: number) => boolean;
    /** Testable retry seams. Supplying sleep opts into retry rather than real waits in unit tests. */
    sleep?: (delayMs: number) => Promise<void>;
    jitter?: (baseMs: number) => number;
    remainingBudgetMs?: () => number;
    normalizeInvocationException?: (error: unknown) => {
      result: AdapterStructuredResult;
      timedOut?: boolean;
      timing?: ReviewerSessionInvocationTiming;
    };
    onEvent?: (event: ReviewerSessionEvent, payload: Record<string, unknown>) => void;
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
    return freshWithoutRegistry(options, true);
  }
  let key: string;
  try {
    key = options.sessionDependencies.registryKey(scope);
  } catch {
    return freshWithoutRegistry(options, true);
  }
  let leased: { acquired: true; value: LeaseActionResult } | { acquired: false; reason: "busy" | "unavailable" };
  try {
    leased = await options.sessionDependencies.withLease(key, async () => {
      try {
        const decision = options.sessionDependencies.read(key);
        if (decision.kind === "unavailable") {
          return { kind: "result" as const, result: await freshWithoutRegistry(options, true) };
        }
        if (decision.kind === "lifecycle") {
          return { kind: "result" as const, result: await replaceLifecycleEntry(options, scope, key, decision.entry, decision.reason) };
        }
        if (decision.kind === "entry") {
          return { kind: "result" as const, result: await resumeExisting(options, scope, key, decision.entry) };
        }
        return { kind: "result" as const, result: await startContinuous(options, scope, key) };
      } catch {
        return { kind: "exception" as const };
      }
    });
  } catch {
    return freshWithoutRegistry(options, true);
  }
  if (leased.acquired) {
    return leased.value.kind === "result"
      ? leased.value.result
      : { exitCode: 1, outputText: "Reviewer session invocation failed safely.", session: scopeSession("fresh", scope, false) };
  }
  if (leased.reason === "unavailable") return freshWithoutRegistry(options, true);

  const context = remainingInvocationContext(options);
  if (!context) return exhaustedFresh(scope);
  const fresh = await options.invokeFresh({ ...context, idempotencyKey: freshIsolatedIdempotencyKey(options) });
  const result: ReviewerSessionInvocationResult = {
    ...fresh,
    session: scopeSession("fresh_isolated", scope, false),
  };
  options.sessionDependencies.onEvent?.("reviewer_session.fresh_isolated", safeEventPayload(result.session));
  return result;
}

type LeaseActionResult =
  | { kind: "result"; result: ReviewerSessionInvocationResult }
  | { kind: "exception" };

async function replaceLifecycleEntry(
  options: ReviewerSessionInvocationOptions,
  scope: ResolvedReviewerSessionScope,
  key: string,
  entry: ReviewerSessionDispatchEntry,
  reason: "expired_idle" | "expired_absolute" | "resume_limit",
): Promise<ReviewerSessionInvocationResult> {
  const stale = scopeSession("resumed", scope, false, entry.sessionRef);
  if (reason !== "resume_limit") {
    options.sessionDependencies.onEvent?.("reviewer_session.expired", safeEventPayload(stale));
  }
  if (!options.sessionDependencies.close?.(key, entry.epoch)) {
    return {
      exitCode: 1,
      outputText: "Reviewer session lifecycle state cannot be safely rotated.",
      session: stale,
    };
  }
  options.sessionDependencies.onEvent?.("reviewer_session.closed", safeEventPayload(stale));
  options.sessionDependencies.onEvent?.("reviewer_session.rotated", { ...safeEventPayload(stale), reason });
  return fallbackFresh(options, scope, key, entry.providerSessionId);
}

async function startContinuous(
  options: ReviewerSessionInvocationOptions,
  scope: ResolvedReviewerSessionScope,
  key: string,
): Promise<ReviewerSessionInvocationResult> {
  const invocation = await invokeStructuredSafely(options, { mode: "fresh" });
  const safe = redactAdapterStructuredResult(invocation.result, { mode: "fresh" });
  if (invocation.exitCode !== 0 || invocation.result.failure || !invocation.result.providerSessionId) {
    return {
      exitCode: invocation.exitCode,
      outputText: safe.outputText,
      ...(invocation.timedOut === undefined ? {} : { timedOut: invocation.timedOut }),
      ...(invocation.timing ? { timing: invocation.timing } : {}),
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
  if (!options.sessionDependencies.supportsStructuredSessions()) {
    emitResumeFailure(options, scope, entry, "session_incompatible");
    closeStaleEntry(options, scope, key, entry, "session_incompatible");
    return fallbackFreshWithoutStructured(options, scope);
  }
  options.prepareResumedPrompt?.();
  const invocation = await invokeResume(options, entry);
  if (structuredSuccess(invocation)) return completedResume(options, scope, key, entry, invocation);

  const failure = invocation.result.failure;
  emitResumeFailure(options, scope, entry, failure?.classification);
  if (!failure || !hasRemainingBudget(options)) return failedResume(scope, entry, invocation);

  const retryDelay = retryDelayFor(options, invocation);
  if (retryDelay !== undefined) {
    await options.sessionDependencies.sleep?.(retryDelay);
    if (!hasRemainingBudget(options)) return failedResume(scope, entry, invocation);
    const retried = await invokeResume(options, entry);
    if (structuredSuccess(retried)) return completedResume(options, scope, key, entry, retried);
    return failedResume(scope, entry, retried);
  }

  if (allowsFreshRecovery(failure.classification)) {
    closeStaleEntry(options, scope, key, entry, failure.classification);
    return fallbackFresh(options, scope, key, entry.providerSessionId);
  }
  return failedResume(scope, entry, invocation);
}

async function fallbackFreshWithoutStructured(
  options: ReviewerSessionInvocationOptions,
  scope: ResolvedReviewerSessionScope,
): Promise<ReviewerSessionInvocationResult> {
  const context = remainingInvocationContext(options);
  if (!context) {
    return { exitCode: 1, outputText: "", session: scopeSession("fallback_fresh", scope, false) };
  }
  options.prepareFreshPrompt?.();
  const fresh = await options.invokeFresh(context);
  const session = scopeSession("fallback_fresh", scope, false);
  const result = { ...fresh, session };
  options.sessionDependencies.onEvent?.("reviewer_session.fallback_fresh", safeEventPayload(session));
  return result;
}

async function invokeResume(
  options: ReviewerSessionInvocationOptions,
  entry: ReviewerSessionDispatchEntry,
): Promise<StructuredSessionInvocation> {
  return invokeStructuredSafely(options, { mode: "resume", providerSessionId: entry.providerSessionId });
}

function structuredSuccess(invocation: StructuredSessionInvocation): boolean {
  return invocation.exitCode === 0 && !invocation.result.failure && Boolean(invocation.result.providerSessionId);
}

function completedResume(
  options: ReviewerSessionInvocationOptions,
  scope: ResolvedReviewerSessionScope,
  key: string,
  entry: ReviewerSessionDispatchEntry,
  invocation: StructuredSessionInvocation,
): ReviewerSessionInvocationResult {
  const safe = redactAdapterStructuredResult(invocation.result, {
    mode: "resume",
    providerSessionId: entry.providerSessionId,
  });
  const updated = options.sessionDependencies.writeResume(key, entry.epoch, invocation.result.providerSessionId as string);
  const session = scopeSession("resumed", scope, Boolean(updated), entry.sessionRef);
  const result = { exitCode: invocation.exitCode, outputText: safe.outputText, session };
  if (updated) options.sessionDependencies.onEvent?.("reviewer_session.resumed", safeEventPayload(session));
  return result;
}

function failedResume(
  scope: ResolvedReviewerSessionScope,
  entry: ReviewerSessionDispatchEntry,
  invocation: StructuredSessionInvocation,
): ReviewerSessionInvocationResult {
  const safe = redactAdapterStructuredResult(invocation.result, {
    mode: "resume",
    providerSessionId: entry.providerSessionId,
  });
  return {
    exitCode: invocation.exitCode || 1,
    outputText: isHardFailure(invocation.result.failure?.classification)
      ? "Reviewer session cannot continue; verify reviewer access and configuration."
      : safe.outputText,
    ...(invocation.timedOut === undefined ? {} : { timedOut: invocation.timedOut }),
    ...(invocation.timing ? { timing: invocation.timing } : {}),
    session: scopeSession("resumed", scope, false, entry.sessionRef),
  };
}

function isHardFailure(classification: string | undefined): boolean {
  return classification === "auth_required"
    || classification === "permission_denied"
    || classification === "configuration_error"
    || classification === "session_incompatible"
    || classification === "non_interactive_unsupported";
}

function emitResumeFailure(
  options: ReviewerSessionInvocationOptions,
  scope: ResolvedReviewerSessionScope,
  entry: ReviewerSessionDispatchEntry,
  classification: string | undefined,
): void {
  options.sessionDependencies.onEvent?.("reviewer_session.resume_failed", {
    ...safeEventPayload(scopeSession("resumed", scope, false, entry.sessionRef)),
    reason: classification ?? "invalid_output",
  });
}

function closeStaleEntry(
  options: ReviewerSessionInvocationOptions,
  scope: ResolvedReviewerSessionScope,
  key: string,
  entry: ReviewerSessionDispatchEntry,
  classification: string,
): void {
  const stale = scopeSession("resumed", scope, false, entry.sessionRef);
  if (classification === "session_expired") {
    options.sessionDependencies.onEvent?.("reviewer_session.expired", safeEventPayload(stale));
  }
  if (options.sessionDependencies.close?.(key, entry.epoch)) {
    options.sessionDependencies.onEvent?.("reviewer_session.closed", safeEventPayload(stale));
  }
  options.sessionDependencies.onEvent?.("reviewer_session.rotated", {
    ...safeEventPayload(stale),
    reason: classification,
  });
}

async function fallbackFresh(
  options: ReviewerSessionInvocationOptions,
  scope: ResolvedReviewerSessionScope,
  key: string,
  staleProviderSessionId?: string,
): Promise<ReviewerSessionInvocationResult> {
  const context = remainingInvocationContext(options);
  if (!context) {
    return {
      exitCode: 1,
      outputText: "",
      session: scopeSession("fallback_fresh", scope, false),
    };
  }
  options.prepareFreshPrompt?.();
  const invocation = await invokeStructuredSafely(options, { mode: "fresh" }, context);
  const safe = redactAdapterStructuredResult(
    invocation.result,
    staleProviderSessionId
      ? { mode: "resume", providerSessionId: staleProviderSessionId }
      : { mode: "fresh" },
  );
  const successful = structuredSuccess(invocation);
  const entry = successful
    ? options.sessionDependencies.writeFresh(key, invocation.result.providerSessionId as string)
    : undefined;
  const session = scopeSession("fallback_fresh", scope, Boolean(entry), entry?.sessionRef);
  const result = {
    exitCode: successful ? invocation.exitCode : invocation.exitCode || 1,
    outputText: safe.outputText,
    ...(invocation.timedOut === undefined ? {} : { timedOut: invocation.timedOut }),
    ...(invocation.timing ? { timing: invocation.timing } : {}),
    session,
  };
  options.sessionDependencies.onEvent?.("reviewer_session.fallback_fresh", {
    ...safeEventPayload(session),
    ...(invocation.result.failure ? { reason: invocation.result.failure.classification } : {}),
  });
  return result;
}

function allowsFreshRecovery(classification: string): boolean {
  return classification === "session_expired"
    || classification === "session_not_found"
    || classification === "context_overflow"
    || classification === "invalid_output";
}

function retryDelayFor(
  options: ReviewerSessionInvocationOptions,
  invocation: Pick<StructuredSessionInvocation, "result">,
): number | undefined {
  const failure = invocation.result.failure;
  if (!failure) return undefined;
  const retryableNetwork = failure.classification === "unknown" && failure.retryable;
  const retryableRateLimit = failure.classification === "rate_limited";
  const retryableBusy = failure.classification === "provider_busy";
  if (!retryableNetwork && !retryableRateLimit && !retryableBusy) return undefined;
  if (!options.sessionDependencies.sleep || !options.sessionDependencies.jitter) return undefined;
  const retryAfter = retryableRateLimit ? invocation.result.retryAfterMs : undefined;
  const hasValidRetryAfter = typeof retryAfter === "number"
    && Number.isFinite(retryAfter)
    && retryAfter > 0
    && retryAfter <= MAX_RETRY_DELAY_MS;
  const delay = hasValidRetryAfter ? retryAfter : options.sessionDependencies.jitter(RETRY_DELAY_MS);
  const remaining = options.sessionDependencies.remainingBudgetMs?.();
  return Number.isFinite(delay) && delay > 0 && delay <= MAX_RETRY_DELAY_MS
    && (remaining === undefined || (Number.isFinite(remaining) && remaining >= delay))
    ? delay
    : undefined;
}

function hasRemainingBudget(options: ReviewerSessionInvocationOptions): boolean {
  const remaining = options.sessionDependencies.remainingBudgetMs?.();
  return remaining === undefined || (Number.isFinite(remaining) && remaining > 0);
}

async function freshWithoutRegistry(
  options: ReviewerSessionInvocationOptions,
  constrainToRemainingBudget = false,
): Promise<ReviewerSessionInvocationResult> {
  const context = constrainToRemainingBudget ? remainingInvocationContext(options) : {};
  if (!context) {
    return { exitCode: 1, outputText: "", session: { mode: "fresh", hermetic: true, registryWrite: false } };
  }
  const fresh = await options.invokeFresh(context);
  return { ...fresh, session: { mode: "fresh", hermetic: true, registryWrite: false } };
}

function exhaustedFresh(scope: ResolvedReviewerSessionScope): ReviewerSessionInvocationResult {
  return { exitCode: 1, outputText: "", session: scopeSession("fresh_isolated", scope, false) };
}

async function invokeStructuredSafely(
  options: ReviewerSessionInvocationOptions,
  directive: AdapterSessionDirective,
  context = remainingInvocationContext(options),
): Promise<StructuredSessionInvocation> {
  if (!context) {
    return {
      exitCode: 1,
      result: { outputText: "", failure: { classification: "timeout", message: "reviewer session budget is exhausted", retryable: false } },
    };
  }
  try {
    return await options.invokeStructured(directive, context);
  } catch (error) {
    const normalized = options.sessionDependencies.normalizeInvocationException?.(error);
    return {
      exitCode: 1,
      ...(normalized?.timedOut === undefined ? {} : { timedOut: normalized.timedOut }),
      ...(normalized?.timing ? { timing: normalized.timing } : {}),
      result: normalized?.result ?? {
        outputText: "",
        failure: { classification: "configuration_error", message: "reviewer session invocation failed", retryable: false },
      },
    };
  }
}

function remainingInvocationContext(options: ReviewerSessionInvocationOptions): ReviewerSessionInvocationContext | undefined {
  const remaining = options.sessionDependencies.remainingBudgetMs?.();
  if (remaining !== undefined && (Number.isNaN(remaining) || remaining <= 0)) return undefined;
  return remaining === undefined || remaining === Number.POSITIVE_INFINITY
    ? {}
    : Number.isFinite(remaining) ? { timeoutSecs: remaining / 1_000 } : undefined;
}

function freshIsolatedIdempotencyKey(options: ReviewerSessionInvocationOptions): string | undefined {
  const identity = options.attemptIdentity;
  return identity ? `${identity.runId}:${identity.laneId}:${identity.attempt}` : undefined;
}

function scopeSession(
  mode: ReviewerSessionMode,
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
