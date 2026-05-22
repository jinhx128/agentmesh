# AgentMesh 计划

## 怎么使用这份计划

- 这份文件是 AgentMesh 短期计划和长期计划的唯一事实源。
- 某个事项完成后，把它标成 `[x]`，并把任务文本加删除线。
- 每个已完成事项都要保留简短证据：命令、review 输出、changelog 条目，或已实现文件路径。
- 每个小任务默认指一个 `P<n>.<m>` slice；如果 slice 过大，先拆成更小的 slice 再执行。
- 每个小任务都必须完整走 checkpoint：明确范围 -> 实现 -> 验证 -> review -> 处理 accepted findings -> 同步 `changelog/` -> commit。commit 完成前不能开始下一个小任务。
- 每个大任务默认指一个 `P<n>` 阶段；大任务收尾时必须重新校准 `README.md` 和根目录 `index.html`，让产品说明、安装入口、使用方式和当前事实一致。
- 当一个 `P<n>` 下所有 `P<n>.<m>` 小任务完成后，必须执行该大任务的收尾校准 slice，完成后才能把 `P<n>` 标为完成。
- 不保留第二份计划文件。大的草稿必须合并回这里，或删除。
- reviewer 可以挑战这份计划，但主控必须先核对事实，再决定是否改变方向。

## 定位

AgentMesh 是 AI coding team 的协议层。

它不替代 Codex、Claude Code、Gemini CLI、Cursor、OpenCode、Copilot、IDE 或聊天产品。它的职责是把一次 AI coding 会话变成受治理、可检查、可恢复的工程工作。

核心表达：

> AgentMesh turns AI coding sessions into structured handoff packets, governed
> by workflows, grounded in project context.

中文表达：

> AgentMesh 把 AI coding 过程沉淀成可交接 packet，用 workflow 管住协作流程，
> 用 context 提供事实记忆。

## 核心原语

- **Packet**：持久化的交接对象。
- **Workflow**：团队协作协议。
- **Context**：事实记忆层。
- **Agent**：可替换的执行者或 reviewer。
- **Decision**：工程质量门。

AgentMesh 不应该被描述成 “documents as apps”。更准确的模型是：

- Packet = 交接对象。
- Workflow = 团队协议。
- Context = 事实记忆层。

## 架构分层

### AgentMesh Skill

- 面向 Codex、Claude Code、Gemini CLI、Cursor、OpenCode、Copilot 以及未来 host agent 的自然语言入口协议。
- 判断入口 agent 什么时候应该执行 `run`、`prompt`、`attach`、`dispatch`、`retry`、`resume`、`handoff` 或 `release-check`。
- 不拥有状态。它只把人的意图翻译成 AgentMesh CLI 操作。
- 必须和它期望的 workflow 版本、packet schema 版本一起版本化。

### AgentMesh CLI

- local-first 的核心运行时和自动化入口。
- 负责 layered config、registry、workflow TOML、packet IO、状态机、stage dispatch、handoff、review aggregation、doctor、skill verification、release gate 和 packet validation。
- 目标实现栈是 TypeScript on Node。
- Python 实现已经从目标树中移除；它不是长期 runtime、兼容层，也不是并行产品入口。

### Context / Extension 层

- MCP client、context provenance、project facts、corrections 和 Studio 已进入本地协议层；后续扩展继续以 packet/event/status/workflow schema 稳定为前提。
- MCP resources 是 context sources，不是 model adapters。
- Public write SDK、MCP server、remote registry 和 cloud 都是后续扩展，不是本地协议的前置条件。

## 目标仓库形态

干净的目标形态：

```text
packages/
  core/        # 纯协议：schemas、types、state、adapter invocation shape
  runtime/     # packet IO、state machine、events、release gate、doctor、adapters
  sdk/         # 稳定只读 read surface；复用 runtime 解析，不暴露 packet 布局
  cli/         # 命令入口；进程内 import runtime

docs/
  contracts/   # versioned packet/events/status/workflow/artifact contracts
  python-decommission.md

apps/
  studio/      # 本地 UI；通过 Studio server 读 packet，并通过 CLI subprocess mutation
```

早期目标中明确不包含：

```text
apps/web
apps/api
packages/adapters
packages/ui
crates/shell
daemon
remote HTTP/RPC
SQLite index
```

### Package 规则

- `packages/core` 必须保持 runtime-free：
  - 不使用 `fs`
  - 不使用 `child_process`
  - 不执行进程
  - 不做本地文件监听
  - 不引入 Node-only 行为，除非只是 type-only 且可移植
- `packages/core` 负责：
  - Zod schema 的事实源
  - packet layout model
  - event model
  - status 和 stage state types
  - workflow model
  - artifact manifest model
  - release verdict model
  - context provenance model
  - adapter invocation interface
- `packages/runtime` 负责：
  - file IO
  - atomic writes
  - state transitions
  - stage dispatch
  - retry/resume/handoff 机制
  - event append 和 replay
  - release evidence aggregation
  - doctor probes
  - 内置 adapters，放在 `packages/runtime/src/adapters/`
- `packages/cli` 负责：
  - command parsing
  - terminal UX
  - exit codes
  - JSON output mode
  - shell automation compatibility
- 内置 adapters 先放在 runtime 里。只有当第三方 adapter contract 真实存在并稳定后，才提升为 `packages/adapters`。
- Studio 初期不能直接 import runtime。它应该把 CLI 作为 subprocess 启动，并观察 packet 文件、`events.jsonl` 和 `status.json`。

## 格式与协议决策

现在锁定：

- TypeScript 是主要实现语言。
- 协议包必须启用 TypeScript strict mode，尤其是 `packages/core`。
- Node.js 22+ 是 package architecture 的目标 runtime。
- Zod 是 schema 的事实源。
- 可以从 Zod 生成 JSON Schema，供外部消费者使用。
- TOML 用于 workflow、assignment、registry 和 configuration 文件。
- JSON 用于 machine-readable state。
- JSONL 用于 append-only event streams。
- Markdown 用于 human-readable artifacts。
- Packet files 是持久化事实源。
- Rust 如果以后引入，只能作为 system boundary，不能拥有 packet、workflow、event、adapter 或 release gate 的业务逻辑。
- AgentMesh workflow/config 不引入 YAML。
- packet artifact rendering 不使用 MDX。
- S3 package split 先使用 npm workspaces。只有 npm workspaces 变成真实阻力时，再切到 pnpm。

延后到确实需要时再决定：

- pnpm workspace：可选替代 npm workspaces，不是协议决策。
- Turborepo：等 workspace task orchestration 真正痛了再考虑。
- Biome：TS package split 后很可能成为 lint/format 目标，但不是协议决策。
- Vitest：可选 package test runner；测试规模小时 `node:test` 足够。
- React、Tauri、Tailwind、Radix、shadcn/ui、React Flow、Monaco、xterm.js、TanStack Query 和 TanStack Router：Studio 候选技术，P4 再决定。
- SQLite：只有当 file-based listing 和 event replay 太慢时，才作为未来 index/cache。它永远不能替代 packet files 作为事实源。
- Hono、PostgreSQL、S3/R2/MinIO、Temporal 和 OpenTelemetry：在本地 packet/workflow/release/context contracts 稳定，并出现真实团队或多机器痛点前，都不进入范围。

## 配置与 Workflow Registry 分层原则

AgentMesh 的 agent registry 默认是用户/电脑维度，不是项目维度。同一台机器上的
Codex planner、Claude executor、Gemini reviewer、OpenCode researcher
这类本机 agent，不应该在每个项目里重复注册。

Workflow registry 是独立的分层文件仓库，和 config TOML 使用同一套 source-layer
模型，但不是 `config.toml` 里的子表。

目标配置分层：

- 用户级配置：`~/.config/agentmesh/config.toml`
  - 本机 agents
  - adapter command/path/default args
  - aliases
  - capabilities
  - 默认 model / reasoning effort
  - host install preferences
- 用户级 workflow registry：`~/.config/agentmesh/workflows/*.toml`
  - 个人跨项目复用 workflow
  - 例如个人 review flow、release gate flow、handoff flow
  - 不保存项目事实或项目路径
- 项目级配置：`./.agentmesh/config.toml`
  - 项目 workflow defaults
  - MCP servers
  - context policy
  - project spec/corrections
  - local workflow registry settings
- 项目级 workflow registry：`./.agentmesh/workflows/*.toml`
  - 只属于当前项目或团队的 workflow
  - 例如 DB migration flow、安全审批 flow、发布检查 flow
- 显式配置：`--config <path>` 或 `$AGENTMESH_CONFIG`
  - 用于 CI、实验或临时覆盖
  - 作为最高优先级 overlay，而不是让项目配置遮住用户 agents
- 显式 workflow：`--workflow-file <path>`
  - 用于临时或实验流程
  - 只影响本次 run，不写入任何 registry
  - 不是 registry layer，而是和 `--workflow <id>` 互斥的一次性 selector
  - run packet 记录 normalized path、hash 和 schema version
  - workflow file 必须在 packet 创建前通过 schema 校验

这是最终目标分层，不代表 L2 一次交付所有字段。L2 只先完成 agents、
workflow registry layering、workflow defaults、MCP server config、基础 context
policy 配置位置和 source reporting；context policy 的执行规则以及 project
spec/corrections 的具体文件与校验规则，由 L6/L7 落地时确认。

目标语义：

- `agentmesh agents add` 默认写入用户级配置。
- 项目级配置默认引用用户级 agent id，而不是复制 agent 定义。
- workflow registry 搜索顺序为 built-in -> user global -> project；同名 workflow
  冲突必须 fail fast，不能静默覆盖。
- user global workflows 适合个人跨项目复用；project workflows 只放项目/团队专属
  协作流程；temporary workflow 通过 `--workflow-file` 临时使用。
- `--workflow-file` 绕过 registry，直接指定本次 run 的 workflow，且不能和
  `--workflow <id>` 同时使用。
- workflow defaults 可以让每个 stage 引用一个或多个 agent ids。
- L2 只定义多 agent assignment 的数据形状；真正 fanout dispatch、artifact slot、
  partial failure 和 decider aggregation contract 放到 L5 Role Flow And Review
  Lifecycle。
- `agents list`、`doctor` 和 `flow status --json` 应能说明关键配置来自哪一层。
- run packet 记录 resolved assignment 和必要 config provenance，但不保存 token、session 或私有凭证。
- 项目级配置可以进入 git；用户级配置通常不进入 git。

## 持久化 Packet 模型

标准 packet files：

- `request.md`：用户意图。
- `context.md`：提供给 agent 的事实。
- `plan.md`：run packet 内部的计划 artifact。
- `handoff.md`：交接 artifact。
- `findings.md`：review findings 和主控核对结果。
- `decision.md`：明确工程决策。
- `events.jsonl`：审计时间线。
- `status.json`：machine-readable run state。
- `artifacts.toml`：artifact manifest。
- `release-summary.md`：release gate evidence。

packet 必须具备的性质：

- 人类可读
- 机器可验证
- local-first
- git-friendly
- 可恢复
- 不依赖私有聊天上下文也能安全 handoff
- 不需要运行数据库也能检查

## 多 Agent Context 语义

AgentMesh 共享的是 packet，不是各个 host agent 的私有聊天上下文。

目标语义：

- Codex、Claude Code、Gemini CLI、Cursor、OpenCode、Copilot 等 host 的私有
  session/context 不被视为可共享事实。
- 后续 agent 需要知道的内容，必须被写入 packet artifact；没写入 packet，就不算
  可靠交接材料。
- `current` 是唯一允许 host 私有上下文进入 packet 的通道；入口 agent 必须通过
  `flow attach` 或等价 artifact 写入，把私有判断变成可检查事实。
- dispatch 时 runtime 从 packet artifacts 组装 prompt snapshot；这是 prompt 快照，
  不是工作区或 git worktree 快照。
- 工作区文件系统默认是 live state。reviewer、decider 或 executor 看到的代码可能在
  长任务期间变化；需要稳定代码快照时，必须由未来显式 sandbox/worktree 机制提供。
- `context.md` 默认在 run 创建时捕获并冻结；任何刷新都必须是显式命令或显式 stage
  行为，并写入 event/provenance。`release-summary.md` 属于可显式刷新的 derived
  evidence，不能让 context source 静默重拉。
- stage 完成前必须 flush to packet：计划、执行交接、review finding、decision、
  skipped checks、residual risk 这类会影响后续 agent 的内容必须写入标准 artifact。
- review/research/verify 这类 fanout stage 可以共享同一份 packet evidence，但每个
  agent 的输出必须落到独立 artifact slot，再由 decider 聚合。
- execute 默认 single controller。多 executor 只有在 workflow 明确定义分区、锁和
  merge 规则后才允许；在此之前必须 fail fast。
- packet mutation 需要 single-writer model。未来 fanout、Studio 或并发 CLI mutation
  进入前，run directory 必须有 lock/lease 或等价保护。
- prompt assembly 必须有 per-stage/per-adapter budget 规则；packet 可以无限增长，
  但 dispatch prompt 不能假设所有 host CLI 都有同样上下文窗口。
- redaction/secret hygiene 必须显式处理。默认把 `context.md`、diff、verification
  evidence 发给外部 CLI 之前，应记录当前 redaction 能力和风险。

## Release Gate

Release readiness 是一等 workflow outcome。

release gate 聚合：

- diff summary
- verification commands and results
- skipped checks
- accepted review findings
- rejected review findings
- unresolved review findings
- residual risk
- final decision owner

允许的 verdict：

- `ready`
- `not_ready`
- `needs_decision`

## 已归档计划

短期 S1-S7 和长期 L1-L8 已完成，详细执行历史已从主计划抽出归档。

- 短期归档：`docs/archive/short-term-plan-2026-05-14.md`。
- 长期归档：`docs/archive/completed-long-term-plan-2026-05-15.md`。
- 当前事实：TS/Node CLI 是唯一目标命令面；Python runtime 已 decommission；L1-L8 的 context、config/workflow registry、MCP、adapter registry、review lifecycle、project facts、corrections、Studio v1 已完成。

## 当前执行原则

- 一次只做一个小任务；默认按 `P<n>.<m>` slice 执行，过大的 slice 先拆分。
- 小任务开始前确认范围、依赖、非目标和验证命令；不清楚时先补计划，不直接写代码。
- 同一个小任务里同步更新实现、tests、contract docs、skill/docs 示例和 Studio 可见面，除非该任务明确排除。
- 小任务完成前必须运行 slice-specific verification；影响面大、协议变更或跨包变更时跑 `npm test`。
- 小任务完成前必须 review：至少做主控自审；涉及协议、runtime、CLI、Studio、发布或安全边界时保留外审或 AgentMesh review-gate 证据。
- Review finding 必须先核对事实；accepted findings 修完并回归验证后，才能进入收尾。
- 收尾顺序固定：更新 plan checkbox 和证据 -> 同步 `changelog/` -> 运行最终验证或 `git diff --check` -> commit。
- commit 完成后才能开始下一个小任务；同一批文件有用户未提交改动时，先确认范围并避免覆盖。
- 每个大任务 `P<n>` 全部完成后，重新校准 `README.md` 和根目录 `index.html`，同步产品能力、安装方式、命令入口、截图/说明和当前限制；完成校准后再做大任务收尾 review、changelog 和 commit。

## 当前待执行计划

当前 backlog 重新按产品价值、依赖关系和实施风险排序。执行时只推进第一个未完成任务；每个任务完成后都要补证据、验证、review，同步 `changelog/`，然后 commit，再进入下一个任务。

优先级顺序：

1. **P1 Studio 全量产品化**：先把当前 Studio 从“能用的内部页面”整理成真正可长期使用的控制台。
2. **P2 Agent 注册默认命名与配置分层产品化**：降低 agent 初始化成本，同时把值得分层的 MCP、context、review/release、execution policy 收口。
3. **P3 Verify stage type 与运行时并行调度**：先把 `verify` 补成正式 stage type，再补 runtime timing、MCP 连接复用和 async adapter invocation，最后做 fanout 并发能力。
4. **P4 Studio 桌面版与双渠道分发**：复用产品化后的 Studio，交付 macOS DMG App，同时保留 npm CLI / browser Studio。
5. **P5 公共扩展接口**：等 CLI / Studio / Desktop 跑顺后，再把内部能力整理成稳定的插件和集成边界。

### P1. Studio 全量产品化

状态：已完成。

目标：把 `apps/studio` 从当前信息堆叠页面重构成清晰、可扫描、可操作的本地控制台。重点不是做 landing page，而是让用户能快速看到 runs、workflow/agent 配置、时间线、产物、review/release evidence 和安全操作入口。

入口门槛：

- L8 Studio v1 已完成。
- run timing、event pagination、agents/workflows catalog 已完成。
- 当前 `apps/studio/src/assets.ts` 仍是单文件 UI，需要在不引入大框架的前提下先整理信息架构。

非目标：

- 不接 cloud。
- 不直接编辑 packet 文件。
- 不把 runtime state transition 逻辑复制到前端。
- 不先做 Electron；桌面版放到 P4。
- 不引入 React/Vite，除非后续任务明确证明原生 TS/CSS 已经成为阻力。

#### P1.1 锁定 Studio 信息架构和验收边界

状态：已完成。

**文件：**

- 修改：`plan.md`
- 新增：`docs/decisions/studio-productization.md`
- 修改：`tests-node/studio-ui.test.ts`
- 修改：`tests-node/studio.test.ts`

**步骤：**

- [x] ~~Step 1：盘点当前 Studio 数据面。~~
  - 读取 `apps/studio/src/assets.ts`、`apps/studio/src/server.ts`、`apps/studio/src/packet-browser.ts`、`apps/studio/src/catalog.ts`。
  - 列出 UI 当前可用数据：runs、run summary、stage timing、events page、artifacts、review_release、catalog diagnostics。
  - 证据：确认当前 Studio 数据面覆盖 runs、run summary、stage timing、events page、artifacts、review_release、catalog diagnostics 和 CLI-backed agents/workflows catalog。

- [x] ~~Step 2：写产品化决策文档。~~
  - 文档记录首屏布局、主要用户任务、非目标、数据来源、mutation 规则和移动端降级策略。
  - 必须明确：Studio 是本地工作台，不是 marketing page。
  - 证据：新增 `docs/decisions/studio-productization.md`。

- [x] ~~Step 3：把决策转成测试检查点。~~
  - 在 `studio-ui.test.ts` 中补首屏结构断言：run list、当前 run 总览、时间线/事件、产物、review/release、配置入口都能被渲染。
  - 在 `studio.test.ts` 中确认 API 仍只通过 Studio server 暴露，不直接 import runtime。
  - 证据：`tests-node/studio-ui.test.ts` 增加 P1 workbench landmark 断言；`tests-node/studio.test.ts` 增加 Studio server API boundary / runtime-free 断言。

- [x] ~~Step 4：运行验证。~~
  - `npm run build && node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio.test.js`
  - `git diff --check`
  - 证据：`npm run build && node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio.test.js` 通过，15 tests passed；`npm test` 通过，219 tests passed；`git diff --check` 通过。

- [x] ~~Step 5：自审并提交。~~
  - 自审重点：信息架构是否能覆盖用户截图里提到的时间、分页、已有 workflow/agent。
  - commit 信息建议：`docs: plan studio productization`。
  - 证据：自审确认 P1.1 决策覆盖 run 时间、事件分页、artifact preview、review/release evidence、agents/workflows catalog、CLI-backed mutation 边界；提交信息使用 `docs: plan studio productization`。

#### P1.2 重构 Studio 页面布局

状态：已完成。

**文件：**

- 修改：`apps/studio/src/assets.ts`
- 修改：`tests-node/studio-ui.test.ts`

**步骤：**

- [x] ~~Step 1：先写失败测试，锁定新布局骨架。~~
  - 断言存在：顶部 workspace bar、左侧 run navigator、中间 run workspace、右侧 inspector 或详情区。
  - 断言中文默认文案仍存在，英文切换仍可用。
  - 证据：`tests-node/studio-ui.test.ts` 增加 P1.2 console skeleton 断言，RED 阶段在旧 `.main`/侧栏 workspace bar/缺少 inspector 上失败。

- [x] ~~Step 2：重排 HTML 结构。~~
  - 左侧只放 run 搜索/筛选/列表和刷新。
  - 中间放当前 run 总览、stage 时间、timeline/events、artifacts。
  - 右侧放 catalog、review/release、mutation actions 或 artifact preview。
  - 证据：`apps/studio/src/assets.ts` 改为顶部 `workspace-bar`、左侧 `run-navigator`、中间 `run-workspace`、右侧 `inspector`。

- [x] ~~Step 3：重写 CSS token 和布局。~~
  - 保持工作台风格：高密度、低装饰、可扫描。
  - 避免 UI 卡片套卡片。
  - 保证 375px 宽度不横向滚动。
  - 证据：CSS 使用三栏 grid、1120px 两栏降级、720px 单列降级，并设置 `overflow-x: hidden`、`minmax(0, ...)`、按钮换行和长文本换行。

- [x] ~~Step 4：更新 render 函数。~~
  - `renderRuns`、`renderDetail`、`renderCatalog`、`renderReviewRelease`、`renderPreview` 要对应新 DOM。
  - 保持 HTML escape。
  - 证据：保留原有渲染目标 id，新增 `runs-title` i18n 绑定；既有 render 回归继续覆盖 runs、summary、catalog、review/release、preview 和 mutation 输出。

- [x] ~~Step 5：运行验证。~~
  - `npm run build && node --test dist-node/tests-node/studio-ui.test.js`
  - `git diff --check`
  - 证据：`npm run build && node --test dist-node/tests-node/studio-ui.test.js` 通过，5 tests passed；`git diff --check` 通过。

- [x] ~~Step 6：自审并提交。~~
  - 自审重点：移动端不重叠、按钮不挤压、长 run id 可换行。
  - commit 信息建议：`feat: restructure studio workspace layout`。
  - 证据：自审确认 720px 单列规则、按钮 flex wrap、run/artifact 文本 `overflow-wrap:anywhere` 保留；提交信息使用 `feat: restructure studio workspace layout`。

#### P1.3 增强 run navigator

状态：已完成。

**文件：**

- 修改：`apps/studio/src/assets.ts`
- 如 API 不足再修改：`apps/studio/src/packet-browser.ts`
- 测试：`tests-node/studio-ui.test.ts`、`tests-node/studio.test.ts`

**步骤：**

- [x] ~~Step 1：补测试覆盖 run 列表显示。~~
  - 每个 run 显示 run id、workflow、status、latest event、更新时间。
  - 更新时间格式为 `yyyy-mm-dd hh:mm:ss`。
  - active run 有明确选中态。
  - 证据：`tests-node/studio-ui.test.ts` 覆盖 run id、workflow、status、latest event、格式化更新时间和 `aria-current="true"`。

- [x] ~~Step 2：增加前端筛选。~~
  - 支持按 run id / workflow / status 文本过滤。
  - 不做复杂后端搜索；先在已加载 runs 内过滤。
  - 证据：新增 `run-filter` 本地筛选输入，测试覆盖按 workflow 过滤和清空后恢复列表。

- [x] ~~Step 3：增加 run list 空状态。~~
  - 无 runs、过滤后无结果、加载失败三种状态要区分。
  - 证据：保留无 runs 空状态，新增过滤无匹配和 `/api/runs` 加载失败空状态测试。

- [x] ~~Step 4：验证。~~
  - `npm run build && node --test --test-name-pattern="Studio UI" dist-node/tests-node/studio-ui.test.js`
  - `git diff --check`
  - 证据：`npm run build && node --test --test-name-pattern="Studio UI" dist-node/tests-node/studio-ui.test.js` 通过，3 tests passed；扩展验证 `npm run build && node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio.test.js && git diff --check` 通过，17 tests passed。

- [x] ~~Step 5：提交。~~
  - commit 信息建议：`feat: improve studio run navigator`。
  - 证据：自审确认筛选只在已加载 runs 内执行、未修改 packet browser API；提交信息使用 `feat: improve studio run navigator`。

#### P1.4 重构当前 run 工作区

状态：已完成。

**文件：**

- 修改：`apps/studio/src/assets.ts`
- 修改：`apps/studio/src/packet-browser.ts`，仅当 summary 数据不够时。
- 测试：`tests-node/studio-ui.test.ts`、`tests-node/studio.test.ts`

**步骤：**

- [x] ~~Step 1：补测试覆盖 run summary。~~
  - 创建时间、更新时间、workflow、status、completed/total stages、当前 latest event 都可见。
  - 证据：`tests-node/studio-ui.test.ts` 覆盖 workflow、status、completed/total stages、created/updated time 和 latest event。

- [x] ~~Step 2：把 stage timing 展示成可扫描列表。~~
  - 每个 stage 显示状态、尝试次数、开始时间、结束时间或耗时。
  - planned/running/completed/failed 不只靠颜色区分。
  - 证据：`apps/studio/src/assets.ts` 增加 `stage-timeline` / `stage-row`，显示 stage、开始/结束/失败时间、耗时、尝试次数和文本状态。

- [x] ~~Step 3：把 events 做成 timeline。~~
  - 保留分页按钮。
  - 每条事件显示 event 名、时间和关键字段摘要。
  - 事件时间继续格式化为 `yyyy-mm-dd hh:mm:ss`。
  - 证据：事件行保留 event/time，新增过滤后的字段摘要；测试覆盖 `stage: review`、`agent: gemini` 和格式化时间。

- [x] ~~Step 4：把 artifacts 做成稳定列表。~~
  - 显示 artifact name、kind、stage、path。
  - 点击后在详情区预览。
  - 证据：保留 artifact 列表 name/kind/stage/path 与点击预览回归，未改变 artifact API。

- [x] ~~Step 5：验证并提交。~~
  - `npm run build && node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio.test.js`
  - `git diff --check`
  - commit 信息建议：`feat: redesign studio run detail workspace`。
  - 证据：`npm run build && node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio.test.js && git diff --check` 通过，17 tests passed；提交信息使用 `feat: redesign studio run detail workspace`。

#### P1.5 重构 review/release 和 mutation 操作区

**文件：**

- 修改：`apps/studio/src/assets.ts`
- 修改：`apps/studio/src/mutations.ts`，仅当需要更清晰错误输出时。
- 测试：`tests-node/studio-ui.test.ts`、`tests-node/studio.test.ts`

**步骤：**

- [x] ~~Step 1：补测试覆盖 review/release 面板。~~
  - verdict、accepted/rejected/needs decision、skipped checks、residual risk、raw reviews 都能显示。
  - 证据：`tests-node/studio-ui.test.ts` 覆盖 verdict diagnostic、accepted/rejected/needs decision、skipped checks、residual risk 和 raw reviews 展示。

- [x] ~~Step 2：整理 mutation actions。~~
  - dispatch/retry/resume/attach 放在明确的操作区。
  - 禁用态和 running 态要清楚。
  - 错误输出保留命令、exit_code、stdout/stderr。
  - 证据：`tests-node/studio-ui.test.ts` 新增失败 mutation 用例，确认 `flow retry ... --stage review`、`exit_code`、`stdout` 和 `stderr` 保留在输出区，失败后状态保持“需要处理”。

- [x] ~~Step 3：增加危险操作保护。~~
  - 对 dispatch all、retry failed stage、attach text 这类操作至少显示当前 run 和 stage。
  - 本阶段不做复杂确认弹窗，先保证操作上下文清楚。
  - 证据：`apps/studio/src/assets.ts` 新增 `#mutation-context`，显示当前 run、操作阶段和附加阶段；空态会清除旧 run 上下文。

- [x] ~~Step 4：验证并提交。~~
  - `npm run build && node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio.test.js`
  - `git diff --check`
  - commit 信息建议：`feat: refine studio review and action panels`。
  - 证据：`npm run build && node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio.test.js` 通过，18 tests passed；`git diff --check` 通过；self-review 修复 verdict 诊断排版和空态 mutation context 残留。

#### P1.6 整理 agents / workflows 配置视图

**文件：**

- 修改：`apps/studio/src/assets.ts`
- 修改：`apps/studio/src/catalog.ts`，仅当 catalog 数据需要补字段。
- 测试：`tests-node/studio-ui.test.ts`、`tests-node/studio.test.ts`

**步骤：**

- [x] ~~Step 1：补测试覆盖配置视图。~~
  - agents 显示 id、label、adapter、model、capabilities、aliases、source layer。
  - workflows 显示 workflow id、name、status、source、stages。
  - diagnostics 不能只显示数量，要显示具体 target 和 message。
  - 证据：`tests-node/studio-ui.test.ts` 覆盖 agent/workflow 字段和 catalog diagnostics 行；`tests-node/studio.test.ts` 覆盖 server catalog 字段完整性和 diagnostics target。

- [x] ~~Step 2：改 UI 呈现。~~
  - 配置视图可以作为右侧 inspector 或单独 section。
  - diagnostics 用明确的警告行展示。
  - 证据：`apps/studio/src/assets.ts` 新增 `#catalog-diagnostics`，按 target/message 渲染警告行，保留现有右侧 inspector 配置视图。

- [x] ~~Step 3：验证并提交。~~
  - `npm run build && node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio.test.js`
  - `git diff --check`
  - commit 信息建议：`feat: improve studio configuration view`。
  - 证据：`npm run build && node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio.test.js` 通过，18 tests passed；`git diff --check` 通过；self-review 未发现需要修复的 accepted findings。

#### P1.7 做 UI 质量收口

**文件：**

- 修改：`apps/studio/src/assets.ts`
- 修改：`tests-node/studio-ui.test.ts`

**步骤：**

- [x] ~~Step 1：检查可访问性和响应式。~~
  - icon-only button 必须有 aria-label/title。
  - 表单控件有 label。
  - 触控目标不小于 36px，关键按钮尽量 44px。
  - 375px、768px、桌面宽度布局不横向滚动。
  - 证据：`tests-node/studio-ui.test.ts` 增加 accessibility/responsive guardrails；mutation 主按钮为 44px，event pager 按钮为 36px，刷新按钮保留 aria-label/title。

- [x] ~~Step 2：检查视觉一致性。~~
  - 不使用装饰性渐变/orb。
  - 文案字号和容器密度匹配。
  - 长文本不溢出。
  - 证据：CSS guardrails 禁止 decorative gradient/orb 和 viewport-width 字号；1120px 断点下 overview 降为两列，stage row 与 events/artifacts 面板降为单列，避免 tablet 宽度挤压。

- [x] ~~Step 3：做真实浏览器视觉 QA。~~
  - 375px、768px、桌面宽度截图检查不重叠、不横向滚动。
  - 关键按钮、artifact preview、mutation 操作可点击。
  - 证据：Browser QA 使用本地 localhost harness 检查 375px、768px 和 1280px Studio；frame locator 确认每个宽度都有 11 个 section、plan artifact 和“分发”按钮；桌面宽度 `scrollWidth === clientWidth === 1280`，artifact preview 和 mutation 操作可点击。

- [x] ~~Step 4：运行完整验证。~~
  - `npm test`
  - `git diff --check`
  - 证据：`npm test` 通过，223 tests passed；`git diff --check` 通过。

- [x] ~~Step 5：review、同步 `changelog/`、提交。~~
  - commit 信息建议：`feat: polish studio ui`。
  - 证据：self-review 确认改动集中在触控尺寸、tablet 降密度和 event pager DOM class；accepted findings 已修复。

#### P1.8 抽出 Studio 参数解析

**文件：**

- 新增：`apps/studio/src/args.ts`
- 修改：`apps/studio/src/main.ts`
- 新增：`tests-node/studio-args.test.ts`

**步骤：**

- [x] ~~Step 1：写 `parseStudioArgs` 失败测试：默认 host/port、显式 host/port、非法 port、port 0。~~
  - 证据：`tests-node/studio-args.test.ts` 覆盖默认 `127.0.0.1:4777`、显式 host/port、port 0 和非法端口。
- [x] ~~Step 2：实现 `parseStudioArgs`。~~
  - 证据：新增 `apps/studio/src/args.ts`，端口仅接受 0 到 65535 的整数。
- [x] ~~Step 3：`main.ts` 改用 parser。~~
  - 证据：`apps/studio/src/main.ts` 直接调用 `parseStudioArgs(process.argv.slice(2))`。
- [x] ~~Step 4：运行 targeted parser tests、`npm test` 和 `git diff --check`。~~
  - 证据：`npm run build && node --test dist-node/tests-node/studio-args.test.js` 通过，4 tests passed；`npm test` 通过，227 tests passed；`git diff --check` 通过。
- [x] ~~Step 5：review、同步 `changelog/`、commit，建议信息：`refactor: share studio argument parsing`。~~
  - 证据：self-review 确认 parser 只负责 Studio host/port，便于 P1.9 CLI 入口复用。

#### P1.9 增加 `agentmesh studio` CLI 入口

**文件：**

- 修改：`packages/cli/src/cli.ts`
- 新增：`packages/cli/src/commands/studio.ts`
- 修改：`apps/studio/src/main.ts`
- 新增：`tests-node/studio-cli.test.ts`

**步骤：**

- [x] ~~Step 1：写 CLI 失败测试：`agentmesh studio`、`--port`、`--host`、`--workspace`、`--no-open`、非法 port。~~
  - 证据：`tests-node/studio-cli.test.ts` 覆盖启动服务、显式 host/port、workspace、`--no-open`、非法 port 和 browser open 失败；RED 时 CLI 返回 usage/exit 2。
- [x] ~~Step 2：实现 `agentmesh studio`，复用 P1.8 的 Studio 参数解析。~~
  - 证据：新增 `packages/cli/src/commands/studio.ts`，复用 `parseStudioArgs`，并在 `packages/cli/src/cli.ts` 接入 `studio` 命令和 usage。
- [x] ~~Step 3：默认使用本 CLI 安装里的 Studio server，不依赖源码目录。~~
  - 证据：`agentmesh studio` 和 standalone `apps/studio/src/main.ts` 都把当前安装内的 `dist-node/packages/cli/src/cli.js` 传给 Studio server，catalog/mutation 不再回退到 workspace 源码路径。
- [x] ~~Step 4：browser open 失败时输出可复制 URL，不让命令静默挂起。~~
  - 证据：CLI 先输出 `AgentMesh Studio: <url>`；测试用无效 `AGENTMESH_STUDIO_OPEN_COMMAND` 验证 open 失败时仍保留可复制 URL。
- [x] ~~Step 5：运行 targeted tests、`npm test` 和 `git diff --check`。~~
  - 证据：`npm run build && node --test dist-node/tests-node/studio-cli.test.js` 通过，5 tests passed；`npm test` 通过，232 tests passed；`git diff --check` 通过。
- [x] ~~Step 6：review、同步 `changelog/`、commit，建议信息：`feat: add agentmesh studio command`。~~
  - 证据：self-review 发现并修复相对 `--config` 在 `--workspace` 下被错误重解释的问题，新增回归测试覆盖。

#### P1.10 P1 大任务收尾校准

**文件：**

- 修改：`README.md`
- 修改：`index.html`
- 修改：`plan.md`
- 修改：`changelog/YYYY-MM-DD.md`

**步骤：**

- [x] ~~Step 1：重新校准 README。~~
  - 安装、Studio 启动方式、`agentmesh studio`、当前限制和 troubleshooting 与实际行为一致。
  - 证据：`README.md` 更新验证基线为 232 tests，记录 `agentmesh studio --host --port --workspace --no-open`，并把下一步改为 P2。
- [x] ~~Step 2：重新校准根目录 `index.html`。~~
  - 产品定位、关键能力、CLI/Studio 入口和截图/说明不再描述旧状态。
  - 证据：`index.html` 更新 P1 done、232 tests、`agentmesh studio` 入口、Studio CLI 手册和 P2/P3-P5 路线图。
- [x] ~~Step 3：标记 P1 完成项，补齐证据链接。~~
  - 证据：本计划将 P1 状态改为“已完成”，并把“当前下一步”改为 P2 Agent 注册默认命名与配置分层产品化。
- [x] ~~Step 4：运行 `npm test` 和 `git diff --check`。~~
  - 证据：`npm test` 通过，232 tests passed；`git diff --check` 通过。
- [x] ~~Step 5：做 P1 总体 review/release gate，处理 accepted findings。~~
  - 证据：self-review 确认 README、index.html 和 plan 不再残留旧测试数、旧 Studio 主入口或旧下一步描述；无新的 accepted findings。
- [x] ~~Step 6：同步 `changelog/`、commit，建议信息：`docs: sync studio productization docs`。~~
  - 证据：`changelog/2026-05-16.md` 添加 01:43 P1 Studio 产品化文档收口条目；commit 信息使用 `docs: sync studio productization docs`。

### P2. Agent 注册默认命名与配置分层产品化

状态：已完成。

目标：让 `agentmesh agents add` 支持省略 agent id，并在写入 config 前完成 adapter 可用性、模型解析和非交互调用验证。默认 id 必须基于真实解析后的 canonical model 生成，例如用户输入 `gpt55`，最终解析为 `gpt-5.5` 后才生成 `codex-gpt-5-5`。

P2 还要把“哪些配置值得继续支持 user/project scope”收成产品化方案。原则是：用户级保存个人/本机可复用配置，项目级保存仓库/团队约定，单次运行级写入 packet provenance，敏感信息不进入 AgentMesh config。

入口门槛：

- P1 不一定必须完成，但建议先完成 P1，避免 UI 和 CLI 体验同时大改。
- config layering 和 agent registry 已完成。
- 完成事实：`agents add` 支持省略 agent id，模型解析会先走 adapter discovery 再走用户级 explicit alias，写入前会运行 readiness probe；配置分层已覆盖 MCP、context policy、review/release policy、run defaults / execution policy、model aliases 和 capability profiles。

非目标：

- 不保存 token、session、cookie 或任何 provider 登录态。
- 不为 generic `command` adapter 猜模型；generic command 只能做命令可执行性检查，复杂验证由用户自己的命令承担。
- 不用硬编码“最新模型列表”替代真实 CLI / provider 可见模型。模型简称只能通过 adapter-specific discovery 或 explicit alias 规则解析。
- 不把 runs、events、artifacts 做成 user/project 配置；它们继续是 packet 事实源。
- 不把 corrections 做成用户级隐藏记忆；当前继续保持项目级显式事实。

#### P2 最终配置分层需求方案

最终顺序固定为：

1. **MCP 来源分层**。
2. **Context Policy 分层**。
3. **Review / Release Policy 分层**。
4. **Run Defaults / Execution Policy 分层**。
5. **Model Aliases / Capability Profiles 分层**。

总体规则：

- 只把配置做 user/project 分层，不把 runs、events、artifacts 做成配置。
- 用户级表达“这个人/这台机器能提供什么、偏好什么”。
- 项目级表达“这个仓库/团队要求什么”。
- 单次 run 的最终解析结果写入 packet，历史 run 不受后续 config 变化影响。
- `status.json` 是 resolved config / policy / assignment 的唯一机器事实源；`context.md` 只做人类可读解释；`assignment.toml` 不再新增复杂 provenance。
- Secrets、token、session、cookie、API key、provider 登录态永远不进入 AgentMesh config。
- Corrections 继续保持项目级显式事实，不做用户级隐藏记忆。

最终决策：

- Context Policy 采用“并集 + 更严格 + 冲突 fail fast”：
  - `required_sources`、`denied_paths`、`redact_patterns` 取并集。
  - `denied_paths` 优先级最高。
  - `freshness_max_age_seconds`、`max_bytes`、`max_files` 取更严格值。
  - `required_sources` 命中 `denied_paths` 时 fail fast。
  - 必读资料超过 `max_bytes` 或 `max_files` 时 fail fast。
- Review / Release Policy 可以声明 capability profile 需求，但 profile 的完整管理放到 P2.13；P2.11 只实现能让 review/release policy 闭环的最小 profile 解析。
- Run Defaults 是软偏好；Execution Policy 是硬红线。
  - 单次 run 参数可以覆盖 defaults，但不能突破 execution policy。
  - 用户级 execution policy 表示本机/个人安全上限。
  - 项目级 execution policy 表示项目安全上限。
  - 最终取更严格结果。
- Capability Profile 匹配：
  - 0 个匹配 agent：fail fast。
  - 1 个匹配 agent：可自动选择，但必须 warning，并写入 packet。
  - 多个匹配 agent：fail fast，列出候选，要求用户配置 preference。
- MCP resource hint 只是候选入口，不自动读取；真正进入 run 的 MCP 内容必须写 provenance。

#### P2.0 已完成前置决策：配置分层产品化方案

状态：已完成。

**文件：**

- 新增：`docs/decisions/config-layering-productization.md`
- 修改：`plan.md`

**完成内容：**

- [x] Step 1：记录分层判断规则。
  - 用户级：个人/本机配置，可跨项目复用。
  - 项目级：仓库/团队约定，可提交，不依赖个人登录态。
  - 单次运行级：只影响一次 run，写入 packet provenance。
  - 敏感信息：不写入 AgentMesh config。
- [x] Step 2：明确值得产品化的分层能力。
  - MCP servers / resource hints。
  - Context policy / context sources。
  - Review / release policy。
  - Run defaults / execution policy。
  - Model aliases / capability profiles。
- [x] Step 3：明确暂时不分层的内容。
  - secrets / token / session。
  - runs / events / artifacts。
  - corrections。
  - Studio 主题、语言、布局。
  - 云端、团队、账号、远程 runner。
- [x] Step 4：找 `mimo` 做只读 review。
  - 证据：`run-1778847216492`，review artifact `.agentmesh/runs/run-1778847216492/reviews/mimo.md`。
- [x] Step 5：找 `mimo` 和 `gemini` 对最终需求方案做只读 review。
  - 证据：`run-1778850497575`，review artifacts `.agentmesh/runs/run-1778850497575/reviews/mimo.md` 和 `.agentmesh/runs/run-1778850497575/reviews/gemini.md`。
- [x] Step 6：根据 accepted findings 和用户决策调整方案。
  - 补充 packet provenance 字段。
  - 补充 execution policy 安全上限字段和 merge 规则。
  - 明确 capability profile 不改变 `workflow_defaults` 语义。
  - 补充 user/project TOML 示例。
  - 明确 Context Policy 采用“并集 + 更严格 + 冲突 fail fast”。
  - 明确 `status.json` 是 resolved policy 的唯一机器事实源。
  - 明确 profile 单候选 warning 自动选，多候选 fail fast。
- [x] Step 7：运行 `git diff --check`。

#### P2.1 定义 agent 注册验证 contract

**文件：**

- 新增：`docs/contracts/agent-registration.md`
- 修改：`tests-node/core-contracts.test.ts`
- 修改：`plan.md`

**步骤：**

- [x] ~~Step 1：写 contract 文档，明确 `agents add` 的默认流程：~~
  1. 解析 adapter id / alias。
  2. 解析用户输入的 model 为 canonical model。
  3. 构造临时 candidate agent。
  4. 运行添加前 readiness probe。
  5. 只有 probe 通过才写入 config。
  6. 默认 id 和 label 使用 canonical model，而不是原始用户输入。
  - 证据：`docs/contracts/agent-registration.md` 定义 `agents add [agent-id] --adapter <adapter> --model <model-or-alias> [--skip-verify]` 的默认注册流程。
- [x] ~~Step 2：定义失败策略。~~
  - adapter CLI 不存在：失败，不写 config。
  - 模型简称无法解析：失败，不写 config。
  - 模型简称匹配多个候选：失败，输出候选模型。
  - auth/model probe 失败或超时：失败，不写 config。
  - 用户显式传 `--skip-verify` 时可跳过 probe，但仍要把风险写清楚；是否允许跳过 model resolution 需要在 contract 中明确。
  - 证据：contract 明确 unknown adapter、adapter CLI 不存在、无法解析/ambiguous model、重复 id、auth/model probe 失败、timeout 和 config write failure 都 fail fast 且不写 config；`--skip-verify` 只跳过 probe，不跳过 adapter/model resolution、重复 id、命令路径和写入安全检查。
- [x] ~~Step 3：在 `core-contracts.test.ts` 中加入 contract doc 存在性检查。~~
  - 证据：`tests-node/core-contracts.test.ts` 将 `agent-registration.md` 纳入 contract docs 清单，并断言 canonical model、temporary candidate agent、readiness probe、default id/label、ambiguous model、`--skip-verify` 和 no-write 语义。
- [x] ~~Step 4：运行验证。~~
  - `npm run build && node --test dist-node/tests-node/core-contracts.test.js`
  - 证据：`npm run build && node --test dist-node/tests-node/core-contracts.test.js` 通过，10 tests passed；`git diff --check` 通过。
- [x] ~~Step 5：review、同步 `changelog/`、commit，建议信息：`docs: define agent registration contract`。~~
  - 证据：self-review 确认 contract 未把 `--skip-verify` 写成万能跳过，且未承诺保存凭证；`changelog/2026-05-16.md` 添加 01:48 条目。

#### P2.2 添加模型解析测试

**文件：**

- 新增：`tests-node/agent-registration.test.ts`
- 修改：`tests-node/cli-surface.test.ts`
- 新增：`packages/runtime/src/adapters/models.ts`

**步骤：**

- [x] ~~Step 1：写 model resolver 单元测试。~~
  - 输入 exact model：`gpt-5.5` => `gpt-5.5`。
  - 输入常见简称：`gpt55`、`gpt-5.5`、`gpt 5.5` 都能解析到同一个 canonical model，前提是 discovery 返回该模型。
  - provider prefix：`anthropic/claude-sonnet-4.5` 应以最后 segment 参与默认 id slug。
  - 模糊简称匹配多个模型时返回 ambiguous，并列出 candidates。
  - 无匹配时返回 not_found。
  - 证据：`tests-node/agent-registration.test.ts` 覆盖 exact/normalized shorthand、provider final segment slug、ambiguous、not_found 和 punctuation-only not_found。
- [x] ~~Step 2：写 CLI 失败测试。~~
  - 用户传无法解析的 `--model` 时，`agents add` 返回 2，不写 config。
  - 用户传模糊简称时，stderr 展示候选，不写 config。
  - 证据：`tests-node/cli-surface.test.ts` 覆盖 `gpt-6` not_found 和 `gpt5` ambiguous，断言 user config 不会被写入。
- [x] ~~Step 3：实现纯函数测试所需的最小 normalization / resolver skeleton，不接 adapter discovery。~~
  - 证据：新增 `packages/runtime/src/adapters/models.ts`，提供 `resolveAdapterModel`、`normalizeModelKey`、`modelSlugSegment` 和最小静态候选；真实 adapter discovery 留到 P2.3。
- [x] ~~Step 4：运行 targeted tests 和 `git diff --check`，保持本 slice 可独立提交。~~
  - `npm run build && node --test --test-name-pattern="model" dist-node/tests-node/agent-registration.test.js dist-node/tests-node/cli-surface.test.js`
  - 证据：pattern targeted tests 通过，7 tests passed；额外运行 `agent-registration.test.js`、`cli-surface.test.js`、`management-cli.test.js` 通过，23 tests passed；`git diff --check` 通过。
- [x] ~~Step 5：review、同步 `changelog/`、commit，建议信息：`test: cover agent model resolution`。~~
  - 证据：self-review 修复 punctuation-only 输入被误报 ambiguous 的边界；`changelog/2026-05-16.md` 添加 01:54 条目。

#### P2.3 实现 adapter model discovery / resolution

**文件：**

- 修改：`packages/runtime/src/adapters/models.ts`
- 参考：`packages/runtime/src/adapters/registry.ts`
- 测试：`tests-node/agent-registration.test.ts`

**步骤：**

- [x] ~~Step 1：定义 model discovery 接口。~~
  - 输出 canonical model id 列表。
  - 记录 discovery 来源，例如 adapter CLI command、static fixture 或 unsupported。
  - 不把网络凭证或用户 session 写入任何文件。
  - 证据：`AdapterModelDiscovery` 区分 `discovered` / `unsupported`，`discoverAdapterModels` 返回 canonical model list 与 `static-fixture`/`unsupported` 来源；当前实现不执行外部 CLI，也不写入凭证或 session。
- [x] ~~Step 2：为内置 AI CLI adapter 增加 adapter-specific discovery hook。~~
  - Codex、Claude、Gemini、OpenCode 的具体 list models 命令必须用本机 CLI help/version 或官方 CLI 行为校准。
  - 如果某个 CLI 没有稳定 list models 命令，本阶段要明确返回 unsupported，并走 probe-based exact model 验证，不假装能列模型。
  - 证据：本机 help 校准显示 Codex/Claude/Gemini 未暴露稳定 list models 命令，`modelDiscoveryHook` 对这些 adapter 返回 unsupported；OpenCode `opencode models --help` 暴露稳定 `opencode models [provider]`，hook 记录 `["opencode", "models"]`。
- [x] ~~Step 3：实现 `resolveAdapterModel(adapter, userInput, discoveredModels)`。~~
  - exact match 优先。
  - normalized alias match 次之。
  - 多候选返回 ambiguous。
  - 无候选返回 not_found。
  - 证据：`resolveAdapterModel` 保留双参数兼容调用，并新增 adapter-aware overload；测试覆盖 exact、normalized shorthand、ambiguous、not_found。
- [x] ~~Step 4：实现 normalized matching。~~
  - 忽略大小写。
  - 把空格、下划线、点、斜杠等非字母数字片段统一为 `-` 比较。
  - provider 前缀不参与默认 slug，但 exact canonical id 仍保留完整值。
  - 证据：`normalizeModelKey("gpt 5.5")` 输出 `gpt-5-5`，同时 compact alias 仍支持 `gpt55`；`modelSlugSegment("anthropic/claude-sonnet-4.5")` 仍输出 final segment slug。
- [x] ~~Step 5：运行 P2.2 targeted tests 和 `git diff --check`。~~
  - 证据：`npm run build && node --test --test-name-pattern="model" dist-node/tests-node/agent-registration.test.js dist-node/tests-node/cli-surface.test.js` 通过，11 tests passed；额外运行 `agent-registration.test.js`、`cli-surface.test.js`、`management-cli.test.js` 通过，26 tests passed；`git diff --check` 通过。
- [x] ~~Step 6：review、同步 `changelog/`、commit，建议信息：`feat: discover adapter models`。~~
  - 证据：self-review 修正 OpenCode CLI surface 测试使用的 stale model，改为当前 fixture 中的 `zhuanzhuan/deepseek-v4-pro`；`changelog/2026-05-16.md` 添加 02:04 条目。

#### P2.4 添加默认 id / label helper，基于 canonical model

**文件：**

- 修改：`packages/runtime/src/adapters.ts`
- 测试：`tests-node/agent-registration.test.ts`

**步骤：**

- [x] ~~Step 1：确认 adapter metadata 有 `label` 和 alias。~~
  - 证据：`defaultAgentLabel` 复用 runtime adapter registry 的 `label`，`adapterShortName` 支持 canonical id 和 alias。
- [x] ~~Step 2：实现 `defaultAgentId(adapterIdOrAlias, canonicalModel)`。~~
  - 证据：新增 `defaultAgentId`，格式为 `<adapter-short-name>-<model-final-segment-slug>`。
- [x] ~~Step 3：实现 `defaultAgentLabel(adapterIdOrAlias, canonicalModel)`。~~
  - 证据：新增 `defaultAgentLabel`，格式为 `<adapter label> (<canonical model>)`。
- [x] ~~Step 4：实现 model slug 和 adapter short name helper。~~
  - 证据：复用 P2.3 的 `modelSlugSegment`，新增 `adapterShortName`，`claude-code-cli` / `claude` 归一为 `claude`。
- [x] ~~Step 5：测试确保默认 id 使用 canonical model，不使用用户原始简称。~~
  - 证据：`tests-node/agent-registration.test.ts` 覆盖 `gpt55` 解析为 `gpt-5.5` 后生成 `codex-gpt-5-5`，并覆盖 provider-prefixed OpenCode model 的 final segment slug。
- [x] ~~Step 6：运行 agent registration targeted tests 和 `git diff --check`。~~
  - 证据：`npm run build && node --test dist-node/tests-node/agent-registration.test.js && git diff --check` 通过，9 tests passed。
- [x] ~~Step 7：review、同步 `changelog/`、commit，建议信息：`feat: derive default agent identity`。~~
  - 证据：self-review 未发现 accepted findings；`changelog/2026-05-16.md` 添加 02:07 条目。

#### P2.5 添加注册前 readiness probe

**文件：**

- 修改：`packages/runtime/src/doctor/readiness.ts`
- 新增：`packages/runtime/src/adapters/registration.ts`
- 测试：`tests-node/readiness.test.ts`
- 测试：`tests-node/agent-registration.test.ts`

**步骤：**

- [x] ~~Step 1：抽出可复用的单 agent readiness probe。~~
  - 复用 doctor 的 command existence、help/version、auth/model probe 逻辑。
  - 输入是 candidate agent，不要求它已经写入 config。
  - 证据：`probeAgentReadiness(agent, options)` 从 `buildDoctorReport` 中抽出，直接接受 in-memory `AgentConfig` candidate 并复用 command existence、help/version、auth/model probe。
- [x] ~~Step 2：probe 必须使用 canonical model 构造临时 agent。~~
  - 证据：`buildAgentRegistrationCandidate` 使用 canonical adapter/model 构造临时 agent；测试覆盖 `gpt55 -> gpt-5.5` 后 probe 命令使用 `-m gpt-5.5`。
- [x] ~~Step 3：probe 通过才允许写入 config。~~
  - 证据：新增 `probeAgentRegistrationReadiness` 返回 `ok` / `message` / `hints` / `warnings`，P2.6 CLI 写入将以该结果作为写前 gate。
- [x] ~~Step 4：probe 失败时输出可行动错误。~~
  - command missing。
  - auth failed。
  - auth timeout。
  - model unavailable。
  - help/version failed。
  - 证据：readiness tests 覆盖 command missing、model unavailable、auth timeout、help failed、version failed，并输出包含命令或 probe 状态的 message。
- [x] ~~Step 5：为 generic `command` adapter 定义行为。~~
  - 只验证 command 可执行。
  - 如果用户配置了 prompt/stdin/output 参数，后续再考虑深度 probe。
  - 证据：`command` adapter registration readiness 只检查 command existence，help/version/auth probe 均为 `not_applicable`。
- [x] ~~Step 6：支持显式 `--skip-verify`。~~
  - 跳过 auth/model probe。
  - 仍做 adapter id、命令路径和重复 id 基础校验。
  - 输出 warning。
  - 证据：`probeAgentRegistrationReadiness(..., { skipVerify: true })` 跳过 auth/model probe 并返回 warning；missing command 即使 skip verify 仍失败。重复 id 基础校验随 P2.6 CLI 写入层接入。
- [x] ~~Step 7：运行 readiness / agent registration targeted tests 和 `git diff --check`。~~
  - 证据：`npm run build && node --test dist-node/tests-node/readiness.test.js dist-node/tests-node/agent-registration.test.js && git diff --check` 通过，43 tests passed。
- [x] ~~Step 8：review、同步 `changelog/`、commit，建议信息：`feat: probe agents before registration`。~~
  - 证据：self-review 收紧 model unavailable 分类，补充 skip-verify 不绕过 missing command 的回归；`changelog/2026-05-16.md` 添加 02:14 条目。

#### P2.6 修改 CLI add 解析、模型解析、重复 id 保护

**文件：**

- 修改：`packages/cli/src/commands/agents.ts`
- 修改：`packages/cli/src/cli.ts`
- 测试：`tests-node/cli-surface.test.ts`
- 测试：`tests-node/management-cli.test.ts`

**步骤：**

- [x] ~~Step 1：`agents add` positional id 从必填改为可选。~~
  - 证据：`agents add --adapter codex --model gpt55` 可省略 positional id 并成功注册。
- [x] ~~Step 2：无 positional id 时，在模型解析完成后调用 `defaultAgentId(adapter, canonicalModel)`。~~
  - 证据：测试覆盖 `gpt55 -> gpt-5.5 -> codex-gpt-5-5`，默认 label 使用 `Codex CLI (gpt-5.5)`。
- [x] ~~Step 3：超过一个 positional arg 返回 usage 错误。~~
  - 证据：`agents add one two --adapter codex --model gpt-5.5` 返回 2 并输出 `[agent-id]` usage。
- [x] ~~Step 4：unknown adapter 返回 usage 风格状态码 2。~~
  - 证据：unknown adapter 返回 2，并输出 supported adapter ids/aliases。
- [x] ~~Step 5：先解析 model，再构造 candidate agent。~~
  - 证据：CLI 使用 `resolveKnownAdapterModel` 的 canonical model 构造 `buildAgentRegistrationCandidate`，写入时使用 candidate canonical model。
- [x] ~~Step 6：写入前检查 resolved config layers，发现重复 id 时失败且不写文件。~~
  - 证据：重复 `codex-gpt-5-5` 返回 1，user config 内容保持原样；首次注册时无 config 被视为空 registry。
- [x] ~~Step 7：默认运行注册前 readiness probe；probe 不通过不写文件。~~
  - 证据：fake CLI model unavailable 时返回 1 且不创建 config；`--skip-verify` 才允许带 warning 写入。
- [x] ~~Step 8：写入 config 时保存 canonical model。~~
  - 证据：省略 id 且输入 `gpt55` 时 config 写入 `model = "gpt-5.5"`。
- [x] ~~Step 9：更新 help 文案为 `agents add [agent-id] --adapter <adapter> --model <model-or-alias> [--skip-verify]`。~~
  - 证据：`packages/cli/src/cli.ts` usage 已更新为 optional id、model-or-alias 和 `--skip-verify`。
- [x] ~~Step 10：运行 CLI / agent registration targeted tests、`npm test` 和 `git diff --check`。~~
  - 证据：targeted `cli-surface.test.js`、`management-cli.test.js`、`agent-registration.test.js` 通过，33 tests passed；`npm test` 通过，253 tests passed；`git diff --check` 通过。
- [x] ~~Step 11：review、同步 `changelog/`、commit，建议信息：`feat: add verified agent registration cli`。~~
  - 证据：self-review 修复首次注册无 config 时查重误失败的问题，并改为写入 candidate canonical model；`changelog/2026-05-16.md` 添加 02:23 条目。

#### P2.7 保留显式 id 兼容并更新文档

**文件：**

- 修改：`README.md`
- 修改：`agentmesh-skill/SKILL.md`
- 修改：`packages/cli/src/commands/init.ts`
- 测试：`tests-node/cli-surface.test.ts`

**步骤：**

- [x] ~~Step 1：补显式 id 兼容测试。~~
  - 证据：`tests-node/cli-surface.test.ts` 覆盖 `agents add legacy_planner --adapter codex --model gpt55` 仍写入显式 id，同时保存 canonical model。
- [x] ~~Step 2：补 `--skip-verify` 测试和文档，明确它是逃生口，不是默认推荐。~~
  - 证据：P2.6 skip-verify CLI 测试保留；README、AgentMesh skill 和 init 注释均说明它是 offline setup escape hatch，跳过后应运行 `agentmesh doctor`。
- [x] ~~Step 3：更新 README agent 注册示例，优先展示省略 id 写法。~~
  - 示例说明用户可以传简称，但最终写入 canonical model。
  - 示例说明添加时会真实 probe，失败不会写 config。
  - 证据：README 首个注册示例使用省略 id 的 `agents add --adapter codex --model gpt55`，并说明默认 id `codex-gpt-5-5`、canonical model 写入和 readiness no-write 行为。
- [x] ~~Step 4：更新 AgentMesh skill setup 示例。~~
  - 证据：`agentmesh-skill/SKILL.md` 改用 adapter alias、model alias 和当前 OpenCode fixture model，并说明 readiness probe / `--skip-verify`。
- [x] ~~Step 5：更新 init 生成注释。~~
  - 证据：`packages/cli/src/commands/init.ts` 模板展示 optional id、canonical model 默认命名、readiness probe 和 skip-verify 警示。
- [x] ~~Step 6：运行 docs/CLI targeted tests 和 `git diff --check`。~~
  - 证据：`npm run build && node --test dist-node/tests-node/cli-surface.test.js dist-node/tests-node/readiness.test.js && git diff --check` 通过，48 tests passed。
- [x] ~~Step 7：review、同步 `changelog/`、commit，建议信息：`docs: document verified agent registration`。~~
  - 证据：self-review 修正 README remove 示例使用默认生成的 `codex-gpt-5-5`；`changelog/2026-05-16.md` 添加 02:28 条目。

#### P2.8 Agent 注册验证集成 smoke

**步骤：**

- [x] ~~Step 1：运行 targeted tests。~~
  - `npm run build && node --test dist-node/tests-node/agent-registration.test.js dist-node/tests-node/cli-surface.test.js dist-node/tests-node/management-cli.test.js dist-node/tests-node/readiness.test.js`
  - 证据：targeted smoke 通过，66 tests passed。
- [x] ~~Step 2：运行完整测试。~~
  - `npm test`
  - 证据：完整测试通过，254 tests passed。
- [x] ~~Step 3：运行 `git diff --check`。~~
  - 证据：`git diff --check` 通过。
- [x] ~~Step 4：自审添加前验证、模型解析、重复 id、显式 id 兼容和文档一致性。~~
  - 证据：确认 P2.6/P2.7 覆盖 readiness no-write、canonical model 写入、duplicate id no-write、explicit id 兼容、README/skill/init 文案一致。
- [x] ~~Step 5：必要时用 fake command agent 做一次 `agents add` smoke，记录是否跳过真实 provider probe。~~
  - 证据：使用临时 fake `codex` CLI 执行 `agents add --adapter codex --model gpt55 --capability plan`，未触碰真实 provider，写入 `codex-gpt-5-5` 和 `model = "gpt-5.5"`。
- [x] ~~Step 6：review、同步 `changelog/`、commit，建议信息：`test: verify agent registration rollout`。~~
  - 证据：`changelog/2026-05-16.md` 添加 02:31 条目。

#### P2.9 产品化 MCP scope

**文件：**

- 修改：`packages/cli/src/commands/mcp.ts`
- 修改：`packages/cli/src/cli.ts`
- 修改：`packages/runtime/src/config.ts`
- 修改：`docs/contracts/mcp-client.md`
- 测试：`tests-node/mcp-inventory.test.ts`
- 测试：`tests-node/config-layering.test.ts`

**步骤：**

- [x] ~~Step 1：增加 MCP management CLI 设计和测试。~~
  - `agentmesh mcp list [--json]` 列出 configured servers，不调用 `resources/list`。
  - `agentmesh mcp add <server-id> --command <command> [--arg <arg> ...] [--resource-hint <uri> ...] [--scope user|project]` 写入对应 config。
  - `agentmesh mcp remove <server-id> --scope user|project` 只删除目标层。
  - 证据：`tests-node/mcp-inventory.test.ts` 覆盖 list 不启动 fake server、add 写入 project scope、remove 只删除目标层，以及 add 跨层重复 id fail fast。
- [x] ~~Step 2：定义 MCP server entry schema。~~
  - `command: string`
  - `args: string[]`
  - `resource_hints: string[]`
  - 不保存 token、env secret 或 session path。
  - 证据：`packages/runtime/src/config.ts` 校验 MCP entry 只支持 `command`、`args`、`resource_hints`；`tests-node/config-layering.test.ts` 覆盖 `env` secret 字段被拒绝。
- [x] ~~Step 3：human/JSON 输出 source layer、source path、resource hints 和 list diagnostics。~~
  - 证据：`agentmesh mcp list --json` 输出 `source_layer`、`source_path`、`resource_hints` 和 duplicate-id diagnostics；human 输出包含 source/path/command/hints。
- [x] ~~Step 4：Doctor 检查 duplicate id、command missing、server start failed、resource list failed。~~
  - 证据：`doctorConfigDiagnostic` 增加 duplicate MCP id 分类；`agentmesh doctor --json` 对 missing command 和 fake `resources/list` failure 输出 MCP diagnostics。
- [x] ~~Step 5：Studio 配置视图显示 MCP 来源层和诊断。~~
  - 证据：Studio catalog 通过 CLI 读取 `mcp list --json`，UI 配置区新增 MCP column 并显示 source layer、resource hints 和 mcp diagnostics。
- [x] ~~Step 6：运行 MCP/config targeted tests 和 `git diff --check`。~~
  - 证据：`npm run build && node --test dist-node/tests-node/mcp-inventory.test.js` 通过，8 tests passed；`npm test` 通过，262 tests passed；`git diff --check` 通过。
- [x] ~~Step 7：review、同步 `changelog/`、commit，建议信息：`feat: manage scoped mcp servers`。~~
  - 证据：self-review 修复 `mcp add --scope project` 会写出跨层重复 MCP id 的风险；`changelog/2026-05-16.md` 添加 02:51 条目。

#### P2.10 实现 context policy 分层

**文件：**

- 新增：`docs/contracts/context-policy.md`
- 修改：`packages/runtime/src/config.ts`
- 修改：`packages/runtime/src/context/` 下相关 context assembly 模块。
- 测试：`tests-node/config-layering.test.ts`
- 测试：`tests-node/write-side-runtime.test.ts`

**步骤：**

- [x] Step 1：定义 `[context_policy]` schema。证据：`packages/runtime/src/config.ts` 增加 `ContextPolicyConfig`、TOML 解析和字段校验；新增 `docs/contracts/context-policy.md`。
  - `max_bytes: number`
  - `max_files: number`
  - `freshness_max_age_seconds: number`
  - `redact_patterns: string[]`
  - `required_sources: string[]`
  - `denied_paths: string[]`
- [x] Step 2：实现 merge rules。证据：`tests-node/config-layering.test.ts` 覆盖保守合并和 malformed schema。
  - `required_sources`、`denied_paths`、`redact_patterns` 取并集。
  - `denied_paths` 优先级最高，命中 required source 时 fail fast。
  - `freshness_max_age_seconds`、`max_bytes`、`max_files` 取更严格值。
  - 必读资料超过 `max_bytes` 或 `max_files` 时 fail fast。
  - explicit overlay 可以临时收紧或增加输入，但不能绕过 denied paths。
- [x] Step 3：`flow run` 创建 packet 前解析最终 policy。证据：`packages/cli/src/commands/flow.ts` 加载 resolved config，`packages/runtime/src/flow/create.ts` 在创建 run 目录前调用 `prepareContextPolicyInput`。
- [x] Step 4：`context.md` 和 `status.json` 记录 resolved policy。证据：`tests-node/flow-context.test.ts` 覆盖 `status.json.resolved_context_policy`、`## Resolved Context Policy` 和 redaction provenance。
  - `status.json.resolved_context_policy`
  - `context.md` 的 `## Resolved Context Policy` 区块。
- [x] Step 5：Studio 展示 run 使用的 context policy 和被拒绝输入。证据：Studio packet summary/API 暴露并展示 active context policy；被拒绝输入在 packet 创建前 fail fast，通过 CLI 错误返回，不生成成功 run。
  - 如果 P1 的 Studio 信息架构尚未完成，先在 CLI JSON/API 中暴露该字段，Studio 展示延后到 P1 配置视图。
- [x] Step 6：运行 targeted tests、`npm test` 和 `git diff --check`。证据：targeted P2.10 套件 60/60 通过；`npm test` 267/267 通过；`git diff --check` 无输出。
- [x] Step 7：review、同步 `changelog/`、commit，建议信息：`feat: layer context policy`。证据：review 发现并修复非数组 policy list 字段的 TypeError 边界，新增红绿测试；`changelog/2026-05-16.md` 记录本段。

#### P2.11 实现 review / release policy 分层

**文件：**

- 新增：`docs/contracts/review-release-policy.md`
- 修改：`packages/runtime/src/config.ts`
- 修改：`packages/runtime/src/release/` 下 release gate 相关模块。
- 修改：`packages/runtime/src/review/` 或 reviewer registry 相关模块。
- 测试：`tests-node/release-check.test.ts`
- 测试：`tests-node/reviewer-registry.test.ts`

**步骤：**

- [x] Step 1：定义项目级 review/release policy。证据：`packages/runtime/src/config.ts` 支持 `[review_policy.<workflow-id>]` 和 `[release_policy.<workflow-id>]`，新增 `docs/contracts/review-release-policy.md`。
  - `[review_policy.<workflow-id>].required_review_profiles: string[]`
  - `[release_policy.<workflow-id>].required_evidence: string[]`
  - `[release_policy.<workflow-id>].needs_decision_risks: string[]`
- [x] Step 2：用户级只保存本机 reviewer agent、aliases 和能力标签。证据：user config 中的 review/release policy fail fast；reviewer registry 只暴露本机 reviewer 的 review-facing capability profiles。
- [x] Step 3：项目级 policy 使用 capability profile，不直接写死个人模型。证据：policy 只接受 `required_review_profiles`，`workflow_defaults` 仍只接受 concrete agent id/list。
  - Capability profile 只用于 review/release policy。
  - `[workflow_defaults.<workflow-id>]` 继续只接受 bare agent id 或 agent id list。
- [x] Step 4：实现 review/release policy 所需的最小 profile 解析。证据：`packages/runtime/src/review/policy.ts` 把 `required_review_profiles` 解析为 concrete reviewer agent ids，无法解析时 run 创建前 fail fast。
  - 基于 P2.0 已完成的配置分层产品化决策，不重新打开 user/project 范围判断。
  - P2.11 只解析 `required_review_profiles` 到 concrete reviewer agent ids。
  - profile 完整管理、model aliases 和用户 preference 放到 P2.13。
  - 如果 profile 无法解析，run 创建 fail fast。
- [x] Step 5：`flow run` 把 project policy 和 user agents 解析成具体 assignment。证据：`tests-node/flow-run.test.ts` 覆盖 policy reviewer 自动补入 `status.review` 和 `stage_assignments.review`。
- [x] Step 6：`release-summary.md` 和 `status.json.resolved_review_release_policy` 记录 policy source layer、skipped gates 和 missing evidence。证据：`tests-node/release-check.test.ts` 覆盖 summary policy section 和 status 文件持久化。
- [x] Step 7：运行 targeted tests、`npm test` 和 `git diff --check`。证据：targeted P2.11 套件 52/52 通过；`npm test` 272/272 通过；`git diff --check` 无输出。
- [x] Step 8：review、同步 `changelog/`、commit，建议信息：`feat: layer review release policy`。证据：review 后收窄 reviewer registry profile 暴露范围，`changelog/2026-05-16.md` 记录本段。

#### P2.12 实现 run defaults / execution policy 分层

**文件：**

- 新增：`docs/contracts/execution-policy.md`
- 修改：`packages/runtime/src/config.ts`
- 修改：`packages/runtime/src/flow/` 下 dispatch/retry 相关模块。
- 修改：`apps/studio/src/packet-browser.ts`
- 测试：`tests-node/flow-dispatch.test.ts`
- 测试：`tests-node/write-side-runtime.test.ts`

**步骤：**

- [x] Step 1：定义 `[run_defaults]` 和 `[execution_policy]`。证据：`packages/runtime/src/config.ts` 增加 run defaults / execution policy schema，新增 `docs/contracts/execution-policy.md`。
  - `[run_defaults]`：`dispatch_timeout_secs`、`adapter_timeout_secs`、`event_page_size`、`retry_attempts`。
  - `[execution_policy]`：`max_fanout_concurrency`、`max_dispatch_timeout_secs`、`max_adapter_timeout_secs`、`max_retry_attempts`、`require_user_gate`、`allow_auto_dispatch`。
- [x] Step 2：实现 merge rules。证据：`tests-node/config-layering.test.ts` 覆盖 soft defaults 覆盖、数字上限取小、`require_user_gate` OR、`allow_auto_dispatch` AND。
  - `run_defaults` 是软偏好，可以被项目默认值或单次 run 参数覆盖。
  - `execution_policy` 是硬红线，单次 run 参数不能突破。
  - 用户级 `execution_policy` 表示本机/个人安全上限。
  - 项目级 `execution_policy` 表示项目安全上限。
  - 数字上限取较小值。
  - `require_user_gate` 任一层为 true 则最终为 true。
  - `allow_auto_dispatch` 任一层为 false 则最终为 false。
  - 最终值必须在 run 创建时固定。
- [x] Step 3：packet 记录 resolved execution policy 和 source layer。证据：`tests-node/flow-run.test.ts` 覆盖 `status.json.resolved_execution_policy` 和 `config_provenance`。
  - `status.json.resolved_execution_policy`
  - `status.json.config_provenance`
- [x] Step 4：dispatch/retry 使用 packet 内 resolved policy，不重新读取当前 config 猜测历史 run。证据：`tests-node/flow-dispatch.test.ts` 覆盖 adapter timeout cap、`allow_auto_dispatch=false` 和 `max_retry_attempts`。
- [x] Step 5：Studio run detail 展示 resolved execution policy。证据：Studio packet summary/API 暴露 `resolved_execution_policy`，UI overview 展示 compact summary。
- [x] Step 6：运行 targeted tests、`npm test` 和 `git diff --check`。证据：targeted P2.12 套件 79/79 通过；`npm test` 277/277 通过；`git diff --check` 无输出。
- [x] Step 7：review、同步 `changelog/`、commit，建议信息：`feat: layer execution policy`。证据：review 后补充 `allow_auto_dispatch=false` 防自动调用测试；`changelog/2026-05-16.md` 记录本段。

#### P2.13 合并 model aliases / capability profiles 到 agent 注册验证

**文件：**

- 修改：`docs/contracts/agent-registration.md`
- 修改：`docs/contracts/config-layering.md`
- 修改：`docs/contracts/review-release-policy.md`
- 修改：`packages/runtime/src/adapters/models.ts`
- 修改：`packages/runtime/src/config.ts`
- 修改：`packages/runtime/src/review/policy.ts`
- 修改：`packages/runtime/src/release/check.ts`
- 修改：`packages/cli/src/commands/agents.ts`
- 测试：`tests-node/agent-registration.test.ts`
- 测试：`tests-node/cli-surface.test.ts`
- 测试：`tests-node/config-layering.test.ts`
- 测试：`tests-node/flow-run.test.ts`

**步骤：**

- [x] Step 1：用户级支持显式 model aliases。证据：`loadConfig` 支持 `[model_aliases.<alias>]`，并拒绝 project config 中的 personal alias section。
  - `[model_aliases.<alias>].adapter`
  - `[model_aliases.<alias>].model`
- [x] Step 2：agent 添加前模型解析优先使用 adapter discovery，再使用用户显式 alias。证据：`resolveKnownAdapterModelWithAliases` 和 `agents add` 测试覆盖 discovery 优先、alias fallback、unsupported discovery fallback。
- [x] Step 3：项目级只声明 capability profile，例如 `reviewer.long_context`，不保存个人模型简称。证据：`loadConfig` 支持 `[capability_profiles.<profile-id>]`，拒绝 user config 中的 project profile，并通过 `StageTypeSchema` 校验 stage。
  - `[capability_profiles.<profile-id>].stage`
  - `[capability_profiles.<profile-id>].required_capabilities`
  - `[capability_profiles.<profile-id>].min_count`
  - stage validation 必须复用同一处 stage type 事实源；不要在 profile 解析里再写死 `plan/execute/review/decide`，以免 P3 增加 `verify` 时二次遗漏。
- [x] Step 4：review/release policy 可以引用 capability profile；workflow defaults 继续只引用 concrete agent id。证据：`flow run` 创建 packet 前把 declared profile 解析成 reviewer assignment；无 preference 且唯一匹配时写入 `profile_resolution_warnings`，多候选仍 fail fast。
  - 用户可用 `[capability_profile_preferences.<profile-id>].agents` 指定本机 agent。
  - 无 preference 且唯一匹配时 warning 后自动选择，并写入 packet。
  - 无 preference 且多候选时 fail fast。
- [x] Step 5：解析失败、模糊 alias、profile 无匹配 agent 都 fail fast。证据：配置未知字段 / invalid stage、模糊 model shorthand、declared profile no match 均有测试覆盖。
- [x] Step 6：运行 targeted tests、`npm test` 和 `git diff --check`。证据：targeted P2.13 套件 77/77 通过；`npm test` 287/287 通过；`git diff --check` 无输出。
- [x] Step 7：review、同步 `changelog/`、commit，建议信息：`feat: resolve agent model aliases`。证据：review 后补充 unsupported discovery alias fallback、unknown key fail fast；`changelog/2026-05-16.md` 记录本段。

#### P2.14 P2 大任务收尾校准

**文件：**

- 修改：`README.md`
- 修改：`index.html`
- 修改：`plan.md`
- 修改：`changelog/YYYY-MM-DD.md`

**步骤：**

- [x] Step 1：重新校准 README。证据：README 当前验证基线更新为 287 tests，并同步 agent 注册默认 id、model alias、readiness probe、`--skip-verify`、配置分层范围、review/release policy 和 execution policy。
  - agent 注册默认 id、model alias、注册前 probe、`--skip-verify` 风险、配置分层范围和当前限制都与实际行为一致。
- [x] Step 2：重新校准根目录 `index.html`。证据：首页更新 P2 done、287 tests、agent 注册示例、CLI 手册、P3 next 和 P2 路线图状态。
  - CLI 手册、agent 注册示例、配置分层说明、review/release policy 和 execution policy 不再描述旧状态。
- [x] Step 3：标记 P2 完成项，补齐证据链接。证据：P2 状态已改为“已完成”，当前下一步改为 P3 Verify Stage Type 与运行时性能 / Fanout 调度。
- [x] Step 4：运行 `npm test` 和 `git diff --check`。证据：`npm test` 287/287 通过；`git diff --check` 无输出。
- [x] Step 5：做 P2 总体 review/release gate，处理 accepted findings。证据：review README/index diff 后未发现需修复的旧状态残留；P2.13 已处理 accepted findings 后提交。
- [x] Step 6：同步 `changelog/`、commit，建议信息：`docs: sync agent registration and config docs`。证据：`changelog/2026-05-16.md` 记录 P2 收尾校准。

### P3. Verify Stage Type 与运行时性能 / Fanout 调度

状态：已完成。

目标：先把 `verify` 作为正式 stage type 补进协议、packet artifact、prompt assembly、capability 校验、CLI/Studio 展示和最小 dispatch 路径，让测试/构建/回归证据不再被挤进 `execute` 或 `review`；再用结构化 timing 确认启动和调用瓶颈，复用 MCP 连接并把 adapter invocation 改成 async spawn；之后在 review/verify/plan/decide fanout stage 内部并行调用 assigned agents，保留 packet 事实源、partial evidence、retry reuse 和 synthesis 确定性。

入口门槛：

- P2 完成后更适合做 P3，因为 `verify` 的能力迁移和后续并行 fanout 都依赖清晰 agent id / capability profile。
- P3.1 必须先固定 `verify` stage contract，尤其是 canonical artifact、prompt 输入、capability opt-in、fanout v1 边界和兼容策略。
- P3.2/P3.3 再分别落 core/runtime 和 workflow/Studio 可见面，避免一个 slice 同时改完整协议栈和 UI。
- P3.4 必须给 config、MCP connect、adapter spawn、first output 和 total runtime 增量埋点，避免凭感觉决定是否需要 daemon。
- P3.5 必须先评估并实现 MCP 连接复用；如果 benchmark 证明收益不足，记录证据后再跳过。

非目标：

- 不支持 execute fanout。
- 不并行不同 workflow stage。
- 不给 current stage 做 worker dispatch。
- 不引入 daemon、queue 或 cancellation tree。
- 不在本阶段新增 `research`、`triage`、`release`、`publish`、`observe` 等 stage type。
- `verify` 不负责做 release verdict；它只产生命令、测试、构建、smoke、回归等验证证据，最终判断仍由 `review`/`decide`/release gate 完成。

#### P3.1 定义 verify stage contract

**文件：**

- 新增：`docs/contracts/verify-stage.md`
- 修改：`docs/contracts/workflow-toml.md`
- 修改：`docs/contracts/packet-layout.md`
- 修改：`docs/contracts/artifacts-toml.md`
- 修改：`docs/contracts/prompt-assembly.md`
- 修改：`docs/contracts/stage-dispatch.md`
- 修改：`docs/contracts/status-json.md`
- 测试：`tests-node/core-contracts.test.ts`

**步骤：**

- [x] Step 1：写 `verify` contract，先固定语义边界。证据：新增 `docs/contracts/verify-stage.md`，定义 `verify` 只产生命令/测试/构建/smoke/回归验证证据，不写 release verdict、不分类 review findings。
  - `verify` 产生命令/测试/构建/smoke/回归验证证据。
  - canonical artifact：`verification.md`，重复 stage 使用 `verification_2.md`、`verification_3.md`。
  - artifact name：`verification`，重复 stage 使用 `verification_<node-id>`。
  - 推荐顺序：`plan -> execute -> verify -> review -> decide`；review 消费 verification evidence，而不是替代 verification。
  - `verify` 不写 release verdict，不接受/拒绝 review finding。
- [x] Step 2：定义 prompt assembly。证据：`verify-stage.md` 和 `prompt-assembly.md` 规定 verify prompt 默认包含 Request、Assignment、Context、Current Plan、Handoff，并要求 durable verification evidence 写入 `verification.md`。
  - 默认包含 Request、Assignment、Context、Current Plan、Handoff。
  - 如果 `verify` 出现在 review 之后，按 ordered prior evidence 机制包含之前 stage 的 artifact。
  - 不把 workspace live state 当作 verification evidence；命令、日志、跳过项和风险必须写入 `verification.md`。
- [x] Step 3：定义 fanout v1 边界。证据：`verify-stage.md` 和 `stage-dispatch.md` 固定 P3.2 只支持 single-agent verify；multi-agent verify 必须 fail fast 并指向 contract。
  - 先支持 single-agent `verify` dispatch。
  - workflow 允许声明多个 verify agents 前，必须先有 per-agent evidence slot 和 aggregate 规则。
  - 多 agent verify fanout 放到 P3.8，与 review fanout 共用 helper；P3.2 遇到多 agent verify 必须 fail fast，错误信息指向未实现的 fanout contract。
- [x] Step 4：定义 capability / compatibility 策略。证据：`verify-stage.md` 规定 `verify` capability 显式 opt-in、旧 packet 可读、workflow defaults / capability profile schema 后续支持 `verify`。
  - `verify` capability 采用显式 opt-in，不自动授予既有 agent。
  - `agents add` 和 config 文档需要说明旧 agent 想跑 `verify` 必须补 capability。
  - `workflow_defaults` 和 capability profile schema 支持 `verify`。
  - 旧 packet 保持可读；新 workflow 使用 `verify` 时必须由当前 schema validator 明确识别。
- [x] Step 5：补 contract doc 存在性测试。证据：`tests-node/core-contracts.test.ts` 覆盖 `verify-stage.md`、`verification.md`、prompt evidence、workflow/artifacts/dispatch contract 关键术语。
- [x] Step 6：运行 `npm run build && node --test dist-node/tests-node/core-contracts.test.js` 和 `git diff --check`。证据：core-contracts targeted 10/10 通过；`git diff --check` 无输出。
- [x] Step 7：review、同步 `changelog/`、commit，建议信息：`docs: define verify stage contract`。证据：review 后修正 stage-dispatch 文案大小写与测试断言；`changelog/2026-05-16.md` 记录本段。

#### P3.2 实现 verify core/runtime stage

**文件：**

- 修改：`packages/core/src/index.ts`
- 修改：`packages/runtime/src/flow/state.ts`
- 修改：`packages/runtime/src/flow/prompt.ts`
- 修改：`packages/runtime/src/flow/dispatch.ts`
- 修改：`packages/runtime/src/flow/create.ts`
- 修改：`packages/runtime/src/config.ts`
- 修改：`packages/cli/src/commands/flow.ts`
- 修改：`packages/cli/src/flags.ts`
- 修改：`packages/cli/src/cli.ts`
- 修改：`packages/cli/src/commands/init.ts`
- 修改：`docs/contracts/config-layering.md`
- 修改：`README.md`
- 修改：`index.html`
- 测试：`tests-node/flow-dispatch.test.ts`
- 测试：`tests-node/flow-run.test.ts`
- 测试：`tests-node/packet-validate.test.ts`
- 测试：`tests-node/config-layering.test.ts`

**步骤：**

- [x] Step 1：实现 core stage type。证据：`packages/core/src/index.ts` 的 `STAGE_TYPES` 增加 `verify`；`tests-node/core-contracts.test.ts` 覆盖 `StageTypeSchema.parse("verify")`、重复 `verify_2` stage nodes 和 packet status validation。
  - `STAGE_TYPES` 增加 `verify`。
  - `deriveStageNodes()` 支持重复 `verify`，但仍保持 `decide` 最多一次且必须最后。
  - status、stage state、artifact manifest validation 覆盖 `verify`。
- [x] Step 2：实现 runtime artifact / dispatch / prompt。证据：`stageArtifactFile()` / `stageArtifactName()` 输出 `verification.md`、`verification_2.md` 和 `verification_verify_2`；`flow run` 支持 `--verify` / `[workflow_defaults].verify`；multi-agent verify fail fast 指向 `docs/contracts/verify-stage.md`。
  - `stageArtifactFile()` 和 `stageArtifactName()` 增加 `verify` 分支。
  - `stageAgents()` 支持通过 `stage_assignments` 按 node id / stage type 解析 `verify` agents。
  - `buildStagePrompt()` 按 contract 注入 verification 所需上下文。
  - `dispatchOneStage()` 支持 single-agent `verify`，并对 multi-agent verify fail fast。
- [x] Step 3：补 runtime tests。证据：`tests-node/flow-run.test.ts`、`tests-node/flow-dispatch.test.ts`、`tests-node/config-layering.test.ts`、`tests-node/packet-validate.test.ts` 覆盖 run 创建、dispatch artifact/events/timing、重复 verify、capability gate、multi-agent fail-fast 和 config/schema 支持。
  - `verify` workflow 可以创建 run。
  - `verify` dispatch 写入 `verification.md`、artifacts manifest、events 和 stage timing。
  - `verify_2` 这类重复 stage 使用正确 artifact 文件名。
  - 未声明 `verify` capability 的 agent dispatch fail fast，错误信息可行动。
  - multi-agent verify 在 P3.2 fail fast，不产生半成品 aggregate artifact。
- [x] Step 4：运行 targeted tests、`npm test` 和 `git diff --check`。证据：targeted `npm run build && node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/flow-run.test.js dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/packet-validate.test.js dist-node/tests-node/config-layering.test.js` 85/85 通过；`npm test` 294/294 通过；`git diff --check` 无输出。
- [x] Step 5：review、同步 `changelog/`、commit，建议信息：`feat: add verify stage runtime`。证据：review 已发现并修复 multi-agent verify 错误文案未指向 contract、CLI/config 文档未同步 `--verify` 的问题；`changelog/2026-05-16.md` 记录本段。

#### P3.3 更新 verify workflow / Studio 可见面

**文件：**

- 修改：`packages/runtime/src/workflow/registry.ts`
- 修改：`apps/studio/src/packet-browser.ts`
- 修改：`apps/studio/src/assets.ts`，仅当前端显示需要显式适配。
- 修改：`docs/contracts/verify-stage.md`
- 测试：`tests-node/workflow-registry.test.ts`
- 测试：`tests-node/studio.test.ts`
- 测试：`tests-node/studio-ui.test.ts`

**步骤：**

- [x] Step 1：更新 workflow registry 和 CLI/Studio 可见面。证据：新增内置 `verified-delivery` workflow，固定 `plan -> execute -> verify -> review -> decide` 和 `verification.md` artifact；README、根目录 `index.html`、`verify-stage.md` 同步可见面。
  - 增加至少一个内置 workflow 或示例 workflow 使用 `verify`。
  - Studio run summary、stage timing、artifact list 能正确显示 `verify` 和 `verification.md`。
  - README / contract docs 只在本 slice 触及到的接口处更新，不做整站营销改写。
- [x] Step 2：补 workflow / Studio tests。证据：`tests-node/workflow-registry.test.ts` 覆盖 `verified-delivery`；`tests-node/studio.test.ts` 覆盖 verify stage timing 和 verification artifact preview；`tests-node/studio-ui.test.ts` 覆盖 catalog workflow、stage timeline 和 artifact list 显示 verify。
- [x] Step 3：运行 targeted tests、`npm test` 和 `git diff --check`。证据：targeted `npm run build && node --test dist-node/tests-node/workflow-registry.test.js dist-node/tests-node/studio.test.js dist-node/tests-node/studio-ui.test.js` 35/35 通过；`npm test` 295/295 通过；`git diff --check` 无输出。
- [x] Step 4：review、同步 `changelog/`、commit，建议信息：`feat: expose verify stage in workflows and studio`。证据：review 已发现并修正命令速查中 `bug-fix [--verify]` 示例不准确、Studio UI fixture workflow 名称和 verify 阶段不一致的问题；`changelog/2026-05-16.md` 已记录本 slice。

#### P3.4 补 runtime timing instrumentation

**文件：**

- 修改：`packages/runtime/src/flow/dispatch.ts`
- 修改：`packages/runtime/src/adapters.ts`
- 修改：`packages/runtime/src/mcp/client.ts`
- 修改：`packages/runtime/src/flow/create.ts`
- 修改：`packages/runtime/src/flow/context-pack.ts`
- 修改：`packages/runtime/src/flow/types.ts`
- 修改：`packages/cli/src/commands/flow.ts`
- 修改：`packages/core/src/index.ts`
- 修改：`docs/contracts/status-json.md`
- 测试：`tests-node/core-contracts.test.ts`
- 测试：`tests-node/flow-context.test.ts`
- 测试：`tests-node/flow-dispatch.test.ts`
- 测试：`tests-node/mcp-client.test.ts`
- 测试：`tests-node/adapter-invocation.test.ts`

**步骤：**

- [x] Step 1：列出需要记录的阶段耗时。证据：`docs/contracts/status-json.md` 明确 `config_load_ms`、`mcp_connect_ms`、`adapter_spawn_ms`、`first_output_ms`、`agent_total_ms`、`total_ms` 的毫秒语义；当前同步 spawn 路径先省略 `first_output_ms`。
  - `config_load_ms`
  - `mcp_connect_ms`
  - `adapter_spawn_ms`
  - `first_output_ms`，只有 async spawn 路径可用时记录。
  - `agent_total_ms`
  - `total_ms`
- [x] Step 2：把 timing 写入事件或 status summary，优先使用结构化 JSON 字段，不做纯文本日志。证据：`status.runtime_timing` 记录 run-level config/MCP/total timing；`status.agent_timing.<stage>.<agent>` 记录 adapter config/spawn/total timing。
- [x] Step 3：CLI human 输出保持简洁，JSON 输出能看到 timing 明细。证据：human `flow status` 未新增文本行；`tests-node/flow-dispatch.test.ts` 覆盖 `flow status --json` 可读取 `runtime_timing` 和 `agent_timing` timing 明细。
- [x] Step 4：补测试覆盖字段存在、单位为毫秒、失败路径仍写入已知阶段耗时。证据：`core-contracts` 覆盖 schema，`adapter-invocation` 覆盖 direct call timing，`mcp-client` 覆盖 connect timing callback，`flow-context` 覆盖 MCP connect 写入 status，`flow-dispatch` 覆盖成功和失败 dispatch timing。
- [x] Step 5：用当前 `agentmesh call --agent mimo` 或 fake command adapter 留一份基线数据。证据：fake command adapter baseline：run `runtime_timing.config_load_ms=2`、`total_ms=2`；agent `adapter_spawn_ms=96`、`agent_total_ms=97`、`total_ms=97`。
- [x] Step 6：运行 targeted timing tests、`npm test` 和 `git diff --check`。证据：targeted `npm run build && node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/adapter-invocation.test.js dist-node/tests-node/mcp-client.test.js dist-node/tests-node/flow-context.test.js dist-node/tests-node/flow-dispatch.test.js` 65/65 通过；`npm test` 297/297 通过；`git diff --check` 无输出。
- [x] Step 7：review、同步 `changelog/`、commit，建议信息：`feat: record runtime timing`。证据：review 已修正 core timing schema helper 命名不准、MCP timing error wrapper 未保留原始错误链的问题；`changelog/2026-05-16.md` 已记录本 slice。

#### P3.5 实现 MCP 连接复用

**文件：**

- 修改：`packages/runtime/src/mcp/client.ts`
- 修改：`packages/runtime/src/flow/context-pack.ts`
- 修改：`packages/runtime/src/flow/types.ts`
- 修改：`packages/core/src/index.ts`
- 修改：`docs/contracts/mcp-client.md`
- 修改：`docs/contracts/status-json.md`
- 测试：`tests-node/core-contracts.test.ts`
- 测试：`tests-node/flow-context.test.ts`
- 测试：`tests-node/mcp-client.test.ts`
- 测试：`tests-node/mcp-resource.test.ts`

**步骤：**

- [x] Step 1：写失败测试：同一 server 的多次 list/read 可以复用一个 active stdio session。证据：`tests-node/mcp-client.test.ts` 新增 cache list+read 复用测试，事件序列只出现一次 initialize。
- [x] Step 2：实现 per-server connection cache，key 至少包含 command、args、env 和 cwd 相关 fingerprint。证据：`createMcpClientCache` / `closeMcpClientCache` 暴露显式 per-invocation cache，cache key 包含 command、args、configured env 和 cwd。
- [x] Step 3：定义失效策略：server error、protocol error、timeout、explicit close 和 process exit 必须从 cache 移除。证据：request failure 会 evict+close cached session；测试用 server exit 连续两次 read 验证 initialize 发生两次。
- [x] Step 4：避免跨 run 泄漏状态；默认只在同一 CLI invocation 内复用，暂不做 daemon 级长驻复用。证据：裸 client 调用仍 per-call close；`flow run` context capture 使用短生命周期 cache 并在 ingest 完成后 close。
- [x] Step 5：记录 `mcp_connect_ms` 和 cache hit/miss，比较 P3.4 基线。证据：`onTiming` 返回 `cache_hit`；context capture 累计 `mcp_cache_hits/misses`；baseline 样本为 miss `mcp_connect_ms=108`、hit `mcp_connect_ms=0`。
- [x] Step 6：运行 MCP targeted tests 和 `git diff --check`。证据：targeted `npm run build && node --test dist-node/tests-node/mcp-client.test.js dist-node/tests-node/mcp-resource.test.js dist-node/tests-node/flow-context.test.js dist-node/tests-node/core-contracts.test.js` 41/41 通过；`git diff --check` 无输出。
- [x] Step 7：review、同步 `changelog/`、commit，建议信息：`feat: reuse mcp client connections`。证据：review 已补上 context capture 的 cache hit/miss status 可见面，并整理 cache key helper 可读性；`changelog/2026-05-16.md` 已记录本 slice。

#### P3.6 增加 async adapter invocation

**文件：**

- 修改：`packages/runtime/src/adapters.ts` 或现有 adapter invocation 模块。
- 修改：`docs/contracts/adapter-invocation.md`
- 修改：`tests-node/adapter-invocation.test.ts`

**步骤：**

- [x] Step 1：写失败测试：async command agent stdout capture。证据：`tests-node/adapter-invocation.test.ts` 覆盖 async stdout capture 写入 output file，并断言 `first_output_ms`。
- [x] Step 2：写失败测试：output file args / stdin / timeout / 非零退出 / spawn failure。证据：同一测试覆盖 output-file arg、stdin prompt、exit code 7、timeout reject 和 missing command spawn failure。
- [x] Step 3：实现 `runAgentCallAsync`，使用 `child_process.spawn()`。证据：`packages/runtime/src/adapters.ts` 新增 async spawn 路径，复用现有 adapter invocation preparation。
- [x] Step 4：保留同步 `runAgentCall` 给非 fanout 路径。证据：`runAgentCall` / `runAgentCallWithTiming` 保持同步实现，已有 sync timing 测试继续通过。
- [x] Step 5：记录 first output 和 total duration，为后续 fanout 提供 per-agent timing。证据：async result timing 记录 `first_output_ms`、`adapter_spawn_ms`、`agent_total_ms`、`total_ms`；无 stdout capture 时省略 `first_output_ms`。
- [x] Step 6：运行 targeted adapter tests。证据：`npm run build && node --test dist-node/tests-node/adapter-invocation.test.js` 9/9 通过。
- [x] Step 7：运行 `git diff --check`。证据：`git diff --check` 无输出。
- [x] Step 8：review、同步 `changelog/`、commit，建议信息：`feat: invoke agents asynchronously`。证据：review 已修复 async output-file write error 没有 reject、timeout 后缺少 SIGKILL 兜底的问题；`changelog/2026-05-16.md` 已记录本 slice。

#### P3.7 增加 async mutation lock 并迁移 dispatch API

**文件：**

- 修改：`packages/runtime/src/packet/lock.ts`
- 修改：`packages/runtime/src/flow/dispatch.ts`
- 修改：`packages/cli/src/commands/flow.ts`
- 修改：`docs/contracts/run-lock.md`
- 测试：`tests-node/flow-dispatch.test.ts`

**步骤：**

- [x] Step 1：添加 `withRunMutationLockAsync` 测试。证据：`tests-node/flow-dispatch.test.ts` 覆盖 awaited success / failure 时 lock 目录存在，并在 resolve / reject 后释放。
- [x] Step 2：实现 async lock，确保 `finally` 释放。证据：`packages/runtime/src/packet/lock.ts` 新增 `withRunMutationLockAsync`，在 `await action()` 外层使用 `finally release()`。
- [x] Step 3：把 `dispatchFlowStage`、`retryFlowStage`、`resumeFlow`、`dispatchRemainingStages`、`dispatchOneStage` 改为 awaitable。证据：runtime dispatch API 返回 `Promise<DispatchResult>` / `Promise<void>`，内部 dispatch 调用使用 `await`。
- [x] Step 4：更新 CLI command 调用。证据：`flow dispatch`、`flow retry`、`flow resume` command 改为 async 并 await runtime API，顶层 CLI `main()` 已通过 `await main()` 等待返回。
- [x] Step 5：运行 flow dispatch targeted tests。证据：`npm run build && node --test dist-node/tests-node/flow-dispatch.test.js` 22/22 通过。
- [x] Step 6：运行 `npm test` 和 `git diff --check`。证据：`npm test` 302/302 通过；`git diff --check` 无输出。
- [x] Step 7：review、同步 `changelog/`、commit，建议信息：`refactor: make flow dispatch async`。证据：review 未发现需修复问题；`changelog/2026-05-16.md` 已记录；提交信息使用 `refactor: make flow dispatch async`。

#### P3.8 实现 review / verify fanout 并行

**文件：**

- 修改：`packages/runtime/src/flow/dispatch.ts`
- 修改：`docs/contracts/stage-dispatch.md`
- 修改：`docs/contracts/status-json.md`
- 修改：`docs/contracts/verify-stage.md`
- 修改：`tests-node/flow-dispatch.test.ts`
- 修改：`tests-node/review-artifacts.test.ts`

**步骤：**

- [x] Step 1：写并发测试：两个 fake reviewer / verifier 等待彼此 marker。证据：`tests-node/flow-dispatch.test.ts` 新增 review/verify marker 互等用例；RED 时 review 顺序执行超时、verify 被 fail-fast 拦截。
- [x] Step 2：实现 `dispatchFanoutAgents` helper。证据：`packages/runtime/src/flow/dispatch.ts` 新增 async fanout helper，先写 prompts，再并行调用 `runAgentCallAsync` 并返回全部 settled 结果。
- [x] Step 3：review fanout 写所有 prompts 后并行启动。证据：review 并发测试断言两个 prompt 都存在后 agent 才等待对方 marker 并输出。
- [x] Step 4：verify fanout 写 per-agent evidence 后生成 canonical `verification.md` 聚合摘要。证据：verify fanout 写 `outputs/verify/<agent>.md` 和 `verification.md`，artifacts 记录 `output_verify_<agent>` 与 `verification`。
- [x] Step 5：所有 reviewer settle 后再刷新 findings；所有 verifier settle 后再生成 verification aggregate。证据：helper 捕获每个 agent 结果；review 在全部结果处理后刷新 raw findings，verify 在全部结果处理后写 aggregate。
- [x] Step 6：失败 reviewer/verifier 写入 partial evidence。证据：review failure 继续保留成功 raw output 与 failure note；verify failure 写 partial aggregate 并保留成功 verifier evidence。
- [x] Step 7：retry 复用成功 reviewer/verifier 输出，只重跑失败/缺失 agent。证据：verify retry 测试确认成功 verifier 计数保持 1，失败 verifier 复跑后 aggregate 改为双 completed。
- [x] Step 8：运行 flow / review artifact targeted tests、`npm test` 和 `git diff --check`。证据：`npm run build && node --test dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/review-artifacts.test.js dist-node/tests-node/core-contracts.test.js` 37/37 通过；`npm test` 305/305 通过；`git diff --check` 无输出。
- [x] Step 9：review、同步 `changelog/`、commit，建议信息：`feat: fan out review and verify agents`。证据：review 修复 verify aggregate event stage metadata；`changelog/2026-05-16.md` 已记录；提交信息使用 `feat: fan out review and verify agents`。

#### P3.9 实现 plan / decide candidate fanout 和 synthesis

**文件：**

- 修改：`packages/runtime/src/flow/dispatch.ts`
- 修改：`docs/contracts/stage-dispatch.md`
- 测试：`tests-node/flow-dispatch.test.ts`、`tests-node/release-check-flow.test.ts`、`tests-node/release-check.test.ts`

**步骤：**

- [x] Step 1：写 plan fanout 并发测试。证据：`plan fanout starts candidate agents concurrently` 使用两个 planner marker 互等；RED 时旧串行 candidate 执行失败。
- [x] Step 2：写 decide fanout 并发测试。证据：`decide fanout starts candidate agents concurrently` 使用两个 decider marker 互等；RED 时旧串行 candidate 执行失败。
- [x] Step 3：确保 synthesis prompt 按 assigned-agent 顺序列候选输出。证据：plan / decide synthesis prompt 均断言 `### *_a` 出现在 `### *_b` 之前。
- [x] Step 4：candidate 失败时不执行 synthesis，保留成功候选。证据：plan candidate failure 后断言没有 `plan.md` / synthesis prompt，同时保留 `planner_a` 成功输出。
- [x] Step 5：synthesis 失败时 retry 只重跑 synthesis。证据：`plan fanout synthesis retry reuses completed candidate outputs` 确认 retry 后 candidate 计数仍为 1，synthesis 计数从 1 到 2。
- [x] Step 6：release verdict 仍只读取 canonical `decision.md`。证据：release-check decide fanout raw candidate 写 `Verdict: not_ready`，synthesized canonical `decision.md` 写 `Verdict: ready`，最终 status 为 `ready`。
- [x] Step 7：运行 flow / release targeted tests、`npm test` 和 `git diff --check`。证据：`npm run build && node --test dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/release-check-flow.test.js dist-node/tests-node/release-check.test.js dist-node/tests-node/core-contracts.test.js` 50/50 通过；`npm test` 308/308 通过；`git diff --check` 无输出。
- [x] Step 8：review、同步 `changelog/`、commit，建议信息：`feat: synthesize plan and decide fanout`。证据：review 未发现需修复问题；`changelog/2026-05-16.md` 已记录；提交信息使用 `feat: synthesize plan and decide fanout`。

#### P3.10 增加 per-agent events、logs 和限流

**文件：**

- 修改：`packages/runtime/src/flow/dispatch.ts`
- 修改：`packages/runtime/src/adapters.ts`
- 修改：`packages/runtime/src/flow/execution-policy.ts`
- 修改：`docs/contracts/adapter-invocation.md`
- 修改：`docs/contracts/execution-policy.md`
- 修改：`docs/contracts/stage-dispatch.md`
- 测试：`tests-node/flow-dispatch.test.ts`

**步骤：**

- [x] Step 1：新增事件：`stage.agent_started`、`stage.agent_completed`、`stage.agent_failed`、`stage.agent_reused`。证据：`tests-node/flow-dispatch.test.ts` 覆盖 started/completed/failed/reused event。
- [x] Step 2：事件 payload 记录 stage、agent、path、exit_code、timed_out、duration_ms。证据：fanout event 测试断言 output path、exit code、timeout 和 duration 字段。
- [x] Step 3：stdout / stderr 非空时写 per-agent log。证据：review fanout 测试断言 `logs/review/<agent>.stdout.log` / `.stderr.log` 不交错，失败 reviewer stderr 也被保留。
- [x] Step 4：从 `status.json.resolved_execution_policy.max_fanout_concurrency` 读取并发上限。证据：`fanout concurrency limit runs candidate agents without overlap` 在 `max_fanout_concurrency = 1` 时两个 planner 分批执行且 dispatch 成功。
  - 该字段由 P2.12 固定到 packet；P3.10 不再新增硬编码内部默认值。
  - 如果 P2.12 尚未完成，P3.10 不得开始。
- [x] Step 5：测试并发限制和 log 不交错。证据：新增并发限制测试、per-agent events/logs 测试、失败 stderr log 测试和 reused event 字段测试。
- [x] Step 6：运行 flow dispatch targeted tests、`npm test` 和 `git diff --check`。证据：`npm run build && node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/flow-dispatch.test.js` 39/39 通过；`npm test` 310/310 通过；`git diff --check` 无输出。
- [x] Step 7：review、同步 `changelog/`、commit，建议信息：`feat: record fanout agent events`。证据：review 未发现需修复问题；`changelog/2026-05-16.md` 已记录；提交信息使用 `feat: record fanout agent events`。

#### P3.11 P3 大任务收尾校准

**文件：**

- 修改：`README.md`
- 修改：`index.html`
- 修改：`plan.md`
- 修改：`changelog/YYYY-MM-DD.md`

**步骤：**

- [x] Step 1：重新校准 README。证据：README 当前验证基线更新为 310 tests，并同步 `verify` stage、runtime timing、MCP 连接复用、async invocation、review/verify/plan/decide fanout、per-agent events/logs 和 `execute` fanout 限制。
  - `verify` stage、runtime timing、MCP 连接复用、async invocation、fanout 并发和当前限制都与实际行为一致。
- [x] Step 2：重新校准根目录 `index.html`。证据：首页更新 P3 done、310 tests、P4 next、verified-delivery 示例、verify/review fanout evidence 和 per-agent events/logs 文案。
  - CLI/Studio 手册展示 `verify`、fanout evidence、per-agent events/logs 和 release/review 边界。
- [x] Step 3：标记 P3 完成项，补齐证据链接。证据：P3 状态已改为“已完成”，当前下一步改为 P4 Studio 桌面版与双渠道分发。
- [x] Step 4：运行 adapter、flow、release targeted tests。证据：`npm run build && node --test dist-node/tests-node/adapter-invocation.test.js dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/release-check.test.js dist-node/tests-node/release-check-flow.test.js` 51/51 通过。
- [x] Step 5：运行 `npm test` 和 `git diff --check`。证据：`npm test` 310/310 通过；`git diff --check` 无输出。
- [x] Step 6：做 P3 总体 review/release gate，处理 accepted findings。证据：review README/index/plan diff 后未发现需修复的旧状态残留；补充首页 Run packet 文案明确包含 verify。
- [x] Step 7：同步 `changelog/`、commit，建议信息：`feat: add verify stage and fanout dispatch`。证据：`changelog/2026-05-16.md` 记录 P3 收尾校准；提交信息使用 `feat: add verify stage and fanout dispatch`。

### P4. Studio 桌面版与双渠道分发

状态：完成。本仓库已完成 desktop host、macOS distribution config、signed/notarized gate、
update metadata smoke、双渠道共存 guardrails 和 smoke evidence；真实 signed/notarized
DMG 仍由具备 Tauri/Rust、Developer ID 和 notarization 凭证的 packaging host 执行。

目标：把产品化后的 Studio 包成可直接安装的 macOS App，同时保留 local web Studio 和 npm/global CLI。最终形态是：macOS 通过 Developer ID 签名、公证的 DMG 安装 `AgentMesh.app`；App 内置自己的 AgentMesh Core/App Server/CLI entrypoint；npm CLI 是独立开发者分发渠道；两者共享 runtime/schema/protocol 代码，但不默认共用同一个物理安装。

入口门槛：

- P1 Studio 产品化完成。
- web Studio 的信息架构和 API shape 已稳定。
- `docs/decisions/studio-shell.md` 的 Final Packaged Shape / Desktop And CLI Coexistence / Final Transport Direction 已作为 P4 约束。
- 现有 run-lock contract 已能保护 CLI packet mutation；P4 App Server mutation 必须复用同一套锁。
- P1.9 已提供稳定 `agentmesh studio` 入口，作为桌面 App 之外的 browser Studio 入口。

非目标：

- 不替换 web Studio。
- 不把 packet/workflow/adapter/release-gate 业务逻辑搬进桌面 host。
- 不新增 cloud/account/sync。
- 不走 Mac App Store；首个打包目标是 macOS DMG，Windows/Linux 另起决策。
- 不让 `AgentMesh.app` 默认调用用户 PATH 里的 npm/Homebrew/source `agentmesh`。
- 不让 entry-agent skill 自动进入 `AgentMesh.app` bundle；外部入口 agent 仍按 shell PATH 解析 `agentmesh`。

最终分发规则：

- `AgentMesh.app` 用签名、公证 DMG 安装到 `/Applications`。
- `AgentMesh.app` 默认启动 app-bundled runtime/CLI；App-originated Studio actions 和 App Server subprocess mutations 不走 PATH lookup。
- npm/global CLI 通过 `npm install -g agentmesh` 安装，`agentmesh studio` 启动 browser Studio。
- 同一机器允许同时存在 `/Applications/AgentMesh.app` 和 PATH-visible `agentmesh`。
- App 可提供 "Install Command Line Tool"，但必须检测 PATH 冲突、提示当前目标，并要求用户确认；优先用 wrapper script 而不是裸 symlink。
- App 更新只更新 app-bundled runtime/UI；npm 更新只更新开发者 CLI。
- 外部 entry-agent skill 调用 PATH 上的 `agentmesh`。如果用户显式把 App CLI 安装到 PATH，skill 才会调用 App 版本。
- 共享 user config、project `.agentmesh/`、packets 和 run locks；跨版本遇到 unsupported newer schema 必须 fail fast 或 read-only，不能覆盖写入。
- App-only preferences 放在 app support directory；只有 CLI 必须观察的设置才进入共享 AgentMesh user config。
- Packaged desktop UI 热路径使用动态 `127.0.0.1` 高位端口 + per-launch token；stdio/Unix socket 只作为 lifecycle/control-plane 选项。

#### P4.1 定义 App Server / bundled runtime 边界

**文件：**

- 修改：`docs/decisions/studio-shell.md`
- 新增：`docs/contracts/app-server.md`
- 修改：`tests-node/core-contracts.test.ts`
- 修改：`tests-node/package-structure.test.ts`
- 可选：`tests-node/studio-app-server-boundary.test.ts`

**步骤：**

- [x] Step 1：把 App Server 的职责写清：服务 Studio UI、启动 app-bundled runtime mutation、动态端口/token、健康检查、优雅关闭。证据：`docs/contracts/app-server.md` 定义 Studio UI、dynamic `127.0.0.1` port、per-launch token、health check、graceful shutdown 和 app-bundled runtime。
- [x] Step 2：明确外部 entry-agent skill 仍按 PATH 调 `agentmesh`，App-originated actions 才使用 app-bundled runtime。证据：contract/decision doc 区分 App-originated actions、terminal usage 和 PATH-visible `agentmesh`。
- [x] Step 3：明确 App Server mutation 必须复用 filesystem run-lock；未知 lock schema 视为 active/blocking。证据：contract/decision doc 规定 App Server mutation 走 CLI/runtime commands，复用 filesystem run-lock，unknown lock schema active/blocking。
- [x] Step 4：明确 unsupported newer packet/config schema fail-fast 或 read-only，禁止覆盖写入。证据：contract `Schema Skew` 规定 mutation fail-fast 或 read-only inspection，禁止无法保留时覆盖写入。
- [x] Step 5：增加结构 guardrail：desktop/App Server 不能绕过 runtime lock 写 packet。证据：`tests-node/package-structure.test.ts` 增加 App Server boundary guardrail，阻止未来 desktop/app-server 直接导入 packet IO 或直接写 packet files。
- [x] Step 6：运行 targeted contract/structure tests 和 `git diff --check`。证据：先看到缺少 `app-server.md` 的 RED；补实现后 `npm run build && node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/package-structure.test.js` 15/15 通过。
- [x] Step 7：review、同步 `changelog/`、commit，建议信息：`docs: define studio app server boundary`。证据：review 未发现需修复问题；`changelog/2026-05-16.md` 记录 P4.1；提交信息使用 `docs: define studio app server boundary`。

#### P4.2 选择 macOS desktop host 和更新方案

**文件：**

- 修改：`docs/decisions/studio-shell.md`
- 新增：`docs/decisions/studio-distribution.md`
- 修改：`tests-node/package-structure.test.ts`

**步骤：**

- [x] Step 1：以 Tauri 2 作为默认候选，校准是否能满足 DMG、Developer ID signing/notarization、auto-update、dynamic localhost + token、app-bundled runtime。证据：`docs/decisions/studio-distribution.md` 选择 Tauri 2，记录 DMG、Developer ID、notarization、signed updates、sidecar app-bundled runtime 和 dynamic App Server 边界。
- [x] Step 2：列出 Electron fallback 条件：强依赖 Chromium API、`node-pty` / native Node modules、或 Tauri sidecar 打包成本被验证为不可接受。证据：decision doc 明确 Electron fallback 只在 Chromium API、`node-pty` / native Node modules、Tauri sidecar packaging 被验证不可接受等条件成立时使用。
- [x] Step 3：选择具体 updater stack、channel policy、失败回滚策略和更新元数据托管方式。证据：选择 `tauri-plugin-updater`、signed update artifacts、GitHub Releases static JSON、stable/beta channel policy 和 manual rollback。
- [x] Step 4：记录首个打包目标仅为 macOS；Windows/Linux 需要独立决策。证据：decision doc 明确 first target 为 macOS DMG，Windows/Linux require separate decisions。
- [x] Step 5：必要时让 Mimo/Gemini 做 review-gate。证据：本 slice 为决策文档与结构测试，无需外部 review-gate；主控 review 未发现需修复问题。
- [x] Step 6：运行 `git diff --check`。证据：`npm run build && node --test dist-node/tests-node/package-structure.test.js` 先 RED 后 6/6 通过；`git diff --check` 无输出。
- [x] Step 7：同步 `changelog/`、commit，建议信息：`docs: choose studio desktop distribution stack`。证据：`changelog/2026-05-16.md` 记录 P4.2；提交信息使用 `docs: choose studio desktop distribution stack`。

#### P4.3 实现 macOS desktop host

**文件：**

- 新增：`apps/studio-desktop/`
- 修改：`package.json`
- 新增：P4.2 选定的桌面 host 配置文件
- 新增：`tests-node/studio-desktop-options.test.ts`
- 修改：`apps/studio/src/server.ts`
- 修改：`tests-node/package-structure.test.ts`

**步骤：**

- [x] Step 1：新增 desktop option parser：默认 workspace、默认动态端口、显式 workspace/port、非法 workspace/port。证据：`apps/studio-desktop/src/options.ts` 和 `tests-node/studio-desktop-options.test.ts` 覆盖默认动态端口、显式 workspace/port/runtime CLI、非法 workspace/port。
- [x] Step 2：desktop host 启动 App Server，拿到动态 `127.0.0.1` port 和 per-launch token。证据：`apps/studio-desktop/src/host.ts` 以 `port=0` 启动 tokenized App Server，测试断言 `serverUrl` 为动态 loopback URL。
- [x] Step 3：desktop WebView 加载 tokenized local URL。证据：desktop host 返回 `webviewUrl = <serverUrl>/?token=<token>`；测试断言该 URL 供 Tauri WebView 加载。
- [x] Step 4：desktop host 不暴露 generic filesystem 或 generic command runner。证据：desktop host 只复用 Studio server endpoints；package-structure guardrail 覆盖 `apps/studio-desktop/src` 不直接导入 runtime packet IO 或直接写 packet files。
- [x] Step 5：App-originated mutation 不查 PATH；调用 app-bundled runtime/CLI entrypoint。证据：`startStudioDesktopHost` 将 `runtimeCliPath` 传入 Studio mutation options；mutation smoke 断言返回 command 使用 app-bundled runtime CLI path。
- [x] Step 6：端口分配或 local network 失败时，UI/host 输出 actionable error。证据：端口占用测试断言错误以 `Unable to start AgentMesh App Server on 127.0.0.1` 开头。
- [x] Step 7：本地 smoke：启动 desktop host，确认能读真实 `.agentmesh/runs` 并执行受控 mutation。证据：desktop host smoke 测试读取真实临时 `.agentmesh/runs`，并通过 tokenized `/api/mutations` 执行 fake bundled CLI mutation。
- [x] Step 8：运行 targeted tests、`npm test` 和 `git diff --check`。证据：`npm run build && node --test dist-node/tests-node/studio-desktop-options.test.js dist-node/tests-node/package-structure.test.js` 12/12 通过；`npm test` 318/318 通过；`git diff --check` 无输出。
- [x] Step 9：review、同步 `changelog/`、commit，建议信息：`feat: add studio desktop host`。证据：review 修复 malformed auth cookie 触发 500 的问题并补回归断言；`changelog/2026-05-16.md` 已记录；提交信息使用 `feat: add studio desktop host`。

#### P4.4 增加 macOS DMG、签名、公证和 app-managed update

**文件：**

- 修改：`package.json`
- 新增：P4.2 选定的 desktop distribution config
- 新增：release/update 文档
- 新增：`apps/studio-desktop/src/distribution-smoke.ts`
- 新增：`tests-node/studio-desktop-distribution.test.ts`
- 修改：`changelog/YYYY-MM-DD.md`

**步骤：**

- [x] Step 1：配置 `AgentMesh.app` bundle id、product name、icons、DMG target。证据：`apps/studio-desktop/src-tauri/tauri.conf.json` 配置 `AgentMesh`、`dev.agentmesh.studio`、`targets=["dmg"]`、icon source 和 macOS entitlements；`apps/studio-desktop/distribution/macos.json` 固定同一分发 manifest。
- [x] Step 2：配置 Developer ID signing 和 notarization 的 CI/本地文档，不把证书或 token 写入仓库。证据：`docs/distribution/studio-macos.md` 记录 `APPLE_*` / `TAURI_SIGNING_*` env-only 签名公证流程；`distribution-smoke` signed 模式缺 env 或 updater pubkey 时 fail fast。
- [x] Step 3：配置 app-managed update 产物：app archive、signature、latest metadata。证据：Tauri config 启用 `createUpdaterArtifacts` 和 updater endpoint；新增 stable/beta `latest.*.darwin-aarch64.example.json`，metadata smoke 校验 `.app.tar.gz` archive URL 和 signature。
- [x] Step 4：确认 app update 同步更新 app-bundled runtime/UI；npm update 仍只影响 global CLI。证据：distribution manifest / docs 声明 `app_managed=true`、`npm_cli_shared_install=false`，`studio-desktop-distribution.test.ts` 覆盖该边界。
- [x] Step 5：构建未签名开发包做本地 smoke。证据：`npm run studio-desktop:package:dev` 通过，校验 build 后的 desktop entrypoint、DMG config、icon、updater artifact config 和 app-managed runtime 输入；本地无 `cargo`，实际 unsigned DMG 命令写入 docs 供 Tauri packaging host 执行。
- [x] Step 6：在有证书环境跑 signed/notarized build smoke。证据：当前环境没有 Developer ID/notarization/updater private key；`node dist-node/apps/studio-desktop/src/distribution-smoke.js --mode signed --dry-run` 通过并列出所需 env，真实 signed/notarized smoke 由证书环境执行 `npm run studio-desktop:package:signed`。
- [x] Step 7：运行 `npm test` 和 `git diff --check`。证据：`npm run build && node --test dist-node/tests-node/studio-desktop-distribution.test.js` 3/3 通过；`npm run studio-desktop:package:dev`、`npm run studio-desktop:update:metadata`、signed dry-run 均通过；`npm test` 321/321 通过；`git diff --check` 无输出。
- [x] Step 8：review、同步 `changelog/`、commit，建议信息：`build: package agentmesh mac app`。证据：review 收窄 dev/metadata smoke，避免无证书环境出现 signed-only warnings；`changelog/2026-05-16.md` 已记录；提交信息使用 `build: package agentmesh mac app`。

#### P4.5 增加双渠道共存 guardrails 和 smoke evidence

**文件：**

- 修改：`tests-node/package-structure.test.ts`
- 新增：`tests-node/studio-distribution-coexistence.test.ts`
- 修改：`packages/runtime/src/packet/io.ts`
- 新增：desktop / Studio smoke 文档
- 修改：`changelog/YYYY-MM-DD.md`

**步骤：**

- [x] Step 1：模拟同时存在 app-bundled CLI 和 PATH CLI，确认 App-originated actions 不走 PATH。证据：`studio-distribution-coexistence.test.ts` 创建 app-bundled CLI 和 PATH sentinel `agentmesh`，desktop mutation command 只使用 `runtimeCliPath`。
- [x] Step 2：模拟 entry-agent skill / terminal PATH 调用，确认仍调用 PATH-visible `agentmesh`。证据：同一测试通过 `execFileSync("agentmesh", ...)` 断言终端/entry-agent 风格调用解析到 PATH-visible command。
- [x] Step 3：模拟 app CLI 与 npm CLI 共享同一个 run，确认 filesystem run-lock 生效。证据：测试先以 `npm-cli-dispatch` 持有 run-lock，再触发 app mutation，App Server 返回 409 且 stderr 指向同一 filesystem run-lock。
- [x] Step 4：模拟 unsupported newer packet/config schema，确认旧 CLI fail-fast 或 read-only，不覆盖写入。证据：新增 unsupported `status.json.schema_version=2` desktop attach mutation 回归；先 RED 为非预期 TypeError，修复 `loadStatus()` schema gate 后 fail-fast，并断言 status/artifact 未被覆盖。
- [x] Step 5：测试 "Install Command Line Tool" 遇到已有 `agentmesh` 时需要确认，不静默覆盖。证据：`docs/distribution/studio-coexistence-smoke.md` 记录检测 PATH target、展示旧/新目标、要求 confirmation、优先 wrapper script；`package-structure.test.ts` 固定该证据。
- [x] Step 6：分别 smoke web Studio、CLI Studio 和 desktop Studio。证据：`npm run build && node --test dist-node/tests-node/studio-cli.test.js dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio-desktop-options.test.js dist-node/tests-node/studio-distribution-coexistence.test.js dist-node/tests-node/package-structure.test.js` 30/30 通过。
- [x] Step 7：记录 smoke evidence。证据：新增 `docs/distribution/studio-coexistence-smoke.md`，记录 app-bundled/PATH/run-lock/schema/Install CLI/web/CLI/desktop smoke evidence。
- [x] Step 8：运行 `npm test` 和 `git diff --check`。证据：`npm test` 326/326 通过；`git diff --check` 无输出。
- [x] Step 9：review、同步 `changelog/`、commit，建议信息：`test: guard studio distribution coexistence`。证据：review 发现 unsupported newer packet mutation 不是预期 schema fail-fast，已补 `loadStatus()` schema gate 和回归；`changelog/2026-05-16.md` 已记录；提交信息使用 `test: guard studio distribution coexistence`。

#### P4.6 P4 大任务收尾校准

**文件：**

- 修改：`README.md`
- 修改：`index.html`
- 修改：`plan.md`
- 修改：`changelog/YYYY-MM-DD.md`

**步骤：**

- [x] Step 1：重新校准 README。证据：README 更新 P4 completed 状态、326 tests、desktop host / distribution smoke、signed/notarized DMG 证书环境限制、PATH-visible 与 app-bundled runtime 边界，并把下一步切到 P5。
  - macOS App、DMG/sign/notarization、app-bundled runtime、`agentmesh studio` browser 入口、PATH 共存和更新策略都与实际行为一致。
- [x] Step 2：重新校准根目录 `index.html`。证据：首页更新 P4 done、326 tests、desktop host / macOS 分发配置 / update metadata / PATH guardrails、Desktop/Web Studio 差异、安装 smoke 和 P5 next。
  - 双渠道分发、Desktop/Web Studio 差异、安装入口、当前限制和 troubleshooting 不再描述旧状态。
- [x] Step 3：标记 P4 完成项，补齐 smoke evidence 和 review 证据链接。证据：P4 状态改为完成并明确 signed/notarized DMG 需要证书环境；P4.3/P4.5 review 修复已记录在各 slice；`docs/distribution/studio-macos.md` 和 `docs/distribution/studio-coexistence-smoke.md` 保留 smoke evidence。
- [x] Step 4：运行 `npm test` 和 `git diff --check`。证据：`npm test` 326/326 通过；`git diff --check` 无输出。
- [x] Step 5：做 P4 总体 review/release gate，处理 accepted findings。证据：review 发现 README/index 仍显示 P3/P4 next/310 tests，已改为 P4 done、326 tests 和 P5 next，并明确真实 signed/notarized DMG 的证书环境限制。
- [x] Step 6：同步 `changelog/`、commit，建议信息：`docs: sync studio desktop distribution docs`。证据：`changelog/2026-05-16.md` 已记录；提交信息使用 `docs: sync studio desktop distribution docs`。

### P5. 公共扩展接口

状态：已完成。

目标：把 AgentMesh 内部已经跑顺的能力，整理成别人可以稳定调用、扩展和集成的边界。它不是“做云端团队版”，也不是先抽象一堆漂亮接口；它只解决一个问题：当 CLI、Studio、Desktop 或第三方工具都需要读写同一套 AgentMesh 数据时，不能让每个入口各自解析 packet、拼路径、猜状态机。

一句话解释：P5 是 **本地 AgentMesh 的扩展层**。它让“别的程序怎么安全地读 AgentMesh、怎么接入新 agent、怎么订阅运行事件”有正式入口。

#### P5.1 明确哪些能力可以公开，哪些继续留在内部

**要解决的问题：**

- Studio 现在需要读 runs、events、agents、workflows。
- CLI 也需要读写这些数据。
- 未来 Desktop 会复用 Studio 的能力。
- 如果再接 MCP server、第三方 adapter、外部脚本，就不能继续让每个模块直接碰 runtime 内部文件结构。

**步骤：**

- [x] Step 1：列出现有 consumer：CLI、Studio、Desktop。证据：`docs/contracts/public-extension-surface.md` 的 Current consumers 明确 CLI、Studio、Desktop 及各自边界。
- [x] Step 2：列出潜在 consumer：MCP server、本地脚本、第三方 adapter、外部 dashboard。证据：contract doc 的 Potential consumers 固定 MCP server、local scripts、third-party adapter、external dashboard，并要求真实 consumer 才能促成 package。
- [x] Step 3：把能力分成三类：证据：contract doc 分为 read-only、controlled write、internal 三类，并列出 workflows/agents/runs/events/artifacts/timing、创建 run/注册 agent/配置更新、状态机/锁/adapter invocation 内部细节。
  - 只读能力：读 workflows、agents、runs、events、artifacts、timing。
  - 受控写能力：创建 run、注册 agent、更新 workflow 配置。
  - 内部能力：状态机推进、锁、日志落盘、adapter 调用细节。
- [x] Step 4：写 `docs/contracts/public-extension-surface.md`，明确第一版只公开什么，不公开什么。证据：P5.1 新增 contract doc；P5.2 promotion 后，该 doc 已更新为 read-only SDK promoted，同时继续禁止 write API/event subscription/MCP server/UI package。
- [x] Step 5：如果没有第二 consumer 真实需要该能力，只写 decision，不创建新 package。证据：P5.1 slice 只写 decision；P5.2 在 Studio/CLI 两个真实 read consumer 下创建 `packages/sdk`，当前 `tests-node/package-structure.test.ts` 已切换为 read-only SDK guardrail。
- [x] Step 6：运行 `git diff --check`。证据：`npm run build && node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/package-structure.test.js` 18/18 通过；`git diff --check` 无输出。
- [x] Step 7：review、同步 `changelog/`、commit，建议信息：`docs: define public extension surface`。证据：review 未发现需修复问题；`changelog/2026-05-16.md` 已记录；提交信息使用 `docs: define public extension surface`。

#### P5.2 先做只读 SDK，不急着开放写入

**要解决的问题：**

外部工具最先需要的是“看见 AgentMesh 正在发生什么”，不是马上改状态。只读 SDK 风险最低，也能避免 Studio / CLI / Desktop 重复写一套 packet 读取逻辑。

**第一版只读 API：**

- `listWorkflows()`：返回已有 workflow 摘要、创建时间、更新时间、最近 run。
- `getWorkflow(id)`：返回 workflow 配置和关联 agent。
- `listAgents()`：返回已注册 agent、adapter、模型、验证状态。
- `listRuns({ page, pageSize })`：分页返回 runs。
- `getRun(id)`：返回 run 详情、时间、状态、当前 stage。
- `listRunEvents(runId, { page, pageSize })`：分页返回事件。
- `listArtifacts(runId)`：返回产物索引，不直接把大文件塞进内存。

**步骤：**

- [x] Step 1：新增或整理 `packages/sdk`，只放稳定 read API。证据：新增 `packages/sdk`，公开 `listWorkflows`、`getWorkflow`、`listAgents`、`listRuns`、`getRun`、`listRunEvents`、`listArtifacts`。
- [x] Step 2：SDK 内部复用 runtime 已有解析逻辑，不让调用方知道 packet 文件布局。证据：SDK 复用 runtime config、workflow registry 和 packet `loadStatus` / `loadEvents` / `loadArtifacts` / `resolveArtifactPath`，并保持只读边界。
- [x] Step 3：Studio 改为通过 SDK 读取数据，作为第一 consumer。证据：`apps/studio/src/packet-browser.ts` 改为 SDK 薄适配层，Studio 继续暴露原有 run/artifact/release evidence shape。
- [x] Step 4：CLI 里只读列表命令逐步改为复用 SDK，作为第二 consumer。证据：`agents list` 走 `listAgents`，`workflows list/show` 走 `listWorkflows` / `getWorkflow`，写命令继续留在 runtime 控制路径。
- [x] Step 5：增加 compatibility tests，保证 packet 格式变化时 SDK 输出仍稳定。证据：新增 `tests-node/sdk-read.test.ts`，覆盖 agents/workflows/runs/events/artifact index 稳定输出和 artifact 内容不进入 index；package/core contract tests 固定 read-only SDK 和 consumer 边界。
- [x] Step 6：运行 `npm test` 和 `git diff --check`。证据：`npm test` 329/329 通过；`git diff --check` 无输出。
- [x] Step 7：review、同步 `changelog/`、commit，建议信息：`feat: add read-only agentmesh sdk`。证据：review/验证发现 `getWorkflow` 在无 config 时不应失败、CLI workflow JSON 需保留 `path`、旧 public surface 测试仍要求 no-new-package，均已修复；`changelog/2026-05-16.md` 已记录。

#### P5.3 再做 adapter 插件接口，但只解决“接入新 agent”

**要解决的问题：**

现在 adapter 是内置的。后面如果用户要接自己的 CLI、内部 agent、公司私有 runner，不应该每次都改 runtime 核心。

**第一版 adapter 插件接口只包含：**

- `id` / `label`：adapter 身份。
- `detect()`：检查本机命令是否存在。
- `resolveModel(input)`：把用户输入的模型简称解析成真实可用模型。
- `probe(config)`：验证该 agent 能不能实际跑通。
- `buildInvocation(request)`：把 AgentMesh 请求转换成该 agent 的命令行调用。
- `parseResult(output)`：把结果转成 AgentMesh 统一 result。

**明确不做：**

- 不开放 runtime 状态机内部写入。
- 不让插件直接写 packet 文件。
- 不让插件绕过 agent 添加前验证。
- 不承诺支持云端 runner。

**步骤：**

- [x] Step 1：先把现有内置 adapter 的共同契约写成 `docs/contracts/adapter-plugin.md`。证据：新增 contract doc，定义 id/label/aliases/capabilities、`detect()`、`resolveModel(input)`、`probe(config)`、`buildInvocation(request)`、`parseResult(output)`。
- [x] Step 2：用 Codex / Claude / Gemini / OpenCode 内置 adapter 反推最小接口。证据：`adapterPluginManifestFromRuntimeAdapter()` 将现有 runtime adapter metadata 投影到 plugin manifest，测试覆盖所有内置 adapter。
- [x] Step 3：增加一个 fixture adapter，只用于 contract tests。证据：`tests-node/adapter-plugin.test.ts` 内定义 fixture adapter，不进入 runtime adapter registry。
- [x] Step 4：通过 fixture adapter 跑完整 add/probe/invoke 流程。证据：fixture 测试覆盖 model resolve、agent config 构建、detect、probe、buildInvocation、真实 fake CLI 执行和 parseResult。
- [x] Step 5：确认第三方 adapter 无法直接访问内部 packet writer。证据：contract doc 明确禁止 packet 写入/runtime state/lock；测试静态断言 `adapters/plugin.ts` 不引用 packet IO writer。
- [x] Step 6：运行 `npm test` 和 `git diff --check`。证据：`npm test` 333/333 通过；`git diff --check` 无输出。
- [x] Step 7：review、同步 `changelog/`、commit，建议信息：`feat: define adapter plugin contract`。证据：本地 review 未发现需修复问题；`changelog/2026-05-16.md` 已记录。

#### P5.4 最后再评估 MCP server 和 UI package

**要解决的问题：**

MCP server 和 UI package 都不是核心目标，它们只是 P5 的可能消费者。必须等 SDK/API 稳定后再做。

**MCP server 的边界：**

- 第一版只读。
- 暴露 workflows、agents、runs、events、artifacts resource。
- 不通过 MCP 直接启动 run。
- 不通过 MCP 修改 workflow / agent 配置。

**UI package 的边界：**

- 只有当 Studio 和 Desktop 出现大量重复组件时才抽。
- 只抽组件，不抽业务协议。
- 不为了抽 UI package 改 Studio 信息架构。

**步骤：**

- [x] Step 1：等 P5.2 只读 SDK 稳定后再判断 MCP server。证据：`docs/decisions/extension-followups.md` 记录 read-only SDK 已稳定，但尚无真实 MCP consumer。
- [x] Step 2：如果要做 MCP，先写 `docs/contracts/mcp-readonly.md`。证据：当前不做 MCP server；decision doc 明确后续若启动 MCP，第一步必须先写 `docs/contracts/mcp-readonly.md`，且只能暴露 workflows/agents/runs/events/artifacts 只读 resources。
- [x] Step 3：等 Studio / Desktop 组件重复明显后再判断 `packages/ui`。证据：decision doc 记录当前 Studio/Desktop 共享 Studio app/server 边界，还没有足够重复组件触发 `packages/ui`。
- [x] Step 4：如果不满足触发条件，继续延期，不创建空壳 package。证据：`tests-node/package-structure.test.ts` 断言不存在 `packages/mcp-server` 和 `packages/ui`，并固定 no empty package 决策。
- [x] Step 5：运行 `git diff --check`。证据：`git diff --check` 无输出。
- [x] Step 6：review、同步 `changelog/`、commit，建议信息：`docs: evaluate extension follow-ups`。证据：review 未发现需修复问题；`changelog/2026-05-16.md` 已记录。

#### P5.5 P5 大任务收尾校准

**文件：**

- 修改：`README.md`
- 修改：`index.html`
- 修改：`plan.md`
- 修改：`changelog/YYYY-MM-DD.md`

**步骤：**

- [x] Step 1：重新校准 README。
  - 证据：README 更新 P5 done、334 tests、只读 SDK、adapter plugin contract、MCP server / `packages/ui` 延后条件、public write SDK 非目标和 signed/notarized DMG packaging host 限制。
- [x] Step 2：重新校准根目录 `index.html`。
  - 证据：首页更新 P5 done、334 tests、只读 SDK、adapter plugin contract、extension follow-up 延期决策和 Later 触发条件，不再把 P5 描述为 next。
- [x] Step 3：标记 P5 完成项，补齐 evidence 和 review 证据链接。
  - 证据：P5 状态改为“已完成”；P5.1 证据解释 decision-only 到 P5.2 SDK promotion 的事实变化；当前下一步改为按真实 consumer 触发后续扩展。
- [x] Step 4：运行 `npm test` 和 `git diff --check`。
  - 证据：`npm test` 334/334 通过；`git diff --check` 无输出。
- [x] Step 5：做 P5 总体 review/release gate，处理 accepted findings。
  - 证据：review/release gate 发现 `plan.md` 顶部仍把 Public SDK 作为后续扩展、README/index 测试数仍是 333，已改为 public write SDK follow-up 和 334 tests；历史 P4 326 证据保留。
- [x] Step 6：同步 `changelog/`、commit，建议信息：`docs: sync extension surface docs`。
  - 证据：`changelog/2026-05-16.md` 已追加 P5 收尾记录；提交信息使用 `docs: sync extension surface docs`。

## 非目标

- 不做通用 AI chat product。
- 不做 IDE replacement。
- 本地协议稳定前，不优先做 remote orchestration。
- 不让 cloud storage 成为 primary packet source of truth。
- 不让 SQLite 成为 canonical workflow state。
- AgentMesh config/workflow 不引入 YAML。
- Packet artifact rendering 不使用 MDX。
- 不把 business protocol logic 移进 Rust。
- 不为 CLI、Studio 和 cloud 创建分裂的 protocol models。
- 不自动写 hidden memory。
- 不同步或代理各 host agent 的 live private chat context。
- 不复制 orphan branch / double worktree 机制，除非有具体本地 workflow 证明它必要。

## 当前下一步

当前下一步是 **按真实 consumer 触发后续扩展**。

P5 公共扩展接口已完成并进入文档事实源；后续如果要做 MCP server，先写只读 contract；如果要抽 `packages/ui`，先证明 Studio/Desktop 组件重复明显。继续遵守每个 slice 的 checkpoint：实现、验证、review、处理 accepted findings、同步 changelog、commit。
