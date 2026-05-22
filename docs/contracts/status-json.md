# status.json Contract

`schema_version`: 1

`status.json` is the latest machine-readable run state. It is optimized for
quick reads; `events.jsonl` remains the audit trail.

The current packet schema is the only supported newly written workflow packet schema.
Legacy packet status files are rejected by validation; there is no automatic legacy-to-current migration.

## Required Fields

```json
{
  "schema_version": 1,
  "run_id": "example",
  "created_at": "2026-05-15T09:00:00.000Z",
  "updated_at": "2026-05-15T09:03:00.000Z",
  "status": "running",
  "stage_assignments": {
    "plan": ["planner"],
    "execute": ["worker"],
    "review": ["reviewer"],
    "decide": ["decider"]
  },
  "stages": ["plan", "execute", "review", "decide"],
  "stage_nodes": [
    { "id": "plan", "type": "plan", "occurrence": 1 },
    { "id": "execute", "type": "execute", "occurrence": 1 },
    { "id": "review", "type": "review", "occurrence": 1 },
    { "id": "decide", "type": "decide", "occurrence": 1 }
  ],
  "stage_invocations": {
    "plan": [
      {
        "lane_id": "plan:planner",
        "kind": "primary",
        "agent": "planner",
        "timeout_seconds": 900
      }
    ],
    "execute": [
      {
        "lane_id": "execute:worker",
        "kind": "primary",
        "agent": "worker",
        "timeout_seconds": 900
      }
    ],
    "review": [
      {
        "lane_id": "review:reviewer",
        "kind": "primary",
        "agent": "reviewer",
        "timeout_seconds": 900
      }
    ],
    "decide": [
      {
        "lane_id": "decide:decider",
        "kind": "primary",
        "agent": "decider",
        "timeout_seconds": 900
      }
    ]
  },
  "stage_failure_policies": {
    "plan": { "mode": "allow", "max_fallback_agents": 1 },
    "execute": { "mode": "allow", "max_fallback_agents": 1 },
    "review": { "mode": "allow", "max_fallback_agents": 1 },
    "decide": { "mode": "allow", "max_fallback_agents": 1 }
  },
  "stage_fallbacks": {
    "plan": { "agents": [], "max_attempts_per_agent": 1 },
    "execute": { "agents": [], "max_attempts_per_agent": 1 },
    "review": { "agents": [], "max_attempts_per_agent": 1 },
    "decide": { "agents": [], "max_attempts_per_agent": 1 }
  },
  "stage_attempts": {
    "plan": [],
    "execute": [],
    "review": [],
    "decide": []
  },
  "assignment_provenance": {
    "plan": "run_input",
    "execute": "run_input",
    "review": "run_input",
    "decide": "run_input"
  },
  "fallback_provenance": {
    "plan": "none",
    "execute": "none",
    "review": "none",
    "decide": "none"
  },
  "timeout_provenance": {
    "plan": { "plan:planner": "system_default" },
    "execute": { "execute:worker": "system_default" },
    "review": { "review:reviewer": "system_default" },
    "decide": { "decide:decider": "system_default" }
  },
  "completed_stages": ["plan"],
  "stage_timing": {
    "plan": {
      "started_at": "2026-05-15T09:00:00.000Z",
      "completed_at": "2026-05-15T09:01:00.000Z",
      "duration_ms": 60000,
      "attempt_count": 1
    },
    "execute": {
      "started_at": "2026-05-15T09:02:00.000Z",
      "attempt_count": 1
    },
    "review": { "attempt_count": 0 },
    "decide": { "attempt_count": 0 }
  },
  "agent_timing": {
    "plan": {
      "planner": {
        "started_at": "2026-05-15T09:00:00.000Z",
        "completed_at": "2026-05-15T09:01:00.000Z",
        "duration_ms": 60000,
        "attempt_count": 1,
        "config_load_ms": 4,
        "adapter_spawn_ms": 58200,
        "agent_total_ms": 58300,
        "total_ms": 58300
      }
    },
    "execute": {
      "worker": {
        "started_at": "2026-05-15T09:02:00.000Z",
        "attempt_count": 1
      }
    }
  },
  "runtime_timing": {
    "config_load_ms": 7,
    "mcp_connect_ms": 42,
    "total_ms": 135
  },
  "user_gate": false,
  "workflow": "w-7db15660"
}
```

`stages` preserves the workflow recipe stage type sequence. Runtime identity
lives in `stage_nodes`; every mutable runtime field uses `stage_nodes[].id`.
For repeated workflows, later occurrences are suffixed deterministically, for
example `execute_2` and `review_2`.
`stage_nodes` must be the non-empty deterministic sequence derived
from `stages`; packet validation rejects empty, duplicate, or mismatched node
lists.

current packet schema does not write top-level `plan`, `execute`, `review`, or `decide`
role fields. `stage_assignments` is the resolved assignment map keyed only by
stage node id. Runtime dispatch reads that map as the execution fact source.
`review` fanout writes reviewer outputs and controller findings.
`plan` and `decide` fanout write per-agent outputs under
`outputs/<node-id>/<agent>.md`, then synthesize one canonical artifact for that
node. `verify` fanout writes per-agent verification evidence under
`outputs/<node-id>/<agent>.md`, then AgentMesh writes one canonical aggregate
verification artifact for that node. `execute` fanout execution is still
deferred.

`current` is a host-only assignment, not a configured agent id. It means the
current entrance agent owns that stage through `flow prompt` and `flow attach`.
`agentmesh call --agent current` and explicit worker dispatch for a `current`
stage fail with guidance. `flow dispatch --stage all` may stop at a `current`
stage and report `awaitingCurrent` without writing a worker artifact.

`created_at` is the run creation time. `updated_at` changes whenever runtime
state is mutated. `stage_timing` is required and must contain every runtime node
id with at least `attempt_count`; dispatch increments `attempt_count` when a
stage starts, and host-owned `flow attach` records a completed stage attempt.
`agent_timing` records per-agent invocation attempts under the node id. Timing
records may include `started_at`, `completed_at`, `failed_at`, `duration_ms`,
`exit_code`, and runtime timing fields when known.

`stage_invocations` freezes the resolved lanes for each node at run creation.
Each lane records its stable `lane_id`, `kind` (`primary`, `synthesis`, or
`current`), agent id, and timeout seconds. `current` lanes use `null` timeout
because the entrance agent is not spawned by AgentMesh. Spawned agent lanes must
resolve a timeout in the `30-3600` second range.

`stage_failure_policies` is the effective node-id keyed policy after workflow
and preset merge:

- `allow`: fallback may run when candidates exist.
- `required`: run creation must have resolved at least one fallback candidate.
- `terminal`: no fallback may run; the resolved policy must omit
  `max_fallback_agents`.

`stage_fallbacks` is the resolved node-id keyed route. Terminal and pure
`current` nodes store empty `agents` lists. Other nodes store fallback
candidates after inheritance, de-duplication, primary-agent filtering,
capability validation, and truncation by `max_fallback_agents`.
`max_attempts_per_agent` is `1-2`.

`stage_attempts` starts empty and is appended by dispatch/retry. Each attempt
records lane identity, primary/requested/actual agent, fallback source when
used, monotonic `lane_attempt`, per-agent `attempt`, `timeout_seconds`, and
`status`. Attempt `status` is one of `completed`, `failed`, or `timed_out`.

`assignment_provenance`, `fallback_provenance`, and `timeout_provenance` are
required for every node so dispatch, retry, resume, Studio, and SDK readers do
not need to re-resolve config later. Assignment provenance may record `cli`,
`workflow_defaults`, `preset_assignment`, `preset_stage_default`,
`preset_common_default`, `global_stage_default`, or `global_common_default`.
Fallback provenance may record `preset_fallback`, `global_fallback`, or `none`.
Timeout provenance is per lane and may record `cli`, `preset_fallback`,
`global_fallback`, `agent`, `system_default`, or `current`.

Runtime timing fields use integer milliseconds:

- `config_load_ms`: time spent loading AgentMesh config for the operation.
- `mcp_connect_ms`: MCP stdio server initialize/connect wall time. Multiple
  MCP servers may be summed at run creation time.
- `mcp_cache_hits`: number of MCP operations that reused an active cached
  session during run creation.
- `mcp_cache_misses`: number of MCP operations that opened a new MCP session
  during run creation.
- `adapter_spawn_ms`: synchronous adapter subprocess wall time for the current
  spawn path. Async spawn may later narrow this to process-start time.
- `first_output_ms`: time to first stdout/stderr data when an async spawn path
  can observe it; omitted for the current synchronous spawn path.
- `agent_total_ms`: total adapter invocation time for one agent, including
  config load, invocation preparation, spawn, and captured output write.
- `total_ms`: total wall time for the enclosing operation or invocation.

`runtime_timing` records run-level timings such as `flow run` config load,
MCP connect time from context ingestion, and run creation total time. Per-agent
adapter timings live under `agent_timing.<node-id>.<agent-id>`. Human CLI output
may stay terse; `flow status --json` exposes these fields directly.

Temporary workflow runs include provenance for the workflow file:

```json
{
  "workflow": "one-off-release",
  "workflow_source": {
    "source": "temporary",
    "path": "/abs/project/one-off-release.toml",
    "hash": "sha256:...",
    "schema_version": 1,
    "workflow_recipe_version": 1,
    "compatible_packet_schema_versions": [1]
  }
}
```

## Stage State Machine

Stage state values:

- `planned`
- `running`
- `completed`
- `failed`
- `skipped`
- `needs_decision`
- `handoff_ready`

Allowed progression for a normal stage:

```text
planned -> running -> completed
planned -> skipped
running -> failed
running -> needs_decision
failed -> running
needs_decision -> running
completed -> completed
```

`completed_stages`, `failed_stage`, `stage_state`, and `stage_assignments` use
node ids when `stage_nodes` exists. `failed_stage` is a scalar pointer to the
latest unresolved failed node. `events.jsonl` remains the historical source for
older failures.

`stage_nodes` is required for newly written current packet schema status files.
`completed_stages` and `failed_stage` must reference known node ids.

## Release Verdict

Release-check runs may include:

```json
{
  "release_verdict": {
    "value": "ready",
    "diagnostic": null
  }
}
```

Allowed verdict values are defined in `release-verdict.md`.

## Review/Release Policy

Runs with project review or release policy may include
`resolved_review_release_policy`. This is the machine-readable record of
policy source layers, required review profiles, concrete reviewer ids,
profile resolution warnings, required evidence, needs-decision risks, skipped
gates, and missing evidence.

## Execution Policy

Runs with config defaults or execution policy may include
`resolved_execution_policy` and `config_provenance`. The execution policy is the
machine-readable record of resolved run defaults, hard execution caps, user-gate
requirements, and auto-dispatch permissions. Config provenance records the
config layers and hashes used when the packet was created.

`resolved_execution_policy` is separate from per-lane invocation facts.
Dispatch policy caps may constrain creation-time timeout choices, but the
durable execution facts for a historical run are `stage_invocations`,
`stage_fallbacks`, `stage_attempts`, and `timeout_provenance`.
