## Read-only review: `docs/decisions/studio-frontend-stack-proposal.md`

I verified the supporting facts before critiquing: `apps/studio/src/assets.ts` is **2814 LOC** of embedded HTML/CSS/JS strings; `tests-node/studio-ui.test.ts` is **1729 LOC** with **151** regex/string assertions over those constants; `studio-shell.md` and `studio-productization.md` already defer React/Vite explicitly; `studio-distribution.md` fixes Tauri-as-thin-shell with sidecar + dynamic port + per-launch token. The proposal is internally consistent with prior decisions, but several gates and ordering claims do not survive contact with the current code.

---

### Must (block accept until addressed)

1. **The "delay React/Vue" claim partially contradicts the proposal's own trigger gate #6.**
   Gate #6 says introduce a framework when "tests become mostly DOM-string assertions because behavior is hard to isolate." `tests-node/studio-ui.test.ts:151` matches reference STUDIO_HTML/STUDIO_CSS/STUDIO_JS as raw strings — that *is* the gate, today, not hypothetically. Either the proposal must (a) explain why 151 regex assertions over a 2.8k-LOC string blob does not qualify, or (b) demote "delay framework" from recommendation to "re-evaluate immediately after P1.1." As written the doc claims the gate is not met without examining whether it already is.

2. **Tauri boundary description omits the token + dynamic-port injection contract.**
   `studio-shell.md` requires the packaged App Server to bind a dynamic loopback port with a per-launch auth token. Today, `assets.ts` is server-rendered so the Studio server can inject anything. A static Vite `dist/` cannot. The proposal treats "Tauri frontend dist" as a packaging detail, but the *real* constraint on P2/P4 is the runtime mechanism for handing the bundled JS its port+token (template substitution at server boot, `__bootstrap.json` fetch, custom-scheme query string, etc.). This belongs in the Vite-gate section as an explicit acceptance criterion, not as a P4 surprise.

### Should (strongly recommend revising)

3. **Vite-before-or-after-split ordering is under-argued.**
   Splitting `assets.ts` *without* a bundler produces one of: many `export const X = "..."` modules concatenated at runtime; many separate server routes; or a hand-rolled assembler. All three are throwaway work once Vite arrives. The doc should either justify the interim form (what does a split-without-bundler artifact look like, and why is it not a step backward?) or invert to P2 → P1.1. The current "split first, Vite if painful later" sequence smells like make-work.

4. **Vite trigger gates are not concrete; #1 is circular.**
   "Splitting needs real browser-module bundling" is "introduce Vite when you need Vite." "Painful", "slowed", "stable test/build outputs" are subjective. Add at least one measurable threshold (e.g., `assets.ts > 3500 LOC`, or `> N` separate string-export modules, or any need to import a third-party browser package). Same problem on most React/Vue gates — "become fragile", "hard to isolate" do not bind. Reviewers will rubber-stamp deferral indefinitely, which is exactly the failure mode §4 warns against.

5. **React-vs-Vue default is soft and asymmetric.**
   "React unless team preference favors Vue" is not a tiebreaker — team preference is exactly the noise the doc claims to reject. The two stacks are also presented asymmetrically (TanStack Query = server-state cache; Pinia = general client store), which obscures the actual comparison. Either commit ("React, because X measurable property of dense workbench UIs"), or explicitly mark undecided and defer the choice to P3.1's decision doc — don't soft-default.

6. **P3.2 pilot slice is too large.**
   "Run navigator + selected run summary" is the majority of the workspace surface and shares state with most other panels. That's not a vertical pilot, it's a partial rewrite. The catalog page (or settings tab) would prove state/rendering/tests/asset-serving with far less state-coupling exposure.

7. **`Element Plus` appears in both the Vue recommendation and the "Rejected" list.**
   It is "acceptable alternate" under Vue and also "Immediate Element Plus adoption" rejected. The distinction (immediate vs. conditional-on-Vue) is technically defensible but reads as inconsistent. Tighten.

### Nit

8. **i18n is not mentioned.** Current HTML is zh-Hans with a language switch; any framework migration carries non-trivial localization-key work. One line under P3.1 scope.

9. **macOS WebView API surface for Radix/shadcn is not flagged.** Tauri 2 on macOS uses WKWebView, which is generally fine for Radix v1 but has known gaps vs. Chromium (e.g., some focus-visible/popover edge cases). Worth a one-line "validate against Tauri WebView before locking in Radix" note in the React stack listing.

10. **`P1.Z` / `P2.Z` phase reviews have no calendar or scope bound.** Adding "no later than next Studio iteration" or "after N new feature requests land in `assets.ts`" prevents the indefinite-deferral failure the doc itself names.

11. **Non-goals correctly forbid moving logic into Rust, but Recommendation §5 doesn't repeat that constraint when Tauri is reintroduced.** Cheap reinforcement, worth duplicating.

---

### Final recommendation

**Conditional accept.** The strategic direction (defer framework, keep Tauri thin, Vite as first build boundary, no Rust-side logic) is correct and consistent with `studio-shell.md` / `studio-distribution.md` / `studio-productization.md`. The blockers are not the direction but the evidence handling and gate rigor:

- Address Must #1 (re-examine whether the test-string-assertion gate is already met) and Must #2 (token/port injection as a P2 acceptance criterion) before merging.
- Either invert P1.1/P2.1 or justify the split-without-bundler interim artifact.
- Replace at least the top three subjective gates with measurable thresholds.
- Demote "React default" to "to be decided in P3.1" unless a non-preference rationale is supplied.

Without these, the proposal risks being used to justify both "don't migrate yet" *and* "migrate when convenient," which is the worst of both outcomes.

---
_used_: mode=无 · skills=无 · tools=Read,Glob,Bash
