# P3 Internal Unsigned DMG - 2026-05-17

## Scope

P3.4 produced an internal-only unsigned macOS DMG for the selected
`darwin-aarch64` target. This supersedes the earlier local blocker record after
Rust/Cargo were installed on this host.

## Environment

- Host: macOS 26.4.1 build 25E253.
- CPU: arm64.
- `rustc --version`: `rustc 1.95.0 (59807616e 2026-04-14)`.
- `cargo --version`: `cargo 1.95.0 (f2d3ce0bd 2026-03-21)`.
- Tauri CLI: `@tauri-apps/cli` latest resolved to `2.11.2`.

## Artifact

- DMG:
  `apps/studio-desktop/src-tauri/target/debug/bundle/dmg/AgentMesh_0.1.0_aarch64.dmg`
- SHA-256:
  `5ca5a3901c2f05d5d4ab1f64c82c9ef282cad7e5a22df3854d1be36d86e972c7`
- Scope label: internal unsigned smoke only. This is not a public/customer-ready
  release and is not signed or notarized.

## Fixes Required To Produce A Working DMG

- Corrected Tauri relative paths from `src-tauri` to root `dist-node` by using
  `../../../dist-node`.
- Generated the standard Tauri icon files from the existing AgentMesh SVG so
  `generate_context!()` can load `icons/icon.png` and the macOS bundle can use
  `icon.icns`.
- Made the sidecar launcher support both local `dist-node/.../sidecar` layout
  and packaged `AgentMesh.app/Contents/Resources/dist-node/...` layout.
- Copied production runtime dependencies from `package-lock.json` into
  `dist-node/apps/studio-desktop/runtime-node_modules`, then mapped that
  staging directory to packaged `Resources/dist-node/node_modules`, so the
  packaged app does not depend on repository root `node_modules`.

## Verification

- `npm run build && node --test dist-node/tests-node/studio-desktop-distribution.test.js`
  passed: 6/6 tests.
- `npm run studio-desktop:package:dev` passed and copied 96 production runtime
  dependency packages into `dist-node/apps/studio-desktop/runtime-node_modules`.
- `npx --yes @tauri-apps/cli@latest build --config apps/studio-desktop/src-tauri/tauri.conf.json --bundles dmg --debug`
  produced the DMG above.
- `hdiutil verify apps/studio-desktop/src-tauri/target/debug/bundle/dmg/AgentMesh_0.1.0_aarch64.dmg`
  reported the image checksum is valid.
- Mounted-DMG sidecar smoke passed with an empty `PATH`; readiness reported:
  `runtime_cli_path` under
  `AgentMesh.app/Contents/Resources/dist-node/packages/cli/src/cli.js`.

## Install Notes

For internal unsigned builds:

1. Open the DMG and drag `AgentMesh.app` to `/Applications`.
2. First launch may require right-clicking `AgentMesh.app` and choosing Open.
3. If Gatekeeper quarantine blocks the internal build, remove quarantine from
   the installed app:

```sh
xattr -dr com.apple.quarantine /Applications/AgentMesh.app
```

## Skipped

- Clean teammate machine and clean macOS user profile first-open smoke were not
  run in this local session.
- Full WKWebView window launch was not exercised; the package-level sidecar
  startup and App Server readiness were verified from the mounted DMG.
- Signing, notarization, and updater artifact generation remain deferred to a
  certificate-capable release environment.

## Verdict

Verdict: ready for internal handoff with the skipped clean-profile and
Gatekeeper first-open checks explicitly called out.
