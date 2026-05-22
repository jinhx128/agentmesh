# TOML Component Decision

Date: 2026-05-14

Decision: locked for L6 cleanup

## Context

AgentMesh uses TOML for human-authored and machine-generated files:

- user and project config
- workflow recipes
- project spec
- future correction records
- packet artifact manifests

The current runtime has several local TOML subset parsers and writers. This is
now a maintenance risk because each caller can drift on valid TOML syntax,
inline comments, arrays, and error wording.

## Decision

Use `smol-toml` as the shared TOML parser for L6.8 and the shared serializer
where serialization is safe in L6.9.

Keep `packages/runtime/src/toml.ts` as the AgentMesh TOML boundary. It should
become a thin wrapper around `smol-toml` plus AgentMesh-specific error mapping
and utility helpers. Callers should not import the third-party package directly.

## Write Policy

TOML files fall into two classes.

User-editable TOML:

- `~/.config/agentmesh/config.toml`
- `.agentmesh/config.toml`
- `~/.config/agentmesh/workflows/*.toml`
- `.agentmesh/spec/project.toml`
- future `.agentmesh/corrections/*.toml`

These files must not be rewritten through whole-file stringify if that would
drop comments, blank lines, ordering, or local formatting. Mutations must either
use the current append/surgical-write approach, write a brand-new file, or use a
future comment-preserving editor.

Machine-generated TOML:

- packet `artifacts.toml`
- generated snippets that are explicitly created by AgentMesh

These files may use a shared serializer because AgentMesh owns the full file
format and formatting stability.

## Rationale

`smol-toml` is small, fits the Node/TypeScript runtime, and is enough for the
TOML syntax AgentMesh needs today. Keeping it behind the local wrapper lets the
runtime preserve current CLI diagnostics and switch implementation later if a
comment-preserving writer becomes necessary.

This avoids two bad outcomes:

- keeping a growing hand-written subset parser that rejects valid TOML
- using stringify on human-edited files and silently destroying comments or
  formatting

## Alternatives Considered

`@iarna/toml` remains a plausible parser, but it does not change the core write
policy risk: whole-file stringify is still unsafe for user-edited files.

Leaving the local parser in place avoids a dependency, but keeps parser drift
across config, workflow, packet artifact, and project spec code.

## Revisit Trigger

Revisit this decision if AgentMesh needs any of the following:

- comment-preserving edits to existing user-authored TOML
- full TOML v1.0 compatibility beyond what `smol-toml` supports
- a public SDK API that must expose parser-specific error objects
- a second runtime that cannot use the same Node package
