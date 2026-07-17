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
    read: () => entry,
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
    sessionDependencies: dependencies,
  };

  const first = await invokeReviewerWithSession("/disposable/run", input);
  const second = await invokeReviewerWithSession("/disposable/run", input);

  assert.deepEqual(directives, ["fresh", "resume"]);
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
      read: (key) => entries.get(key),
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
    invokeFresh: async () => {
      freshCalls += 1;
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
