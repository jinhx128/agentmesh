import type { AdapterFailure } from "@agentmesh/core";

export type AdapterSessionDirective =
  | { mode: "fresh" }
  | { mode: "resume"; providerSessionId: string };

export interface AdapterStructuredResult {
  providerSessionId?: string;
  outputText: string;
  failure?: AdapterFailure;
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
): AdapterSessionSafeResult {
  const providerSessionId = result.providerSessionId;
  return {
    outputText: redactAdapterSessionText(result.outputText, providerSessionId),
    ...(result.failure
      ? {
          failure: {
            classification: result.failure.classification,
            message: redactAdapterSessionText(result.failure.message, providerSessionId),
            retryable: result.failure.retryable,
          },
        }
      : {}),
  };
}
