# Studio Scope Decision

`schema_version`: 1

Decision: L8 Studio starts as a local observability and control surface for
AgentMesh packets. It does not become a second runtime, a cloud UI, or a packet
editor.

## Jobs To Be Done

Studio v1 should help a local operator answer these questions without reading
every packet file manually:

- What runs exist in `.agentmesh/runs/`?
- Which stage is each run in, and which stages are completed, failed, skipped,
  or waiting for a decision?
- What happened recently in `events.jsonl`?
- What artifacts are available, and what do `context.md`, `plan.md`,
  `handoff.md`, `findings.md`, `decision.md`, reviews, and
  `release-summary.md` say?
- Which review findings are accepted, rejected, or still needs-decision?
- What release verdict did the controller record, and what evidence is missing?
- What safe next action can be triggered through the CLI?

The first useful version is for one developer on one machine inspecting one
local workspace. It should make AgentMesh easier to operate, not broaden the
protocol surface.

## Source Of Truth

Packet files remain the source of truth:

- `status.json`
- `events.jsonl`
- `artifacts.toml`
- packet artifacts such as `context.md`, `findings.md`, `decision.md`, and
  `release-summary.md`

Studio may cache parsed data for rendering, but the cache is disposable. If the
cache disagrees with packet files, packet files win.

Studio must not import `packages/runtime` in v1. It observes packet files and
uses the CLI as the process boundary. This keeps one implementation of state
transitions, artifact writes, locks, packet validation, release aggregation, and
context ingestion.

## Mutation Rules

Studio mutations must call AgentMesh CLI commands as subprocesses:

- `agentmesh flow dispatch <run> --stage <stage|all>`
- `agentmesh flow retry <run> [--stage <stage>]`
- `agentmesh flow resume <run> [--stage <stage>]`
- `agentmesh flow attach <run> --stage <stage> [--text <text>] [--file <path>]`
- `agentmesh release-check summary <run> --write [--json]`

The UI may collect inputs, show the command it will run, stream stdout/stderr,
and refresh packet views after completion. It must not directly edit
`status.json`, `events.jsonl`, `artifacts.toml`, or stage artifacts.

All write operations continue to rely on CLI/runtime locking. Studio must
surface lock failures, active leases, expired lease recovery, command exit
codes, and JSON diagnostics instead of hiding them.

## Non-Goals

- Cloud UI, remote registry, auth, organizations, teams, or billing.
- Direct packet file editing.
- Reimplementing state transitions, release gates, review aggregation, context
  ingestion, workflow registry loading, or adapter invocation in frontend code.
- Model chat or host-agent private session sync.
- SQLite as canonical state.
- Long-lived daemon or local HTTP API as a prerequisite for L8.
- Full workflow authoring UI.
- General file manager for the repository.

## UI Surface

L8 should build these views in order:

- Run list: run id, workflow, current status, stage state summary, latest event.
- Run detail: status, assignment, stages, artifacts, events, release verdict.
- Artifact preview: Markdown/text preview with source path and artifact kind.
- Review/release view: grouped findings, raw reviews, release-summary evidence,
  skipped checks, residual risk, verdict.
- Mutation panel: subprocess command trigger with stdout/stderr and exit status.

The UI may be a local web wrapper at first. The shell technology decision is
deferred to L8.2.

## Acceptance Boundary

L8 is complete only when Studio can inspect real packets and trigger safe CLI
mutations without duplicating protocol logic. If a UI feature requires new
protocol behavior, the protocol change must land in CLI/runtime first, then the
UI can call or observe it.
