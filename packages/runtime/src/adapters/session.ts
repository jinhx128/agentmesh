import type { AdapterFailure } from "@agentmesh/core";

export type AdapterSessionDirective =
  | { mode: "fresh" }
  | { mode: "resume"; providerSessionId: string };

export interface AdapterStructuredResult {
  providerSessionId?: string;
  outputText: string;
  failure?: AdapterFailure;
  /** Adapter-local, already-parsed Retry-After evidence in milliseconds. */
  retryAfterMs?: number;
}

export type AdapterSessionSafeResult = Omit<AdapterStructuredResult, "providerSessionId">;

/** Removes a provider-native session identifier before text leaves adapter-local handling. */
export function redactAdapterSessionText(value: string, providerSessionId: string | undefined): string {
  if (!providerSessionId) {
    return value;
  }
  return value.split(providerSessionId).join("[REDACTED]");
}

/** Creates a result that is safe to return in diagnostics, logs, and summaries. */
export function redactAdapterStructuredResult(
  result: AdapterStructuredResult,
  session?: AdapterSessionDirective,
): AdapterSessionSafeResult {
  const providerSessionIds = [
    result.providerSessionId,
    ...(session?.mode === "resume" ? [session.providerSessionId] : []),
  ];
  return {
    outputText: redactKnownSessionIds(result.outputText, providerSessionIds),
    ...(result.failure
      ? {
          failure: {
            classification: result.failure.classification,
            message: redactKnownSessionIds(result.failure.message, providerSessionIds),
            retryable: result.failure.retryable,
          },
        }
      : {}),
  };
}

function redactKnownSessionIds(value: string, providerSessionIds: Array<string | undefined>): string {
  return providerSessionIds.reduce<string>(
    (redacted, providerSessionId) => redactAdapterSessionText(redacted, providerSessionId),
    value,
  );
}
