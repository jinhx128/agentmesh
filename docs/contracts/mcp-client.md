# MCP Client Contract

`schema_version`: 1

L3 turns MCP resources into real context inputs without adding AgentMesh MCP
server mode, daemons, remote state, or hidden memory.

## Resource Specs

`flow run` accepts repeated resource inputs:

```text
--mcp-resource <server-id>:<resource-uri>
```

Parsing rules:

- The first colon separates `server-id` and `resource-uri`.
- `server-id` must be non-empty and contain only letters, numbers, dot,
  underscore, or dash.
- `resource-uri` must be non-empty and must not have leading or trailing
  whitespace.
- Invalid specs fail before packet creation.

Examples:

```text
docs:file:///repo/README.md
notes:project/brief.md
```

## Server Config

Configured stdio MCP servers live in resolved AgentMesh config:

```toml
[mcp_servers.docs]
command = "docs-mcp-server"
args = ["--stdio"]
resource_hints = ["file:///repo/README.md"]
```

Validation rules:

- Server ids use the same character set as resource spec server ids: letters,
  numbers, dot, underscore, or dash.
- Server ids must not contain whitespace or colons.
- `command` is required and must be a non-empty string.
- `args` is optional; when present, it must be a list of strings.
- `resource_hints` is optional; when present, it must be a list of strings. These
  hints help inventory output and are not read unless separately passed through
  `--mcp-resource`.
- MCP server entries only support `command`, `args`, and `resource_hints`.
  AgentMesh config must not store tokens, secret-bearing env, session paths, or
  host login state for MCP servers.
- `--mcp-resource <server-id>:<resource-uri>` must reference a configured server
  id before packet creation.
- A single run may request at most 10 MCP resources.

## Management CLI

MCP config management commands operate on the user-level global registry:

```text
agentmesh mcp list [--json]
agentmesh mcp add <server-id> --command <command> [--arg <arg> ...] [--resource-hint <uri> ...]
agentmesh mcp remove <server-id>
```

Behavior:

- `mcp add` writes `~/.config/agentmesh/config.toml`.
- `mcp remove` deletes from `~/.config/agentmesh/config.toml`.
- Project config files must not contain `[mcp_servers.*]`; `mcp list --json`
  reports those as diagnostics.
- `mcp list` reads resolved config layers and reports `source_layer` and
  `source_path` for each server. It does not start MCP servers and does not call
  `resources/list`.
- `mcp list --json` returns top-level `diagnostics` for config-layer problems
  such as duplicate MCP server ids, while preserving the same no-resource-list
  behavior.

Management JSON output shape:

```json
{
  "schema_version": 1,
  "servers": [
    {
      "id": "docs",
      "source_layer": "user",
      "source_path": "~/.config/agentmesh/config.toml",
      "command": "docs-mcp-server",
      "args": ["--stdio"],
      "resource_hints": ["file:///repo/README.md"],
      "diagnostics": []
    }
  ],
  "diagnostics": []
}
```

`agentmesh doctor` also probes configured MCP servers. It reports duplicate
server ids, missing/unrunnable commands, start or initialize failures, and
`resources/list` failures as diagnostics.

## Stdio Lifecycle

The stdio client uses the official MCP TypeScript SDK `StdioClientTransport`.
The SDK owns MCP stdio protocol handling and JSON-RPC transport details.
AgentMesh owns the configured process lifecycle, timeouts, text extraction,
resource limits, and failure classification.

Minimum lifecycle:

1. Start the configured command with configured args.
2. Connect the SDK client through stdio transport, including MCP initialize.
3. Send `resources/read` with `{ "uri": "<resource-uri>" }`.
5. Extract the first text content item from `result.contents`.
6. Close the SDK client/transport and wait for child process cleanup.

L3.3 implements this lifecycle for one resource read. Multi-resource server
reuse is serial and keeps one process per server for that read batch. L3.7 uses
this lifecycle during `flow run` context capture.

## Connection Reuse

P3.5 adds an explicit per-invocation connection cache for runtime callers that
need to reuse one active stdio session across multiple MCP operations.

Runtime rules:

- Callers create a cache for the current operation and close it before returning.
- Cache keys include `command`, `args`, configured `env`, and the current working
  directory fingerprint.
- A cache hit reuses the existing SDK client / stdio transport and does not
  perform MCP initialize again.
- Bare `readMcpTextResource`, `readMcpTextResources`, and
  `listMcpResourceHints` calls without a cache keep the previous behavior:
  connect for that call and close before returning.
- `flow run` context capture uses a short-lived cache for the current CLI
  invocation and closes it after MCP context ingestion finishes.

Invalidation rules:

- Request failure, protocol error, timeout, server process exit observed through
  the SDK, and explicit cache close remove the session from cache.
- AgentMesh does not keep a daemon-level MCP connection pool. Reuse is limited
  to the current process / operation lifetime.

Timing:

- `onTiming` reports `mcp_connect_ms` and `cache_hit`.
- Cache misses report the measured initialize/connect duration.
- Cache hits report `mcp_connect_ms = 0` and `cache_hit = true`.
- `flow run` aggregates MCP cache hits and misses into `status.runtime_timing`
  as `mcp_cache_hits` and `mcp_cache_misses`.

## Limits

- `initialize` default timeout: 5 seconds.
- `resources/read` default timeout: 10 seconds.
- Single text resource limit: 256 KiB, measured as UTF-8 bytes.
- Oversized text resources fail; AgentMesh does not truncate them.
- Multiple resources from one server are read serially through one stdio process.
- Inventory shows at most 50 resource hints per server.

## Resource Inventory

`agentmesh mcp inventory [--json]` lists configured MCP servers from resolved
AgentMesh config and resource hints from two places:

- configured `mcp_servers.<id>.resource_hints`
- MCP `resources/list` results from the configured stdio server

Inventory performs `initialize`, `notifications/initialized`, and
`resources/list`. It must not call `resources/read`.

JSON output shape:

```json
{
  "schema_version": 1,
  "hint_limit": 50,
  "servers": [
    {
      "id": "docs",
      "source_layer": "user",
      "source_path": "~/.config/agentmesh/config.toml",
      "command": "docs-mcp-server",
      "args": ["--stdio"],
      "resource_hints": [
        { "uri": "file:///repo/README.md", "source": "config" },
        { "uri": "memory://listed-1", "name": "Listed 1", "source": "listed" }
      ],
      "list_error": null
    }
  ]
}
```

If `resources/list` fails, inventory still returns the configured server and
configured hints, with `list_error` set to MCP failure classification text.

## Context Capture

During `flow run`, valid `--mcp-resource <server-id>:<resource-uri>` inputs are
read before `context.md` is written.

Success behavior:

- `source_type = "mcp_resource"`
- `source = "<server-id>:<resource-uri>"`
- `source_uri = "<returned-or-requested-resource-uri>"`
- `validation_state = "ok"`
- `ingestion_error = null`
- content is the captured text resource

Failure behavior:

- packet creation still succeeds
- `validation_state = "failed"`
- `ingestion_error` uses MCP failure classification text
- content is a visible unavailable marker

## Failure Classification

MCP failures are surfaced as transferable classifications so failed captures can
be written into context provenance `ingestion_error` as:

```text
<classification>: <message>
```

Classifications:

- `server_start_failed`: configured stdio command cannot be started or written
  to during startup.
- `initialize_failed`: `initialize` returns JSON-RPC error or the server closes
  before initialize completes.
- `resource_not_found`: `resources/read` returns a not-found JSON-RPC error.
- `non_text_resource`: `resources/read` succeeds but does not return a text
  content item.
- `resource_too_large`: returned text exceeds the configured byte limit.
- `timeout`: initialize or resource read timeout.
- `invalid_json_rpc`: SDK transport parse failure or invalid JSON-RPC response.
- `unknown`: any MCP client failure that does not fit the categories above.

## Current Behavior

L3.1-L3.2 validate resource spec shape and server references. L3.3-L3.7 provide
the stdio client, bounds, failure classifications, inventory, and context
capture. Valid resources now attempt a real read; failed reads remain visible in
`context.md`. P3.5 adds explicit per-invocation connection reuse for callers
that pass a cache, while preserving per-call connect/close behavior when no
cache is provided.
