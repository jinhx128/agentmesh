# Adapter Plugin Contract

`schema_version`: 1

Decision: define the adapter plugin surface as an agent onboarding and
invocation contract only. Adapter plugins may help AgentMesh add, validate, and
invoke a new agent family, but they must not write packet files, advance runtime
state, bypass agent registration readiness, or act as a cloud runner.

## Scope

Adapter plugins describe how a local agent adapter is detected, validated, and
invoked. The first contract exists so a third-party CLI, private runner wrapper,
or company-internal agent can be added without editing runtime state machine
code.

## Required fields

- `id`: stable adapter id used in agent config.
- `label`: human-readable adapter label.
- `aliases`: optional shorthand ids.
- `description`: one-line adapter description.
- `capabilities`: supported roles, stages, and non-interactive support.

## Required functions

- `detect()`: check whether the local command or adapter host exists.
- `resolveModel(input)`: turn a user-provided model alias or shorthand into the
  canonical model string that will be written to agent config.
- `probe(config)`: validate that a candidate agent can actually run before it is
  accepted.
- `buildInvocation(request)`: convert an AgentMesh prompt request into a
  concrete local command, environment, stdin, and output capture contract.
- `parseResult(output)`: convert process output, exit code, timeout, stdout, and
  stderr into a uniform adapter result.

## Flow

1. Registration resolves the adapter plugin by `id` or alias.
2. `resolveModel(input)` returns the canonical model or a not-found/ambiguous
   result.
3. Agent config is built from the canonical model, command, args, env,
   capabilities, and optional prompt/output flags.
4. `detect()` and `probe(config)` run before the agent is accepted.
5. Runtime invocation uses `buildInvocation(request)` and process execution.
6. `parseResult(output)` normalizes the result for diagnostics and timing.

## Guardrails

- Adapter plugins must not write packet files such as `status.json`,
  `events.jsonl`, `artifacts.toml`, or stage artifact markdown.
- Adapter plugins must not advance runtime state, retry stages, resume runs, or
  acquire run locks.
- Adapter plugins must not bypass agent registration readiness.
- Adapter plugins must not receive internal packet writer helpers.
- Adapter plugins must not expose a generic shell runner beyond the declared
  adapter command.
- A cloud runner is out of scope for this contract; remote execution needs a
  separate transport, auth, storage, and trust decision.

## Built-in adapter mapping

The current built-ins imply the minimum interface:

- Codex, Claude, Antigravity, and OpenCode provide id/label/capability metadata,
  model resolution, readiness probing, and invocation builders.
- The generic command adapter keeps model resolution permissive and skips auth
  probing, but still participates in command detection and invocation shaping.

## Non-goals

- no public packet write API
- no runtime state-machine plugin API
- no lock manager plugin API
- no event subscription API
- no MCP server package
- no UI package
