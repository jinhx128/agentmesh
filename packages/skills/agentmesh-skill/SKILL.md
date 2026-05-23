---
name: agentmesh
description: Use AgentMesh CLI orchestration from entry agents.
---

# AgentMesh Skill

Use AgentMesh Skill when the user wants to configure, check, run, review, hand
off, resume, or inspect AgentMesh work from the current entry agent.

The entry agent is the chat surface the user is using now, such as Codex,
Claude Code, Antigravity CLI, Cursor, GitHub Copilot CLI, or another coding
assistant. The entry agent can either orchestrate AgentMesh or participate as
the special `current` agent.

## Core Contract

AgentMesh Skill teaches the entry agent to call the local `agentmesh` CLI. The
skill is not a second orchestration engine.

Default flow:

1. Understand the user's task, repository, scope, and requested roles.
2. Check AgentMesh availability with `agentmesh --help` when needed.
3. Initialize or update configuration only when the user asks or configuration
   is missing.
4. Create or continue a run packet through `agentmesh`.
5. Dispatch worker CLI stages with `agentmesh flow dispatch`.
6. Use `agentmesh flow prompt` and `agentmesh flow attach` when a stage is
   assigned to `current`.
7. Use `agentmesh flow retry` or `agentmesh flow resume` after a failed worker
   stage once the underlying problem is fixed.
8. Summarize results from stable CLI output, especially
   `agentmesh flow status --json`, before reading raw packet artifacts.

## Setup Commands

Use these commands when the user asks to set up a project or register local
agents:

```bash
agentmesh skill show
agentmesh skill export --format markdown
agentmesh skill install --target codex
agentmesh skill install --target claude
agentmesh skill install --target cursor
agentmesh skill install --target antigravity
agentmesh skill install --target opencode
agentmesh skill install --target copilot
agentmesh skill verify --target codex
agentmesh skill verify --target codex --json
agentmesh cli detect --json
agentmesh init
agentmesh agents add --adapter codex --model gpt55 --capability plan --capability verify --capability decide
agentmesh agents add --adapter claude --model opus-4.7 --capability execute
agentmesh agents add --adapter antigravity --model current --capability review
agentmesh agents add --adapter opencode --model zhuanzhuan/deepseek-v4-pro --capability plan --capability execute --capability verify --capability review --capability decide
agentmesh agents remove <agent-id>
agentmesh doctor
agentmesh doctor --json
agentmesh doctor --agent <agent-id> --json
```

Agent registration stores invocation metadata. Do not store login state,
tokens, cookies, API keys, or provider session files in AgentMesh.
Agent registration runs a readiness probe before writing config. Use
`--skip-verify` only as an offline setup escape hatch, then run
`agentmesh doctor` before dispatching.
Use `agentmesh cli detect --json` to inspect only the supported provider CLIs
(Codex, Claude Code, Cursor Agent, Antigravity, and OpenCode) with the same
desktop-safe resolver used by Studio and dispatch. This command reports command
path, source, version, and missing state; it is not an auth probe and does not
require every supported provider to be installed.
When registering an agent, do not provide an `agent-id`. AgentMesh generates a
short internal id such as `a-7f3a9c2d`; use the generated id only when later
removing, enabling, disabling, or assigning that registered agent.
When no `--capability` flags are provided, new agents default to
`plan`, `execute`, `verify`, `review`, and `decide`. When `--capability` is
provided, it is the exact capability list, so include `verify` for agents that
should run verify stages.

`agentmesh skill install` requires an explicit host target. The AgentMesh Skill
source stays canonical in the package; each install target writes the expected
project-level file for that host.
`agentmesh skill install` verifies written files after installation. Use
`agentmesh skill verify --target <host>` to check an existing host install, or
add `--json` when an entry agent needs machine-readable install status.

Current install targets:

- `--target codex`: current project `.agents/skills/agentmesh/SKILL.md`.
- `--target cursor`: current project `.agents/skills/agentmesh/SKILL.md`.
- `--target antigravity`: current project `.agents/skills/agentmesh/SKILL.md`.
- `--target opencode`: current project `.agents/skills/agentmesh/SKILL.md`.
- `--target copilot`: current project `.agents/skills/agentmesh/SKILL.md`.
- `--target claude`: current project `.claude/skills/agentmesh/SKILL.md`.

Legacy `.cursor/rules/agentmesh.mdc` files may still be reported by
`skill verify --target cursor`, but `skill install --target cursor --force`
refreshes only the shared project Skill and does not delete legacy Cursor rules.

If a host has no stable local convention yet, use `agentmesh skill show` or
`agentmesh skill export --format markdown` and place the markdown in that
host's supported rule, skill, extension, or plugin system. Existing different
files require `--force`.
For checkout-local project config outputs, `agentmesh init` keeps `.agentmesh/`
in the project `.gitignore` so local config, workflow drafts, and run packets do
not enter normal project commits by accident. Each teammate should create their
own local AgentMesh config after cloning or pulling the repository. For older
checkouts, replace a legacy `.agentmesh/runs/` ignore line with `.agentmesh/`.
For config outputs outside the current project, gitignore mutation is skipped.

## Workflow Commands

Use `agentmesh run --workflow` to create workflow-backed run packets:

```bash
agentmesh workflows list
agentmesh workflows show w-9d94d0db
agentmesh workflows add ./workflow.toml
agentmesh workflows remove <workflow-id>
agentmesh run --workflow w-7db15660 \
  --plan claude \
  --execute codex \
  --review antigravity \
  --decide claude \
  --task "Fix the intermittent 500 in the login endpoint"
```

Reusable workflow recipes live in `~/.config/agentmesh/workflows/*.toml`. Use
`agentmesh workflows list` before `run --workflow` when the user references a
custom workflow id.

Use Guided Delivery (`w-f43236a0`) for artifact-neutral delivery work. The review stage
reviews the delivered artifact, not only code:

```bash
agentmesh run --workflow w-f43236a0 \
  --plan claude \
  --execute current \
  --review antigravity \
  --review claude \
  --decide current \
  --user-gate \
  --task "Build the export workflow"
```

`--user-gate` requires `--decide current`. In the decide stage, summarize
accepted findings, rejected findings, and items needing user decision; do not
claim final approval until the user explicitly decides.

For stages assigned to `current`, ask AgentMesh for the stage prompt, do the
assigned work in the entry agent, then attach the result:

```bash
agentmesh flow prompt <run-id> --stage plan
agentmesh flow attach <run-id> --stage plan --file plan.md

agentmesh flow prompt <run-id> --stage review
agentmesh flow attach <run-id> --stage review --agent current --file review-current.md

agentmesh flow prompt <run-id> --stage decide
agentmesh flow attach <run-id> --stage decide --file decision.md
```

Worker CLI stages can be advanced through AgentMesh:

```bash
agentmesh flow dispatch <run-id> --stage execute
agentmesh flow dispatch <run-id> --stage all
agentmesh flow retry <run-id>
agentmesh flow retry <run-id> --stage execute
agentmesh flow resume <run-id>
agentmesh flow resume <run-id> --stage review
```

Do not dispatch stages assigned to `current`; use prompt/attach for those.

Use status before loading raw files:

```bash
agentmesh flow status <run-id>
agentmesh flow status <run-id> --json
agentmesh flow events <run-id>
agentmesh flow events <run-id> --json
```

The JSON summary is stable, but fields such as `workflow`,
`failed_stage`, `release_verdict`, and assignments for stages outside a
workflow may be `null` or omitted.
Use `flow events` for compact packet timelines before opening raw
`events.jsonl`.

Context pack inputs are available through repeated `--context-file`, optional
`--diff-file`, optional `--verification-file`, repeated `--scope`, and repeated
`--mcp-resource <server-id>:<resource-uri>` when MCP servers are configured.
Use checkout-local `[context_policy]` to keep generated, archival, or bulky
paths out of normal runs. A conservative starting point is `max_files = 12`,
`max_bytes = 262144`, and
`denied_paths = [".agentmesh/runs", "docs/archive", "dist-node", "node_modules"]`.
Bytes are a prompt-cost proxy, not exact model tokens. Use
`--exclude-correction <id>` for active correction records that do not apply to a
specific run.
Do not claim MCP context was attached unless the current CLI help and packet
artifacts prove it.

## Current Participant

`current` means the entry agent that is reading this skill. It is a real role
assignment, but it is not an invokable worker CLI adapter.

Examples:

```bash
agentmesh run --workflow w-7db15660 \
  --plan current \
  --execute codex \
  --review antigravity \
  --decide current \
  --task "Fix the intermittent 500 in the login endpoint"
```

When a stage is assigned to `current`, ask AgentMesh for the stage prompt, do
the assigned work in the entry agent, then attach the result:

```bash
agentmesh flow prompt <run-id> --stage plan
agentmesh flow attach <run-id> --stage plan --file plan.md

agentmesh flow prompt <run-id> --stage review
agentmesh flow attach <run-id> --stage review --agent current --file review-current.md

agentmesh flow prompt <run-id> --stage decide
agentmesh flow attach <run-id> --stage decide --file decision.md
```

The entry agent may modify source files only when the user assigns
`execute=current`. If execution belongs to another agent, the entry agent should
orchestrate, inspect status, and summarize; it should not run a parallel
implementation.

## Review And Decision Rules

Reviewers are read-only unless explicitly assigned as executor in another
stage. Treat reviewer output as evidence to verify, not as a vote.

For review aggregation:

- Keep accepted findings, rejected findings, and findings needing user decision
  distinct.
- Verify Must Fix claims against files, tests, or logs before treating them as
  blockers.
- Record residual risk and skipped verification in the final summary.
- For Release Check (`w-67ef1b1f`), inspect `release-summary.md` first. It aggregates diff,
  verification, findings, recent events, skipped evidence, and residual risk.
  The final decision must include exactly one non-fenced verdict line:
  `Verdict: ready`, `Verdict: not_ready`, or `Verdict: needs_decision`.
  Missing, duplicate, or invalid verdict lines fail the `decide` stage.

## Boundaries

- Do not store login state in AgentMesh.
- Do not pretend unavailable worker CLIs were called.
- Do not bypass `agentmesh doctor` errors by fabricating readiness.
- Do not read or copy provider token files, cookies, keychains, or session
  stores.
- Do not load every raw file under `.agentmesh/runs/<run-id>/` by default; use
  `agentmesh flow status --json` first.
- Do not dispatch `current` as if it were a CLI command; use prompt and attach.
- Do not let multiple executors edit the same files concurrently.
