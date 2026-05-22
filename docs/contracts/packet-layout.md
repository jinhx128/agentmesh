# Packet Layout Contract

`schema_version`: 1

AgentMesh packets are durable, local-first handoff directories. The packet
directory is the source of truth; databases and UI indexes are derived caches.

## Required Observation Contract

These files are the stable observation surface for CLI, future Studio, and
other tools:

- `status.json`
- `events.jsonl`
- `artifacts.toml`

Tools may also inspect these canonical human-readable artifacts when present:

- `request.md`
- `context.md`
- `plan.md`
- `handoff.md`
- `verification.md`
- `findings.md`
- `decision.md`
- `reviews/<reviewer>.md`
- `release-summary.md`

## Canonical Files

- `request.md`: original user intent.
- `context.md`: bounded factual context supplied to the agent. Each context
  entry should include visible provenance metadata as defined in
  `context-provenance.md`.
- `plan.md`: planning artifact.
- `handoff.md`: transfer artifact for another agent or worker.
- `verification.md`: commands, test/build/smoke/regression evidence, skipped
  checks, and residual verification risk.
- `findings.md`: review findings and controller verification.
- `decision.md`: explicit engineering or release decision.
- `reviews/<reviewer>.md`: raw reviewer output preserved as evidence before
  controller classification.
- `events.jsonl`: append-only audit timeline.
- `status.json`: machine-readable run status.
- `artifacts.toml`: artifact manifest.
- `release-summary.md`: release gate evidence summary.

## Schema Version Policy

- `status.json` uses the current packet schema `"schema_version": 1`.
- Other machine-readable packet files currently use `schema_version = 1` or
  `"schema_version": 1`.
- Versions are monotonic integers.
- Readers accept the current version and explicitly documented compatible older
  versions. Legacy packet status is not supported in the Plan A development line.
- Readers fail clearly on newer unknown versions.
- Migrations must be explicit and tested.

## Artifact Protection

Artifacts from completed stages are protected. Retry/resume may append new
events and produce new artifacts for resumed stages, but must not silently
overwrite completed-stage artifacts without recording the reason in
`events.jsonl`.
