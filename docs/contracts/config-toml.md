# config.toml Contract

`schema_version`: 1

`config.toml` is the local machine configuration. It may define agents, MCP
servers, context policy, review/release policy, run defaults, execution policy,
default primary agents, and fallback routing. Run creation resolves these values
into packet facts; dispatch never re-reads config to decide who should run.

## Agent Entries

```toml
[agents.codex]
adapter = "codex"
model = "gpt-5.5"
capabilities = ["plan", "execute", "verify", "review", "decide"]
reasoning_effort = "medium"
timeout_seconds = 900
```

Rules:

- Agent ids must be safe tokens and are the only durable reference keys for
  agents. Names/labels are display-only.
- `capabilities` must contain only stage types: `plan`, `execute`, `verify`,
  `review`, and `decide`.
- `reasoning_effort` must be one of `none`, `minimal`, `low`, `medium`, `high`,
  or `xhigh`.
- `timeout_seconds` is optional and must be `30-3600`. Missing values resolve to
  the system default `900`.
- `agents add` must prove adapter/model/command/auth readiness before writing.
  A probe timeout is separate from `agents.<id>.timeout_seconds`; the probe
  timeout default is `60` and its valid range is `5-300`.

## Default Primary Agents

Default primary agents fill missing stage assignments during run creation. They
are local machine preferences, not workflow semantics.

```toml
[default_stage_agents]
agents = ["codex"]

[default_stage_agents.stage_types]
execute = ["local-worker"]
review = ["claude", "antigravity"]
```

Resolution priority for direct workflow runs:

```text
CLI role flags
> global stage-type default
> global common default
> fail fast
```

Rules:

- Default primary agents must exist and have the target stage capability.
- Default primary agents are not workflow-level configuration.
- Global config does not support node-scoped defaults because node ids depend on
  the selected workflow.
- Every default primary agent list is limited to `MAX_FANOUT_AGENTS = 6`.
- `execute` must resolve to exactly one primary agent. If the common default has
  multiple agents and becomes the effective `execute` assignment, run creation
  fails instead of silently choosing the first agent.
- `current` is allowed only as a pure node assignment. It cannot be mixed with
  worker agents, and automatic dispatch must not invoke it.

Resolved defaults are written to `status.json.stage_assignments` and
`assignment.toml` as node-id keyed facts. `status.json.assignment_provenance`
records whether a node came from CLI role flags, global stage-type default, or
global common default.

## Fallback Routing

Fallback routing chooses replacement agents after a primary lane fails. It is
separate from `failure_policy`, which decides whether fallback is allowed.

```toml
[fallback]
agents = ["claude"]
max_attempts_per_agent = 1
timeout_seconds = 900

[fallback.stage_types.verify]
agents = ["antigravity", "local-verifier"]
inherit_common = true
max_attempts_per_agent = 2
timeout_seconds = 1200
```

Rules:

- Each configured fallback agent list is limited to `3` agents.
- `fallback.agents` is the common fallback list.
- `fallback.stage_types.<type>.agents` overrides or extends the common list for
  a stage type. `inherit_common` defaults to `true`.
- `inherit_common` is valid only under stage-type fallback tables, not at the
  top level.
- Global config does not support node-scoped fallback because node ids depend on
  the selected workflow.
- Fallback agents must exist, must not be `current`, and must have the target
  stage capability.
- During run creation, fallback routing is inherited, de-duplicated, filtered to
  remove the node's primary assigned agents, then truncated by
  `failure_policy.max_fallback_agents`.

Fallback execution settings:

| field | default | bounds | meaning |
| --- | --- | --- | --- |
| `max_attempts_per_agent` | `1` | `1-2` | Attempts for one fallback agent before moving to the next fallback agent. |
| `timeout_seconds` | `900` | `30-3600` | Timeout for one fallback attempt. |

Stage-type fallback execution settings override global fallback execution
settings for the same stage type. Preset fallback settings override global
fallback settings. CLI `--timeout-seconds`, when present, overrides primary,
fallback, and synthesis call timeouts for that run.

## Resolved Packet Facts

Run creation freezes the local resolution into:

- `stage_assignments`: node-id keyed primary assignments.
- `stage_invocations`: primary, current, and synthesis lanes with resolved
  timeout seconds.
- `stage_failure_policies`: node-id keyed effective failure policy.
- `stage_fallbacks`: node-id keyed fallback candidates and fallback execution
  settings.
- `assignment_provenance`, `fallback_provenance`, and `timeout_provenance`:
  source breadcrumbs for the resolved facts.

Dispatch, retry, resume, Studio, and SDK readers must use those packet fields as
the source of truth.

## Direct Run Boundaries

Global defaults and fallback config are inputs to packet creation only. Direct
workflow runs may use them to fill missing stage assignments, fallback routes,
and timeout values, but once `status.json` is written the current packet schema execution
facts are immutable unless a runtime mutation appends attempts or state.

Config does not define workflow stage order, preset identity, task/request
content, or concrete node ids. Node-scoped routing belongs in presets because
node ids are derived from the selected workflow.
