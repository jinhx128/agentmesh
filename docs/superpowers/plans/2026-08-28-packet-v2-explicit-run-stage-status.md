# Packet v2 显式运行与阶段状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Packet 状态协议升级到 v2，用显式 `run_status`、`current_stage`、`stage_status` 取代含混且重复的 `status`、`completed_stages`、`failed_stage`、`stage_state`，并让 CLI、SDK、App Server 与 Studio 使用同一状态口径。

**Architecture:** `PacketStatusSchema` 是唯一持久化契约，Runtime 是唯一写入者。`run_status` 表达整条运行生命周期，`stage_status` 表达每个节点状态，`current_stage` 明确当前待处理或正在执行的节点；读取层只投影这些字段，不再从字符串后缀或完成数组反推。Packet v1 直接拒绝，不提供迁移、回退读取或双写。

**Tech Stack:** TypeScript、Zod、Node.js test runner、React、Mantine、Vite、Tauri。

## Global Constraints

- `CURRENT_SCHEMA_VERSION` 保持 `1`；`CURRENT_PACKET_SCHEMA_VERSION` 独立升级为 `2`。
- 删除 Packet v1 字段：`status`、`completed_stages`、`failed_stage`、`stage_state`。
- Packet v2 新字段：`run_status`、`current_stage?`、`stage_status`。
- `run_status` 只允许：`pending`、`running`、`awaiting_current`、`completed`、`failed`、`timed_out`、`aborted`。
- `stage_status` 使用现有 `StageStateSchema`，并新增 `timed_out`；必须包含所有 `stage_nodes` 且不能包含额外节点。
- 不迁移、不读取 Packet v1；旧运行由兼容性检查明确拒绝。
- Call/Event/Workflow recipe 的通用 `schema_version` 仍为 `1`；只有 Packet status 为 v2。
- 不新增依赖，不修改 Call 状态模型。
- 保留当前工作区已有未提交修改，不回滚无关文件。

---

### Task 1: 定义 Packet v2 核心契约

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `tests-node/helpers/current-packet-status.ts`
- Modify: `tests-node/core-contracts.test.ts`
- Modify: `tests-node/packet-validate.test.ts`

**Interfaces:**
- Produces: `RunStatusSchema`、`RunStatus`、Packet v2 `PacketStatusSchema`。
- Produces: `PacketStatus.run_status`、`PacketStatus.current_stage?`、`PacketStatus.stage_status`。
- Removes: `PacketStatus.status`、`completed_stages`、`failed_stage`、`stage_state`。

- [ ] **Step 1: 写 Packet v2 失败测试**

  在 `core-contracts.test.ts` 断言：通用 schema 仍为 1、Packet schema 为 2、v1 被拒绝；合法 v2 使用：

  ```ts
  {
    schema_version: 2,
    run_status: "awaiting_current",
    current_stage: "decide",
    stage_status: {
      review: "completed",
      decide: "planned",
    },
  }
  ```

  并断言旧字段、缺失节点、额外节点、`completed + current_stage`、`running + planned current stage` 均被拒绝。

- [ ] **Step 2: 验证测试按预期失败**

  Run: `npm run build:node && node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/packet-validate.test.js`

  Expected: FAIL，原因是 Packet 仍为 v1 且新字段不存在。

- [ ] **Step 3: 实现最小 Packet v2 schema**

  在 Core 中定义：

  ```ts
  export const CURRENT_PACKET_SCHEMA_VERSION = 2 as const;
  export const RUN_STATUSES = [
    "pending",
    "running",
    "awaiting_current",
    "completed",
    "failed",
    "timed_out",
    "aborted",
  ] as const;
  export const RunStatusSchema = z.enum(RUN_STATUSES);
  export type RunStatus = z.infer<typeof RunStatusSchema>;
  ```

  `PacketStatusSchema` 要求 `run_status` 和完整 `stage_status`，并校验 `current_stage` 必须属于 `stage_nodes`。删除四个旧字段及其校验。

- [ ] **Step 4: 更新公共测试 helper 并验证 GREEN**

  `currentPacketStatus()` 默认生成 `run_status: "awaiting_current"`、首节点 `current_stage`、完整 `stage_status`。

  Run: `npm run build:node && node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/packet-validate.test.js`

  Expected: PASS。

- [ ] **Step 5: Slice 自审**

  检查 Packet v1 确实被拒绝，通用 schema 未升级，schema 中不再出现四个旧字段。

---

### Task 2: Runtime 改为显式状态机

**Files:**
- Modify: `packages/runtime/src/flow/create.ts`
- Modify: `packages/runtime/src/flow/state.ts`
- Modify: `packages/runtime/src/flow/dispatch.ts`
- Modify: `packages/runtime/src/release/verdict.ts`
- Modify: `packages/runtime/src/release/check.ts`
- Modify: `tests-node/flow-run.test.ts`
- Modify: `tests-node/flow-dispatch.test.ts`
- Modify: `tests-node/flow-retry-resume.test.ts`
- Modify: `tests-node/release-check-flow.test.ts`
- Modify: `tests-node/flow-preset-run.test.ts`

**Interfaces:**
- Produces: `completedStageIds(status)`、`failedStageId(status)`、`setStageStatus(status, stage, state)`、`setRunWaitingForStage(status, stage)`。
- Consumes: Task 1 Packet v2 types。

- [ ] **Step 1: 写状态转换失败测试**

  覆盖以下真实转换：

  ```text
  create + first=current -> awaiting_current / first planned
  create + first=worker  -> pending / first planned
  start                 -> running / stage running
  complete + next=current -> awaiting_current / next planned
  complete + next=worker  -> pending / next planned
  complete final          -> completed / no current_stage
  failure                 -> failed / stage failed
  timeout                 -> timed_out / stage timed_out
  retry                   -> running / same current_stage
  ```

- [ ] **Step 2: 验证状态转换测试失败**

  Run: `npm run build:node && node --test dist-node/tests-node/flow-run.test.js dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/flow-retry-resume.test.js dist-node/tests-node/release-check-flow.test.js`

  Expected: FAIL，输出仍包含旧字段或旧阶段字符串状态。

- [ ] **Step 3: 实现 Runtime 状态辅助函数**

  `completedStageIds` 从 `stage_status === "completed"` 计算；`failedStageId` 从 `current_stage` 与 `failed/timed_out` 状态获取。保护已完成产物、前置节点校验、retry/resume 统一调用这些函数。

- [ ] **Step 4: 改写 Runtime 状态转换**

  创建时写完整新字段；`startStage`、`completeStage`、`failStage` 只写新字段。`dispatchRemainingStages` 遇到 `current` 时必须持久化 `awaiting_current`，不能只写事件。`failStage` 接收 `timedOut`，区分 `failed` 与 `timed_out`。

- [ ] **Step 5: 改写发布判定与摘要**

  无效 Verdict 写 `run_status: "failed"` 和对应 `stage_status`。Release summary 输出 `run_status`、按 `stage_status` 计算的已完成节点和失败节点。

- [ ] **Step 6: 验证 Runtime GREEN**

  Run: `npm run build:node && node --test dist-node/tests-node/flow-run.test.js dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/flow-retry-resume.test.js dist-node/tests-node/release-check-flow.test.js dist-node/tests-node/flow-preset-run.test.js`

  Expected: PASS。

---

### Task 3: SDK、App Server、CLI 使用 Packet v2

**Files:**
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/app-server/src/packet-browser.ts`
- Modify: `packages/cli/src/commands/flow.ts`
- Modify: `packages/cli/src/commands/packet.ts`
- Modify: `apps/studio-web/src/api/runs.ts`
- Modify: `tests-node/sdk-read.test.ts`
- Modify: `tests-node/studio.test.ts`
- Modify: `tests-node/cli-surface.test.ts`
- Modify: `tests-node/packet-io.test.ts`

**Interfaces:**
- Produces: `AgentMeshRunSummary.run_status`、`current_stage?`、`stage_status`。
- Produces: `StudioRunSummary.run_status` 和 `StudioRunDetailSummary.stage_status`。
- Removes: SDK/Studio summary 的 `status`、`completed_stages` 和 actions 的 `failed_stage`。

- [ ] **Step 1: 写读取/API 失败测试**

  断言 SDK 和 App Server 原样投影新字段；`studioRunActions` 使用 `run_status/current_stage/stage_status`，`awaiting_current` 返回 attach，`completed` 无操作，`failed/timed_out` 返回 retry/resume。

- [ ] **Step 2: 验证读取测试失败**

  Run: `npm run build:node && node --test dist-node/tests-node/sdk-read.test.js dist-node/tests-node/studio.test.js dist-node/tests-node/cli-surface.test.js dist-node/tests-node/packet-io.test.js`

  Expected: FAIL，读取层仍访问旧字段。

- [ ] **Step 3: 改写 SDK 与 App Server**

  SDK 不再调用 `currentStage()` 反推当前节点；直接读取 `current_stage`。App Server 的 completed/running/failed/awaiting_current 判断只看 `run_status`，next stage 使用 `current_stage`，已完成数从 `stage_status` 计算。

- [ ] **Step 4: 改写 CLI 输出**

  `flow status` 和 `packet status` 输出整体 `run_status`、当前节点、按 `stage_status` 汇总的已完成节点，不输出旧字段名。

- [ ] **Step 5: 验证读取层 GREEN**

  Run: `npm run build:node && node --test dist-node/tests-node/sdk-read.test.js dist-node/tests-node/studio.test.js dist-node/tests-node/cli-surface.test.js dist-node/tests-node/packet-io.test.js`

  Expected: PASS。

---

### Task 4: Studio 统一状态与时间展示

**Files:**
- Modify: `apps/studio-web/src/app/status-labels.ts`
- Modify: `apps/studio-web/src/features/navigation/ActivityNavigator.tsx`
- Modify: `apps/studio-web/src/features/runs/RunOverview.tsx`
- Modify: `apps/studio-web/src/features/actions/SafeActionsPanel.tsx`
- Modify: `tests-node/studio-ui.test.ts`
- Modify: `tests-node/result-status.test.ts`

**Interfaces:**
- Consumes: `StudioRunSummary.run_status` 和 `StudioRunDetailSummary.stage_status/current_stage`。
- Produces: 唯一中文整体状态映射和阶段状态映射。

- [ ] **Step 1: 写 UI 失败测试**

  当前问题夹具必须断言：活动列表“待决策”、总览“等待决策”、进度 `1/2`、审查节点“已完成”、决策节点“待提交”、无结束时间。最终 `completed` 夹具才显示“成功”和结束时间。

- [ ] **Step 2: 验证 UI 测试失败**

  Run: `npm run build && node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/result-status.test.js`

  Expected: FAIL，前端仍解析旧 `status` 后缀。

- [ ] **Step 3: 删除前端状态反推**

  活动列表对运行使用 `runStatusLabel(run_status)`，对调用继续使用 `callStatusLabel`。删除任意 `_completed` 视为成功的正则。流程图直接读取 `stage_status`；`awaiting_current + current_stage` 显示“待提交”，不再显示含混的“当前”。

- [ ] **Step 4: 统一时间语义**

  开始时间取最早阶段 `started_at`；`completed/failed/timed_out/aborted` 才显示结束时间；`pending/running/awaiting_current` 不显示结束时间。非终态显示“已历时”，终态显示“耗时”。

- [ ] **Step 5: 验证 Studio GREEN**

  Run: `npm run build && node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/result-status.test.js`

  Expected: PASS。

---

### Task 5: 更新全部 v2 夹具、Workflow 兼容声明和文档

**Files:**
- Modify: `tests-node/**/*.test.ts` 中所有 Packet status 字面量
- Modify: `tests-node/fixtures/packets/valid-basic/status.json`
- Modify: `docs/workflows/review-gate.toml`
- Modify: `examples/workflows/docs-check.toml`
- Modify: `docs/contracts/workflow-toml.md`
- Modify: `apps/studio-web/src/features/catalog/CatalogView.tsx`
- Modify: `packages/skills/agentmesh-skill/SKILL.md`
- Modify: `.agents/skills/agentmesh/SKILL.md`

**Interfaces:**
- Consumes: Packet v2 契约。
- Produces: 全仓库只生成和声明 Packet v2。

- [ ] **Step 1: 批量更新当前测试夹具**

  将 Packet status 字面量改为 `schema_version: 2` 与新字段；Workflow `compatible_packet_schema_versions` 改为 `[2]`。不修改归档历史文档。

- [ ] **Step 2: 扫描旧协议残留**

  Run:

  ```bash
  rg -n 'completed_stages|stage_state|failed_stage|status\.status' packages apps tests-node
  rg -n 'compatible_packet_schema_versions\s*=\s*\[1\]' packages apps tests-node docs/workflows examples
  ```

  Expected: 活跃代码和当前测试无旧字段、无 Packet `[1]` 声明。

- [ ] **Step 3: 跑全量验证**

  Run: `npm test`

  Expected: 全部测试通过。

  Run: `npm run check:boundaries && npm run studio-desktop:package:dev && git diff --check`

  Expected: 全部通过；桌面分发 smoke 的 `issues=[]`。

- [ ] **Step 4: 真机回归**

  创建 `review -> decide(current)` 新运行，验证审查完成后为“待决策”、无结束时间；提交决策后变为“成功”、2/2 并显示结束时间。旧 Packet v1 必须显示明确“不支持 Packet schema 1”，不能静默展示。

- [ ] **Step 5: 收尾记录**

  若用户要求发布，再按 `my-changelog` 同步日志、升级版本、提交和发布；本计划实现阶段不自动发布。

## 验收门禁

- Packet v2 是唯一支持版本，v1 明确拒绝。
- Runtime 不再持久化四个旧字段。
- SDK、App Server、CLI、Studio 不再解析阶段后缀判断整体成功。
- `review completed + decide current` 在所有页面统一显示“待决策/待提交”。
- 最终节点完成后统一显示“成功”，结束时间只在终态出现。
- `npm test`、边界检查、桌面分发 smoke、`git diff --check` 全部通过。

## 当前下一步

- 执行 Task 1：先看到 Packet v2 核心契约测试按预期失败。
