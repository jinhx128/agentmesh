# Task 13b P3.3 Failure Matrix 实施报告

## 范围与结果

- 仅扩展既有 `reviewer-session-dispatch` canonical boundary：resume 失败现在按有限矩阵执行一次 retry、一次 fallback fresh，或安全终止；没有 resume→fresh→resume 循环。
- `session_expired`、`session_not_found`、`context_overflow` 和 `invalid_output` 记录 `resume_failed`，对 stale epoch 执行 CAS close，并只发起一次 `fallback_fresh`。成功 fresh 仅写一次 replacement entry。
- retryable `unknown` network、`rate_limited` 和 `provider_busy` 至多重试一次；sleep/jitter/remaining-budget 均为依赖注入 seam。Retry-After 只接收 adapter-local、已解析的正数毫秒证据，超界或无效时使用 bounded jitter fallback；不会解析模型输出。
- `auth_required`、`permission_denied`、`configuration_error`、`session_incompatible`、`non_interactive_unsupported` 使用固定安全 guidance，零 retry、零 fresh、零 registry write。
- resume 前 capability drift 会 close/rotate stale entry，且不调用已不存在的 structured parser/hook；只执行一次 plain fallback fresh，`registry_write=false`。
- provider `rate limit` classifier 由粗粒度 `provider_busy` 收窄为 `rate_limited`；公共 `AdapterFailure` schema-v1 未变。`AdapterStructuredResult.retryAfterMs` 是不向 packet/event 输出的 adapter-local 可选 metadata。
- fallback fresh 失败输出也会按旧 provider session ID 脱敏；所有新增 failure 测试均扫描固定 ID `session-test-123`，packet/event/error output 无匹配。

## TDD / 根因记录

1. RED：expired/invalid recovery 与 network retry 测试证明基础边界仅执行一次 resume 后返回。最小实现补充 close、sleep、jitter、budget seam 和有限 action 分支。
2. RED：fallback fresh 再次失败时 fixed provider ID 泄漏。根因是 fresh directive 没有携带 stale ID 给 redactor；恢复路径显式传入旧 ID 后 GREEN。
3. RED：Retry-After 被 jitter 改写。改为有效、预算内的 structured evidence 原样 sleep；无效/超界才走 jitter fallback。
4. RED：adapter rate-limit 被映射为 `provider_busy`，无法保留 rate-limit 动作分支。最小改动为 classifier 输出 `rate_limited`。
5. RED：capability drift 仍会调用 structured hook。resume 前重检 capability，随后 close/rotate 并走 plain fallback fresh。
6. RED：硬失败会返回已脱敏但非固定 guidance 的 provider 文本。改为固定安全 guidance。

## 验证

```sh
npm run build:node
node --test \
  dist-node/tests-node/reviewer-session-dispatch.test.js \
  dist-node/tests-node/flow-dispatch.test.js \
  dist-node/tests-node/flow-run.test.js \
  dist-node/tests-node/reviewer-session-scope.test.js \
  dist-node/tests-node/reviewer-session-registry.test.js \
  dist-node/tests-node/reviewer-session-lease.test.js \
  dist-node/tests-node/adapter-invocation.test.js
git diff --check
git diff --check dba2557
```

- Fresh Node build passed.
- 初始完整 P3.3 focused combination：167/167 passed，0 failed，耗时 30.44s。
- `git diff --check` 与 `git diff --check dba2557` passed。
- flow-dispatch integration 使用 disposable fake provider script；未调用真实 provider CLI、用户 state 或 provider private store。

## 累计自审（`dba2557..worktree`）

- Lock order 仍由外层 run mutation lock 包住 entry lease 和 provider spawn；failure close/write 均在 lease action 内。
- 每个 failure action 是直线且至多一次 retry 或一次 fallback fresh；retry failure 不会刷新 registry，successful resume 只调用一次 `writeResume`。
- close CAS conflict 不会 write-back；fallback fresh 只在 fresh success 时写一次。capability drift 不会调用 absent hook。
- independent first branch、fresh-isolated、P3.3a happy path 与既有 lane fallback 保持原行为；新增 flow-dispatch fake-provider test 验证 primary lane 可在一次 internal fallback fresh 后成功。
- events 只使用允许的 `reviewer_session.*` 名称与 safe refs/reason enum；无 `stage.agent_reused`，无 P3.4 prompt/findings/provenance presentation 改动。

## 已知限制

- production retry sleep 使用 dispatch 注入的 timer；测试仅使用 fake sleep/jitter/budget，未发生真实等待。
- adapter 当前没有已验证的 Retry-After header extractor；seam 已支持上游安全提供 `retryAfterMs`，否则执行有界 jitter fallback。

## 累计 Review 修复（6 Must / 1 Should）

1. RED→GREEN：`effective_mode=independent` 且含 native scope 的 create-time trap 曾创建 HMAC key 父目录；现在仅 continuous policy 调用 `resolveHostScope`，independent 只保留 safe input-presence metadata。
2. RED→GREEN：production registry read 曾把 miss、expired/limit、unsafe/corrupt 都折叠为 `undefined`。现在 canonical boundary 接收 tagged `missing|lifecycle|unavailable|entry`：unsafe/unavailable plain fresh 且不走 structured parser；expired/limit 在 lease 内 CAS close，发出 lifecycle events 后只 replacement fresh 一次。
3. RED→GREEN：leased action exception 曾被 `withLease` catch-all 转成第二次 plain fresh。lease action 现在封装为 tagged result/exception，structured rejection 由一次安全 normalizer 映射到 timeout/config matrix，不再隐式 fresh。
4. RED→GREEN：每次 structured resume/retry/fallback/capability-drift fresh 使用 `remainingBudgetMs` 生成 timeout context；250ms remainder 测试证明传入 `0.25` 秒且 1s retry 不启动。
5. RED→GREEN：busy fresh-isolated 现在接收预冻结 `{runId,laneId,attempt}` 并传递 `run:lane:attempt` idempotency key；测试精确断言 `run-42:review:primary:3`。
6. RED→GREEN：failure classifier 仅检查 adapter diagnostic `stderr`，不再拼接 stdout/model content；新增 stdout-injection regression，并保留 reachable `rate_limited` 与 `provider_busy`。
7. Should RED→GREEN：fake providers 不再保存 argv/raw provider ID，改写 `resume` marker；integration 递归扫描整个 generated run directory，且 marker/packet/event/log/output 均无 fixed ID。

### Review 修复后完整验证

- Fresh Node build passed.
- 完整 P3.3 combination 按无共享状态的 test groups 重新执行：group A（dispatch/registry/lease/adapter）87/87、group B（flow-dispatch）41/41、group C（flow-run/scope）43/43；累计 **171/171 passed，0 failed**。
- `git diff --check` 和 `git diff --check dba2557` passed。

## Final Re-review 修复（3 Must）

1. RED→GREEN：`fresh_isolated` lane attempt 曾基于传入的 stale status snapshot 计数，且 idempotency key 在 production wrapper 被丢弃。现在每次 spawn 前在 run mutation lock 内 reload status 冻结 next lane attempt；`idempotencyKey` 已进入 `runAgentCallAsync` surface，并只作为 `AGENTMESH_INTERNAL_IDEMPOTENCY_KEY` adapter-local env 传给 child，绝不进入 argv/prompt/packet/artifact。adapter integration 覆盖该实际传递路径。
2. RED→GREEN：busy/unavailable plain fresh 曾退回原 timeout。它们现在与 structured recovery 共用 `remainingInvocationContext()`；零 remainder 返回 lane failure 而不 spawn，覆盖 busy 与 unavailable 两种 lease result。
3. RED→GREEN：structured `AgentCallError` timeout 曾丢失 timing/timedOut。normalizer 现在将安全 failure、timing 和 timeout flag 一并返回 canonical result；flow integration 验证 resumed timeout 的 stage attempt 为 `timed_out`、`error_kind=timeout`、`registry_write=false`，且不启动 fresh recovery。
