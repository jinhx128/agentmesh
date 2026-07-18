# Task 14 P3.4 Provenance 实施报告

## 范围与结果

- canonical reviewer-session boundary 在 registry hit 已确定 `resumed` 后、真实 provider spawn 前调用单一 pre-spawn hook；该 hook 重写实际 provider 使用的 prompt 文件，追加一次有界 `## Since Last Reviewer Session Turn`。
- delta 只从 packet `Scoped Git Diff` / `Diff` 中提取，排序、去重、按文件数与 UTF-8 字节数上限截断，并保留精确 stale-line 与 authoritative-evidence 标记；fresh、fallback-fresh、fresh-isolated 与 independent 均不写该段。
- correction record 新增可选 schema-v1 兼容 `session_impact = data|persona|system`。缺失 legacy 字段视为 `data`；仅 active `persona` / `system` correction 的排序 `impact:id` 进入 invocation fingerprint，普通数据 correction 仍作为当前 packet context 重发而不轮换 session；statement 等正文不进入 fingerprint。
- StageAttempt 是 findings、decide prompt、release summary 的唯一 provenance 来源。resumed evidence 安全显示 reviewer/lane、`session_mode: resumed`、`hermetic: false` 与 `non_hermetic_reason: session_resume`，不显示 provider/native ID、registry key 或 token；重复 refresh 不重复 section。
- independent release 遇到 resumed evidence 会在 release policy 增加 `session_resume` needs-decision risk，并在 release summary 与 decide prompt 明示 current packet authoritative、hidden history advisory；未改写 controller findings 或 release decision 原文。

## TDD / 调试记录

1. RED：新增 resumed prompt test 后，build 如预期因缺少 `withReviewerSessionDelta` 报 TS2305；实现最小 bounded delta helper 后转 GREEN。
2. 首轮整合回归暴露 artifact helper 在 standalone repair/test run 中假设 `status.json` 存在。根因是 provenance 读取成为无条件依赖；最小修复为该 helper 缺 status 时保留原有无 provenance 行为，随后回归 GREEN。
3. 自审发现 correction impact 虽被构造却尚未进入 registry 的 normalized fingerprint。补充显式 optional fingerprint input、格式校验及排序归一化测试，确认 persona/system 改变 registry key，而 ordinary/legacy data 不参与。

## 验证

```sh
npm run build:node
node --test \
  dist-node/tests-node/flow-prompt.test.js \
  dist-node/tests-node/review-artifacts.test.js \
  dist-node/tests-node/release-check.test.js \
  dist-node/tests-node/reviewer-session-dispatch.test.js \
  dist-node/tests-node/flow-dispatch.test.js \
  dist-node/tests-node/flow-run.test.js \
  dist-node/tests-node/reviewer-session-scope.test.js \
  dist-node/tests-node/reviewer-session-registry.test.js \
  dist-node/tests-node/reviewer-session-lease.test.js \
  dist-node/tests-node/adapter-invocation.test.js \
  dist-node/tests-node/corrections.test.js
git diff --check
git diff --check f219886
```

- Fresh Node build passed.
- Focused suite passed **206/206**, 0 failed. Flow-dispatch uses disposable fake providers only; the real provider prompt file for the resumed invocation was asserted to contain exactly one delta section and no fixed provider ID.
- Both diff checks passed.

## BASE→HEAD 自审（base `f219886`）

- Prompt timing: only `resumeExisting()` calls the pre-spawn hook, immediately before resume spawn; repeated write removes any old delta before adding one replacement section.
- Correction rotation: no statement/free-text inference; legacy/default data behavior is stable; fingerprint input contains only validated impact/id labels.
- Provenance: generated exclusively from StageAttempt safe fields; findings refresh, bounded decide prompts, and release summary are deterministic and omit raw identifiers.
- Release boundary: independent policy receives a visible `session_resume` needs-decision risk rather than treating resumed evidence as normal clean evidence; exact decision verdict-line parser remains unchanged.
- Bounds/compatibility: changed-file extraction is packet-only and bounded; optional fields preserve schema-v1 legacy records/attempts.
- P3.3: no failure matrix, lease, retry, or provider behavior changed beyond the narrow pre-spawn hook.

## 已知限制

- 本 slice intentionally does not add correction CLI UX for selecting `session_impact`; the typed optional field is available to record producers and preserves existing CLI behavior. This follows the P3.4 scope boundary against unrelated CLI UX work.

## Review Fix Follow-up

### RED

1. Review regression tests first exposed that provenance had no usable-review projection API (TS2554), matching the reviewed false-warning defect.
2. The new dispatch integration initially failed only on an over-broad test assertion that treated correction statement text in the intentionally authoritative packet context as a leak. The relevant invariant is that free text is absent from the fingerprint, while it remains present in current packet evidence; the test was narrowed accordingly.

### GREEN

- Fresh recovery now invokes `prepareFreshPrompt` before structured or plain fallback fresh spawn, restoring the canonical base prompt.
- Resumed prompt includes bounded current authoritative diff/verification/active-correction sections and an AgentMesh-owned terminal sentinel pair; repeated preparation replaces only that exact terminal block.
- Findings recomposition strips generated raw/provenance sections in a stable order, writes provenance before raw outputs, filters to completed attempts with non-empty matching raw review output, and applies deterministic reviewer/lane plus UTF-8 bounds with a truncation marker.
- Decide and release use the same safe usable-raw projection.
- Disposable dispatch integration covers data correction resume plus persona add/supersede/removal and system add rotations; only the data correction run resumes, and generated packet artifacts never contain `session-test-123`.

## Final Review Follow-up

### RED

- A 22 KB diff + verification + multiple 22 KB project corrections regression proved the prior overall head/tail excerpt could omit the verification category entirely and duplicate `Current Authoritative Evidence` after re-preparation.

### GREEN

- Current authoritative evidence and the since-last delta now share one AgentMesh-owned terminal sentinel block. Re-entry replaces the entire owned block while preserving request/prior artifacts with same-named headings.
- Diff, verification, and corrections each receive independent bounded excerpts before composition. Corrections are sorted by safe correction ID, bounded per entry and in total, and report deterministic omitted-count/ID summaries; the fixed category budgets remain below the terminal evidence total budget, so no present category disappears under a later global trim.
- The large-evidence regression asserts per-category original byte counts and truncation markers for 22 KB diff/verification/correction payloads, deterministic multi-correction omission metadata, and one owned terminal block after repeated preparation.
