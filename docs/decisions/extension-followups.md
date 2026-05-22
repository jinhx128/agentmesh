# Extension Follow-ups Decision

`schema_version`: 1

Date: 2026-05-16

Decision: deferred

## Context

P5.2 promoted the read-only SDK as the stable local read surface. P5.3 defined
the adapter plugin contract for adding new local agent adapters. MCP server mode
and a reusable UI package are still possible consumers, not current product
requirements.

## MCP Server

Do not create `packages/mcp-server` yet.

The read-only SDK is now stable enough to support an MCP server later, but a
real consumer has not yet required it. If MCP work starts, the first step is
`docs/contracts/mcp-readonly.md`.

The first MCP server contract must stay read-only:

- expose workflows, agents, runs, events, artifacts resources
- must not start runs
- must not dispatch, retry, resume, or attach stage output
- must not modify workflow or agent config
- must not write packet files
- must reuse `packages/sdk` for reads instead of parsing packet layout directly

## UI Package

Do not create `packages/ui` yet.

Studio and Desktop currently share the Studio app/server boundary rather than a
large duplicated component library. A UI package is justified only when Studio
and Desktop have repeated components with the same interaction contract and the
extraction does not change Studio information architecture.

If that trigger appears later, extract components only. Do not move business
protocols, SDK reads, mutation commands, packet parsing, or app-server logic
into `packages/ui`.

## Decision

Keep both follow-ups deferred and create no empty package. The next implementation
slice should use the existing SDK, Studio, Desktop, and runtime boundaries until
a real consumer proves that a new package boundary is needed.

## Revisit Triggers

Revisit MCP server when:

- a host or external tool needs AgentMesh state through MCP resources
- CLI JSON and Studio API are not enough for that consumer
- read-only resource naming and pagination are ready to be contracted

Revisit `packages/ui` when:

- Studio and Desktop contain duplicated components with the same state and
  interaction behavior
- extraction can be done without changing Studio navigation or information
  architecture
- the package can remain presentation-only
