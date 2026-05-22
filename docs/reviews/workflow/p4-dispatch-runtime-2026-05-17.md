# P4 Dispatch Runtime Review

`schema_version`: 1

Scope: P4.1-P4.4 dispatch runtime, canonical artifacts, fanout synthesis,
fallback attempts, timeout handling, retry/resume/attach behavior, stage attempt
audit trail, and release verdict gating against packet v2 execution facts.

## Review Inputs

- Static review of `packages/runtime/src/flow/dispatch.ts`, review artifact
  helpers, retry/resume tests, and release verdict flow tests.
- Targeted P4.Z regression:
  `npm run build && node --test dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/flow-retry-resume.test.js dist-node/tests-node/release-check-flow.test.js dist-node/tests-node/release-check.test.js dist-node/tests-node/packet-validate.test.js dist-node/tests-node/sdk-read.test.js dist-node/tests-node/studio-ui.test.js`.
- Prior P4 slice evidence for repeated artifacts, synthesis context de-dup,
  fallback attempts, timeout attempts, retry lane attempts, current attach, and
  final release-check decide verdict gating.

## Must Fix

None.

## Accepted Findings

### Should 1: Repeated Review Artifact IDs

Accepted and fixed in P4.1. Repeated review raw output artifact ids now use the
canonical node id (`review_2_<agent>`) instead of mixing stage type and node id
prefixes.

### Should 2: Fanout Synthesis Prompt Context Replay

Accepted and fixed in P4.2. Plan/decide synthesis now uses a synthesis-specific
base prompt that carries request, assignment, prior artifacts, gate contracts,
and fanout outputs while referencing `context.md` instead of replaying full
context text.

### Should 3: Packet-Driven Attempts, Fallback, and Timeout Audit

Accepted and fixed in P4.3. Dispatch now reads `stage_invocations` and
`stage_fallbacks`, records `stage_attempts` for completed/failed/timed-out
attempts, and preserves lane-level audit fields including primary/requested/
actual agent, fallback source, attempt counters, timeout budget, status, and
error kind.

### Should 4: Retry/Attach/Verdict Boundary Coverage

Accepted and fixed in P4.4. Tests now assert retry increments the same lane's
`lane_attempt`, current attach does not create dispatch attempts, and invalid
release verdict events include the exact node id. Release verdict writes remain
restricted to the final release-check decide node.

## Residual Risk

- Fanout fallback writes the fallback result into the original lane output slot
  so synthesis can consume a stable lane map. The `stage_attempts` audit trail
  records the actual fallback agent; artifact manifests continue to represent
  the logical lane output rather than every attempted agent.
- Prompt raw review summarization/truncation is still P5.1 scope. P4 verifies
  dispatch execution facts and avoids synthesis context replay, but does not
  redesign all prior evidence assembly.
- README and `index.html` are only status-calibrated in P4.Z. The broader public
  docs rewrite for prompt model, packet v2, Studio, and terminology remains P5
  scope.
