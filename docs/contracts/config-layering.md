# config-layering.md Contract

`schema_version`: 1

This document records the current config/workflow registry behavior and the
target layered model for L2. AgentMesh is still early, so L2 intentionally makes
clean design changes instead of preserving transitional behavior.

## Current Inventory

At the start of L2, config loading and workflow registry discovery were
single-file / project-local behaviors. The L2 implementation is moving these
items to layered behavior slice by slice; this inventory records what is true
after L2.13.

- `packages/runtime/src/config.ts`
  - `findConfigPath(explicitPath, cwd)` still returns the first existing config
    path for legacy single-path callers.
  - `loadConfig(configPath, cwd)` now merges user, project, and explicit overlay
    layers.
  - Current `findConfigPath` search order:
    1. explicit `--config <path>`
    2. `$AGENTMESH_CONFIG`
    3. `./.agentmesh/config.toml`
    4. `./agentmesh.toml`
    5. `~/.config/agentmesh/config.toml`
  - `configPathForAgentWrite(cwd)` writes agent registrations to user config.
    Project config is reserved for run policy and defaults, not resource
    registries.
  - `loadConfig` supports root `schema_version`, `[agents.<id>]`,
    `[mcp_servers.<id>]`, `[workflow_defaults.<workflow-id>]`, and
    `[context_policy]`, `[review_policy.<workflow-id>]`,
    `[release_policy.<workflow-id>]`, `[run_defaults]`,
    `[execution_policy]`, `[default_stage_agents]`, `[fallback]`,
    `[model_aliases.<alias>]`,
    `[capability_profiles.<profile-id>]`, and
    `[capability_profile_preferences.<profile-id>]`.
  - `loadConfigWithSources` exposes config layers plus agent/MCP/policy source
    metadata.
  - MCP server entries may include `resource_hints = ["<uri>", ...]`; these are
    inventory hints only and are not read as context unless passed through
    `--mcp-resource`.
  - `context_policy` is merged conservatively and recorded into new run packets
    as `status.json.resolved_context_policy` plus a `context.md` policy section.
- `packages/runtime/src/adapters.ts`
  - `appendAgentRegistration(configPath, input)` appends `[agents.<id>]` to the
    user config file.
  - `loadAgents(configPath)` reads agents from the merged config returned by
    `loadConfig`.
  - `resolveAgent` resolves by id only.
- `packages/runtime/src/doctor/readiness.ts`
  - `buildDoctorReport(configPath)` uses layered config loading.
  - Doctor reports config layers, agent source layers, and workflow registry
    diagnostics.
- `packages/runtime/src/workflow/registry.ts`
  - Built-in workflows are code constants.
  - User workflow TOML files are read from
    `~/.config/agentmesh/workflows/*.toml`.
  - `--workflow-file` can load a temporary workflow for one run without adding it
    to the registry.
  - Workflow source is currently `builtin`, `user`, or `temporary`.
- `packages/cli/src/cli.ts`
  - `--config <path>` is a global flag.
  - `init` defaults to `.agentmesh/config.toml` and adds `.agentmesh/` to the
    project `.gitignore`.
  - `agents add`, `workflows add`, `preset add`, and `mcp add` write user-level
    global resource registries.
  - `run` / `flow run` resolves `--workflow <id>` through `getWorkflow`.
  - `run` / `flow run` applies `[workflow_defaults.<workflow-id>]` from layered
    config before checking required role flags.
  - `agents add` resolves adapter-discovered models first, then user model
    aliases when discovery cannot resolve the requested model string.
  - `run` / `flow run` resolves `--workflow-file <path>` as a temporary
    workflow selector that does not enter the registry.
  - Repeated role flags produce resolved assignment arrays for every supported
    stage. `plan`, `review`, and `decide` fanout dispatch are supported;
    `execute` fanout dispatch is still deferred.
- Packet files
  - `status.json` records `workflow`, `stages`, and resolved stage assignments.
  - Temporary workflow runs record `workflow_source.source`, normalized path,
    content hash, and schema version.
  - It does not yet record config source layer, config hash, or resolved assignment
    provenance.

## Target Layer Model

L2 introduces a layered local model while keeping packet files as the durable
source of truth for each run.

Config layers:

1. Built-in defaults
   - Built-in adapter metadata.
   - Built-in workflow ids and schema defaults.
   - No user secrets or project facts.
2. User config: `~/.config/agentmesh/config.toml`
   - Machine/user agent registry.
   - Adapter command/path/default args.
   - Agent ids, names, capabilities, model, and reasoning effort.
   - Host install preferences.
   - Must not store tokens, sessions, or login state.
3. User workflow registry: `~/.config/agentmesh/workflows/*.toml`
   - Personal reusable workflows shared across projects.
   - Must not store project paths, project secrets, or project-only facts.
4. Checkout-local project config: `./.agentmesh/config.toml`
   - Workflow defaults.
   - Basic context policy location.
   - Future project spec/corrections references.
   - Local to this checkout by default; `agentmesh init` keeps `.agentmesh/`
     ignored so teammates can maintain their own configuration.
5. Explicit config overlay: `--config <path>` or `$AGENTMESH_CONFIG`
   - Highest-precedence config overlay for CI, experiments, or temporary runs.
   - Does not replace lower layers wholesale; user agents must remain visible unless
     the overlay explicitly creates a conflict.
6. Temporary workflow selector: `--workflow-file <path>`
   - Bypasses the workflow registry.
   - Mutually exclusive with `--workflow <id>`.
   - Applies only to the current run.
   - Must schema-validate before packet creation.
   - Packet records normalized path, content hash, schema version, and source.

## Merge Rules

Config merge rules:

- Layer order is built-in defaults -> user -> project -> explicit overlay.
- Agents are normally defined in user config.
- Checkout-local project config references agents by bare agent id strings in workflow defaults.
- Checkout-local project config must not redefine a user agent id; duplicate ids
  fail fast.
- Explicit overlay can add temporary agents or settings but must fail fast on
  ambiguous conflicts.
- Duplicate `agents` and `mcp_servers` ids across config layers fail fast.
- `mcp_servers.<id>.resource_hints`, when present, must be a list of strings.
- `[context_policy]` arrays (`required_sources`, `denied_paths`,
  `redact_patterns`) are unioned in layer order.
- `[context_policy]` numeric limits (`max_bytes`, `max_files`,
  `freshness_max_age_seconds`) take the stricter, smaller positive integer.
- `denied_paths` cannot be removed by higher layers and block matching required
  or explicit file-backed context before packet creation.
- `[review_policy.<workflow-id>]` is project-scoped; user config cannot define
  review policy.
- `[review_policy.<workflow-id>].required_review_profiles` is unioned in layer
  order and resolves to concrete reviewer agent ids at run creation.
- `[release_policy.<workflow-id>]` is project-scoped; user config cannot define
  release policy.
- `[release_policy.<workflow-id>]` arrays (`required_evidence`,
  `needs_decision_risks`) are unioned in layer order.
- `[run_defaults]` values are soft preferences; higher layers replace
  lower-layer values.
- `[execution_policy]` numeric limits use the stricter, smaller value.
- `[execution_policy].require_user_gate` is true if any layer sets true.
- `[execution_policy].allow_auto_dispatch` is false if any layer sets false.
- `[model_aliases.<alias>]` is user-scoped; project config cannot define model
  aliases. Explicit config may define temporary aliases for CI or experiments.
- `[model_aliases.<alias>].adapter` and `.model` must be non-empty strings.
- `[capability_profiles.<profile-id>]` is project-scoped; user config cannot
  define project capability profiles. Explicit config may define temporary
  profiles for CI or experiments.
- `[capability_profiles.<profile-id>].stage` must validate through the shared
  core stage type schema.
- `[capability_profiles.<profile-id>].required_capabilities` must be a list of
  strings.
- `[capability_profiles.<profile-id>].min_count` must be a positive integer.
- `[capability_profile_preferences.<profile-id>]` is user-scoped; project config
  cannot define local preference mappings.
- `[capability_profile_preferences.<profile-id>].agents` must be a list of agent
  ids.
- `workflow_defaults.<workflow-id>.<stage>` values must be a bare agent id string
  or a list of bare agent id strings.
- Workflow defaults are shallow-merged by workflow id and stage key.
- Workflow default arrays replace lower-layer arrays; they do not append.
- Workflow defaults must reference agents present in the resolved config.
- Default primary agent and fallback routing details are specified in
  `config-toml.md`; preset overrides and node-id keyed assignment details are
  specified in `preset-toml.md`.
- Unknown sections should fail fast unless explicitly reserved by the contract.

Workflow registry rules:

- Registry source order is built-in -> user global.
- Duplicate workflow ids across registry sources fail fast.
- `--workflow-file` is not a registry layer; it is an alternate one-off selector.
- `workflows list` and `workflows show --json` should expose source layer and path.
- `workflows add <workflow-file>` defaults to the user registry and rejects ids
  that already exist in built-in or user registry layers.
- `workflows remove <workflow-id>` removes only from the user registry and
  refuses built-in workflows.
- Temporary workflow packet provenance must include source, normalized path, hash,
  and schema version.

Stage assignment rules:

- L2 supports `string | string[]` stage assignment data shape.
- `flow run` accepts repeated role flags for `--plan`, `--execute`, `--verify`,
  `--review`, and `--decide`.
- `[workflow_defaults.<workflow-id>]` may use either a single agent id string or
  a list of agent ids for every stage.
- L2 validates and writes resolved assignment only.
- Packets write resolved arrays under `status.json.stage_assignments` and
  `assignment.toml` `[stage_assignments]`; current packet schema does not write legacy
  top-level role compatibility fields.
- Fanout execution, per-agent artifact slots, partial failure, per-agent retry, and
  decider aggregation are L5 responsibilities.

## Target Write Semantics

- `agentmesh agents add` writes to user config.
- `agentmesh agents remove <agent-id>` removes from the user config.
- `agentmesh workflows add/remove`, `agentmesh preset add/remove`, and
  `agentmesh mcp add/remove` operate on user-level global registries only.
- `agentmesh init` should initialize checkout-local project config/runs layout,
  not personal agent registry, unless a future explicit user scope is requested.
- `agentmesh init` should keep `.agentmesh/` in project `.gitignore` so local
  config and run packets do not enter normal project commits.
- `agentmesh init` should migrate exact legacy `.agentmesh/runs/` ignore lines
  to `.agentmesh/` when it updates the project `.gitignore`.
- `agents list`, `workflows list/show`, and `doctor` expose source layer where it
  affects execution.
- `flow status --json` source layer reporting remains pending until packet
  provenance is expanded.
- `flow run` records `resolved_context_policy` in `status.json` when a non-empty
  context policy is active.
- `flow run` records `resolved_review_release_policy` in `status.json` when a
  workflow has review or release policy. Declared capability profiles resolve to
  concrete reviewer agent ids at packet creation; no preference plus exactly one
  matching set writes a profile-resolution warning into the packet, while
  multiple candidates fail fast.
- `flow run` records `resolved_execution_policy` and `config_provenance` in
  `status.json` when config defaults or execution policy are active.

## Packet Provenance

Run packet creation records resolved values, not secrets.

Required provenance once L2 is complete:

- Resolved workflow id or temporary workflow source.
- Workflow source layer and path/hash when file-backed.
- Resolved stage assignment.
- Agent id, adapter id, model, and config source layer for each assigned agent.
- Config/schema versions needed to debug a run.

Never write:

- Tokens.
- Host CLI session files.
- Private login state.
- Secret environment variables.

## Breaking Changes

The project is early, so L2 does not need migration compatibility for transitional
config behavior.

Intentional breaking changes:

- Default `agents add` write target changes from current single-file discovery to
  user config.
- Config reading changes from first-existing-file to layered merge.
- Workflow source labels become more specific than `local`.
- Duplicate agent or workflow ids become hard errors instead of silent shadowing.
- `--config` becomes an overlay, not a replacement that hides user agents.

No automatic migration is planned for existing local `agentmesh.toml` files.
Users can re-add agents to user config or intentionally point `--config` at an
overlay during experiments.

## L2 Slice Map

- L2.2 implements the layered config loader.
- L2.3 implements layered workflow registry.
- L2.4 locks merge rules and conflict behavior.
- L2.5 adds temporary `--workflow-file`.
- L2.6 changes `agents add` write scope.
- L2.7 updates `agents list` and `doctor` source-layer reporting.
- L2.8 adds workflow defaults.
- L2.9 supports multi-agent assignment data shape.
- L2.10 updates docs and homepage.
- L2.11 dogfoods the layered model.
