# P2 Studio React Workbench Review - 2026-05-17

## Scope

Reviewed the Plan C P2 Studio React workbench slices:

- `1c0ae39` `feat(studio-ui): migrate run navigator`
- `3b7e450` `feat(studio-ui): migrate run overview timeline`
- `cd09e55` `feat(studio-ui): migrate artifact preview`
- `7a82690` `feat(studio-ui): migrate event log view`
- `21402d7` `feat(studio-ui): migrate review release evidence`
- `75c10fd` `feat(studio-ui): migrate safe run actions`
- `e46680c` `feat(studio): add agent lifecycle controls`
- `371ddff` `feat(studio): expose direct call APIs`
- `2094bb8` `feat(studio-ui): add direct calls tab`
- `065c403` `feat(studio-ui): add call adoption actions`
- `beb8cdc` `docs(plan): decide calls cleanup scope`

Diff summary for `9e9c114..beb8cdc`: 31 files changed, 7116 insertions, 84 deletions.

## Verification

- `npm run build`
  - Result: pass. Node build and Vite production build completed.
- `npm test`
  - Result: pass, 437/437.
- Browser smoke, desktop viewport
  - Result: pass in Google Chrome against a tokenized local App Server serving `dist-node/apps/studio/frontend`.
  - Viewport: 1365px wide.
  - Covered Runs, artifact preview, event log, review/release evidence, safe actions, agent lifecycle, and Calls.
  - Evidence run id: `p2z-react-smoke-run-with-a-very-long-id-that-wraps-20260517`.
- Browser smoke, 375px viewport
  - Result: pass in Google Chrome against the same built React assets.
  - Mobile metrics: `window.innerWidth=375`, `document.scrollWidth=375`, `body.scrollWidth=375`.
  - Covered Runs, Calls navigation, safe actions, and review/release visibility without horizontal overflow.
- Frontend source-boundary scan
  - Command: `rg -n "node:|\\.agentmesh|packages/runtime|packages/sdk|dist-node|node_modules|child_process|fs/promises|from \"node|from 'node|process\\.cwd|process\\.env" apps/studio/src/frontend`
  - Result: no matches.
- Calls cleanup scope scan
  - Command: `rg -n "archive|delete|cleanup|remove|清理|删除|Archive|Delete" apps/studio/src/frontend/features/calls apps/studio/src/frontend/api/calls.ts apps/studio/src/calls-browser.ts`
  - Result: no matches.

## Review

Must Fix findings: 0.

Accepted findings:

- The React workbench now covers the core Studio paths that P2 targeted: run navigation, run summary/timeline, artifact preview, event log, review/release evidence, safe run actions, agent lifecycle, direct call browsing, and direct call adoption.
- The browser code remains behind the App Server API boundary. React frontend sources do not import runtime, SDK, Node built-ins, workspace paths, or direct packet/call files.
- Direct call cleanup remains out of the first Calls release. The Calls path exposes read/adoption state only and does not include archive/delete/cleanup actions.

Rejected or deferred findings:

- Removing `STUDIO_HTML`, `STUDIO_CSS`, and `STUDIO_JS` immediately is deferred. React parity is now proven for the P2 workbench scope, but the embedded assets still provide the no-`assetDir` fallback for the CLI Studio path and remain covered by existing tests. Removal should be a separate cleanup after P3.0/P3.1 confirms the desktop and CLI serving paths both use built React assets intentionally.
- A dedicated cross-browser or WKWebView automation matrix is deferred to P3.0 because the current phase reviewed the web App Server React workbench, not the desktop shell.

Residual risks:

- Chrome CDP smoke is not a replacement for the P3 desktop shell spike. WKWebView sidecar startup, crash/restart behavior, and app-bundled runtime path still need P3.0/P3.1 evidence.
- The smoke used a fake CLI for mutation and agent lifecycle checks. Full CLI behavior remains covered by node tests; desktop co-install behavior is still a P3.5 gate.
- The legacy embedded fallback is still present. No new product work should target it unless a future compatibility requirement explicitly reopens that path.

## Verdict

Ready for P3.0. P2 has enough test, source-scan, and browser-smoke evidence to treat the React workbench as the primary Studio UI path for the next desktop-shell spike. Old embedded assets are eligible for a later removal slice, but they were not deleted in this phase review commit.
