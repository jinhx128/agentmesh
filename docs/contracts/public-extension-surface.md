# Public Extension Surface Contract

`schema_version`: 1

Decision: Read-only SDK promoted. `packages/sdk` is now the stable read surface
for workflows, agents, runs, events, and artifact indexes. The SDK remains
read-only; writes, adapter invocation, state advancement, locks, and config
mutation stay behind CLI/runtime commands.

## Current consumers

- CLI: owns workflow creation, packet mutation, agent registration, config
  writes, diagnostics, and command-line JSON output. Read-only agents/workflows
  commands use `packages/sdk`.
- Studio: reads runs, events, artifacts, release/review evidence, configured
  agents, and workflows through the Studio server and SDK-backed packet browser.
- Desktop: reuses Studio/App Server behavior with app-bundled runtime APIs,
  dynamic localhost transport, stdin-handshaken per-launch token, native
  HttpOnly cookie auth, and the same run lock contract.

## Potential consumers

- MCP server that exposes read-only AgentMesh state to tools.
- local scripts that need stable run and artifact reads without parsing files by
  hand.
- third-party adapter integrations that need discovery metadata and invocation
  contracts without importing runtime internals.
- external dashboard that displays run status, timing, events, artifacts, and
  release evidence.

Potential consumers are not enough to justify a package by themselves. A
consumer must be real, implemented or being implemented, and unable to safely
reuse CLI JSON or Studio API shape before a package is promoted.

## Capability classes

### read-only

The first public surface may expose read-only views of:

- workflows and workflow metadata
- configured agents and adapter capability metadata
- runs, status, stage nodes, assignments, and timing
- events and paginated event windows
- artifacts and safe text previews
- review, verify, release, and decision evidence

Read-only APIs must preserve packet schema boundaries. Unsupported newer packet
or config schemas may be reported, but a read-only call must not rewrite files,
repair manifests, acquire mutation locks, invoke adapters, or modify config.

`packages/sdk` exposes these first read APIs:

- `listWorkflows()`
- `getWorkflow(id)`
- `listAgents()`
- `listRuns({ page, pageSize })`
- `getRun(id)`
- `listRunEvents(runId, { page, pageSize })`
- `listArtifacts(runId)`

### controlled write

Controlled write capabilities remain behind CLI/runtime commands until a
separate package has tests and at least one real non-CLI consumer:

- create run
- register or remove agent
- add or remove workflow
- update config sections
- attach artifact
- retry, resume, or dispatch stage
- refresh release summary

When exposed later, controlled writes must go through the same validation,
filesystem run-lock, schema gate, and event/artifact recording paths as the CLI.
They must not provide a generic command runner or generic filesystem writer.

### internal

These stay internal unless a later decision explicitly promotes them:

- state machine advancement details
- filesystem run-lock implementation details
- packet file write helpers
- adapter invocation process management
- model discovery internals
- MCP stdio session cache internals
- raw log file placement
- release verdict parsing internals
- desktop host lifecycle and token implementation details

## Current package boundary

The current package boundary is deliberately narrow:

- `packages/sdk` exists for stable read APIs only
- no public write API
- no stable event subscription API
- no adapter plugin package
- no MCP server package
- no UI package

Existing consumers should continue to use:

- CLI JSON output for terminal and automation use, with CLI read commands
  internally sharing SDK reads where practical
- Studio server endpoints for local UI use
- contract docs for packet, event, artifact, stage, review, release, and desktop
  boundaries

## Promotion rules

The read-only SDK was promoted because:

- Studio and CLI are both real consumers of the same read surface
- the SDK can reuse runtime packet/config/workflow parsing without exposing file
  layout details to callers
- compatibility tests cover the stable SDK output shape
- package-structure tests prevent SDK reads from importing runtime-only mutation
  helpers

Promote controlled writes only after the read-only surface is stable and the
write path can prove it reuses the CLI/runtime validation and locking behavior.
