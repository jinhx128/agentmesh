# 跨宿主 Reviewer 会话复用实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一 Codex、Cursor、Claude Code、Antigravity 或 OpenCode 宿主对话的普通连续复审中复用各 reviewer 的 provider session，同时让正式门禁保持 fresh、packet-first、可审计和不串线。

**Architecture:** 先用五 CLI 能力实测确定哪些 adapter 能从非交互结构化输出安全取得 session ID，再依次实现 Host Scope Resolver、本机 Reviewer Session Registry、Adapter Session Capability 和 dispatch 编排。`interactive_continuous` 可复用，`independent` 物理绕过 registry；resume 始终重发当前 packet，原始宿主/provider session ID 永不进入 packet、日志、Studio 或 telemetry。

**Tech Stack:** TypeScript 5.9、Node.js 22+、`node:test`、Zod 4、TOML、React 19、Mantine、现有 AgentMesh packet/workflow/adapter runtime。

## Global Constraints

- 设计唯一事实源：`docs/superpowers/specs/2026-07-17-cross-host-reviewer-session-reuse-design.md`。
- 本计划是执行期间唯一进度事实源；完成 slice 后必须勾选、加删除线、补进度记录与证据，并更新“当前下一步”。
- Packet schema 继续兼容版本 1；新增字段必须 optional/passthrough-compatible，旧 packet 仍可读取。
- Workflow recipe version 继续为 1；`review_session_mode` 是可选字段，旧 recipe 默认 `auto`。
- 不新增 runtime npm 依赖；使用 Node 标准库和现有 Zod/TOML 工具。
- 不读取或复制 provider token、cookie、keychain、登录态或私有 session-store 文件。
- 原始 host conversation ID 与 provider session ID 不得进入 packet、stdout/stderr、error、event、telemetry、Studio 或 git。
- `independent` 路径不得读取、创建或写入 reviewer session registry。
- V1 不支持通用 session fork，不保持常驻 CLI/PTY，不做跨机器 session 迁移。
- 同一 slice 只允许一个主控修改其文件；按 P0→P5 顺序执行，未完成当前 slice 不开始下一 slice。
- 每个行为变化先写失败测试，再做最小实现；每个 slice 独立验证、审查、同步日志并提交。
- Commit message 使用中文；技术标识可保留英文。

---

## 文件与模块规划

### 新增文件

- `docs/diagnostics/reviewer-session-capability-matrix.md`：记录五 CLI 的结构化 session ID、resume、失败分类与版本证据。
- `packages/runtime/src/reviewer-sessions/scope.ts`：宿主 scope、HMAC reference、workspace/worktree canonical identity。
- `packages/runtime/src/reviewer-sessions/registry.ts`：本机 registry schema、权限、原子读写、TTL/epoch/GC。
- `packages/runtime/src/reviewer-sessions/lease.ts`：entry lock、heartbeat、owner liveness、CAS close。
- `packages/runtime/src/reviewer-sessions/policy.ts`：`auto`/continuous/independent 解析、hard-independent profiles。
- `packages/runtime/src/adapters/session.ts`：adapter session start/resume/result/failure contract 与脱敏工具。
- `packages/cli/src/commands/sessions.ts`：scope 创建、session list/inspect/close/purge。
- `tests-node/reviewer-session-scope.test.ts`
- `tests-node/reviewer-session-registry.test.ts`
- `tests-node/reviewer-session-lease.test.ts`
- `tests-node/reviewer-session-dispatch.test.ts`
- `tests-node/reviewer-session-cli.test.ts`

### 主要修改文件

- `packages/core/src/index.ts`：公共 schema、attempt provenance、adapter capability/failure classification。
- `packages/runtime/src/workflow/registry.ts`、`docs/workflows/review-gate.toml`：workflow session policy。
- `packages/runtime/src/flow/types.ts`、`create.ts`、`dispatch.ts`、`prompt.ts`：scope/policy 冻结、resume 编排、structured delta、packet provenance。
- `packages/runtime/src/adapters/plugin.ts`、`registry.ts`、`invocation.ts`、`packages/runtime/src/adapters.ts`：adapter capability 与 structured session result。
- `packages/cli/src/commands/flow.ts`、`packages/cli/src/cli.ts`：run/session flags 与管理命令。
- `packages/runtime/src/review/artifacts.ts`、`packages/runtime/src/release/check.ts`：non-hermetic evidence 传播。
- `packages/sdk/src/index.ts`、`packages/app-server/src/server.ts`、`apps/studio-web/src/api/runs.ts`、`RunOverview.tsx`、`EventLogView.tsx`：只读展示和本机管理入口。
- `packages/skills/agentmesh-skill/SKILL.md`：跨宿主 propagated scope 约定。
- `README.md`、`index.html`、`apps/studio-web/src/features/manual/ManualView.tsx`、当日 `changelog/`：用户文档与变更事实。

---

## P0. 五 CLI 能力实测与计划校准

- [ ] P0 阶段完成门禁：P0.1 与 P0.Z 完成、能力矩阵有版本与脱敏证据、计划按事实校准。
- 阶段目标：在不读取 provider 私有 store 的前提下，确认每个 CLI 是否能从非交互结构化输出取得 session ID 并显式 resume。
- 阶段门禁：只有矩阵标记 `structured_start=true` 且 `explicit_resume=true` 的 adapter 才进入 P3 session 实现。

### ~~P0.1 / Task 1：建立五 CLI Session 能力矩阵~~ ✅

**Files:**
- Create: `docs/diagnostics/reviewer-session-capability-matrix.md`
- Reference: `packages/runtime/src/adapters/registry.ts`
- Reference: `packages/runtime/src/adapters/invocation.ts`

**Interfaces:**
- Consumes: 当前注册的 Codex、Claude Code、Cursor Agent、Antigravity、OpenCode CLI 与各自 `--help`。
- Produces: 每个 adapter 的 `structured_start`、`session_id_field`、`explicit_resume`、`resume_command_shape`、`failure_classification`、`retention_observation`，供 P3.2 使用。

- [x] **Step 1：记录版本和帮助契约**

  Run:

  ```bash
  agentmesh cli detect --json
  codex exec --help
  codex exec resume --help
  claude --help
  cursor-agent --help
  opencode run --help
  agy --help
  ```

  Expected: 五个工具的安装状态、版本和 resume/continue 参数被记录；输出中不包含 auth token。

- [x] **Step 2：在临时 workspace 逐个执行最小结构化 start/resume smoke**

  对每个 provider 使用其公开非交互 JSON/stream-JSON 选项发送固定提示 `Reply with exactly SESSION_PROBE_OK`，只在临时目录保存原始输出；从公开结构化字段提取 session ID 后执行一次显式 resume，第二轮提示为 `Reply with exactly SESSION_RESUME_OK`。完成后删除包含原始 ID 的临时输出。

  Expected: 矩阵只记录字段名、命令形状、成功/失败、CLI 版本和耗时，不记录原始 session ID。没有稳定结构化 ID 的 adapter 明确标为 fresh-only。

- [x] **Step 3：验证失败分类**

  使用伪造/过期 ID 验证 `not_found/expired`；在不修改登录态的前提下记录 CLI 对 unsupported/incompatible 的退出码与结构化错误。不得主动注销账号或破坏权限来制造 auth 错误。

  Expected: 可安全复现的失败有退出码、stderr 形状和分类；不可安全复现项标为“由 fake CLI 合约测试覆盖”，而不是猜测真实行为。

- [x] **Step 4：写入能力矩阵**

  文档每个 provider 使用此固定结构：

  ```markdown
  ## codex-cli
  - cli_version: 复制 `codex --version` 的完整版本字符串
  - structured_start: 写入字面量 `true` 或 `false`
  - session_id_field: 写入实测结构化字段名；没有则写 `none`
  - explicit_resume: 写入字面量 `true` 或 `false`
  - resume_command_shape: 写入以 `SESSION_ID` 代替真实 ID 的实测命令
  - failure_classification: 只列本 slice 已复现的分类
  - retention_observation: 写入实测时间窗口；未测得则写 `unknown`
  - enablement: 写入 `experimental` 或 `fresh-only`
  ```

- [x] **Step 5：验证和提交**

  Run: `git diff --check && rg -n "token|cookie|session_id: [0-9a-f-]{20,}" docs/diagnostics/reviewer-session-capability-matrix.md`

  Expected: `git diff --check` PASS；第二条不匹配任何原始凭据/ID。

  审查方式：外审。判定依据：这是后续 adapter 设计的 load-bearing 事实，错误会导致安全泄漏或不可用实现。外审执行：使用 AgentMesh Review Gate，要求 reviewer 只检查矩阵证据与命令，不重新登录或读取 store。外审失败策略：重试一次；仍不可用则 P0 标记 `needs_decision`，不得进入 P1。

  证据：CLI 版本、脱敏矩阵、smoke 成败、外审结论。进度记录：执行时补状态、完成时间、验证、审查、日志、commit 与下一步。收尾：勾选并删除线、同步当日日志、`git diff --check`、提交、更新当前下一步。

  Commit: `文档：记录 reviewer session 能力矩阵`

**进度记录（2026-07-17 14:58）：**

- 状态：完成。Claude Code `2.1.207` 与 OpenCode `1.17.18` 通过结构化 start、实际 ID resume、伪 ID 拒绝和精确回复闭环，标记 `experimental`；Codex `0.144.1`、Cursor `2026.07.09-a3815c0`、Antigravity `1.1.3` 证据不足，保持 `fresh-only`。
- 安全：仅从本次公开结构化输出读取临时 ID，原始输出位于仓库外临时目录且已删除；仓库/报告敏感值扫描通过，未读取 provider 私有 store、凭据或登录态。
- 验证：五个 provider 固定八字段完整，`git diff --check` 通过，runtime/schema 零 diff；初次 sandbox worker 的受限结果未采信，使用本机完整权限 fresh implementer 重跑。
- 审查：AgentMesh Review Gate `workflow-20260717144910` 提出 Cursor 连续性过度陈述与 Codex start 歧义；提交 `a36dc02` 修正后，`workflow-20260717145619` 返回 `Spec compliance: Approved`、`Task quality: Approved`、`LGTM`，0 Must / 0 Should / 0 Nit，decision 已完成。
- 提交：`7aa0577`（能力矩阵）、`a36dc02`（收敛 session 能力表述）。日志同步至 `changelog/2026-07-17.md`。
- 下一步：P0.Z 按矩阵把 P3.2 收敛为仅 Claude Code 与 OpenCode enabled adapter，并完成 P0 阶段外审门禁。

### P0.Z / Task 2：P0 阶段收尾校准

**Files:**
- Modify: `docs/superpowers/plans/2026-07-17-cross-host-reviewer-session-reuse.md`
- Review: `docs/diagnostics/reviewer-session-capability-matrix.md`

**Interfaces:**
- Consumes: P0.1 能力矩阵。
- Produces: P3.2 明确的 enabled adapter 列表；未通过者保持 fresh-only。

- [ ] 对照矩阵，将每个 adapter 的 enablement 和 parser 输入字段写回 P3.2 进度记录；不得为失败 provider 编造 parser。
- [ ] Run: `git diff --check && git status --short`；Expected: 仅计划/矩阵/当日日志相关变更。
- [ ] 外审能力矩阵和后续任务是否仍可执行；接受的问题写回计划，拒绝项记录依据。
- [ ] 同步当日 changelog 的“能力调研”事实并提交。

审查方式：外审；阶段门禁不能降级普通自审。外审失败策略：重试或换 reviewer；仍失败标记 `needs_decision`。证据：矩阵、计划 diff、审查输出、commit。进度记录：执行时补齐。Commit: `计划：按 CLI 能力校准 session 实现`

---

## P1. 公共契约与策略冻结

- [ ] P1 阶段完成门禁：核心 schema、workflow policy、CLI/run 输入已冻结且旧 packet/recipe 回归通过。
- 阶段目标：先记录 session 决策与 provenance，所有 adapter 仍保持 fresh-only。

### P1.1 / Task 3：扩展 Core 与 Workflow Session Contract

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/runtime/src/workflow/registry.ts`
- Modify: `docs/workflows/review-gate.toml`
- Test: `tests-node/core-contracts.test.ts`
- Test: `tests-node/workflow-registry.test.ts`

**Interfaces:**
- Produces: `ReviewSessionMode`、`ReviewerSessionAttempt`、adapter capability 字段和 `Workflow.reviewSessionMode`。

- [ ] **Step 1：写失败 schema 测试**

  ```ts
  const attempt = StageAttemptSchema.parse({
    lane_id: "review:a-test",
    primary_agent: "a-test",
    requested_agent: "a-test",
    actual_agent: "a-test",
    lane_attempt: 1,
    attempt: 1,
    timeout_seconds: 240,
    status: "completed",
    session_mode: "resumed",
    session_ref: "rs-0123456789abcdef",
    conversation_scope_ref: "cs-0123456789abcdef",
    scope_source: "propagated",
    hermetic: false,
    non_hermetic_reason: "session_resume",
    registry_write: true,
  });
  assert.equal(attempt.session_mode, "resumed");
  ```

  Add workflow test asserting `review_session_mode = "independent"` parses and an unknown value fails.

- [ ] **Step 2：运行失败测试**

  Run: `npm run build:node && node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/workflow-registry.test.js`

  Expected: FAIL because session schemas/workflow field do not exist.

- [ ] **Step 3：实现最小 schema**

  ```ts
  export const REVIEW_SESSION_MODES = ["auto", "interactive_continuous", "independent"] as const;
  export const ReviewSessionModeSchema = z.enum(REVIEW_SESSION_MODES);
  export const REVIEWER_SESSION_ATTEMPT_MODES = [
    "fresh", "resumed", "fallback_fresh", "fresh_isolated",
  ] as const;
  export const ReviewerSessionAttemptModeSchema = z.enum(REVIEWER_SESSION_ATTEMPT_MODES);
  ```

  Extend optional attempt fields and adapter capability fields `supports_resume` / `supports_structured_session_id`. Add failure classifications `session_not_found`, `session_expired`, `session_incompatible`, `context_overflow`, and `provider_busy`.

- [ ] **Step 4：实现 workflow 解析**

  Add `review_session_mode` to `WORKFLOW_TOP_LEVEL_FIELDS`, default built-in Review Gate to `auto`, Release Check to `independent`, and preserve old recipe compatibility.

- [ ] **Step 5：验证与提交**

  Run: `npm run build:node && node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/workflow-registry.test.js && git diff --check`

  Expected: PASS。

审查方式：外审。判定依据：公共 schema/workflow 行为影响所有 run。外审执行：AgentMesh review stage；失败重试一次，仍失败 `needs_decision`。证据：测试输出、schema diff、审查结论。进度记录：执行时补齐。收尾：日志、commit、当前下一步。Commit: `功能(core)：增加 reviewer session 契约`

### P1.2 / Task 4：冻结 Run Policy、Host Scope 输入与 CLI Flags

**Files:**
- Modify: `packages/runtime/src/flow/types.ts`
- Modify: `packages/runtime/src/flow/create.ts`
- Modify: `packages/cli/src/commands/flow.ts`
- Modify: `packages/cli/src/cli.ts`
- Test: `tests-node/flow-run.test.ts`
- Test: `tests-node/cli-surface.test.ts`

**Interfaces:**
- Consumes: P1.1 `ReviewSessionMode`。
- Produces: `resolved_reviewer_session_policy`、`host_scope_input` 和 run flags。

- [ ] 写失败测试：`--review-session-mode independent`、`--host-kind codex`、`--conversation-scope amscope_v1:11111111-1111-4111-8111-111111111111` 被写入 status 的 resolved policy；非法 token/host/mode 返回 exit 2。
- [ ] Run: `npm run build:node && node --test dist-node/tests-node/flow-run.test.js dist-node/tests-node/cli-surface.test.js`；Expected: FAIL。
- [ ] 实现输入类型：

  ```ts
  export interface HostScopeInput {
    hostKind?: string;
    nativeConversationId?: string;
    propagatedScopeToken?: string;
  }

  export interface ResolvedReviewerSessionPolicy {
    requested_mode: ReviewSessionMode;
    effective_mode: "interactive_continuous" | "independent";
    source: "workflow" | "profile" | "cli" | "fallback";
  }
  ```

  CLI 不打印 native ID/token；`independent` profile 不能被 CLI reuse override 降级。
- [ ] Run targeted tests and `git diff --check`; Expected: PASS。

审查方式：外审；判定依据：安全策略和 CLI 公共接口。外审失败策略：重试或 `needs_decision`。证据：CLI tests、status fixture、审查输出。进度记录：执行时补齐。Commit: `功能(cli)：冻结 reviewer session 运行策略`

### P1.Z / Task 5：P1 阶段收尾校准

- [ ] Run: `npm run build:node && node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/workflow-registry.test.js dist-node/tests-node/flow-run.test.js dist-node/tests-node/cli-surface.test.js && git diff --check`。
- [ ] 验证旧 packet fixture、旧 workflow recipe 和无新 flags 的 run 仍 fresh-compatible。
- [ ] AgentMesh 外审公共 schema、policy override 和独立门禁；处理已接受发现。
- [ ] 同步 changelog、标记 P1 slices、提交。

审查方式：外审；失败不可降级。证据：阶段测试、审查、日志、commit。Commit: `收尾：校准 reviewer session 公共契约`

---

## P2. Host Scope、Registry 与 Lease 基础设施

- [ ] P2 阶段完成门禁：scope 不串线、registry 权限/原子性/TTL/epoch 正确、锁与 CLI 管理闭环。

### P2.1 / Task 6：实现 Host Scope Resolver

**Files:**
- Create: `packages/runtime/src/reviewer-sessions/scope.ts`
- Test: `tests-node/reviewer-session-scope.test.ts`
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**
- Produces: `resolveHostScope(input, cwd): ResolvedHostScope`。

- [ ] 写失败测试：native 优先、propagated token、missing fresh、非法 token、symlink workspace、两个 linked worktree、raw ID 不出现在返回值。
- [ ] 实现接口：

  ```ts
  export interface ResolvedHostScope {
    host_kind: HostKind;
    conversation_scope_ref?: string;
    workspace_id: string;
    worktree_id: string;
    scope_source: "native" | "propagated" | "missing";
  }

  export function resolveHostScope(
    input: HostScopeInput,
    cwd: string,
    options: { hmacKeyPath?: string } = {},
  ): ResolvedHostScope;
  ```

  HMAC key 0600，ref 前缀 `cs-`；workspace/worktree 使用 realpath 和 Git dir identity。
- [ ] Run: `npm run build:node && node --test dist-node/tests-node/reviewer-session-scope.test.js && git diff --check`; Expected: PASS。

审查方式：外审；涉及 ID 隔离和本机密钥。失败策略：重试，不能降级。证据：测试、权限检查、审查。Commit: `功能(runtime)：实现宿主会话作用域`

### P2.2 / Task 7：实现 Reviewer Session Registry 与生命周期

**Files:**
- Create: `packages/runtime/src/reviewer-sessions/registry.ts`
- Test: `tests-node/reviewer-session-registry.test.ts`
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**
- Consumes: P2.1 `ResolvedHostScope`。
- Produces: `sessionRegistryKey`、`read/upsert/close/purgeReviewerSession`。

- [ ] 写失败测试：key normalization、env 只含键名、0600/0700、unsafe permission 拒绝 reuse、原子写、epoch CAS、2h idle、12h/provider retention、resume count 8/9、GC/orphan。
- [ ] 实现 entry：

  ```ts
  export interface ReviewerSessionEntry {
    schema_version: 1;
    key: string;
    session_ref: string;
    provider_session_id: string;
    epoch: number;
    created_at: string;
    last_used_at: string;
    expires_at: string;
    successful_resumes: number;
    invocation_fingerprint: string;
    estimated_context_tokens?: number;
  }
  ```

  Registry 路径固定为 `~/.config/agentmesh/reviewer-sessions/`；原始 ID 只存在 entry 内。
- [ ] 实现 context headroom API：

  ```ts
  export function shouldRotateForContext(input: {
    estimatedHistory: number;
    currentPacket: number;
    reservedOutput: number;
    reasoningHeadroom: number;
    providerLimit?: number;
  }): "keep" | "warn" | "rotate";
  ```

- [ ] Run targeted tests and `git diff --check`; Expected: PASS。

审查方式：外审；涉及敏感本机状态、TTL 和 CAS。失败不可降级。证据：权限/生命周期 tests、审查。Commit: `功能(runtime)：增加 reviewer session registry`

### P2.3 / Task 8：实现 Entry Lease、Heartbeat 与 Sessions CLI

**Files:**
- Create: `packages/runtime/src/reviewer-sessions/lease.ts`
- Create: `packages/cli/src/commands/sessions.ts`
- Modify: `packages/cli/src/cli.ts`
- Test: `tests-node/reviewer-session-lease.test.ts`
- Test: `tests-node/reviewer-session-cli.test.ts`

**Interfaces:**
- Produces: `withReviewerSessionLease`、`sessions scope/list/inspect/close/purge`。

- [ ] 写失败测试：5s contention、10s heartbeat、三次 miss + dead PID reclaim、live PID 不抢锁、PID reuse、epoch close race、fresh isolated 不写 registry。
- [ ] 实现：

  ```ts
  export async function withReviewerSessionLease<T>(
    registryKey: string,
    action: (lease: { epoch: number; heartbeat: () => void }) => Promise<T>,
    options: { waitMs?: number; heartbeatMs?: number; registryPath?: string } = {},
  ): Promise<{ acquired: true; value: T } | { acquired: false; reason: "busy" }>;
  ```

  默认 wait 5000ms、heartbeat 10000ms；锁顺序由 dispatch 保证为 run→entry→spawn。
- [ ] 实现 CLI surfaces：

  ```text
  agentmesh sessions scope create --host codex [--json]
  agentmesh sessions list [--json]
  agentmesh sessions inspect rs-0123456789abcdef [--json]
  agentmesh sessions close rs-0123456789abcdef [--json]
  agentmesh sessions close --scope cs-0123456789abcdef [--json]
  agentmesh sessions purge --expired [--json]
  ```

  输出必须 mask provider ID。
- [ ] Run targeted tests and CLI help tests; Expected: PASS。

审查方式：外审；涉及并发与敏感信息。失败不可降级。证据：lease/CLI tests、审查。Commit: `功能(cli)：增加 reviewer session 生命周期管理`

### P2.Z / Task 9：P2 阶段收尾校准

- [ ] Run P2 targeted tests、`npm run build:node`、`git diff --check`。
- [ ] 手工创建两个 scope、两个 linked worktree，确认 key/ref 隔离且 CLI 不显示原始 ID。
- [ ] AgentMesh 外审 scope/registry/lease 安全与死锁顺序；修复 accepted findings。
- [ ] 同步 changelog、提交、更新当前下一步。

审查方式：外审；失败不可降级。Commit: `收尾：校准 reviewer session 本机状态层`

---

## P3. Adapter Session 与 Dispatch 编排

- [ ] P3 阶段完成门禁：fake CLI 合约、矩阵允许的 adapters、resume/failure/fresh fallback、packet provenance 和 non-hermetic 传播全部通过。

### P3.1 / Task 10：定义 Adapter Session Contract 与 Fake CLI

**Files:**
- Create: `packages/runtime/src/adapters/session.ts`
- Modify: `packages/runtime/src/adapters/plugin.ts`
- Modify: `packages/runtime/src/adapters/registry.ts`
- Modify: `packages/runtime/src/adapters/invocation.ts`
- Test: `tests-node/adapter-plugin.test.ts`
- Test: `tests-node/adapter-invocation.test.ts`

**Interfaces:**
- Produces: `AdapterSessionDirective`、`AdapterStructuredResult`、failure action mapping。

- [ ] 写失败测试覆盖 fresh/resume command builder、structured ID parsing、free-text rejection、raw ID redaction。
- [ ] 实现接口：

  ```ts
  export type AdapterSessionDirective =
    | { mode: "fresh" }
    | { mode: "resume"; providerSessionId: string };

  export interface AdapterStructuredResult {
    providerSessionId?: string;
    outputText: string;
    failure?: AdapterFailure;
  }
  ```

  Extend plugin with optional `buildSessionInvocation` and `parseStructuredSessionResult`; capability false 时继续旧 invocation。
- [ ] 用测试 fake CLI 输出 JSONL start ID、resume success、not_found、rate_limited、auth_required、invalid_output。
- [ ] Run adapter targeted tests; Expected: PASS。

审查方式：外审；公共 adapter contract。失败不可降级。Commit: `功能(adapter)：定义 reviewer session 调用契约`

### P3.2 / Task 11：按能力矩阵实现 Provider Adapter

**Files:**
- Modify: `packages/runtime/src/adapters/invocation.ts`
- Modify: `packages/runtime/src/adapters/registry.ts`
- Modify: `packages/runtime/src/adapters/provider-cli-diagnostics.ts`
- Test: `tests-node/adapter-invocation.test.ts`
- Test: `tests-node/readiness.test.ts`
- Fixture: `tests-node/fixtures/adapters/session/codex-cli/`, `claude-code-cli/`, `cursor-agent/`, `antigravity-cli/`, `opencode-cli/`

**Interfaces:**
- Consumes: P0 matrix 的结构化字段和 command shape；P3.1 contract。
- Produces: 每个 verified adapter 的 session builder/parser；其余 fresh-only。

- [ ] 为矩阵中每个 experimental adapter 保存脱敏结构化 fixture，session 值统一替换为 `session-test-123`。
- [ ] 先写 parser/command failing tests，再实现 P0 已验证的 exact event/field；没有稳定字段的 adapter 明确返回 capability false。
- [ ] Readiness 输出 adapter/version 的 `supports_resume` 和 `supports_structured_session_id`，不执行真实 resume。
- [ ] Run: `npm run build:node && node --test dist-node/tests-node/adapter-invocation.test.js dist-node/tests-node/readiness.test.js && git diff --check`; Expected: PASS。

审查方式：外审；跨 provider 兼容与 session ID 安全。失败策略：单 adapter 不通过时保持 fresh-only，不阻塞其他 verified adapter；计划记录残余限制。Commit: `功能(adapter)：接入已验证的 session resume`

### P3.3 / Task 12：接入 Dispatch Resume、锁与 Failure Matrix

**Files:**
- Modify: `packages/runtime/src/adapters.ts`
- Modify: `packages/runtime/src/flow/dispatch.ts`
- Modify: `packages/runtime/src/flow/create.ts`
- Test: `tests-node/reviewer-session-dispatch.test.ts`
- Test: `tests-node/flow-dispatch.test.ts`

**Interfaces:**
- Consumes: scope/policy/registry/lease/adapter session contract。
- Produces: `fresh|resumed|fallback_fresh|fresh_isolated` attempts。

- [ ] 写失败测试：same scope second run resume、different scope/worktree fresh、independent no registry I/O、busy lock fresh isolated、expired fresh once、network retry、rate-limit Retry-After、auth hard fail、invalid output recovery once、无循环。
- [ ] 实现单一编排函数：

  ```ts
  async function invokeReviewerWithSession(
    runDir: string,
    status: PacketStatus,
    stage: string,
    options: ReviewerSessionInvocationOptions,
  ): Promise<StageAgentAttemptResult>;
  ```

  `independent` 在函数入口立即走现有 fresh invocation；continuous 才解析 scope/registry/lease。
- [ ] Failure actions 精确实现：expired/not_found/overflow/unsupported→fresh once；network→1 jitter retry；rate-limit→Retry-After/budget；busy→bounded retry then lane fallback；auth/permission/trust/incompatible→hard fail。
- [ ] 写 `reviewer_session.created/resumed/fallback_fresh/fresh_isolated/rotated/resume_failed/closed/expired` events，禁止使用 `stage.agent_reused`。
- [ ] Run targeted tests; Expected: PASS。

审查方式：外审；核心状态机和并发行为。外审失败不可降级。Commit: `功能(flow)：编排 reviewer session resume 与回退`

### P3.4 / Task 13：Structured Delta、Packet Provenance 与 Decide 传播

**Files:**
- Modify: `packages/runtime/src/flow/prompt.ts`
- Modify: `packages/runtime/src/flow/dispatch.ts`
- Modify: `packages/runtime/src/review/artifacts.ts`
- Modify: `packages/runtime/src/release/check.ts`
- Test: `tests-node/flow-prompt.test.ts`
- Test: `tests-node/review-artifacts.test.ts`
- Test: `tests-node/release-check.test.ts`

**Interfaces:**
- Produces: since-last delta、obsolete-line marker、session provenance in findings/decide/release summary。

- [ ] 写失败测试：resumed prompt 包含当前 request/diff/verification/corrections 和 since-last changed files；旧行号明确失效；persona/system correction rotate；data correction resend。
- [ ] 实现 bounded delta section：

  ```markdown
  ## Since Last Reviewer Session Turn
  - changed_files: ...
  - previous_file_line_references_are_stale: true
  - authoritative_evidence: current packet request/diff/verification/corrections
  ```

- [ ] Findings、decide prompt、release summary 显示 `hermetic=false` 与原因；independent release 遇 resumed evidence 标 `needs_decision` 或拒绝采信。
- [ ] Run targeted tests; Expected: PASS。

审查方式：外审；影响 reviewer/decider 事实边界和 release gate。失败不可降级。Commit: `功能(review)：传播 session provenance 与代码增量`

### P3.Z / Task 14：P3 阶段收尾校准

- [ ] Run: `npm run build:node`、所有 adapter/session/flow/review/release targeted tests、`git diff --check`。
- [ ] 使用 fake CLI 完成 start→resume→expired→fresh recovery E2E，确认 logs 不含 ID。
- [ ] AgentMesh 多 reviewer 外审核心状态机；review prompt 禁止无关仓库探索、240s per lane。
- [ ] 修复 accepted findings、同步 changelog、提交。

审查方式：外审；失败不可降级。Commit: `收尾：校准 reviewer session dispatch 链路`

---

## P4. 跨宿主 Scope 续传、SDK 与 Studio

- [ ] P4 阶段完成门禁：五宿主 Skill 可安全续传 scope、SDK/App/Studio 只展示脱敏状态、管理入口受控。

### P4.1 / Task 15：更新 Canonical Skill 的跨宿主 Scope 协议

**Files:**
- Modify: `packages/skills/agentmesh-skill/SKILL.md`
- Modify: `packages/skills/src/verify.ts` only if verification metadata changes
- Test: `tests-node/package-structure.test.ts`
- Test: `tests-node/management-cli.test.ts`

**Interfaces:**
- Consumes: `sessions scope create`、run flags。
- Produces: Codex/Cursor/Claude/Antigravity/OpenCode 共用 propagated scope workflow。

- [ ] 写失败 contract test，要求 Skill 明确：首次普通连续 review 创建一个 `amscope_v1`、当前宿主对话后续调用原样传递、token 丢失 fresh、native 优先、不得 workspace fallback、正式 gate independent。
- [ ] 更新 Skill 示例：

  ```bash
  agentmesh sessions scope create --host codex --json
  agentmesh run --workflow w-9d94d0db \
    --host-kind codex \
    --conversation-scope amscope_v1:11111111-1111-4111-8111-111111111111 \
    --review-session-mode interactive_continuous \
    --review a-reviewer --decide current --task "复审当前改动"
  ```

  其他宿主仅替换 `--host-kind`，不复制 provider session ID。
- [ ] Run package/skill verify tests; Expected: PASS。

审查方式：外审；跨宿主规则影响用户调用。失败策略：重试或 `needs_decision`。Commit: `文档(skill)：增加跨宿主 reviewer session 续传`

### P4.2 / Task 16：SDK、App Server 与 Studio 脱敏展示

**Files:**
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/app-server/src/server.ts`
- Modify: `apps/studio-web/src/api/runs.ts`
- Modify: `apps/studio-web/src/features/runs/RunOverview.tsx`
- Modify: `apps/studio-web/src/features/runs/EventLogView.tsx`
- Modify: `apps/studio-web/src/app/copy.ts`
- Test: `tests-node/sdk-read.test.ts`
- Test: `tests-node/studio.test.ts`
- Test: `tests-node/studio-ui.test.ts`

**Interfaces:**
- Produces: masked session summaries、close/purge mutation、localized event labels。

- [ ] 写失败 tests：run summary exposes mode/ref/hermetic but not raw ID；Studio renders reviewer/host/last-used/expiry；close/purge use local mutation safeguards；event labels use `reviewer_session.*`。
- [ ] SDK types only expose:

  ```ts
  interface ReviewerSessionSummary {
    session_ref: string;
    host_kind: string;
    agent_id: string;
    mode: string;
    last_used_at: string;
    expires_at: string;
    hermetic: boolean;
  }
  ```

- [ ] App Server reuses loopback/CSRF/mutation controls; Studio never receives provider session ID。
- [ ] Run SDK/Studio tests and frontend build; Expected: PASS。

审查方式：外审；本机敏感状态与 UI mutation。失败不可降级。Commit: `功能(studio)：展示并管理 reviewer session`

### P4.Z / Task 17：P4 阶段收尾校准

- [ ] Run SDK/Studio/package tests、`npm run build`、`git diff --check`。
- [ ] 真机浏览器/桌面 smoke：列表、关闭、过期清理、无 raw ID；不同 host scope 不串线。
- [ ] AgentMesh 外审跨宿主 Skill、API 脱敏和 UI 边界；处理发现。
- [ ] 同步 changelog、提交。

审查方式：外审；失败不可降级。Commit: `收尾：校准跨宿主 session 管理体验`

---

## P5. 文档、A/B 质量门禁与默认启用

- [ ] P5 阶段完成门禁：全量测试、五 CLI 矩阵、fresh/reuse A/B、文档、发布门禁全部闭环。

### P5.1 / Task 18：补齐用户文档与变更记录

**Files:**
- Modify: `README.md`
- Modify: `index.html`
- Modify: `apps/studio-web/src/features/manual/ManualView.tsx`
- Create or Modify: `changelog/2026-07-17.md`
- Test: `tests-node/package-structure.test.ts`
- Test: `tests-node/studio-ui.test.ts`

- [ ] 文档明确 run resume 与 reviewer session resume 区别、continuous/independent、TTL、CLI commands、fresh fallback、non-hermetic、fresh-only adapters 和安全限制。
- [ ] README/index/manual 命令与 CLI help 一致；不承诺未通过 P0 的 provider。
- [ ] Run package/UI tests、link/path grep、`git diff --check`; Expected: PASS。

审查方式：外审；功能级用户行为文档。失败策略：重试，低风险纯文案项才可在充分测试后降级自审。Commit: `文档：说明 reviewer session 复用与限制`

### P5.2 / Task 19：执行 Fresh/Reuse A/B 与安全回归

**Files:**
- Modify: `docs/diagnostics/reviewer-session-capability-matrix.md`
- Modify: `docs/superpowers/plans/2026-07-17-cross-host-reviewer-session-reuse.md`
- Test: `tests-node/reviewer-session-dispatch.test.ts`
- Test: `tests-node/release-check-flow.test.ts`

- [ ] 对每个 enabled adapter 使用相同 prompt-scope、相同 diff、相同注入缺陷，分别跑 fresh 与 resumed；记录墙钟、tool reads、输出有效性、缺陷检出、false-LGTM。
- [ ] 验证两个宿主对话、两个 worktree、两个 model、并发 run、native/explicit close、CI/换机 registry miss。
- [ ] 运行敏感信息扫描：packet/log/error/Studio 中不得匹配 smoke 的 provider session ID。
- [ ] 若任一 adapter 无显著性能收益或质量回退不可接受，将其保持 experimental/fresh-only；不得为完成发布门禁而放宽指标。

审查方式：外审；默认启用和质量门禁。失败不可降级。证据：A/B 表、E2E run IDs、测试输出、审查。Commit: `测试：验证 reviewer session 性能与隔离`

### P5.Z / Task 20：项目总收尾与发布门禁

- [ ] Run: `npm run check:boundaries && npm test && git diff --check`。
- [ ] 检查 `README.md`、`index.html`、Manual、Skill、capability matrix、changelog、CLI help、Studio copy 一致。
- [ ] 生成 release summary，聚合 diff、验证、跳过项、accepted/rejected/unresolved findings、残余风险。
- [ ] 通过 AgentMesh Release Check 外审；普通 review 每 lane 240s 且禁止无关探索，release reviewers 使用 independent fresh。
- [ ] 只有无未解决 Must Fix、关键验证无跳过、回滚路径明确时给 `Verdict: ready`；否则 `not_ready` 或 `needs_decision`。
- [ ] 提交最终收尾；版本升级、npm/GitHub/桌面产物发布不在本计划自动授权范围内，需用户另行明确。

审查方式：发布门禁外审；不能降级自审。Commit: `收尾：完成 reviewer session 复用门禁`

---

## 整体验证

- 自动化：`npm run check:boundaries && npm test && git diff --check`。
- 定向：core/workflow、scope/registry/lease、adapter、dispatch/prompt/review/release、CLI、SDK/Studio、package/skill tests。
- 手工：五 CLI 能力 smoke；同对话连续 run；双对话/双 worktree 隔离；锁竞争；close/purge；Studio 脱敏。
- 安全：扫描 smoke session ID 不得出现在 `.agentmesh/runs`、logs、events、Studio API payload 或 git diff。
- 质量：fresh/resume 使用相同 prompt 范围，分别记录 latency、tool reads、output validity、defect detection、false-LGTM。
- 发布门禁：必须输出 `ready`、`not_ready` 或 `needs_decision`，并记录决策依据。

## 风险与回滚

- Provider 结构化协议变化：按 CLI version capability disable；回滚为 fresh-only。
- Registry 权限/损坏：拒绝 reuse，不影响 fresh review；CLI purge/close 清理本机条目。
- 并发死锁：固定 run→entry→spawn 顺序；锁超时 fresh isolated；回滚可关闭 continuous policy。
- Hidden state 污染：完整重发 packet、non-hermetic 传播、formal gate independent；回滚为 workflow `independent`。
- Host token 遗失：安全退化 fresh，旧 entry 由 GC 清理；禁止 workspace fallback。
- 质量回退：单 adapter 关闭 capability，不影响其他 adapter；普通默认启用必须通过 P5 A/B。
- Packet 兼容：新增字段 optional；若读取回归，回滚 schema usage 而不破坏旧 packet。

## 当前下一步

- 当前下一步：`P0.Z` 按已外审能力矩阵校准 P3.2 enabled adapter 与 parser 字段，完成 P0 阶段门禁；P0.Z 完成前不开始 P1。
