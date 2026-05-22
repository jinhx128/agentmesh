# AgentMesh Monorepo And Studio 技术计划

状态：当前主计划，已归档旧版 Plan C
日期：2026-05-17
决策级别：一步到位执行计划。目标是一套 monorepo 架构同时支撑 CLI、Desktop DMG、Studio Web、AI tool skills；执行可以分 slice，但每个 slice 都向最终架构收敛，不保留过渡双轨方案。

旧版归档：

- `docs/archive/plan-before-monorepo-2026-05-17.md`

外部审查来源：

- Cursor：`.agentmesh/calls/call-2026-05-17T14-50-01-389Z-ec86eafa/output.md`
- Claude 4.7：`.agentmesh/calls/call-2026-05-17T14-50-01-389Z-af9d4bda/output.md`
- Gemini：`.agentmesh/calls/call-2026-05-17T14-50-01-389Z-3277adcb/output.md`
- Cursor 复审：`.agentmesh/calls/call-2026-05-17T15-45-36-399Z-e612a0b8/output.md`
- Claude 4.7 复审：`.agentmesh/calls/call-2026-05-17T15-45-36-888Z-bd261c1b/output.md`
- Gemini 复审：`.agentmesh/calls/call-2026-05-17T15-45-36-888Z-6d4e65ce/output.md`

## 0. Review Must Fix 可追溯矩阵

这张表是 P0.2 的执行依据。后续每轮外审新增 Must Fix 时，必须补到这里，并落到具体章节、slice 和验证门禁，不能只停留在聊天记录或 review 输出里。

| 来源 | 问题 | 已落点 | 验证 / 门禁 |
| --- | --- | --- | --- |
| Cursor 首审 | App Server 和 CLI 不得双写。 | `4.2`、`P2.3` | CLI/App Server mutation 测试；生产写路径不得出现 `app-server -> cli -> runtime`。 |
| Cursor 首审 | `core` 必须是无 Node side effect 的纯边界。 | `4.1`、`P1.3` | 边界检查脚本禁止 `core` import Node side-effect 模块。 |
| Cursor 首审 | workspace/build 拓扑要先成立再拆包。 | `4.3`、`P1.2`、`P1.4` | `npm run build:node`、`npm run build:studio-frontend`、`npm test`。 |
| Cursor 复审 | `@agentmesh/sdk` 稳定公共面与 runtime 内部面要分清。 | `4.8`、`P1.3`、`P1.4` | 前端和内部集成消费者不得 runtime import `@agentmesh/runtime`；SDK exports 有文档和类型门禁。 |
| Claude 4.7 首审 | 包边界要工程强制，不只是文档约定。 | `4.1`、`P1.3` | project references / lint / import-boundary 检查必须通过。 |
| Claude 4.7 首审 | CLI/App Server artifact 契约要明确，不能依赖 PATH。 | `4.2`、`P2.1`、`P2.3`、`P3.1` | App Server/Desktop 不使用 CLI artifact 作为写路径；不得 PATH fallback。 |
| Claude 4.7 首审 | `@agentmesh/*` 发布形态要真实可验。 | `4.3`、`P1.4` | 内部 packages 私有、CLI 可安装产物、Desktop bundle 都必须有 build/pack 验证。 |
| Gemini 首审 | App Server 不能靠 spawn CLI。 | `4.2`、`P2.3` | P2.3 结束时 production mutation 只走 runtime 程序化 API。 |
| Gemini 首审 | runtime 不得 `process.exit()` 或硬写 stdout。 | `4.1`、`P1.3`、`P2.3` | runtime API 返回结构化结果，CLI 负责 exit code/terminal 输出。 |
| Gemini 首审 | Desktop token 不得进入 argv。 | `4.4`、`P3.2` | 进程参数检查无 token；Host/Origin/CORS/未授权测试通过。 |
| Cursor/Claude 复审 | P1.0 默认 React assets 路径后续拆到 `apps/studio-web` 时不能丢。 | `4.7`、`P1.0`、`P2.2` | `agentmesh studio` 在拆包前后都默认服务 React UI 和 `/api/calls`。 |
| Cursor/Claude 复审 | P1.0 和 P1.1 互不依赖，不能让外审修复阻塞 Web 入口修复。 | `P1` | P1.0/P1.1 均只依赖 P0；P1.2 依赖二者完成。 |
| Gemini 复审 | P1.0 验证要显式包含 frontend build。 | `P1.0`、`7` | `npm run build:studio-frontend` 必须通过。 |
| Claude/Gemini 复审 | `--prompt-file` 回归和回滚策略要写进风险。 | `4.6`、`P1.1`、`8` | adapter invocation 测试；修复前不满足 AgentMesh 外审通过门禁。 |
| Codex 自审 | P2.1 不能先留下 App Server spawn CLI，再等 P2.3 修。 | `P2.1`、`P2.3` | P2.1 完成时已直连 runtime；P2.3 只做发布门禁和禁止项复核。 |
| Codex 自审 | P1.0 是用户可见入口变化，不能只自审。 | `P1.0` | P1.0 完成前必须外审。 |
| Codex 自审 | CLI tarball 必须在 clean env 证明可安装可运行。 | `P1.4`、`P5.1` | `npm pack`、clean install smoke、`agentmesh --help/doctor/skill show`。 |
| 用户决策 2026-05-18 | 当前只有一个 packet 格式，代码、测试 helper、fixture 和活跃文档都不要再搞 `v1`/`v2` 命名或双版本策略。 | `4.9`、`P1.5` | active surface 扫描不得再出现 `packet v2`、`packetStatusV2`、`No v1 migration`、`schema version 2` 等旧口径；保留的 `schema_version` 只能作为内部机器校验字段。 |

## 1. 背景

- 当前现状：
  - 仓库已有 `packages/core`、`packages/runtime`、`packages/sdk`、`packages/cli`。
  - 仓库已有 `apps/studio` 和 `apps/studio-desktop`。
  - `apps/studio` 当前同时包含 Node HTTP server、Studio API、前端源码和 Vite 配置。
  - `apps/studio-desktop` 当前已存在 Tauri 2 目录、sidecar bundle、distribution smoke 相关文件。
  - 根 `package.json` 当前 workspace 仍主要覆盖 `packages/*`，`apps/*` 还没有作为独立 workspace 产品包建模。
  - 当前 `@agentmesh/*` 包名更多是 monorepo 内部形态，CLI/DMG 还需要形成可验证的安装产物。
- 问题来源：
  - AgentMesh 需要同时支持 CLI 安装、内部团队 Desktop DMG 安装、Studio 图形界面和 AI 工具 skill 入口。
  - 用户希望“一步到位”的最终形态，但实现必须切片推进，不能一次性重写所有边界。
  - 当前 `agentmesh studio` / `npm run agentmesh -- studio` 在已有 React build assets 时仍可能回退到旧 HTML，导致本地 Web Studio 看不到最新 `Runs / Calls / 配置` 入口；源码开发调试不应该依赖手写 Node 脚本传 `assetDir`。
  - 当前发现 `agentmesh call --prompt-file` 对部分 provider adapter 没有稳定传成实际 prompt 文本，Cursor、Claude、Gemini 首次外审调用都暴露过空输入或缺 prompt 问题；后续外审依赖此能力，必须单独修复。
- 相关上下文：
  - Studio 最终栈：Tauri 2 + Node App Server + React/Vite + TypeScript。
  - Desktop DMG 内置 app-bundled runtime，不依赖全局 `agentmesh`。
  - CLI 可单独安装，并被 Codex/Cursor/Gemini/OpenCode/Copilot/Claude 的 skill 调用。
  - 三方 review 均认可 monorepo 方向，但要求先强制包边界和发布形态，避免分层只停留在文档里。
- 计划维护：
  - 本文件是当前唯一执行计划。
  - 旧计划只作为归档证据，不再并行维护。
  - 执行时一次推进一个 slice；每个 slice 必须完成实现、验证、审查、日志同步和 commit 后，才能进入下一个 slice。
  - 完成项必须把 checklist 标为 `[x]`，任务文本加删除线，并写进度记录、证据、审查结论、日志和 commit。

## 2. 目的

- 要达成：
  - 把 AgentMesh 整理成边界清晰、可发布、可测试的 monorepo，支撑 CLI、Desktop、Studio Web、Skill 四类入口。
- 成功标准：
  - `core`、`runtime`、`sdk`、`cli`、`app-server`、`skills`、`studio-web`、`studio-desktop` 职责清楚。
  - 跨包 import 使用 `@agentmesh/*` 包名或明确的 type-only contract，不再依赖脆弱的相对路径穿透。
  - Desktop 不通过 `PATH` 调用全局 `agentmesh`。
  - CLI 和 App Server 都作为薄入口调用 `runtime` 程序化 API；不保留双写路径。
  - `agentmesh studio` 默认打开最新 React Web Studio；构建产物存在时不得静默回退旧页面。
  - CLI channel 和 Desktop DMG channel 可以同时安装，靠 compatibility、lock、动态端口和 token 隔离避免冲突。
  - 关键边界有自动化门禁：构建、测试、依赖方向、发行产物、Desktop smoke。
- 入口门槛：
  - Node 版本保持项目当前要求：`>=22`。
  - Tauri 2 作为 Desktop shell。
  - React + TypeScript + Vite 作为 Studio Web 目标栈。
  - 内部团队 DMG 允许第一阶段 unsigned macOS DMG；Developer ID 签名和 notarization 暂不作为第一阶段门槛。
- 不解决：
  - 不在本计划内做公共外发、自动更新、商店分发、Windows/Linux 完整发布。
  - 不在第一阶段引入 React Flow、Monaco、xterm.js、Zustand 等重型 UI 依赖。
  - 不把 Tauri/Rust 变成 AgentMesh 业务逻辑层。

## 3. 最终目录结构

目标结构：

```text
agentmesh/
  package.json
  tsconfig.json

  packages/
    core/
      src/
      package.json
      tsconfig.json

    runtime/
      src/
      package.json
      tsconfig.json

    sdk/
      src/
      package.json
      tsconfig.json

    cli/
      src/
      package.json
      tsconfig.json

    app-server/
      src/
      package.json
      tsconfig.json

    skills/
      src/
      templates/
      package.json
      tsconfig.json

  apps/
    studio-web/
      src/
      index.html
      vite.config.ts
      package.json
      tsconfig.json

    studio-desktop/
      src/
      src-tauri/
      package.json
      tsconfig.json
```

依赖方向：

```text
core
  ↑
runtime
  ↑
sdk

core + runtime
  ↑
cli

core + runtime
  ↑
app-server
  ↑
studio-web

studio-desktop
  ├─ bundles app-server build artifact
  ├─ bundles runtime build artifact used by app-server
  └─ bundles studio-web built assets
```

原则：

- 业务逻辑只在 `runtime`。
- `cli` 和 `app-server` 是平级入口，最终都调用 `runtime` 程序化 API。
- `studio-web` 只调用 App Server API，不直接读写 `.agentmesh/`。
- `studio-desktop` 只负责窗口、sidecar lifecycle、bootstrap、DMG，不实现 packet/workflow/review/release/agent lifecycle 业务。
- `studio-desktop` 不内置也不调用 CLI artifact 作为 Studio 功能路径；Desktop 只启动 app-bundled App Server，App Server 只调用 runtime。
- `skills` 只负责生成和验证 AI 工具入口文档，不拥有 runtime 行为。

## 4. 硬性架构规则

### 4.1 包边界

- `packages/core`：
  - 只放协议、schema、类型、版本常量、纯函数。
  - 禁止导入 `node:fs`、`node:child_process`、`node:process`、`node:http`。
  - 禁止读写磁盘、spawn 子进程、访问环境变量。
- `packages/runtime`：
  - 负责 packet IO、workflow、review gate、calls、locks、agent lifecycle、provider readiness、compatibility。
  - 禁止 `process.exit()`。
  - 禁止直接把业务结果写死到 stdout/stderr；应返回结构化结果、抛出 typed error 或事件。
  - 可以读写文件和调用 provider CLI，但必须通过统一 adapter 和 lock/compat 层。
- `packages/cli`：
  - 只负责参数解析、终端输出、exit code。
  - 不拥有业务规则。
  - 不被 App Server 当成 mutation 入口。
- `packages/app-server`：
  - 负责本地 HTTP API、auth、workspace session、API shape、错误码映射。
  - 通过 `runtime` 程序化 API 做读写。
  - 禁止 spawn `agentmesh` CLI；需要复用的能力必须先抽成 runtime 程序化 API。
- `apps/studio-web`：
  - 运行时代码不得 import Node-only package。
  - 只能通过 HTTP API 访问 workspace。
  - 如需共享类型，只能 type-only import `core` 或 `app-server` 的 contract 类型。
- `apps/studio-desktop`：
  - 不通过 `PATH` resolve 全局 `agentmesh`。
  - 必须用 app-bundled sidecar/runtime。
  - provider CLI discovery 另走 provider resolver，不混同 AgentMesh 自身 CLI。

### 4.2 写路径

- 最终唯一写内核是 `packages/runtime`。
- CLI 写操作：`cli -> runtime`。
- Studio 写操作：`studio-web -> app-server -> runtime`。
- Desktop 写操作：`Tauri -> sidecar app-server -> runtime`。
- 禁止 `app-server -> cli -> runtime` 写路径。
- 禁止通过 app-bundled CLI artifact 复用 mutation 逻辑。
- 如现有能力只存在于 CLI 层，必须先抽到 `runtime` 程序化 API，再由 CLI 和 App Server 分别调用。
- P2.3 只有在生产 App Server 代码完全没有 `agentmesh` CLI spawn 写路径时才能关闭。

### 4.3 发布形态

- `packages/core`、`packages/runtime`、`packages/sdk`、`packages/app-server`、`packages/skills` 作为 monorepo internal packages，默认 `private: true`，不直接对外 npm 发布。
- 内部 packages 仍必须有真实工程边界：
  - 每包独立 `tsconfig.json`。
  - 编译到 `dist/` 或被明确的 bundle 构建消费。
  - `exports` 指向可验证的 JS 和 `.d.ts`。
  - workspace 内 import 不依赖源码相对路径穿透。
- CLI channel 是真实可安装产物：
  - `agentmesh` CLI package 或 bundled CLI tarball 必须包含 runtime 所需代码和 skill 模板。
  - `bin` 指向可执行 JS。
  - `npm pack --dry-run` 必须可验证安装内容。
- Desktop channel 是真实 DMG 产物：
  - bundle app-server/runtime/studio-web 构建产物。
  - 不依赖全局 CLI 或源码目录。
  - package smoke 必须可验证。

### 4.4 Desktop 安全

- Desktop App Server 绑定 `127.0.0.1`，禁止 LAN 暴露。
- 每次启动使用动态端口和 per-launch token。
- token 不通过长期 URL query 传递。
- token 不通过 argv 传给 sidecar，避免被 `ps` 看到。
- 最终 token 链路固定为：Tauri 生成 per-launch token，通过 sidecar stdin 一次性握手交给 App Server；Tauri 使用 native cookie store 或等价 WebView 原生能力预置 `HttpOnly; SameSite=Strict` cookie；WebView 只打开无 query token 的 `http://127.0.0.1:<port>/`。
- env 不作为最终 token 传递方案。
- App Server 必须校验 Host/Origin/CORS。
- 旧 tab、错误 origin、缺 token、过期 token 必须明确拒绝。

### 4.5 并发、兼容和 UI 降级

- `.agentmesh/compatibility.json` 管 workspace schema 和 runtime 版本兼容。
- `.agentmesh/locks/*` 管写操作互斥。
- App Server 遇到锁冲突应返回明确状态，例如 `423 Locked` 或固定 error code。
- Studio Web 必须显示：
  - 哪个入口或进程持有锁。
  - 是否可重试。
  - 下一次刷新或轮询状态。
- Studio Settings/About 必须显示：
  - Desktop bundled runtime version。
  - Workspace last writer runtime version。
  - Last writer entrypoint。
  - 不兼容时的升级或只读提示。

### 4.6 Direct Call Prompt 输入契约

- `agentmesh call` 的 `--prompt`、`--prompt-file` 和未来 stdin 输入必须先归一化为同一份 prompt text，再进入 adapter invocation。
- Provider adapter 不得只收到 prompt file path，除非该 provider 的官方 CLI 明确支持文件参数且对应 agent config 声明了 `prompt_file_arg`。
- 对不支持 prompt file 参数的 provider，runtime 必须把文件内容传给 `prompt_arg` 或 stdin，而不是把路径追加到命令末尾。
- Call record 仍必须保留 `prompt_source`、`prompt_ref`、hash、redaction state 等证据，不能因为归一化输入而丢失文件来源。
- `--prompt-file` 回归验证必须覆盖 Cursor、Claude、Gemini 这类 AI CLI adapter 的 adapter-level invocation 测试；能跑真实 provider smoke 时再补 live smoke。
- P1.1 是外审稳定性的前置门禁；修复前不把 AgentMesh 外审作为通过门禁，`--prompt` 内联调用只能作为辅助参考，不能写进最终执行方案。

### 4.7 Web Studio React Assets 入口契约

- `agentmesh studio` 是本地 Web Studio 的主入口；源码开发者不应该手写 Node 脚本传 `assetDir` 才能看到最新 React UI。
- 当 `dist-node/apps/studio-web/frontend/index.html` 存在时，CLI Studio 入口必须默认把该目录作为 App Server `assetDir`。
- `/` 必须优先服务 Vite-built React `index.html`；`/assets/*` 必须服务对应 hashed assets；API 路由仍由 App Server 接管。
- 不保留旧 `STUDIO_HTML` 作为默认页面；built assets 缺失时应返回明确错误和修复命令，不静默降级。
- 本地快速验证命令目标态：
  - `npm run agentmesh -- studio --port 4777`
  - 打开后能看到 `Runs / Calls / 配置`，Calls tab 能读取 `/api/calls`。
  - 前端改动后执行 `npm run build:studio-frontend`，刷新页面即可看到最新 UI。

### 4.8 SDK 稳定面与 runtime 非公共 API

- `@agentmesh/sdk` 是面向 workspace 内 TypeScript 消费者、Studio Web type-only contract 和未来内部集成方的稳定公共面。
- `@agentmesh/runtime` 是内部实现面，默认不承诺外部稳定 API；只有被明确提升到 SDK 或 app-server contract 的类型/函数才算公共 API。
- 浏览器侧、Studio Web 和第三方代码不得 runtime import `@agentmesh/runtime`。
- SDK exports 必须可文档化、可类型检查、可 semver 管理；当前作为 workspace 内稳定 contract，不对外 npm 发布。
- P1.3/P1.4 必须验证 SDK 公共面、runtime 内部面、frontend import 边界和 package exports 一致。

### 4.9 Packet schema 覆盖策略

- 当前 run packet 的 `status.json` schema 是唯一现行格式；不要把它包装成一个面向用户的 `v1` / `v2` 版本化迁移项目。
- 代码事实源是 `packages/core/src/index.ts` 的 `CURRENT_PACKET_SCHEMA_VERSION`；其中的数字只作为内部机器校验字段，不作为产品名、测试 helper 名、fixture 名或文档口径对外暴露。
- 执行时要把当前 packet schema 与全局当前 schema 对齐：优先让 `CURRENT_PACKET_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION`，active workflow recipe 的 `compatible_packet_schema_versions` 只声明当前常量值。
- 现行格式用 `stage_nodes`、node-id keyed `stage_assignments`、`stage_invocations`、`stage_failure_policies`、`stage_fallbacks`、`stage_attempts` 和 provenance 作为运行事实源。
- 不做旧 packet 迁移、不做双格式兼容；旧 run 不兼容时直接视为可丢弃历史，重新创建或覆盖生成新的 run packet。
- 代码、测试和活跃文档不得使用 `packet v2`、`packetStatusV2`、`No v1 migration`、`v1-to-v2` 这类命名；历史 review / archive 可以保留原始证据，但 active surface 必须统一成“current packet schema / 当前 packet 格式”。
- Active workflow recipe 必须匹配当前 packet schema 常量；如果 active docs/examples 仍声明旧兼容值，直接改到当前值，不提供迁移分支。

## 5. 安装和运行形态

### 5.1 CLI channel

- 产物：`agentmesh` 命令。
- 安装方式：
  - source install。
  - `npm pack` tarball。
  - private npm registry。
- 用途：
  - 终端直接使用。
  - AI 工具 skill 调用。
  - CI 或脚本场景。
- 不依赖：
  - `AgentMesh.app`。
  - Desktop sidecar。

### 5.2 Desktop channel

- 产物：`AgentMesh.app` 和内部团队 DMG。
- 内置：
  - app-server sidecar。
  - runtime build artifact。
  - studio-web built assets。
  - 必要的 compatibility/readiness 代码。
- 用途：
  - 打开 Studio 图形界面。
  - 选择 workspace。
  - 查看 runs、calls、catalog、agents、settings。
  - 执行允许的 agent lifecycle 和 workflow 操作。
- 不依赖：
  - 全局 `agentmesh`。
  - shell PATH。

### 5.3 Skill channel

- 产物：
  - 默认共享项目 skill：`.agents/skills/agentmesh/SKILL.md`。
  - Claude 项目 skill：`.claude/skills/agentmesh/SKILL.md`。
- 用途：
  - 教 Codex/Cursor/Gemini/OpenCode/Copilot/Claude 如何调用本地 `agentmesh` CLI。
- 依赖：
  - 用户已安装 CLI channel。
- 不依赖：
  - Desktop DMG。

### 5.4 共存关系

- CLI 和 Desktop 可以同时安装。
- 两者共享 workspace 的 `.agentmesh/` 数据合同，不共享进程所有权。
- 两者可以是不同 runtime 版本；写入前必须做 compatibility check。
- Desktop 不调用全局 CLI。
- CLI 不调用 `/Applications/AgentMesh.app`。

## 6. 完整计划

### P0. 归档与边界冻结

- [x] ~~P0 阶段完成门禁（仅在 `P0.Z` 完成审查、日志和 commit 后勾选）~~
- 阶段目标：把旧计划归档，冻结新的 monorepo 边界、review 结论和执行门禁。
- 阶段门禁：完成 P0.1、P0.2、P0.Z。

- [x] ~~P0.1 归档旧计划并替换主计划~~
  - Slice：`P0.1`
  - 依赖：无。
  - 文件：
    - 新增：`docs/archive/plan-before-monorepo-2026-05-17.md`
    - 修改：`plan.md`
  - 目标：旧版 Plan C 不再作为主计划；根目录 `plan.md` 变成 monorepo/studio 当前执行计划。
  - 动作：
    - 原样复制旧 `plan.md` 到归档文件。
    - 清空并重写根目录 `plan.md`。
    - 写入三方 review 的已接受结论。
  - 产出：新的 `plan.md` 和归档文件。
  - 验证：
    - `test -s docs/archive/plan-before-monorepo-2026-05-17.md`
    - `test -s plan.md`
    - `git diff --check -- plan.md docs/archive/plan-before-monorepo-2026-05-17.md`
  - 审查方式：自审。
  - 审查判定依据：本 slice 只改文档，不改代码行为；验证可覆盖归档存在性和 Markdown diff 基本健康。
  - 外审执行：不适用。
  - 外审失败策略：不适用。
  - 证据：命令输出、diff 摘要。
  - 进度记录：状态：已完成；完成时间：2026-05-17；验证：归档文件非空、新 `plan.md` 非空、`git diff --check -- plan.md docs/archive/plan-before-monorepo-2026-05-17.md` 通过；审查结论：自审通过；日志：未单独同步；commit：`c331c66 docs(plan): reset monorepo execution plan`；下一步：`P0.2`。
  - 收尾：验证通过后，同步日志并提交。
  - 提交：`docs(plan): reset monorepo execution plan`

- [x] ~~P0.2 建立 review 可追溯矩阵和边界门禁清单~~
  - Slice：`P0.2`
  - 依赖：`P0.1`
  - 文件：
    - `plan.md`
    - 新增：`docs/architecture/package-boundaries.md`
  - 目标：把 review 提到的 Must Fix 变成可追溯、可检查、可执行的门禁。
  - 动作：
    - 维护 `Review Must Fix 可追溯矩阵`，每条 Must Fix 必须有章节、slice 和验证门禁。
    - 明确 `core` 禁止 Node side effect。
    - 明确 App Server 和 CLI 的唯一写路径。
    - 明确 `@agentmesh/*` 的真实发布形态要求。
    - 明确 `@agentmesh/sdk` 稳定公共面和 `@agentmesh/runtime` 内部面。
    - 明确 Desktop token 和 sidecar 安全要求。
    - 列出 P1 必须新增的静态边界检查项。
  - 产出：review 可追溯矩阵和边界门禁清单。
  - 验证：人工检查 `Review Must Fix 可追溯矩阵` 的所有来源行都有章节、slice 和验证门禁；不得存在孤儿 Must Fix 或只停留在聊天记录里的决策。
  - 审查方式：自审。
  - 审查判定依据：仍为计划整理，不改代码行为。
  - 外审执行：不适用。
  - 外审失败策略：不适用。
  - 证据：三份 review 路径和本计划硬性规则。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：人工检查 `Review Must Fix 可追溯矩阵` 所有来源行均已有章节、slice 和验证门禁，新增 `docs/architecture/package-boundaries.md` 将 Must Fix 落为可执行 gate；审查结论：自审通过，P0.2 只整理计划和架构门禁，不改运行行为；日志：`changelog/2026-05-18.md` 追加 P0 收尾记录；commit：`docs(plan): finalize monorepo boundary gates`；下一步：`P0.Z`。
  - 收尾：同步日志并提交。
  - 提交：`docs(plan): define monorepo boundary gates`

- [x] ~~P0.Z 阶段收尾校准~~
  - Slice：`P0.Z`
  - 目标：确认主计划、归档、review 证据和当前下一步一致。
  - 验证：
    - `git diff --check`
    - `git status --short`
  - 审查方式：自审。
  - 审查判定依据：文档阶段，低风险。
  - 外审执行：不适用。
  - 外审失败策略：不适用。
  - 证据：diff/status 输出。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：`git diff --check` 通过，`git status --short` 仅包含本 slice 计划、架构门禁和日志改动；审查结论：自审通过，主计划、归档、review 证据和下一步一致；日志：`changelog/2026-05-18.md` 已同步；commit：`docs(plan): finalize monorepo boundary gates`；下一步：`P1.0`。
  - 提交：`docs(plan): finalize monorepo plan reset`

### P1. AgentMesh 工具链与包边界强制

- [x] P1 阶段完成门禁（仅在 `P1.Z` 完成审查、日志和 commit 后勾选）
- 阶段目标：先修复本地 Web Studio 入口和外审调用输入契约，并让 monorepo 边界在工程上成立，再拆 `app-server`、`studio-web`、`skills`。
- 阶段门禁：完成 P1.0、P1.1、P1.2、P1.3、P1.4、P1.5、P1.Z。
- 执行顺序：P1.0、P1.1 和 P1.5 都只依赖 P0，可独立推进；P1.2 必须等 P1.0 和 P1.1 都完成后再开始，避免 Web 入口修复和 prompt-file 修复互相阻塞；P1.5 必须在 P1.Z 前完成。

- [x] ~~P1.0 修复 `agentmesh studio` 默认 React Web 入口~~
  - Slice：`P1.0`
  - 依赖：P0 完成。
  - 文件：
    - `packages/cli/src/commands/studio.ts`
    - `apps/studio/src/main.ts`
    - `apps/studio/src/server.ts`
    - `tests-node/studio-cli.test.ts`
    - `tests-node/studio.test.ts`
  - 目标：源码开发者运行 `npm run agentmesh -- studio --port 4777` 就能看到最新 React Studio，包括 `Runs / Calls / 配置`，不再需要手写 Node 脚本传 `assetDir`。
  - 动作：
    - 为 CLI Studio 入口解析默认 built frontend asset dir：`dist-node/apps/studio/frontend`。
    - 当 built assets 存在时，把 `assetDir` 传给 `startStudioServer`。
    - 移除 CLI Studio 默认旧页面降级；built assets 缺失时给出明确错误和 `npm run build:studio-frontend` 修复提示。
    - 增加测试，确认 `/` 返回 Vite React HTML，`/assets/*` 可访问，`/api/calls` 不被静态资源接管。
    - 更新本地开发说明或计划进度，明确快速启动命令。
  - 产出：稳定的一条命令 Web Studio 本地入口。
  - 验证：
    - `npm run build:studio-frontend`
    - `npm run build`
    - `npm test -- tests-node/studio-cli.test.ts`
    - `npm test -- tests-node/studio.test.ts`
    - 手工 smoke：`npm run agentmesh -- studio --port 4777 --no-open` 后访问 `/`，确认页面包含 `Runs` 和 `Calls`。
    - 故意移走或指定空 asset dir 时，确认返回明确错误和修复提示，不会静默展示旧页面。
  - 审查方式：外审。
  - 审查判定依据：改动影响 `agentmesh studio` 用户可见入口、React assets/旧页面降级策略和本地开发路径，必须有人复核。
  - 外审执行：通过 AgentMesh 找至少一个 reviewer 检查启动入口、assetDir resolver、API 路由和无 assets 错误行为。
  - 外审失败策略：修复已接受问题；外审不可用则 needs_decision，不进入 P1.2。
  - 证据：测试输出、curl 或浏览器 smoke 结果。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：先按 TDD 看到新增 Studio CLI 回归测试失败，再实现默认 React assets resolver；`npm run build:node && npm run build:studio-frontend && node --test dist-node/tests-node/studio-cli.test.js` 通过，7/7；`npm run build && node --test dist-node/tests-node/studio-cli.test.js dist-node/tests-node/studio.test.js` 通过，29/29；手工 smoke：`npm run agentmesh -- studio --port 4777 --no-open` 后 curl `/` 命中 React `index.html` 和 `/assets/index-*.js`，curl `/api/calls` 返回 JSON；缺 assets 场景返回 `npm run build:studio-frontend` 提示。审查结论：Gemini 首审提出 Should Fix（测试 rename 全局 build 目录有并发风险），已接受并改为 `AGENTMESH_STUDIO_ASSET_DIR` 临时目录注入；Gemini 复审 `LGTM`，输出见 `docs/reviews/studio/p1.0-gemini-2026-05-18.md` 和 `docs/reviews/studio/p1.0-gemini-followup-2026-05-18.md`。AgentMesh 状态：`doctor --json` 曾卡在 Cursor auth probe，未声明全局 doctor 通过；本 slice 外审通过 AgentMesh direct call 到 Gemini。日志：`changelog/2026-05-18.md` 已同步；commit：`fix(studio): serve react assets by default`；下一步：`P1.1`。
  - 收尾：同步日志并提交。
  - 提交：`fix(studio): serve react assets by default`

- [x] ~~P1.1 修复 `agentmesh call --prompt-file` 输入契约~~
  - Slice：`P1.1`
  - 依赖：P0 完成。
  - 文件：
    - `packages/cli/src/commands/call.ts`
    - `packages/runtime/src/adapters.ts`
    - `packages/runtime/src/adapters/invocation.ts`
    - `tests-node/adapter-invocation.test.ts`
    - `tests-node/call-history.test.ts`
  - 目标：`--prompt-file` 和 `--prompt` 对 provider adapter 的实际输入语义一致，后续外审不再依赖内联 prompt 调用。
  - 动作：
    - 梳理 `call` 命令从 CLI 参数到 runtime adapter invocation 的 prompt 传递路径。
    - 明确 `promptFile` 只作为来源证据和支持文件参数 provider 的可选输入，不作为默认命令尾参。
    - 对 Cursor、Claude、Gemini 等 AI CLI adapter，确保读取文件内容后传给 provider 的 prompt 参数或 stdin。
    - 保留 call history 的 `prompt_source=file`、`prompt_ref`、hash 和 output 记录。
    - 为 `--prompt-file` 增加 adapter invocation 单测，覆盖无 `prompt_file_arg` 时不会只把路径追加到命令末尾。
  - 产出：稳定的 direct call prompt 输入契约和回归测试。
  - 验证：
    - `npm test -- tests-node/adapter-invocation.test.ts`
    - `npm test -- tests-node/call-history.test.ts`
    - 条件允许时，用一个短 prompt file 分别对 ready 的 Cursor、Claude、Gemini 做 live smoke；不可用时记录跳过原因。
  - 审查方式：外审。
  - 审查判定依据：影响后续所有 AgentMesh 外审和 direct call 证据，且已经在真实调用中暴露。
  - 外审执行：修复后通过 AgentMesh 找至少一个 reviewer；如果 `--prompt-file` 仍不可用，则该 slice 不通过。
  - 外审失败策略：修复已接受问题；若外审工具不可用则 needs_decision，不进入 P1.2。
  - 证据：测试输出、live smoke 或跳过说明、review 输出。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：先按 TDD 看到无 `prompt_file_arg` 的 command adapter 仍把 prompt file path 追加为位置参数；实现后 `npm run build:node && node --test dist-node/tests-node/adapter-invocation.test.js dist-node/tests-node/call-history.test.js` 通过，20/20；`npm run build && node --test dist-node/tests-node/adapter-invocation.test.js dist-node/tests-node/call-history.test.js` 通过，20/20；Gemini live smoke 使用真实 `agentmesh call --prompt-file <tmp>` 退出 0，输出 `P1.1 prompt file smoke OK` 到 `docs/reviews/studio/p1.1-gemini-prompt-file-smoke-2026-05-18.md`。审查结论：Gemini 通过 AgentMesh `--prompt-file` 外审 `LGTM`，输出见 `docs/reviews/studio/p1.1-gemini-2026-05-18.md`；未跑 Cursor/Claude live smoke，原因是 `agentmesh doctor --json` 在 P1.0 曾卡在 Cursor auth probe，本轮不把未验证 provider 说成 ready。已接受问题处理：无。日志：`changelog/2026-05-18.md` 已同步；commit：`fix(call): pass prompt file content to adapters`；下一步：`P1.5`。
  - 收尾：同步日志并提交。
  - 提交：`fix(call): pass prompt file content to adapters`

- [x] ~~P1.2 Workspace 拓扑调整~~
  - Slice：`P1.2`
  - 依赖：`P1.0` 和 `P1.1`
  - 文件：
    - `package.json`
    - `tsconfig.json`
    - 新增或调整各 package/app `tsconfig.json`
  - 目标：让 `packages/*` 和 `apps/*` 都成为清晰 workspace 单元。
  - 动作：
    - 根 workspace 覆盖 `packages/*` 和 `apps/*`。
    - 为每个 package/app 准备独立 build 边界。
    - 评估是否引入 TypeScript project references。
  - 产出：可独立建模的 workspace 结构。
  - 验证：
    - `npm run build:node`
    - `npm run build:studio-frontend`
    - `npm test`
  - 审查方式：外审。
  - 审查判定依据：影响全仓构建和后续迁移，失败成本较高。
  - 外审执行：通过 AgentMesh 分配至少一个 reviewer 检查构建拓扑。
  - 外审失败策略：外审不可用时先 blocked；不可降级直接进入 P1.3。
  - 证据：测试输出、review 输出、diff。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：先按 TDD 看到 package-structure 测试因 root workspace 只含 `packages/*` 且 unit build metadata 缺失而失败；实现后 `npm run build:workspaces` 通过，`@agentmesh/cli`、`@agentmesh/core`、`@agentmesh/runtime`、`@agentmesh/sdk`、`@agentmesh/studio`、`@agentmesh/studio-desktop` 均有独立 build 脚本；`npm run build:node` 通过；`npm run build:studio-frontend` 通过；`npm test` 首轮出现一次 desktop sidecar readiness 超时，单测复现通过，重跑全量 `npm test` 通过 448/448；`git diff --check` 通过。审查结论：Gemini 通过 AgentMesh 外审 `LGTM`，输出见 `docs/reviews/studio/p1.2-gemini-2026-05-18.md`；已接受问题处理：无。Project references 评估：本 slice 不引入 references，保留 root `tsc` 作为 emit 边界，各 workspace 用 `tsc --noEmit` 做独立检查，P1.3 再收敛 import 边界。日志：`changelog/2026-05-18.md` 已同步；commit：`build: define workspace package boundaries`；下一步：`P1.3`。
  - 收尾：同步日志并提交。
  - 提交：`build: define workspace package boundaries`

- [x] ~~P1.3 跨包 import 收敛~~
  - Slice：`P1.3`
  - 依赖：`P1.2`
  - 文件：
    - `packages/**/src/**/*.ts`
    - `apps/**/src/**/*.ts`
    - 可能新增 lint/import-boundary 检查脚本
  - 目标：消除跨包相对路径穿透。
  - 动作：
    - 将跨包 import 改为 `@agentmesh/*`。
    - 对前端代码限制为 HTTP API 和 type-only contract。
    - 固化 `@agentmesh/sdk` 的稳定公共面，明确哪些类型/函数可被外部或前端 type-only 消费。
    - 明确 `@agentmesh/runtime` 是内部面，禁止前端和外部 package runtime import。
    - 增加依赖方向检查，至少覆盖 `core` 禁止 Node side effect、frontend 禁止 runtime import。
  - 产出：强制包边界和基础检查。
  - 验证：
    - `rg "\\.\\./\\.\\./.*packages|\\.\\./\\.\\./.*runtime|\\.\\./\\.\\./.*studio" packages apps -g '*.ts' -g '*.tsx' -g '!apps/studio-desktop/src-tauri/**'` 应无输出。
    - `rg "from ['\\\"]@agentmesh/runtime|import\\(['\\\"]@agentmesh/runtime" apps packages/sdk -g '*.ts' -g '*.tsx' -g '!apps/studio-desktop/src-tauri/**'` 应无输出。
    - `npm test`
    - 新增边界检查脚本通过。
  - 审查方式：外审。
  - 审查判定依据：这是后续拆包基础，必须有人检查漏网 import。
  - 外审执行：优先通过 AgentMesh 找 Cursor 或 Claude 4.7 review；若 auth/probe 不可用，记录原因并使用可用外审。
  - 外审失败策略：换审查者；仍不可用则 needs_decision。
  - 证据：命令输出、review 输出。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：按 TDD 先看到 `package-structure` / `call-history` / `studio` targeted 组因 SDK 写 API、缺少 `calls adopt` CLI、catalog 仍依赖慢 CLI 而失败；实现后 targeted 组 43/43 通过。`npm run check:boundaries` 通过；两条 source-scoped `rg` import 门禁无匹配；SDK 写 helper 扫描无匹配；`npm run build:workspaces` 通过；`npm test` 首轮出现一次 desktop sidecar readiness 超时，单测复现通过，重跑全量 `npm test` 通过 449/449；`git diff --check` 通过。实现：源码跨包相对 import 收敛到 `@agentmesh/*`；新增 `scripts/check-boundaries.mjs` 和 build 后 `scripts/rewrite-package-imports.mjs`；SDK 去除 runtime 依赖并保持 read-only；call adoption 写入改走 `agentmesh calls adopt` CLI/runtime 边界；Studio catalog 的 agents/workflows 读改走 SDK，MCP 仍通过 CLI 诊断。说明：Tauri `src-tauri` JSON resource path 需要合法引用 `../../../dist-node`，因此本 slice import grep 与边界脚本按 TS/TSX source scoped 执行。审查结论：Gemini 初审发现 SDK 写 API、catalog CLI 读和 frontend type-only 边界问题，均已接受并修复；复审 `LGTM`，输出见 `docs/reviews/studio/p1.3-gemini-2026-05-18.md` 和 `docs/reviews/studio/p1.3-gemini-followup-2026-05-18.md`。日志：`changelog/2026-05-18.md` 已同步；commit：`refactor: enforce package import boundaries`；下一步：`P1.4`。
  - 收尾：同步日志并提交。
  - 提交：`refactor: enforce package import boundaries`

- [x] ~~P1.4 发布形态落定~~
  - Slice：`P1.4`
  - 依赖：`P1.3`
  - 文件：
    - `packages/*/package.json`
    - `packages/*/tsconfig.json`
    - 构建脚本和测试
  - 目标：落定一步到位的内部团队分发形态：内部 packages 私有，CLI 可安装，Desktop 可打包。
  - 动作：
    - 将内部 packages 标为 `private: true`，并补齐 `dist`、`.d.ts`、`exports` 或明确 bundle 消费边界。
    - 根 package `agentmesh` 是内部团队 CLI tarball/private registry 的唯一 pack owner，`bin` 指向构建后的可执行 JS。
    - CLI tarball 不留下未发布的 workspace 依赖缺口；需要的 runtime/skills 内容必须被 bundle 或作为明确文件纳入。
    - Desktop channel 明确消费 app-server/runtime/studio-web 构建产物，不消费 CLI package。
  - 产出：真实发布形态说明和门禁。
  - 验证：
    - `npm run build`
    - `npm test`
    - 内部 packages：验证 `private: true`、`exports`、`.d.ts` 和 root build 产物所有权。
    - CLI package：在仓库根目录执行 `npm pack --dry-run`，必须包含 executable `bin`、runtime 所需代码、skill 模板和声明文件。
    - Clean install smoke：在临时目录安装 root pack tarball 后，执行 `agentmesh --help`、`agentmesh doctor --json`、`agentmesh skill show`。
    - Desktop：确认 sidecar bundle 输入只来自 app-server/runtime/studio-web 构建产物。
  - 审查方式：外审。
  - 审查判定依据：直接影响后续安装方式和团队分发。
  - 外审执行：通过 AgentMesh 找 Gemini 或 Claude 4.7 review。
  - 外审失败策略：重试或换审查者；不通过则 blocked。
  - 证据：build/test/pack 输出、review 输出。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：先按 TDD 看到新增 `package-structure` 发布门禁因 root `files` 缺失、未 emit `.d.ts`、pack 未含声明文件而失败；实现后 `npm run build && node --test dist-node/tests-node/package-structure.test.js` 通过，16/16；`npm run build && node --test dist-node/tests-node/package-structure.test.js dist-node/tests-node/studio-desktop-distribution.test.js` 通过，22/22；`npm pack --dry-run` 通过并确认 tarball 包含 executable `bin`、runtime/core/sdk/cli/studio 构建产物、skill 模板和声明文件；`npm run build:workspaces` 通过；`npm test` 通过，454/454；`npm run check:boundaries` 通过；`git diff --check` 通过。实现：root package 增加 tarball `files` 白名单，root `tsconfig` 打开 declaration emit，新增 `docs/distribution/package-shape.md` 记录 CLI tarball、workspace private packages、clean install smoke 和 Desktop channel bundle 边界；clean install smoke 在临时项目安装 root tarball 后执行 `agentmesh --help`、`agentmesh doctor --json`、`agentmesh skill show`。审查结论：Gemini 初审误报 dependency key / 文档字符串存在 leading space，核对源码不成立；已接受其 core pack 显式断言建议并补测；随后改用 Claude 4.7 外审 `LGTM`，输出见 `docs/reviews/studio/p1.4-claude-2026-05-18.md`。日志：`changelog/2026-05-18.md` 已同步；commit：`build: finalize internal distribution shape`；下一步：`P1.Z`。
  - 收尾：同步日志并提交。
  - 提交：`build: finalize internal distribution shape`

- [x] ~~P1.5 收敛 packet schema 单当前格式口径~~
  - Slice：`P1.5`
  - 依赖：P0 完成；不依赖 P1.0 / P1.1 / P1.2。
  - 文件：
    - `packages/core/src/index.ts`
    - `packages/runtime/src/flow/create.ts`
    - `packages/runtime/src/workflow/registry.ts`
    - `packages/runtime/src/packet/validate.ts`
    - `packages/runtime/src/packet/compatibility.ts`
    - `tests-node/**`
    - `docs/contracts/**`
    - `docs/workflows/**`
    - `examples/workflows/**`
    - `README.md`
    - `index.html`
  - 目标：项目 active surface 只有一个当前 packet 格式，不再出现面向执行的 `v1` / `v2` 双版本命名或迁移叙事。
  - 动作：
    - 将 `CURRENT_PACKET_SCHEMA_VERSION` 对齐到 `CURRENT_SCHEMA_VERSION`，保留 `schema_version` 字段作为内部机器校验，不作为产品命名。
    - 保留当前格式必需字段：`stage_nodes`、node-id keyed execution facts、attempts、fallback/failure policy 和 provenance。
    - 更新 workflow recipe 校验，让 `compatible_packet_schema_versions` 只接受当前常量值。
    - 将测试 helper 从 `packetStatusV2` 改为 `currentPacketStatus` 或同类当前格式命名。
    - 更新 fixtures、active workflow TOML、README、index、contracts 和 examples，统一写“current packet schema / 当前 packet 格式”。
    - 移除 active docs 里的 `No v1 migration`、`packet v2`、`schema version 2`、`v1-to-v2` 等旧口径；历史 `docs/archive/**` 和 `docs/reviews/**` 作为证据可保留原文。
    - 不写旧格式迁移代码，不保留 `[1, 2]` 兼容分支；旧 run 需要时直接重新创建或覆盖。
  - 产出：单当前格式 packet schema 代码、测试、fixture 和活跃文档。
  - 验证：
    - `npm run build`
    - `node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/packet-validate.test.js dist-node/tests-node/workflow-registry.test.js dist-node/tests-node/flow-run.test.js dist-node/tests-node/sdk-read.test.js dist-node/tests-node/studio-ui.test.js`
    - `npm test`
    - `rg -n "packet v2|Packet v2|packetStatusV2|No v1|v1-to-v2|schema version 2|packet schema 2|compatible_packet_schema_versions = \\[2\\]" README.md index.html docs/contracts docs/workflows examples packages tests-node -g '!docs/archive/**' -g '!docs/reviews/**'` 应无输出；测试里用于“拒绝未来未知 schema_version = 2”的负例必须命名为 unsupported newer schema，不得叫 packet v2。
    - `git diff --check`
  - 审查方式：外审。
  - 审查判定依据：涉及 core schema 常量、workflow 校验、fixture、文档和多组测试，是公共协议口径变更，必须复核。
  - 外审执行：通过 AgentMesh 找 Cursor、Claude 4.7 或 Gemini 至少一个 reviewer 检查是否仍残留双版本语义、是否误删必要的 `schema_version` 机器校验。
  - 外审失败策略：修复已接受问题并重跑验证；外审不可用时 needs_decision，不进入 P1.Z。
  - 证据：build/test/rg/diff-check 输出、review 输出。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：先按 TDD 看到 `CURRENT_PACKET_SCHEMA_VERSION` 仍为 2、与 `CURRENT_SCHEMA_VERSION` 不一致；实现后 `npm run build && node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/packet-validate.test.js dist-node/tests-node/workflow-registry.test.js dist-node/tests-node/flow-run.test.js dist-node/tests-node/sdk-read.test.js dist-node/tests-node/studio-ui.test.js` 通过，102/102；`npm test` 通过，447/447；active surface `rg` 扫描旧 `packet v2` / `[2]` / `No v1` 等口径无输出；`git diff --check` 通过。审查结论：Gemini 通过 AgentMesh 外审 `LGTM`，输出见 `docs/reviews/studio/p1.5-gemini-2026-05-18.md`；已接受问题处理：无。日志：`changelog/2026-05-18.md` 已同步；commit：`refactor(packet): keep one current schema format`；下一步：`P1.2`。
  - 收尾：同步日志并提交。
  - 提交：`refactor(packet): keep one current schema format`

- [x] ~~P1.Z 阶段收尾校准~~
  - Slice：`P1.Z`
  - 目标：确认 workspace、import 边界、发布形态和 packet 单当前格式口径已经能支撑拆包。
  - 验证：
    - `npm run build`
    - `npm test`
    - 边界检查脚本
    - `git diff --check`
  - 审查方式：外审。
  - 审查判定依据：阶段完成后会进入模块拆迁，高风险。
  - 外审执行：至少一个 reviewer 确认 P1 可进入 P2。
  - 外审失败策略：修复已接受问题；不可用则 needs_decision。
  - 证据：验证输出、review 输出、日志、commit。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：`npm run build` 通过；`npm test` 通过，454/454；`npm run check:boundaries` 通过；`git diff --check` 通过。审查结论：Claude 4.7 外审因额度限制未产出 review，按失败策略改用 Gemini；Gemini 通过 AgentMesh 外审 `LGTM`，输出见 `docs/reviews/studio/p1.z-gemini-2026-05-18.md`。结论：workspace 拓扑、跨包 import 边界、SDK/runtime read/write 边界、CLI tarball 发布形态、Desktop bundle 边界和当前 packet schema 口径均已具备进入 P2 的基础。日志：`changelog/2026-05-18.md` 已同步；commit：`build: complete monorepo boundary foundation`；下一步：`P2.1`。
  - 提交：`build: complete monorepo boundary foundation`

### P2. App Server 与 Studio Web 拆包

- [x] ~~P2 阶段完成门禁（仅在 `P2.Z` 完成审查、日志和 commit 后勾选）~~
- 阶段目标：把现有 `apps/studio` 拆成 `packages/app-server` 和 `apps/studio-web`。
- 阶段门禁：完成 P2.1、P2.2、P2.3、P2.Z；P2.1 完成时不得留下 App Server spawn CLI 写路径。

- [x] ~~P2.1 抽出 `packages/app-server` 并直连 runtime~~
  - Slice：`P2.1`
  - 依赖：P1 完成。
  - 文件：
    - 新增：`packages/app-server/**`
    - 迁移：`apps/studio/src/server.ts`、API handler、browser/read model 相关文件
    - 修改：`packages/runtime/**`、`packages/cli/**`
  - 目标：HTTP API 和 App Server lifecycle 成为独立 package。
  - 动作：
    - 搬迁 server 创建和启动逻辑。
    - 保留 CLI `agentmesh studio` 入口，但让它调用 `@agentmesh/app-server`。
    - 定义 App Server API contract。
    - 迁移时若发现 App Server 需要 CLI 层能力，先把能力抽到 `runtime` API，再接入 App Server；不得留下 spawn CLI 调用。
    - 梳理并删除当前 App Server spawn CLI 的 mutation。
    - 为对应 runtime 行为提供程序化 API，并让 CLI 改成调用同一 runtime API。
    - 对所有 App Server 写操作补 runtime API 和测试，不允许留下 CLI-spawn 清单。
  - 产出：独立 App Server package。
  - 验证：
    - `npm run build`
    - `npm test`
    - Studio API 相关测试通过。
    - CLI mutation 测试、App Server mutation 测试、lock/compat 回归测试通过。
    - grep 或边界检查确认 production mutation 不再存在 `app-server -> cli` 调用。
  - 审查方式：外审。
  - 审查判定依据：跨 CLI、Web、Desktop，风险高。
  - 外审执行：通过 AgentMesh 找至少一个 reviewer 检查迁移、API 边界和是否仍有 `app-server -> cli` 写路径。
  - 外审失败策略：修复已接受问题；不可用则 blocked。
  - 证据：测试输出、review 输出、`app-server -> cli` 禁止项检查结果。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：先按 TDD 看到 `package-structure` / `studio` targeted 组因 `packages/app-server` 缺失而失败；实现后 `npm run build && node --test dist-node/tests-node/call-history.test.js dist-node/tests-node/studio.test.js` 通过，34/34；`npm run build && node --test dist-node/tests-node/package-structure.test.js dist-node/tests-node/studio.test.js dist-node/tests-node/studio-desktop-options.test.js dist-node/tests-node/studio-distribution-coexistence.test.js dist-node/tests-node/cli-surface.test.js` 通过，74/74；`npm test` 通过，456/456。实现：新增 `@agentmesh/app-server` package，CLI `studio` 和 Desktop host 均改为调用 App Server package；App Server mutation、call adoption、agent lifecycle 写操作直连 runtime API，不再 spawn CLI；CLI agents 命令改为复用 runtime lifecycle API；边界脚本禁止 App Server 写路径引入 CLI / `child_process`。审查结论：Cursor 外审 `LGTM`；Codex 外审 `LGTM` 且提出两条 Should Fix，已接受并修复：call adoption 元数据校验下沉到 runtime，runtime lifecycle 异常会落为 Studio failed operation；Claude 4.7 和 Gemini 因额度不可用未产出有效 review。日志：`changelog/2026-05-18.md` 已同步；commit：`refactor(studio): extract app server package`；下一步：`P2.2`。
  - 收尾：同步日志并提交。
  - 提交：`refactor(studio): extract app server package`

- [x] ~~P2.2 抽出 `apps/studio-web`~~
  - Slice：`P2.2`
  - 依赖：`P2.1`
  - 文件：
    - 新增：`apps/studio-web/**`
    - 迁移：`apps/studio/src/frontend/**`
    - 调整：Vite 配置、build 脚本
  - 目标：React/Vite 前端成为独立 app。
  - 动作：
    - 搬迁 frontend 源码和 `index.html`。
    - Vite 输出位置明确供 App Server/Desktop 消费。
    - 把 P1.0 的默认 `dist-node/apps/studio/frontend` assetDir 迁移到 `apps/studio-web` 新构建产物路径，保留 React assets 与缺失 assets 错误的可区分测试。
    - 确保前端不 runtime import Node package。
  - 产出：独立 Studio Web app。
  - 验证：
    - `npm run build:studio-frontend`
    - `npm test`
    - 前端边界检查。
    - `npm run agentmesh -- studio --port 4777 --no-open` 仍默认服务 React `Runs / Calls`，Calls tab 仍读取 `/api/calls`。
  - 审查方式：外审。
  - 审查判定依据：影响 UI 构建和 Desktop 静态资源。
  - 外审执行：通过 AgentMesh 找 reviewer 检查资源路径和 import。
  - 外审失败策略：换审查者或 needs_decision。
  - 证据：build/test 输出、review 输出。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：先按 TDD 看到 `package-structure` 因 `apps/studio-web` package、root files 和新 Vite config 缺失而失败；实现后 `npm run build && node --test dist-node/tests-node/package-structure.test.js` 通过，16/16；`npm run build && node --test dist-node/tests-node/package-structure.test.js dist-node/tests-node/studio-cli.test.js dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio.test.js dist-node/tests-node/studio-desktop-distribution.test.js dist-node/tests-node/studio-desktop-options.test.js` 通过，92/92；`npm run build --workspace @agentmesh/studio-web` 确认 cwd 无关地写入 root `dist-node/apps/studio-web/frontend` 且不生成 nested `apps/studio-web/dist-node`；`npm test` 通过，456/456。实现：新增 `@agentmesh/studio-web` package 并迁移 React/Vite frontend；`@agentmesh/studio` 收敛为本地 launcher；root `build:studio-frontend`、CLI 默认 assetDir、Desktop assetDir/sidecar 和 pack 白名单统一到 `dist-node/apps/studio-web/frontend`；根 CLI package 不再声明 React runtime dependency。审查结论：Cursor 初审发现 Vite `outDir` 依赖 `process.cwd()`，已修复；其 CLI assetDir blocking 结论经 follow-up 复审确认为 path anchor 误判，剩余无 blocking；Codex review 尝试挂起且未产出文件，已终止。日志：`changelog/2026-05-18.md` 已同步；commit：`refactor(studio): split web app`；下一步：`P2.3`。
  - 收尾：同步日志并提交。
  - 提交：`refactor(studio): split web app`

- [x] ~~P2.3 App Server 写路径发布门禁~~
  - Slice：`P2.3`
  - 依赖：`P2.1` 和 `P2.2`
  - 文件：
    - `packages/app-server/**`
    - `packages/runtime/**`
    - `packages/cli/**`
    - 边界检查脚本或测试
  - 目标：证明拆包后的 Studio/App Server 写路径仍然只有 `app-server -> runtime`。
  - 动作：
    - 复核所有 App Server mutation endpoint、Desktop mutation 入口和 CLI mutation 命令。
    - 固化禁止 `app-server -> cli` 的边界检查。
    - 补齐 P2.1/P2.2 后暴露出的 missing App Server mutation 测试。
  - 产出：写路径发布门禁。
  - 验证：
    - CLI mutation 测试。
    - App Server mutation 测试。
    - lock/compat 回归测试。
    - grep 或边界检查确认 production mutation 不再存在 `app-server -> cli` 调用。
  - 审查方式：外审。
  - 审查判定依据：三方 review 共同 Must Fix，不能自审通过。
  - 外审执行：至少一个 reviewer，重点看是否仍有 `app-server -> cli` 写路径。
  - 外审失败策略：必须修复已接受问题；不可用则 blocked。
  - 证据：测试输出、review 输出、`app-server -> cli` 禁止项检查结果。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：先按 TDD 看到 `package-structure` 因边界脚本未提供 App Server package 级 allowlist 而失败；实现后 `npm run build && node --test dist-node/tests-node/package-structure.test.js` 通过，16/16；`npm run build && node --test dist-node/tests-node/package-structure.test.js dist-node/tests-node/studio.test.js dist-node/tests-node/studio-desktop-options.test.js dist-node/tests-node/studio-distribution-coexistence.test.js dist-node/tests-node/cli-surface.test.js` 通过，74/74；`npm run check:boundaries` 通过；`npm test` 通过，456/456；`npm run build:workspaces` 通过；`git diff --check` 通过。实现：将 read-only MCP CLI 诊断从 `catalog.ts` 隔离到 `mcp-diagnostics.ts`，边界脚本只豁免该文件，并对 `spawn` / `exec` / `execFile` / `fork` 及其 `Sync` 变体、`process.execPath`、`@agentmesh/cli`、`packages/cli` 做 App Server package 级禁止。审查结论：Cursor 初审发现 `catalog.ts` 整文件豁免过宽和非 `spawn` child_process API 漏检，均已接受并修复；Cursor follow-up `PASS`，无 blocking；按用户 2026-05-18 决策，本计划外审门槛统一为至少一个 reviewer，本 slice 外审门槛已满足。日志：`changelog/2026-05-18.md` 已同步；commit：`test(studio): harden app server write gate`；下一步：`P2.Z`。
  - 收尾：同步日志并提交。
  - 提交：`test(studio): harden app server write gate`

- [x] ~~P2.Z 阶段收尾校准~~
  - Slice：`P2.Z`
  - 目标：确认 `apps/studio` 已被合理拆分或清理，不再混放 server/frontend/desktop 责任。
  - 验证：
    - `npm run build`
    - `npm test`
    - `npm run studio -- --no-open` 或等价 smoke
    - `git diff --check`
  - 审查方式：外审。
  - 审查判定依据：拆包阶段完成，影响面大。
  - 外审执行：至少一个 reviewer 确认可进入 Desktop 打包阶段。
  - 外审失败策略：修复已接受问题；不可用则 needs_decision。
  - 证据：验证输出、review 输出、日志、commit。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：`npm run build` 通过；首轮 `npm test` 暴露两个全量负载下的 smoke 等待窗口过紧问题，单用例复现均通过，最小修复为将缺 assets CLI 退出测试 timeout 从 1s 放宽到 5s、sidecar readiness timeout 从 5s 放宽到 15s；修复后 `npm run build && node --test dist-node/tests-node/studio-cli.test.js dist-node/tests-node/studio-desktop-distribution.test.js` 通过，13/13；`npm test` 通过，456/456；`npm run studio -- --host 127.0.0.1 --port 0 --no-open` 等价 smoke 通过，`GET /` 和 `GET /api/calls` 均为 200；`npm run check:boundaries` 通过；`git diff --check` 通过。审查结论：Cursor 外审 `LGTM`，输出见 `docs/reviews/studio/p2.z-cursor-2026-05-18.md`；其 Should Fix 指出 P2.Z commit message 不应沿用旧 refactor 摘要，已接受并改为 test-stability 摘要；两个 Nit 作为残余风险记录，不阻塞。结论：P2 拆包阶段可进入 Desktop Sidecar 与安全启动阶段。日志：`changelog/2026-05-18.md` 已同步；commit：`test(studio): stabilize p2 closeout smoke gates`；下一步：`P3.1`。
  - 提交：`test(studio): stabilize p2 closeout smoke gates`

### P3. Desktop Sidecar 与安全启动

- [x] ~~P3 阶段完成门禁（仅在 `P3.Z` 完成审查、日志和 commit 后勾选）~~
- 阶段目标：让 `apps/studio-desktop` 只依赖构建产物，并安全启动 app-bundled App Server。
- 阶段门禁：完成 P3.1、P3.2、P3.3、P3.Z。

- [x] ~~P3.1 Sidecar 产物契约~~
  - Slice：`P3.1`
  - 依赖：P2 完成。
  - 文件：
    - `apps/studio-desktop/**`
    - `packages/app-server/**`
    - 构建脚本
  - 目标：定义 Tauri sidecar 如何获得 App Server 可执行产物。
  - 动作：
    - 固定采用现有 JS launcher + bundled Node runtime 方案，由 `apps/studio-desktop/src/sidecar-bundle.ts` 生成 sidecar launcher、bundled Node 和 runtime `node_modules`。
    - sidecar 只能以 app-server/runtime 构建产物作为 Studio 入口；不打包、不调用 AgentMesh CLI artifact。
    - 发行目录不依赖源码 `.ts`。
    - distribution smoke 校验 sidecar 可启动。
  - 产出：可验证 sidecar 构建契约。
  - 验证：
    - `npm run studio-desktop:sidecar:bundle`
    - `npm run studio-desktop:package:dev`
    - 相关测试。
  - 审查方式：外审。
  - 审查判定依据：直接影响 DMG 可用性。
  - 外审执行：通过 AgentMesh 找 reviewer 检查资源路径和运行时依赖。
  - 外审失败策略：修复或 needs_decision。
  - 证据：bundle/smoke 输出、review 输出。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：`npm run build && node --test dist-node/tests-node/studio-desktop-distribution.test.js dist-node/tests-node/package-structure.test.js` 通过，22/22；review follow-up 后 `npm run build && node --test dist-node/tests-node/studio.test.js dist-node/tests-node/studio-desktop-distribution.test.js` 通过，29/29；`npm run studio-desktop:sidecar:bundle` 通过，输出确认 launcher、bundled Node、runtime deps、desktop host entrypoint 和 Studio web frontend；`npm run studio-desktop:package:dev` 通过，`ok=true` 且 `issues=[]`；`npm run check:boundaries` 通过；发行相关 `dist-node` 资源目录 `.ts` / `.tsx` / `.mts` / `.cts` 源文件检查无输出；`git diff --check` 通过；`npm test` 通过，456/456。实现：Desktop/App Server 移除 `cliPath` / `runtimeCliPath` plumbing，App Server catalog 通过 runtime config API 读取 MCP 配置，删除 `mcp-diagnostics.ts`，sidecar bundle 固定生成 JS launcher + bundled Node + runtime deps，Tauri `bundle.resources` 改为显式 App Server/runtime/core/sdk/web/desktop host/sidecar/runtime deps 资源并拒绝 broad `dist-node` 与 `dist-node/packages/cli`，bundle/smoke/test 均禁止运行时依赖携带 TS 源文件。审查结论：Cursor 外审 `PASS`，输出见 `docs/reviews/studio/p3.1-cursor-2026-05-18.md`；两项 Should Fix 已接受并修复（README 旧 CLI subprocess 文案、`StudioCatalogOptions.commandTimeoutMs` 死字段），`.mts` / `.cts` 过滤作为 Nice to have 同步补强。日志：`changelog/2026-05-18.md` 已同步；commit：`build(desktop): define sidecar artifact contract`；下一步：`P3.2`。
  - 收尾：同步日志并提交。
  - 提交：`build(desktop): define sidecar artifact contract`

- [x] ~~P3.2 Token 和本地服务安全~~
  - Slice：`P3.2`
  - 依赖：`P3.1`
  - 文件：
    - `apps/studio-desktop/**`
    - `packages/app-server/**`
    - `apps/studio-web/**`
  - 目标：移除 Desktop token 的高泄漏路径，补本地服务安全门禁。
  - 动作：
    - token 不通过 argv。
    - Tauri 生成 per-launch token，并通过 sidecar stdin 一次性握手传给 App Server。
    - Tauri 在 WebView 导航前通过 native cookie store 或等价 WebView 原生能力写入 `agentmesh_studio_token` 的 `HttpOnly; SameSite=Strict` cookie。
    - WebView 只打开无 query token 的 `http://127.0.0.1:<port>/`。
    - 移除现有 `/?token=...` launch URL 行为；env 不作为最终 token 传递方案。
    - App Server 绑定 `127.0.0.1`。
    - 校验 Host/Origin/CORS。
    - 旧 tab 和未授权请求返回明确错误。
  - 产出：安全 bootstrap contract。
  - 验证：
    - 授权/未授权 API 测试。
    - Desktop smoke。
    - 检查进程参数不含 token。
    - 检查 launch URL、日志和 bootstrap JSON 不含 token。
  - 审查方式：外审。
  - 审查判定依据：安全边界，不可只自审。
  - 外审执行：至少一个 reviewer，重点看 token 泄漏和 origin 检查。
  - 外审失败策略：blocked，直到已接受问题修复。
  - 证据：测试输出、review 输出。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：先按 TDD/回归看到旧测试编译失败和 query-token / Host-Origin 约束未实现；实现后 `npm run build && node --test dist-node/tests-node/studio-desktop-options.test.js dist-node/tests-node/studio-desktop-distribution.test.js dist-node/tests-node/studio.test.js dist-node/tests-node/studio-distribution-coexistence.test.js` 通过，44/44；`npm run studio-desktop:sidecar:bundle` 通过，输出确认 launcher、bundled Node、runtime deps、desktop host entrypoint 和 Studio web frontend；`npm run studio-desktop:package:dev` 通过，`ok=true` 且 `issues=[]`；`npm run check:boundaries` 通过；`cargo check --manifest-path apps/studio-desktop/src-tauri/Cargo.toml` 通过；`npm test` 通过，457/457；`git diff --check` 通过；活跃代码/文档扫描未再命中 tokenized URL / legacy launch-token helper。实现：Tauri shell 生成 per-launch token，通过 sidecar stdin JSON handshake 交给 Node host，导航前写入 `agentmesh_studio_token` 的 `HttpOnly; SameSite=Strict` native WebView cookie，并只接受无 query 的 `http://127.0.0.1:<port>/` ready URL；Desktop launch JSON、日志和 argv 不含 token；App Server auth 移除 query token，只认 Bearer/cookie，补 Host/Origin/CORS loopback gate；Studio frontend bootstrap 不再从 URL token 建立 auth，仅清理 legacy URL token；co-install / distribution / bootstrap / stale token 测试均切到 cookie auth 或 query-token negative case。同步：README、App Server contract、distribution smoke、frontend decision 文档和 public extension surface 已更新为 stdin handshake + native cookie + no-query URL；P5 已按用户决策明确 DMG-only 只满足 Desktop Studio，入口 agent 需要 PATH-visible CLI 与用户选择的 skill target。审查结论：Cursor 外审 `PASS`，输出见 `docs/reviews/studio/p3.2-cursor-2026-05-18.md`；接受其 App Server contract 可选 auth 澄清和 P3.1/P3.2 distribution wording 建议并修复；无 Must Fix。日志：`changelog/2026-05-18.md` 已同步；commit：`fix(desktop): harden studio bootstrap auth`；下一步：`P3.3`。
  - 收尾：同步日志并提交。
  - 提交：`fix(desktop): harden studio bootstrap auth`

- [x] ~~P3.3 Lock/compat UI 降级~~
  - Slice：`P3.3`
  - 依赖：P2 完成；可与 P3.1/P3.2 并行设计 API/UI 文案，但若 token/session 状态影响 UI 展示，最终验证必须等 P3.2 完成。
  - 文件：
    - `packages/app-server/**`
    - `apps/studio-web/**`
    - `packages/runtime/**`
  - 目标：让锁冲突和版本冲突在 Studio 中可理解、可恢复。
  - 动作：
    - App Server 把 lock conflict 映射为固定 error code 或 `423 Locked`。
    - Studio Web 展示锁持有者、入口、重试状态。
    - Settings/About 展示 runtime 版本、last writer、只读/升级提示。
  - 产出：冲突可观测 UI 和 API。
  - 验证：
    - App Server error mapping 测试。
    - UI 状态测试或手工 smoke。
    - compat read-only 场景测试。
  - 审查方式：外审。
  - 审查判定依据：影响用户操作和数据安全。
  - 外审执行：通过 AgentMesh 找 reviewer 检查 API 和 UI 语义。
  - 外审失败策略：修复已接受问题；不可用则 needs_decision。
  - 证据：测试/截图/review 输出。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：`npm run build && node --test dist-node/tests-node/studio-desktop-options.test.js dist-node/tests-node/studio-distribution-coexistence.test.js dist-node/tests-node/studio.test.js dist-node/tests-node/studio-ui.test.js` 通过，73/73；`npm run check:boundaries` 通过；`git diff --check` 通过；`npm test` 通过，461/461。实现：runtime lock conflict 抛出带 `run_locked` code 和 owner metadata 的 typed error，App Server mutation 映射为 HTTP `423 Locked`、`retryable: true` 和 lock payload；workspace compatibility read-only/refused 使用 typed `WorkspaceCompatibilityError` 映射为 HTTP `409 Conflict`、`workspace_read_only` / `workspace_refused` 和 `retryable: false`；Desktop App Server 通过 `entrypoint: "desktop"` 暴露 compatibility diagnostics，CLI 默认保持 `cli`；Studio Safe Actions 展示 lock operation、entrypoint、runtime、pid、operation_id、heartbeat/expires 和 retryable 状态；Settings/About 展示 runtime、entrypoint、last writer、compat decision 和升级提示。审查结论：Cursor 初审 `PASS`，提出 5 个 Should Fix；已接受并修复 lock 字段展示、`workspace_refused` API 测试、refused UI 测试、typed compatibility error 和 contract 文档；Cursor follow-up `PASS/LGTM`，输出见 `docs/reviews/studio/p3.3-cursor-2026-05-18.md` 和 `docs/reviews/studio/p3.3-cursor-followup-2026-05-18.md`。日志：`changelog/2026-05-18.md` 已同步；commit：`feat(studio): expose lock and compatibility states`；下一步：`P3.Z`。
  - 收尾：同步日志并提交。
  - 提交：`feat(studio): expose lock and compatibility states`

- [x] ~~P3.Z 阶段收尾校准~~
  - Slice：`P3.Z`
  - 目标：确认 Desktop 可安全启动、可打包、可与 CLI 共存。
  - 验证：
    - `npm run build`
    - `npm test`
    - `npm run studio-desktop:package:dev`
    - co-install smoke。
  - 审查方式：外审。
  - 审查判定依据：Desktop 发布前门禁。
  - 外审执行：至少一个 reviewer。
  - 外审失败策略：修复已接受问题；不可用则 needs_decision。
  - 证据：验证输出、review 输出、日志、commit。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：`npm run build` 通过；`npm run studio-desktop:package:dev` 通过，`ok=true` 且 `issues=[]`；co-install smoke `node --test dist-node/tests-node/studio-distribution-coexistence.test.js` 通过，5/5；`npm test` 通过，461/461；`npm run check:boundaries` 通过；`git diff --check` 通过；接受外审建议补跑 `cargo check --manifest-path apps/studio-desktop/src-tauri/Cargo.toml`，通过。审查结论：Cursor 外审 `PASS/LGTM`，确认 P3 无 code-level blocker，可进入 P4；外审 Should Fix 中 P3.Z process artifact 已通过本记录和日志补齐，Rust 编译面建议已接受并纳入验证；输出见 `docs/reviews/studio/p3.z-cursor-2026-05-18.md`。结论：Desktop sidecar 产物契约、安全 bootstrap、lock/compat UI 降级、dev packaging、CLI/Desktop 共存和边界门禁均满足 P3 阶段完成条件。日志：`changelog/2026-05-18.md` 已同步；commit：`build(desktop): pass internal dmg readiness gate`；下一步：`P4.1`。
  - 提交：`build(desktop): pass internal dmg readiness gate`

### P4. Skill 包与安装路径现代化

- [x] ~~P4 阶段完成门禁（仅在 `P4.Z` 完成审查、日志和 commit 后勾选）~~
- 阶段目标：把 skill 模板和安装/验证逻辑从 CLI 内部拆成清晰 package。
- 阶段门禁：完成 P4.1、P4.2、P4.Z。

- [x] ~~P4.1 抽出 `packages/skills`~~
  - Slice：`P4.1`
  - 依赖：P1 完成；最好在 P2 后执行。
  - 文件：
    - 新增：`packages/skills/**`
    - 修改：`packages/cli/**`
  - 目标：skill 模板和 target mapping 有单一生成源。
  - 动作：
    - 迁移当前 skill markdown/template 源：`agentmesh-skill/SKILL.md`。
    - 迁移当前 verify 逻辑源：从 `packages/runtime/src/skill/verify.ts` 移到 `packages/skills/src/verify.ts`。
    - 暴露 install/verify 所需的 expected files contract。
    - CLI `skill install/verify/show/export` 调用 `packages/skills`。
    - 明确 consumers：CLI 是 install/export writer；App Server/Studio 如需读取 expected-files，只能用于诊断展示，不直接写 skill 文件。
  - 产出：独立 skills package。
  - 验证：
    - `agentmesh skill show`
    - `agentmesh skill verify --target codex --json`
    - 相关测试。
  - 审查方式：外审。
  - 审查判定依据：影响所有 AI 工具入口。
  - 外审执行：至少一个 reviewer。
  - 外审失败策略：修复或 needs_decision。
  - 证据：命令输出、review 输出。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：先按 TDD 看到 `npm run build && node --test dist-node/tests-node/package-structure.test.js dist-node/tests-node/readiness.test.js` 因 `packages/skills` 缺失而失败；实现后同一 focused 命令通过，55/55；`node dist-node/packages/cli/src/cli.js skill show` 可输出带版本元数据的 AgentMesh Skill；临时 workspace 内 `skill install --target codex --force` 后 `skill verify --target codex --json` 返回 `ok: true`，未写入当前项目 `.agents/`；`npm run build:workspaces` 通过，包含 `@agentmesh/skills`；`npm run check:boundaries` 通过；`git diff --check` 通过；`npm test` 通过，462/462。实现：新增 `packages/skills` workspace package，迁移 `agentmesh-skill/SKILL.md` 到 `packages/skills/agentmesh-skill/SKILL.md`，迁移 install/verify/show/export 支撑逻辑到 `packages/skills/src/verify.ts`，CLI `skill` 命令改为依赖 `@agentmesh/skills`，runtime 移除 skill writer export；root tarball 白名单改为包含 `packages/skills/agentmesh-skill/` 和构建后的 `dist-node/packages/skills/**`；构建 rewrite 与边界脚本识别 `@agentmesh/skills`，并禁止 skills package 反向依赖 runtime/cli。审查结论：Cursor 初审 `PASS/LGTM`，接受并修复其 plan drift、fallback 和 skills 边界建议；Cursor follow-up `PASS/LGTM`，输出见 `docs/reviews/studio/p4.1-cursor-2026-05-18.md` 和 `docs/reviews/studio/p4.1-cursor-followup-2026-05-18.md`。日志：`changelog/2026-05-18.md` 已同步；commit：`refactor(skills): extract skill templates package`；下一步：`P4.2`。
  - 收尾：同步日志并提交。
  - 提交：`refactor(skills): extract skill templates package`

- [x] ~~P4.2 对齐默认 skill 安装路径~~
  - Slice：`P4.2`
  - 依赖：`P4.1`
  - 文件：
    - `packages/skills/**`
    - `packages/cli/**`
    - 文档
  - 目标：默认项目级路径清晰。
  - 动作：
    - Codex/Cursor/Gemini/OpenCode/Copilot 默认写 `.agents/skills/agentmesh/SKILL.md`。
    - Claude 默认写 `.claude/skills/agentmesh/SKILL.md`。
    - `skill verify` 区分 missing、mismatch、legacy-only、ok。
    - `--force` 刷新目标文件，不删除 legacy 文件。
  - 产出：现代化 skill install/verify 行为。
  - 验证：
    - 每个 target 的 install/verify 测试。
    - 文档检查。
  - 审查方式：外审。
  - 审查判定依据：跨工具路径容易出错，且之前已做官方路径确认。
  - 外审执行：通过 AgentMesh 找 reviewer。
  - 外审失败策略：修复或 needs_decision。
  - 证据：测试输出、review 输出。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：先按 TDD 看到新增 `expectedSkillFilesForTarget` 测试因 `@agentmesh/skills` 未导出该 contract 而失败；实现后 `npm run build && node --test dist-node/tests-node/readiness.test.js` 通过，40/40；`node --test dist-node/tests-node/package-structure.test.js dist-node/tests-node/readiness.test.js` 通过，57/57；`node dist-node/packages/cli/src/cli.js skill show` 输出 AgentMesh Skill；临时 workspace 内 `skill install --target codex --force` 后 `skill verify --target codex --json` 返回 `ok: true`；`npm run check:boundaries` 通过；`git diff --check` 通过；`npm test` 通过，464/464。实现：`expectedSkillFilesForTarget` 公开只读 target path contract，明确 Codex/Cursor/Gemini/OpenCode/Copilot 使用当前项目 `.agents/skills/agentmesh/SKILL.md`，Claude 使用当前项目 `.claude/skills/agentmesh/SKILL.md`；`VerifyOptions.homeDir` 明确仅预留给未来 host-home diagnostics，不参与当前项目级路径解析；`skill install --force` 只刷新 expected target 文件，成功输出不再打印 legacy Cursor rule，`skill verify --json` 仍保留 `legacy_only` 诊断。审查结论：Cursor 初审 `PASS/LGTM`，接受并修复 `homeDir` 契约说明和 install stdout legacy UX 两项 Should Fix；Cursor follow-up `PASS/LGTM`，输出见 `docs/reviews/studio/p4.2-cursor-2026-05-18.md` 和 `docs/reviews/studio/p4.2-cursor-followup-2026-05-18.md`。日志：`changelog/2026-05-18.md` 已同步；commit：`feat(skills): align shared project skill targets`；下一步：`P4.Z`。
  - 收尾：同步日志并提交。
  - 提交：`feat(skills): align shared project skill targets`

- [x] ~~P4.Z 阶段收尾校准~~
  - Slice：`P4.Z`
  - 目标：确认 skill package、CLI 命令和文档一致。
  - 验证：
    - `npm run build`
    - `npm test`
    - `agentmesh skill show`
    - `agentmesh skill verify --target codex --json`
  - 审查方式：外审。
  - 审查判定依据：影响用户安装入口。
  - 外审执行：至少一个 reviewer。
  - 外审失败策略：修复已接受问题；不可用则 needs_decision。
  - 证据：验证输出、review 输出、日志、commit。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：`npm run build` 通过；`node dist-node/packages/cli/src/cli.js skill show` 输出带版本元数据的 AgentMesh Skill；临时 workspace 内 `skill install --target codex --force` 后 `skill verify --target codex --json` 返回 `ok: true`，未安装到当前项目或用户宿主；`npm test` 通过，464/464；`npm run check:boundaries` 通过；`git diff --check` 通过；接受外审 Should Fix 后，`npm run build && node --test dist-node/tests-node/package-structure.test.js dist-node/tests-node/readiness.test.js dist-node/tests-node/core-contracts.test.js` 通过，69/69。审查结论：Cursor 阶段外审 `PASS/LGTM`，确认 P4 可进入 P5；接受其 `docs/contracts/skill-output.md` runtime wording 问题并修复为 `@agentmesh/skills` / `agentmeshSkillMarkdown` 口径；follow-up `PASS/LGTM`，输出见 `docs/reviews/studio/p4.z-cursor-2026-05-18.md` 和 `docs/reviews/studio/p4.z-cursor-followup-2026-05-18.md`。结论：skill package、CLI 命令、target path contract、legacy Cursor diagnostics 和文档均一致；P4 阶段完成。日志：`changelog/2026-05-18.md` 已同步；commit：`feat(skills): complete skill package split`；下一步：`P5.1`。
  - 提交：`feat(skills): complete skill package split`

### P5. 发布和验收门禁

- [x] ~~P5 阶段完成门禁（仅在 `P5.Z` 完成审查、日志和 commit 后勾选）~~
- 阶段目标：完成 CLI + Desktop + Skill 的端到端验收；明确 DMG-only 只满足 Desktop Studio，入口 agent / skill 必须由用户选择安装 CLI 与对应宿主 skill。
- 阶段门禁：完成 P5.1、P5.2、P5.Z。

- [x] ~~P5.1 CLI 与入口 agent 命令安装验收~~
  - Slice：`P5.1`
  - 依赖：P1、P4 完成。
  - 文件：
    - `README.md`
    - 安装文档
    - package scripts
    - `docs/distribution/**`
  - 目标：团队成员可以安装 PATH-visible `agentmesh`，让入口 agent / skill 有可调用命令。
  - 动作：
    - 明确 source/tarball/private registry 安装方式。
    - 明确 DMG 可提供 `Install Command Line Tool` 入口，但用户必须主动确认；DMG 不自动写 PATH。
    - 安装或切换 PATH shim 前检测已有 `agentmesh`，展示来源和版本，不静默覆盖。
    - 写清 CLI 与 DMG 共存关系：Desktop 内部用 app-managed runtime，入口 agent / skill 调用 PATH-visible `agentmesh`。
    - 验证 `agentmesh --help`、`agentmesh doctor --json`、`agentmesh skill verify --target <host> --json`。
  - 产出：CLI / command-line shim 安装验收说明和验证记录。
  - 验证：
    - clean install smoke。
    - DMG command-line shim smoke。
    - `agentmesh doctor --json`。
  - 审查方式：外审。
  - 审查判定依据：安装文档和 PATH shim 直接影响入口 agent 是否能调用正确版本。
  - 外审执行：找 reviewer 按文档复核。
  - 外审失败策略：修复或 needs_decision。
  - 证据：命令输出、review 输出。
  - 进度记录：状态：已完成；完成时间：2026-05-18；实现：新增 `docs/distribution/cli-command-install.md`，README 和 distribution docs 明确 source checkout、tarball、private registry 三种 CLI 安装/验收方式；确认入口 agent / Skill 只调用 PATH-visible `agentmesh`，DMG-only 仅满足 Desktop Studio；`Install Command Line Tool` 只能作为用户确认后的可选入口，切换前必须检测并展示已有 PATH command；Skill 安装按用户选择 target 执行，`codex` / `cursor` / `gemini` / `opencode` / `copilot` 走 `.agents/skills/agentmesh/SKILL.md`，`claude` 走 `.claude/skills/agentmesh/SKILL.md`。验证：新增 `npm run cli:install-smoke`，clean tarball install smoke 在临时项目执行 `agentmesh --help`、`agentmesh doctor --json`、`agentmesh skill show`、`agentmesh skill install --target codex --force`、`agentmesh skill verify --target codex --json`；`node --test dist-node/tests-node/package-structure.test.js dist-node/tests-node/core-contracts.test.js dist-node/tests-node/readiness.test.js` 通过，69/69；`npm test` 通过，464/464；`npm run check:boundaries` 通过；`git diff --check` 通过。P5.1 的 DMG command-line shim 作为文档/contract smoke 固化，实际 app 入口和 DMG 验收留给 `P5.2`。审查结论：Cursor 初审 `PASS/LGTM`，接受 3 项 Should Fix（按已安装 host verify、app update 不触碰 PATH tarball CLI、tarball 文件名不写死）并处理相关 nit；follow-up `PASS/LGTM`，无剩余 Must/Should。日志：`changelog/2026-05-18.md` 已同步；commit：`docs: validate cli command install flow`；下一步：`P5.2`。
  - 收尾：同步日志并提交。
  - 提交：`docs: validate cli command install flow`

- [x] ~~P5.2 Desktop DMG 验收~~
  - Slice：`P5.2`
  - 依赖：P3 完成。
  - 文件：
    - `apps/studio-desktop/**`
    - `docs/distribution/**`
    - `README.md`
  - 目标：团队成员可以安装 DMG 并打开 Studio；如需入口 agent / skill 集成，由用户在 DMG 内选择安装 CLI 与一个或多个 skill target。
  - 动作：
    - 打包 internal unsigned DMG。
    - 记录 Gatekeeper 首次打开步骤。
    - 记录 quarantine fallback：`xattr -d com.apple.quarantine <app-or-dmg-path>`。
    - 验证没有全局 CLI 时 Desktop 仍可打开。
    - 验证有全局 CLI 时不会调用错版本。
    - 提供 `Install Agent Integrations` 或等价入口：
      - `Install Command Line Tool`：安装 PATH-visible `agentmesh` shim，必须先检测已有 PATH command 并要求用户确认。
      - `Install Agent Skill`：用户勾选目标宿主，不自动全装；可选 target 为 `codex`、`cursor`、`gemini`、`opencode`、`copilot`、`claude`。
      - target 路径：`codex` / `cursor` / `gemini` / `opencode` / `copilot` 写当前项目 `.agents/skills/agentmesh/SKILL.md`；`claude` 写当前项目 `.claude/skills/agentmesh/SKILL.md`。
      - 每个 target 独立执行 install/verify，失败只影响该 target，不阻塞未选择 target。
    - 明确 DMG-only 不满足入口 agent 调用；没有 PATH-visible CLI 时，skill 即使安装也不能调用 `agentmesh`。
  - 产出：DMG 验收记录、可选 CLI/skill 集成说明、安装确认和验证记录。
  - 验证：
    - package smoke。
    - no-global-cli smoke。
    - co-install smoke。
    - command-line tool install smoke。
    - 选定 target 的 skill install/verify smoke。
  - 审查方式：外审。
  - 审查判定依据：发布前高影响门禁，且会写 PATH command 和项目级 skill 文件。
  - 外审执行：至少一个 reviewer。
  - 外审失败策略：修复已接受问题；不可用则 needs_decision。
  - 证据：smoke 输出、截图或日志、review 输出。
  - 进度记录：状态：已完成；完成时间：2026-05-18；实现：Desktop DMG 资源表纳入可选 Agent Integrations 所需的 app-managed CLI / skills / package resources，但 Studio mutation 路径仍只走 App Server/runtime；Settings / Agent Integrations 新增 `Install Command Line Tool` 和 `Install Selected Skills`，命令行 wrapper 安装会检测 PATH-visible `agentmesh`、目标文件差异和 app-managed metadata，替换或 PATH shadowing 需要用户确认；Skill 安装由用户勾选 `codex`、`cursor`、`gemini`、`opencode`、`copilot`、`claude`，shared targets 写 `.agents/skills/agentmesh/SKILL.md`，Claude 写 `.claude/skills/agentmesh/SKILL.md`，每个 target 独立报告成功或失败；Desktop 安装 skill 时优先使用 app-bundled skill artifact，避免 workspace 内同名源码影响打包一致性。文档同步 DMG-only 只满足 Desktop Studio、入口 agent/skill 仍需要 PATH-visible CLI，且 wrapper 记录安装时 App 内部绝对路径，移动或更新 `AgentMesh.app` 后需要重新安装。验证：`npm run build && node --test dist-node/tests-node/studio-desktop-options.test.js dist-node/tests-node/studio-ui.test.js dist-node/tests-node/readiness.test.js dist-node/tests-node/package-structure.test.js dist-node/tests-node/core-contracts.test.js` 通过，118/118；`npm run studio-desktop:package:dev` 通过，`ok=true`、`issues=[]`；`npm run check:boundaries` 通过；`git diff --check` 通过；修复全量测试中旧 resource 断言后，`npm run build && node --test dist-node/tests-node/studio-desktop-distribution.test.js` 通过，6/6；`npm test` 通过，470/470。审查结论：Cursor 初审 `PASS/LGTM`，无 Must Fix；接受 5 项 Should Fix（effective bin/target confirmation、PATH shadowing UX、skill partial failure copy、Desktop bundled skill source、wrapper durability docs）并处理相关 nit；follow-up `LGTM for P5.2 closeout`，输出见 `docs/reviews/studio/p5.2-cursor-2026-05-18.md` 和 `docs/reviews/studio/p5.2-cursor-followup-2026-05-18.md`。日志：`changelog/2026-05-18.md` 已同步；commit：`a138a99 docs(distribution): validate internal dmg install`；下一步：`P5.Z`。
  - 收尾：同步日志并提交。
  - 提交：`docs(distribution): validate internal dmg install`

- [x] ~~P5.Z 项目收尾校准~~
  - Slice：`P5.Z`
  - 目标：确认计划完成、README/index/changelog/docs 同步、发布门禁明确。
  - 验证：
    - `npm run build`
    - `npm test`
    - Desktop package smoke。
    - CLI install smoke。
    - DMG command-line tool smoke。
    - 至少一个 shared target skill install/verify smoke 和 Claude target install/verify smoke。
    - `git diff --check`
  - 审查方式：外审。
  - 审查判定依据：总验收门禁。
  - 外审执行：至少一个 reviewer。
  - 外审失败策略：未通过则 not_ready；不可用则 needs_decision。
  - 证据：验证输出、review 输出、发布门禁结论。
  - 进度记录：状态：已完成；完成时间：2026-05-18；验证：`npm run build` 通过；`npm run studio-desktop:package:dev` 通过，`ok=true`、`issues=[]`；`npm run cli:install-smoke` 通过，1/1；`node --test --test-name-pattern "desktop command-line tool install|desktop skill install" dist-node/tests-node/studio-desktop-options.test.js` 通过，3/3，覆盖 DMG command-line wrapper、target replacement confirmation、shared target `codex` 与 Claude target install/verify；`npm test` 通过，470/470；`npm run check:boundaries` 通过；`git diff --check` 通过；`git status --short` 为空。shared target 等价类说明：`codex` / `cursor` / `gemini` / `opencode` / `copilot` 共用 `.agents/skills/agentmesh/SKILL.md` 写入逻辑，P5.Z smoke 以 `codex` 作为代表 target，`tests-node/readiness.test.ts` 的 target matrix 覆盖 shared targets 与 Claude 例外路径。审查结论：Cursor 初审指出 P5.Z/P5 门禁、P5.Z changelog 和 P5.2 commit 记录尚未同步，接受并在本收尾更新中修复；follow-up 确认上轮 Must 与原 Should 均已闭合，同时要求本收尾提交后核对 clean tree；输出见 `docs/reviews/studio/p5.z-cursor-2026-05-18.md` 和 `docs/reviews/studio/p5.z-cursor-followup-2026-05-18.md`。发布门禁：ready；未解决问题：无；残余风险：signed/notarized public distribution 仍不在本阶段范围，dev smoke 的 signing/notarization env 缺失为预期状态。日志：`changelog/2026-05-18.md` 已同步；commit：本收尾记录随 `release: validate agentmesh studio internal distribution` 提交落库；下一步：全部计划完成。
  - 提交：`release: validate agentmesh studio internal distribution`

## 7. 整体验证

- 自动化验证：
  - `npm run build:studio-frontend`
  - `npm run build`
  - `npm test`
  - `npm run agentmesh -- studio --port 4777 --no-open` 启动后，`/` 服务 React Web UI，且页面包含 `Runs` 和 `Calls`。
  - `npm run studio-desktop:sidecar:bundle`
  - `npm run studio-desktop:package:dev`
  - 边界检查脚本。
  - `npm pack --dry-run`
- 手工验证：
  - CLI `agentmesh --help`、`agentmesh doctor --json`。
  - DMG `Install Command Line Tool` 不覆盖已有 PATH command，用户确认后可安装/切换 PATH-visible `agentmesh`。
  - DMG `Install Agent Skill` 按用户选择安装 `codex` / `cursor` / `gemini` / `opencode` / `copilot` / `claude`，未选择 target 不写文件。
  - Studio Web runs/calls/catalog/agents/settings 基础浏览。
  - Desktop 打开、选择 workspace、启动 sidecar、调用 API。
  - 锁冲突、兼容冲突、未授权 token、旧 tab 重连。
- 文档验证：
  - `README.md`
  - `index.html`
  - `docs/distribution/*`
  - `changelog/2026-05-18.md` 或对应日期日志。
- 发布门禁：
  - `ready`：CLI 安装或 DMG command-line tool 安装、Desktop 打包、用户选择的 Skill target 安装/验证、co-install、lock/compat、安全 bootstrap 均通过；DMG-only 限制已明确说明。
  - `needs_decision`：外审不可用、某个平台未验证、用户要求公共 npm 但当前计划只覆盖内部团队分发。
  - `not_ready`：存在 `app-server -> cli` 写路径、Desktop 依赖全局 CLI、token 泄漏路径未修、包边界无法验证、PATH-visible CLI 安装不可验证、skill target 写入不可验证。

## 8. 风险与回滚

- 风险：先拆包再建边界，导致耦合复制到新目录。
  - 规避：P1 先做 workspace、import、发布形态门禁。
  - 回滚：回退拆包 commit，保留边界检查文档。
- 风险：本地 Web Studio 入口继续回退旧页面，导致 Calls tab、React UI 和真实 `/api/calls` 数据割裂。
  - 规避：P1.0 修复 `agentmesh studio` 默认 React assets，并用页面内容、assets、API 路由测试锁住。
  - 回滚：不保留旧页面降级；回退本 slice 时恢复到未完成状态，并保持 `agentmesh studio` React 入口为 blocked，直到 P1.0 修复。
- 风险：P2.2 拆出 `apps/studio-web` 后，P1.0 固化的默认 assetDir 路径失效。
  - 规避：P2.2 显式迁移默认 assetDir 到新构建产物路径，并复跑 `agentmesh studio` React UI smoke。
  - 回滚：恢复 P1.0 路径 resolver，并把新路径作为显式 `assetDir` 传入，直到测试补齐。
- 风险：`agentmesh call --prompt-file` 再次只把文件路径传给 provider，导致外审空输入或失败。
  - 规避：P1.1 用 adapter invocation 测试覆盖 `--prompt-file` 归一化到 prompt text，并保留 `prompt_source=file` 证据。
  - 回滚：外审门禁标记 blocked；`--prompt` 内联调用只能作为辅助参考，不作为通过依据。
- 风险：App Server 和 CLI 出现双写。
  - 规避：P2.3 必须直接实现 runtime 程序化 API。
  - 回滚：不保留 CLI 写路径；对应 Studio mutation 标记为 blocked，直到 runtime API 补齐。
- 风险：Desktop token 泄漏或本地服务被误连。
  - 规避：P3.2 处理 token、Host/Origin/CORS。
  - 回滚：Desktop mutation 暂停，只允许只读浏览。
- 风险：CLI 发版快于 DMG，导致 workspace 被新 CLI 写入后旧 Desktop 只读。
  - 规避：compatibility metadata 和 Settings/About 升级提示。
  - 回滚：旧 Desktop 维持只读，不做 mutation。
- 风险：skill 路径再次漂移。
  - 规避：`packages/skills` 单一模板源和 target verify；DMG 只提供用户选择的 target，不自动全装。
  - 回滚：保留 legacy 文件，不自动删除。
- 风险：用户只安装 DMG 后误以为入口 agent / skill 可直接调用 AgentMesh。
  - 规避：P5.1/P5.2 明确 DMG-only 只满足 Desktop Studio；入口 agent / skill 必须有 PATH-visible `agentmesh`，并按用户选择安装对应 skill target。
  - 回滚：隐藏 agent integration CTA，只保留 Desktop Studio；文档标记入口 agent 集成为 blocked。

## 9. 当前下一步

- 当前下一步：无，当前计划全部完成。
