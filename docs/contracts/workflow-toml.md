# workflow.toml Contract

`schema_version`: 1

Workflow TOML defines the team protocol for a run.

## Minimal Shape

```toml
schema_version = 1
workflow_recipe_version = 1
compatible_packet_schema_versions = [1]
name = "Bug Fix"
stages = ["plan", "execute", "review", "decide"]
description = "Fix a bug through plan, execute, review, and decide."
when_to_use = ["A defect needs a tracked fix."]
packet_artifacts = ["request.md", "plan.md", "handoff.md", "findings.md", "decision.md"]
quality_gates = ["The final decision records accepted and rejected findings."]
```

## Stage Rules

- Workflow TOML does not contain a user-authored `id`.
- Registry creates use internally generated ids such as `w-1ab330ed`; built-in
  workflows use fixed internal ids from the runtime catalog.
- User and project registry readers derive the workflow id from the registry
  filename. `--workflow-file <path>` derives a temporary id from that filename
  for one run only.
- `schema_version` is the TOML file shape version.
- `workflow_recipe_version` is the workflow recipe semantics version.
- `compatible_packet_schema_versions` must be exactly `[1]`, matching the
  current packet schema constant. Mixed legacy/current compatibility lists are
  rejected because legacy packet formats have no supported migration path.
- `stages` is required and must contain 1 to 15 stage nodes.
- Allowed stage types are `plan`, `execute`, `verify`, `review`, and `decide`.
- All stage types may repeat. `decide` must not be the first stage and must not
  immediately follow another `decide`.
- Stage type strings must not include occurrence suffixes such as `_2`; the
  runtime derives node ids like `execute_2` when a type repeats.
- `description`, `when_to_use`, `packet_artifacts`, and `quality_gates` are
  required. The list fields must be non-empty lists of strings.
- Built-in, user-global, project-local, and temporary workflow files use the same
  TOML model.
- A user-global or project-local workflow must not silently shadow an existing
  workflow id.
- `--workflow-file <path>` loads a temporary workflow for one run only; it does
  not enter the workflow registry.
- Temporary workflow packets must record `source`, normalized absolute `path`,
  content `hash`, workflow `schema_version`, `workflow_recipe_version`, and
  `compatible_packet_schema_versions` in `status.json`.
- `--workflow <id>` and `--workflow-file <path>` are mutually exclusive.
- Stage names are protocol data and must be represented in packet `status.json`.
- Run creation writes immutable `status.stage_nodes` from the workflow stage
  sequence. Later runtime operations must use those node ids for dispatch,
  retry, resume, state, assignments, and artifacts.
- `packet_artifacts` must cover each stage type's canonical first artifact:
  `plan.md`, `handoff.md`, `verification.md`, `findings.md`, and
  `decision.md` as applicable. Repeated occurrence files such as
  `decision_2.md` are runtime-derived and do not need to be hand-written in
  every workflow recipe.
- Built-in workflows may expose a repository recipe source such as
  `docs/workflows/review-gate.toml`. That source is an alignment artifact for
  CLI output, AgentMesh Skill guidance, and external/private review skills; it
  does not require users to migrate private skills into this repository.

## Direct Run Inputs

Direct workflow runs must name the workflow explicitly:

```bash
agentmesh run --workflow w-1ab330ed --task "ship it"
agentmesh flow run --workflow-file ./one-off.toml --task-file ./request.md
```

Bare `agentmesh run <id>` resolves only presets. If `<id>` is a workflow id, the
CLI must fail with guidance to use `--workflow <id>` or `flow run --workflow
<id>`.

`--task` and `--task-file` are mutually exclusive for both direct workflow runs
and preset runs. `--task` carries inline request text. `--task-file` reads the
request text from a file before packet creation. Exactly one request source is
required; missing input prints usage and must not create a packet directory.

Context inputs such as `--context-file`, `--diff-file`, `--verification-file`,
`--scope`, `--mcp-resource`, `--include-spec`, and `--exclude-correction` are
additional evidence sources. They do not replace the request source.

## Top-Level Fields

Workflow TOML uses an allowlist. Unknown top-level fields fail fast.

Allowed fields:

- `schema_version`
- `workflow_recipe_version`
- `compatible_packet_schema_versions`
- `name`
- `stages`
- `description`
- `when_to_use`
- `packet_artifacts`
- `quality_gates`
- `user_gate`
- `recipe_source`
- `failure_policy`

## Failure Policy

Workflow policy expresses flow semantics, not local machine routing. It may
declare whether a node can use fallback, but it must not name concrete fallback
agents.

```toml
[failure_policy.stage_types.verify]
mode = "required"
max_fallback_agents = 2

[failure_policy.nodes.decide]
mode = "terminal"
```

Rules:

- `failure_policy.stage_types.<type>` targets a stage type.
- `failure_policy.nodes.<node-id>` targets a derived runtime node id such as
  `verify_2` or `decide_2`.
- `mode` is `allow`, `required`, or `terminal`.
- `allow` is the system default: fallback is allowed when a route resolves.
- `required` means run creation fails unless at least one fallback candidate can
  resolve for the node.
- `terminal` means no fallback is resolved or attempted.
- `max_fallback_agents` defaults to `1`, has a maximum of `3`, and is invalid
  when `mode = "terminal"`.
- Unknown stage types or node ids fail workflow validation. Errors for unknown
  node ids should list the valid node ids derived from `stages`.
- Built-in workflows must not use `mode = "required"` because their validity
  cannot depend on one user's local fallback config.

## Version Policy

Workflow readers accept `schema_version = 1` and `workflow_recipe_version = 1`.
`compatible_packet_schema_versions` must be exactly `[1]`. Newer unknown
versions or recipes that do not target current packet schema fail with a clear
diagnostic before a workflow can be used.

Workflow run creation repeats the same compatibility gate before writing packet
files. This protects runtime callers that bypass the CLI registry parser and
prevents partially-created run directories for incompatible workflow metadata.

Legacy packet migration is unsupported in this generation. A workflow that tries
to target mixed legacy/current packet formats is rejected instead of being auto-upgraded.

## Non-Goals

- Workflow TOML does not bind local agent ids except through optional failure
  policy semantics. Concrete primary agents belong to CLI input, presets, or
  default stage agents.
- Workflow TOML does not define fallback agents, timeout values, adapter
  commands, or model preferences.
- Workflow TOML does not express DAG branching; `stages` remains a linear stage
  node sequence.
