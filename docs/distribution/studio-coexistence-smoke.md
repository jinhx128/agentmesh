# Studio Distribution Coexistence Smoke

`schema_version`: 1

This smoke record covers the first macOS app / npm CLI coexistence boundary.
`AgentMesh.app` and a PATH-visible `agentmesh` may both exist on the same
machine, but they must not silently replace or call through each other.

## Channel Rules

- App-originated Studio actions use the app-bundled App Server and runtime from `AgentMesh.app`.
- Terminal commands use the PATH-visible agentmesh selected by the user's shell.
- External entry-agent usage also resolves the PATH-visible agentmesh command.
- Installed AgentMesh Skills call that same PATH-visible agentmesh command; a
  Skill file without a command install cannot make an entry agent invoke
  AgentMesh.
- If the user installs or updates the CLI from Desktop, the app runs
  `npm install --global @jinhx128/agentmesh@latest` and then verifies the
  PATH-visible command used by terminal and entry-agent flows.
- DMG-only is Desktop Studio only. CLI and Skill integration are separate
  user-selected installs.

## Guardrail Evidence

### App-Bundled Runtime Versus PATH CLI

Smoke: `tests-node/studio-distribution-coexistence.test.ts`

Scenario:

1. Put a fake `agentmesh` earlier on PATH.
2. Trigger a desktop Studio mutation through the cookie-authenticated App Server.
3. Assert the mutation command is the runtime API shape and never prints the
   PATH sentinel.

Result: App-originated actions do not use PATH lookup.

### Terminal And Entry-Agent PATH

Smoke: `tests-node/studio-distribution-coexistence.test.ts`

Scenario:

1. Put a fake `agentmesh` on PATH.
2. Execute `agentmesh studio --from-entry-agent` through normal process
   resolution.
3. Assert the PATH-visible agentmesh receives the command.

Result: terminal and entry-agent style calls continue to follow PATH-visible
agentmesh resolution.

### Shared Filesystem Run-Lock

Smoke: `tests-node/studio-distribution-coexistence.test.ts`

Scenario:

1. Create one run packet shared by app and npm CLI channels.
2. Hold the filesystem run-lock as an npm CLI mutation.
3. Trigger an app-bundled App Server dispatch mutation for the same run.
4. Assert the app mutation returns a lock conflict instead of writing through
   the active lease.

Result: app runtime and npm CLI channels share the same filesystem run-lock.

### Unsupported Newer Packet Or Config Schema

Contract evidence: `docs/contracts/app-server.md` and
`tests-node/core-contracts.test.ts`

The App Server must treat an unsupported newer packet/config schema as
mutation-incompatible. Read-only inspection may continue when parsing can do so
without rewriting, but write actions must fail fast or degrade to read-only and
must not overwrite unknown data.

### Install Command Line Tool

The Settings / Agent Integrations "Install Command Line Tool" action must:

- inspect the current PATH-visible agentmesh and execute `--version`
- show installed/latest versions and the resolved executable path
- install or update `@jinhx128/agentmesh@latest` through the resolved npm command
- re-detect the login-shell command after npm finishes
- expose no bin path input and no PATH-shadowing confirmation control
- report permission, network, missing npm, and PATH-order failures

### Install Agent Skill

The Settings / Agent Integrations "Install Agent Skill" action must:

- present explicit target choices: `codex`, `cursor`, `antigravity`, `opencode`,
  and `claude`
- install only the targets the user selected
- write shared project targets to `.agents/skills/agentmesh/SKILL.md`
- write Claude Code to `.claude/skills/agentmesh/SKILL.md`
- run `agentmesh skill verify --target <host> --json` independently for each
  selected target
- report per-target failures without blocking unselected or already successful
  targets

If no PATH-visible `agentmesh` exists, the UI must say that the Skill can be
installed for later but entry-agent calls will still fail until the command is
installed.

## Smoke Commands

### web Studio smoke

```sh
npm run build
node dist-node/apps/studio/src/main.js --host 127.0.0.1 --port 0
```

Expected: browser Studio serves UI assets, lists packet runs, and uses the
PATH-visible CLI only when launched through terminal `agentmesh studio`.

### CLI Studio smoke

```sh
npm run agentmesh -- studio --host 127.0.0.1 --port 0
```

Expected: CLI Studio starts the browser App Server from the npm/global CLI
channel and reports a copyable local URL.

### desktop Studio smoke

```sh
npm run studio-desktop
```

Expected: desktop Studio starts the app-managed host on dynamic 127.0.0.1,
prints a no-query WebView URL, uses runtime APIs for mutations, and never
falls back to PATH-visible agentmesh.

### command-line install smoke

```sh
npm run cli:install-smoke
```

Expected: the root CLI tarball installs in a clean temporary project, exposes
`agentmesh` on that project's PATH, runs `agentmesh --help`,
`agentmesh doctor --json`, `agentmesh skill show`, and verifies the selected
Codex-compatible shared Skill target with
`agentmesh skill verify --target codex --json`.

### mounted DMG co-install smoke

Latest local result:

- DMG:
  `apps/studio-desktop/src-tauri/target/debug/bundle/dmg/AgentMesh_0.1.2_aarch64.dmg`
- Start `AgentMesh.app/Contents/MacOS/agentmesh-studio-sidecar` from the mounted
  DMG with an empty `PATH`.
- Confirm the mounted app reads a run in the shared workspace.
- Trigger a Studio `attach` mutation and confirm the mutation command uses the
  runtime API shape rather than the separately managed public npm CLI.
- Confirm the source/global CLI lists the app-written artifact and can still
  read run status after the DMG is detached.

Evidence:
`docs/reviews/studio/p3-cli-dmg-coinstall-2026-05-17.md`.

## Verification Baseline

Latest recorded local verification:

- `npm run build && node --test dist-node/tests-node/studio-distribution-coexistence.test.js dist-node/tests-node/package-structure.test.js`
- `npm test`
- `git diff --check`
