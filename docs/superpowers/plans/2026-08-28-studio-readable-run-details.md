# Studio 运行详情可读化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** 将运行目录移入总览，并把上下文策略、执行策略从裸 JSON 改为中文可读摘要。

**Architecture:** 不修改 App Server、SDK 或 Packet schema，仅在 `RunOverview` 中派生展示字段。已知策略字段映射为中文摘要，完整原始对象保留在二级折叠区，确保未知扩展字段不丢失。

**Tech Stack:** React 19、TypeScript、Mantine、Node Test Runner。

## Global Constraints

- 不新增依赖，不修改数据结构和接口。
- 不兼容旧 UI 状态；折叠区域默认关闭。
- 只修改运行详情组件、中文文案、局部样式及 UI 测试。

### Task 1: 锁定总览与策略摘要行为

**Files:**
- Modify: `tests-node/studio-ui.test.ts`

- [ ] 增加总览字段断言：标题、当前节点、运行目录、开始、结束、耗时。
- [ ] 增加策略摘要断言：中文字段和值、原始数据默认折叠。
- [ ] 运行聚焦测试，确认因目标行为尚未实现而失败。

### Task 2: 实现可读化展示

**Files:**
- Modify: `apps/studio-web/src/features/runs/RunOverview.tsx`
- Modify: `apps/studio-web/src/app/copy.ts`
- Modify: `apps/studio-web/src/styles.css`

- [ ] 将运行目录和补充字段加入总览，并从高级信息顶层移除。
- [ ] 将上下文策略映射为文件数、大小、必需来源、排除路径、脱敏规则数量。
- [ ] 将执行策略映射为配置来源、用户确认、自动分发和最大重试次数。
- [ ] 将完整 JSON 放入每张策略卡片的“查看原始数据”二级折叠区。

### Task 3: 验证

**Files:**
- Test: `tests-node/studio-ui.test.ts`

- [ ] 运行聚焦 UI 测试并通过。
- [ ] 运行 `npm test` 并通过全部测试。
- [ ] 运行 `git diff --check`，确认没有格式错误。

审查方式：低风险局部 UI 改动，采用自审；依据是无接口和数据变更，且已有确定性 SSR 断言及全量测试覆盖。

### Task 4: 运行总览字段左右分栏

**Files:**
- Modify: `tests-node/studio-ui.test.ts`
- Modify: `apps/studio-web/src/features/runs/RunOverview.tsx`
- Modify: `apps/studio-web/src/styles.css`
- Create: `docs/superpowers/specs/2026-09-03-run-summary-column-order-design.md`

**目标：** 左列固定渲染标题、运行、Workflow、开始时间、结束时间、耗时；右列固定渲染工作区、状态、当前节点、阶段、运行目录。

- [x] **Step 1: 写失败测试**

在运行详情测试中断言 `data-summary-column="left"` 与 `data-summary-column="right"` 的字段顺序，并断言 CSS 为两列容器、窄屏为单列。

- [x] **Step 2: 运行测试确认红灯**

Run: `npm run build:node && node --test --test-name-pattern "Run overview, artifacts, events and review release" dist-node/tests-node/studio-ui.test.js`

Expected: FAIL，当前没有左右列容器标记。

- [x] **Step 3: 实现最小布局改动**

在 `RunSummaryPanel` 中将 `summaryItems` 拆成 `leftSummaryItems` 与 `rightSummaryItems`，分别渲染带 `data-summary-column` 的容器；保留 `CompactDetailItem` 和所有字段计算逻辑不变。

- [x] **Step 4: 调整响应式样式**

保持 `.run-summary-row` 为两列网格，新增列容器纵向布局；在现有 `@media (max-width: 36em)` 中把 `.run-summary-row` 改为单列，确保 DOM 顺序为完整左列后完整右列。

- [x] **Step 5: 回归验证**

Run: `npm run build:node && node --test dist-node/tests-node/studio-ui.test.js && npm run build:studio-frontend && git diff --check`

Expected: Studio UI 全部通过，前端构建通过，diff 检查通过。

- [x] **Step 6: 本机安装**

运行 `npm run studio-desktop:package:dev`，再用 Tauri 构建 debug `.app`，完成 ad-hoc 签名后替换 `/Applications/AgentMesh.app`，核对版本、签名和进程路径。

审查方式：局部 UI 改动，不改接口和数据，采用自审；审查重点为字段顺序、窄屏顺序、既有字段值和其他详情模块回归。
