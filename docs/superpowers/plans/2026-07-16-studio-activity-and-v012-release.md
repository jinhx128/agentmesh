# Studio 统一活动与 AgentMesh 0.1.12 发布总实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create a second active plan.

**Goal:** 合并并完成 Studio 品牌栏、活动分组、中文展示标题、统一运行/调用导航以及 AgentMesh `0.1.12` 发布和本机升级。

**Architecture:** Runtime 新增纯函数标题解析层，将展示标题持久化到运行状态和调用记录；CLI、SDK、App Server 与 AgentMesh skill 只负责传递或读取该字段。Studio 新建统一 `ActivityNavigator`，在不合并右侧详情状态机的前提下投影、排序和渲染运行/调用；最终从干净 release commit 重建全部签名产物并发布。

**Tech Stack:** TypeScript 5.9、Node.js `node:test`、React 19、Mantine 9、Vite 8、Tauri 2、Rust、npm、GitHub CLI、macOS codesign/updater。

## Global Constraints

- 本文件是当前任务唯一事实源；精简品牌栏、运行分组预览和银灰界面发布计划改为历史记录并指向本文件。
- 一次只执行一个 slice；当前 slice 验证、审查、日志和 commit 完成前不进入下一个 slice。
- 使用 TDD：每个行为先写失败测试并确认正确 RED，再写最小实现并确认 GREEN。
- 保留 `run_id`、调用 ID、目录、URL、关联键、packet schema version `1` 和 call schema version `1`；`title` 是兼容性可选字段，但所有新写入都提供解析后的非空值。
- 用户显式标题优先；主控 Agent 未收到用户标题时生成 4–24 个字符中文摘要并传 `--title`；Runtime 最终缺少标题时生成 `工作区名-摘要` 或 `工作区名-HH:mm:ss`。
- 默认标题只使用 ASCII `-`，两侧无空格；不使用 `·`、`｜`、`—`。
- Runtime 默认标题不调用模型、不翻译、不阻断运行或调用。
- 统一活动列表按时间降序、按日期分组；日期组整体折叠与组内默认 5 条预览是两套独立状态。
- 活动项第一行只显示标题；第二行左侧只显示 `[运行]` / `[调用]` 标签，右侧显示时间。
- 旧记录没有标题时只在读取/显示时回退技术 ID，不回写历史证据。
- 当前 `dist-release/` 的 `0.1.12` 七项资产基于旧提交，必须删除并完整重建，禁止复用。
- 保留历史 `v0.1.11`；不得补发 npm `0.1.11`，不得覆盖 `v0.1.11` tag 或 Release。
- npm 只发布 `@jinhx128/agentmesh@0.1.12`；GitHub 只新建 `v0.1.12`。
- 签名私钥和密码仅从仓库外文件、环境或 Keychain 加载，不打印、不写入计划/changelog/日志。

---

## 1. 已验证基线

- 分支：`codex/desktop-updates`，相对 `origin/codex/desktop-updates` ahead 9；HEAD `bfc5762`。
- 工作区存在多项未提交 UI、spec 与计划状态改动，属于精简品牌栏、运行分组预览和本次计划合并；focused build/test 已 GREEN，但浏览器视觉、日志和提交未完成。
- `0.1.12` 热修、版本同步和三模型审查已提交于 `7afe6a1`；此前完整门禁为 `npm test` 553/553、Desktop package `ok: true`、Cargo check/test 和 audit 0。
- npm `latest` 仍为 `0.1.10`；GitHub `v0.1.11` 已发布七项资产；`v0.1.12` 不存在。
- `dist-release/` 当前有七项 `0.1.12` 文件，但 UI 和标题功能尚未进入 release commit，因此全部视为失效产物。
- 下列旧计划已有对应实现提交，不重新执行：上下文交接 `d5dbbe4`、Copilot 删除 `17cf08c`、CLI 管理 `9fc4abb`、Tauri updater `3db1892`、Converge 图标 `2d10272` / `9ed581d`。

## 2. 文件与模块规划

### 新增

- `packages/runtime/src/display-title.ts`：规范化显式标题、提取默认摘要、生成 workspace/time fallback。
- `tests-node/display-title.test.ts`：标题纯函数、Unicode、Markdown、时间和限长 contract。
- `apps/studio-web/src/features/navigation/ActivityNavigator.tsx`：统一活动投影、排序、搜索、日期分组、预览和活动项渲染。

### 修改

- `packages/core/src/index.ts`：`PacketStatusSchema` 接受可选 `title`。
- `packages/runtime/src/flow/types.ts`、`packages/runtime/src/flow/create.ts`：运行输入传递并持久化标题。
- `packages/runtime/src/calls/history.ts`：调用输入/记录持久化标题，兼容旧记录。
- `packages/cli/src/flags.ts`、`packages/cli/src/cli.ts`、`packages/cli/src/commands/flow.ts`、`packages/cli/src/commands/call.ts`：支持可选 `--title` 并传入 Runtime。
- `packages/sdk/src/index.ts`：`AgentMeshRunSummary.title?` 读取 `status.title`；`AgentMeshCallRecord` 继续透传 `DirectCallRecord.title?`；旧记录允许缺失。
- `packages/skills/agentmesh-skill/SKILL.md`：要求主控 Agent 自动生成中文标题并传 `--title`。
- `apps/studio-web/src/api/runs.ts`、`apps/studio-web/src/api/calls.ts`：前端摘要类型接受标题。
- `apps/studio-web/src/app/App.tsx`：删除顶部数据切换与 `navigatorView`，统一 query/refresh/selection routing。
- `apps/studio-web/src/styles.css`：吸收当前品牌栏和轻量文件树视觉，增加活动类型标签。
- `apps/studio-web/vite.config.ts`：保留当前页面 logo 移除后的 filesystem allow 收敛。
- `tests-node/flow-run.test.ts`、`tests-node/call-history.test.ts`、`tests-node/cli-surface.test.ts`、`tests-node/studio.test.ts`、`tests-node/readiness.test.ts`、`tests-node/studio-ui.test.ts`：端到端 contract。
- `README.md`、`docs/distribution/v0.1.12-release-notes.md`、`changelog/2026-07-16.md`：标题参数、统一活动、发布事实。
- `2026-07-16-studio-compact-brand-header-design.md`、`2026-07-16-studio-run-group-preview-design.md`：保留当前已批准的 `11px` / gap `4` 和 SVG 文件树视觉事实。
- 八份旧计划：标记历史/已合并状态，清除正文内冲突的“唯一事实源”和活跃“当前下一步”，统一指向本计划。

### 删除

- `apps/studio-web/src/app/StudioBrandMark.tsx`：当前精简品牌栏已删除页面 logo。
- `apps/studio-web/src/features/runs/RunNavigator.tsx`：其 dirty 两层展开和视觉 contract 先迁入 `ActivityNavigator`，App 切换完成后删除。
- `apps/studio-web/src/features/calls/CallNavigator.tsx`：App 切换完成后由 `ActivityNavigator` 替代并删除；调用详情保留。

## 3. 完整计划

### P0. 计划与现有 UI 状态合并

- [x] ~~P0 阶段完成门禁（P0.1 和 P0.Z 完成后勾选）~~

- [x] ~~P0.1 将旧计划并入唯一事实源~~
  - Slice：`P0.1`
  - 依赖：本计划设计规格 `bfc5762`。
  - 文件：本计划，以及 `agentmesh-converge-icon`、`context-handoff-hardening`、`desktop-cli-and-copilot-removal`、`tauri-app-updater`、`studio-compact-brand-header`、`studio-converge-brand-mark`、`studio-run-group-preview`、`studio-silver-interface-release` 八份旧计划。
  - 动作：在旧计划顶部写明 `merged/historical` 状态、实现证据和唯一后继计划；未完成的品牌/分组/发布步骤迁移到本计划；上下文计划按 `d5dbbe4` 标为历史已实现，不重跑；替换旧计划正文中冲突的“唯一事实源”和活跃“当前下一步”。
  - 验证：八份旧计划均含状态横幅；除本计划外不再出现 `本文件是当前任务唯一事实源`；旧计划的“当前下一步”明确标为历史/已迁移；`git diff --check` 无输出。
  - 审查方式：自审。依据：仅计划状态治理，不改变代码或发布状态。
  - 提交：`计划：合并 Studio 活动与 0.1.12 发布步骤`。
  - 进度记录：状态 `completed`；完成时间 `2026-07-16 17:47 CST`。八份历史计划均增加状态横幅，旧 silver release plan 的冲突“唯一事实源”和活跃下一步已迁移；允许未暂存 UI WIP 留在工作区，计划提交不混入产品代码。计划外审 run `studio-activity-v012-plan-review-20260716` 为 `decide_completed`，Cursor Composer 2.5、OpenCode GLM 5.2、Claude Opus 4.8 三条 lane 均 exit 0；接受的原子切片、CLI/SDK、状态机和发布保护 finding 已写回本计划，无 needs decision。

- [x] ~~P0.Z 阶段收尾校准~~
  - Slice：`P0.Z`
  - 动作：确认本计划是唯一维护活跃“当前下一步”的计划；旧计划可保留历史 checkbox，但横幅明确其不再代表执行状态。
  - 验证：cached diff 只包含计划文件；允许当前未暂存 UI WIP 继续存在，禁止为满足 P0 门禁而 stash、reset 或混入提交；commit 成功。
  - 当前下一步：更新为 `P1.1 Step 1`。
  - 进度记录：状态 `completed`；完成时间 `2026-07-16 17:47 CST`。placeholder scan、历史状态扫描和 `git diff --check` 通过；三 reviewer finding 已完成事实校准，固定 reviewer 可用性异议以本机 `agents list` 和本轮三 lane 成功证据拒绝；收尾提交见本 slice commit，唯一下一步为 `P1.1 Step 1`。

### P1. 展示标题 Runtime、CLI、SDK 与 Skill

- [x] ~~P1 阶段完成门禁（P1.1、P1.2、P1.Z 完成后勾选）~~
  - 进度记录：状态 `completed`；完成时间 `2026-07-16 19:00 CST`。P1.1 `1061a83` 与 P1.2 `560eeaf` 已进入祖先链；P1.Z 全仓 `npm test` 558/558、audit 0、临时 run/call 技术 ID 与默认标题真值抽查通过。阶段门禁 run `studio-display-title-p1-gate-20260716` 与 Claude retry `studio-display-title-p1-claude-retry-20260716` 均为 `decide_completed`；Cursor、GLM 5.2、Claude 4.8 有效审查均无 Must，Cursor 两个 HTTP legacy Should 已关闭。日志见 `changelog/2026-07-16.md`，唯一下一步为 `P2.1 Step 1`。

- [x] ~~P1.1 建立确定性标题解析并写入新记录~~
  - Slice：`P1.1`
  - 依赖：P0.Z。
  - 文件：新增 `packages/runtime/src/display-title.ts`、`tests-node/display-title.test.ts`；修改 core schema、flow types/create、calls history 及对应测试。
  - Interfaces：
    - `normalizeDisplayTitle(value: string | undefined): string | undefined`
    - `resolveDisplayTitle(input: { title?: string; workspace: string; summaries: Array<string | undefined>; createdAt: Date }): string`
    - `FlowRunInput.title?: string`
    - `CreateCallRecordInput.title?: string`
    - `DirectCallRecord.title?: string`（reader 兼容旧记录，新 writer 始终写入）
  - [x] Step 1：写 RED，断言显式标题 trim/collapse、默认 `agentmesh-优化活动列表`、Markdown 首句清理、无摘要 `agentmesh-17:26:08`、ASCII `-` 和 Unicode 安全限长。workspace 部分固定为 `path.basename(path.resolve(input.workspace))`；时间使用创建主机的本地 `Date#getHours/getMinutes/getSeconds` 一次性烘焙，测试注入固定本地 `Date`。
  - [x] Step 2：运行 `npm run build:node && node --test dist-node/tests-node/display-title.test.js dist-node/tests-node/flow-run.test.js dist-node/tests-node/call-history.test.js`，确认失败来自 helper/字段缺失。
  - [x] Step 3：最小实现纯函数；在 `createFlowRun` 用 `input.task` 和创建时间解析标题写入 `status.title`；在 `createCallRecord` 用原始 `input.purpose`、`promptContent` 和创建时间写入 `record.title`，缺省值 `general` 视为无摘要，不能遮蔽 prompt/time fallback。call 保持 schema version `1`，reader 的 `title` 为 optional。
  - [x] Step 4：增加兼容/往返 contract：旧 packet/call 无标题仍可读；运行发生一次 stage 状态更新并重写 `status.json` 后 `title` 仍保留；App Server runs/calls API 对新记录返回标题。
  - [x] Step 5：重跑 Step 2 与新增兼容测试，预期 0 failed；运行 `git diff --check`。
  - 审查方式：外审。依据：公共 packet/call schema 与所有新写入路径变化。
  - 提交：`功能：为运行与调用持久化展示标题`。
  - 进度记录：状态 `completed`；完成时间 `2026-07-16 18:15 CST`。确定性标题 helper、run/call optional title 持久化、旧记录兼容与状态重写保留 contract 已实现；fresh focused verification 为 55/55、`git diff --check` 通过。外审 run `studio-display-title-runtime-review-20260716` 为 `decide_completed`，三 reviewer 均为 0 Must；接受 `# Request`、组合限长、root/CRLF/general fallback、call completion/adoption 保留标题等 finding，schema v1 升版与字素簇扩展依据兼容策略和既定范围拒绝，无 needs decision。唯一下一步为 `P1.2 Step 1`。

- [x] ~~P1.2 打通 CLI、SDK/API 和 Agent 自动标题规范~~
  - Slice：`P1.2`
  - 依赖：P1.1。
  - 文件：CLI flags/help/flow/call、SDK、前端 API types、canonical AgentMesh skill、README、release notes 和测试。
  - Interfaces：`AgentMeshRunSummary.title?: string`、前端 `StudioRunSummary.title?: string`、`StudioCallSummary.title?: string`；App Server 调用链依靠 call record spread 和 run summary spread 透传，API 级测试负责锁定。
  - [x] Step 1：写 RED：CLI help 包含 `[--title <title>]`；bare preset `run`、workflow `run/flow run`、`call` 三类入口的显式标题进入记录；未传仍创建默认标题；SDK/list APIs 返回标题；skill 明确“用户未给标题时生成 4–24 字中文摘要并传 `--title`”。
  - [x] Step 2：运行 `npm run build:node && node --test dist-node/tests-node/cli-surface.test.js dist-node/tests-node/flow-run.test.js dist-node/tests-node/call-history.test.js dist-node/tests-node/studio.test.js dist-node/tests-node/readiness.test.js`，确认正确 RED。
  - [x] Step 3：把 `--title` 加入 positional option set 和 call、bare run、flow run help/usage；`presetRun` 与 `flowRun` 两个 `createFlowRun` 调用点分别读取并传递 `optionValue(args, "--title")`，call 同样传递；SDK `runSummary()` 枚举读取 `status.title`；文档与 skill 使用相同规则。
  - [x] Step 4：重跑 Step 2，预期 0 failed；`npm run build` 与 `git diff --check` 通过。
  - 审查方式：外审。依据：CLI 公共表面、SDK 和多宿主 skill 同时变化。
  - 提交：`功能：支持 Agent 自动生成中文活动标题`。
  - 进度记录：状态 `completed`；完成时间 `2026-07-16 18:34 CST`。`--title` 已贯通 call、bare preset run、workflow run、SDK/App Server/Studio API types 与 canonical Skill；human `flow status` 同步显示标题，旧 run 无字段不回填。TDD RED 命中缺失 SDK/Studio types、human status 与 workflow README 示例；fresh focused verification 为 197/197，Studio frontend production build 与 `git diff --check` 通过。外审 run `studio-display-title-cli-sdk-review-20260716` 为 `decide_completed`，Cursor Composer 2.5、OpenCode GLM 5.2、Claude Opus 4.8 均 exit 0、0 Must；接受默认 fallback、旧 SDK、help、README 与 human status finding，UI 消费明确迁移到 P2，无 needs decision。唯一下一步为 `P1.Z`。

- [x] ~~P1.Z 标题阶段收尾校准~~
  - Slice：`P1.Z`
  - 验证：`npm test`、`npm audit --json`、`git diff --check`；抽查一个未传标题的临时运行和调用记录，确认技术 ID/目录未改变且标题非空。
  - 审查：通过 AgentMesh 使用 Cursor、Claude 4.8、GLM 5.2 审查 P1 diff；Must/Should 事实核对后修复并重跑对应门禁。
  - 外审失败策略：重试一次或换同类 reviewer；少于两份有效审查或存在未解决 Must/Should 时状态 `needs_decision`，不进入 P2。
  - 日志：按 `my-changelog` 记录标题模型、兼容性和验证。
  - 进度记录：状态 `completed`；完成时间 `2026-07-16 19:00 CST`。`npm test` 558/558、`npm audit --json` 0 vulnerabilities、`git diff --check` 通过；`/tmp` 未传标题 run/call 抽查确认技术 ID/目录不变并生成 `工作区名-摘要`。Cursor 与 GLM 初审有效，Claude 首轮因权限未取得 diff 不计入结论；附加累计 diff 和 verification 后 Claude 4.8 重试为 0 Must / 0 Should。Cursor 提出的旧 run/call HTTP 不回填标题 contract 已补测并以 38/38 focused tests 回归；changelog 已同步。

### P2. 统一活动导航并吸收当前 UI 改动

- [ ] P2 阶段完成门禁（P2.1、P2.2、P2.Z 完成后勾选）

- [ ] P2.1 建立统一活动投影、分组和活动项
  - Slice：`P2.1`
  - 依赖：P1.Z。
  - 文件：新增 `ActivityNavigator.tsx`；修改 API types、CSS、Studio UI test；本 slice 保留两个旧 navigator，保证 App 尚未接线时 build 仍 GREEN。
  - Interfaces：
    - `ActivityNavigatorProps` 同时接收 `runsState`、`callsState`、`selectedKind`、两个 selected key、单一 query/refresh/auto-refresh 和两类 select handlers。
    - `StudioActivityItem` 为 `kind: "run" | "call"` 的 discriminated union。
    - `activityItems(...)` 负责标题 fallback、时间投影和稳定降序；运行三类时间全缺失时排序到有效时间之后并归入现有 `unknown` 日期组。
    - `visibleActivityGroupItems(items, expanded, query)` 实现 5 条预览。
  - [ ] Step 1：写 RED：混合 fixture 按时间排序、缺失运行时间归入 `unknown`、合并日期计数、默认 5 条、搜索显示全部、标题 fallback、第二行只有类型和时间、局部错误保留另一类数据；搜索最小字段集覆盖 title、技术 ID、workspace label/path、workflow/purpose/agent/model/status。
  - [ ] Step 2：运行 focused Studio tests，确认失败来自 `ActivityNavigator` 不存在和旧切换仍渲染。
  - [ ] Step 3：实现统一投影与 DOM；复用当前 dirty `RunNavigator` 的 SVG chevron/calendar、两层状态、纯文本计数、无边框 more row 和柔和选中态，但暂不删除旧组件或修改 App import。
  - [ ] Step 4：`npm run build`；focused Studio tests 0 failed；`git diff --check`。
  - 审查方式：外审。依据：跨运行/调用行为、加载状态和可访问交互。
  - 提交：`功能：建立 Studio 统一活动导航组件`。

- [ ] P2.2 收敛 App 状态、刷新与详情路由
  - Slice：`P2.2`
  - 依赖：P2.1。
  - 文件：`App.tsx`、`styles.css`、`vite.config.ts`、两个旧 navigator、当前品牌/分组 spec/plan、Studio UI test。
  - 状态规则：`workspaceView === "runs"|"calls"` 时对应活动项选中；`settings|definitions` 时活动列表无选中高亮但两个 selected key 原样保留；点击任一活动项立即恢复对应 runs/calls 详情，不新增独立 `lastActivityKind`。
  - [ ] Step 1：写 RED：`navigatorView`、`SegmentedControl` 和双 query 不再出现；统一 refresh 同时调用 runs/calls；刷新后仍存在的 selected key 和 `workspaceView` 不变；settings/manual 覆盖后点击活动恢复正确详情；旧 `title="刷新运行"` contract 改为统一刷新可访问名称；品牌栏仍是纯文字 + 双 ActionIcon。
  - [ ] Step 2：运行 focused tests，确认旧 App 结构导致 RED。
  - [ ] Step 3：删除 `navigatorView`、`runQuery`、`callQuery` 和顶部 toolbar；增加 `activityQuery`；自动/手动刷新同时刷新两类；保留 `WorkspaceView` 的 runs/calls 详情路由与 settings/definitions；App 完成接线后删除两个旧 navigator，确保每个 commit 都可 build。
  - [ ] Step 4：完成 current dirty UI 的品牌栏、subtitle `11px` / gap `4`、SVG 分组视觉和 Vite allow；不恢复页面 logo。
  - [ ] Step 5：`npm run build`、focused Studio tests、`git diff --check` 全部通过。
  - 审查方式：外审。依据：App 状态机和整体导航信息架构变化。
  - 提交：`界面：统一 Studio 活动导航与品牌分组`。

- [ ] P2.Z 浏览器验收与阶段校准
  - Slice：`P2.Z`
  - 手工验证：在 `1280 x 720`、`1024 x 640` 检查品牌栏、统一搜索/刷新、日期折叠、5 条展开/收回、运行/调用混排、类型标签、选中路由、settings/manual；无裁切、横向 overflow 或 console error。
  - 浏览器不可附着策略：保留自动化证据并让用户刷新 `4317` 提供视觉确认；不伪造浏览器证据。
  - 自动化：`npm test`、`npm run studio-desktop:package:dev`、Cargo check/test、`npm audit --json`、`git diff --check`。
  - 审查：AgentMesh Cursor + Claude 4.8 + GLM 5.2 全量 UI/状态 diff；无未解决 Must/Should 才完成。
  - 日志：按 `my-changelog` 聚合精简品牌栏、分组预览和统一活动事实；旧两个 UI 计划标记 merged/completed。

### P3. 总回归、发布门禁与 clean release commit

- [ ] P3 阶段完成门禁（P3.1 和 P3.Z 完成后勾选）

- [ ] P3.1 聚合代码、文档和发布前证据
  - Slice：`P3.1`
  - 动作：检查 README、release notes、Skill、计划、changelog；确认版本源仍全部是 `0.1.12`；搜索 active source 不含 Copilot 产品入口；确认工作区只剩有意 diff。
  - 验证：`npm test`、`npm run studio-desktop:package:dev`、Cargo check/test、audit 0、`git diff --check`。
  - 审查：三 reviewer 发布前全量审查；release verdict 必须 `ready`，无 needs decision。
  - 提交：按逻辑边界提交剩余文档/审查证据，中文 commit message。

- [ ] P3.Z clean commit 校准
  - Slice：`P3.Z`
  - 验证：`git status --short` 为空；记录 release commit SHA；`git log` 中标题和 UI 提交均在该 SHA 祖先链；当前下一步为 `P4.1`。此时 `dist-release/` 仍全部视为失效，直至 P4.1 删除重建。
  - 发布门禁：此时只给 `code_ready`，未生成新资产前不得宣称 release ready。

### P4. 重建与验证 0.1.12 签名产物

- [ ] P4 阶段完成门禁（P4.1、P4.2、P4.Z 完成后勾选）

- [ ] P4.1 删除失效资产并完整重建
  - Slice：`P4.1`
  - 动作：`rm -rf dist-release` 后从仓库外 updater key 和 Keychain 安全注入密码，执行 `npm run release:assets`；不得输出 secret。
  - 验证：命令 exit 0；生成 npm tgz、DMG、updater archive、signature、`latest.json`、Skill markdown、`SHA256SUMS` 恰好七项。
  - 审查方式：自审 + 确定性脚本；签名失败不得降级为无签名发布。

- [ ] P4.2 验证资产与 release metadata
  - Slice：`P4.2`
  - 验证：`hdiutil verify` DMG；`shasum -a 256 -c SHA256SUMS`；Tauri archive 公钥验签；`latest.json` version=`0.1.12`、signature 一致、URL 指向不可变 `v0.1.12`；npm tgz package version=`0.1.12`；Skill metadata=`0.1.12`。
  - 证据：记录七项名称、字节数、SHA256 和验证结论，不记录 secret。

- [ ] P4.Z 资产发布门禁
  - Slice：`P4.Z`
  - 审查：Release Check 聚合 final diff、测试、review、签名和资产证据；结论必须 `ready`。
  - 失败策略：任何 checksum/signature/version/URL 不一致都删除全部 `dist-release` 并从 P4.1 重建，不局部替换。

### P5. 推送、发布与本机升级

- [ ] P5 阶段完成门禁（P5.1、P5.2、P5.Z 完成后勾选）

- [ ] P5.1 推送 release commit 并发布 npm/GitHub
  - Slice：`P5.1`
  - 前置核对：`npm view` latest 仍低于 `0.1.12`；`gh release view v0.1.12` 不存在；root worktree main 无用户未提交变更；fetch 后 `main` 必须是 feature release commit 的祖先且可 fast-forward。main 超前、分叉、受保护或需要非 fast-forward 时状态 `needs_decision`，不得先推 tag/发布任一渠道。
  - 动作：推送 `codex/desktop-updates`；fast-forward main；在唯一 release commit 创建 annotated `v0.1.12` 并推送；发布 npm tgz；创建 GitHub non-draft/non-prerelease Release 并上传七项资产。
  - 远端验证：npm version/dist-tag=`0.1.12`；GitHub tag/Release/assets 数量与 digest 正确；远端 `latest.json` 内容正确。
  - 失败策略：npm/GitHub 半发布时保留相同 release commit/tag，只补齐失败渠道；不得重写 tag 或重新发布同版本 npm。

- [ ] P5.2 更新本机 CLI 与 Desktop
  - Slice：`P5.2`
  - CLI：安装前记录当前 `command -v agentmesh`、CLI 版本和全局 npm prefix；从公共 npm 安装 `@jinhx128/agentmesh@0.1.12`；验证 PATH、`agentmesh --version`、`agentmesh update --json` current。
  - Desktop：退出 AgentMesh；挂载已验证 DMG；替换 `/Applications/AgentMesh.app`；无参数启动。
  - 真机验证：App/sidecar version `0.1.12`；最近 registry 工作区加载；统一活动 UI 可见；Settings/About updater current；退出后进程和挂载清理。
  - 回滚：Desktop 启动失败时恢复 `/Applications/AgentMesh.app` 备份；CLI 失败时保留已发布 npm 并诊断 PATH，不撤销远端版本。

- [ ] P5.Z 最终证据与项目收尾
  - Slice：`P5.Z`
  - 日志：按 `my-changelog` 写 npm、GitHub、七项资产、真机 CLI/Desktop、updater current 和残余风险。
  - 计划：所有 P 阶段门禁标为 `[x]` 并加删除线，写完成时间、验证、审查、commit/tag/release 证据；当前下一步改为“无，任务完成”。
  - 提交/推送：提交发布后证据并推送 feature/main。
  - 最终结论：仅在 npm、GitHub、CLI、Desktop 和发布后证据都完成时给 `ready`。

## 4. 整体验证矩阵

- 标题：纯函数、Runtime writer、CLI、SDK、App Server、Skill、旧记录兼容。
- Studio：build、SSR contract、混排/搜索/分组/预览/partial error、详情路由、品牌栏。
- 全仓：`npm test`、audit、boundary/package checks。
- Desktop：dev package、Cargo check/test、sidecar、无参数启动。
- 视觉：两个 viewport、无 overflow/cutoff/console error、运行/调用选择与类型标签。
- 发布：七项资产、DMG、checksum、signature、metadata、npm/GitHub 远端状态。
- 真机：全局 CLI、App bundle/sidecar、registry workspace、updater current、进程清理。

## 5. 风险与回滚

- Schema 兼容：新字段只能 optional/passthrough；旧记录 fixtures 必须继续通过。回滚为 revert P1 commits，不迁移数据。
- 标题质量：Agent 负责中文智能摘要，Runtime 只做可解释 fallback。回滚为 UI 显示技术 ID，技术主键不受影响。
- 活动混排：运行更新时间可能晚于创建时间；设计明确使用最新活动时间，调用使用创建时间。回滚为恢复两个 navigator，不改后端数据。
- 当前 dirty UI：先保留用户已批准改动，再由统一 navigator 吸收；禁止 checkout/reset。回滚按独立 UI commit revert。
- 发布资产陈旧：强制删除重建并校验 release commit。失败不发布。
- npm/GitHub 半发布：不覆盖不可变版本；只补齐失败渠道或在代码发生变化时发布新 patch。
- 本机 Desktop 替换：安装前保留 App 备份，验证失败恢复；不删除用户 workspace/registry。

## 6. 计划维护与当前下一步

- 完成 slice 后使用 `- [x] ~~P<n>.<m> ...~~`，下一行写状态、时间、命令结果、审查 finding 处理、changelog、commit 和唯一下一步。
- 外审发现先事实核对；接受项修复并回归，拒绝项记录依据，未解决 Must/Should 阻断阶段门禁。
- 旧计划只作为历史上下文，不再维护第二个“当前下一步”。
- 当前下一步：`P2.1 Step 1`，为统一活动投影、混排、日期分组、5 条预览与局部错误写失败测试。
