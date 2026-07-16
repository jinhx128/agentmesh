# AgentMesh Studio macOS Distribution

`schema_version`: 1

This document defines the current macOS distribution path for `AgentMesh.app`.
The packaged app is distributed outside the Mac App Store as an unsigned,
non-notarized Apple Silicon DMG. Starting with `0.1.11`, later app versions can
be delivered through Tauri updater archives signed by the dedicated updater key.

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
Skill template resources, and runtime code needed by the integration panel.
Desktop Studio itself still uses the
App Server/runtime path and does not call through the CLI package.

To inspect only the local sidecar bundle proof:

```sh
npm run studio-desktop:sidecar:bundle
```

When the packaging host has Rust and the Tauri CLI installed, the equivalent
unsigned bundle command is:

```sh
npx tauri build --config apps/studio-desktop/src-tauri/tauri.conf.json --bundles app,dmg --debug
```

The latest internal unsigned local artifact is:

- `apps/studio-desktop/src-tauri/target/debug/bundle/dmg/AgentMesh_0.1.2_aarch64.dmg`
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

Do not use the quarantine command as the default release instruction. Published
unsigned builds should first use right-click Open or approval in System Settings
/ Privacy & Security; quarantine removal is an explicit local troubleshooting step.

## Updater-Signed Release Build

Updater signing secrets must come from the environment or the macOS keychain.
Do not commit private updater keys, passwords, or generated signatures. The
current `release:assets` path builds an unsigned/non-notarized debug DMG while
signing the Tauri app archive used by the updater.

Required updater environment:

- `TAURI_SIGNING_PRIVATE_KEY`: private key used to sign updater artifacts.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: private key password.

`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`
remain reserved for a future Developer ID/notarized distribution path and are
not a completion claim for the current release.

The updater public key is committed in
`apps/studio-desktop/src-tauri/tauri.conf.json`. The matching private key and
password remain outside git and are provided only to the release build.

Run the stricter future signing/notarization gate in a certificate-capable environment:

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

The current release asset command is:

```sh
npm run release:assets
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

After bootstrap, the main WebView navigates to the authenticated App Server at
`http://127.0.0.1:<ephemeral-port>`. The main Tauri capability therefore grants
updater and restart IPC only to bundled local content and the exact loopback
URLPattern `http://127.0.0.1:*`. It does not grant those commands to
`localhost`, other IP addresses, HTTPS origins, or public remote content, and
it grants no filesystem or shell command permissions.

Each current release must publish:

- unsigned/non-notarized Apple Silicon DMG for direct installation
- signed app archive used by Tauri updater
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
  orchestration. Codex, Cursor, Antigravity CLI, OpenCode, and Claude Code
  Skills need a PATH-visible `agentmesh` chosen by the user.
- The Settings / Agent Integrations command-line action detects the actual
  PATH-visible CLI version and installs or updates `@jinhx128/agentmesh@latest`
  through public npm without asking for a bin path.
- The Settings / Agent Integrations "Install Agent Skill" app action lets the
  user choose targets rather than installing all host integrations. The
  currently supported choices are `codex`, `cursor`, `antigravity`, `opencode`,
  and `claude`.

## In-App Update Migration

The stable updater endpoint is
`https://github.com/jinhx128/agentmesh/releases/latest/download/latest.json`.
Each release uploads a signed macOS app archive, its `.sig`, and `latest.json`.
Settings / About checks, downloads, verifies, installs, and relaunches through
the official Tauri updater and process plugins.

`0.1.10` does not contain the updater implementation. Users on that version
must manually install the first updater-enabled `0.1.11` DMG once. After
`0.1.11` is installed, later updater-enabled versions can update in-app.
