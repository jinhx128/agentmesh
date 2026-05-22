# Release Verdict Contract

`schema_version`: 1

Release readiness is a first-class workflow result.

## Allowed Verdicts

- `ready`
- `not_ready`
- `needs_decision`

## Versioned Release Gate Result

```json
{
  "schema_version": 1,
  "verdict": "ready",
  "decision_file": "decision.md",
  "release_summary_file": "release-summary.md"
}
```

## Evidence Inputs

Release-check aggregates:

- diff summary
- verification commands and results
- skipped checks
- accepted review findings
- rejected review findings
- unresolved review findings
- residual risk
- final decision owner

## Consistency Rules

- AgentMesh records `status.json.release_verdict` only for the built-in Release
  Check workflow (`w-67ef1b1f`) when the current node is the final workflow node
  and has stage type `decide`.
- If a Release Check workflow contains earlier decision checkpoints, those
  non-final `decide` nodes write normal decision artifacts and do not update the
  release verdict payload.
- `ready` requires no unresolved Must Fix finding and no required verification
  failure.
- `not_ready` means the controller has enough evidence to block release.
- `needs_decision` means release may be possible, but a human or designated
  decider must resolve an explicit risk.
- Raw reviewer `Must Fix` output is not a release blocker by itself. It must be
  controller-classified as accepted or needs decision in `findings.md` before it
  affects the release gate.
- The verdict in `decision.md`, the release verdict payload in `status.json`,
  and `release-summary.md` must agree.
