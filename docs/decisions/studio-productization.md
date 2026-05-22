# Studio Productization Decision

`schema_version`: 1

Decision: P1 turns Studio into a local AgentMesh workbench for operating packet
runs. It is not a marketing page, a landing page, a cloud dashboard, a packet
editor, or a second runtime.

## Product Boundary

Studio is for a local operator working in one workspace. The first viewport must
make the current workspace, available runs, the selected run state, recent
events, artifacts, review/release evidence, and safe configuration or mutation
entry points visible without requiring the user to read packet files by hand.

The UI should stay dense and work-focused. It should favor scannable tables,
lists, status labels, timestamps, and direct actions over decorative product
storytelling.

## Primary User Tasks

- Find a recent run and understand whether it is running, completed, failed, or
  waiting for a decision.
- Inspect run timing, completed stages, latest events, and event pagination.
- Open packet artifacts such as `request.md`, `plan.md`, `handoff.md`,
  `findings.md`, `decision.md`, reviews, and `release-summary.md`.
- Check accepted, rejected, and needs-decision review findings.
- Check release verdict, skipped checks, residual risk, and raw review output.
- See configured agents and workflows, including diagnostics when the CLI-backed
  catalog cannot be read.
- Trigger allowed CLI-backed mutations and see the exact command, exit code,
  stdout, and stderr.

## First Viewport Layout

P1 should converge on a three-zone console:

- Workspace bar: product identity, local workspace context, language switch, and
  refresh.
- Run navigator: search/filter-ready run list with status, workflow, latest
  event, and updated time.
- Run workspace: selected run summary, stage timing, event timeline, artifact
  list, artifact preview, review/release evidence, configuration catalog, and
  safe actions.

P1.2 may implement this as left/middle/right columns on desktop. On narrow
screens the same zones should stack in source order with no horizontal scrolling
at 375px width.

## Current Data Inventory

The existing Studio data surface is enough to productize before adding new
protocol behavior:

- Runs: `GET /api/runs` returns summaries from `.agentmesh/runs/*/status.json`
  and latest `events.jsonl` entries.
- Run detail: `GET /api/runs/:run_id` returns status, stage timing, event page,
  artifact summaries, and review/release view.
- Event pagination: `event_offset` and `event_limit` expose bounded event pages
  while preserving the latest-event run summary.
- Artifacts: `artifacts.toml` indexes artifact name, path, kind, stage, and
  optional agent; preview reads text through the Studio server.
- Review/release: `findings.md`, `reviews/*.md`, `handoff.md`, status
  `release_verdict`, and `release-summary.md` are normalized into grouped
  findings, raw reviews, skipped checks, residual risk, and evidence sections.
- Catalog: `GET /api/catalog` invokes the CLI for `agents list --json` and
  `workflows list --json`, returning diagnostics instead of blocking forever on
  failures or timeouts.
- Mutations: `POST /api/mutations` allows only dispatch, retry, resume, and
  attach through a CLI subprocess.

## Data Sources

Packet files remain the durable source of truth:

- `.agentmesh/runs/<run>/status.json`
- `.agentmesh/runs/<run>/events.jsonl`
- `.agentmesh/runs/<run>/artifacts.toml`
- standard packet artifacts such as `request.md`, `context.md`, `plan.md`,
  `handoff.md`, `findings.md`, `decision.md`, `release-summary.md`, and
  reviewer files under `reviews/`

Configuration and catalog data are observed through the CLI boundary. Studio may
parse packet files for read-only display, but workflow registry loading, agent
registry behavior, state transitions, release aggregation, adapter invocation,
and lock ownership stay in CLI/runtime code.

## Mutation Rules

Studio does not directly edit packet files. Allowed write actions must go
through the Studio server and then the AgentMesh CLI subprocess allowlist:

- `agentmesh flow dispatch <run> --stage <stage|all>`
- `agentmesh flow retry <run> [--stage <stage>]`
- `agentmesh flow resume <run> [--stage <stage>]`
- `agentmesh flow attach <run> --stage <stage> [--agent <agent>] [--text <text>] [--file <path>]`

The UI must show command output and preserve CLI exit codes. Lock failures,
unsafe input, unsupported stage names, and other CLI diagnostics should remain
visible to the operator.

## API Boundary

The browser UI talks only to the Studio server. The Studio server exposes
UI-shaped endpoints, not generic filesystem access and not a generic command
runner. Studio source must not import `packages/runtime` or a runtime package
alias; the CLI remains the process boundary for behavior that mutates packets or
loads layered configuration.

## Mobile Degradation

At small widths Studio should keep the same tasks available in a stacked order:

- workspace bar
- run navigator
- selected run summary
- timeline/events
- artifacts and preview
- review/release evidence
- catalog and actions

Controls should wrap, long run ids and artifact paths should break safely, and
the layout should avoid horizontal scrolling at 375px.

## Non-Goals

- Cloud sync, accounts, organizations, remote registry, or billing.
- Generic AI chat or host-agent private session sync.
- Direct packet editing or filesystem browsing.
- Reimplementing runtime state transitions, release gates, review aggregation,
  context ingestion, workflow registry loading, or adapter invocation in the UI.
- Electron, Tauri, DMG packaging, native auto-update, or app-bundled runtime;
  those belong to P4 after the web Studio shape stabilizes.
- React, Vite, or another frontend framework unless later P1 slices prove the
  current plain TypeScript asset approach is the blocker.

## Acceptance Checkpoints

P1 productization should keep tests pinned to the first-screen workbench
structure:

- run list is present
- selected run summary is present
- timeline/events are present
- artifacts and preview are present
- review/release evidence is present
- agent/workflow configuration entry points are present
- allowed mutation actions remain CLI-backed
- Studio server remains the API boundary and does not import runtime
