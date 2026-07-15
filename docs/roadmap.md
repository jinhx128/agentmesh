# AgentMesh Roadmap

AgentMesh is moving from a personal AI configuration repository to an independent
AI coding CLI orchestration tool. The product boundary is:

- AgentMesh owns agent registration, role assignment, workflow recipes, run
  packets, stage prompts/attachments, review aggregation, and handoff evidence.
  Worker dispatch returns after the TS write-side runtime is in place.
- AgentMesh workflows are tool-neutral recipes. They must work for Codex-only,
  Claude-only, Antigravity-only, OpenCode-only, Cursor-only, and mixed teams through
  the same stage capability contract.
- AgentMesh Skill is the entry-agent ability pack. It teaches the current chat
  agent how to configure, run, inspect, and hand off AgentMesh work by calling
  the CLI.
- Codex CLI, Claude Code CLI, Antigravity CLI, OpenCode CLI, Cursor, and future
  tools own their own login state, local preferences, model access, and command
  behavior.
- Personal rules and per-user prompt packs stay outside the repository.

## Short-Term Target

The near-term goal is a reliable local CLI that can be used in real coding
work without private chat history. The short-term plan is to harden the local
packet workflow first, then widen host entry support.

- Keep `agentmesh.toml` as the reusable local agent registry.
- Keep `.agentmesh/runs/<run-id>/` as the traceable run packet boundary.
- Support `plan`, `execute`, `review`, and `decide` as the common stage model.
- Make AI CLI adapters callable in headless mode and diagnosable with `doctor`.
- Keep run packets resumable at the stage level: status, events, artifacts, and
  failed stage are explicit. `flow retry` and `flow resume` rerun failed stages
  or continue from a chosen stage.
- Enforce the trust boundary between entry agents and worker CLIs:
  `flow attach` is for current entry-agent work; worker-owned stages move
  through `flow dispatch`.
- Keep project setup low-surprise: `agentmesh init` may update `.gitignore` for
  checkout-local AgentMesh files, but external config paths skip gitignore
  mutation and `.agentmesh/` is not meant to enter normal project commits.
- Preserve Review Gate as an AgentMesh workflow: reviewers are read-only,
  findings are merged by the decider, and accepted Must Fix items gate
  completion.
- Ship a small built-in workflow catalog first: `implementation-plan`,
  `bug-fix`, `guided-delivery`, `review-gate`, `handoff`, and
  `release-check`.
- Support reusable user workflow recipes from
  `~/.config/agentmesh/workflows/*.toml`, while preventing custom files from
  silently shadowing built-in workflow ids.
- Execute MVP workflows through `agentmesh run --workflow <id>`, saving the
  workflow id, status, and stage sequence into the run packet.
- Package explicit local context with `--context-file`, `--diff-file`, and
  `--verification-file`, then inject `context.md` into stage prompts. Every
  context entry carries provenance metadata so missing, stale, or failed inputs
  are visible instead of hidden in private chat state.
- Capture scoped git diffs automatically from `--scope` when no explicit
  `--diff-file` is provided; bound git operations with timeouts so run creation
  remains responsive.
- Tolerate imperfect local text inputs by replacing invalid UTF-8 bytes in
  user-provided task, context, diff, verification, and attach files.
- Ship AgentMesh Skill through `agentmesh skill show` and
  `agentmesh skill export --format markdown` as the source-of-truth entry-agent
  contract.
- Make `agentmesh skill install` require an explicit host target so AgentMesh
  does not write a fake shared directory that a host may never scan.
- Support host-specific entry adapters for Codex, Claude, Cursor, Antigravity, and
  OpenCode through `agentmesh skill install --target <host>`, all derived
  from the same packaged AgentMesh Skill.
- Keep Cursor project rules as a project-local entry adapter until Cursor
  exposes a stable user-level skill convention.
- Make `agentmesh init` keep `.agentmesh/` in `.gitignore` so local config,
  workflow drafts, and run packets do not pollute normal project commits.
- Support `current` as the current entry agent for `plan`, `execute`, `review`,
  or `decide` by using `agentmesh flow prompt` and `agentmesh flow attach`
  instead of dispatching it as a CLI.
- Support user-gated delivery runs where `--user-gate` requires
  `--decide current`, keeping final approval with the user instead of a worker
  CLI.
- Expose stable packet summaries with `agentmesh flow status --json` so entry
  agents do not need to load raw packet files by default.
- Expose lightweight packet timelines with `agentmesh flow events`, including
  compact text and `--json`; add `--limit` and local `--follow` tailing after
  the current Node-only command surface is stable.
- Report worker non-interactive readiness through `agentmesh doctor --json`,
  with explicit ready / unknown / not_ready states, help/version probing, and
  actionable adapter hints.
- Verify AgentMesh Skill host installs after `agentmesh skill install`, and
  expose `agentmesh skill verify --target <host>` plus `--json` for existing
  installs.
- Maintain `release-check` evidence summaries in `release-summary.md`, including
  diff / verification evidence, review findings, recent events, skipped
  evidence, residual risk, and parsed release verdict state.
- Capture MCP client context from configured stdio MCP servers through the
  official MCP SDK transport. Repeated
  `--mcp-resource <server-id>:<resource-uri>` inputs can add text resources to
  `context.md` with provenance, while failed captures stay visible as failed
  provenance entries.
- Next short-term milestones: add richer adapter-specific doctor probes and
  harden MCP diagnostics.

## Long-Term Target

The long-term goal is an orchestration layer that connects CLIs, AgentMesh
Skill, MCP context, workflow recipes, and review policies without becoming
another personal dotfiles repo.

- Workflow execution templates should expand beyond packet creation into
  workflow-specific prompt templates, context packs, and quality-gate checks.
- MCP client integration: agents can now receive text resources from configured
  stdio MCP servers. The next step is stronger diagnostics, resource listing,
  and bounded assembly before AgentMesh tries to expose its own MCP server.
- Context packs should grow from local files and scoped git diffs into prior
  packet artifacts, MCP resources, and bounded prompt assembly.
- Handoff and resume: a run should be restartable after failures, timeouts,
  cancellation, or executor changes.
- Live observability: `events.jsonl` now has a compact CLI view; later versions
  should add true tailing, richer filters, and UI views.
- External workflow registry remains out of the local MVP. For now each teammate
  clones or pulls the repository, then adds their own AgentMesh config and
  checkout-local workflow recipes as needed.
- AgentMesh Skill should become the universal host contract. Entry-specific
  installers, plugin manifests, extensions, or rules are adapters around the
  same packaged Skill content, not separate products.
- More entry-surface installers and plugin manifests:
  `agentmesh skill install --target <host>` should grow beyond Codex and Cursor
  as hosts expose stable local conventions, while the canonical AgentMesh Skill
  stays in the AgentMesh package and repository.
- MCP server mode can come later, after the CLI, packet schema, and MCP client
  context ingestion are stable enough to expose safely to other tools.
- Release governance: release checks should report verified commands, skipped
  checks, open risks, and final verdict.

## Vocabulary Policy

AgentMesh uses `AgentMesh Skill` for the entry-agent ability pack. The built-in
catalog uses `workflow` or `workflow recipe`; it does not use `skill` as a
workflow alias.

A workflow must be adapter-neutral and define:

- when to use it;
- participating stages;
- expected packet artifacts;
- quality gates;
- what remains out of scope.

This keeps useful concepts like Review Gate while removing machine-specific
rules, hooks, shell wrappers, credentials, and personal preferences.
