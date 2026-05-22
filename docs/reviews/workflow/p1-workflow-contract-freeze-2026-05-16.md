# P1 Workflow Contract Freeze Review

`schema_version`: 1

Run: `p1z-contract-freeze-20260516-2050`
Scope: commits `f0f4ff9..01e889a`, plus accepted P1.Z cleanup.

## Review Inputs

- Reviewer `claude` completed and reported no Must findings.
- Reviewer `opencode` started but produced no review artifact; after the 900s
  lane window was exceeded, the process was terminated and AgentMesh recorded
  `stage.agent_failed` with exit code `1`.
- Targeted P1.Z tests passed: `core-contracts`, `workflow-registry`,
  `packet-validate`, `packet-io`, `sdk-read`, `studio`, and `studio-ui`.
- Full P1.4 baseline before P1.Z cleanup passed: `npm test` 346/346.

## Accepted Findings

### Should 1: Execute Multi-Agent Error Wording

Accepted and fixed. Runtime now throws:

```text
stage '<node-id>' does not support multi-agent dispatch
```

The `flow-dispatch` regression expectation was updated to match the frozen
contract.

### Should 2: Dead Legacy Packet Validator Branch

Accepted and fixed. The unreachable v1 top-level role-field diagnostic branch
was removed from packet validation.

### Should 3: Default Timeout Constant

Accepted and fixed. `createFlowRun()` now uses
`DEFAULT_INVOCATION_TIMEOUT_SECONDS` from core for primary and synthesis lanes.

## Deferred Findings

### Current Node Fallback Defaults

Deferred to P3. Current run creation still writes permissive default failure
policy and empty fallback settings for pure `current` nodes. The P1 contract
defines the target behavior, but complete resolution belongs to P3's
config/preset resolver.

### Future Timeout Provenance Values

Deferred to P3. P1 defines provenance values such as `cli`,
`preset_fallback`, and `global_fallback`; current creation emits only `current`
and `system_default` until those resolution layers exist.

## Residual Risk

- P2.1 and P2.2 plan items are largely satisfied by the P1 commits, but P2.3
  and P2.4 remain real implementation work.
- External DS/opencode review did not complete in this run. The partial evidence
  is recorded in `.agentmesh/runs/p1z-contract-freeze-20260516-2050`.
