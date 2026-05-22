# P2 Workflow Schema And Readers Review

`schema_version`: 1

Run: `p2z-schema-readers-20260516-2133`
Scope: P2.1-P2.4 workflow schema, packet v2 validation, workflow registry,
SDK readers, and Studio status rendering.

## Review Inputs

- Reviewer `claude` completed `review` stage and reported no Must Fix findings.
- Review artifact:
  `.agentmesh/runs/p2z-schema-readers-20260516-2133/reviews/claude.md`.
- P2.Z targeted baseline passed before accepted cleanup: core/schema/workflow,
  SDK, Studio, and Studio UI tests 67/67.
- P2.4 full baseline passed before P2.Z cleanup: `npm test` 352/352.

## Must Fix

None.

## Accepted Findings

### Should 1: Exact Stage Assignment Keys

Accepted and fixed. `PacketStatusSchema` now applies exact node-id key
validation to `stage_assignments`, matching the other packet v2 execution
facts. Missing assignments for declared stage nodes are rejected.

### Should 3: Unknown Failure Policy Fields

Accepted and fixed. `StageFailurePolicySchema` is strict, and workflow TOML
validation now rejects unknown keys inside
`failure_policy.stage_types.<type>` and `failure_policy.nodes.<node-id>`.

### Should 6: Empty Studio Invocation Display

Accepted and fixed. Studio now renders an empty invocation list as `none` /
`无` instead of `unknown` / `未知`, so corrupt or incomplete packet facts are
distinguishable from missing reader knowledge.

## Deferred Or Rejected Findings

### Should 2: Provenance Value Schema

Deferred to P3. P2 freezes the required node-id keyed provenance fields, but
P3 owns final default primary, fallback, timeout, and preset resolution values.
Tightening allowed provenance values before those writers land would risk
locking an incomplete value set.

### Should 4: Agent Timing Exact Keys

Rejected for P2. `stage_timing` is the exact per-node timing record used by
readers. `agent_timing` is intentionally sparse and only records stages that
actually invoked agents; planned or pure-current stages may have no agent
timing.

### Should 5: Generic Schema Version Guard Cleanup

Deferred as non-behavioral cleanup. Existing tests already cover integer and
unsupported schema versions; the duplicate guard is cosmetic and does not
change P2 contract behavior.

### Should 7: SDK `getRun` Double Reads Status

Deferred as low-risk reader cleanup. The current code can read `status.json`
twice, but packet writes are lock-protected and the behavior is not a P2 schema
contract issue. Consider folding `runSummary()` over an already-loaded status
snapshot in a future SDK cleanup.

## Residual Risk

- Private workflow files authored against packet v1 still fail fast by design;
  P5 docs should make the no-migration policy prominent outside contract docs.
- Provenance value tightening is intentionally deferred until P3 writes the
  final resolver outputs.
