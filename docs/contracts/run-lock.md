# Run Lock Contract

`schema_version`: 1

Run mutation uses a local single-writer lock so one AgentMesh process owns
packet writes for a run at a time.

## Lock File

The lock lives at `.agentmesh.lock/lease.json` inside a run directory. It is
not a packet artifact and should not be copied into handoff evidence.

```json
{
  "schema_version": 1,
  "lock_id": "lock-12345-1840000000000",
  "workspace": "/Users/example/project",
  "scope": "run:example-run",
  "entrypoint": "cli",
  "runtime_version": "0.1.0",
  "operation": "flow.dispatch:review",
  "operation_id": "lock-12345-1840000000000",
  "command": "flow.dispatch:review",
  "pid": 12345,
  "owner_id": "lock-12345-1840000000000",
  "created_at": "2026-05-14T06:00:00.000Z",
  "heartbeat_at": "2026-05-14T06:00:00.000Z",
  "expires_at": "2026-05-14T08:00:00.000Z"
}
```

## Protected Writes

The lock protects mutation paths that can write:

- `status.json`
- `events.jsonl`
- `artifacts.toml`
- stage output artifacts such as `plan.md`, `handoff.md`,
  `reviews/<reviewer>.md`, `findings.md`, and `decision.md`
- derived prompt and release-summary artifacts written during dispatch or
  explicit release summary refresh

## Lease Rules

- An active lease makes another mutation fail with a clear `run is locked`
  diagnostic that names the owning entrypoint, runtime version, operation,
  operation id, command, pid, heartbeat, expiry, and lock path.
- An expired lease may be reclaimed before acquiring a new lock.
- Missing or malformed lease metadata is treated as an active unknown lock,
  because deleting it automatically could corrupt an in-flight write.
- Old lease files remain readable. If an old lease lacks entrypoint, runtime,
  operation id, command, or heartbeat fields, diagnostics report those owner
  fields as `unknown`.
- Long-running async mutations refresh `heartbeat_at` while the runtime owns
  the lock.
- The sync lock helper releases after the mutation returns or throws.
- The async lock helper releases after the awaited mutation resolves or rejects.
- Crashed processes rely on lease expiry or manual cleanup.

## Current Mutation Surface

The current CLI/runtime lock covers:

- `flow attach`
- `flow dispatch`
- `flow retry`
- `flow resume`
- release-check prompt refresh through `flow prompt`
- `release-check summary --write`

Read-only commands such as `flow status`, `flow events`, and packet validation
do not take the mutation lock.
