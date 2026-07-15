# AgentMesh Package Boundary Gates

Status: active gate checklist for the monorepo execution plan.
Last reviewed: 2026-05-18.

This document turns the review Must Fix items in `plan.md` into concrete
engineering gates. It is intentionally short; detailed ownership and rollout
steps remain in the root plan.

## Package Roles

| Package / app | Owns | Must not own |
| --- | --- | --- |
| `packages/core` | Protocol types, schema constants, pure validation helpers. | Node side effects, disk IO, subprocesses, env access, terminal output. |
| `packages/runtime` | Packet IO, workflow execution, review gates, locks, compatibility, provider adapters. | CLI argument parsing, terminal formatting, `process.exit()`, direct stdout business output. |
| `packages/sdk` | Stable TypeScript contract for workspace consumers and type-only frontend contracts. | Runtime internals or browser-visible Node dependencies. |
| `packages/cli` | Argument parsing, terminal output, process exit codes, install-facing CLI commands. | Business rules that should be shared with App Server. |
| `packages/app-server` | Local HTTP API, auth/session checks, API error mapping, workspace session lifecycle. | Spawning the `agentmesh` CLI as a mutation path. |
| `apps/studio-web` | React/Vite browser UI and HTTP API consumption. | Direct `.agentmesh/` reads, runtime imports, Node-only package imports. |
| `apps/studio-desktop` | Tauri shell, sidecar lifecycle, bootstrap and DMG packaging. | AgentMesh business logic or global CLI discovery for Studio behavior. |
| `packages/skills` | Skill templates, target mapping, install/verify contracts. | Runtime behavior or provider orchestration. |

## Required Gates

- Core purity: automated checks must reject `packages/core` imports from Node
  side-effect modules such as `node:fs`, `node:child_process`, `node:process`,
  and `node:http`.
- Single write kernel: CLI and App Server mutations must both call runtime
  programmatic APIs; production App Server code must not spawn the CLI.
- Import direction: cross-package imports use `@agentmesh/*` package names or
  explicit type-only contracts; frontend code must not import
  `@agentmesh/runtime`.
- Studio assets: `agentmesh studio` must serve built React assets by default
  when present and fail with a clear build hint when missing.
- Direct call prompt input: `--prompt`, `--prompt-file`, and future stdin input
  normalize to prompt text before adapter invocation unless a provider declares
  an explicit `prompt_file_arg`.
- Distribution shape: internal packages stay private with buildable exports;
  the root CLI tarball is installable without unresolved workspace dependency
  gaps; Desktop Studio mutations consume app-server/runtime/studio-web artifacts
  rather than a CLI artifact, while optional Agent Integrations may install a
  public npm CLI detection, installation, and update operations.
- Desktop bootstrap: App Server binds `127.0.0.1`, uses a per-launch token that
  is not passed in argv or query strings, and validates Host/Origin/CORS.
- Packet schema: active code, tests, fixtures, docs, and examples use one
  current packet schema vocabulary; historical archive/review records may keep
  original wording.

## Verification Map

| Gate | Primary verification |
| --- | --- |
| Core purity and import direction | Boundary check script plus `npm test`. |
| Single write kernel | App Server mutation tests, CLI mutation tests, and no `app-server -> cli` production spawn grep. |
| Studio assets | `npm run build:studio-frontend`, Studio CLI/API tests, and local smoke on `/`, `/assets/*`, `/api/calls`. |
| Prompt input | Adapter invocation tests and call history tests for file prompt evidence. |
| Distribution shape | `npm run build`, `npm test`, `npm pack --dry-run`, clean install smoke. |
| Desktop bootstrap | Desktop smoke, auth/origin tests, process-argv token check. |
| Packet schema | Build/test matrix plus active-surface `rg` guard for old schema vocabulary. |
