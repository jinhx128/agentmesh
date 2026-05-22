# P3 Runtime Creation Review

`schema_version`: 1

Scope: P3.1-P3.5 runtime creation, config/preset resolution, default primary
agents, failure policy, fallback routing, timeout materialization, agent
registration validation, and packet v2 execution facts written at run creation.

## Review Inputs

- Static review of `packages/runtime/src/flow/create.ts`,
  `packages/runtime/src/config.ts`, CLI registration paths, and packet v2 schema
  exact-key validation.
- Targeted P3.Z regression:
  `npm run build && node --test dist-node/tests-node/config-layering.test.js dist-node/tests-node/flow-preset-run.test.js dist-node/tests-node/flow-run.test.js`.
- New routing materialization test:
  `preset run writes complete packet v2 routing materialization`.

## Must Fix

None.

## Accepted Findings

### Should 1: End-to-End Routing Materialization Coverage

Accepted and fixed. Existing tests covered assignment, fallback, failure policy,
and timeout behavior in focused slices, but P3.Z needed one complete packet v2
creation regression that passed through config, preset, workflow, schema parse,
and `packet validate`. The new `flow-preset-run` test asserts all stage-node
keyed execution fact records and validates the generated packet.

## Residual Risk

- Dispatch-time fallback attempts and timeout execution are intentionally P4
  scope. P3 freezes creation-time facts only; dispatch still owns recording
  runtime attempts from those facts.
- README and `index.html` are only status-calibrated in P3.Z. The full public
  docs rewrite for preset-first UX, decide checkpoints, packet v2, and migration
  notes remains P5.4 scope.
