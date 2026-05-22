# P3 Sidecar Packaging Proof - 2026-05-17

## Scope

Reviewed P3.2: proving that the desktop sidecar path can run from app-managed
bundle inputs without resolving global `node`, `agentmesh`, `pnpm`, or source
checkout paths at runtime.

Implemented shape:

- `apps/studio-desktop/src/sidecar-bundle.ts` materializes a target-triple
  sidecar launcher under `dist-node/apps/studio-desktop/sidecar/`.
- The sidecar bundle copies the current Node runtime to
  `dist-node/apps/studio-desktop/sidecar/node`.
- The launcher runs `"$SELF_DIR/node" "$SELF_DIR/../src/main.js" "$@"`.
- Tauri `externalBin` now points at
  `../../dist-node/apps/studio-desktop/sidecar/agentmesh-studio-sidecar`.
- Tauri `bundle.resources` includes `../../dist-node`, so the sidecar launcher,
  desktop host entrypoint, React frontend assets, and runtime CLI stay in the
  app-managed bundle layout.
- Rust shell sidecar lookup now uses `agentmesh-studio-sidecar`.

## Verification

- Red targeted tests:
  - `npm run build && node --test dist-node/tests-node/studio-desktop-distribution.test.js`
  - Result: failed as expected before implementation because
    `sidecar-bundle.js` was missing.
- Green targeted tests:
  - `npm run build && node --test dist-node/tests-node/studio-desktop-distribution.test.js`
  - Result: pass, 5/5.
- Sidecar no-PATH smoke:
  - Generated `agentmesh-studio-sidecar-aarch64-apple-darwin`.
  - Spawned it with `PATH` pointing at an empty directory.
  - The sidecar emitted `agentmesh_studio_ready`.
  - A tokenized mutation ran through the App Server using the bundled sidecar
    Node path as `process.execPath` and the explicit app runtime CLI path.
- Development package smoke:
  - `npm run studio-desktop:package:dev`
  - Result: pass. The script now builds, generates the sidecar bundle, and then
    runs distribution smoke.

Not run locally:

- Real Tauri bundle execution of the sidecar.
- Rust/Tauri build and unsigned DMG creation.

The local host still lacks Rust/Cargo and a Tauri CLI, so P3.2 proves the
generated sidecar layout and no-PATH runtime behavior in Node-land, then leaves
real app bundle execution to the packaging host.

## Review

Must Fix findings: 0 for P3.2.

Accepted findings:

- App-originated desktop mutations no longer require global Node. The App
  Server process launched through the sidecar uses the copied bundled Node as
  `process.execPath`.
- The sidecar launcher does not contain `env node`, `pnpm`, `npx`, or
  PATH-visible `agentmesh`.
- Tauri config now references a target-triple sidecar base path instead of the
  raw JS desktop entrypoint.
- Development packaging smoke will fail if the sidecar launcher or bundled
  Node is missing.

Deferred findings:

- This is not a replacement for running the sidecar from a built `.app`; P3.4
  still needs a Tauri-capable packaging host.
- The current proof uses a copied Node runtime plus JS bundle layout, not Node
  SEA. Revisit SEA only if sidecar size or signing behavior requires it.

## Verdict

Ready for P3.3. P3.2 proves the desktop sidecar launcher and app-bundled Node
runtime path at the local package-smoke level, with no PATH dependency for
App-originated mutations.
