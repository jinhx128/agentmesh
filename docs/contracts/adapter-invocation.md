# Adapter Invocation Contract

`schema_version`: 1

This contract documents the P0 adapter invocation shapes exported by
`packages/core`. L4 starts from these schemas before introducing a runtime
adapter registry.

## Current Runtime Alignment

Current write-side runtime invokes adapters in process from resolved
`AgentConfig` and does not yet persist separate adapter invocation input/output
files inside run packets.

Observed runtime facts:

- Agents resolve by id only. Names/labels are display-only and are not accepted
  as invocation identifiers.
- `adapter`, `command`, `args`, `model`, `reasoning_effort`, prompt passing, and
  output file options are read from layered config.
- Built-in adapter command preparation is centralized in
  `packages/runtime/src/adapters/invocation.ts`.
- Generic `command` adapters receive prompt files by path only when
  `prompt_file_arg` is explicitly configured. Otherwise prompt file content is
  normalized to prompt text and sent through `prompt_arg` or stdin.
- Dispatch writes stage artifacts and events, but not standalone adapter
  invocation records yet.

No schema mismatch is required for L4.1. The P0 schemas remain the target shape
for L4 registry work.

## Runtime Adapter Registry

L4.2 introduces `packages/runtime/src/adapters/registry.ts` as the runtime
metadata boundary for built-in adapters.

Registry responsibilities:

- lookup by canonical adapter id
- normalize public aliases such as `codex`, `claude`, `antigravity`, and `opencode`
- fail fast for unsupported adapters
- expose command defaults, args, label, description, and capability metadata

Current built-in ids:

- `command`
- `codex-cli`
- `claude-code-cli`
- `antigravity-cli`
- `opencode-cli`

As of L4.3, the legacy `packages/runtime/src/adapters.ts` surface is backed by
this registry for adapter listing, default registration metadata, alias
normalization, and AI CLI detection.

## Invocation Preparation

As of L4.4, `packages/runtime/src/adapters/invocation.ts` is the write-side
runtime boundary for preparing adapter invocations. It returns a prepared
command, optional stdin payload, output-file capture mode, canonical adapter id,
and non-interactive support state.

Covered preparation behavior:

- `command` prompt passing by explicit `prompt_file_arg`, `prompt_arg`, or
  stdin; unconfigured prompt input defaults to stdin text rather than a
  positional prompt file path
- AI CLI prompt passing for `codex-cli`, `claude-code-cli`, `antigravity-cli`, and
  `opencode-cli`
- model and reasoning args per built-in AI CLI when the target CLI exposes
  supported flags; `antigravity-cli` uses the current Antigravity CLI model and
  stores `model = "current"` because current `agy` print mode does not expose a
  model flag
- stdout capture when no `output_file_arg` is configured
- explicit output-file args for any adapter when configured
- process environment construction for `agentmesh call` and doctor probes
- registry-derived non-interactive support metadata

`packages/runtime/src/adapters.ts` still owns direct process spawn for
`agentmesh call`. As of L4.5, doctor readiness uses the same resolved agent
normalization and adapter invocation preparation helper for auth probes.

## Async Invocation

P3.6 adds `runAgentCallAsync` as the async runtime surface for future fanout and
concurrent dispatch work. The existing synchronous `runAgentCall` remains in
place for current non-fanout CLI paths.

Async invocation behavior:

- Uses `child_process.spawn()`.
- Preserves command preparation semantics for prompt file args, prompt args,
  stdin prompt text, and explicit output file args.
- Captures stdout and stderr in the result for fanout event/log recording.
- Also writes stdout to `outputFile` when the prepared invocation requests
  stdout capture.
- Returns non-zero process exits as `exitCode` in the result, matching the
  synchronous call surface.
- Rejects with `AgentCallError` for spawn failures, timeout, and captured output
  write failures.
- Records `config_load_ms`, `adapter_spawn_ms`, `agent_total_ms`, and
  `total_ms`.
- Records `first_output_ms` when stdout or stderr observes output from the
  child process; synchronous invocation continues to omit this field.

## Process Environment

Every worker subprocess launched through AgentMesh inherits the host process
environment after dropping undefined entries. Agent-specific `env =
["KEY=value"]` entries are parsed during adapter invocation preparation and
override inherited values. Keys must be shell-compatible identifiers.

On macOS, AgentMesh also reads `scutil --proxy` once per process and maps the
system HTTP, HTTPS, SOCKS, and exception settings into standard proxy
environment variables when those variables are not already present. Uppercase
and lowercase proxy aliases are mirrored so CLIs that expect either spelling see
the same value. Agent-specific entries can intentionally clear an inherited
proxy by setting the value to an empty string.

## Invocation Input

Adapter invocation input is machine-readable JSON:

```json
{
  "schema_version": 1,
  "adapter_id": "codex-cli",
  "stage": "execute",
  "role": "worker",
  "packet_dir": "/repo/.agentmesh/runs/run-1",
  "prompt_file": "invoke-execute.prompt.md",
  "output_file": "execute-codex.out",
  "non_interactive": true,
  "env": {
    "AGENTMESH_RUN_ID": "run-1"
  },
  "capabilities": {
    "roles": ["worker"],
    "stages": ["execute"],
    "supports_non_interactive": true
  }
}
```

Required fields:

- `schema_version`
- `adapter_id`
- `stage`
- `role`
- `packet_dir`
- `prompt_file`
- `output_file`

Optional fields:

- `non_interactive`
- `env`
- `capabilities`

## Invocation Output

Adapter invocation output is machine-readable JSON:

```json
{
  "schema_version": 1,
  "status": "failed",
  "exit_code": 1,
  "output_file": "execute-codex.out",
  "duration_ms": 124,
  "failure": {
    "classification": "auth_required",
    "message": "login required",
    "retryable": false
  }
}
```

Statuses:

- `completed`
- `failed`
- `skipped`
- `needs_decision`

Failure classifications:

- `unknown`
- `command_not_found`
- `auth_required`
- `timeout`
- `non_interactive_unsupported`
- `invalid_output`
- `cancelled`
- `rate_limited`
- `permission_denied`
- `configuration_error`

## L4 Boundaries

L4 may refactor runtime adapter lookup, metadata, prompt preparation, and doctor
readiness to use this contract. L4 should not create `packages/adapters` unless
there is a second real consumer or third-party adapter fixture.
