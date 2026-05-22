# Corrections Contract

`schema_version`: 1

L7 introduces explicit project corrections. A correction is a small,
reviewable fact that captures something a user or reviewer has corrected and
that future agents should be able to inspect without relying on private chat
memory.

## Canonical Layout

Correction records live under:

- `.agentmesh/corrections/<id>.toml`

The store is project-local because corrections describe how this checkout is
being worked on, not the user's machine-wide defaults. `agentmesh init` keeps
`.agentmesh/` in `.gitignore`, so correction files are local by default and are
not meant to enter normal project commits.

## File Responsibility

A correction record should contain one durable correction. It should be narrow
enough to cite in `context.md`, list in CLI output, and supersede later without
rewriting unrelated corrections.

## Field Schema

Each correction uses the core `CorrectionRecordSchema`:

- `schema_version`: must be `1`.
- `id`: stable correction id and filename stem.
- `scope`: project scope the correction applies to, such as `runtime`,
  `docs`, `packages/runtime/src/context`, or `release`.
- `statement`: the corrected fact or durable instruction.
- `source`: where the correction came from, such as `manual`, `review`,
  `packet:<run_id>`, or another explicit source label.
- `created_at`: timestamp or date string for record creation.
- `supersedes`: array of older correction ids this record replaces.
- `status`: `active` or `superseded`.
- `owner`: accountable person, team, or `unknown`.

Minimal example:

```toml
schema_version = 1
id = "correction-20260514-001"
scope = "packages/runtime/src/context"
statement = "Project facts enter packets only through explicit include flags."
source = "manual"
created_at = "2026-05-14T00:00:00.000Z"
supersedes = []
status = "active"
owner = "AgentMesh maintainers"
```

## Status Semantics

`active` records are eligible for context inclusion once L7 context support is
enabled. `superseded` records remain readable for audit and CLI inspection but
must not be preferred for new context packs when an active replacement exists.

When a newer correction replaces an older one, the new record lists the older
ids in `supersedes`, and the older records keep their files with
`status = "superseded"`.

## Context Boundary

Corrections are explicit project facts, not inferred memories. They enter
packets through the L7 correction context policy. Active corrections are included
in new flow run context packs by default. Context entries cite the correction id
as `source`, the file path as `source_path`, and
`source_type = "project_correction"`.

Use repeated `--exclude-correction <id>` flags on `run` / `flow run` to keep a
specific active correction out of one packet. Invalid correction ids fail before
the packet is created. Superseded corrections do not enter normal context packs.

## Add Command

`agentmesh correction add` creates one active record in the project-local store.
The command writes `.agentmesh/corrections/<id>.toml`, refuses to overwrite an
existing id, and rejects empty or missing `scope` and `statement` values.

```text
agentmesh correction add --scope <scope> --statement <text> \
  [--id <id>] [--source <source>] [--owner <owner>] [--json]
```

When `--id` is omitted, the CLI generates a timestamp-based id. Generated
records default to `source = "manual"`, `owner = "unknown"`,
`status = "active"`, and `supersedes = []`.

## List Command

`agentmesh correction list` reads the project-local store and prints correction
records in stable filename order. It supports human output by default and JSON
output for automation.

```text
agentmesh correction list [--status <active|superseded>] [--scope <scope>] [--json]
```

`--status` filters by correction lifecycle state. `--scope` filters by exact
scope. Missing stores are valid and return an empty list.

## Supersede Command

`agentmesh correction supersede` keeps the old record readable and creates a new
active replacement. The replacement lists the old id in `supersedes`; the old
file keeps its statement and changes only its lifecycle status to `superseded`.

```text
agentmesh correction supersede <correction-id> --statement <text> \
  [--scope <scope>] [--id <replacement-id>] [--source <source>] \
  [--owner <owner>] [--json]
```

When `--scope` is omitted, the replacement inherits the old record's scope. When
`--owner` is omitted, it inherits the old record's owner. Superseded records
remain visible through `correction list --status superseded`; active-only
consumers must prefer `status = "active"` records.

## Non-Goals

- No invisible memory.
- No automatic correction inference.
- No remote synchronization.
- No whole-file rewrite of unrelated user-editable TOML.
