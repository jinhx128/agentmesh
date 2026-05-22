# P3 Tauri Shell Spike - 2026-05-17

## Scope

Reviewed P3.0 for the desktop packaging path: whether AgentMesh Studio should
continue with Tauri 2 as a thin macOS shell before investing in packaged
desktop work.

The spike covered:

- dynamic port plus tokenized App Server bootstrap
- app-managed runtime entrypoint and no shared npm CLI dependency
- sidecar restart behavior with token replacement
- macOS minimum version and first CPU target recording
- Tauri sidecar packaging notes and Electron fallback threshold
- local packaging-host readiness for a real WKWebView/DMG build

## Environment

- Local host: macOS 26.4.1 build 25E253.
- Local CPU: arm64.
- First desktop target recorded in metadata: `darwin-aarch64`.
- Minimum macOS version recorded in Tauri config and distribution metadata:
  `12.0`.
- `xcrun --find codesign`: `/usr/bin/codesign`.
- `cargo --version`: unavailable on this host.
- `rustc --version`: unavailable on this host.
- `npx --no-install tauri --version`: failed because no local Tauri CLI
  executable is installed.

## Verification

- Red targeted desktop tests:
  - Result: failed as expected before implementation.
  - Missing evidence included `restartStudioDesktopHost`, desktop
    `targetArchitectures`, and shell spike decision metadata.
- Green targeted desktop tests:
  - Command: `npm run build:node && node --test dist-node/tests-node/studio-desktop-options.test.js dist-node/tests-node/studio-desktop-distribution.test.js`
  - Result: pass, 11/11.
- Development distribution smoke:
  - Command: `npm run studio-desktop:package:dev`
  - Result: pass. The smoke validates Tauri app identity, DMG target, icon,
    updater metadata, app-managed runtime entrypoint, `darwin-aarch64`, and the
    `continue-tauri` shell decision.
- Signed dry-run gate:
  - Command: `node dist-node/apps/studio-desktop/src/distribution-smoke.js --mode signed --dry-run`
  - Result: pass. Missing signing/notarization/updater secrets are reported as
    expected dry-run warnings.
- Metadata smoke:
  - Command: `node dist-node/apps/studio-desktop/src/distribution-smoke.js --mode metadata`
  - Result: pass.

Not run locally:

- Real `npx tauri build --config apps/studio-desktop/src-tauri/tauri.conf.json --bundles dmg --debug`.
- WKWebView UI smoke from the Tauri app window.
- Installed DMG smoke.

These were not run because this host does not currently have Rust/Cargo or a
local Tauri CLI. That is a packaging-host setup gap, not a verified Electron
fallback trigger.

## Review

Must Fix findings: 0 for P3.0.

Accepted findings:

- Continue with Tauri 2 as the desktop shell for the next P3 slices. No P3.0
  evidence showed that AgentMesh Studio needs Electron as the default shell.
- The current app boundary still fits the thin-shell model: Tauri owns process
  and window lifecycle, while the Node App Server owns AgentMesh business
  behavior.
- Dynamic port and token bootstrap behavior remains covered by node tests.
  Restarting the desktop host now stops the old server and replaces the launch
  token, so stale tokens are rejected after sidecar restart.
- The first macOS artifact target is explicitly `darwin-aarch64`, with macOS
  `12.0` as the minimum version.
- Sidecar packaging is intentionally recorded as `externalBin`-based and
  app-managed. P3.2 must still prove the executable wrapper inside a packaged
  app.

Deferred findings:

- WKWebView smoke is deferred to P3.1, after the Tauri shell is wired to load
  built React assets from the tokenized App Server.
- Real unsigned DMG creation is deferred to P3.4 or a prepared packaging host
  with Rust/Cargo and Tauri CLI installed.
- Native-module or embedded-terminal risk does not currently force Electron.
  Reopen the decision if Studio requires a UI-process native module, direct
  `node-pty` coupling, or Chromium-only behavior.

Electron fallback comparison:

- The section 2 fallback threshold says to switch only if Tauri cannot support
  required sidecar lifecycle, packaging, WebView behavior, or terminal/native
  module needs within acceptable cost.
- P3.0 found no verified blocker in those categories.
- The absent local Rust/Tauri toolchain is not a product architecture blocker;
  it is an environment prerequisite for P3.1/P3.4 verification.
- If later packaged evidence shows unreliable sidecar lifecycle, unacceptable
  signing/notarization/updater cost, WKWebView gaps without reasonable
  workaround, or required UI-process native modules, the Electron decision
  should be reopened immediately.

## Verdict

Continue Tauri. P3.0 is complete as a decision spike and records the remaining
packaging-host gates honestly. The next step is P3.1: wire the Tauri shell to
the app-bundled App Server and run WKWebView smoke once a Tauri-capable host is
available.
