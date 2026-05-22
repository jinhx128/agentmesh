# Agent Registration Contract

`schema_version`: 1

This contract defines the target behavior for verified `agents add`
registration. It exists before the runtime implementation so later P2 slices can
change CLI behavior without reopening the product decisions.

## Goals

Agent registration should create a reusable local agent only after AgentMesh has
enough evidence that the adapter id, model, generated identity, and basic
readiness are valid.

The default path is:

1. Resolve adapter id or public alias to a canonical adapter id.
2. Resolve the user-provided model string to a canonical model.
3. Generate a short internal agent id that is unique across loaded config layers.
4. Build a temporary candidate agent from the generated id, canonical adapter,
   and model.
5. Run a pre-registration readiness probe against that candidate.
6. Write config only when the probe succeeds.
7. Derive the default label from the canonical model, not the raw user input.

## Registration Inputs

The target CLI shape is:

```text
agentmesh agents add --adapter <adapter> --model <model-or-alias> [--timeout-seconds <seconds>] [--skip-verify]
```

Rules:

- Agent ids are not accepted as CLI positionals during creation. AgentMesh
  generates a short internal id and confirms it is unique before writing config.
- `--adapter` is required and accepts canonical adapter ids plus public aliases.
- `--model` is required for AI CLI adapters.
- `--timeout-seconds` is optional and must be `30-3600`. When omitted, the agent
  uses the system default timeout of `900` seconds.
- `--skip-verify`, if retained, is diagnostic-only and must not write config.
  It may show what would be checked, but successful registration requires the
  readiness probe.

## Model Resolution

Model resolution produces a canonical model string.

When adapter model discovery is available:

- Exact canonical model match wins.
- Normalized shorthand may match one canonical model.
- Normalization may ignore case and separator differences such as spaces,
  underscores, dots, and dashes.
- Provider prefixes remain part of the canonical model and label.
- User config may define explicit model aliases:

  ```toml
  [model_aliases.mimo]
  adapter = "codex-cli"
  model = "gpt-5.5"
  ```

  These aliases are personal machine-level shortcuts, not project facts.
  Registration checks adapter discovery first; an explicit alias is used only
  when discovery cannot resolve the supplied model string for the selected
  adapter. An alias whose adapter does not match the selected adapter is ignored
  and the unresolved model still fails fast.

When adapter model discovery is unsupported:

- The user input can be treated as a candidate exact canonical model.
- The readiness probe must verify that candidate model before config is written.
- With `--skip-verify`, AgentMesh may report the candidate exact model and the
  dynamic checks it would have run, but it must not write config.
- `--skip-verify` must not turn fuzzy or ambiguous shorthand into a canonical
  model.

## Candidate Agent

Before writing any file, AgentMesh builds a temporary candidate agent containing:

- canonical agent id
- default label
- canonical adapter id
- command and default args from adapter metadata
- canonical model
- display name, reasoning effort, capabilities, and other user-provided metadata
- default invocation timeout
- target scope and config path

When no `--capability` flags are provided, the candidate uses the full default
stage capability set: `plan`, `execute`, `verify`, `review`, and `decide`.
When one or more `--capability` flags are provided, that explicit list is
authoritative.

The temporary candidate agent is used for validation and the readiness probe. It
is not persisted until every required check succeeds.

## Generated Identity

Agent id is generated after existing config layers are loaded. The format is
`a-xxxxxxxx`, where `xxxxxxxx` is 8 lowercase hex characters from 4 random
bytes. If the generated id already exists, AgentMesh retries generation before
writing config. Generation failure after the retry budget is a registration
failure.

Example generated ids:

```text
a-7f3a9c2d
a-0b91d4e6
```

The default label is derived after model resolution.

Example:

```text
agentmesh agents add --adapter codex --model gpt55
```

If discovery resolves `gpt55` to `gpt-5.5`, config must store
`model = "gpt-5.5"` and label `Codex CLI (gpt-5.5)`, not use `gpt55`.

Provider-prefixed canonical models keep their canonical value in config:

```text
anthropic/claude-sonnet-4.5
```

## Readiness Probe

The pre-registration readiness probe checks the temporary candidate agent before
config is written.

Minimum checks:

- adapter command can be resolved
- help/version probe succeeds when available
- non-interactive invocation shape can be prepared
- auth/model probe succeeds for AI CLI adapters
- generic `command` adapters at least verify command existence

The probe must use the canonical model. A probe against the raw user input is not
sufficient when the raw input was a shorthand. The probe timeout is independent
from the candidate agent's invocation timeout; probe timeout defaults to `60`
seconds and must stay in the `5-300` range.

## Failure Strategy

Registration failures fail fast and do not write config.

Failure cases:

- adapter id or alias is unknown
- adapter CLI does not exist
- model shorthand cannot be resolved
- ambiguous model shorthand matches multiple candidates
- unique generated agent id cannot be produced within the retry budget
- auth probe fails
- model probe fails
- readiness probe times out
- `--timeout-seconds` is outside `30-3600`
- target config path cannot be written

Error output should include actionable context:

- unknown adapter should list supported adapter ids or aliases
- ambiguous model should list candidate models
- command missing should show the command that was attempted
- auth failure should tell the user to log in through the underlying CLI
- probe timeout should mention the timeout and the adapter command

## `--skip-verify`

`--skip-verify` is diagnostic-only in the target contract.

It may run the same static checks as normal registration and then report what
dynamic checks would have run, but it must not persist an agent.

This keeps config from containing draft agents whose command, authentication, or
model access was never verified. Future offline workflows can add a separate
draft command if there is a real use case.

## Write Semantics

Config writes are all-or-nothing:

- Validation and probes run before opening the target config for mutation.
- Failure does not write config.
- Successful writes store the canonical adapter id and canonical model.
- Successful writes store `timeout_seconds` only when explicitly provided or when
  the config writer intentionally materializes defaults.
- Existing user comments should be preserved where the config writer already
  supports preservation.
- Project-scope writes should warn that project config is not appropriate for
  personal credentials.

Sensitive data is never written:

- token
- session
- cookie
- API key
- provider login state
- private host CLI state

## Runtime Alignment

Runtime now implements the verified registration path:

- `agents add` generates a short internal id and does not accept a positional
  id during creation.
- Model strings are resolved through adapter discovery and matching user model
  aliases before config is written.
- `--skip-verify` is diagnostic-only and exits without writing config.
- Successful writes store canonical adapter and model values without storing
  credentials or host login state.
- Agent references use the generated id only. Names are for display and memory;
  Agent-level aliases are not persisted or accepted.
