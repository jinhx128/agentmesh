# P5 Final Workflow Stage Semantics Review

Date: 2026-05-17

## Scope

- Commits reviewed: `39c6f20..HEAD` plus the current P5.Z working tree.
- Plan scope: `plan.md` P5.1-P5.5 and P5.Z.
- Areas checked: ordered prior evidence, docs contracts, README/index, Studio packet v2 display, changelog, packet v2 / no v1 migration semantics, preset-first UX, decide checkpoint behavior, fallback/failure/attempt/timeout details, and tests.

## Reviewer Availability

- `npm run agentmesh -- doctor --agent claude --agent opencode --json`
- `claude`: ready; auth probe passed; used for the final read-only review.
- `opencode`: not ready; auth probe timed out after 30s, matching the earlier unavailable lane pattern. It was not used as a release blocker.

## Review Findings

- Must Fix: 0.
- Should 1 accepted: preset runs had implementation coverage for `--task` plus `--task-file`, but no preset-path regression test. Added `preset run rejects inline task and task file together` in `tests-node/flow-preset-run.test.ts`.
- Should 2 accepted as coverage hardening: Studio attempt details already render inside `.workflow-detail-metric strong`, which has `overflow-wrap: anywhere`; added a targeted CSS guardrail assertion in `tests-node/studio-ui.test.ts`.
- Should 3 accepted: flip P5.Z and P5 stage gate only after review, tests, changelog, and release verdict are recorded in this final commit.
- Nit 5 checked: `index.html` matrix uses `grid-template-columns: 180px repeat(4, 1fr)`, so the new packet v1 migration row aligns with the 5-column matrix.
- Other nits are deferred residual risks: raw review heading collision, byte-based prompt thresholds, literal `--task-file` task text edge case, and raw-vs-semantic prior raw review labels.

## Verification

- `npm run build && node --test --test-name-pattern "preset run rejects inline task|accessibility and responsive guardrails" dist-node/tests-node/flow-preset-run.test.js dist-node/tests-node/studio-ui.test.js` — 2/2.
- `npm run build && node --test dist-node/tests-node/flow-preset-run.test.js dist-node/tests-node/studio-ui.test.js dist-node/tests-node/core-contracts.test.js dist-node/tests-node/flow-prompt.test.js dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/flow-run.test.js dist-node/tests-node/workflow-registry.test.js dist-node/tests-node/sdk-read.test.js` — 107/107.
- `git diff --check`.
- `npm test` — 381/381.

## Release Gate

Verdict: ready.

Basis:

- P5.1-P5.5 are complete and committed.
- External Claude 4.7 final review reported no Must Fix findings.
- Accepted Should findings were handled before flipping the stage gate.
- README, index, docs contracts, Studio tests, SDK tests, packet validation, workflow registry, flow creation, dispatch, prompt, and full test suites pass.
- No unresolved release blocker remains.

Residual risks:

- Prompt budget still uses bytes as a token-cost proxy.
- No v1 packet migration is intentional and documented.
- Raw review heading detection can still collide with user-authored headings; this is inherited and deferred.
- `resolveTaskInput` can theoretically misread literal `--task-file` task text as a flag; low-risk deferred nit.
