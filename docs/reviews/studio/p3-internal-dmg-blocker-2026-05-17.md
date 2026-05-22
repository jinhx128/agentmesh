# P3 Internal DMG Build Blocker - 2026-05-17

## Scope

Attempted P3.4: produce an internal unsigned macOS DMG for the selected
`darwin-aarch64` target.

## Environment

- Host: macOS 26.4.1 build 25E253.
- CPU: arm64.
- `xcrun --find codesign`: `/usr/bin/codesign`.
- `npx --yes @tauri-apps/cli@latest --version`: `tauri-cli 2.11.2`.
- `cargo --version`: command not found.
- `rustc --version`: command not found.

## Attempted Command

```sh
npm run build
node dist-node/apps/studio-desktop/src/sidecar-bundle.js --verify
npx --yes @tauri-apps/cli@latest build --config apps/studio-desktop/src-tauri/tauri.conf.json --bundles dmg --debug
```

## Result

- `npm run build`: pass.
- `sidecar-bundle.js --verify`: pass; generated
  `agentmesh-studio-sidecar-aarch64-apple-darwin` and bundled Node path.
- Tauri unsigned DMG build: failed before Rust build.

Failure:

```text
failed to run 'cargo metadata' command to get workspace directory:
failed to run command cargo metadata --no-deps --format-version 1:
No such file or directory (os error 2)
```

## Review

Must Fix blocker:

- This machine cannot produce the internal unsigned DMG until Rust/Cargo are
  installed and available to the Tauri CLI.

Not produced:

- DMG path.
- DMG checksum.
- Installed app smoke.
- WKWebView app-window smoke.
- Clean macOS user/profile install notes.

## Verdict

P3.4 is blocked on packaging-host setup. Do not mark P3.4, P3.5, or P3.Z
complete until a Rust/Cargo/Tauri-capable host runs the unsigned DMG build and
records the required install smoke evidence.
