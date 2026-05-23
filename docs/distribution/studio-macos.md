# AgentMesh Studio macOS Distribution

`schema_version`: 1

This document defines the first macOS distribution path for `AgentMesh.app`.
The packaged app is distributed outside the Mac App Store as a DMG, signed with
Developer ID, notarized by Apple, and updated through Tauri signed update
artifacts.

## Source References

- Tauri distribution: <https://v2.tauri.app/distribute/>
- Tauri macOS signing: <https://tauri.app/distribute/sign/macos/>
- Tauri updater plugin: <https://v2.tauri.app/plugin/updater/>
- Tauri sidecar packaging: <https://v2.tauri.app/develop/sidecar/>

## Local Unsigned Smoke

Use this before opening a release PR:

```sh
npm run studio-desktop:package:dev
```

The smoke builds the TypeScript runtime, validates the Tauri app identity,
DMG target, icon source, updater artifact configuration, example update
metadata, app-managed runtime entrypoint, and generated sidecar bundle.

The sidecar bundle step creates a target-triple launcher such as
`dist-node/apps/studio-desktop/sidecar/agentmesh-studio-sidecar-aarch64-apple-darwin`
and copies the Node runtime to `dist-node/apps/studio-desktop/sidecar/node`.
It also stages production runtime dependencies under
`dist-node/apps/studio-desktop/runtime-node_modules`; Tauri maps that staging
directory to packaged `Resources/dist-node/node_modules`. The launcher executes
bundled Node directly and does not resolve global `node`, global `agentmesh`,
`pnpm`, or `npx` through `PATH`.

The Tauri resource map includes the desktop host, App Server, runtime/core/sdk
packages, Studio Web assets, sidecar launcher directory, runtime dependencies,
Skill template resources, and the CLI package needed by the optional
user-confirmed command-line wrapper. Desktop Studio itself still uses the
App Server/runtime path and does not call through the CLI package.

To inspect only the local sidecar bundle proof:

```sh
npm run studio-desktop:sidecar:bundle
```

When the packaging host has Rust and the Tauri CLI installed, the equivalent
unsigned bundle command is:

```sh
npx tauri build --config apps/studio-desktop/src-tauri/tauri.conf.json --bundles dmg --debug
```

The latest internal unsigned local artifact is:

- `apps/studio-desktop/src-tauri/target/debug/bundle/dmg/AgentMesh_0.1.1_aarch64.dmg`
- SHA-256:
  `5ca5a3901c2f05d5d4ab1f64c82c9ef282cad7e5a22df3854d1be36d86e972c7`
- Evidence: `docs/reviews/studio/p3-internal-dmg-2026-05-17.md`

This artifact is internal-only. It is unsigned, not notarized, and not suitable
for public/customer distribution.

### Internal Unsigned First Open

For internal smoke only:

1. Open the DMG and drag `AgentMesh.app` to `/Applications`.
2. First launch may require right-clicking `AgentMesh.app` and selecting Open.
3. If Gatekeeper quarantine blocks the app, remove quarantine from the installed
   copy:

```sh
xattr -dr com.apple.quarantine /Applications/AgentMesh.app
```

Do not use the quarantine command for public release instructions; public
builds must be signed and notarized instead.

## Signed And Notarized Build

Signing and notarization secrets must come from the environment or the macOS
keychain. Do not commit certificates, app-specific passwords, private updater
keys, notarization tokens, or generated signatures.

Required environment:

- `APPLE_SIGNING_IDENTITY`: Developer ID Application identity in the keychain.
- `APPLE_ID`: Apple ID used for notarization.
- `APPLE_PASSWORD`: app-specific password or CI-provided notarization secret.
- `APPLE_TEAM_ID`: Apple developer team id.
- `TAURI_SIGNING_PRIVATE_KEY`: private key used to sign updater artifacts.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: private key password.

Before signing, replace the updater public key placeholder in
`apps/studio-desktop/src-tauri/tauri.conf.json` with the public half of the
Tauri updater key. The public key is not a secret; the private key remains in
the environment.

Run the guarded signed smoke in a certificate-capable environment:

```sh
npm run studio-desktop:package:signed
```

In an environment without certificates, use a dry run to verify the gate and
the expected missing variables:

```sh
npm run build
node dist-node/apps/studio-desktop/src/sidecar-bundle.js --verify
node dist-node/apps/studio-desktop/src/distribution-smoke.js --mode signed --dry-run
```

The real signed package command for the packaging host is:

```sh
npx tauri build --config apps/studio-desktop/src-tauri/tauri.conf.json --bundles dmg
```

## App-Managed Updates

`AgentMesh.app` updates the app-bundled Studio host, App Server, UI assets, and
sidecar app-runtime entrypoint together. That entrypoint is not the
PATH-visible `agentmesh` tarball command. An app update must not mutate or
replace a global npm install of `agentmesh`.

The default stable updater endpoint is configured in
`apps/studio-desktop/src-tauri/tauri.conf.json`. Channel metadata examples live
under `apps/studio-desktop/distribution/`:

- `latest.stable.darwin-aarch64.example.json`
- `latest.beta.darwin-aarch64.example.json`

Each release must publish:

- signed DMG for direct installation
- app archive used by Tauri updater
- updater signature for that app archive
- channel metadata JSON pointing at the archive and signature

Validate metadata shape with:

```sh
npm run studio-desktop:update:metadata
```

## Channel Boundary

- Stable is the default app channel.
- Beta is opt-in and uses a separate metadata endpoint.
- The npm CLI is a separate developer distribution channel. `npm update -g
  agentmesh` affects the terminal CLI install only; app-managed updates affect
  `AgentMesh.app` only.
- A DMG-only install is enough for Desktop Studio, but not for entry-agent
  orchestration. Codex, Cursor, Antigravity CLI, OpenCode, Copilot, and Claude Code
  Skills need a PATH-visible `agentmesh` chosen by the user.
- The Settings / Agent Integrations "Install Command Line Tool" app action is
  opt-in, inspects and displays any existing PATH command before writing a
  wrapper, and requires user confirmation before replacing or shadowing another
  CLI channel.
  The wrapper stores absolute app resource paths, so users should re-run the
  action after moving `AgentMesh.app` or applying an app update that changes
  bundled runtime paths.
- The Settings / Agent Integrations "Install Agent Skill" app action lets the
  user choose targets rather than installing all host integrations. The
  currently supported choices are `codex`, `cursor`, `antigravity`, `opencode`,
  `copilot`, and `claude`.
