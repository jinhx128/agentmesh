# Studio Frontend Stack Proposal

`schema_version`: 1

Status: proposal, externally reviewed, revised with accepted findings.

Question: Should AgentMesh Studio introduce a frontend framework now, and how
should this relate to Tauri?

## 1. Background

Verified facts:

- Studio is a local AgentMesh workbench for one workspace, not a cloud
  dashboard, landing page, packet editor, or second runtime.
- Studio v1 reads packet files through the Studio server and triggers safe
  mutations through CLI subprocesses.
- The current repo has no React, Vue, Vite, Tailwind, Radix, shadcn, Element
  Plus, or Vant dependency.
- Current Studio frontend assets live in `apps/studio/src/assets.ts`, which
  embeds HTML, CSS, and browser JavaScript in one large TypeScript module.
- `apps/studio/src/assets.ts` is already about 2.8k lines, and
  `tests-node/studio-ui.test.ts` already has extensive regex/string assertions
  over the embedded Studio constants.
- Existing decisions say React, Vite, or another frontend framework should be
  introduced only if later Studio slices prove the plain TypeScript asset
  approach is the blocker.
- Existing desktop distribution decisions choose Tauri 2 as the default future
  packaged desktop host, with Electron only as a fallback.
- External read-only reviews were collected from Claude Opus 4.7, Gemini, and
  Cursor on 2026-05-17. All three agreed the Tauri boundary is directionally
  right, and all three challenged the original "split first, Vite later"
  ordering.

Current inference:

- Tauri is the desktop shell/distribution layer, not a replacement for a
  frontend page framework.
- The Vite gate is already met. The current embedded asset model is large
  enough that Vite should be used to split the UI instead of hand-rolling an
  interim asset assembler.
- A React/Vue migration is not approved in the same step, but the framework
  decision must be re-evaluated immediately after the Vite-assisted split
  because some framework trigger evidence may already exist.

## 2. Goal

Choose a staged frontend direction that keeps Studio maintainable without
pulling in a heavy UI stack before the product workflow proves it needs one.

Success criteria:

- Short-term Studio development stays fast and low-risk.
- The frontend source can be split and tested without changing the runtime
  protocol boundary.
- Tauri packaging remains compatible with the web UI output.
- A future framework migration has explicit trigger conditions rather than
  happening because a framework is familiar.

Non-goals:

- Do not make Rust/Tauri own AgentMesh packet, workflow, review, release, or
  lock logic.
- Do not introduce Vant for the desktop Studio.
- Do not build a full workflow authoring canvas until the product scope
  explicitly requires it.
- Do not rewrite Studio into React or Vue before the current UI approach is
  proven to block maintainability or feature delivery.

## 3. Recommendation

Recommended path:

1. Introduce Vite as the next frontend build boundary.
2. Use Vite to split `apps/studio/src/assets.ts` into normal frontend source
   files instead of splitting embedded strings first.
3. Keep the first Vite step framework-free: plain TypeScript/CSS, same API
   boundary, same Studio behavior.
4. Re-evaluate React/Vue at the Vite split phase review using concrete
   evidence from file sizes, test shape, and feature work.
5. Choose React or Vue only through a follow-up decision doc or small POC.
6. Keep Tauri as the future thin desktop shell that launches or connects to the
   app-bundled Studio/App Server and loads the web UI.

Framework stance:

- Undecided for now. Do not treat React as approved just because it is a strong
  ecosystem fit.
- React becomes the leading candidate if Studio needs graph/canvas workflows,
  Radix-style accessible primitives, or React Flow.
- Vue becomes a valid candidate if the team wants a Vue-maintained Studio and
  accepts Element Plus or Naive UI as the desktop workbench component layer.

Possible React stack, if selected later:

- React + Vite + TypeScript
- TanStack Query for server state
- Radix/shadcn-style local components for dense workbench UI
- React Flow only if Studio gains real graph/canvas authoring or advanced flow
  inspection
- Validate Radix/shadcn behavior in Tauri's macOS WKWebView before locking in
  complex popover, focus, or overlay behavior.

Possible Vue stack, if selected later:

- Vue 3 + Vite + TypeScript
- Pinia for local UI state; TanStack Query for Vue can still be considered for
  server state if the API polling/cache needs justify it.
- Element Plus or Naive UI for dense management-console controls
- Vue Flow only if Studio gains real graph/canvas authoring or advanced flow
  inspection

Rejected for current Studio:

- Vant: mobile-first component library, not a good fit for the desktop
  workbench.
- Immediate Element Plus adoption before choosing Vue: useful only if Vue is
  chosen; otherwise it risks turning Studio into a generic admin panel and adds
  dependency weight before the need is proven.
- Immediate Tauri-first development: useful for packaged distribution, but too
  early as the daily UI development surface while product workflows are still
  stabilizing.

## 4. Trigger Gates

Vite decision:

- Vite is approved for the next frontend infrastructure slice.
- Rationale: `assets.ts` is already about 2.8k lines, the UI needs normal HTML,
  CSS, and browser TypeScript modules, and future Tauri packaging benefits from
  a deterministic frontend dist directory.
- Acceptance criterion: the Vite output must still be served by the Studio
  server and must not move packet mutation or runtime behavior into frontend
  code.
- Acceptance criterion: the Vite/Tauri path must define how the frontend learns
  the dynamic loopback port and authenticates without leaking the per-launch
  token. The accepted desktop mechanism is sidecar stdin handshake plus a native
  `HttpOnly; SameSite=Strict` WebView cookie before loading a no-query URL.

Re-open React/Vue decision when any hard trigger is true:

- A new Studio feature requires a graph/canvas library beyond the current stage
  strip/list UI.
- UI tests still rely on broad raw HTML/CSS/JS string assertions after the Vite
  split, and behavior remains hard to isolate.
- A feature requires shared route/view state across at least three major zones:
  run navigator, run detail, catalog, actions, previews, settings, or manual.

Re-open React/Vue decision when at least two soft triggers are true:

- Multiple complex forms or dialogs require reusable controlled components.
- UI state spreads across run list, run detail, catalog, actions, previews,
  filters, and settings in a way that plain DOM updates become fragile.
- Real-time logs or event streams need robust async state handling.
- Route-level views and layout persistence become product requirements.
- The browser client remains over about 1.2k lines after extraction, excluding
  translations and generated/static content.
- Adding one new Studio screen repeatedly touches more than four unrelated UI
  modules.

Introduce React Flow or Vue Flow only when:

- Studio needs an interactive workflow graph, canvas inspection, or authoring
  surface that cannot be represented well by the current stage strip/list UI.

Move Tauri from packaging track to active product surface when:

- Signed desktop app distribution, app-managed updates, native notifications,
  file associations, tray behavior, or app-bundled runtime lifecycle become
  current release requirements.
- Do not move Tauri forward merely to wrap the same localhost page in an app
  window.

Tauri engineering anti-patterns:

- Do not put packet validation, workflow orchestration, review aggregation,
  release gates, adapter invocation, or run-lock ownership into Rust commands.
- Do not use Tauri filesystem APIs to bypass the Studio server or CLI-backed
  mutation path.
- Do not duplicate frontend and server business rules for allowed mutations.
- Do not make the UI depend on a fixed public localhost port in packaged app
  mode.

## 5. Implementation Plan

### P1. Add Vite And Split Current Frontend

- [ ] P1.1 Add a minimal Vite build boundary.
  - Files: package scripts/config, Studio frontend source directory, Studio
    server asset serving path.
  - Goal: create a deterministic frontend build output while keeping the same
    Studio API boundary and local web wrapper behavior.
  - Verification: `npm run build`, `npm test`, and existing Studio UI tests.
  - Review: confirm Vite does not require Tauri, does not import
    `packages/runtime`, and does not move mutation behavior into frontend code.

- [ ] P1.2 Split frontend assets through Vite.
  - Files: Studio frontend modules and `tests-node/studio-ui.test.ts`.
  - Goal: separate HTML shell, CSS, browser client script, translations, and
    manual/content data without changing visible Studio behavior.
  - Verification: `npm test` plus manual Studio smoke if visual changes occur.
  - Review: check accessibility, 375px layout, no horizontal scrolling, and
    mutation actions remain CLI-backed.

- [ ] P1.3 Add maintainability guardrails.
  - Goal: move tests toward behavior and stable landmarks instead of broad
    raw-string coupling.
  - Verification: `npm test`.
  - Review: record remaining raw-string assertions and whether they still block
    isolated UI behavior testing.

- [ ] P1.Z Phase review.
  - Goal: decide whether plain TypeScript remains sufficient after the
    Vite-assisted split.
  - Evidence: file sizes, test clarity, remaining string assertions,
    build/test results, reviewer notes, and any new feature friction.
  - Decision: either keep plain TypeScript for the next Studio slice or open
    P2 framework POC. This review must happen no later than the next substantial
    Studio UI feature after P1.2.

### P2. Framework Decision Or POC If Triggered

- [ ] P2.1 Write a short React vs Vue decision doc.
  - Goal: compare against actual Studio pain points, not generic ecosystem
    preference.
  - Verification: decision doc covers dependency cost, testing, i18n, Tauri
    WebView compatibility, graph needs, server-state handling, local UI state,
    and migration scope.

- [ ] P2.2 Migrate one low-coupling pilot slice only if P2.1 approves a
      framework.
  - Scope: prefer the settings tab or catalog page. Avoid the run navigator +
    selected run summary as the first pilot because it shares state with most
    of the workspace.
  - Goal: prove state management, rendering, tests, i18n, and asset serving
    before a full rewrite.
  - Verification: existing API tests remain unchanged, UI smoke passes, no
    packet mutation logic moves into frontend code.

- [ ] P2.Z Phase review.
  - Goal: decide whether to continue migration or stop after the proven slice.

### Frontend Decision P3. Tauri Packaging Track

- [ ] Frontend decision P3.1 Keep Tauri as a thin lifecycle shell.
  - Goal: Tauri launches or connects to the app-bundled App Server and loads the
    web UI with a native cookie-authenticated no-query local URL.
  - Verification: desktop distribution smoke, app-server health, cookie-authenticated load,
    mutation path uses app-bundled App Server/runtime APIs.

- [ ] Frontend decision P3.2 Do not move AgentMesh logic into Rust.
  - Goal: packet, workflow, review, release, adapter, and lock logic remain in
    the existing Node/CLI/runtime layer.
  - Verification: code review and distribution smoke.

## 6. Review Questions

Ask reviewers to challenge:

- Is delaying React/Vue the right call, or is the current 2800-line frontend
  asset file already enough evidence to migrate?
- Should Vite be introduced before any asset split, or only after split pressure
  is real?
- If a framework is needed, should AgentMesh Studio prefer React or Vue given
  its dense local workbench shape?
- Are the trigger gates concrete enough to prevent indefinite deferral?
- Does the Tauri boundary keep desktop packaging separate from frontend UI
  framework decisions?
- Does the Vite/Tauri bootstrap path preserve dynamic port and per-launch token
  requirements without exposing the token in argv, logs, or URL query strings?

## 7. Current Next Step

Current next step: if this proposal is accepted, implement P1.1 as the next
small slice. If P1.1 shows Vite causes unnecessary churn, record that evidence
and stop before P1.2.
