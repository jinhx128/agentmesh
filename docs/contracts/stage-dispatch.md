# Stage Dispatch Contract

`schema_version`: 1

Stage dispatch maps a resolved packet assignment to one or more adapter
invocations. The packet remains the source of truth; dispatch attempts only add
prompt snapshots, stage outputs, artifacts, events, and status updates.

Commands that take `--stage` target a runtime node id, not a stage type. For a
workflow with repeated stages, `--stage execute` targets the first execute node
and `--stage execute_2` targets the second execute node. `--stage all` iterates
`status.stage_nodes` in order and skips node ids already listed in
`completed_stages`.

Explicit dispatch, retry, resume, and attach from a node id require all
predecessor nodes to be completed. A later node cannot run or be attached while
an earlier node is planned, running, failed, or waiting for a host-owned
`current` attachment.

## Dispatch Modes

- `single`: the stage has exactly one assigned agent. The stage writes one
  canonical output for that stage.
- `fanout`: the stage has more than one assigned agent. Each agent receives an
  isolated prompt snapshot and writes to its own output slot. The stage is not
  considered completed until the controller can account for every assigned
  agent as completed, failed, skipped, or unavailable.

Automated worker dispatch must not invoke `current`. `current` is host-only and
is handled by `flow prompt` plus `flow attach`.

## Resolved Execution Inputs

Dispatch reads only packet facts. It must not consult current workflow, preset,
global config, or agent registry defaults to decide assignments, fallback, or
timeouts for an already-created run.

Required packet inputs:

- `stage_assignments`: node-id keyed primary assignment arrays.
- `stage_invocations`: node-id keyed primary/current/synthesis lanes.
- `stage_failure_policies`: node-id keyed failure policy.
- `stage_fallbacks`: node-id keyed fallback candidates and fallback execution
  settings.
- `stage_attempts`: append-only attempt records.
- `assignment_provenance`, `fallback_provenance`, and `timeout_provenance`:
  read-only breadcrumbs for humans and Studio.

These are current packet schema execution facts. If they are missing or invalid, dispatch
must fail against the packet instead of re-resolving config, workflow, preset,
or agent registry state.

Dispatch entry validation:

- Reject any node with more than `MAX_FANOUT_AGENTS = 6` assigned primary
  agents.
- Reject multi-agent `execute` with
  `stage '<node-id>' does not support multi-agent dispatch`.
- Reject mixed `current` and worker assignment.
- Reject automatic dispatch of a pure `current` node; the prompt/attach path
  owns it.
- Reject fallback candidates that are `current` or lack the target stage
  capability.

## Single Stage Outputs

Single-dispatch stages use the canonical files already defined in
`packet-layout.md`:

- `plan` -> `plan.md`
- `execute` -> `handoff.md`
- `verify` -> `verification.md`
- `review` -> `reviews/<reviewer>.md`, then controller-visible
  `findings.md`
- `decide` -> `decision.md`

Repeated node outputs append the occurrence suffix to the canonical base file:

- `plan_2` -> `plan_2.md`
- `execute_2` -> `handoff_2.md`
- `verify_2` -> `verification_2.md`
- `review_2` -> `reviews/review_2/<reviewer>.md`, then `findings_2.md`
- `decide_2` -> `decision_2.md`

Single prompt snapshots use `prompts/<node-id>.md` and artifact id
`prompt_<node-id>`.

## Fanout Output Slots

Fanout prompt snapshots must be per agent:

- `prompts/<node-id>/<agent>.md`
- artifact id `prompt_<node-id>_<agent>`
- artifact kind `prompt`

Review fanout output slots are canonical and implemented through the review
artifact model:

- first review: `reviews/<reviewer>.md`
- repeated review: `reviews/<node-id>/<reviewer>.md`
- artifact id `review_<reviewer>` for the first review
- artifact id `review_<node-id>_<reviewer>` for repeated reviews
- artifact kind `review-output`

Plan and decide fanout stages must not write multiple agents into the same
canonical stage artifact. They write per-agent outputs under
`outputs/<node-id>/<agent>.md`, record artifact ids as
`output_<node-id>_<agent>`, then run a synthesis controller to produce the
canonical artifact for that stage:

- `plan` -> `plan.md`
- `decide` -> `decision.md`, or `decision_2.md` / `decision_3.md` for
  repeated decide nodes

The first assigned agent is the synthesis controller. The controller receives a
separate synthesis prompt at `prompts/<node-id>/synthesis.md` with artifact id
`prompt_<node-id>_synthesis` and the collected fanout outputs, including its own
candidate output when it produced one. The synthesis prompt must preserve source
attribution for important trade-offs so the canonical artifact is not detached
from the fanout evidence. Future non-review fanout stages should follow the same
per-agent output plus canonical synthesis pattern before downstream stages can
consume the stage.

Multi-agent verify fanout writes per-agent outputs under
`outputs/<node-id>/<agent>.md`, records artifact ids as
`output_<node-id>_<agent>`, then AgentMesh writes the canonical
`verification.md` / `verification_<n>.md` aggregate. The aggregate lists each
verifier as completed, reused, or failed, and includes all available per-agent
evidence. Verify fanout does not run a synthesis controller and does not write
or update a release verdict.

`<agent>` and `<reviewer>` path/id slots are filesystem-safe ids derived from
the resolved agent id with the same normalization used by review artifacts.

## Per-Agent Events And Logs

Fanout dispatch records one event per agent invocation lifecycle:

- `stage.agent_started`
- `stage.agent_completed`
- `stage.agent_failed`
- `stage.agent_reused`

Each event includes `stage`, `node_id`, `stage_type`, `agent`, `path`,
`exit_code`, `timed_out`, and `duration_ms` when that value is known. For
repeated nodes, `stage` and `node_id` are the same runtime node id, such as
`verify_2`. `path` is the agent output slot, not a log file path. Reused
completed outputs report `exit_code = 0`, `timed_out = false`, and
`duration_ms = 0`.

When a fanout worker writes stdout or stderr, AgentMesh stores each stream in a
separate file:

- `logs/<node-id>/<agent>.stdout.log`
- `logs/<node-id>/<agent>.stderr.log`

The log files use the same filesystem-safe agent id normalization as fanout
output slots. Empty streams do not create log files.

## Visibility Policy

Default fanout visibility is isolated:

- Every agent receives the same packet evidence snapshot for the stage, adjusted
  only for its own agent id and adapter-specific budget.
- Agents do not see other agents' raw output during the same fanout stage.
- Review, verify, plan, and decide fanout prompt snapshots are all written
  before worker invocation starts, and the workers are then invoked
  up to `status.json.resolved_execution_policy.max_fanout_concurrency` when it
  is set. If the policy is absent, AgentMesh starts all pending fanout workers.
  Plan and decide still run a single synthesis controller after candidate
  workers settle.

A workflow may later opt into serial visibility only by making that policy
explicit in the workflow contract and prompt.

## Partial Failure

Fanout dispatch must preserve partial evidence:

- A successful agent output is recorded immediately and must not be removed when
  a later agent fails.
- A failed agent records `stage.agent_failed` with the agent id, output slot,
  exit code when available, timeout state, and duration when available. The
  aggregate stage then records `stage.failed`.
- The aggregate stage state remains failed or needs decision until every agent
  is accounted for.
- Release Check (`w-67ef1b1f`) and Review Gate (`w-9d94d0db`) deciders must see successful raw outputs,
  failed/unavailable agents, skipped checks, and residual risk together.

Partial failure is not a vote. A raw reviewer `Must Fix` blocks release only
after the controller records it as an accepted finding in `findings.md`.

## Failure Policy And Fallback

`failure_policy` is the gate; `stage_fallbacks` is the route.

- `mode = "terminal"`: mark the node failed and do not attempt fallback.
- `mode = "allow"`: attempt fallback only when candidates exist; otherwise mark
  the node failed.
- `mode = "required"`: packet creation already proved at least one candidate;
  dispatch still stops when the resolved fallback chain is exhausted.

Fallback replaces only the failed lane. Successful lanes in the same fanout
stage are reused and must not be rerun. Fallback attempts run sequentially and do
not increase fanout concurrency. `execute` fallback is also sequential and never
creates an execute fanout.

Each attempt appends a `stage_attempts.<node-id>[]` record with:

- `lane_id`
- `primary_agent`
- `requested_agent`
- `actual_agent`
- optional `fallback_from`
- monotonic `lane_attempt`
- per-agent `attempt`
- `timeout_seconds`
- `status`: `completed`, `failed`, or `timed_out`
- timing and error summary fields when known

Timeouts follow the same policy as other failures. `timed_out` under
`terminal` stops immediately; `timed_out` under `allow` or `required` may move
to the next allowed fallback candidate. A fallback agent with
`max_attempts_per_agent = 2` may receive two attempts before dispatch advances
to the next fallback candidate.

## Per-Agent Retry

Fanout retry must be able to target one agent without overwriting other agents'
completed outputs.

Required behavior:

- retry and reuse events include `stage` and `agent`
- completed agent outputs remain protected
- retrying a failed agent rewrites only that agent's prompt/output slot
- aggregate stage completion is recomputed after the retry

Stage-level retry may remain as a convenience, but for fanout stages it must
retry only agents that are not already completed unless an explicit force policy
is introduced. A fanout agent is treated as completed only when its expected
output file exists and the matching success artifact is already recorded in
`artifacts.toml`; failed agents may leave partial files, and those partial files
must not be reused as successful outputs.

## Decider Aggregation

The decider receives fanout evidence through packet artifacts, not private chat
state.

For review fanout:

- raw outputs stay in `reviews/<reviewer>.md`
- controller classifications stay in `findings.md`
- `findings.md` groups items as accepted, rejected, or needs decision
- contradictions must retain reviewer source attribution
- `decision.md` records the final decision, skipped checks, residual risk, and
  release verdict when applicable

For plan and decide fanout, the synthesis controller must synthesize the
canonical stage artifact from per-agent outputs before downstream stages can
treat the stage as complete. For `decide`, the canonical node artifact
(`decision.md`, `decision_2.md`, and so on) is the only decision artifact that
can update release verdict state, and release verdict updates are gated by
`isReleaseVerdictNode(status, node.id)`.

## Non-Goals

- Dispatch does not perform run creation resolution. It consumes current packet schema facts
  and appends attempts, events, prompt snapshots, and artifacts.
- Dispatch does not support multi-agent `execute`; fallback for `execute` is
  sequential lane replacement, not fanout.
- Dispatch does not migrate legacy packets or infer missing `stage_nodes`.
