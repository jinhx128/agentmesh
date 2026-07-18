# Task 15 P3.Z Gate Report

## Scope and safety boundary

- Baseline inspected: `ccbf2d9`; P3 start bookkeeping base checked: `920c4f0`.
- This gate did not invoke a real provider CLI and did not read any token, cookie, keychain, login state, private provider session store, or real reviewer-session registry.
- Added the replayable verifier `task-15-p3z-fake-cli-e2e.mjs`. It creates a temporary workspace/HOME/config/registry, generates fake IDs only in its process, passes them only through the fake child environment, and removes all temporary state in `finally`.
- The verifier's printed JSON has only booleans, counts, modes, and event names. The disposable registry is the only at-rest location for fake provider IDs. Fake sidecars retain only call modes.

## Disposable fake-CLI E2E

Command (after a fresh Node build):

```sh
node .superpowers/sdd/task-15-p3z-fake-cli-e2e.mjs
```

Safe result:

```json
{"cleanup_completed":true,"provider_call_sequence":["fresh","resume","resume-failure","fresh-recovery"],"attempt_modes":["fresh","resumed","fallback_fresh"],"registry_entry_count":1,"no_real_sleeps":true,"schema_versions_valid":true,"generated_artifact_fake_id_matches":0,"generated_artifact_scope_token_matches":0,"event_names":["reviewer_session.created","reviewer_session.resumed","reviewer_session.resume_failed","reviewer_session.closed","reviewer_session.rotated","reviewer_session.fallback_fresh"]}
```

Assertions covered:

- First continuous dispatch is structured `fresh`, writes exactly one safe registry entry, and emits `reviewer_session.created`.
- The second dispatch is explicit structured `resumed`; its attempt is non-hermetic with `session_resume`; its prompt has exactly one owned delta block and current request, diff, verification, and active-correction evidence categories.
- The third dispatch receives the fake not-found response, performs one rotation and exactly one `fallback_fresh`, writes the replacement entry, and never loops back to resume. Its fresh-recovery prompt has no resumed-only block.
- The fake sidecar records only `fresh`, `resume`, `resume`, `fresh`; all generated run files, artifacts, prompts, events, logs, outputs, errors, and fake sidecars scan to zero matches for either generated fake ID and the raw propagated scope token.
- Packet/workflow schema versions remain `1`; E2E statuses, attempts, and event provenance were parsed and asserted. The independent safety contract remains exercised by the targeted tests below.

Verifier calibration notes: its initial empty-packet assertion incorrectly required evidence sections that only exist when packet evidence is supplied. Adding disposable diff, verification, and correction inputs made the intended category check meaningful. A subsequent expected `expired` event was corrected to the actual not-found path, whose required safe rotation evidence is `resume_failed`, `closed`, `rotated`, and `fallback_fresh`. Neither observation indicated a production defect.

## Fresh targeted verification

```sh
npm run build:node
node --test \
  dist-node/tests-node/core-contracts.test.js \
  dist-node/tests-node/workflow-registry.test.js \
  dist-node/tests-node/flow-run.test.js \
  dist-node/tests-node/adapter-plugin.test.js \
  dist-node/tests-node/adapter-invocation.test.js \
  dist-node/tests-node/readiness.test.js \
  dist-node/tests-node/reviewer-session-scope.test.js \
  dist-node/tests-node/reviewer-session-registry.test.js \
  dist-node/tests-node/reviewer-session-lease.test.js \
  dist-node/tests-node/reviewer-session-cli.test.js \
  dist-node/tests-node/reviewer-session-dispatch.test.js \
  dist-node/tests-node/flow-dispatch.test.js \
  dist-node/tests-node/flow-prompt.test.js \
  dist-node/tests-node/flow-retry-resume.test.js \
  dist-node/tests-node/corrections.test.js \
  dist-node/tests-node/review-artifacts.test.js \
  dist-node/tests-node/release-check.test.js \
  dist-node/tests-node/release-check-flow.test.js
```

- Fresh Node build: passed.
- Targeted suite: 18 files / 312 selected top-level test declarations, command exit `0`; 0 failed, 0 skipped, 0 cancelled. The Node dot reporter has no aggregate line, so selected count was independently counted from the just-built selected test modules rather than inferred from partial console output.

## Diff and cumulative safety checks

```sh
git diff --check
git diff --check 920c4f0
```

Both passed.

The cumulative `920c4f0..HEAD` scan reported 79 fixed fixture-ID lines in approved test/fixture/report/plan/changelog contexts. The initial path-only classifier labelled three documentation lines outside that narrow set as unexpected; file review showed they are phase reports/changelog/plan documentation, not runtime values. The only production match for the fake provider not-found text is the intentional adapter-local classifier pattern; it does not persist or report raw provider diagnostics. No real/native ID or raw probe output was found in generated E2E artifacts (both fake-ID and raw-scope counts: 0).

## Complete regression

```sh
npm test
```

Passed once, including a fresh Node build and Studio frontend build. The default Node spec reporter produced 221 explicit success markers; failed 0, skipped 0, cancelled 0, todo 0. No full-suite-only failure occurred.

## Residual risks

- The provider capability matrix remains intentionally limited to the documented fake/verified structured adapters; no live provider/auth/session-retention behavior was exercised by this gate.
- The original gate found no production defect; the subsequent Cursor final review identified and this fix closes the bounded retry/event/workspace/provenance gaps documented below.

## Cursor final-review fixes

### TDD record

1. RED: retryable resume followed by successful retry emitted both `resume_failed` and `resumed`; retry followed by `session_expired` stopped after the second resume and retained the stale entry. GREEN: terminal failure handling is now centralized after the retry decision. Successful retry emits only `reviewer_session.resumed`; retry terminal failure emits exactly one `resume_failed`; retry→recoverable closes/rotates and performs at most one `fallback_fresh`, while hard/retryable terminal results do not retry again.
2. RED: actual `runAgentCallAsync({ cwd: linkedWorktree, session })` produced OpenCode `--dir` using the process cwd. GREEN: the async adapter surface passes its resolved caller cwd as the structured invocation workspace; the fake OpenCode argv test asserts the exact linked-worktree path.
3. RED: a lease action exception before provider spawn returned `session.mode=fresh`. GREEN: no-spawn failure now retains safe failure fields but omits `session_mode`; `reviewerSessionAttemptFields` remains backward compatible by emitting the optional field only when a provider invocation mode exists.

### Focused verification after fixes

```sh
npm run build:node
node --test <the existing 18-file P3 targeted selection>
node .superpowers/sdd/task-15-p3z-fake-cli-e2e.mjs
git diff --check
git diff --check 920c4f0
```

- Fresh Node build passed.
- P3 targeted suite: **315/315 passed**, 0 failed, 0 skipped, 0 cancelled.
- Disposable E2E passed with `fresh → resumed → fallback_fresh`, one active registry entry, safe exact events, and zero generated-artifact matches for fake provider IDs or the raw scope token.
- Full `npm test` was intentionally not rerun; the controller owns the post-review-clean full gate.

### Final-fix self-review

- Retry bound remains one: the retried result is finalized directly and is never passed back through retry selection. Recoverable/unsupported retry terminal states may use the existing single fallback-fresh path; hard or still-retryable terminal states return lane failure.
- `resume_failed` is emitted only by terminal finalization (or budget exhaustion), exactly once; successful retry reaches `completedResume` directly and emits only `resumed`.
- OpenCode workspace propagation is adapter-local argv construction from the explicit caller cwd; no process-global cwd fallback is used when the caller supplies a worktree.
- No-spawn lease-action failure omits only the optional `session_mode`; existing packet schema and consumers remain compatible, while `hermetic=true` and `registry_write=false` stay truthful.
- No P3.4 prompt/provenance presentation or real provider/user state access was added.
