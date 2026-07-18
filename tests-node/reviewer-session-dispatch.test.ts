import assert from "node:assert/strict";
import test from "node:test";

import {
  invokeReviewerWithSession,
  type ReviewerSessionInvocationOptions,
} from "../packages/runtime/src/flow/reviewer-session-dispatch.js";

const SCOPE = {
  hostKind: "codex",
  conversationScopeRef: "cs-0123456789abcdef",
  workspaceId: "ws-a",
  worktreeId: "wt-a",
  scopeSource: "native" as const,
};

function continuousDependencies(input: {
  entry?: { providerSessionId: string; sessionRef: string; epoch: number };
  writes: string[];
  events: Array<{ event: string; payload: Record<string, unknown> }>;
}): ReviewerSessionInvocationOptions["sessionDependencies"] {
  let entry = input.entry;
  return {
    resolveScope: () => SCOPE,
    supportsStructuredSessions: () => true,
    registryKey: () => "rk-0123456789abcdef0123456789abcdef",
    withLease: async <T>(_key: string, action: () => Promise<T>) => (
      { acquired: true as const, value: await action() }
    ),
    read: () => entry ? { kind: "entry" as const, entry } : { kind: "missing" as const },
    writeFresh: (_key: string, providerSessionId: string) => {
      input.writes.push(`fresh:${providerSessionId}`);
      entry = { providerSessionId, sessionRef: "rs-0123456789abcdef", epoch: 1 };
      return entry;
    },
    writeResume: (_key: string, expectedEpoch: number, providerSessionId: string) => {
      input.writes.push(`resume:${expectedEpoch}:${providerSessionId}`);
      if (!entry || entry.epoch !== expectedEpoch) return undefined;
      entry = { ...entry, providerSessionId, epoch: expectedEpoch + 1 };
      return entry;
    },
    onEvent: (event: string, payload: Record<string, unknown>) => input.events.push({ event, payload }),
  };
}

test("independent reviewer invocation bypasses every session dependency and runs fresh", async () => {
  const calls: string[] = [];

  const result = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "independent",
    invokeFresh: async () => {
      calls.push("fresh");
      return { exitCode: 0, outputText: "fresh output" };
    },
    invokeStructured: async () => {
      throw new Error("independent invocation must not parse structured session output");
    },
    sessionDependencies: {
      resolveScope: () => {
        throw new Error("independent invocation must not resolve scope");
      },
      supportsStructuredSessions: () => {
        throw new Error("independent invocation must not inspect adapter session capability");
      },
      registryKey: () => {
        throw new Error("independent invocation must not derive a registry key");
      },
      withLease: async () => {
        throw new Error("independent invocation must not acquire a lease");
      },
      read: () => {
        throw new Error("independent invocation must not read registry");
      },
      writeFresh: () => {
        throw new Error("independent invocation must not write registry");
      },
      writeResume: () => {
        throw new Error("independent invocation must not update registry");
      },
    },
  });

  assert.deepEqual(calls, ["fresh"]);
  assert.deepEqual(result, {
    exitCode: 0,
    outputText: "fresh output",
    session: {
      mode: "fresh",
      hermetic: true,
      registryWrite: false,
    },
  });
});

test("continuous reviewer starts once then resumes the same safe scope", async () => {
  const writes: string[] = [];
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const dependencies = continuousDependencies({ writes, events });
  const directives: string[] = [];
  let resumedPromptPreparations = 0;
  const invokeStructured = async (directive: { mode: "fresh" } | { mode: "resume"; providerSessionId: string }) => {
    directives.push(directive.mode);
    return {
      exitCode: 0,
      result: { providerSessionId: "session-test-123", outputText: `${directive.mode} output` },
    };
  };
  const input = {
    effectiveMode: "interactive_continuous" as const,
    invokeFresh: async () => {
      throw new Error("eligible continuous invocation must use the structured seam");
    },
    invokeStructured,
    prepareResumedPrompt: () => { resumedPromptPreparations += 1; },
    sessionDependencies: dependencies,
  };

  const first = await invokeReviewerWithSession("/disposable/run", input);
  const second = await invokeReviewerWithSession("/disposable/run", input);

  assert.deepEqual(directives, ["fresh", "resume"]);
  assert.equal(resumedPromptPreparations, 1);
  assert.deepEqual(writes, ["fresh:session-test-123", "resume:1:session-test-123"]);
  assert.equal(first.session.mode, "fresh");
  assert.equal(first.session.registryWrite, true);
  assert.deepEqual(second.session, {
    mode: "resumed",
    hermetic: false,
    nonHermeticReason: "session_resume",
    registryWrite: true,
    sessionRef: "rs-0123456789abcdef",
    conversationScopeRef: SCOPE.conversationScopeRef,
    scopeSource: "native",
  });
  assert.deepEqual(events.map(({ event }) => event), ["reviewer_session.created", "reviewer_session.resumed"]);
  assert.doesNotMatch(JSON.stringify({ first, second, events }), /session-test-123/);
});

test("missing scope or disabled capability runs fresh without parser or registry write", async () => {
  for (const kind of ["missing-scope", "capability-false"] as const) {
    let fresh = 0;
    const dependencies = continuousDependencies({ writes: [], events: [] });
    if (kind === "missing-scope") dependencies.resolveScope = () => undefined;
    else dependencies.supportsStructuredSessions = () => false;
    const result = await invokeReviewerWithSession("/disposable/run", {
      effectiveMode: "interactive_continuous",
      invokeFresh: async () => ({ exitCode: 0, outputText: "fresh output" }),
      invokeStructured: async () => {
        fresh += 100;
        throw new Error("ineligible continuous invocation must not parse a session ID");
      },
      sessionDependencies: dependencies,
    });
    fresh += 1;
    assert.equal(fresh, 1, kind);
    assert.equal(result.session.registryWrite, false, kind);
    assert.equal(result.session.mode, "fresh", kind);
  }
});

test("different safe scopes and linked worktrees cannot resume another dispatch entry", async () => {
  const directives: string[] = [];
  const entries = new Map<string, { providerSessionId: string; sessionRef: string; epoch: number }>();
  const invoke = async (scope: typeof SCOPE) => invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => {
      throw new Error("eligible continuous invocation must use structured fresh start");
    },
    invokeStructured: async (directive) => {
      directives.push(`${scope.conversationScopeRef}:${scope.worktreeId}:${directive.mode}`);
      return { exitCode: 0, result: { providerSessionId: "session-test-123", outputText: "review" } };
    },
    sessionDependencies: {
      resolveScope: () => scope,
      supportsStructuredSessions: () => true,
      registryKey: (resolved) => `${resolved.conversationScopeRef}:${resolved.worktreeId}`,
      withLease: async (_key, action) => ({ acquired: true as const, value: await action() }),
      read: (key) => {
        const entry = entries.get(key);
        return entry ? { kind: "entry" as const, entry } : { kind: "missing" as const };
      },
      writeFresh: (key, providerSessionId) => {
        const entry = { providerSessionId, sessionRef: "rs-0123456789abcdef", epoch: 1 };
        entries.set(key, entry);
        return entry;
      },
      writeResume: () => undefined,
    },
  });
  await invoke(SCOPE);
  await invoke({ ...SCOPE, conversationScopeRef: "cs-fedcba9876543210" });
  await invoke({ ...SCOPE, worktreeId: "wt-linked" });

  assert.deepEqual(directives, [
    "cs-0123456789abcdef:wt-a:fresh",
    "cs-fedcba9876543210:wt-a:fresh",
    "cs-0123456789abcdef:wt-linked:fresh",
  ]);
  assert.equal(entries.size, 3);
});

test("busy lease uses one fresh isolated invocation without reading a provider ID", async () => {
  let freshCalls = 0;
  const idempotencyKeys: Array<string | undefined> = [];
  let structuredCalls = 0;
  let registryReads = 0;
  const dependencies = continuousDependencies({ writes: [], events: [] });
  dependencies.withLease = async () => ({ acquired: false, reason: "busy" });
  dependencies.read = () => {
    registryReads += 1;
    throw new Error("busy path must not read an entry");
  };
  const result = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    attemptIdentity: { runId: "run-42", laneId: "review:primary", attempt: 3 },
    invokeFresh: async (context) => {
      freshCalls += 1;
      idempotencyKeys.push(context?.idempotencyKey);
      return { exitCode: 0, outputText: "isolated output" };
    },
    invokeStructured: async () => {
      structuredCalls += 1;
      return { exitCode: 0, result: { providerSessionId: "session-test-123", outputText: "unsafe" } };
    },
    sessionDependencies: dependencies,
  });

  assert.equal(freshCalls, 1);
  assert.equal(structuredCalls, 0);
  assert.equal(registryReads, 0);
  assert.deepEqual(idempotencyKeys, ["run-42:review:primary:3"]);
  assert.deepEqual(result.session, {
    mode: "fresh_isolated",
    hermetic: true,
    registryWrite: false,
    conversationScopeRef: SCOPE.conversationScopeRef,
    scopeSource: "native",
  });
});

test("unavailable lease degrades to fresh rather than isolated", async () => {
  const dependencies = continuousDependencies({ writes: [], events: [] });
  dependencies.withLease = async () => ({ acquired: false, reason: "unavailable" });
  const result = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => ({ exitCode: 0, outputText: "fresh output" }),
    invokeStructured: async () => {
      throw new Error("unavailable registry must not invoke the structured session path");
    },
    sessionDependencies: dependencies,
  });
  assert.deepEqual(result.session, { mode: "fresh", hermetic: true, registryWrite: false });
});

test("close race prevents a stale resumed action from writing the entry back", async () => {
  const writes: string[] = [];
  const dependencies = continuousDependencies({
    entry: { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 },
    writes,
    events: [],
  });
  dependencies.writeResume = (_key, _epoch, _providerSessionId) => undefined;

  const result = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => {
      throw new Error("resume close race must not silently recover fresh in this slice");
    },
    invokeStructured: async () => ({
      exitCode: 0,
      result: { providerSessionId: "session-test-123", outputText: "completed provider output" },
    }),
    sessionDependencies: dependencies,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.session.mode, "resumed");
  assert.equal(result.session.registryWrite, false);
  assert.deepEqual(writes, []);
});

test("expired resumed session closes stale evidence then performs one fallback fresh recovery", async () => {
  const writes: string[] = [];
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const dependencies = continuousDependencies({
    entry: { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 },
    writes,
    events,
  });
  const matrix = dependencies as typeof dependencies & { close: (key: string, epoch: number) => boolean };
  const directives: string[] = [];
  const promptModes: string[] = [];
  matrix.close = () => true;

  const result = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => {
      throw new Error("expired resume must recover through the structured fresh seam");
    },
    invokeStructured: async (directive) => {
      directives.push(directive.mode);
      return directive.mode === "resume"
        ? { exitCode: 1, result: { outputText: "session-test-123", failure: { classification: "session_expired", message: "expired", retryable: false } } }
        : { exitCode: 0, result: { providerSessionId: "session-test-123", outputText: "recovered" } };
    },
    prepareResumedPrompt: () => { promptModes.push("resumed"); },
    prepareFreshPrompt: () => { promptModes.push("fresh"); },
    sessionDependencies: matrix,
  });

  assert.deepEqual(directives, ["resume", "fresh"]);
  assert.deepEqual(promptModes, ["resumed", "fresh"]);
  assert.equal(result.session.mode, "fallback_fresh");
  assert.equal(result.session.registryWrite, true);
  assert.deepEqual(writes, ["fresh:session-test-123"]);
  assert.deepEqual(events.map(({ event }) => event), [
    "reviewer_session.resume_failed",
    "reviewer_session.expired",
    "reviewer_session.closed",
    "reviewer_session.rotated",
    "reviewer_session.fallback_fresh",
  ]);
  assert.doesNotMatch(JSON.stringify({ result, events }), /session-test-123/);
});

test("invalid resumed output gets one fallback fresh attempt and never resumes again when it fails", async () => {
  const writes: string[] = [];
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const dependencies = continuousDependencies({
    entry: { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 },
    writes,
    events,
  });
  const directives: string[] = [];

  const result = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => {
      throw new Error("eligible fallback must remain structured");
    },
    invokeStructured: async (directive) => {
      directives.push(directive.mode);
      return { exitCode: 1, result: { outputText: "session-test-123", failure: { classification: "invalid_output", message: "invalid", retryable: false } } };
    },
    sessionDependencies: dependencies,
  });

  assert.deepEqual(directives, ["resume", "fresh"]);
  assert.equal(result.session.mode, "fallback_fresh");
  assert.equal(result.session.registryWrite, false);
  assert.deepEqual(writes, []);
  assert.deepEqual(events.map(({ event }) => event), [
    "reviewer_session.resume_failed",
    "reviewer_session.rotated",
    "reviewer_session.fallback_fresh",
  ]);
  assert.doesNotMatch(JSON.stringify({ result, events }), /session-test-123/);
});

test("retryable network resume sleeps once through injected jitter then updates the epoch once", async () => {
  const writes: string[] = [];
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const dependencies = continuousDependencies({
    entry: { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 },
    writes,
    events,
  });
  const matrix = dependencies as typeof dependencies & {
    jitter: (baseMs: number) => number;
    sleep: (delayMs: number) => Promise<void>;
    remainingBudgetMs: () => number;
  };
  const sleeps: number[] = [];
  let attempts = 0;
  matrix.jitter = (baseMs) => baseMs + 37;
  matrix.sleep = async (delayMs) => { sleeps.push(delayMs); };
  matrix.remainingBudgetMs = () => 5_000;

  const result = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => {
      throw new Error("network retry must not become fresh");
    },
    invokeStructured: async () => {
      attempts += 1;
      return attempts === 1
        ? { exitCode: 1, result: { outputText: "session-test-123", failure: { classification: "unknown", message: "network", retryable: true } } }
        : { exitCode: 0, result: { providerSessionId: "session-test-123", outputText: "resumed" } };
    },
    sessionDependencies: matrix,
  });

  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [1_037]);
  assert.equal(result.session.mode, "resumed");
  assert.equal(result.session.registryWrite, true);
  assert.deepEqual(writes, ["resume:4:session-test-123"]);
  assert.deepEqual(events.map(({ event }) => event), ["reviewer_session.resumed"]);
});

test("retry followed by a recoverable resume failure rotates once into fallback fresh", async () => {
  const writes: string[] = [];
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const dependencies = continuousDependencies({
    entry: { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 },
    writes,
    events,
  });
  const matrix = dependencies as typeof dependencies & {
    close: (key: string, epoch: number) => boolean;
    jitter: (baseMs: number) => number;
    sleep: (delayMs: number) => Promise<void>;
    remainingBudgetMs: () => number;
  };
  matrix.close = () => true;
  matrix.jitter = () => 900;
  matrix.sleep = async () => undefined;
  matrix.remainingBudgetMs = () => 5_000;
  const directives: string[] = [];
  let invocation = 0;
  const result = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => { throw new Error("fallback must use structured fresh"); },
    invokeStructured: async (directive) => {
      directives.push(directive.mode);
      invocation += 1;
      if (invocation === 1) return { exitCode: 1, result: { outputText: "", failure: { classification: "unknown", message: "network", retryable: true } } };
      if (invocation === 2) return { exitCode: 1, result: { outputText: "", failure: { classification: "session_expired", message: "expired", retryable: false } } };
      return { exitCode: 0, result: { providerSessionId: "session-test-123", outputText: "replacement" } };
    },
    sessionDependencies: matrix,
  });
  assert.deepEqual(directives, ["resume", "resume", "fresh"]);
  assert.equal(result.session.mode, "fallback_fresh");
  assert.deepEqual(writes, ["fresh:session-test-123"]);
  assert.deepEqual(events.map(({ event }) => event), [
    "reviewer_session.resume_failed",
    "reviewer_session.expired",
    "reviewer_session.closed",
    "reviewer_session.rotated",
    "reviewer_session.fallback_fresh",
  ]);
});

test("hard resume failures do not retry, recover fresh, or write the registry", async () => {
  for (const classification of ["auth_required", "permission_denied", "configuration_error", "session_incompatible", "non_interactive_unsupported"] as const) {
    const writes: string[] = [];
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const dependencies = continuousDependencies({
      entry: { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 },
      writes,
      events,
    });
    let structuredCalls = 0;
    let freshCalls = 0;
    const result = await invokeReviewerWithSession("/disposable/run", {
      effectiveMode: "interactive_continuous",
      invokeFresh: async () => {
        freshCalls += 1;
        return { exitCode: 0, outputText: "must not run" };
      },
      invokeStructured: async () => {
        structuredCalls += 1;
        return { exitCode: 1, result: { outputText: "session-test-123", failure: { classification, message: "unsafe provider diagnostics", retryable: false } } };
      },
      sessionDependencies: dependencies,
    });
    assert.equal(structuredCalls, 1, classification);
    assert.equal(freshCalls, 0, classification);
    assert.deepEqual(writes, [], classification);
    assert.equal(result.session.registryWrite, false, classification);
    assert.equal(result.outputText, "Reviewer session cannot continue; verify reviewer access and configuration.", classification);
    assert.doesNotMatch(JSON.stringify({ result, events }), /session-test-123/, classification);
  }
});

test("exhausted budget skips retry sleep and fallback recovery", async () => {
  const writes: string[] = [];
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const dependencies = continuousDependencies({
    entry: { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 },
    writes,
    events,
  });
  const matrix = dependencies as typeof dependencies & {
    sleep: (delayMs: number) => Promise<void>;
    jitter: (baseMs: number) => number;
    remainingBudgetMs: () => number;
  };
  let sleeps = 0;
  matrix.sleep = async () => { sleeps += 1; };
  matrix.jitter = () => 1_000;
  matrix.remainingBudgetMs = () => 0;
  let calls = 0;

  const result = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => {
      throw new Error("exhausted budget must not recover fresh");
    },
    invokeStructured: async () => {
      calls += 1;
      return { exitCode: 1, result: { outputText: "session-test-123", failure: { classification: "unknown", message: "network", retryable: true } } };
    },
    sessionDependencies: matrix,
  });

  assert.equal(calls, 0);
  assert.equal(sleeps, 0);
  assert.deepEqual(writes, []);
  assert.equal(result.session.registryWrite, false);
});

test("structured Retry-After is honored once while provider busy exhausts to lane failure without fresh", async () => {
  const retryAfterWrites: string[] = [];
  const retryAfterEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const retryAfterDependencies = continuousDependencies({
    entry: { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 },
    writes: retryAfterWrites,
    events: retryAfterEvents,
  });
  const retryAfterMatrix = retryAfterDependencies as typeof retryAfterDependencies & {
    jitter: (baseMs: number) => number;
    sleep: (delayMs: number) => Promise<void>;
    remainingBudgetMs: () => number;
  };
  const retryAfterSleeps: number[] = [];
  retryAfterMatrix.jitter = (baseMs) => baseMs + 99;
  retryAfterMatrix.sleep = async (delayMs) => { retryAfterSleeps.push(delayMs); };
  retryAfterMatrix.remainingBudgetMs = () => 5_000;
  let retryAfterCalls = 0;
  const retryAfterResult = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => { throw new Error("rate limit must not become fresh"); },
    invokeStructured: async () => {
      retryAfterCalls += 1;
      return retryAfterCalls === 1
        ? { exitCode: 1, result: { outputText: "", retryAfterMs: 1_200, failure: { classification: "rate_limited", message: "rate limited", retryable: true } } }
        : { exitCode: 0, result: { providerSessionId: "session-test-123", outputText: "resumed" } };
    },
    sessionDependencies: retryAfterMatrix,
  });
  assert.deepEqual(retryAfterSleeps, [1_200]);
  assert.equal(retryAfterResult.session.registryWrite, true);

  const busyWrites: string[] = [];
  const busyEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const busyDependencies = continuousDependencies({
    entry: { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 },
    writes: busyWrites,
    events: busyEvents,
  });
  const busyMatrix = busyDependencies as typeof busyDependencies & {
    jitter: (baseMs: number) => number;
    sleep: (delayMs: number) => Promise<void>;
    remainingBudgetMs: () => number;
  };
  const busySleeps: number[] = [];
  busyMatrix.jitter = () => 900;
  busyMatrix.sleep = async (delayMs) => { busySleeps.push(delayMs); };
  busyMatrix.remainingBudgetMs = () => 5_000;
  let busyFreshCalls = 0;
  let busyCalls = 0;
  const busyResult = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => {
      busyFreshCalls += 1;
      return { exitCode: 0, outputText: "must not run" };
    },
    invokeStructured: async () => {
      busyCalls += 1;
      return { exitCode: 1, result: { outputText: "", failure: { classification: "provider_busy", message: "busy", retryable: true } } };
    },
    sessionDependencies: busyMatrix,
  });
  assert.equal(busyCalls, 2);
  assert.deepEqual(busySleeps, [900]);
  assert.equal(busyFreshCalls, 0);
  assert.deepEqual(busyWrites, []);
  assert.equal(busyResult.exitCode, 1);
});

test("capability drift closes a stale entry and uses one plain fallback fresh without calling an absent structured hook", async () => {
  const writes: string[] = [];
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const dependencies = continuousDependencies({
    entry: { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 },
    writes,
    events,
  });
  const matrix = dependencies as typeof dependencies & { close: (key: string, epoch: number) => boolean };
  let capabilityChecks = 0;
  let freshCalls = 0;
  let structuredCalls = 0;
  matrix.close = () => true;
  matrix.supportsStructuredSessions = () => {
    capabilityChecks += 1;
    return capabilityChecks === 1;
  };

  const result = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => {
      freshCalls += 1;
      return { exitCode: 0, outputText: "fresh after upgrade" };
    },
    invokeStructured: async () => {
      structuredCalls += 1;
      throw new Error("unsupported adapter must not invoke a structured parser/hook");
    },
    sessionDependencies: matrix,
  });

  assert.equal(capabilityChecks, 2);
  assert.equal(structuredCalls, 0);
  assert.equal(freshCalls, 1);
  assert.equal(result.session.mode, "fallback_fresh");
  assert.equal(result.session.registryWrite, false);
  assert.deepEqual(writes, []);
  assert.deepEqual(events.map(({ event }) => event), [
    "reviewer_session.resume_failed",
    "reviewer_session.closed",
    "reviewer_session.rotated",
    "reviewer_session.fallback_fresh",
  ]);
});

test("not found and context overflow rotate once into fallback fresh", async () => {
  for (const classification of ["session_not_found", "context_overflow"] as const) {
    const writes: string[] = [];
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const dependencies = continuousDependencies({
      entry: { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 },
      writes,
      events,
    });
    const matrix = dependencies as typeof dependencies & { close: (key: string, epoch: number) => boolean };
    const directives: string[] = [];
    matrix.close = () => true;
    const result = await invokeReviewerWithSession("/disposable/run", {
      effectiveMode: "interactive_continuous",
      invokeFresh: async () => { throw new Error("continuous fallback must be structured"); },
      invokeStructured: async (directive) => {
        directives.push(directive.mode);
        return directive.mode === "resume"
          ? { exitCode: 1, result: { outputText: "", failure: { classification, message: "safe", retryable: false } } }
          : { exitCode: 0, result: { providerSessionId: "session-test-123", outputText: "fresh" } };
      },
      sessionDependencies: matrix,
    });
    assert.deepEqual(directives, ["resume", "fresh"], classification);
    assert.equal(result.session.mode, "fallback_fresh", classification);
    assert.equal(result.session.registryWrite, true, classification);
    assert.deepEqual(writes, ["fresh:session-test-123"], classification);
    assert.deepEqual(events.map(({ event }) => event), [
      "reviewer_session.resume_failed",
      "reviewer_session.closed",
      "reviewer_session.rotated",
      "reviewer_session.fallback_fresh",
    ], classification);
  }
});

test("lifecycle-expired registry evidence closes under the lease then writes one replacement fresh entry", async () => {
  const writes: string[] = [];
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const dependencies = continuousDependencies({ writes, events });
  const entry = { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 };
  const matrix = dependencies as typeof dependencies & { close: (key: string, epoch: number) => boolean };
  const directives: string[] = [];
  matrix.read = () => ({ kind: "lifecycle", entry, reason: "expired_idle" });
  matrix.close = () => true;
  const result = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => { throw new Error("lifecycle recovery must remain structured"); },
    invokeStructured: async (directive) => {
      directives.push(directive.mode);
      return { exitCode: 0, result: { providerSessionId: "session-test-123", outputText: "replacement" } };
    },
    sessionDependencies: matrix,
  });
  assert.deepEqual(directives, ["fresh"]);
  assert.equal(result.session.mode, "fallback_fresh");
  assert.deepEqual(writes, ["fresh:session-test-123"]);
  assert.deepEqual(events.map(({ event }) => event), [
    "reviewer_session.expired",
    "reviewer_session.closed",
    "reviewer_session.rotated",
    "reviewer_session.fallback_fresh",
  ]);
});

test("unavailable registry and structured invocation exceptions never become provider-ID fresh recovery", async () => {
  const unavailable = continuousDependencies({ writes: [], events: [] });
  unavailable.read = () => ({ kind: "unavailable" });
  let plainFresh = 0;
  const unavailableResult = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => {
      plainFresh += 1;
      return { exitCode: 0, outputText: "plain fresh" };
    },
    invokeStructured: async () => { throw new Error("unsafe registry must not parse a provider session"); },
    sessionDependencies: unavailable,
  });
  assert.equal(plainFresh, 1);
  assert.equal(unavailableResult.session.mode, "fresh");
  assert.equal(unavailableResult.session.registryWrite, false);

  const exceptional = continuousDependencies({
    entry: { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 },
    writes: [],
    events: [],
  });
  let exceptionFresh = 0;
  const exceptionalResult = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => {
      exceptionFresh += 1;
      return { exitCode: 0, outputText: "must not run" };
    },
    invokeStructured: async () => { throw new Error("spawn failed"); },
    sessionDependencies: {
      ...exceptional,
      normalizeInvocationException: () => ({
        result: { outputText: "", failure: { classification: "timeout", message: "timeout", retryable: false } },
        timedOut: true,
      }),
    },
  });
  assert.equal(exceptionFresh, 0);
  assert.equal(exceptionalResult.exitCode, 1);
  assert.equal(exceptionalResult.session.mode, "resumed");
});

test("lease action exception without a provider spawn omits session invocation provenance", async () => {
  const dependencies = continuousDependencies({ writes: [], events: [] });
  dependencies.read = () => { throw new Error("registry read failed"); };
  let providerCalls = 0;
  const result = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => { providerCalls += 1; return { exitCode: 0, outputText: "" }; },
    invokeStructured: async () => { providerCalls += 1; return { exitCode: 0, result: { outputText: "" } }; },
    sessionDependencies: dependencies,
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.exitCode, 1);
  assert.equal(result.session.mode, undefined);
});

test("a small remaining budget is passed to resume and prevents an unbounded retry", async () => {
  const dependencies = continuousDependencies({
    entry: { providerSessionId: "session-test-123", sessionRef: "rs-0123456789abcdef", epoch: 4 },
    writes: [],
    events: [],
  });
  const matrix = dependencies as typeof dependencies & {
    remainingBudgetMs: () => number;
    jitter: (baseMs: number) => number;
    sleep: (delayMs: number) => Promise<void>;
  };
  const timeouts: Array<number | undefined> = [];
  let sleeps = 0;
  matrix.remainingBudgetMs = () => 250;
  matrix.jitter = () => 1_000;
  matrix.sleep = async () => { sleeps += 1; };
  const result = await invokeReviewerWithSession("/disposable/run", {
    effectiveMode: "interactive_continuous",
    invokeFresh: async () => { throw new Error("network retry must not become fresh"); },
    invokeStructured: async (_directive, context) => {
      timeouts.push(context?.timeoutSecs);
      return { exitCode: 1, result: { outputText: "", failure: { classification: "unknown", message: "network", retryable: true } } };
    },
    sessionDependencies: matrix,
  });
  assert.deepEqual(timeouts, [0.25]);
  assert.equal(sleeps, 0);
  assert.equal(result.exitCode, 1);
});

test("busy and unavailable plain-fresh paths use remaining budget and skip the provider at zero", async () => {
  for (const reason of ["busy", "unavailable"] as const) {
    const dependencies = continuousDependencies({ writes: [], events: [] });
    dependencies.withLease = async () => ({ acquired: false, reason });
    const matrix = dependencies as typeof dependencies & { remainingBudgetMs: () => number };
    matrix.remainingBudgetMs = () => 0;
    let freshCalls = 0;
    const result = await invokeReviewerWithSession("/disposable/run", {
      effectiveMode: "interactive_continuous",
      invokeFresh: async () => {
        freshCalls += 1;
        return { exitCode: 0, outputText: "must not spawn" };
      },
      invokeStructured: async () => { throw new Error("lease result must not parse session"); },
      sessionDependencies: matrix,
    });
    assert.equal(freshCalls, 0, reason);
    assert.equal(result.exitCode, 1, reason);
  }
});
