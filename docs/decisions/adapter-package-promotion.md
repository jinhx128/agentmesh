# Adapter Package Promotion Decision

Date: 2026-05-14

Decision: deferred

## Context

L4 split adapter metadata, invocation preparation, doctor readiness, and
`current` host-only behavior into runtime adapter modules. The only real
consumer today is still the local runtime path:

- `agentmesh call`
- `flow dispatch`
- `doctor`
- runtime tests and contract docs

These are not separate package consumers. They are one runtime boundary inside
the same workspace.

## Decision

Do not create `packages/adapters` yet.

Adapter code remains internal under `packages/runtime/src/adapters/` until at
least one of these gates is true:

- a second real consumer needs to import adapter metadata or invocation behavior
  outside `packages/runtime`
- a third-party adapter fixture needs a stable public module boundary
- Studio, MCP server mode, or a cloud worker needs adapter behavior without
  depending on runtime internals

## Rationale

Promoting now would create a public package without a second caller to prove the
API shape. Keeping the code internal avoids premature versioning, avoids a split
between runtime behavior and public package behavior, and keeps L5/L6 free to
change adapter invocation details while the local protocol is still settling.

## Revisit Trigger

Revisit this decision before any work that adds:

- third-party adapter examples or fixtures
- in-process Studio imports of adapter behavior
- MCP server mode that exposes adapter metadata
- remote/cloud execution that needs adapter invocation outside local runtime
