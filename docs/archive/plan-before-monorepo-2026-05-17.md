# Plan C: AgentMesh Studio Final Stack

Status: final architecture decision; implementation remains sliced and
execution-ready
Date: 2026-05-17
Decision level: Tauri 2 is the default desktop shell; Electron is a contingency,
not a parallel target. Current distribution target is internal-team DMG, so
unsigned DMG is acceptable for the first desktop release.

## 1. Corrected Self Review

This section replaces the earlier self-review that became too conservative
after challenging the React recommendation.

### Accepted Corrections

- The final target should not keep oscillating between React and Vue. For Plan C,
  the target frontend stack is selected as React.
- "One step" means one target architecture, not one big-bang rewrite.
- Tauri must stay a thin desktop lifecycle shell. AgentMesh packet, workflow,
  review, release, adapter, and lock logic must remain in the Node/CLI/runtime
  boundary.
- The final desktop packaging path is Tauri 2. Electron remains a fallback only
  if spike evidence shows Tauri cannot support the required desktop runtime
  behavior at acceptable cost.
- The Vite/Tauri path must explicitly handle dynamic loopback port and
  per-launch auth token bootstrap.
- Desktop create/delete agent controls are part of the Studio product target,
  but the lifecycle domain must be implemented in the Node App Server and
  existing runtime/CLI boundary, not in the Tauri shell.
- Direct `agentmesh call` invocations are not workflow runs, but they must still
  be first-class local evidence with a Studio-visible Calls tab.
- React Flow, Monaco, xterm.js, and Zustand are not first-slice requirements.
  They are reserved extension points and should be added only when a concrete
  Studio feature requires them.

### Revised Review Findings

[Must Fix] The plan must distinguish target architecture from implementation
sequence. Selecting React as the final target is acceptable; rewriting the
whole Studio UI, desktop shell, App Server lifecycle, and packaging path in one
commit is not.

[Must Fix] The plan must include a bootstrap contract for packaged desktop mode:
the React frontend must learn the App Server URL and per-launch token through a
defined mechanism, not through a fixed public localhost port.

[Should Fix] Optional heavy UI capabilities must be lazy dependencies. React
Flow is introduced when Studio needs an interactive graph/canvas; Monaco when
configuration or artifact editing needs code-editor behavior; xterm.js when a
real terminal-like stream is needed.

[Should Fix] The first React slice should migrate a low-coupling area before
the run workspace. Settings or catalog is a better pilot than run navigator plus
selected run detail.

[Should Fix] The desktop shell decision must include an explicit switching
threshold. Tauri remains selected unless packaged sidecar lifecycle, native
module packaging, WebView compatibility, or terminal requirements fail the
spike gates. macOS Developer ID signing and notarization are not current
internal-release blockers.

[Nit] Zustand should not be part of the baseline. Start with React state and
TanStack Query; add a small store only after cross-zone client state becomes
awkward.

Verdict: proceed with React as the final target, but implement through guarded
slices.

## 2. Final Target Architecture

Final stack:

- Desktop host: Tauri 2
- Local service: Node App Server
- Frontend build: Vite
- Frontend framework: React + TypeScript
- Server state: TanStack Query
- UI foundation: Radix-style primitives plus an AgentMesh local design system
- Forms: React Hook Form + Zod when non-trivial forms arrive
- Tables/lists: TanStack Table when plain tables stop being enough
- Icons: lucide-react when the React UI lands
- Deferred: React Flow, Monaco Editor, xterm.js, Zustand

Rejected for the final Studio stack:

- Vue 3 + Element Plus as the main Studio path
- Vant
- Electron as the default shell or a parallel target
- Tauri/Rust owning AgentMesh business logic
- Direct packet mutation from the browser UI
- Desktop shell ownership of create/delete agent business logic

Electron fallback threshold:

- Switch to Electron only if P3.0 shows Tauri 2 cannot support required sidecar
  lifecycle, cross-platform packaging, WebView behavior, or
  terminal/native-module needs within acceptable implementation cost.
- Do not switch to Electron only because comparable desktop AI tools use it.
  The relevant evidence is whether the AgentMesh Studio runtime requirements
  exceed the thin-shell Tauri model.
- If Studio becomes an IDE-like product centered on embedded terminal,
  node-pty, complex editor/plugin surfaces, and Chromium-specific behavior,
  re-open the Electron decision before implementing those features.

Distribution target:

- Current target: internal team distribution only.
- First desktop release may ship as unsigned macOS DMG.
- First internal macOS target: Apple Silicon arm64 on the team's supported
  macOS baseline. Intel x86_64 or universal DMG is added only if the team has a
  concrete Intel Mac user or test machine.
- Internal users may need documented Gatekeeper first-open steps such as
  right-click Open or allowing the app from System Settings.
- Internal install docs must include the quarantine fallback command for cases
  where standard right-click Open is not enough:
  `xattr -d com.apple.quarantine <app-or-dmg-path>`.
- Developer ID signing, notarization, and stapling are deferred until external
  customer or public distribution becomes a product requirement.
- Public distribution is out of scope for Plan C unless this section is
  explicitly revised.

Install channels:

- CLI channel: installs a global or user-local `agentmesh` command through
  source install, `npm pack` tarball, private registry, or future public npm
  release.
- Desktop channel: installs `AgentMesh.app` from DMG. The app bundles its own
  AgentMesh runtime/CLI and Node App Server.
- The two channels are allowed to coexist on the same machine.
- The desktop app must not require the global `agentmesh` command to exist.
- The global CLI must not require `AgentMesh.app` to exist.

Entry skill installation target:

- Prefer one shared project-level install path:
  `.agents/skills/agentmesh/SKILL.md`.
- Official support for the shared project path is confirmed for Codex, Cursor,
  Gemini CLI, OpenCode, and GitHub Copilot CLI.
- Claude Code is the exception in the current official docs: it uses
  `.claude/skills/agentmesh/SKILL.md` for project skills and
  `~/.claude/skills/agentmesh/SKILL.md` for personal skills. Do not assume
  `.agents/skills` covers Claude Code until official docs say so.
- For `codex`, `cursor`, `gemini`, `opencode`, and `copilot`, AgentMesh should
  write the same shared project skill file at
  `.agents/skills/agentmesh/SKILL.md`.
- For `claude`, AgentMesh should write `.claude/skills/agentmesh/SKILL.md`.
- Host-native alternative paths such as `.cursor/skills`, `.gemini/skills`,
  `.opencode/skills`, `.github/skills`, `~/.agents/skills`,
  `~/.copilot/skills`, and Gemini extension skills remain supported host
  conventions, but they are not the default AgentMesh project install path.
- Existing legacy files such as `.cursor/rules/agentmesh.mdc` are compatibility
  evidence and must not be deleted automatically.
- `skill verify` must report every expected file for the selected target,
  distinguish missing, mismatch, legacy-only, and ok states, and provide a
  target-specific remediation hint.
- `--force` refreshes expected files for the selected target. It must not delete
  legacy host files, shared skill files, or other tools' native skill files.

## 3. Runtime Boundary

Target shape:

```text
AgentMesh.app
  Tauri 2 shell
    - starts/stops the app-bundled Node App Server sidecar
    - owns window lifecycle, app update hooks, native packaging, and app-only
      preferences
    - passes or exposes the server URL and per-launch token to the frontend
    - does not implement packet/workflow/release/review logic

Node App Server
  - serves the Vite-built React UI
  - exposes UI-shaped API endpoints
  - reads packet files for display
  - invokes the app-bundled CLI/runtime for allowed mutations
  - owns lock-aware mutation delegation
  - does not become a second runtime

React Studio UI
  - renders runs, stages, events, artifacts, catalog, actions, settings, and
    review/release evidence
  - renders direct call history separately from workflow-backed runs
  - renders agent lifecycle controls such as create, delete, enable, disable,
    and status inspection
  - talks only to App Server APIs
  - does not directly read or write `.agentmesh/runs/*` or
    `.agentmesh/calls/*`
```

Source of truth remains packet files, call records, compatibility metadata, and
existing CLI/runtime behavior. Browser code must never become the source of
truth for filesystem state.

CLI and DMG co-install contract:

- CLI and DMG share protocols and data contracts, not process ownership.
- Shared contracts: packet schema, workflow semantics, project config semantics,
  agent registration semantics, runtime version compatibility, and lock-aware
  mutation behavior.
- Shared data: a workspace selected by the user and its `.agentmesh` state.
- Separate binaries: global `agentmesh` and app-bundled AgentMesh runtime may
  exist at different filesystem paths and different versions.
- Separate App Servers: `agentmesh studio` and `AgentMesh.app` each start their
  own App Server process and use their own dynamic port/token session.
- The desktop App Server must invoke the app-bundled runtime path only; it must
  not resolve `agentmesh` through `PATH`.
- The CLI must operate independently from the desktop app and must not call
  into `/Applications/AgentMesh.app`.
- External provider CLIs and login state, such as Codex, Claude, Gemini, or
  Cursor adapters, are not bundled by AgentMesh. Both install channels must use
  readiness checks and actionable diagnostics when provider tools or auth are
  missing.
- Derived logs, caches, and temporary files that are not part of the shared
  packet/config contract must be versioned or entrypoint-namespaced so one
  channel cannot corrupt or silently reinterpret the other's scratch data.

Provider CLI discovery in desktop mode:

- The desktop app must not use `PATH` to resolve `agentmesh`, but it may use a
  dedicated provider-tool resolver for external provider CLIs.
- Provider-tool resolution order: explicit user-configured provider path,
  app preference override, well-known install locations, then a controlled
  login-shell probe such as the user's default shell with `-lc "command -v
  <tool>"`.
- The login-shell probe must be time-limited, capture stderr, run from the
  user's home directory instead of the selected workspace, and use a minimal
  environment that cannot depend on project-local scripts.
- The resolver must accept only absolute executable paths from the shell probe.
  Aliases, functions, relative paths, empty output, multi-line output, and
  paths inside the current workspace must be rejected with diagnostics.
- The resolver must never execute provider commands during discovery. It may
  only discover a path; readiness/auth checks run later through the normal
  adapter readiness path.
- Finder/Spotlight-launched macOS apps do not inherit the user's interactive
  shell `PATH`; readiness diagnostics must say which resolver source was used
  and how the user can fix a missing provider path.
- Provider path discovery is revalidated before mutation and may be cached only
  with enough metadata to explain the source path in diagnostics.

Co-install compatibility policy:

- Read operations are allowed when the entrypoint supports the workspace packet
  schema.
- Mutations are allowed only when the entrypoint supports the workspace packet
  schema and runtime compatibility metadata.
- Workspace compatibility metadata lives in `.agentmesh/compatibility.json`.
- Compatibility metadata includes `schema_version`, `packet_schema_version`,
  `min_read_runtime_version`, `min_write_runtime_version`,
  `last_writer_runtime_version`, `last_writer_entrypoint`, and `updated_at`.
- Runtime versions use package semver; packet schema versions use the existing
  packet schema integer.
- Compatibility metadata is owned by the runtime workspace/packet layer, not by
  Tauri, React, or the App Server.
- Fresh workspace initialization writes `compatibility.json` immediately.
- Existing workspaces without `compatibility.json` are treated as legacy
  readable workspaces only when their packet schema is otherwise supported.
  The first successful mutation must create the file under the shared mutation
  lock before committing the mutation.
- Mutations update `last_writer_runtime_version`, `last_writer_entrypoint`, and
  `updated_at` after the write succeeds. Failed mutations must not advance
  writer metadata.
- App Server and CLI diagnostics must expose the compatibility decision:
  `read_write`, `read_only`, or `refused`, plus the current runtime version and
  workspace metadata values that caused the decision.
- Unsupported packet schema or `min_read_runtime_version` must refuse reads
  with an actionable compatibility error.
- Supported packet schema plus newer `min_write_runtime_version` may allow reads
  with a warning but must refuse mutation.
- Unsupported schema or newer write-runtime metadata must produce an actionable
  read-only or refusal state, not best-effort mutation.
- No entrypoint may auto-downgrade or silently migrate workspace state to make
  itself compatible.
- Version and entrypoint identity must be visible in diagnostics, so users can
  tell whether an operation came from global CLI or bundled desktop runtime.
  Required surfaces: CLI diagnostics, Studio Settings/About, and lock wait
  messages.

Co-install locking policy:

- All writes must go through the existing lock-aware runtime/CLI mutation path.
- Lock format and stale-lock behavior are owned by
  `packages/runtime/src/packet/lock.ts` or its successor runtime lock module.
  App Server endpoints may call the lock-aware runtime, but must not implement a
  competing lock.
- Lock owner metadata must include entrypoint type (`cli` or `desktop`), runtime
  version, process id when available, operation id when available, and timestamp.
- File-backed lock owner interchange uses an atomic JSON owner record with at
  least `schema_version`, `lock_id`, `workspace`, `scope`, `entrypoint`,
  `runtime_version`, `pid`, `operation_id`, `command`, `created_at`,
  `heartbeat_at`, and `expires_at`.
- Lock acquisition must be atomic. Owner metadata must be written before a
  waiting entrypoint reports the lock owner.
- Long-running mutations must refresh `heartbeat_at`.
- A lock is stale only when the process is provably gone on the same host or the
  heartbeat is older than the configured stale-lock threshold.
- Stale lock recovery must be explicit and diagnostic-driven; automatic
  breaking is allowed only when the lock owner is provably dead.
- Existing run-lock directories must remain readable during migration. If an old
  lock record lacks new owner fields, the waiting entrypoint must report an
  `unknown` owner instead of deleting or rewriting the lock.
- Concurrent reads from CLI and DMG are allowed.
- Concurrent mutations against the same workspace must serialize through the
  shared lock mechanism.
- If a lock is held by the other entrypoint, the waiting entrypoint must show
  the owner and operation when available instead of failing with an opaque
  filesystem error.

Direct call history contract:

- `agentmesh call` is for lightweight one-off model calls and must not pretend
  to be a workflow run.
- Default behavior: every successful, failed, aborted, or timed-out
  `agentmesh call` executed inside a resolved AgentMesh workspace writes a local
  call record under `.agentmesh/calls/<call-id>/`.
- Workspace resolution order for call history: explicit `--workspace` if added
  by the implementation, otherwise the current command cwd resolved through the
  same workspace/config rules used by the rest of the CLI. Studio only displays
  calls from the selected workspace.
- Outside an AgentMesh workspace, `agentmesh call` must fail before invoking the
  provider unless the user passes an explicit no-history escape hatch such as
  `--no-record`. Calls made with `--no-record` are intentionally invisible in
  Studio and must print that fact to stderr.
- A call record is local workspace evidence, not a commit-ready artifact by
  default. `.agentmesh/` remains ignored by normal project commits.
- Authoring is crash-safe: create the call directory with an atomic
  `call.json` status update, write large artifacts through temporary files and
  rename, and update `call.json` atomically on every state transition.
- Studio ignores incomplete temporary directories and marks stale `running`
  records as incomplete when `heartbeat_at` is older than the stale threshold.
- Required files and artifact invariants:
  - `call.json`: machine-readable metadata and the canonical index record.
  - `prompt.md`: local prompt snapshot when allowed by redaction/copy policy.
  - `output.md`: local output snapshot when no external `--output-file` is the
    authoritative output.
  - `stderr.txt`: optional adapter stderr or failure detail; for failed calls,
    `call.json` must still include a bounded failure summary when stderr is
    absent or too large.
- `call.json` defines the authoritative prompt/output refs. If both a local
  markdown file and external path exist, `call.json` decides which one is
  authoritative for Studio rendering.
- Required `call.json` fields: `schema_version`, `id`, `agent_id`, `adapter`,
  `model`, `purpose`, `status`, `cwd`, `created_at`, `started_at`,
  `completed_at`, `duration_ms`, `heartbeat_at`, `prompt_source`,
  `prompt_ref`, `output_ref`, `output_path`, `exit_code`, `error_kind`,
  `error_summary`, `redaction_state`, `redactions_applied`, `related_files`,
  `related_run_ids`, `related_call_ids`, `tokens_in`, `tokens_out`,
  `cost_estimate_usd`, and `adoption_status`.
- `agent_id` is nullable when a direct call bypasses registered agent config
  and uses explicit adapter/model input.
- `model`, `tokens_in`, `tokens_out`, and `cost_estimate_usd` are nullable when
  the adapter cannot report them. Missing values must be `null`, not fabricated
  zeros.
- `purpose` is an open string for extensibility, but Studio filters must
  recognize at least `general`, `review`, `research`, `compare`, and
  `diagnostic`.
- `status` values are `running`, `success`, `failed`, `aborted`, `timeout`, and
  `stale`.
- `error_kind` values are `none`, `adapter_error`, `provider_auth`,
  `provider_missing`, `network`, `timeout`, `schema`, `user_aborted`,
  `internal`, and `unknown`.
- `prompt_source` values are `inline`, `stdin`, `file`, `generated`, and
  `unknown`.
- `output_path`, when present, must be workspace-relative, must not escape the
  workspace, and must render as a dangling link with a clear warning if the file
  is later renamed or deleted.
- `prompt_ref` and `output_ref` include `kind`, `path`, `sha256`,
  `redaction_state`, and `authoritative` so Studio can choose between local
  snapshots and external files without guessing.
- Call record schema versioning is tolerant for reads and strict for writes:
  older Studio may render known fields from newer call records with an
  unsupported-schema warning, but must not mutate adoption or cleanup state for
  unsupported schemas.
- Write path accepts only the current schema version. Read path accepts current
  schema plus known older schemas through explicit normalizers; unknown newer
  schemas render read-only.
- `adoption_status` starts as `unreviewed` and may become `accepted`,
  `rejected`, or `superseded` when a later plan, changelog, commit, or decision
  consumes the call output.
- Adoption changes are append-only in `adoption.jsonl`; each event includes
  `status`, `updated_at`, `updated_by_entrypoint`, `reason`,
  `related_commit`, `related_run_id`, and `superseded_by_call_id` when
  applicable. Updating adoption metadata must not mutate original prompt/output
  artifacts.
- Call records must not store provider tokens, cookies, keychains, or login
  state. Prompt/output redaction is always-on with the workspace context policy
  plus a default secret-pattern baseline. Apparent secrets are redacted before
  writing `prompt.md`, `output.md`, or call metadata.
- External `--prompt-file` and `--output-file` paths are not blindly copied.
  The call record stores a workspace-relative path plus hash when safe; local
  snapshots are written only when redaction/copy policy allows them.
- Direct calls may link to workflow runs and workflow runs may link to direct
  calls through typed ids (`related_run_ids`, `related_call_ids`), but neither
  data model embeds the other.
- Initial App Server call APIs may scan `.agentmesh/calls/*` directly. If call
  count or latency grows, add a derived `index.json` cache; the cache is
  disposable and never becomes canonical.
- Cleanup policy: default retention is unlimited for the first implementation.
  Later cleanup may archive local call directories under `.agentmesh/calls/_archive/`
  or delete them, but must leave linked committed files untouched and must render
  dangling call/run links gracefully.

Studio Calls tab:

- Studio left navigation shows separate `Runs` and `Calls` tabs.
- App Server `Runs` APIs read `.agentmesh/runs/*` workflow-backed packets.
- App Server `Calls` APIs read `.agentmesh/calls/*` direct call records.
- React renders both tabs through App Server APIs only.
- Calls list grouping mirrors run grouping by date and shows agent, model,
  purpose, status, created/completed time, duration, and output path.
- Call detail renders prompt, output, stderr/failure detail, related files,
  adoption status, and links to any output file or related run.
- Calls tab must not scan arbitrary `docs/reviews/**/*.md` as its source of truth;
  docs/reviews files may be linked from `output_path`.
- Deleting or archiving call records is deferred from the first Calls tab slice.
  When added later, it must be a separate local cleanup action and must not
  delete referenced committed review files.

Agent lifecycle ownership:

- Create/delete agent is a P2 Studio capability and part of the first complete
  React workbench target.
- The React UI initiates lifecycle operations through App Server endpoints.
- The App Server validates requests, owns lock-aware mutation delegation,
  invokes existing CLI/runtime behavior, persists allowed config changes, and
  emits lifecycle status.
- Tauri may start, stop, and monitor the App Server sidecar, but it must not
  implement agent registry mutation, workspace mutation, packet mutation, or
  runtime policy decisions.

Initial lifecycle API contract:

- API namespace: `/api/v1/agents`.
- Create: `POST /api/v1/agents` returns an agent record plus an operation id.
- Delete: `DELETE /api/v1/agents/:id` returns an operation id and never performs
  silent force-delete of a running agent.
- Enable/disable: `POST /api/v1/agents/:id/enable` and
  `POST /api/v1/agents/:id/disable`.
- Duplicate create returns a conflict response instead of mutating an existing
  agent implicitly.
- Overlapping create/delete/enable/disable operations for the same agent are
  rejected while the first mutation is in flight.
- Deleting a running agent requires either an explicit safe-stop path or a
  refusal response that tells the UI what must happen first.
- CLI/runtime exit code, stderr, and structured failure reason must be captured
  on the operation and exposed to the UI.

Initial lifecycle status contract:

- Server-to-UI lifecycle status uses SSE for the first implementation.
- Polling is an allowed fallback for degraded environments.
- WebSocket is deferred until there is a broader bidirectional realtime need.
- Each lifecycle event includes an operation id, agent id, action, status,
  timestamp, and optional error detail.
- The UI correlates optimistic/pending state through operation id, not by
  guessing from list refreshes.

## 4. Bootstrap Contract

Desktop packaged mode must not rely on a fixed public localhost port.

Required contract:

- App Server binds a dynamic loopback port.
- App Server creates a per-launch token.
- Tauri waits until the App Server is listening and its health/bootstrap endpoint
  succeeds before loading the React UI.
- Tauri loads the React UI with a safe bootstrap path after sidecar readiness is
  confirmed.
- Tauri must preserve reload recovery by reloading the original tokenized launch
  URL or re-issuing equivalent bootstrap data for WebView reload/crash recovery.
- Reload recovery must not expose an unauthenticated bootstrap endpoint. If the
  token is removed from the visible URL, the replacement mechanism must be one
  of: reloading the original tokenized URL from the Tauri host, using a secure
  in-memory Tauri-to-WebView bootstrap injection, or using an HttpOnly
  same-origin cookie created by the initial authenticated response.
- The frontend attaches the token to API requests through a single API client.
- Missing, expired, or rejected bootstrap data produces an actionable UI error.
- Sidecar startup failure produces a desktop-visible error state with retry and
  diagnostic details, not a blank webview.

Preferred bootstrap option:

- Tauri loads `http://127.0.0.1:<dynamic-port>/?token=<per-launch-token>`.
- The React app reads the initial token from the URL, stores it in memory, then
  removes it from the visible URL with `history.replaceState`.

Acceptable fallback:

- The UI fetches `/api/bootstrap` from the same origin and receives the minimal
  session context needed for API calls.
- `/api/bootstrap` is acceptable only when it is protected by the same per-launch
  token, a one-time Tauri-provided nonce, or the initial same-origin auth cookie.
  A same-origin but unauthenticated `/api/bootstrap` endpoint is rejected.

Rejected:

- Fixed product port.
- Token stored in shared AgentMesh project config.
- Rust-side packet or workflow validation to compensate for bootstrap issues.
- Remote network binding for the App Server in packaged desktop mode.
- Logging the per-launch token.
- Request logging of full bootstrap URLs. Token query parameters must be
  redacted before logs are written.

Bootstrap threat model:

- Internal unsigned DMG does not remove the need for local API containment.
- Packaged desktop mode binds only to loopback.
- Per-launch token is random, short-lived, stored in memory by the React app,
  and removed from the visible URL immediately after initial read.
- All API requests go through the single API client so token handling is not
  duplicated across features.

## 5. Frontend Application Shape

Initial React views:

- Runs/Calls navigation tabs
- Run navigator
- Run overview
- Stage timeline
- Events/log view
- Artifact list and preview
- Review/release evidence
- Agents/workflows/MCP catalog
- Agent create/delete/enable/disable controls
- Direct call history list and detail
- Settings

Deferred React views:

- Interactive workflow graph
- Code/config editor
- Terminal-like command stream
- Workflow authoring canvas

Suggested source layout:

```text
apps/studio/
  src/
    server/
      server.ts
      routes.ts
      assets.ts
      bootstrap.ts
    frontend/
      index.html
      main.tsx
      app/
      api/
      components/
      features/
        runs/
        calls/
        artifacts/
        review-release/
        agents/
        catalog/
        settings/
      styles/
      i18n/
```

The exact paths may be adjusted during implementation, but the split between
server code and frontend code should be explicit.
The first Vite slice may need a small path refactor from the current flat
`apps/studio/src/` layout into explicit `server/` and `frontend/` areas.

## 6. Implementation Plan

Execution rules for this plan:

- `plan.md` is the single execution source for Plan C. Do not keep a second
  active plan file for this work.
- Execute one slice at a time unless the user explicitly assigns parallel
  ownership. Parallel work must use disjoint file ownership and must not modify
  the same runtime contract.
- Every slice must finish in this order: implement, run slice verification,
  review, handle accepted findings, update this plan's checkbox/progress record,
  sync changelog or work log, run a final sanity check, then commit the slice.
- Completed checklist items must be changed to `[x]` and struck through. Each
  completed slice must include a progress record with date, verification,
  review result, changelog entry, commit id or reason for no commit, and next
  slice.
- Before any UI migration slice, confirm frontend code still talks only to App
  Server APIs. Before any desktop slice, confirm Tauri remains lifecycle-only.
- If a slice discovers a missing contract, stop and patch this plan before
  continuing implementation.

### P0. Runtime Contract Prerequisites

- [x] P0 phase gate: complete P0.1, P0.2, P0.3, P0.4, P0.5, P0.6, and P0.Z
      before starting P1 UI migration or P2 workbench migration.
- Stage goal: land the shared filesystem/API contracts that later React, App
  Server, CLI, desktop slices, and entry-agent setup depend on.
- Stage gate: no P1/P2/P3 mutation slice may assume compatibility metadata, lock
  owner diagnostics, call records, bootstrap auth, provider discovery, or modern
  skill install target behavior until the corresponding P0 slice is complete
  and committed.

- [x] P0.1 Add workspace compatibility metadata.
  - Slice: `P0.1`
  - Depends on: none.
  - Files/modules: `packages/runtime/src/packet/*`,
    `packages/runtime/src/config.ts` or a new runtime workspace metadata module,
    `packages/sdk/src/index.ts` if read diagnostics are exposed to Studio,
    `tests-node/core-contracts.test.ts`, `tests-node/packet-io.test.ts`, and
    new compatibility fixtures if needed.
  - Goal: introduce `.agentmesh/compatibility.json` as runtime-owned metadata
    without breaking existing workspaces.
  - Actions:
    - Add a typed read/write helper for compatibility metadata.
    - Write metadata for fresh workspace/run creation.
    - Treat missing metadata as legacy readable state when packet schema is
      otherwise supported.
    - Create/update metadata under the shared mutation lock on the first
      successful mutation in a legacy workspace.
    - Surface compatibility diagnostics for CLI and App Server callers.
  - Output: runtime helper, compatibility schema validation, fixtures, and
    refusal/read-only diagnostics.
  - Verification: tests cover fresh workspace metadata, missing legacy metadata,
    unsupported read schema, newer min-write version, successful first mutation
    backfill, failed mutation not advancing writer metadata, and diagnostics
    showing runtime version plus entrypoint.
  - Review: confirm no auto-downgrade, no silent migration, and no Tauri/React
    ownership of compatibility logic.
  - Evidence: test output, diff summary, review result, changelog entry, commit.
  - Progress record: completed 2026-05-17. Added runtime-owned
    `.agentmesh/compatibility.json` helpers, fresh run metadata writes, legacy
    missing-metadata readable diagnostics, first-successful-mutation backfill,
    CLI `packet compatibility --json`, SDK read surface, and Studio
    `/api/compatibility`.
  - Submit as: `feat(runtime): add workspace compatibility metadata`.

- [x] P0.2 Upgrade mutation lock owner metadata.
  - Slice: `P0.2`
  - Depends on: P0.1 only if the implementation shares runtime version helpers;
    otherwise independent.
  - Files/modules: `packages/runtime/src/packet/lock.ts`,
    mutation callers in `packages/runtime/src/review/artifacts.ts`,
    `packages/runtime/src/flow/*` if they acquire locks,
    `apps/studio/src/mutations.ts`, `tests-node/flow-dispatch.test.ts`,
    `tests-node/review-artifacts.test.ts`, and a new lock test if needed.
  - Goal: make CLI and desktop mutations serialize through a shared, diagnosable
    lock owner record.
  - Actions:
    - Extend the lease schema to include entrypoint, runtime version, workspace,
      scope, operation id, command, `heartbeat_at`, and `expires_at`.
    - Keep reading old lease files and report missing fields as `unknown`.
    - Add heartbeat refresh for long-running mutations where the runtime owns the
      operation duration.
    - Make lock wait/refusal messages show owner and operation when available.
    - Preserve atomic lock acquisition and explicit stale-lock recovery.
  - Output: upgraded lock helper, legacy-lock compatibility, diagnostics, tests.
  - Verification: tests cover lock acquisition/release, old lease readability,
    concurrent mutation refusal with owner details, heartbeat update, stale lock
    recovery only when provably dead or expired, and no opaque filesystem error.
  - Review: confirm App Server calls lock-aware runtime code and does not create
    a parallel lock protocol.
  - Evidence: test output, stale-lock fixture or test log, changelog entry,
    commit.
  - Progress record: completed 2026-05-17. Extended run mutation lease owner
    records with entrypoint, runtime version, workspace, scope, operation id,
    command, heartbeat, and lock id; preserved old lease diagnostics with
    `unknown` owner fields; added async heartbeat refresh and updated
    `docs/contracts/run-lock.md`.
  - Submit as: `feat(runtime): add entrypoint-aware mutation locks`.

- [x] P0.3 Define and implement direct call record schema.
  - Slice: `P0.3`
  - Depends on: none; coordinate with P0.4 for CLI command flags.
  - Files/modules: `packages/runtime/src/adapters.ts`,
    `packages/cli/src/commands/call.ts`, new runtime call-history module,
    `packages/sdk/src/index.ts` if Studio reads through SDK,
    `tests-node/adapter-invocation.test.ts`, and new call-history tests.
  - Goal: make `agentmesh call` leave first-class local evidence without turning
    calls into workflow packets.
  - Actions:
    - Add call id generation and `.agentmesh/calls/<call-id>/` authoring helpers.
    - Resolve workspace before provider invocation; outside a workspace, fail
      before calling the provider unless an explicit `--no-record` escape hatch
      is present.
    - Write `call.json` atomically through status transitions:
      `running -> success|failed|timeout|aborted|stale`.
    - Write `prompt.md`, `output.md`, and `stderr.txt` according to redaction and
      copy policy.
    - Store external prompt/output refs as workspace-relative paths plus hash
      when safe; reject path escapes.
    - Store nullable token/cost/model metrics as `null` when unavailable.
  - Output: call record writer, schema normalizer, CLI behavior, and fixtures.
  - Verification: tests cover success, adapter failure, timeout, Ctrl-C/abort if
    testable, missing workspace refusal, `--no-record` warning, external
    `--output-file`, path escape refusal, redaction state, concurrent calls with
    unique ids, stale `running` detection, and newer-schema read-only handling.
  - Review: confirm call records do not masquerade as run packets and do not
    store provider tokens, cookies, keychain material, or raw secret-like text.
  - Evidence: generated sample call record, test output, changelog entry, commit.
  - Progress record: completed 2026-05-17. Added runtime call-history writer /
    reader for `.agentmesh/calls/<call-id>/`, CLI recording for success,
    adapter failure, timeout, external output refs, `--no-record`, stale
    running detection, and newer-schema read-only warnings.
  - Submit as: `feat(cli): persist direct call history`.

- [x] P0.4 Add direct call adoption state machine.
  - Slice: `P0.4`
  - Depends on: P0.3.
  - Files/modules: new call-history runtime module, App Server call APIs when
    created, `tests-node/adapter-invocation.test.ts` or new adoption tests.
  - Goal: let users mark direct call outputs as accepted/rejected/superseded
    without mutating original prompt/output artifacts.
  - Actions:
    - Add append-only `adoption.jsonl` helper.
    - Validate transitions from `unreviewed` to `accepted`, `rejected`, or
      `superseded`.
    - Record `updated_by_entrypoint`, `reason`, `related_commit`,
      `related_run_id`, and `superseded_by_call_id` when provided.
    - Keep original `call.json`, `prompt.md`, `output.md`, and external files
      immutable except for bounded metadata needed to show current adoption.
  - Output: adoption writer/reader and transition validation.
  - Verification: tests cover valid transitions, invalid transitions,
    append-only events, unsupported schema read-only behavior, and dangling
    related run/call links.
  - Review: confirm adoption is local evidence metadata and does not imply the
    referenced output was committed.
  - Evidence: sample `adoption.jsonl`, test output, changelog entry, commit.
  - Progress record: completed 2026-05-17. Added append-only
    `adoption.jsonl` event helpers, one-way `unreviewed` adoption transitions
    to `accepted`, `rejected`, or `superseded`, newer-schema read-only
    mutation refusal, and bounded `call.json` metadata updates for current
    adoption plus related run/call links.
  - Submit as: `feat(runtime): add call adoption metadata`.

- [x] P0.5 Harden bootstrap and provider discovery contracts.
  - Slice: `P0.5`
  - Depends on: none for server auth; provider discovery may depend on existing
    adapter readiness helpers.
  - Files/modules: `apps/studio/src/server.ts`, `apps/studio/src/args.ts`,
    `apps/studio-desktop/src/host.ts`, `apps/studio-desktop/src/options.ts`,
    `packages/runtime/src/adapters/registration.ts`,
    `packages/runtime/src/doctor/readiness.ts`,
    `tests-node/studio.test.ts`, `tests-node/studio-cli.test.ts`,
    `tests-node/studio-desktop-options.test.ts`, and
    `tests-node/readiness.test.ts`.
  - Goal: make dynamic App Server bootstrap safe and make desktop provider CLI
    discovery deterministic for GUI-launched apps.
  - Actions:
    - Ensure tokenized launch, auth cookie, and `/api/bootstrap` behavior are all
      protected by per-launch auth.
    - Redact token query parameters from request and error logs.
    - Add reload/crash recovery behavior that does not require an unauthenticated
      bootstrap endpoint.
    - Implement provider CLI resolution diagnostics for explicit path, app
      preference, well-known location, and controlled login-shell probe.
    - Reject aliases/functions/relative paths/workspace-local paths from the
      shell probe.
  - Output: bootstrap auth tests, provider resolver tests, diagnostics.
  - Verification: tests cover missing/invalid token, cookie auth, reload
    recovery path, `/api/bootstrap` refusal without auth, token log redaction,
    GUI-launched PATH absence, mock provider in user-local bin, rejected alias
    output, and provider-missing diagnostics.
  - Review: confirm packaged desktop still binds only loopback and no fixed
    product port or shared project-config token is introduced.
  - Evidence: test output, provider resolver diagnostics fixture, changelog
    entry, commit.
  - Progress record: completed 2026-05-17. Added authenticated
    `/api/bootstrap`, HttpOnly launch cookie support, unauthenticated bootstrap
    fallback refusal, desktop launch URL token redaction, and provider tool
    discovery diagnostics for configured paths, app preferences, well-known
    locations, and controlled login-shell probes that reject aliases,
    functions/relative output, multi-line output, and workspace-local paths.
  - Submit as: `feat(studio): harden bootstrap and provider discovery`.

- [x] P0.6 Modernize entry skill installation targets.
  - Slice: `P0.6`
  - Depends on: none; coordinate with README and AgentMesh Skill docs because
    this changes setup instructions.
  - Files/modules: `packages/runtime/src/skill/verify.ts`,
    `packages/cli/src/commands/skill.ts`, `tests-node/readiness.test.ts`,
    `README.md`, `agentmesh-skill/SKILL.md`, and any CLI help snapshots or docs
    that list supported `skill install --target` values.
  - Goal: make AgentMesh Skill installation match current host conventions and
    use `.agents/skills` as the shared project-level default wherever official
    host support exists.
  - Actions:
    - Add `opencode` to `SkillTarget`, CLI allowlist, install, and verify paths.
    - Make `codex`, `cursor`, `gemini`, `opencode`, and `copilot` install and
      verify the shared project path `.agents/skills/agentmesh/SKILL.md`.
    - Keep `claude` on `.claude/skills/agentmesh/SKILL.md` because that is the
      official Claude Code project skill path currently verified.
    - Treat old `.cursor/rules/agentmesh.mdc` as legacy compatibility evidence:
      `verify` may report it, but install must not delete it automatically.
    - Do not write redundant `.cursor/skills`, `.gemini/skills`,
      `.opencode/skills`, `.github/skills`, `~/.copilot/skills`, or Gemini
      extension files in the default project install path unless a later scope
      or host-specific option explicitly asks for them.
    - Keep user-level installs out of this first slice unless the CLI also adds
      an explicit `--scope user` contract.
    - Update setup docs to show when users should run `--target codex`,
      `--target cursor`, `--target gemini`, `--target opencode`,
      `--target claude`, or `--target copilot`.
  - Output: updated target matrix, host-specific install files, verify
    diagnostics, setup docs, and migration notes for legacy Cursor rules and
    old host-native AgentMesh installs.
  - Verification: tests with temporary `HOME`, `CODEX_HOME`, and cwd cover
    Codex, Cursor, Gemini, OpenCode, and Copilot all resolving to
    `.agents/skills/agentmesh/SKILL.md`; Claude resolving to
    `.claude/skills/agentmesh/SKILL.md`; mismatch/missing reports; legacy
    `.cursor/rules` detection; `--force` refresh; and unsupported target usage.
  - Review: confirm `.agents/skills` is used only for hosts with verified
    official support, Claude remains on `.claude/skills`, no host file outside
    the selected target is deleted, and docs match implementation.
  - Evidence: target matrix test output, CLI help output, docs diff, changelog
    entry, commit.
  - Progress record: completed 2026-05-17. Added `opencode` as a Skill target;
    changed `codex`, `cursor`, `gemini`, `opencode`, and `copilot` to install
    and verify the shared project `.agents/skills/agentmesh/SKILL.md`; changed
    `claude` to the project `.claude/skills/agentmesh/SKILL.md`; and reports
    legacy `.cursor/rules/agentmesh.mdc` as `legacy_only` without deleting it.
  - Submit as: `feat(skill): modernize host install targets`.

- [x] P0.Z Runtime contract phase review.
  - Slice: `P0.Z`
  - Depends on: P0.1-P0.6.
  - Goal: prove later Studio/desktop slices can build on stable runtime
    contracts and entry-agent setup behavior.
  - Verification: run `npm test`, `npm run build` if available, and targeted
    tests for compatibility metadata, lock owner metadata, direct call records,
    bootstrap auth, provider discovery, and skill install target matrix.
  - Review: ask at least one reviewer to challenge the P0 contracts before P1.
    Accepted findings must be fixed or converted into explicit risks before P1
    starts.
  - Evidence: release-gate style note with diff summary, verification output,
    accepted/rejected/unresolved findings, changelog entry, commit, and updated
    current next step.
  - Progress record: completed 2026-05-17. Added
    `docs/reviews/workflow/p0-runtime-contract-prerequisites-2026-05-17.md`
    with diff summary, verification evidence, review verdict `ready`, no open
    Must Fix findings, and residual risks for external review, provider
    preference UI, and call redaction follow-up.
  - Submit as: `docs(plan): close runtime contract prerequisites`.

### P1. Establish Vite React Baseline

- [x] P1 phase gate: start only after P0.Z is complete; complete P1.1, P1.2,
      P1.3, and P1.Z before marking P1 done.

- [x] P1.1 Add Vite + React infrastructure.
  - Slice: `P1.1`
  - Depends on: P0.Z.
  - Files/modules: `package.json`, root build scripts, `apps/studio/src/server.ts`,
    `apps/studio/src/assets.ts`, new `apps/studio/src/frontend/*`, Vite config,
    TypeScript config if needed, and `tests-node/package-structure.test.ts`.
  - Scope: add Vite config, React dependencies, frontend entry, build scripts,
    and server asset loading.
  - Actions:
    - Add Vite/React/TypeScript build entry without changing Studio behavior.
    - Keep App Server as the only HTTP/API owner.
    - Replace embedded/static asset wiring only after server asset tests cover
      both dev and built modes.
  - Keep behavior equivalent to the current Studio landing shell.
  - Output: buildable React shell, server asset route support, package scripts,
    and tests proving frontend does not import runtime packages directly.
  - Verification: `npm run build`, `npm test`.
  - Review: confirm no runtime package import from frontend and no packet
    mutation logic moves into React.
  - Progress record: completed 2026-05-17. Added Vite + React dependencies,
    root build scripts, a buildable React frontend shell, optional App Server
    built asset serving with path containment, and structure/server tests that
    keep frontend code behind App Server APIs. Verified `npm run build` and
    `npm test`.
  - Submit as: `feat(studio): add vite react baseline`.

- [x] P1.2 Add typed API client and bootstrap handling.
  - Slice: `P1.2`
  - Scope: central API client, auth token handling, API error normalization, and
    bootstrap behavior for browser and packaged modes.
  - Depends on: P0.5 bootstrap contract.
  - Files/modules: `apps/studio/src/server.ts`,
    `apps/studio/src/frontend/api/*`, `apps/studio/src/frontend/app/*`,
    `apps/studio-desktop/src/host.ts` if packaged-mode bootstrap is touched, and
    `tests-node/studio.test.ts`.
  - Actions:
    - Add one API client that owns token/header behavior.
    - Normalize auth, network, and server errors into UI-safe shapes.
    - Keep token in memory or protected cookie path only; do not persist it to
      project config or local storage.
  - Output: typed client, bootstrap state model, error normalization, tests.
  - Verification: unit tests for token/header behavior, cookie fallback,
    `/api/bootstrap` auth refusal, server health/API smoke, and token redaction
    in request/error logs.
  - Review: confirm no fixed port contract, unauthenticated bootstrap endpoint,
    or duplicated token handling is introduced.
  - Progress record: completed 2026-05-17. Added a frontend API client that
    owns bearer-token and cookie-fallback behavior, normalizes auth/http/network
    errors with token redaction, bootstraps React state from `/api/bootstrap`,
    and removes one-time launch tokens from browser history. Verified targeted
    API/bootstrap tests, `npm run build`, and `npm test`.
  - Submit as: `feat(studio): add typed api bootstrap client`.

- [x] P1.3 Migrate a low-coupling pilot view.
  - Slice: `P1.3`
  - Scope: settings or catalog first.
  - Depends on: P1.1 and P1.2.
  - Files/modules: `apps/studio/src/catalog.ts`,
    `apps/studio/src/server.ts`, new `apps/studio/src/frontend/features/catalog/*`
    or `features/settings/*`, and `tests-node/studio-ui.test.ts`.
  - Goal: prove React rendering, i18n, API client, styling, and tests without
    touching the most stateful run workspace first.
  - Actions:
    - Pick exactly one pilot view: catalog if API-backed behavior is ready,
      otherwise settings.
    - Keep old view reachable or covered until parity is proven.
    - Add empty/loading/error states and 375px smoke coverage.
  - Verification: `npm test` plus browser smoke.
  - Review: confirm design matches Studio's operational UI style and does not
    introduce optional heavy dependencies.
  - Progress record: completed 2026-05-17. Chose catalog as the API-backed
    pilot view, added React catalog loading/rendering for loaded, empty,
    loading, and error states, kept the legacy embedded catalog reachable, and
    added responsive 375px style coverage. Verified targeted Studio UI/API
    tests, `npm run build`, `npm test`, and a Chrome browser smoke against the
    built React asset path.
  - Submit as: `feat(studio-ui): migrate pilot react view`.

- [x] P1.Z Phase review.
  - Slice: `P1.Z`
  - Depends on: P1.1-P1.3.
  - Goal: decide whether the React baseline is stable enough to migrate the run
    workspace.
  - Verification: `npm run build`, `npm test`, browser smoke for desktop and
    375px width, and a source scan confirming frontend has no runtime imports.
  - Review: review P1 diff for architecture boundary, UI regression risk, and
    dependency creep. Accepted findings must be fixed before P2 starts.
  - Evidence: diff size, test output, reviewer findings, UI smoke notes,
    changelog entry, commit id, and any regressions.
  - Progress record: completed 2026-05-17. Added
    `docs/reviews/workflow/p1-react-baseline-2026-05-17.md`, recorded P1 diff
    size, verification output, Chrome UI smoke notes, source scan, changelog
    evidence, and the fixed browser fetch finding. Verdict: ready for P2.
  - Submit as: `docs(plan): close react baseline phase`.

### P2. Migrate Core Workbench

- [x] P2 phase gate: start only after P1.Z is complete; run list, run detail,
      artifacts, events, review/release, safe actions, agent lifecycle controls,
      and direct call history are migrated with parity tests.
  - Progress record: closed 2026-05-17. P2.1-P2.8d and P2.Z completed the
    required React workbench migration scope with parity evidence for Runs,
    Calls, artifacts, events, review/release, safe actions, agent lifecycle,
    and direct call adoption. Evidence is recorded in
    `docs/reviews/workflow/p2-studio-react-workbench-2026-05-17.md`.

- [x] P2.1 Migrate run navigator and selection state.
  - Slice: `P2.1`
  - Depends on: P1.Z.
  - Files/modules: `apps/studio/src/packet-browser.ts`,
    `apps/studio/src/server.ts`, `apps/studio/src/frontend/features/runs/*`,
    shared API client/types, and `tests-node/studio-ui.test.ts`.
  - Scope: migrate run list, search/filter, grouping, selection, and empty/error
    states into React.
  - Verification: search/filter behavior, selected run persistence, empty/error
    states, 375px layout.
  - Review: confirm React gets run data through APIs only and does not duplicate
    packet parsing.
  - Progress record: completed 2026-05-17. Added typed frontend run API loading,
    React run navigator states, date grouping, search/filter, refresh, and
    default/retained selection. Verified targeted Studio UI/package tests,
    `npm test`, `git diff --check`, frontend source-boundary scan, and Chrome
    smoke against built React assets.
  - Submit as: `feat(studio-ui): migrate run navigator`.

- [x] P2.2 Migrate run overview and stage timeline.
  - Slice: `P2.2`
  - Depends on: P2.1.
  - Files/modules: `apps/studio/src/frontend/features/runs/*`,
    API run detail types, timeline components, and tests.
  - Scope: migrate selected run summary, status, stage timing, current/failed
    stage display, and long-id wrapping.
  - Verification: stage state rendering, timing display, current/failed states,
    long IDs wrapping.
  - Review: confirm run stage state names match packet/SDK semantics and no
    frontend-only state reinterpretation is introduced.
  - Progress record: completed 2026-05-17. Added typed run detail API loading,
    React run overview, Workflow Flow stage nodes, SDK-aligned stage status
    helpers, stage timing summaries, current/failed state display, and long-id
    wrapping styles. Verified build, targeted Studio UI/package tests,
    `npm test`, `git diff --check`, frontend source-boundary scan, and headless
    Chrome DOM smoke against built React assets.
  - Submit as: `feat(studio-ui): migrate run overview timeline`.

- [x] P2.3 Migrate artifacts and preview.
  - Slice: `P2.3`
  - Depends on: P2.2.
  - Files/modules: `apps/studio/src/packet-browser.ts`,
    `apps/studio/src/server.ts`, `apps/studio/src/frontend/features/artifacts/*`,
    preview components, and tests.
  - Scope: migrate artifact list, metadata display, preview loading, preview
    errors, and large/unsupported preview handling.
  - Verification: artifact list, preview loading, truncation/error states,
    source metadata display.
  - Review: confirm previews are read-only and never write artifacts from the
    browser.
  - Progress record: completed 2026-05-17. Added typed artifact preview API
    loading, React artifact list and preview panel, event/timing-based artifact
    ordering, metadata/truncated/error/empty/unsupported-preview states, and
    responsive preview styles. Verified build, targeted Studio UI/package tests,
    `npm test`, `git diff --check`, frontend source-boundary scans, write-API
    scan, and headless Chrome DOM smoke against built React assets.
  - Submit as: `feat(studio-ui): migrate artifact preview`.

- [x] P2.4 Migrate events/log view.
  - Slice: `P2.4`
  - Depends on: P2.2.
  - Files/modules: `apps/studio/src/packet-browser.ts`,
    `apps/studio/src/server.ts`, `apps/studio/src/frontend/features/runs/*`,
    event pagination components, and tests.
  - Scope: migrate event page loading, newest/older navigation, failure event
    rendering, and large-list performance behavior.
  - Verification: pagination, newest/older navigation, large event lists,
    failure rendering.
  - Review: confirm event pagination remains server/SDK-backed and the UI does
    not load unbounded event files by default.
  - Progress record: completed 2026-05-17. Added bounded event page options to
    the React run detail API, React event log rendering, newest/older/newer
    navigation, descending event ordering, large-page current-window rendering,
    and failure highlighting based on failed events, errors, timeouts, or
    nonzero exit codes. Verified build, targeted Studio UI/package tests,
    `npm test`, `git diff --check`, frontend source-boundary scan, and headless
    Chrome DOM smoke against built React assets.
  - Submit as: `feat(studio-ui): migrate event log view`.

- [x] P2.5 Migrate review/release evidence.
  - Slice: `P2.5`
  - Depends on: P2.2 and P2.3.
  - Files/modules: `apps/studio/src/frontend/features/review-release/*`,
    release/review API types, `packages/sdk/src/index.ts` if read shape changes,
    and tests.
  - Scope: migrate findings, raw review files, release summary, skipped checks,
    residual risk, and final verdict display.
  - Verification: grouped findings, evidence sections, raw reviews, skipped
    checks, residual risk, release verdict.
  - Review: confirm release gate semantics are displayed faithfully and skipped
    verification remains visible.
  - Progress record: completed 2026-05-17. Added typed React API coverage for
    review/release evidence, migrated release verdict, grouped findings,
    release summary sections, skipped checks, residual risk, and raw review tabs
    into `ReviewReleaseView`, and mounted it in the run workspace after artifact
    preview. Verified build, targeted Studio UI/package tests, `npm test`,
    `git diff --check`, frontend source-boundary scan, and headless Chrome DOM
    smoke against built React assets with real run review evidence.
  - Submit as: `feat(studio-ui): migrate review release evidence`.

- [x] P2.6 Migrate safe actions.
  - Slice: `P2.6`
  - Depends on: P0.1, P0.2, and at least P2.1 for selected-run context.
  - Files/modules: `apps/studio/src/mutations.ts`, `apps/studio/src/server.ts`,
    safe-action UI components, CLI command allowlist, and
    `tests-node/studio.test.ts`.
  - Scope: migrate dispatch/retry/resume/attach action entry points while
    preserving App Server/CLI-backed execution.
  - Verification: dispatch/retry/resume/attach commands remain App
    Server/CLI-backed and expose stdout/stderr/exit code.
  - Review: confirm action allowlist is server-owned, lock-aware, and cannot be
    bypassed from React.
  - Progress record: completed 2026-05-17. Added a React safe actions panel
    for dispatch, retry, resume, and attach text requests, introduced a
    frontend mutation API that preserves non-2xx CLI evidence, kept the App
    Server as the command allowlist and CLI-backed execution boundary, and
    refreshes runs/details after mutation responses. Verified request-shape
    construction, API token/body handling, 409 stdout/stderr/exit-code
    visibility, server failed-mutation evidence, build, targeted Studio
    UI/server/package tests, `npm test`, `git diff --check`, frontend
    source-boundary scan, and headless Chrome DOM/click smoke against built
    React assets with a temporary workspace and fake CLI.
  - Submit as: `feat(studio-ui): migrate safe run actions`.

- [x] P2.7 Add agent lifecycle controls.
  - Slice: `P2.7`
  - Scope: create, delete, enable, disable, and status inspection for agents.
  - Depends on: P0.1 compatibility metadata and P0.2 mutation locks.
  - Files/modules: `packages/cli/src/commands/agents.ts`,
    `packages/runtime/src/adapters.ts` or registration helpers,
    `apps/studio/src/server.ts`, `apps/studio/src/mutations.ts`,
    `apps/studio/src/frontend/features/agents/*`, and
    `tests-node/management-cli.test.ts` / `tests-node/studio.test.ts`.
  - Output: `/api/v1/agents` endpoints, lifecycle operation records, SSE status
    stream or polling fallback, and React controls.
  - Verification: UI calls `/api/v1/agents` lifecycle APIs only; lifecycle
    status uses SSE with operation-id correlation; duplicate and overlapping
    mutations return explicit conflict responses; App Server delegates to
    existing CLI/runtime behavior; deleting a running agent requires an explicit
    safe stop or refusal path; lifecycle status and failure details are visible
    after each operation; CLI parity commands exist for listing and inspecting
    agent state changed by Studio.
  - Review: confirm no lifecycle mutation is implemented in Tauri/Rust or
    browser-only code.
  - Progress record: completed 2026-05-17. Added CLI `agents show`,
    `agents enable`, and `agents disable` parity, persisted agent
    `disabled`/`status` metadata through runtime config, SDK, catalog, and
    Studio, exposed CLI-backed `/api/v1/agents` list/create/show/delete and
    enable/disable endpoints with operation records and polling lookup, and
    added React agent lifecycle controls under the configuration workspace.
    Delete now refuses agents assigned to active running runs instead of
    silently removing them. Verified lifecycle CLI status changes, App Server
    command allowlist/delegation, operation evidence, active-run delete
    refusal, React API endpoint usage, build, targeted management/Studio/UI
    tests, `npm test`, `git diff --check`, frontend source-boundary scan, and
    headless Chrome DOM/click smoke against built React assets with a temporary
    workspace and fake CLI.
  - Submit as: `feat(studio): add agent lifecycle controls`.

- [x] P2.8a Add App Server Calls read APIs.
  - Slice: `P2.8a`
  - Depends on: P0.3 and P0.4.
  - Files/modules: `apps/studio/src/server.ts`,
    `apps/studio/src/packet-browser.ts` or a new `calls-browser.ts`,
    `packages/sdk/src/index.ts` if the SDK exposes call reads, and
    `tests-node/studio.test.ts`.
  - Scope: expose call index/detail endpoints backed by `.agentmesh/calls/*`.
  - API target: `GET /api/calls` returns grouped or sortable call summaries;
    `GET /api/calls/:id` returns metadata, prompt/output refs, stderr summary,
    adoption status, related run/call links, and dangling-link warnings.
  - Verification: APIs list calls by date, ignore incomplete temp directories,
    mark stale `running` records, preserve read-only behavior for unsupported
    schemas, never scan `docs/reviews/**/*.md` as source of truth, and return clear
    404/invalid-id errors.
  - Review: confirm App Server reads call records but does not mutate original
    prompt/output artifacts.
  - Progress record: completed 2026-05-17. Added SDK-backed call read
    wrappers, a Studio `calls-browser` projection, and `GET /api/calls` plus
    `GET /api/calls/:id`. The API groups calls by date, returns bounded
    prompt/output/stderr previews, exposes adoption events/status and related
    run/call links, marks stale running records without writing them back,
    preserves newer-schema records as read-only, warns on dangling
    `output_path`, ignores incomplete temp directories and `docs/reviews`
    files, and returns clear 404 / invalid-id errors. Verification: red/green
    Studio server API test, `npm run build`, targeted Studio/package-structure
    tests, `npm test`, `git diff --check`, and frontend source-boundary scan.
  - Submit as: `feat(studio): expose direct call APIs`.

- [x] P2.8b Add Calls tab list/detail UI.
  - Slice: `P2.8b`
  - Depends on: P2.8a and React workbench shell.
  - Files/modules: `apps/studio/src/frontend/features/calls/*`,
    shared API client/types, navigation components, and React behavior tests.
  - Scope: add `Runs` / `Calls` navigation, calls list grouping, and call detail
    rendering.
  - Verification: Studio lists calls grouped by date; detail renders prompt,
    output, stderr/failure summary, related files, adoption status, output links,
    unsupported-schema warnings, stale/incomplete status, and dangling
    `output_path` warnings; existing workflow runs still appear only under
    `Runs`; 375px layout wraps long ids and paths.
  - Review: confirm React uses App Server APIs only and does not read
    `.agentmesh/calls/*` directly.
  - Progress record: completed 2026-05-17. Added typed frontend Calls API
    helpers, a `Calls` navigation path beside `Runs`, a date-grouped call
    navigator, and a call detail view for prompt/output/stderr previews,
    failure summaries, related file/run/call links, adoption status/history,
    unsupported-schema warnings, stale status, and dangling `output_path`
    links. Runs remain on the Runs tab, and the Calls React code uses only App
    Server endpoints. Verification: red/green React tests, `npm run build`,
    targeted Studio/UI/package-structure tests, Chrome headless smoke against
    built React assets at desktop width, `npm test` (435/435), `git diff
    --check`, and frontend source-boundary scan.
  - Submit as: `feat(studio-ui): add direct calls tab`.

- [x] P2.8c Add call adoption UI.
  - Slice: `P2.8c`
  - Depends on: P0.4 and P2.8b.
  - Files/modules: App Server adoption endpoint, runtime adoption helper if not
    already exposed, `apps/studio/src/frontend/features/calls/*`, and tests.
  - Scope: allow local adoption state changes for direct calls.
  - Verification: valid accepted/rejected/superseded actions append to
    `adoption.jsonl`; invalid transitions are rejected with user-visible
    reasons; unsupported-schema call records render adoption controls disabled;
    original prompt/output files remain unchanged.
  - Review: confirm adoption UI labels are local evidence markers, not proof
    that the output was committed or shipped.
  - Progress record: completed. Added the Studio App Server
    adoption endpoint, SDK append helper, React calls adoption API, local
    evidence marker controls, disabled unsupported-schema states, and
    user-visible rejection messages. Verified accepted/rejected/superseded
    actions append `adoption.jsonl` without changing prompt/output artifacts;
    invalid transitions and future schemas are rejected with visible reasons.
    Evidence: red `npm run build:node` failure before API implementation,
    `node --test dist-node/tests-node/studio.test.js
    dist-node/tests-node/studio-ui.test.js`, `npm run build`, `npm test`
    (437/437), `git diff --check`, frontend source-boundary scan, and Chrome
    headless smoke against built React assets after clicking an adoption action.
  - Submit as: `feat(studio-ui): add call adoption actions`.

- [x] P2.8d Calls tab cleanup decision.
  - Slice: `P2.8d`
  - Depends on: P2.8b.
  - Scope: decide whether first release includes only read/adoption state or also
    archive/delete cleanup.
  - Default decision: first release does not include archive/delete. It displays
    stale, dangling, and superseded states but keeps all call directories.
  - If cleanup is pulled into scope: add explicit runtime cleanup helpers,
    App Server endpoints, UI confirmation, `_archive` behavior, and tests that
    referenced committed files are never deleted.
  - Verification: plan/changelog records the decision; UI text and disabled
    states match the decision.
  - Review: confirm no accidental destructive cleanup ships without a separate
    explicit slice.
  - Progress record: completed. Decision: first release keeps Calls tab scoped
    to read/adoption state only. It may display stale, dangling, read-only, and
    superseded states, but it does not expose archive/delete/cleanup actions
    and does not move or remove `.agentmesh/calls/*` directories. Any future
    cleanup must be a separate explicit slice with runtime helpers, App Server
    endpoints, confirmation UI, `_archive` semantics, and tests proving linked
    committed files are never deleted. Verification: plan/changelog record this
    decision; calls source scan found no cleanup/archive/delete action in the
    Calls tab path; existing call detail tests keep unsupported-schema adoption
    controls disabled and adoption-only actions visible.
  - Submit as: `docs(plan): decide calls cleanup scope`.

- [x] P2.Z Phase review.
  - Slice: `P2.Z`
  - Depends on: P2.1-P2.8d.
  - Goal: remove old embedded frontend paths only after React parity is proven.
  - Verification: `npm run build`, `npm test`, browser smoke for desktop and
    375px width, manual smoke for Runs, Calls, artifacts, events,
    review/release, safe actions, and agent lifecycle.
  - Review: compare old/new Studio behavior and record accepted/rejected
    findings. Do not delete old paths until parity evidence exists.
  - Evidence: UI smoke notes, test output, review result, changelog entry,
    commit id, and updated current next step.
  - Progress record: completed. Added
    `docs/reviews/workflow/p2-studio-react-workbench-2026-05-17.md` with the
    P2.1-P2.8d commit list, diff summary, verification evidence, review
    findings, deferred embedded fallback cleanup decision, residual risks, and
    ready-for-P3.0 verdict. Verification: `npm run build`, `npm test`
    (437/437), Chrome headless smoke against built React assets at 1365px
    desktop width and 375px mobile width, manual coverage for Runs, Calls,
    artifacts, events, review/release, safe actions, and agent lifecycle,
    frontend source-boundary scan, Calls cleanup scope scan, and changelog
    entry. Old embedded assets remain as the no-`assetDir` CLI fallback until a
    later explicit cleanup after P3.0/P3.1 serving-path evidence.
  - Submit as: `docs(plan): close core workbench migration`.

### P3. Desktop Packaging Path

- [x] P3.0 Desktop shell spike.
  - Slice: `P3.0`
  - Scope: validate Tauri 2 as the final desktop shell before committing to
    packaged desktop work.
  - Depends on: P0.5 for bootstrap/provider discovery contract evidence.
  - Files/modules: `apps/studio-desktop/src/*`,
    `apps/studio-desktop/src-tauri/tauri.conf.json`, desktop package scripts,
    and `tests-node/studio-desktop-options.test.ts`.
  - Verification: dynamic port plus token bootstrap, app-bundled Node sidecar,
    sidecar restart/crash behavior, no PATH dependency, unsigned internal DMG
    build for the selected macOS/CPU target, WKWebView smoke for current React
    UI, and native-module/terminal feasibility if those are still target
    requirements.
  - Output: recorded macOS minimum version, CPU architecture target, sidecar
    packaging notes, and explicit Tauri/Electron continue-or-switch decision.
  - Decision gate: continue Tauri if the spike passes; switch to Electron only
    if a concrete blocker makes Tauri more expensive or less reliable than
    Electron for required product behavior.
  - Review: explicitly compare spike evidence against the Electron fallback
    threshold in section 2.
  - Progress record: completed 2026-05-17 in
    `docs/reviews/studio/p3-tauri-shell-spike-2026-05-17.md`. Decision:
    continue Tauri. Recorded first macOS target `darwin-aarch64`, minimum macOS
    `12.0`, app-managed `externalBin` sidecar packaging notes, and Electron
    fallback threshold. Verified dynamic port/token bootstrap and host restart
    token replacement with node tests, plus development/signed-dry-run/metadata
    distribution smokes. Local host had macOS arm64 and codesign available but
    lacked Rust/Cargo/Tauri CLI, so real WKWebView smoke and unsigned DMG build
    remain explicit P3.1/P3.4 packaging-host gates rather than claimed P3.0
    passes.
  - Submit as: `test(desktop): spike tauri shell path`.

- [x] P3.1 Wire Tauri shell to app-bundled App Server.
  - Slice: `P3.1`
  - Depends on: P3.0.
  - Files/modules: `apps/studio-desktop/src/host.ts`,
    `apps/studio-desktop/src/options.ts`, `apps/studio/src/server.ts`,
    Tauri config, and desktop tests.
  - Verification: app opens React UI from dynamic local server with token.
  - Review: confirm Tauri owns process/window lifecycle only and does not import
    runtime packet/workflow modules.
  - Progress record: completed 2026-05-17 in
    `docs/reviews/studio/p3-tauri-shell-wiring-2026-05-17.md`. Added local
    bootstrap shell assets, minimal Rust Tauri entrypoint, `tauri-plugin-shell`
    sidecar startup, machine-readable `--launch-json` sidecar readiness, and
    window navigation to the dynamic tokenized App Server URL. Desktop host now
    defaults to built Vite React assets instead of the embedded fallback.
    Verified with build plus desktop option/distribution tests, sidecar
    launch-json smoke fetching built React assets from the tokenized URL,
    development package smoke, and source scan proving the Tauri shell does not
    import runtime/packet/workflow logic. Real WKWebView launch was not run
    locally because this host still lacks Rust/Cargo/Tauri CLI; keep that as a
    packaging-host smoke gate.
  - Submit as: `feat(desktop): wire tauri sidecar bootstrap`.

- [x] P3.2 Prove sidecar packaging.
  - Slice: `P3.2`
  - Depends on: P3.1.
  - Files/modules: `apps/studio-desktop/src-tauri/tauri.conf.json`, desktop
    packaging scripts/config, root build scripts, and
    `tests-node/studio-desktop-distribution.test.ts`.
  - Verification: development package smoke, app-bundled runtime path, no PATH
    dependency for app-originated mutations.
  - Review: confirm packaged app uses absolute bundled paths for AgentMesh
    runtime and Node App Server, not global `agentmesh`, global Node, pnpm, or
    source checkout paths.
  - Progress record: completed 2026-05-17 in
    `docs/reviews/studio/p3-sidecar-packaging-proof-2026-05-17.md`. Added
    `sidecar-bundle.ts`, target-triple launcher generation, bundled Node copy,
    Tauri `externalBin` sidecar base path, and `bundle.resources` coverage for
    `dist-node`. Verified development package smoke and a no-PATH sidecar
    mutation smoke proving the App Server process uses the bundled sidecar Node
    as `process.execPath` and the app runtime CLI path, not global `node`,
    global `agentmesh`, `pnpm`, or source checkout absolute paths. Real Tauri
    bundle execution remains a packaging-host gate because Rust/Cargo/Tauri CLI
    are unavailable locally.
  - Submit as: `feat(desktop): bundle app server runtime`.

- [x] P3.3 Preserve CLI Studio path.
  - Slice: `P3.3`
  - Depends on: P3.1.
  - Files/modules: `packages/cli/src/commands/studio.ts`,
    `apps/studio/src/server.ts`, `tests-node/studio-cli.test.ts`, and
    `tests-node/studio-distribution-coexistence.test.ts`.
  - Verification: `agentmesh studio` still starts the local web wrapper outside
    packaged desktop mode.
  - Review: confirm CLI Studio and `AgentMesh.app` use separate App Server
    sessions, dynamic port/token handling, and independent binary paths.
  - Progress record: completed 2026-05-17 in
    `docs/reviews/studio/p3-cli-studio-path-preservation-2026-05-17.md`.
    Added coexistence regression coverage that starts CLI Studio and desktop
    Studio for the same workspace at the same time, then verifies separate
    dynamic ports, separate token policy, CLI mutation path through
    `dist-node/packages/cli/src/cli.js`, and desktop mutation path through the
    app-bundled runtime CLI. No production code change was needed.
  - Submit as: `test(studio): preserve cli studio path`.

- [x] P3.4 Produce internal unsigned DMG.
  - Slice: `P3.4`
  - Scope: build a macOS DMG intended for team-internal installation.
  - Depends on: P3.0 selected macOS/CPU target and recorded minimum macOS
    version.
  - Files/modules: desktop package config, `apps/studio-desktop/distribution/*`,
    install docs or README section, and distribution smoke tests.
  - Verification: DMG installs on at least one clean teammate machine or clean
    macOS user profile matching the selected macOS/CPU target; app opens with
    documented Gatekeeper workaround; quarantine fallback command is documented;
    bundled App Server starts; no dependency on local source paths, global Node,
    pnpm, shell PATH, or developer-only environment variables.
  - Review: confirm this artifact is labeled internal-only and is not presented
    as a public/customer-ready build.
  - Evidence: DMG path, checksum if produced, clean-machine smoke notes, install
    notes, skipped items, changelog entry, commit id.
  - Progress record: completed 2026-05-17 in
    `docs/reviews/studio/p3-internal-dmg-2026-05-17.md`, superseding the
    earlier local blocker record in
    `docs/reviews/studio/p3-internal-dmg-blocker-2026-05-17.md`. Installed
    Rust/Cargo via rustup, generated standard Tauri icons, fixed `src-tauri`
    relative paths to root `dist-node`, made the sidecar launcher support
    packaged `AgentMesh.app/Contents/Resources/dist-node/...`, and copied
    production runtime dependencies into
    `dist-node/apps/studio-desktop/runtime-node_modules` before bundling; Tauri
    maps that staging directory to packaged `Resources/dist-node/node_modules`.
    Produced
    `apps/studio-desktop/src-tauri/target/debug/bundle/dmg/AgentMesh_0.1.0_aarch64.dmg`
    with SHA-256
    `5ca5a3901c2f05d5d4ab1f64c82c9ef282cad7e5a22df3854d1be36d86e972c7`.
    Verified `hdiutil verify` and mounted-DMG sidecar readiness with empty
    `PATH`; clean teammate / clean profile and full WKWebView first-open smoke
    remain manual internal-handoff checks.
  - Submit as: `build(desktop): produce internal dmg`.

- [x] P3.5 Verify CLI and DMG co-install behavior.
  - Scope: prove global CLI and installed `AgentMesh.app` can coexist on one
    machine while operating on the same workspace through shared contracts.
  - Depends on: P0.1 compatibility metadata, P0.2 mutation locks, P2.7 agent
    lifecycle controls, and P3.4 internal DMG.
  - Verification: create or inspect a run through global CLI and view it in
    Studio; create/delete or enable/disable an agent in Studio and verify the
    result through CLI; run both `agentmesh studio` and `AgentMesh.app` against
    the same workspace and verify separate App Server sessions stay readable;
    run a mutation conflict test showing shared JSON lock owner diagnostics and
    stale-lock behavior; poison `PATH` with a fake `agentmesh` and confirm
    desktop mutations still use the app-bundled runtime with an absolute bundle
    path in invocation diagnostics; hide or uninstall global CLI and confirm
    desktop still functions; remove or hide `AgentMesh.app` and confirm the
    global CLI still works; exercise both version-skew directions with fixtures
    and confirm unsupported reads or mutations are refused with actionable
    messages; verify GUI-launched desktop provider CLI discovery with a mock
    provider installed in a user-local bin directory; verify provider-missing
    diagnostics for both CLI and desktop channels.
  - Review: confirm CLI and DMG share packet/config/lock contracts without
    depending on each other's installation path, process, or App Server.
  - Evidence: smoke command notes, version-skew fixture results, lock conflict
    output, provider discovery diagnostics, changelog entry, commit id.
  - Progress record: completed 2026-05-17 in
    `docs/reviews/studio/p3-cli-dmg-coinstall-2026-05-17.md`. Existing
    automated coexistence coverage verifies separate CLI Studio / desktop
    Studio sessions, PATH poisoning, app-bundled CLI mutation path, shared
    filesystem lock diagnostics, and unsupported newer packet mutation refusal.
    Added mounted-DMG smoke evidence: started the packaged sidecar with empty
    `PATH`, read a shared run, wrote an artifact through the app-bundled CLI
    under `AgentMesh.app/Contents/Resources/dist-node/packages/cli/src/cli.js`,
    read the result through the source/global CLI, detached the DMG, then
    confirmed the CLI still read run status. Provider discovery and
    provider-missing diagnostics remain covered by readiness tests; literal
    `/Applications` drag-install and full GUI WKWebView first-open checks remain
    manual internal-handoff items.
  - Submit as: `test(desktop): verify cli dmg co-install`.

- [x] P3.Z Phase review.
  - Slice: `P3.Z`
  - Depends on: P3.0-P3.5.
  - Goal: confirm desktop shell remains lifecycle-only and does not own
    AgentMesh business logic, and confirm the internal DMG release checklist is
    satisfied.
  - Verification: run desktop distribution tests, co-install smoke, package
    smoke, and source scan for forbidden runtime imports in Tauri/Rust/desktop
    shell code.
  - Review: release-gate style review with verdict `ready`, `not_ready`, or
    `needs_decision` for internal DMG handoff.
  - Evidence: DMG install notes, co-install smoke, review result, changelog
    entry, commit id, and public-distribution deferral note.
  - Progress record: completed 2026-05-17 in
    `docs/reviews/studio/p3-desktop-packaging-phase-2026-05-17.md`. Verdict:
    ready for internal unsigned DMG handoff, not ready for public signed
    distribution. Rust remains lifecycle-only, Node/App Server owns runtime and
    mutation behavior, packaged sidecar uses app resources, and signed /
    notarized release remains a separate certificate-capable gate.
  - Submit as: `docs(plan): close desktop packaging phase`.

### P4. Optional Capability Additions

Only start these after P1-P3 evidence shows the need:

- React Flow for workflow graph/canvas.
- Monaco for code-like config/artifact editing.
- xterm.js for terminal-like streaming.
- Zustand for cross-zone UI state if React state plus TanStack Query becomes
  awkward.
- TanStack Table for advanced table interactions.

Plan status: no required P4 implementation is open. These remain deferred
extension points and are not completion blockers for the P0-P3 Plan C execution
path.

## 7. Verification Strategy

Required automated checks:

- `npm run build`
- `npm test`
- Workspace compatibility metadata tests
- Entrypoint-aware mutation lock tests
- Studio server asset route tests
- API client auth/bootstrap tests
- Provider CLI resolver tests for GUI-launched desktop mode
- Entry skill install target matrix tests for shared `.agents/skills` behavior
  across Codex, Cursor, Gemini, OpenCode, and Copilot, plus Claude's separate
  `.claude/skills` path
- React behavior tests for migrated views
- Call history persistence and Calls tab tests
- Call record schema, redaction, crash recovery, path containment, adoption
  event, and dangling-link tests
- Newer-schema read-only tests for call records and compatibility metadata

Required manual checks when UI changes:

- desktop viewport smoke
- 375px narrow viewport smoke
- no horizontal page scroll
- long run IDs and artifact paths wrap correctly
- mutation output remains visible and command-backed

Required internal DMG checks:

- unsigned DMG builds successfully
- install and first-open flow is documented for team members
- selected macOS minimum version and CPU architecture are recorded
- clean-machine smoke proves the bundled App Server and CLI/runtime work without
  local developer dependencies
- co-install smoke proves global CLI and installed DMG can operate on the same
  workspace without depending on each other's binary path or App Server process
- artifact is labeled internal-only

Deferred public distribution checks:

- Developer ID Application signing
- Apple notarization
- staple notarization ticket
- public update channel and external release notes

Release gate must include:

- diff summary
- verification commands and results
- accepted/rejected/unresolved review findings
- skipped verification, if any
- residual risk
- one verdict line: `Verdict: ready`, `Verdict: not_ready`, or
  `Verdict: needs_decision`

## 8. Risks And Controls

- Risk: big-bang rewrite hides regressions.
  - Control: migrate one view slice at a time and keep old behavior until parity
    is verified.
- Risk: React UI duplicates runtime logic.
  - Control: frontend only calls UI-shaped APIs; mutation allowlist stays server
    and CLI-backed.
- Risk: Tauri becomes a second runtime.
  - Control: Rust shell owns lifecycle only; code review blocks packet/workflow
    logic in Rust commands.
- Risk: create/delete agent behavior leaks into desktop shell code.
  - Control: lifecycle endpoints live in the App Server; Tauri only manages
    sidecar lifecycle and bootstrap.
- Risk: Tauri shell proves more expensive than Electron for required desktop
  behavior.
  - Control: P3.0 is a mandatory spike with an explicit Electron fallback gate.
- Risk: internal unsigned DMG creates confusing install friction.
  - Control: document first-open steps and verify on a clean teammate machine
    before sharing the artifact.
- Risk: internal unsigned build is mistaken for a public-ready release.
  - Control: label artifacts and release notes as internal-only; public
    distribution requires a new signing/notarization gate.
- Risk: global CLI and desktop runtime diverge on workspace semantics.
  - Control: enforce packet schema/runtime compatibility before mutation and
    surface read-only/refusal states when versions are incompatible.
- Risk: entry-agent setup assumes `.agents/skills` covers Claude Code.
  - Control: P0.6 uses `.agents/skills` as the shared default only for hosts
    with verified official support and keeps Claude Code on `.claude/skills`.
- Risk: desktop app accidentally calls the globally installed CLI.
  - Control: package tests poison `PATH` and assert app-originated mutations use
    the app-bundled runtime path.
- Risk: CLI and desktop mutate the same workspace concurrently.
  - Control: all mutations go through shared lock-aware runtime behavior with
    entrypoint-aware lock owner diagnostics.
- Risk: dependency creep.
  - Control: React, Vite, TanStack Query, and Radix-style primitives are
    baseline; graph/editor/terminal/state-store/table libraries are feature
    gated.
- Risk: static frontend cannot authenticate to dynamic App Server.
  - Control: bootstrap contract is part of P1.2, before desktop packaging.
- Risk: reload recovery turns `/api/bootstrap` into an unauthenticated local
  endpoint.
  - Control: P0.5 rejects unauthenticated bootstrap fallback and verifies token,
    nonce, or auth-cookie protection.
- Risk: direct calls disappear from Studio because only workflow packets are
  indexed.
  - Control: `agentmesh call` writes first-class `.agentmesh/calls/*` records
    and Studio renders them in a dedicated Calls tab.
- Risk: `agentmesh call` is run outside a workspace and silently produces no
  Studio-visible evidence.
  - Control: P0.3 resolves workspace before provider invocation and requires an
    explicit `--no-record` escape hatch for invisible calls.
- Risk: Calls tab treats committed review docs as canonical state.
  - Control: docs/reviews files are linked outputs; call metadata under
    `.agentmesh/calls/*` remains the source of truth.
- Risk: direct call records capture secrets or too much prompt context.
  - Control: reuse context policy/redaction rules and never store provider
    credentials, cookies, keychains, or login state.
- Risk: token/cost metrics are unavailable from an adapter but appear as real
  zeros.
  - Control: P0.3 requires unavailable model/token/cost fields to be `null`.

## 9. Current Next Step

Current next step: P0-P3 required Plan C execution is closed through the
internal unsigned DMG handoff. Do not treat the artifact as public-ready;
signed/notarized distribution still requires Developer ID credentials, updater
signing keys, and the release packaging gate. Only start P4 optional capability
additions (`React Flow`, `Monaco`, `xterm.js`, or a dedicated state store) when
product evidence shows the need.
