# AgentMesh CLI Command Install

`schema_version`: 1

This document defines how a user or internal teammate gets a PATH-visible
`agentmesh` command for terminal usage and entry-agent Skill usage.

## Required Boundary

The AgentMesh Skill is host guidance. It does not embed or launch a private
copy of the CLI. Entry agents resolve `agentmesh` through the user's shell
`PATH`, so a teammate who only installs the DMG can use Desktop Studio but
cannot call AgentMesh from Codex, Cursor, Antigravity CLI, OpenCode, or
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

Use the GitHub Release-shaped tarball for reproducible smoke without a
registry:

```sh
npm run release:assets
npm install -g ./dist-release/agentmesh-<version>.tgz
agentmesh --help
agentmesh doctor --json
```

The npm package name is scoped, but GitHub Release assets intentionally use the
unscoped `agentmesh-<version>.tgz` filename.

The repository smoke gate is:

```sh
npm run cli:install-smoke
```

That smoke packs the root tarball, installs it in a clean temporary project,
then runs `agentmesh --help`, `agentmesh doctor --json`,
`agentmesh skill show`, `agentmesh skill install --target codex --force`, and
`agentmesh skill verify --target codex --json`.

### Public npm Registry

Use this after the release owner publishes the root package to the public npm
registry:

```sh
npm install -g @jinhx128/agentmesh
agentmesh --help
agentmesh doctor --json
```

The package name is scoped, but the installed command remains `agentmesh`
because the root `bin.agentmesh` entry owns the executable name.

### Private Registry

Use this only if the same root tarball is mirrored to an internal npm registry.
Expected internal shape:

```sh
npm install -g @jinhx128/agentmesh --registry <internal-registry-url>
agentmesh --help
agentmesh doctor --json
```

The registry package must preserve the same `bin.agentmesh`, `files`,
dependency boundary, and clean-install smoke as the local tarball.

Desktop resolves the existing command first and reports its actual version.
The install/update action then runs public npm directly and reports the command
that remains PATH-visible after npm finishes.

## Skill Install

After the PATH-visible command is selected, the user chooses host targets:

```sh
agentmesh skill install --target codex
agentmesh skill install --target cursor
agentmesh skill install --target antigravity
agentmesh skill install --target opencode
agentmesh skill install --target claude
```

Codex, Cursor, Antigravity CLI, and OpenCode share the current project
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
"Install Command Line Tool" action must:

- resolve `agentmesh` through PATH, common install locations, and the login shell
- execute the resolved command with `--version` and show its actual installed version
- query the public npm latest version
- run `npm install --global @jinhx128/agentmesh@latest --no-audit --no-fund`
- re-detect the PATH-visible command after npm finishes
- expose no bin path input and never edit shell profiles or request elevation
- report permission, network, missing npm, and PATH-order failures directly

Desktop Studio itself continues to use its bundled App Server/runtime and does
not call through the global CLI. Installing or updating the npm CLI therefore
does not replace Desktop's internal runtime.
