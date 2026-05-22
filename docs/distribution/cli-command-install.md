# AgentMesh CLI Command Install

`schema_version`: 1

This document defines how an internal teammate gets a PATH-visible
`agentmesh` command for terminal usage and entry-agent Skill usage.

## Required Boundary

The AgentMesh Skill is host guidance. It does not embed or launch a private
copy of the CLI. Entry agents resolve `agentmesh` through the user's shell
`PATH`, so a teammate who only installs the DMG can use Desktop Studio but
cannot call AgentMesh from Codex, Cursor, Antigravity CLI, OpenCode, Copilot, or
Claude Code until they also install a PATH-visible `agentmesh`.

DMG-only is therefore Desktop Studio only. Agent integrations require two
user-selected steps:

1. Install or choose a PATH-visible `agentmesh` command.
2. Install the AgentMesh Skill only for the host or hosts the user actually
   uses.

## Install Modes

### Source Checkout

Use this for local development and early internal adoption:

```sh
git clone <repo-url> agentmesh
cd agentmesh
npm install
npm run build
npm link
agentmesh --help
agentmesh doctor --json
```

Before running `npm link`, inspect any existing command:

```sh
existing_agentmesh="$(command -v agentmesh || true)"
if [ -n "$existing_agentmesh" ]; then
  echo "$existing_agentmesh"
  agentmesh --help >/dev/null
  agentmesh skill show 2>/dev/null | sed -n '/AgentMesh CLI version/p'
fi
```

If an existing `agentmesh` is present, the installer or docs must show its
path and observed version/status before the user replaces it.

### Tarball

Use this for reproducible internal smoke without a public registry:

```sh
npm run build
npm pack --pack-destination /tmp
npm install -g /tmp/agentmesh-<version>.tgz
agentmesh --help
agentmesh doctor --json
```

Use the exact tarball filename printed by `npm pack`; the version placeholder
must match the packaged root `package.json`.

The repository smoke gate is:

```sh
npm run cli:install-smoke
```

That smoke packs the root tarball, installs it in a clean temporary project,
then runs `agentmesh --help`, `agentmesh doctor --json`,
`agentmesh skill show`, `agentmesh skill install --target codex --force`, and
`agentmesh skill verify --target codex --json`.

### Private Registry

Use this only after the release owner publishes the same root tarball to an
internal npm registry. The root package is still `private: true` in this
checkout, so public `npm install -g agentmesh` is not available from the public
npm registry.

Expected internal shape:

```sh
npm install -g agentmesh --registry <internal-registry-url>
agentmesh --help
agentmesh doctor --json
```

The private registry package must preserve the same `bin.agentmesh`,
`files`, dependency boundary, and clean-install smoke as the local tarball.

`npm install -g` itself does not prompt before changing a global command. Any
team installer, app action, or rollout wrapper that switches the PATH-visible
command must do the inspection and confirmation step before invoking it.

## Skill Install

After the PATH-visible command is selected, the user chooses host targets:

```sh
agentmesh skill install --target codex
agentmesh skill install --target cursor
agentmesh skill install --target antigravity
agentmesh skill install --target opencode
agentmesh skill install --target copilot
agentmesh skill install --target claude
```

Codex, Cursor, Antigravity CLI, OpenCode, and Copilot share the current project
file `.agents/skills/agentmesh/SKILL.md`. Claude Code uses
`.claude/skills/agentmesh/SKILL.md`.

Verify each selected host independently:

```sh
agentmesh skill verify --target <host> --json
```

Do not auto-install every target. A failed target verification should report
that host's file status without blocking other selected hosts.

## DMG Command-Line Tool Option

`AgentMesh.app` exposes this through Settings / Agent Integrations. The
"Install Command Line Tool" action must be user-confirmed and must:

- inspect the current PATH-visible `agentmesh`
- show the detected path and observed version/status
- show the new app-managed wrapper target
- require explicit confirmation before replacing or shadowing anything
- prefer a wrapper script over a bare symlink, so it can report app channel and
  version details
- never silently overwrite an npm, source checkout, Homebrew, or previous app
  command

The app-managed wrapper is only valid after it becomes the PATH-visible
`agentmesh`. Desktop Studio itself continues to use its bundled App
Server/runtime and must not call through the global command.
Because the wrapper stores the app-bundled Node and CLI paths from install
time, moving `AgentMesh.app` or installing an app update that changes those
resource paths can break the wrapper; re-run "Install Command Line Tool" after
such changes.
