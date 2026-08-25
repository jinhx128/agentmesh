# Studio 写操作统一 Toast 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Studio 全部普通写操作提供统一成功/失败 toast，并保证失败时不关闭弹窗或丢失表单状态。

**Architecture:** 使用 `@mantine/notifications` 作为全局通知层，在独立的 `mutation-feedback.ts` 中统一判定 HTTP/业务/退出码结果并提取错误。业务组件继续持有弹窗和表单状态，只在判定成功后关闭；需要长期可见的诊断与进度仍留在原页面。

**Tech Stack:** React 19、TypeScript 5.9、Mantine 9.2、`@mantine/notifications`、Node test runner、Vite 8。

## Global Constraints

- 成功 toast 自动关闭时间为 3000ms，失败 toast 自动关闭时间为 6000ms。
- `failed`、`conflict` 或非零 `exit_code` 都必须视为失败。
- 失败时保留弹窗、表单值和可重试上下文；成功后才能关闭或重置。
- 加载错误、应用更新下载进度和 Run 安全动作证据继续使用持久页面内容。
- 不改变后端 API、CLI 命令或持久化格式。
- 本计划是当前任务的唯一实施事实源；一次只推进一个 slice，并在完成后记录验证证据。

---

## 1. 边界与文件规划

- 新增 `apps/studio-web/src/app/mutation-feedback.ts`：纯结果判定、错误提取及 toast 封装。
- 修改 `apps/studio-web/src/main.tsx`、`apps/studio-web/package.json`、`package-lock.json`：注册 Mantine Notifications。
- 修改 `apps/studio-web/src/app/App.tsx`：API 操作失败时抛出可读错误，自动更新开关反馈。
- 修改 `apps/studio-web/src/features/agents/AgentLifecyclePanel.tsx`：Agent 操作 toast、失败保留弹窗、移除命令回显。
- 修改 `apps/studio-web/src/features/catalog/CatalogView.tsx`：Workflow/Preset/资源删除 toast 与弹窗状态。
- 修改设置、活动、Call、Run 相关组件：统一普通写操作反馈；保留诊断型输出。
- 修改 `tests-node/studio-ui.test.ts` 并新增 `tests-node/studio-mutation-feedback.test.ts`：结果判定和 UI 契约回归。

## 2. 完整计划

### P1. 通知基础设施与结果判定

- [x] ~~P1 阶段完成门禁~~
- 阶段目标：应用具备全局通知容器和可复用、可测试的写操作结果判定。

- [x] ~~P1.1 通知基础设施与纯函数~~
  - Slice：`P1.1`
  - 依赖：无
  - 文件：新增 `apps/studio-web/src/app/mutation-feedback.ts`、`tests-node/studio-mutation-feedback.test.ts`；修改 `apps/studio-web/src/main.tsx`、`apps/studio-web/package.json`、`package-lock.json`
  - 接口：产出 `studioMutationSucceeded(response): boolean`、`studioMutationError(response, fallback): string`、`requireStudioMutationSuccess(response, fallback): void`、`showStudioSuccess(title, message?)`、`showStudioError(title, message)`。
  - 动作：
    1. 先写测试，断言 `succeeded + exit_code=0` 成功，`failed`、`conflict`、非零退出码和 `ok=false` 失败，并验证错误优先级为 `error -> stderr -> stdout -> fallback`。
    2. 运行 `npm run build:node && node --test dist-node/tests-node/studio-mutation-feedback.test.js`，确认因实现缺失失败。
    3. 安装 `@mantine/notifications@9.2.1`，添加通知样式和 `<Notifications position="top-right" />`。
    4. 实现最小纯函数与 toast 封装：
       ```ts
       export function requireStudioMutationSuccess(response: StudioMutationResponseLike, fallback: string): void {
         if (!studioMutationSucceeded(response)) throw new Error(studioMutationError(response, fallback));
       }
       ```
    5. 重跑目标测试和 `npm run build --workspace @agentmesh/studio-web`。
  - 验证：目标测试通过；前端类型检查和 Vite 构建通过。
  - 审查方式：自审。基础设施虽新增依赖，但接口很小，纯函数有确定性测试，回滚只需移除 provider/helper/dependency。
  - 审查：核对 Mantine 版本一致、结果判定不误伤无 `status` 的成功响应、toast 不保存业务状态。
  - 外审执行：不适用；用户已要求减少频繁 review，本 slice 以确定性测试和依赖版本锁定覆盖风险。
  - 外审失败策略：不适用。
  - 证据：目标测试、前端构建、`git diff --check`。
  - 提交：`界面：增加统一操作提示基础设施`
  - 进度记录：2026-08-05 完成；红灯测试先因 helper 缺失失败，随后结果判定测试通过；根级 NodeNext 与 Studio 前端构建通过；因当前环境禁止写入 `.git`，未单独提交代码。

- [x] ~~P1.Z 阶段收尾校准~~
  - Slice：`P1.Z`
  - 目标：确认通知层和纯函数可供后续组件复用。
  - 验证：`npm run build --workspace @agentmesh/studio-web`、`git diff --check`。
  - 审查方式：自审；范围局部且有纯函数测试。
  - 证据：构建和 diff 检查结果。
  - 进度记录：2026-08-05 完成；`git diff --check` 通过，通知层依赖与类型映射边界已确认。

### P2. Agent、Workflow、Preset 生命周期

- [x] ~~P2 阶段完成门禁~~
- 阶段目标：资源写操作使用统一 toast，失败时保留弹窗，原始 lifecycle 命令块消失。

- [x] ~~P2.1 Agent 生命周期~~
  - Slice：`P2.1`
  - 依赖：P1.1
  - 文件：修改 `apps/studio-web/src/app/App.tsx`、`apps/studio-web/src/features/agents/AgentLifecyclePanel.tsx`、`tests-node/studio-ui.test.ts`
  - 动作：
    1. 先加入源码和渲染断言：Agent 操作调用 toast、存在错误状态、命令块不再渲染；运行目标测试确认失败。
    2. App 层对 create/update/delete/enable/disable 响应调用 `requireStudioMutationSuccess`。
    3. Agent 组件在成功分支显示 toast 后关闭；catch 分支写入弹窗错误并显示失败 toast，不修改弹窗打开状态。
    4. 删除 Agent lifecycle `<Code>` 回显与无用 formatter。
  - 验证：`npm run build && node --test --test-name-pattern "Studio resource management" dist-node/tests-node/studio-ui.test.js`。
  - 审查方式：自审；同一状态机集中修改，目标测试覆盖关闭条件和 UI 契约。
  - 审查：重点核对 catalog 内嵌 Agent 与独立 Agent 面板行为一致。
  - 外审执行：不适用。
  - 外审失败策略：若行为测试无法覆盖事件交互，则增加纯状态 helper 测试，不以手工判断替代。
  - 证据：目标测试和前端构建。
  - 提交：`界面：统一 Agent 操作结果提示`
  - 进度记录：2026-08-05 完成；Agent 资源契约测试、Node 构建和前端构建通过；失败路径保留创建/编辑/删除弹窗。

- [x] ~~P2.2 Workflow、Preset 与资源删除~~
  - Slice：`P2.2`
  - 依赖：P2.1
  - 文件：修改 `apps/studio-web/src/features/catalog/CatalogView.tsx`、`tests-node/studio-ui.test.ts`
  - 动作：
    1. 先断言 Workflow/Preset lifecycle 命令块移除、失败判定和 toast 调用存在，运行测试确认失败。
    2. create/update 使用 `studioMutationSucceeded` 决定关闭，用 `studioMutationError` 填充持久错误。
    3. 删除确认仅在成功响应后清空目标；失败保留确认弹窗并提示。
    4. 移除 Workflow/Preset 的 `lastOperation` 与 formatter，仅保留表单校验和文件读取 Alert。
  - 验证：前端构建和 Studio 资源管理目标测试通过。
  - 审查方式：自审；沿用 P2.1 的已验证模式。
  - 审查：核对创建、编辑、删除三种关闭条件，以及手动字段和 TOML 文件两种输入模式。
  - 外审执行：不适用。
  - 外审失败策略：目标测试失败则保持 slice 未完成并修正状态逻辑。
  - 证据：目标测试、构建、关键 diff。
  - 提交：`界面：统一资源生命周期提示`
  - 进度记录：2026-08-05 完成；资源契约测试通过；Workflow/Preset 创建失败错误已放回弹窗内部，原始 lifecycle 回显已移除。

- [x] ~~P2.Z 阶段收尾校准~~
  - Slice：`P2.Z`
  - 目标：确认三类资源交互一致且没有遗留原始回显。
  - 验证：`rg "format(Agent|Workflow|Preset)LifecycleOperation|lastOperation" apps/studio-web/src/features`、前端构建、相关测试。
  - 审查方式：自审；统一模式且有源码/渲染契约。
  - 证据：搜索结果、测试结果、diff 检查。
  - 进度记录：2026-08-05 完成；源码搜索未发现 lifecycle formatter 或 lastOperation UI 回显。

### P3. 设置、环境、运行与活动

- [x] ~~P3 阶段完成门禁~~
- 阶段目标：其余普通写操作使用统一 toast，诊断型内容继续可见。

- [x] ~~P3.1 设置与环境写操作~~
  - Slice：`P3.1`
  - 依赖：P1.1
  - 文件：修改 `apps/studio-web/src/app/App.tsx`、`apps/studio-web/src/features/settings/AdvancedSettingsPanel.tsx`、`apps/studio-web/src/features/settings/AgentIntegrationsPanel.tsx`、`apps/studio-web/src/features/settings/SettingsAboutPanel.tsx`、`tests-node/studio-ui.test.ts`
  - 动作：先写失败契约；高级设置成功 toast 替代绿色 Alert、失败保留红色 Alert；自动更新开关成功/失败 toast 且失败回滚；CLI/Skill 安装回调对业务失败抛错，组件捕获并 toast，状态/版本/诊断继续显示。
  - 验证：前端构建与设置相关目标测试通过。
  - 审查方式：自审；不改变配置数据模型，回滚路径明确。
  - 审查：核对失败不会造成未处理 Promise rejection，开关回滚值来自最后确认状态。
  - 外审执行：不适用。
  - 外审失败策略：若无法稳定断言 toast，至少用纯结果 helper 和源码契约覆盖，手工浏览器验证交互。
  - 证据：目标测试、构建、浏览器手工步骤记录。
  - 提交：`界面：统一设置与安装结果提示`
  - 进度记录：2026-08-05 完成；设置/环境契约测试和构建通过；自动更新保存失败恢复旧值，CLI/Skill 失败不产生未处理 Promise rejection。

- [x] ~~P3.2 活动、Call、reviewer session 与 Run 安全动作~~
  - Slice：`P3.2`
  - 依赖：P1.1
  - 文件：修改 `apps/studio-web/src/features/navigation/ActivityNavigator.tsx`、`apps/studio-web/src/features/calls/CallDetailView.tsx`、`apps/studio-web/src/features/runs/RunOverview.tsx`、`apps/studio-web/src/features/actions/SafeActionsPanel.tsx`、`tests-node/studio-ui.test.ts`
  - 动作：先写失败契约；为成功/失败增加 toast；活动删除失败继续保留确认弹窗；Call 失败保留输入；reviewer session 保留持久错误；SafeActions 保留 `mutation-output` 并增加快速反馈。
  - 验证：前端构建和活动/调用/运行目标测试通过。
  - 审查方式：自审；不改变运行操作协议，只增加反馈。
  - 审查：确认 `mutation-output`、应用更新进度和长期加载错误未被移除。
  - 外审执行：不适用。
  - 外审失败策略：行为不确定时保持原持久反馈并只增加 toast，避免信息丢失。
  - 证据：目标测试、构建、保留内容的源码断言。
  - 提交：`界面：统一运行与活动操作提示`
  - 进度记录：2026-08-05 完成；相关 UI 契约测试通过；活动删除错误、Call 采纳错误和 reviewer 错误仍持久显示，Run mutation-output 保留。

- [x] ~~P3.Z 阶段收尾校准~~
  - Slice：`P3.Z`
  - 目标：完成跨页面一致性和信息保留检查。
  - 验证：相关目标测试、前端构建、`git diff --check`。
  - 审查方式：自审；用户明确要求减少频繁 review，最终以全量测试和手工交互检查作为门禁。
  - 证据：验证命令结果和剩余风险记录。
  - 进度记录：2026-08-05 完成；相关构建和契约测试通过，未改变应用更新进度展示。

### P4. 整体验证与收尾

- [x] ~~P4 阶段完成门禁~~

- [x] ~~P4.1 全量验证~~
  - Slice：`P4.1`
  - 依赖：P2.Z、P3.Z
  - 文件：计划进度记录；如发现缺陷则修改对应责任文件和测试。
  - 动作：执行 `npm test`、`git diff --check`；在本地 Studio 验证一次成功保存和一次可控失败，确认 toast、关闭条件和内容保留。
  - 验证：全量 Node 测试零失败；前端构建通过；手工验收通过。
  - 审查方式：自审；不额外发起多模型 review，符合用户“不要频繁 review”的要求。
  - 审查：核对设计文档每条覆盖范围，记录任何跳过项。
  - 外审执行：不适用。
  - 外审失败策略：任一关键验证失败则发布门禁为 `not_ready`，修复后重跑。
  - 证据：完整测试摘要、手工验证结果、`git status`。
  - 提交：`界面：完成写操作反馈统一`
  - 进度记录：2026-08-25 完成；在允许本机监听的发布环境重跑 `npm test`，703/703 通过，覆盖通知结果判定、资源/设置/活动 UI 契约与 Studio Server；`npm run studio-desktop:package:dev` 为 `ok=true`、`issues=[]`，CLI 安装 smoke 1/1，Cargo、边界检查、npm audit 与 diff check 均通过。此前 8 月 5 日的 `listen EPERM` 和旧 reviewer 断言未在本轮复现。

- [x] ~~P4.Z 阶段收尾校准~~
  - Slice：`P4.Z`
  - 目标：确认计划、设计、代码和测试一致。
  - 验证：全量测试、diff、提交边界和工作区状态。
  - 审查方式：自审；最终发布门禁依据确定性验证。
  - 证据：发布门禁结论与残余风险。
  - 进度记录：2026-08-25 完成；计划、代码、测试、`0.1.15` 版本元数据、发布说明与当日 changelog 已同步；按用户要求未发起额外多模型 review。

## 3. 风险与回滚

- 风险：业务失败仍被误判为成功；规避：统一纯函数覆盖 HTTP、status 和 exit code；回滚：恢复各组件原条件判断。
- 风险：引入通知依赖造成样式或打包问题；规避：锁定与 `@mantine/core` 相同版本并运行 Vite 构建；回滚：移除 provider 和依赖。
- 风险：toast 替换持久信息后错误不可追踪；规避：表单错误、诊断信息和技术证据继续保留。
- 风险：重复 toast；规避：每个写操作只在最接近用户交互的组件触发一次，API 层不显示通知。

## 4. 当前下一步

- 当前下一步：提交 `0.1.15` release commit，生成并发布 npm/GitHub 资产，随后同步本机 CLI、Skill 与 Desktop。
