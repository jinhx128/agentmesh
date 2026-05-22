# P1 React Baseline Review - 2026-05-17

## Scope

Reviewed the Plan C P1 React baseline slices:

- `19291a2` `feat(studio): add vite react baseline`
- `74a8bac` `feat(studio): add typed api bootstrap client`
- `91556a3` `feat(studio-ui): migrate pilot react view`

Diff summary for `HEAD~3..HEAD`: 17 files changed, 2529 insertions, 12 deletions.

## Verification

- `npm run build`
  - Result: pass. Node build and Vite production build completed.
- `node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio.test.js dist-node/tests-node/package-structure.test.js`
  - Result: pass. Covered React catalog render states, API client token/cookie behavior, built asset serving, and frontend boundary guardrails.
- `npm test`
  - Result: 414/414.
- Browser smoke
  - Result: pass in Google Chrome against a local App Server serving `dist-node/apps/studio/frontend` with launch token auth.
  - Evidence: page loaded as `Connected`, the launch token was removed from the address bar, and the React catalog pilot rendered agents, workflows, and MCP sections after clicking `配置`.
- Source scan
  - Command: `rg -n "packages/(runtime|sdk|cli|core)|@agentmesh/|from ['\"]node:|from ['\"](fs|child_process|path|os)['\"]|localStorage|sessionStorage|indexedDB|127\\.0\\.0\\.1:\\d+|localhost:\\d+|:4777" apps/studio/src/frontend`
  - Result: no matches.
- `git diff --check`
  - Result: pass.

## Contract Review

Must Fix findings: 1 found, 1 fixed.

- Fixed: Chrome browser smoke initially showed `Network request failed` during React bootstrap because the default fetch path was not guarded by a browser-safe `globalThis.fetch(...)` wrapper. Fixed in `apps/studio/src/frontend/api/client.ts` and covered by a regression assertion that the default fetch path calls through `globalThis`.

Accepted findings: none remaining.

Rejected findings: none.

Residual risks:

- React catalog is a pilot view, not full legacy catalog parity. The embedded Studio shell remains reachable and covered while later slices migrate the more stateful run workspace.
- The browser smoke used Google Chrome via local desktop automation rather than a dedicated cross-browser Playwright matrix.
- P1 did not add optional UI framework dependencies; styling is local CSS and should be revisited when more views share patterns.

## Verdict

Ready for P2. The Vite + React baseline is stable enough to migrate run workspace surfaces next: the App Server remains the only HTTP/API owner, frontend sources have no runtime package imports or direct packet mutation logic, launch auth is protected and redacted, and the first API-backed React pilot view has targeted, full-suite, and browser-smoke evidence.
