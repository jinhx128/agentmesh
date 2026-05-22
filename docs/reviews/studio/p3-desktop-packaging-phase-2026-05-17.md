# P3 Desktop Packaging Phase Review - 2026-05-17

## Scope

P3.Z closes the desktop packaging phase after P3.0-P3.5 evidence.

## Review

- Tauri remains a lifecycle-only shell. Rust starts the sidecar, reads the
  machine-readable readiness event, and navigates the WebView; it does not own
  packet, workflow, mutation, review, provider, or lock logic.
- The packaged sidecar uses app resources under
  `AgentMesh.app/Contents/Resources/dist-node/...` and does not resolve global
  `node`, `agentmesh`, `pnpm`, or `npx` from `PATH`.
- Production Node dependencies are staged under
  `dist-node/apps/studio-desktop/runtime-node_modules` before bundling and
  mapped into packaged `Resources/dist-node/node_modules`, so the internal DMG
  is not dependent on the repository root `node_modules`.
- The unsigned DMG is explicitly internal-only. Signed/notarized distribution
  remains deferred to a separate certificate-capable release gate.

## Verification

- `npm run build && node --test dist-node/tests-node/studio-desktop-distribution.test.js`
  passed: 6/6.
- `npm run studio-desktop:package:dev` passed.
- Tauri unsigned debug DMG build passed for `darwin-aarch64`.
- `hdiutil verify` reported the DMG checksum is valid.
- Mounted-DMG sidecar readiness passed with empty `PATH`.
- Mounted-DMG co-install smoke passed: app wrote through bundled CLI, source CLI
  read the result, and source CLI still worked after DMG detach.

## Residual Risk

- Clean teammate-machine or clean macOS user-profile install is still manual
  release evidence, not automated in this local session.
- Full WKWebView first-open / Gatekeeper UX remains a manual smoke item for the
  internal handoff.
- Bundle size is not optimized; `dist-node` includes compiled tests and
  production dependencies for this internal proof.

## Verdict

Verdict: ready for internal unsigned DMG handoff, not ready for public signed
distribution.
