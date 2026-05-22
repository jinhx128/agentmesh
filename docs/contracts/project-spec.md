# Project Spec Contract

`schema_version`: 1

L6 introduces a minimal project fact layer. The goal is to give agents a small,
reviewable set of project facts that can enter `context.md` with provenance. It
is not a generated architecture encyclopedia and it does not replace README,
workflow artifacts, or run packets.

## Canonical Layout

The only L6 v1 file is:

- `.agentmesh/spec/project.toml`

The path is project-local to the current checkout. `agentmesh init` keeps
`.agentmesh/` in `.gitignore`, so this file is local by default and is not meant
to enter normal project commits. Agents and CLIs must not scan the whole
repository to infer project facts; they read this explicit file only when the
user or workflow asks for project facts.

## Deferred Layout

These paths are intentionally not part of L6 v1:

- `.agentmesh/spec/modules/*.toml`
- `.agentmesh/spec/commands.toml`
- `.agentmesh/spec/risks.md`

They remain reserved for later slices only after a second real need appears.
Before that, adding them would create maintenance surface without a proven
consumer.

## File Responsibility

`.agentmesh/spec/project.toml` should contain durable facts a future agent would
need before touching the project:

- project identity
- key commands
- constraints
- known risks
- freshness metadata
- owner metadata
- validation metadata

## Field Schema

`.agentmesh/spec/project.toml` uses the core `ProjectSpecSchema`:

- `schema_version`: must be `1`.
- `[project]`
  - `id`: stable project id.
  - `name`: optional display name.
  - `description`: optional short description.
- `[[key_commands]]`
  - `id`: stable command id.
  - `command`: command line to run from the project unless `cwd` says otherwise.
  - `description`: optional human explanation.
  - `cwd`: optional project-relative working directory.
- `constraints`: array of constraint records.
  - `id`: stable constraint id.
  - `statement`: durable project constraint.
  - `scope`: optional scope such as `runtime`, `docs`, or `release`.
  - `owner`: optional owner for follow-up.
- `risks`: array of known risk records.
  - `id`: stable risk id.
  - `statement`: durable risk statement.
  - `status`: `active`, `accepted`, or `mitigated`.
  - `mitigation`: optional mitigation note.
  - `owner`: optional owner for follow-up.
- `[freshness]`
  - `updated_at`: timestamp or date string for the facts.
  - `freshness`: `fresh`, `stale`, or `unknown`.
  - `max_age_days`: optional positive integer.
- `[owner]`
  - `owner`: accountable person, team, or `unknown`.
  - `contact`: optional contact or file pointer.
- `[validation]`
  - `validation_state`: `ok`, `failed`, or `skipped`.
  - `checked_at`: optional timestamp or date string.
  - `command`: optional validation command.
  - `message`: optional validation summary.

`key_commands` must contain at least one entry. `constraints` and `risks` are
required arrays, but they may be empty when the project has no maintained item in
that category.

Minimal example:

```toml
schema_version = 1
constraints = []
risks = []

[project]
id = "agentmesh"
name = "AgentMesh"
description = "Local-first AI coding workflow CLI."

[[key_commands]]
id = "test"
command = "npm test"
description = "Build and run Node tests."

[freshness]
updated_at = "2026-05-14"
freshness = "fresh"
max_age_days = 30

[owner]
owner = "AgentMesh maintainers"
contact = "README.md"

[validation]
validation_state = "ok"
checked_at = "2026-05-14"
command = "npm test"
message = "141 passed"
```

## Context Boundary

Project facts enter packets only through explicit context inclusion, such as the
`flow run --include-spec` flag. If the file is stale, malformed,
missing, or skipped, the resulting `context.md` entry must make that state
visible through the normal context provenance fields.

## Spec Check

`agentmesh spec check` validates `.agentmesh/spec/project.toml` by default. It
may also check a one-off path with `--path <path>`.

The command fails with actionable diagnostics for:

- `missing_spec`
- `malformed_spec`
- `missing_required_field`
- `stale_spec`
- `validation_failed`

Use `--json` when another tool needs the report. Human output is intentionally
short and diagnostic-first.

## Non-Goals

- No generated large docs.
- No automatic repository indexing.
- No hidden memory.
- No secret storage.
- No default `modules/*.toml`, `commands.toml`, or `risks.md` files.
