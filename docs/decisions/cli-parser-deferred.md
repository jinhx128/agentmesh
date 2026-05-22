# CLI Parser Migration Decision

Date: 2026-05-14

Decision: deferred

## Context

The CLI command surface is currently hand-routed in `packages/cli/src/cli.ts`
with small option helpers in `packages/cli/src/flags.ts`. Command behavior is
already split into `packages/cli/src/commands/*.ts`, so the parser is not mixed
with runtime business logic.

L6 cleanup is about stale MCP docs, TOML parsing/writing, and packet validation
schema drift. Migrating the CLI parser at the same time would expand the blast
radius without solving those risks.

## Decision

Do not introduce `commander`, `oclif`, or another CLI parser during L6 cleanup.

Keep the current parser until command parsing itself becomes the active
maintenance problem. If migration starts later, prefer a small parser such as
`commander` over a framework-oriented tool such as `oclif`, unless third-party
plugin architecture becomes a near-term requirement.

## Rationale

The current parser is simple and local. It has known rough edges, but the code
already isolates most command behavior from parsing. Deferring avoids coupling a
mechanical CLI migration with protocol-sensitive work in packet validation,
workflow execution, and TOML handling.

This also keeps existing shell automation stable while AgentMesh is still
settling local packet and workflow contracts.

## Watch Conditions

Revisit this decision when at least one condition is true:

- `packages/cli/src/flags.ts` keeps gaining option-value special cases that
  create repeated bugs.
- Subcommand positional parsing breaks in more than one command family.
- Help/usage output becomes too large or inconsistent to maintain manually.
- Plugin-style external commands become a near-term product requirement.
- Studio or another UI needs a machine-readable command metadata model that is
  hard to derive from the current routing table.

## Non-Goals

- Do not migrate parser code as part of TOML cleanup.
- Do not use parser migration to change command semantics.
- Do not introduce `oclif` unless plugin architecture is a real requirement.
