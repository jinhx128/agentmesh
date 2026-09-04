# Call Record v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将直接调用记录升级为与 Run 一致的 v3 生命周期模型，并补齐健康度、严格校验和结果处置约束。

**Architecture:** Runtime 是 Call Record 的唯一写入与核心校验边界；CLI 调用 Runtime 写入并输出稳定 JSON；SDK/App Server/Studio 只消费 Runtime 契约。健康度只在读取投影中计算，旧记录由 Studio 列表层隔离诊断。

**Tech Stack:** TypeScript、Node.js、Zod/现有 JSON 文件存储、Node test、Vite/React Studio。

## Global Constraints

- 直接破坏性升级 `CALL_RECORD_SCHEMA_VERSION` 到 `3`，不迁移、不兼容旧 v2 业务读取。
- 不新增 Call 阶段模型；`result_status` 与生命周期独立。
- 保留工作区已有未提交改动，不使用 destructive git 命令。
- 结果处置由 CLI/消费方负责，Studio 只读。

### Task 1: Runtime Call v3 核心

**Files:** `packages/runtime/src/calls/history.ts`, `tests-node/call-history.test.ts`

- [ ] 先新增失败测试：断言 v3 字段、状态转换、`health_status` 推导、严格不变量、v2 拒绝、终态结果处置门禁。
- [ ] 将 `status` 改为 `call_status`，状态改为 `running/completed/failed/timed_out/aborted`，schema 改为 3。
- [ ] 增加 `CallHealthStatus`、`deriveCallHealthStatus`、60 秒心跳常量和 5 分钟失联阈值。
- [ ] 实现 `validateCallRecordInvariants`；覆盖启动失败、非零退出码、超时退出码和输出落盘失败。
- [ ] 让创建、完成和结果事件只写 v3；运行期间提供 heartbeat 更新函数，并在结果处置前校验终态和产物。
- [ ] 运行 `npm run build:node && node --test dist-node/tests-node/call-history.test.js`，修复至通过。

### Task 2: CLI 和 SDK 契约同步

**Files:** `packages/cli/src/commands/call.ts`, `packages/cli/src/commands/calls.ts`, `packages/cli/src/cli.ts`, `packages/sdk/src/index.ts`, `tests-node/cli-surface.test.ts`, `tests-node/sdk-read.test.ts`

- [ ] 更新 CLI 映射、JSON 输出和帮助文本为 `call_status` / v3 枚举。
- [ ] 将成功退出映射为 `completed`，非零退出映射为 `failed`，超时映射为 `timed_out`。
- [ ] 让 `calls mark/select` 使用 Runtime 的终态与产物门禁，并保留 `result_status` 输出。
- [ ] 同步 SDK 类型、读取投影和 schema 错误处理。
- [ ] 运行 CLI/SDK 定向测试和 TypeScript 构建。

### Task 3: App Server 与 Studio 展示

**Files:** `packages/app-server/src/calls-browser.ts`, `apps/studio-web/src/api/calls.ts`, `apps/studio-web/src/app/status-labels.ts`, `apps/studio-web/src/features/calls/CallDetailView.tsx`, 相关 Studio 测试

- [ ] 同步 Server/API 类型和字段名，传递 `health_status` 与 schema 诊断。
- [ ] 更新中文状态映射：`completed=已完成`、`timed_out=已超时`，健康度单独显示 `已失联`。
- [ ] 列表逐条隔离旧/坏 Call Record，保留其他记录和诊断。
- [ ] 详情页区分生命周期、健康度和结果处置，不提供 Studio 修改入口。
- [ ] 运行 Studio/API 定向测试和前端构建。

### Task 4: 文档、skill 与本地清理

**Files:** `packages/skills/agentmesh-skill/SKILL.md`, Call/CLI/API 文档、测试夹具和必要 README

- [ ] 更新 skill 中 Call 状态、JSON 字段和结果处置说明。
- [ ] 删除旧状态和旧字段示例，补充 v3 不变量与旧记录诊断行为。
- [ ] 清理本机旧 `.agentmesh/calls` 数据，不编写迁移器。
- [ ] 运行 `git diff --check` 和文档/边界检查。

### Task 5: 最终验证与收尾

- [ ] 运行 `npm test`、`npm run check:boundaries`、`git diff --check`。
- [ ] 手工验证成功、失败、超时、启动失败、运行中 stale、部分输出采纳和旧 schema 隔离。
- [ ] 做一次最终 review，处理 Must/Should Fix。
- [ ] 同步 changelog，提交中文 commit；发布和本机安装另行执行。

## 当前下一步

先执行 Task 1 的失败测试和 Runtime v3 实现。
