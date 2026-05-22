# P3 CLI Studio Path Preservation Review - 2026-05-17

## Scope

Reviewed P3.3: preserving `agentmesh studio` as the terminal/browser Studio
path while the packaged desktop app uses its own App Server session and
app-bundled runtime path.

## Verification

- Targeted preservation tests:
  - `npm run build && node --test dist-node/tests-node/studio-distribution-coexistence.test.js --test-name-pattern "CLI Studio and desktop Studio"`
  - Result: pass.
- Broader CLI/coexistence tests:
  - `node --test dist-node/tests-node/studio-distribution-coexistence.test.js dist-node/tests-node/studio-cli.test.js`
  - Result: pass, 10/10.

## Review

Must Fix findings: 0 for P3.3.

Accepted findings:

- CLI Studio and desktop Studio can run at the same time for the same workspace
  on separate dynamic ports.
- CLI Studio keeps unauthenticated browser-wrapper behavior for its local
  terminal path, while desktop Studio continues to require the launch token.
- CLI Studio mutations use the CLI entrypoint under `dist-node/packages/cli`.
- Desktop Studio mutations use the app-bundled runtime CLI path passed into the
  desktop host.
- The test explicitly clears inherited `AGENTMESH_CONFIG` for the isolated CLI
  session, matching existing CLI Studio test hygiene.

Deferred findings:

- This slice preserves behavior; it does not remove the legacy embedded Studio
  fallback.
- Packaged `.app` co-install smoke still belongs to P3.5 after a DMG exists.

## Verdict

Ready for P3.4, subject to packaging-host availability. The CLI Studio path is
protected from the desktop sidecar path and remains independently usable.
