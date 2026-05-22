# P3 CLI And DMG Co-Install Smoke - 2026-05-17

## Scope

P3.5 verifies that the global/source CLI channel and the mounted
`AgentMesh.app` DMG channel can operate on the same workspace without resolving
or overwriting each other.

## Evidence

- Existing automated coexistence tests cover separate CLI Studio and desktop
  Studio App Server sessions, separate dynamic ports, token policy, PATH
  poisoning, filesystem run-lock conflicts, and unsupported newer packet
  mutation refusal.
- A real mounted-DMG smoke started
  `AgentMesh.app/Contents/MacOS/agentmesh-studio-sidecar` with an empty `PATH`
  against a temporary workspace.
- The mounted app read a run created in the shared workspace.
- A Studio `attach` mutation wrote `plan.md` through the app-bundled CLI:
  `AgentMesh.app/Contents/Resources/dist-node/packages/cli/src/cli.js`.
- The source/global CLI then listed the artifact metadata and the shared
  workspace contained the app-written artifact content.
- After detaching the DMG, the source/global CLI still read the run status.

## Mounted DMG Smoke Output

```json
{
  "ok": true,
  "run_id": "dmg-coinstall-run",
  "mounted_runtime_cli_path": "AgentMesh.app/Contents/Resources/dist-node/packages/cli/src/cli.js",
  "cli_after_app_detach": true
}
```

The actual command array used the packaged Node binary under
`AgentMesh.app/Contents/Resources/dist-node/apps/studio-desktop/sidecar/node`
and the packaged CLI under
`AgentMesh.app/Contents/Resources/dist-node/packages/cli/src/cli.js`.

## Related Contract Coverage

- Provider discovery: covered by `tests-node/readiness.test.js`, including a
  GUI-launched empty `PATH` scenario with a mock provider in a well-known
  user-local bin directory and provider-missing diagnostics.
- Version skew: covered by packet compatibility and Studio mutation refusal
  tests for unsupported newer packet schema.
- Lock behavior: covered by shared filesystem run-lock tests that return owner
  diagnostics instead of writing through an active mutation lease.

## Skipped

- A literal drag-install into `/Applications` was not performed; mounted DMG
  execution was used for repeatable local smoke.
- A full GUI WKWebView interaction was not exercised in this session.

## Verdict

Verdict: ready. The CLI and DMG channels share workspace contracts while keeping
installation paths and runtime entrypoints independent.
