# Execution Policy Contract

`schema_version`: 1

Execution policy separates soft run defaults from hard local/project safety
limits. Run creation freezes the resolved values into the packet so dispatch,
retry, resume, Studio, and later readers do not reinterpret historical runs from
the current config.

## Config Shape

```toml
[run_defaults]
dispatch_timeout_secs = 600
adapter_timeout_secs = 300
event_page_size = 100
retry_attempts = 1

[execution_policy]
max_fanout_concurrency = 2
max_dispatch_timeout_secs = 900
max_adapter_timeout_secs = 300
max_retry_attempts = 1
require_user_gate = true
allow_auto_dispatch = false
```

Fields:

- `[run_defaults]`
  - `dispatch_timeout_secs`: preferred dispatch operation timeout.
  - `adapter_timeout_secs`: preferred adapter invocation timeout.
  - `event_page_size`: preferred event page size for run readers.
  - `retry_attempts`: preferred retry count; may be zero.
- `[execution_policy]`
  - `max_fanout_concurrency`: maximum concurrent agent invocations allowed in
    one fanout stage.
  - `max_dispatch_timeout_secs`: hard upper bound for dispatch timeout.
  - `max_adapter_timeout_secs`: hard upper bound for adapter invocation timeout.
  - `max_retry_attempts`: hard upper bound for retries after the first attempt;
    may be zero.
  - `require_user_gate`: when any layer sets true, the run must be user-gated.
  - `allow_auto_dispatch`: when any layer sets false, dispatch/retry/resume must
    not invoke agents automatically.

## Merge Rules

Config layer order is user -> project -> explicit overlay.

- `run_defaults` are soft preferences; higher layers replace lower-layer values.
- `execution_policy` numeric limits use the stricter value; smaller wins.
- `require_user_gate` is true if any layer sets it true.
- `allow_auto_dispatch` is false if any layer sets it false.
- Defaults are clamped to policy caps when the resolved policy is written to the
  packet.

## Packet Fields

Runs with defaults or policy record `status.json.resolved_execution_policy`:

- `source_layers`
- `policy_hash`
- `dispatch_timeout_secs`
- `adapter_timeout_secs`
- `event_page_size`
- `retry_attempts`
- `max_fanout_concurrency`
- `max_dispatch_timeout_secs`
- `max_adapter_timeout_secs`
- `max_retry_attempts`
- `require_user_gate`
- `allow_auto_dispatch`

Runs with any config layer also record `status.json.config_provenance`:

- `schema_version`
- `resolved_at`
- `layers[]`: `source`, `path`, and `sha256`

## Runtime Behavior

Dispatch/retry/resume read `resolved_execution_policy` from packet status.

- `allow_auto_dispatch = false` rejects automatic agent dispatch.
- `max_adapter_timeout_secs` caps dispatch `--timeout-secs`.
- `max_fanout_concurrency` limits concurrent fanout worker invocations. Fanout
  stages with more assigned agents than the cap run pending agents in batches
  rather than rejecting the assignment.
- `max_retry_attempts` caps retries using packet `stage_timing` attempt counts.
- `require_user_gate = true` makes run creation require `--decide current` and
  records `user_gate = true`.

`resolved_execution_policy` is a run-level policy cap. It does not replace the
node-id keyed execution facts introduced by current packet schema. Creation-time resolution
must still write primary/current/synthesis lanes to `stage_invocations`,
fallback candidates to `stage_fallbacks`, attempts to `stage_attempts`, and
timeout source breadcrumbs to `timeout_provenance`. If a CLI timeout override is
accepted for a run, it must respect the relevant execution policy cap before it
is frozen into those per-lane fields.

Studio reads `resolved_execution_policy` through the packet browser summary and
shows a compact execution policy summary in the run detail overview.
