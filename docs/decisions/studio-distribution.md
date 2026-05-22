# Studio Distribution Decision

`schema_version`: 1

Decision: Tauri 2 is the default desktop host and distribution stack for the
first packaged AgentMesh Studio release.

Scope: macOS DMG distributed outside the Mac App Store, signed with Developer
ID, notarized by Apple, and updated through app-managed signed update artifacts.
Windows/Linux require separate decisions.

## Sources Checked

- Tauri distribution docs: <https://v2.tauri.app/distribute/>
- Tauri macOS signing docs: <https://tauri.app/distribute/sign/macos/>
- Tauri updater plugin docs: <https://v2.tauri.app/plugin/updater/>
- Tauri sidecar docs: <https://v2.tauri.app/develop/sidecar/>
- Electron code signing docs: <https://www.electronjs.org/docs/latest/tutorial/code-signing>
- Electron autoUpdater docs: <https://www.electronjs.org/docs/latest/api/auto-updater>

## Choice

Use Tauri 2 for `AgentMesh.app`.

Reasons:

- Tauri can bundle macOS app and DMG outputs for direct distribution.
- Tauri's macOS signing path supports Developer ID Application distribution and
  notarization outside the Mac App Store.
- Tauri sidecar packaging can bundle an app-managed AgentMesh runtime/App
  Server/CLI entrypoint instead of depending on a PATH-visible `agentmesh`.
- Tauri's updater plugin supports signed update artifacts, HTTPS endpoints,
  static JSON metadata, and dynamic update servers if rollback or richer
  targeting later becomes necessary.
- The desktop host can remain a thin lifecycle shell; AgentMesh packet,
  workflow, adapter, review, release, and run-lock business logic stays in the
  existing runtime/CLI.

P4.3 should prove the sidecar packaging path before expanding the desktop host.
The sidecar may be a packaged Node runtime plus AgentMesh JS bundle or another
single executable wrapper, but it must expose the app-bundled runtime entrypoint
defined in `docs/contracts/app-server.md`.

## Electron Fallback

Electron fallback is allowed only if one of these conditions is verified:

- Studio requires a Chromium API that the macOS system WebView/Tauri WebView
  cannot provide.
- The desktop host requires `node-pty` or other native Node modules inside the
  UI process.
- Tauri sidecar packaging for the app-bundled runtime is measured and found
  unacceptable for signing, notarization, update, or local smoke workflows.
- The App Server lifecycle cannot be made reliable with Tauri commands,
  sidecars, and process management without moving protocol logic into Rust.

Fallback is not justified by general familiarity with Electron, preference for
Node in the host process, or avoiding a small Rust shell. Electron remains a
backup stack, not a parallel implementation target.

## Updater Stack

Use `tauri-plugin-updater` and Tauri signed update artifacts.

Initial production update source:

- static JSON metadata hosted from GitHub Releases
- one metadata file per channel and platform/arch
- artifacts and signatures attached to the same release
- HTTPS only in production
- no `dangerousInsecureTransportProtocol`

The metadata host may later move to S3/R2 or a dynamic update server without
changing the app contract. A dynamic server is required before automatic
downgrade-based rollback or cohort targeting; the first release does not need
that complexity.

## Channel Policy

Channels:

- stable channel: default for all users
- beta channel: explicit opt-in
- alpha/nightly channel: internal-only until there is a real release process

Rules:

- No automatic channel switching.
- Stable must never install beta/alpha artifacts.
- Beta may offer newer builds than stable but must use the same signing and
  update verification path.
- Channel preference is an app-only preference unless the terminal CLI must
  intentionally observe it.

## Failure And Rollback

Download, signature verification, and install failures must leave the currently
running app untouched and surface an actionable error.

Manual rollback is the first supported rollback strategy. This manual rollback
path keeps the first updater release simple:

- publish the previous signed DMG and update artifacts in GitHub Releases
- document how to reinstall the previous DMG
- keep the app from silently retrying the same failing update in a loop
- record the failed update state in app-only preferences or logs, not shared
  AgentMesh project config

Automatic rollback requires a dynamic update server or an explicit app update
flow that can safely serve a lower version. Do not enable automatic downgrades
for stable until that behavior is tested and documented.

## macOS Target

The first packaged target is macOS only:

- direct DMG distribution
- Developer ID signing
- notarization
- Apple Silicon and Intel artifacts when both are supported by the build
  pipeline

Windows/Linux packaging, signing, installers, update metadata, and channel
rules require separate decisions. They should not inherit macOS DMG assumptions.
