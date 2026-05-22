# App Server Contract

`schema_version`: 1

The AgentMesh App Server is the packaged desktop bridge between
`AgentMesh.app` and the existing Studio UI/runtime protocol. It is a local UI
adapter and lifecycle boundary, not a second AgentMesh runtime.

## Responsibilities

The packaged App Server must:

- serve Studio UI assets from the app bundle
- expose packet-browser endpoints already shaped for Studio
- bind a dynamic 127.0.0.1 port for UI traffic
- require a per-launch token for every browser/UI request
- expose a health check endpoint for desktop host readiness
- support graceful shutdown so the desktop host can stop the server without
  leaving orphaned subprocesses
- start App-originated mutations through runtime APIs in the App Server process

The App Server may use stdio or a private socket for lifecycle/control-plane
messages, but the UI hot path should use the dynamic local HTTP endpoint so
large packet previews, event pages, logs, and future streams do not double-hop
through a desktop host process.

## Runtime Resolution

Runtime resolution depends on the caller:

- App-originated Studio actions use the app-bundled runtime APIs.
- App Server mutation must go through runtime APIs.
- Terminal usage resolves the PATH-visible agentmesh command.
- External entry-agent skill invocations also resolve the PATH-visible
  agentmesh command; they must not implicitly reach into `AgentMesh.app`.
- If the user explicitly installs the app command-line tool into PATH, entry
  agents may call that app-bundled CLI because it is then the PATH-visible
  agentmesh.

This keeps npm/global CLI installs and `AgentMesh.app` installs independent
while sharing packet/schema/protocol compatibility rules.

## Mutation Boundary

The App Server must not write packet files directly. It must not directly edit
`status.json`, `events.jsonl`, `artifacts.toml`, stage artifacts, review files,
verification artifacts, or release summaries. All packet mutations must go
through shared runtime mutation APIs.

Every App-originated mutation must reuse the same filesystem run-lock contract
as the CLI. The lock covers the target run directory before mutation code
touches packet state. An unknown lock schema must be treated as active and
blocking, not ignored or overwritten.

Required lock behavior:

- acquire the filesystem run-lock before packet mutation
- fail fast or surface a retryable busy state when another writer owns the lock
- return `423 Locked` with `error_code: "run_locked"`, `retryable: true`, and
  lock owner metadata for Studio UI actions
- return `409 Conflict` with `error_code: "workspace_read_only"` or
  `error_code: "workspace_refused"` and `retryable: false` when workspace
  compatibility metadata blocks a mutation
- treat expired locks according to the shared runtime lock contract
- release the lock on success and failure
- never bypass lock checks for desktop-only convenience paths

## Schema Skew

The App Server may read compatible older packet/config schemas. When it sees an
unsupported newer packet schema or unsupported newer config schema, it must fail
fast for mutations or degrade to read-only mode for inspection. It must not
overwrite files it cannot safely preserve.

Read-only mode may still list runs, read status, read events, and preview safe
artifacts when the parser can do so without rewriting. Any write action,
including retry, resume, attach, dispatch, release-summary refresh, config
updates, or migration, must be disabled until a compatible runtime is available.

## Security Boundary

The App Server is local-only. It must bind to loopback, use a dynamic
127.0.0.1 port, and require a per-launch token. It must not expose a general
filesystem API, a general command runner, or unauthenticated mutation endpoints.
Desktop launches deliver the token over the sidecar stdin handshake. Browser UI
requests authenticate with the native WebView `agentmesh_studio_token` cookie
(`HttpOnly; SameSite=Strict`) or explicit Bearer credentials in tests/tools;
URL query tokens are not accepted.

Developer and terminal Studio sessions may start the same HTTP server without
`authToken`; that mode is for local development/CLI Studio only and must not be
used as the packaged Desktop bootstrap contract.

Allowed mutation endpoints must map to explicit AgentMesh commands such as
dispatch, retry, resume, attach, and release-summary refresh. Future endpoints
must keep the same allowlist posture.

## Ownership

Shared AgentMesh data remains shared across app and CLI channels:

- user config
- project `.agentmesh/`
- packets
- run locks

App-only preferences belong in the platform app support directory unless the
terminal CLI intentionally needs to observe the setting. Shared config writers
should prefer narrow section ownership and validation over broad rewrites.
