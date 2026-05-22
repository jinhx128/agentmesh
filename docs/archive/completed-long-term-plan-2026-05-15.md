# 已完成长期计划归档 - 2026-05-15

本文件从 `plan.md` 抽出已经完成的短期计划摘要和长期 L1-L8 执行历史，避免主计划继续被历史证据淹没。

## 已归档短期计划

短期 S1-S7 已完成，详细执行历史已从本文件抽出归档，避免当前计划被历史任务淹没。

- 归档文件：`docs/archive/short-term-plan-2026-05-14.md`。
- 当前事实：TS/Node CLI 是唯一目标命令面；Python runtime 已 decommission；短期 flow resume/retry、handoff、release-check、doctor、skill verify、本地 workflow、TS write-side runtime 和最终 release gate 已完成。
- 后续执行：只看下方长期计划，从第一个未完成 slice 开始，按 checkpoint 流程完成、验证、review、同步日志并 commit。

## 长期计划

长期工作继续使用和短期一样的 checkpoint 流程：

- 一次只做一个 slice。
- 同一个 slice 里同步更新 tests 和 docs。
- 运行 slice-specific verification 加 `make check`。
- 完成前做 self-review。
- 需要外审时先保存 prompt/output/findings，再核对事实。
- 同步 `changelog/`。
- commit 后再开始下一个 slice。

README 和根目录 `index.html` 不再跟随每个 `Lx.y` 小 slice 更新；只有完成一个大
版本阶段（例如 L3.8 dogfood 后 L3 完成）时，才做一次全量产品说明和主页更新。
小 slice 只同步必要 contract docs、`plan.md`、`changelog/` 和测试证据。

每个 slice 都应该小到能独立完成、验证和 commit。如果某个 slice 变大，就先拆分再实现。

### 当前长期状态

- [x] L1 Context Provenance 已完成。
- [x] L2 Config Layering And Registry Scope 已完成。
- [x] L3 MCP Client Hardening 已完成。
- [x] L4 Adapter Registry And Promotion 已完成。
- [x] L5 Role Flow And Review Lifecycle 已完成。
- [x] L6 AgentMesh Context Protocol 已完成。
- [x] L7 Corrections Feedback Loop 已完成。
- [x] L8 Studio 已完成。

### L1. Context Provenance

状态：已完成。

证据：

- [x] ~~给 context entries 增加 provenance metadata：source type、source path / URI / command、capture timestamp、freshness、owner、validation state、ingestion error、redaction state。~~ 证据：`ContextProvenanceSchema` 和 `context.md` 中的 provenance blocks。
- [x] ~~覆盖 context file、diff file、verification file、scoped git diff 和 MCP resource inputs。~~ 证据：`tests-node/write-side-runtime.test.ts` 覆盖 local files、explicit diff、verification evidence、scoped git diff 和 provenance-only MCP resource entries。
- [x] ~~让 stale 或 failed context 对入口 agents 可见。~~ 证据：failed MCP resource capture 会带 `validation_state = "failed"` 和 `ingestion_error` 写入；failed file/git captures 走同一条 metadata path。
- [x] ~~为 provenance metadata 增加 validation tests。~~ 证据：`core exports context provenance schema`、`workflow run creates dynamic stage packets with context inputs` 和 `workflow run records scoped git diff provenance`。

### L2. Config Layering And Registry Scope

目标：让 agent 注册成为用户/电脑级能力，让项目配置只放项目事实和项目策略，避免每个项目重复注册同一个本机 agent。

为什么先做：L3 MCP、L4 adapter registry、L5 role flow 都会依赖配置读取。如果配置层不先定清楚，后面会在项目级 config 和用户级 agent registry 之间反复改。

入口门槛：

- L1 provenance 已完成。

目标配置模型：

- 用户级：`~/.config/agentmesh/config.toml`
  - 默认写入 agents。
  - 保存本机 CLI adapter、command path/default args、model、reasoning effort、aliases、capabilities。
  - 不保存 token、session 或登录态。
- 用户级 workflow：`~/.config/agentmesh/workflows/*.toml`
  - 保存个人跨项目复用 workflow。
  - 不保存项目路径、项目 secrets 或项目专属事实。
- 项目级：`./.agentmesh/config.toml`
  - L2 先保存 `mcp_servers`、workflow defaults、context policy 和 local workflow registry settings。
  - project spec/corrections 仍是最终目标层级，但由 L6/L7 定义实际 contract。
  - 可以入库，但不得包含个人 token 或 session。
- 项目级 workflow：`./.agentmesh/workflows/*.toml`
  - 保存项目/团队专属 workflow。
  - 可以引用用户级 agent ids，但不能复制用户级 agent 定义。
- 显式层：`--config <path>` 或 `$AGENTMESH_CONFIG`
  - 作为最高优先级 overlay，用于 CI、实验或临时覆盖。
  - 不再让项目 config 遮住用户 agents。
- 显式 workflow：`--workflow-file <path>`
  - 作为一次性 workflow input，用于临时流程。
  - 不进入 user 或 project workflow registry。
  - 和 `--workflow <id>` 互斥。
  - 在 packet 创建前完成 schema 校验和 referenced agent id 校验。
  - run packet 记录 resolved workflow source、normalized path、hash、schema version。
- Packet：
  - run 创建时记录 resolved assignment。
  - 记录必要 config/workflow provenance，例如 agent id、adapter id、model、config source layer、workflow source layer。
  - 不把凭证、session 文件或敏感 env 写进 packet。

Deliverables：

- `docs/contracts/config-layering.md`。
- Layered config loader。
- Layered workflow registry。
- Temporary `--workflow-file` input。
- `agents add/list` 的 scope 语义。
- Doctor 的 layered config report。
- Workflow defaults 支持每阶段一个或多个 agent ids。
- Stage assignment 数据形状支持一个或多个 agent ids。
- 基础 context policy 的配置位置。
- README / homepage 的安装和更新说明同步。

Slices：

- [x] ~~L2.1 盘点当前 config 读取/写入路径。验收：在 `docs/contracts/config-layering.md` 记录现状、目标层级、破坏性变化和不迁移理由。~~ 证据：`docs/contracts/config-layering.md` 记录当前 single-file config、workflow registry 现状、目标分层、破坏性变化和 L2 slice map；`tests-node/core-contracts.test.ts` 纳入 contract doc 存在性检查。
- [x] ~~L2.2 实现 layered config loader。验收：按 `builtin defaults -> user -> project -> explicit overlay` 合并；测试覆盖只有用户配置、只有项目配置、两者共存、`--config` 覆盖和 `$AGENTMESH_CONFIG` 覆盖。~~ 证据：`packages/runtime/src/config.ts` 改为 user -> project -> explicit overlay 分层 merge；`tests-node/config-layering.test.ts` 覆盖用户层、项目层、两层共存、`--config` overlay 和 `$AGENTMESH_CONFIG` overlay；`tests-node/cli-surface.test.ts` 更新 env overlay 断言并隔离测试 HOME。
- [x] ~~L2.3 实现 layered workflow registry。验收：按 built-in、`~/.config/agentmesh/workflows/*.toml`、项目 `.agentmesh/workflows/*.toml` 解析；human/JSON `workflows list/show` 输出 workflow source layer；同名 workflow 冲突 fail fast。~~ 证据：`packages/runtime/src/workflow/registry.ts` 将 workflow source 拆为 `builtin` / `user` / `project`；`workflowSearchDirs` 读取用户级和项目级 workflow 目录；`tests-node/workflow-registry.test.ts` 覆盖 user+project registry、跨层重复 id、CLI JSON/human source layer。
- [x] ~~L2.4 明确 config merge 规则。验收：agents 默认从用户层读取；项目层可以定义 workflow defaults 和 MCP servers；workflow defaults 用裸 agent id 字符串引用用户级 agents；项目层不能重新定义同名 agent，发现冲突必须 fail fast；数组字段的 replace/append 规则有测试。~~ 证据：`packages/runtime/src/config.ts` 支持 `[workflow_defaults.<workflow-id>]`，校验 workflow defaults 引用已解析 agent；重复 `agents` / `mcp_servers` 跨层 fail fast；workflow default arrays 明确 replace lower layer；`tests-node/config-layering.test.ts` 覆盖重复 agent、重复 MCP、裸 agent id workflow defaults、数组 replace 和 unknown agent。
- [x] ~~L2.5 支持 temporary workflow。验收：`agentmesh run --workflow-file <path>` 可创建一次性 run；该 workflow 不进入 registry；packet 记录 workflow source、normalized path、hash 和 schema version；workflow file 在 packet 创建前 schema validate；引用的 agent ids 不存在时 fail fast；`--workflow` 与 `--workflow-file` 同时传入时报错。~~ 证据：`packages/cli/src/cli.ts` 支持 `--workflow-file` 并与 `--workflow` 互斥；`packages/runtime/src/workflow/registry.ts` 暴露 `loadWorkflowFile`；`packages/runtime/src/flow.ts` 写入 `workflow_source` provenance；`tests-node/write-side-runtime.test.ts` 覆盖临时 workflow packet provenance、不进入 registry、互斥和未知 agent fail fast。
- [x] ~~L2.6 调整 `agents add` 写入语义。验收：不带 `--scope` 默认写入用户 config；`--scope user` 等价默认；`--scope project` 只有显式传入时才写项目 config，并在输出中提示项目 agent 不适合存个人凭证。~~ 证据：`packages/runtime/src/config.ts` 新增 `configPathForAgentWrite`；`packages/cli/src/cli.ts` 支持 `agents add --scope user|project`，默认 user，project scope 输出个人凭证提醒；`tests-node/cli-surface.test.ts` 覆盖默认用户级写入、env overlay 仍可见、project scope 写入和非法 scope。
- [x] ~~L2.7 调整 `agents list` 和 `doctor`。验收：human 和 JSON 输出都能显示 agent/config source layer；doctor 对 missing referenced agents、shadowed ids、duplicate workflows、malformed layer 给出 actionable hint。~~ 证据：`packages/runtime/src/config.ts` 暴露 `loadConfigWithSources`；`packages/runtime/src/adapters.ts` 保留 agent source metadata；`agents list [--json]` human/JSON 输出 `source_layer`；`doctor` JSON/human 输出 `config_layers` 和 agent source，并对 malformed config、missing referenced agent、duplicate agent id、duplicate workflow registry 给出 diagnostic/hint；`tests-node/cli-surface.test.ts` 和 `tests-node/readiness.test.ts` 覆盖。
- [x] ~~L2.8 增加 workflow defaults。验收：项目 config 可声明某 workflow 默认 plan/execute/review/decide agent ids；`agentmesh run --workflow <id> --task ...` 可少传已配置角色；packet 仍写入 resolved assignment。~~ 证据：`packages/cli/src/cli.ts` 在 required role 校验前应用 `[workflow_defaults.<workflow-id>]`，CLI 参数优先；`tests-node/write-side-runtime.test.ts` 覆盖 `release-check` 从 config 默认填充 review/decide，`status.json` 写入 resolved assignment。
- [x] ~~L2.9 支持多 agent stage assignment 数据形状。验收：每个 stage assignment 可以是一到多个 agent ids；L2 只负责解析、校验、写入 resolved assignment；fanout dispatch 执行语义 deferred to L5。~~ 证据：`flow run` 支持四个 stage 的重复 role flags 和 workflow defaults 数组；`status.json.stage_assignments` 与 `assignment.toml` `[stage_assignments]` 写入 resolved arrays；非 review 多 agent dispatch 明确报错 deferred to L5；`tests-node/write-side-runtime.test.ts` 覆盖。
- [x] ~~L2.10 更新 `init` 和文档。验收：默认推荐用户级 agents + 用户级 reusable workflows + 项目级 `.agentmesh/config.toml` / `.agentmesh/workflows`；README 和 `index.html` 不再暗示每项目重复注册 agents 或 workflows。~~ 证据：`agentmesh init` 默认写 `.agentmesh/config.toml`、创建 `.agentmesh/workflows/` 并维护项目 `.gitignore`；README 与 `index.html` 的 quickstart/usage 改为用户级 agents、用户级 reusable workflows、项目级 config/workflows。
- [x] ~~L2.11 Dogfood。验收：在本仓库用用户级 fake command agent、用户级 reusable workflow、项目级 workflow/MCP config 和一次 `--workflow-file` 临时 workflow 创建 run packet，`flow status --json` 和 `packet validate --json` 通过。~~ 证据：使用隔离 HOME 模拟用户级 `dogfood_worker` command agent 和 `user-dogfood` workflow，在本仓库临时放置项目级 `project-dogfood` workflow / MCP config，并用 `temp-dogfood` workflow file 创建 `l2-11-user-dogfood`、`l2-11-project-dogfood`、`l2-11-temp-dogfood` 三个 run；三者 `packet validate --json` 均 ok，`flow status --json` 均返回 `created`。

Out of scope：

- Remote registry。
- Credential storage。
- Secret manager。
- Team-shared personal agent profiles。
- Config UI。
- 复杂多 profile workspace 切换；如需要，后续再加。

### L3. MCP Client Hardening

目标：让 MCP resources 成为真正的 context inputs，同时不引入 MCP server mode、后台 daemon 或隐藏状态。

入口门槛：

- L2 layered config 完成。
- 项目级 `.agentmesh/config.toml` 可以稳定提供 `[mcp_servers.<id>]`。
- `--mcp-resource` 的早失败、成功 capture 和 failed provenance 都由
  `tests-node/write-side-runtime.test.ts` 覆盖。

先锁定 L3 的局部设计：

- MCP server config 读取项目级 `.agentmesh/config.toml` 的 `[mcp_servers.<id>]`，允许 explicit overlay 覆盖。
- MCP client 放在 `packages/runtime/src/mcp/`，CLI 只做参数解析和输出。
- `flow run` 通过可重复的 `--mcp-resource <server-id>:<resource-uri>` 声明要读取的 resources。
- 单次 run 最多读取 10 个 MCP resources。
- 同一 run 内，同一 server 只启动一个 stdio process，按 resource 顺序串行读取，结束后关闭 process；L3 不做并发读取。
- 默认 `initialize` 超时 5 秒，`resources/read` 超时 10 秒。
- 单个 text resource 最大 256 KiB；超过上限时不截断，记录 `resource_too_large`。
- Inventory 每个 server 最多展示 50 条 resource hints；inventory 不调用 `resources/read`。

Deliverables：

- TS stdio MCP JSON-RPC client。
- Resource inventory command 或 internal helper。
- MCP failure classification。
- 成功/失败 context provenance。
- `tests-node/fixtures/mcp/` fake MCP servers。

Slices：

- [x] ~~L3.1 实现 MCP resource spec parsing。验收：`<server-id>:<resource-uri>` valid/invalid cases 有测试，invalid specs 在 packet creation 前失败。~~ 证据：`packages/runtime/src/mcp/resource.ts` 解析 `<server-id>:<resource-uri>` 并校验 server id / URI；CLI 在 `createFlowRun` 前调用解析；`tests-node/mcp-resource.test.ts` 覆盖 valid/invalid cases，`tests-node/write-side-runtime.test.ts` 覆盖 malformed `--mcp-resource` 不创建 packet。
- [x] ~~L3.2 校验 `[mcp_servers.<id>]` config entries。验收：missing command、non-string args、whitespace ids、colon ids、unknown server id 都有 actionable error。~~ 证据：`loadConfig` 校验 MCP server id、required `command` 和 string-list `args`；CLI 在 packet creation 前校验 `--mcp-resource` 引用已配置 server；`tests-node/config-layering.test.ts` 和 `tests-node/write-side-runtime.test.ts` 覆盖。
- [x] ~~L3.3 实现最小 stdio JSON-RPC lifecycle。验收：fake server 覆盖 `initialize`、`initialized` notification、`resources/read`、process close。~~ 证据：当时 `packages/runtime/src/mcp/client.ts` 实现最小 stdio JSON-RPC client，`tests-node/fixtures/mcp/fake-server.ts` 和 `tests-node/mcp-client.test.ts` 覆盖 initialize、initialized、resources/read 和 close；后续 L5.13 已把 stdio wire 替换为 official MCP SDK transport。
- [x] ~~L3.4 落实边界。验收：resource 数量上限、initialize/read 超时、256 KiB text 上限、同 server 单 process 复用都有测试。~~ 证据：`assertMcpResourceCount` 限制单次 run 最多 10 个 MCP resources；`readMcpTextResources` 复用同一 stdio process 串行读取同 server resources；client options 覆盖 initialize/read timeout 和 256 KiB text byte limit；`tests-node/mcp-client.test.ts` 与 `tests-node/write-side-runtime.test.ts` 覆盖。
- [x] ~~L3.5 分类 MCP failures。验收：`server_start_failed`、`initialize_failed`、`resource_not_found`、`non_text_resource`、`resource_too_large`、`timeout`、`invalid_json_rpc`、`unknown` 全部写入 provenance `ingestion_error`。~~ 证据：`packages/core/src/index.ts` 定义 MCP failure classification schema；`packages/runtime/src/mcp/client.ts` 用 `McpClientError`、`mcpFailureClassification` 和 `mcpIngestionError` 传递分类；当前 deferred MCP provenance 也写入 `unknown: ...` 形状；`tests-node/mcp-client.test.ts` 和 `tests-node/write-side-runtime.test.ts` 覆盖 server startup、initialize、not found、non-text、too large、timeout、invalid JSON-RPC、unknown 和 context provenance。
- [x] ~~L3.6 实现 resource inventory。验收：CLI 能列出 configured server 和最多 50 条 configured/listed resource hints；不发起 `resources/read`。~~ 证据：`agentmesh mcp inventory [--json]` 输出 configured MCP servers、source layer、config hints 和 `resources/list` hints；每 server 最多 50 条 hints；fake MCP server 日志验证只调用 initialize、initialized、resources/list 和 close，不调用 `resources/read`；`tests-node/mcp-inventory.test.ts` 覆盖 list 成功和 list 失败保留 configured hints。
- [x] ~~L3.7 替换 provenance-only placeholders。验收：MCP read 成功时写入 captured text；失败时保留 failed provenance；两种 packet 都可 validate。~~ 证据：`flow run --mcp-resource` 在 packet 创建时按 configured MCP server 读取 text resource；成功写入 `context.md` 且 provenance 为 `ok`；失败保留 `failed` provenance 和 MCP classification；成功/失败 packet 都通过 `packet validate --json`；`tests-node/write-side-runtime.test.ts` 覆盖。
- [x] ~~L3.8 Dogfood。验收：用 local fake server 创建真实 packet，读取 MCP text 到 `context.md`，运行 `packet validate --json`。~~ 证据：用构建后的 TS CLI 和本地 fake MCP server 创建 `l3-8-mcp-dogfood` packet；`context.md` 包含 `Hello from fake MCP: memory://dogfood`；`packet validate --json` 返回 `ok: true`；L3 完成后同步 README 和根目录 `index.html`。

Out of scope：

- MCP server mode。
- Remote registry。
- Long-running MCP daemon。
- Non-text resource rendering。
- Hidden memory。

### L4. Adapter Registry And Promotion

目标：在提供 public adapter SDK 之前，先让 adapter behavior 明确、可测试、内部模块化。

入口门槛：

- L2 layered config 完成。
- Doctor 已能报告 config source layer。
- 现有 adapter invocation schemas 仍在 `packages/core`，runtime 实现还未拆 registry。

Deliverables：

- Runtime adapter registry。
- Built-in adapters module boundary。
- Adapter metadata source of truth。
- Doctor readiness 与 adapter metadata 对齐。
- `current` host-only 语义稳定。

Slices：

- [x] ~~L4.1 复核 P0 adapter invocation schemas。验收：对照 write-side runtime 和 dogfood packets，只在实际 mismatch 时更新 docs/schema。~~ 证据：复核 `packages/core` 的 `AdapterInvocationInput/Output` schema、当前 `packages/runtime/src/adapters.ts` write-side 调用路径和 dogfood packet 事实；未发现需要改 core schema 的 mismatch；补齐 `docs/contracts/adapter-invocation.md`，并纳入 contract docs existence test。
- [x] ~~L4.2 建 runtime adapter registry。验收：registry unit tests 覆盖 lookup、aliases、unsupported adapter、capability metadata。~~ 证据：新增 `packages/runtime/src/adapters/registry.ts`，定义 runtime adapter metadata、alias normalization、lookup、unsupported adapter fail-fast 和 AI CLI capability metadata；`tests-node/adapter-registry.test.ts` 覆盖 lookup、aliases、unsupported adapter、capability metadata。
- [x] ~~L4.3 拆 built-in adapters 到 `packages/runtime/src/adapters/`。验收：CLI behavior 不变；`codex-cli`、`claude-code-cli`、`gemini-cli`、`opencode-cli`、`command` 都走 registry。~~ 证据：`packages/runtime/src/adapters.ts` 的 legacy `listAdapters`、agent registration defaults、adapter alias normalization 和 AI CLI detection 已改为引用 `packages/runtime/src/adapters/registry.ts`；`tests-node/adapter-registry.test.ts` 增加 legacy surface backed by registry 结构性回归，目标测试同时覆盖 `agents add` 和 built-in AI CLI 调用。
- [x] ~~L4.4 统一 invocation preparation。验收：每个 adapter 都有 prompt passing、model args、reasoning args、stdout/file output、non-interactive mode tests。~~ 证据：新增 `packages/runtime/src/adapters/invocation.ts`，集中准备 adapter command、stdin、stdout capture、output-file args、canonical adapter id 和 non-interactive metadata；`runAgentCall` 改为复用该 helper；`tests-node/adapter-invocation.test.ts` 覆盖 `command`、`codex-cli`、`claude-code-cli`、`gemini-cli`、`opencode-cli` 的 prompt/model/reasoning/output/non-interactive 行为。
- [x] ~~L4.5 对齐 doctor readiness。验收：doctor 不再独立重复 adapter defaults；readiness classification 从 adapter metadata 派生或引用。~~ 证据：`packages/runtime/src/doctor/readiness.ts` 改为复用 `normalizeAgents`、`prepareAdapterInvocation` 和 `lookupRuntimeAdapter`；删除 doctor 本地 `adapterDefaults` / `modelArgs` / auth probe preparation；`tests-node/readiness.test.ts` 覆盖 alias normalization、shared invocation auth probe 和 source-level 防回退检查。
- [x] ~~L4.6 固化 `current` 语义。验收：`call --agent current` 和 worker dispatch to `current` fail with guidance；`flow prompt/attach` 支持 current stages。~~ 证据：`runAgentCall` 对 `--agent current` 早失败并给出 host-only / prompt / attach guidance；`dispatchOneStage` 对 assigned `current` 的 explicit worker dispatch 给出同类 guidance；`tests-node/cli-surface.test.ts` 和 `tests-node/write-side-runtime.test.ts` 覆盖 call、dispatch、prompt 和 attach。
- [x] ~~L4.7 评估 `packages/adapters`。验收：只有出现第二个真实 consumer 或第三方 adapter fixture 后才 promote；否则记录 deferred decision。~~ 证据：新增 `docs/decisions/adapter-package-promotion.md`，记录 `Decision: deferred`、promote gates 和 revisit triggers；`tests-node/package-structure.test.ts` 确认当前不存在 `packages/adapters`，且决策文档包含 second real consumer / third-party adapter fixture 条件；L4 完成后同步 README 和根目录 `index.html`。

Out of scope：

- Public adapter SDK。
- Remote model brokerage。
- Per-user credential management。
- 在 AgentMesh 内保存底层 CLI 登录态。

### L5. Role Flow And Review Lifecycle

目标：让 multi-agent planning、execution、review、decision 和 handoff 可以跨入口 agents 重复执行，并让 review output 在主控核对前不能变成事实。

边界：本仓库不把用户私有的 `my-review-center` skill 直接搬进来。AgentMesh 只提供内置 review workflow recipe、reviewer registry metadata 和 packet artifact model，外部 skill 可以读取或同步这些元数据。

入口门槛：

- L2 layered config 完成。
- L4 adapter registry 至少完成 internal registry 和 `current` 语义。
- release-check summary 已能读取 findings/decision。

Deliverables：

- Versioned AgentMesh Skill。
- Versioned workflow recipes。
- Bounded prompt assembly and context freshness policy。
- Run single-writer lock / lease。
- Review artifact model。
- Reviewer registry metadata。
- Stage fanout dispatch contract。
- Accepted/rejected/unresolved findings integration。

Slices：

- [x] ~~L5.1 给 AgentMesh Skill output 增加 version metadata。验收：installed/exported Skill 声明 AgentMesh CLI、packet schema、workflow recipe versions。~~ 证据：`agentmeshSkillMarkdown()` 动态插入 `Version Metadata` block；`skill show`、`skill export --format markdown` 和 `skill install --target claude` 输出/写入同一份 metadata；新增 `docs/contracts/skill-output.md`；`tests-node/readiness.test.ts` 与 `tests-node/core-contracts.test.ts` 覆盖。
- [x] ~~L5.2 给 workflow recipe 增加 version metadata。验收：local workflow TOML 校验 version fields 和 compatibility policy。~~ 证据：`WorkflowSchema`、built-in workflows、local/temporary workflow TOML 都包含 `workflow_recipe_version = 1` 与 `compatible_packet_schema_versions = [1]`；registry 对缺失、未来 recipe version、不兼容 packet schema 早失败；temporary workflow provenance 写入三项版本 metadata；`tests-node/workflow-registry.test.ts`、`tests-node/write-side-runtime.test.ts`、`tests-node/core-contracts.test.ts` 覆盖。
- [x] ~~L5.3 在 workflow run creation 中加入 compatibility checks。验收：更新且未知的 workflow/packet versions 清晰失败。~~ 证据：`createFlowRun()` 新增 `workflowCompatibility` gate，在创建 run directory 前拒绝 future `schemaVersion`、future `workflowRecipeVersion` 和不包含当前 packet schema 的 `compatiblePacketSchemaVersions`；CLI `flow run` 传入 workflow metadata；`tests-node/write-side-runtime.test.ts` 覆盖不写入 partial packet。
- [x] ~~L5.4 定义 reviewer registry metadata。验收：reviewer id、label、adapter target、expected output format、availability/unavailability record 都有 schema/test。~~ 证据：`ReviewerRegistrySchema`、`ReviewerRegistryEntrySchema` 和 `ReviewerAvailabilityRecordSchema` 定义 reviewer id、label、adapter target、expected output format、availability state/reason；`buildReviewerRegistry()` 从已注册 agents 派生 available/unavailable records；`agentmesh reviewers list [--json]` 输出 registry；`docs/contracts/reviewer-registry.md` 与 `tests-node/reviewer-registry.test.ts` 覆盖。
- [x] ~~L5.5 形式化 Review Center workflow recipe。验收：repo 内有一个维护源可供 CLI 和外部 skill 对齐，且不要求迁移用户私有 skill。~~ 证据：新增 `docs/workflows/review-center.toml` 作为仓库内 canonical recipe；内置 `review-center` workflow 暴露 `recipeSource = "docs/workflows/review-center.toml"`；`agentmesh workflows show review-center` 的 human/JSON 输出都能看到该源；测试校验 TOML 源与运行时内置 recipe 完全对齐，并明确私有 Review Center skill 可读取/同步元数据但不需要迁移。
- [x] ~~L5.6 定义 prompt assembly 和 context freshness policy。验收：contract 写清 prompt snapshot、live working tree、context freeze/refresh、release-summary derived refresh、per-stage/per-adapter budget 和 redaction posture。~~ 证据：新增 `docs/contracts/prompt-assembly.md`，明确 `flow prompt` 与 dispatch prompt snapshot 的 observation surface、live working tree 非冻结边界、context freeze/refresh 规则、release-summary derived refresh、per-stage/per-adapter budget policy 和 redaction posture；`tests-node/core-contracts.test.ts` 覆盖关键术语。
- [x] ~~L5.7 增加 run single-writer lock。验收：同一 run 的 `status.json`、`events.jsonl`、`artifacts.toml` 和 stage outputs 在 CLI mutation 时受 lock/lease 保护；并发 dispatch/attach/retry 给出明确错误或等待策略。~~ 证据：新增 `packages/runtime/src/packet/lock.ts`，用原子 `.agentmesh.lock/lease.json` lease 实现 single-writer mutation lock；`flow attach`、`flow dispatch`、`flow retry`、`flow resume`、release-check prompt refresh 和 `release-check summary --write` 都走同一把锁；active lease 给出 `run is locked` 诊断，expired lease 可回收；新增 `docs/contracts/run-lock.md` 和 `tests-node/write-side-runtime.test.ts` / `tests-node/core-contracts.test.ts` 覆盖。
- [x] ~~L5.7.1 轻量结构拆分 checkpoint。~~ 证据：三个 checkpoint 已完成；runtime flow/release verdict、CLI router/commands/flags、write-side runtime tests 均已拆分；最终验证通过：`npm test` 131 passed，packet fixture validate `ok: true`，`git diff --check` 干净。验收原文：在不改变 CLI/runtime 行为、不引入新 contract 的前提下，把超长多职责文件拆到稳定模块边界；`packages/runtime/src/flow.ts` 直接替换为 `packages/runtime/src/flow/` 目录，不保留任何 `flow.ts` re-export 兼容层；新目录包含 `create.ts`、`context-pack.ts`、`prompt.ts`、`dispatch.ts`、`state.ts`、`raw-reviews.ts`、`index.ts` 等模块，其中 `raw-reviews.ts` 只搬迁当前 `refreshFindingsRawReviews` / `rawReviewOutputs` / `RAW_REVIEW_OUTPUTS_HEADING` 等已有 helper，不提前实现 L5.8 的统一 review artifact model；release verdict parser、verdict constants 和 `updateReleaseVerdict` 放到 `packages/runtime/src/release/verdict.ts`，不顺手重构 `release/check.ts`，文件内部要清楚分组纯 parser/constants 和副作用 `updateReleaseVerdict`；`packages/runtime/src/index.ts` 从 `export * from "./flow.js"` 改为 `export * from "./flow/index.js"`，public exports 保持等价，CLI/tests 内部 imports 同步更新到新模块边界；`packages/cli/src/cli.ts` 拆为薄 router、`packages/cli/src/flags.ts` 和 `packages/cli/src/commands/*`，`flags.ts` 只搬迁 commands 共用的现有 arg parsing helpers，不新增 parsing 语义，命令专属解析留在各自 command 文件；`tests-node/write-side-runtime.test.ts` 拆为 `flow-run.test.ts`、`flow-context.test.ts`、`flow-dispatch.test.ts`、`flow-retry-resume.test.ts`、`release-check-flow.test.ts`，其中 MCP/context capture 进 `flow-context.test.ts`，workflow-file / compatibility / role defaults 进 `flow-run.test.ts`，current/capability-gating/single-writer lock 进 `flow-dispatch.test.ts`，retry/resume 进 `flow-retry-resume.test.ts`，release verdict 和 release summary flow 进 `release-check-flow.test.ts`；共享测试 helper 固定为 `tests-node/helpers/write-side-runtime.ts`，只搬迁现有内联 helper，不新增断言或 fixture；先不顺手重构 `adapters.ts`，只记录后续收口点，避免一次 refactor 过大。执行顺序分三个 checkpoint commit：先拆 runtime flow/release verdict，再拆 CLI router/flags/commands，最后拆测试文件。验证：每个 checkpoint 至少跑相关 targeted tests；CLI checkpoint 需要在拆分前后捕获 `agentmesh --help` 和所有 top-level / known subcommand help 或 usage 输出，diff 必须为空或只包含预期路径变化；L5.7.1 收口必须跑 `npm run build`、`npm test`、`node dist-node/packages/cli/src/cli.js packet validate tests-node/fixtures/packets/valid-basic --json` 和 `git diff --check`；自审确认是机械移动/导入更新，未改变 CLI 行为。
  - [x] Checkpoint 1：runtime flow / release verdict 拆分。证据：`packages/runtime/src/flow/` 接管 run creation、context pack、prompt、dispatch、stage state 和 raw reviews；`packages/runtime/src/release/verdict.ts` 接管 release verdict parser 与状态写入；runtime public export、CLI import 和测试 import 已改到 `flow/index.js`；`npm run build` 与 flow/release targeted tests 通过。
  - 记录：Checkpoint 1 外审仅提示未来可考虑把 `setStageState` 下沉到 packet status helper，当前没有真实循环依赖，不阻塞后续 checkpoint。
  - [x] Checkpoint 2：CLI router / flags / commands 拆分。证据：`packages/cli/src/cli.ts` 降为薄 router，命令实现移动到 `packages/cli/src/commands/*`，共享 arg helper 移到 `packages/cli/src/flags.ts`；拆分前后 CLI usage/help 快照 diff 为空；`npm run build` 与 CLI targeted tests 通过。
  - [x] Checkpoint 3：write-side runtime tests 拆分。证据：`tests-node/write-side-runtime.test.ts` 拆为 `flow-context.test.ts`、`flow-run.test.ts`、`flow-dispatch.test.ts`、`flow-retry-resume.test.ts`、`release-check-flow.test.ts`，共享 helper 固定在 `tests-node/helpers/write-side-runtime.ts`；拆分后的 targeted tests 通过。
- [x] ~~L5.8 持久化统一 review artifacts。~~ 证据：新增 `packages/runtime/src/review/artifacts.ts` 作为 review artifact 统一 helper，`reviews/<reviewer>.md` 记录 raw reviewer output，`findings.md` 追加可去重的 `Raw Review Outputs` 可见区，`decision.md` 常量由同一模块提供；`flow dispatch`、`release-check summary` 和 `review-center` workflow recipe 统一到该契约；新增 `docs/contracts/review-artifacts.md`，并同步 packet layout / artifacts TOML contract；验证通过：`npm run build`，review/release/dispatch targeted tests 21 passed。
- [x] ~~L5.9 定义 fanout dispatch contract。~~ 证据：新增 `docs/contracts/stage-dispatch.md`，写清 `single` / `fanout` dispatch modes、canonical single outputs、fanout prompt/output slots、reviewer isolated visibility、partial failure evidence preservation、per-agent retry 和 decider aggregation；`tests-node/core-contracts.test.ts` 覆盖关键术语；验证通过：`npm run build`，`node --test dist-node/tests-node/core-contracts.test.js` 6 passed。
- [x] ~~L5.10 实现 review fanout。~~ 证据：review fanout 为每个 reviewer 写入独立 prompt slot `prompts/review/<reviewer>.md`、独立 raw output `reviews/<reviewer>.md` 和独立 prompt/review artifacts；reviewer 失败时保留已完成 reviewer raw output，在 `findings.md` 的 Needs Decision 中记录失败 reviewer，并把 partial evidence 暴露给 decide prompt；验证通过：`npm run build`，flow/retry/release/review targeted tests 19 passed，`make check` 135 passed，`git diff --check` 干净。
- [x] ~~L5.11 强制 controller verification。~~ 证据：`release-summary.md` 新增 `Controller Verification` 区块，明确 release gate source 只能是 controller-classified findings；raw reviewer `Must Fix` 显示为 `evidence_only`，Accepted / Rejected / Needs Decision Must Fix 分开呈现；conflict/contradiction findings 缺少 `source:` / `reviewer:` 标注时报告 `Conflict source attribution: missing`；`docs/contracts/review-artifacts.md` 与 `docs/contracts/release-verdict.md` 补充 raw evidence 与 gate 规则；验证通过：`npm run build`，release/review/core targeted tests 15 passed，`make check` 137 passed，`git diff --check` 干净。
- [x] ~~L5.12 Dogfood。~~ 证据：真实本地 packet `.agentmesh/runs/l5-12-review-center-dogfood` 使用 `review-center` workflow 和两个本地 reviewers；review fanout 生成 `prompts/review/reviewer_a.md`、`prompts/review/reviewer_b.md`、`reviews/reviewer_a.md`、`reviews/reviewer_b.md` 和对应 artifacts；current decider 写入 `decision.md`；controller classification 写入 `findings.md`，release-check summary 返回 `Review outputs: present`、`Classified findings: present`、`Raw reviewer Must Fix: evidence_only`、`Needs Decision Must Fix: present`、`Conflict source attribution: present`；`packet validate` 返回 `ok: true`；最终验证通过：`make check` 137 passed，`git diff --check` 干净。

Out of scope：

- 按模型数量投票。
- 把 reviewer output 自动当成事实。
- 多个 controllers 并行修改同一批文件。
- 交互式 review UI。

### L5.13. MCP SDK Stdio Interop Fix

目标：把 AgentMesh 手写 MCP stdio wire 实现替换为 official MCP SDK
transport，同时不改变 packet contracts、CLI 参数或 runtime public exports。

为什么插在 L5 之后、L6 之前：L3 已经让 MCP resources 成为 context inputs，但当时
client/fixture 仍使用 `Content-Length` framing。MCP 2025-06-18 stdio transport
规定 JSON-RPC messages 通过 newline 分隔，因此继续手写旧 framing 会给真实 MCP
server 互操作留下风险。这个修复属于 context runtime 基建，不应该打断 L5 review
lifecycle；但在 L6 project facts/context protocol 前修掉更合理。

入口门槛：

- L3 MCP client hardening 已完成。
- L5.12 review-center dogfood 已完成。
- 当前 packet layout、context provenance 和 MCP failure classifications 已有测试保护。

边界：

- 保留 `.agentmesh/runs/<run-id>/` 作为事实源。
- 保留 `readMcpTextResource`、`readMcpTextResources`、
  `listMcpResourceHints` 的 runtime 函数签名。
- 保留 per-call process isolation：每次 read/list 启动 MCP server process，并在
  `finally` 关闭。
- 保留 initialize/read/list timeout、resource size limit、resource hint limit 和
  `McpClientError` classification boundary。
- 不改变 flow orchestration、packet layout、CLI parsing、AI CLI adapter semantics。
- 不借此引入 LangGraph、Temporal、Mastra、OpenAI Agents SDK、Vercel AI SDK、
  daemon、database 或 commander migration。

Deliverables：

- `@modelcontextprotocol/sdk` dependency。
- SDK-based MCP fixture server。
- Minimal raw-bad stdio fixture for protocol violation tests only。
- SDK client + stdio transport integration。
- Failure classification regression tests。
- Packet boundary regression tests。

Slices：

- [x] ~~L5.13.1 用 SDK server fixture 替换正常 MCP fixture，同时保留 raw-bad fixture。~~
  证据：`tests-node/fixtures/mcp/fake-server.ts` 改为
  `@modelcontextprotocol/sdk` `McpServer` + `StdioServerTransport` fixture；保留
  success、initialize exit、missing resource、non-text、oversized text、read hang、
  read exit、stderr output 和 list hint 控制；`tests-node/fixtures/mcp/raw-bad-server.ts`
  专门覆盖 malformed / garbage stdout。
- [x] ~~L5.13.2 用 SDK client 替换 production wire code。~~ 证据：
  `packages/runtime/src/mcp/client.ts` 删除手写 `Content-Length` parser 和
  `StdioMcpClient`，改用 `@modelcontextprotocol/sdk` `Client` +
  `StdioClientTransport`；`readMcpTextResource`、`readMcpTextResources`、
  `listMcpResourceHints` 签名不变；`@modelcontextprotocol/sdk` 固定为 `1.29.0`。
- [x] ~~L5.13.3 映射 SDK/runtime errors 到现有 classification。~~ 证据：
  `server_start_failed`、`initialize_failed`、`timeout`、`resource_not_found`、
  `resource_too_large`、`non_text_resource`、`invalid_json_rpc`、`unknown` 均由
  `tests-node/mcp-client.test.ts` 覆盖；`listMcpResourceHints` 也覆盖 limit 和
  protocol error classification；method-not-found 不会误判为 resource-not-found；
  context provenance 继续只写
  `<classification>: <message>`。
- [x] ~~L5.13.4 覆盖 lifecycle 边界。~~ 证据：targeted tests 覆盖 initialize
  timeout、read timeout、initialize 前进程退出、read 中途退出、garbage stdout、
  stderr output、success close path、failure close path 和 inventory list close path；
  SDK `StdioClientTransport.close()` 本身包含 stdin close、SIGTERM 和 SIGKILL
  escalation，本阶段不再加额外 wrapper。
- [x] ~~L5.13.5 Packet boundary regression。~~ 证据：
  `tests-node/flow-context.test.ts` 覆盖 `flow run --mcp-resource` 成功 capture 与
  failed ingestion provenance，两个 packet 都可 `packet validate --json`；本次未改变
  packet schema、CLI 参数或 runtime public exports。
- [x] ~~L5.13.6 Dogfood。~~ 证据：真实本地 packet
  `.agentmesh/runs/l5-13-mcp-sdk-dogfood-final` 使用 SDK fixture 读取
  `sdk_fake:memory://dogfood` 到 `context.md`，内容为
  `Hello from fake MCP: memory://dogfood`；`packet validate --json` 返回 `ok: true`、
  `artifactCount: 4`、`eventCount: 1`；SDK version 记录为 `1.29.0`。Skipped checks：
  未接官方 reference MCP server，只用 SDK fixture；residual risk：SDK 仍可能在
  AgentMesh post-parse size check 前 buffer 超大 payload。

验证：

- `npm run build`
- `node --test dist-node/tests-node/mcp-client.test.js dist-node/tests-node/mcp-inventory.test.js dist-node/tests-node/mcp-resource.test.js`，仅作为 `npm run build` 后的 targeted invocation。
- `npm test`
- `npm run agentmesh -- packet validate tests-node/fixtures/packets/valid-basic --json`

Out of scope：

- Packet schema changes。
- CLI parsing migration。
- Long-lived MCP daemon or connection pool。
- Replacing `flow.ts` with another orchestration framework。

Risks：

- SDK API shape 可能需要 adapter glue 才能保留 AgentMesh 当前 error
  classifications。
- 如果 fixture 仍模仿旧 framing，会产生假阳性；fixture 必须基于 official SDK。
- Resource-size enforcement 仍然是 post-parse limit，不是抵抗恶意超大 stdout 的硬
  memory cap。
- SDK 可能在 AgentMesh 未调整时改变 stdio transport 行为；必须 pin SDK version，
  并把 SDK version 记录进 dogfood/release evidence。
- SDK 可能在 parse 前 buffer 大 payload，导致 AgentMesh post-parse
  `resource_too_large` 来不及触发；L5.13 只能记录风险或补外层 process/memory guard。
- SDK transport close 可能只关闭 stream 或发送 SIGTERM；若 server ignore SIGTERM，
  AgentMesh 需要 wrapper-level timeout/kill policy 才能避免 orphan process。
- Long-lived MCP client reuse 会改变当前 isolation 语义；本阶段不做。

### L6. AgentMesh Context Protocol

目标：创建一个小而可维护的 project fact layer，可以进入 context packs，但不会变成无人维护的陈旧生成文档。

入口门槛：

- L2 layered config 完成。
- L3 MCP client 完成或明确 deferred。
- L5 workflow recipe compatibility checks 完成。
- L5.13 MCP SDK stdio interop fix 完成。

Deliverables：

- `.agentmesh/spec/project.toml` v1 contract。
- `agentmesh spec check`。
- project facts context pack ingestion。
- freshness 和 validation metadata。

Slices：

- [x] ~~L6.1 设计最小 spec file layout。验收：contract doc 先只定义 `.agentmesh/spec/project.toml`；`modules/*.toml`、`commands.toml`、`risks.md` 延后到第二个真实需求出现。~~ 证据：新增 `docs/contracts/project-spec.md`，锁定 L6 v1 只读取 `.agentmesh/spec/project.toml`；`modules/*.toml`、`commands.toml`、`risks.md` 明确 deferred；`tests-node/core-contracts.test.ts` 覆盖 contract doc 存在和关键术语。
- [x] ~~L6.2 定义 project facts schema。验收：覆盖 project identity、key commands、constraints、known risks、freshness、owner、validation metadata。~~ 证据：`packages/core/src/index.ts` 导出 `ProjectSpecSchema` 及 identity、key command、constraint、risk、freshness、owner、validation 子 schema；`docs/contracts/project-spec.md` 记录字段和 TOML 示例；`tests-node/core-contracts.test.ts` 覆盖 valid spec、空 key commands、缺失 project id 和非法 risk status。
- [x] ~~L6.3 实现 `agentmesh spec check`。验收：valid fixture 通过；stale、malformed、missing required fields 给 actionable messages。~~ 证据：新增 `packages/runtime/src/spec/project.ts` 和 `packages/cli/src/commands/spec.ts`；`agentmesh spec check [--path <path>] [--json]` 输出 human/JSON report；诊断分类包含 `missing_spec`、`malformed_spec`、`missing_required_field`、`stale_spec`、`validation_failed`；`tests-node/project-spec.test.ts` 覆盖 valid、stale、malformed 和 missing required fields。
- [x] ~~L6.4 接入 context pack。验收：`flow run --include-spec` 带 provenance 加入 spec facts；context inclusion flags 使用 `--include-*` / `--exclude-*` 风格。~~ 证据：`FlowRunInput` 新增 `includeSpec`，CLI 支持 `run/flow run --include-spec`；context provenance source type 增加 `project_spec`；`context-pack.ts` 把 project facts 写入 `context.md`，stale/missing/malformed spec 以 failed provenance 保持可见；`tests-node/flow-context.test.ts` 覆盖成功 inclusion、missing spec failed provenance 和 packet validate。
- [x] ~~L6.5 Dogfood。验收：本仓库只写最小可维护 facts，不生成大型 docs，packet validate 通过。~~ 证据：新增 `.agentmesh/spec/project.toml`，只记录项目身份、关键命令、两条长期约束、freshness/owner/validation metadata；`agentmesh spec check --json` 返回 `ok: true`；`flow run --include-spec --run-id l6-5-project-spec-dogfood-final` 生成 packet，`context.md` 包含 `project_spec` provenance，`packet validate` 返回 `ok: true`；`npm test` 通过：Node test `148 passed`。
- [x] ~~L6.6 修正过期 MCP 文档契约。验收：`docs/contracts/mcp-client.md` 不再描述手写 `Content-Length` framing；改为说明官方 MCP TypeScript SDK stdio transport 负责协议处理，AgentMesh 负责 lifecycle、timeout、text extraction、limits 和 failure classification；`invalid_json_rpc` 文案不再说 `malformed framing`；`docs/roadmap.md` 把 MCP text resource capture 描述为当前能力而不是 deferred；验证必须包含 `rg -n "Content-Length|malformed framing" docs/contracts/mcp-client.md` 无匹配、`rg -n "Until that client is implemented|records failed provenance entries rather than pretending|MCP resource capture deferred" docs/roadmap.md` 无匹配、`npm test` 和 `git diff --check`。~~ 证据：`docs/contracts/mcp-client.md` 的 stdio lifecycle 改为官方 MCP TypeScript SDK `StdioClientTransport` 负责协议处理，AgentMesh 负责 lifecycle/timeout/text extraction/limits/failure classification；`invalid_json_rpc` 改为 SDK transport parse failure 或 invalid JSON-RPC response；`docs/roadmap.md` 把 MCP text resource capture 描述为当前能力；两条 stale wording `rg` 检查无匹配；`npm test` 通过：Node test `148 passed`。
- [x] ~~L6.7 锁定 TOML 组件和写入策略。验收：新增 `docs/decisions/toml-component.md`，明确 `smol-toml` 是否锁定为实现选择以及为什么不选其他 TOML 库；文档必须写清用户可编辑 TOML 和机器生成 TOML 的不同策略：用户配置、workflow、project spec、未来 corrections 这类文件不能被无脑整文件 stringify 导致注释/格式丢失；机器生成的 `artifacts.toml` 可以使用统一 serializer；`packages/runtime/src/toml.ts` 的目标形态必须明确是保留为 thin wrapper 还是删除。~~ 证据：新增 `docs/decisions/toml-component.md`，锁定 L6 cleanup 使用 `smol-toml`；明确 `packages/runtime/src/toml.ts` 保留为 thin wrapper；规定用户可编辑 TOML 不做整文件 stringify，机器生成 `artifacts.toml` 可用 shared serializer；记录 `@iarna/toml` 与保留本地 parser 的取舍。
- [x] ~~L6.8 用 `smol-toml` 收敛 TOML 读取路径。验收：添加依赖后，config、workflow registry、packet artifact manifest、project spec 的 TOML parse 都走同一个 wrapper；AgentMesh-specific shape validation 保留在各自模块；有效 TOML 不再被 subset parser 误拒；旧 parser 相关错误文案测试要迁移到新错误映射；`npm test` 和 `git diff --check` 通过。~~ 证据：新增依赖 `smol-toml@1.6.1`；`packages/runtime/src/toml.ts` 收敛为 `parseTomlDocument` thin wrapper；config、workflow registry、packet artifact manifest、project spec parse 全部改为 wrapper；旧 subset value parser 删除；AgentMesh-specific shape validation 仍在各模块；`tests-node/config-layering.test.ts` 将 invalid server id 测试迁移为标准 TOML quoted keys；targeted TOML tests 58 passed。
- [x] ~~L6.9 收敛 TOML 写入路径。验收：机器生成的 `artifacts.toml` 和生成型配置片段走统一 serializer；用户可编辑 TOML 继续采用不破坏注释/格式的 append/surgical write 策略，或明确只写新文件；删除或隔离已经无消费者的 subset-parser 写入代码；`npm test` 和 `git diff --check` 通过。~~ 证据：`toml.ts` 新增 `stringifyTomlDocument` 与 `stringifyTomlInlineValue`；`writeArtifacts` 使用 shared serializer 写机器生成 `artifacts.toml`；`tomlString`/`tomlArray` 使用 shared inline serializer 生成配置片段；`appendAgentRegistration` 仍 append 新 agent block，不整文件重写；`tests-node/cli-surface.test.ts` 覆盖已有用户配置注释保留；`tests-node/packet-io.test.ts` 覆盖 artifact manifest 表结构。
- [x] ~~L6.10 用 core Zod schema 收敛 packet validation。验收：`packages/runtime/src/packet/validate.ts` 必须复用 `PacketStatusSchema`、`PacketEventSchema`、`PacketArtifactManifestSchema.safeParse`；`ZodIssue.path` 映射回现有 `errors: string[]` 风格，不能直接泄露难读的 Zod 默认错误；保留 imperative packet-specific checks：artifact 文件存在、artifact path escape、malformed event log line number，以及 schema 覆盖不了的顺序/交叉文件约束；至少增加 status、event、artifact manifest 各一条错误回归测试；`npm test` 和 `git diff --check` 通过。~~ 证据：`packet/validate.ts` 改用 `PacketStatusSchema`、`PacketEventSchema`、`PacketArtifactManifestSchema.safeParse`；新增 `zodIssuesToErrors` 将 `ZodIssue.path` 映射成可读 `errors: string[]`；artifact missing/path escape 与 malformed event JSON line number 仍保留 imperative checks；`tests-node/packet-validate.test.ts` 新增 status、event、artifact manifest 三类 schema error 回归。
- [x] ~~L6.11 明确 CLI parser 迁移延后。验收：新增 `docs/decisions/cli-parser-deferred.md`，记录为什么 TOML / packet validation cleanup 不引入 `commander` 或 `oclif`，以及 watch condition：只有 `flags.ts` 继续增长 option-value 特例或 subcommand positional parsing 反复出问题时才启动 parser 迁移。~~ 证据：新增 `docs/decisions/cli-parser-deferred.md`，明确 L6 cleanup 不引入 `commander`/`oclif`，后续只在 `flags.ts` 特例持续增长、subcommand positional parsing 反复出错、help 维护失控、插件式外部命令或 UI command metadata 真实需要时重启 parser migration。

Out of scope：

- 自动生成大型架构文档。
- 索引整个仓库。
- 替代 README 或 packet artifacts。
- 默认创建 `modules/*.toml`、`commands.toml` 或 `risks.md`。
- L6.6-L6.10 为了清理 docs、TOML 或 packet validation 而修改 MCP runtime 行为。
- L6.6-L6.10 引入 LangGraph、Temporal、Mastra、OpenAI Agents SDK、Vercel AI SDK 或其他 workflow engine 替代本地 packet/state boundary。
- 在 TOML / packet validation cleanup 中同时迁移 CLI parser。

### L7. Corrections Feedback Loop

目标：让用户纠正变成可检查的 project facts，而不是私有聊天记忆。

入口门槛：

- L6 project fact layer 完成。
- L6.7-L6.9 TOML 组件和读写策略完成，避免 L7 corrections 在旧 subset parser 上新增 TOML surface。
- Context inclusion/exclusion flags 已稳定。

Deliverables：

- `.agentmesh/corrections/` 本地 correction store。
- `agentmesh correction add/list/supersede`。
- Context inclusion policy。
- Provenance 和 freshness metadata。

Slices：

- [x] ~~L7.1 定义 correction record schema。验收：records 包含 id、scope、statement、source、created timestamp、supersedes、status、owner。~~ 证据：`CorrectionRecordSchema` / `CorrectionStatusSchema` 已导出；`docs/contracts/corrections.md` 定义 `.agentmesh/corrections/<id>.toml` 字段、status 语义和 context boundary；`tests-node/core-contracts.test.ts` 覆盖必填字段、空 scope/statement、空 supersedes entry 和非法 status；`npm test` 通过，Node test `153 passed`。
- [x] ~~L7.2 实现 `agentmesh correction add`。验收：写入稳定本地 record，拒绝 empty 或 unscoped corrections。~~ 证据：新增 `packages/runtime/src/corrections/index.ts` project-local store，`agentmesh correction add --scope <scope> --statement <text> [--id <id>] [--source <source>] [--owner <owner>] [--json]` 写入 `.agentmesh/corrections/<id>.toml`；重复 id、unsafe id、空 statement、缺失 scope 和空白 scope 均被拒绝；`tests-node/corrections.test.ts` 覆盖 runtime 与 CLI；`npm test` 通过，Node test `156 passed`。
- [x] ~~L7.3 实现 `agentmesh correction list`。验收：支持 human/JSON output、status filters、scope filters。~~ 证据：`listCorrections()` 读取 `.agentmesh/corrections/*.toml` 并按 filename 稳定排序；`agentmesh correction list [--status <active|superseded>] [--scope <scope>] [--json]` 支持 human/JSON 输出、status filter、scope filter 和空 store；`tests-node/corrections.test.ts` 覆盖过滤和输出；`npm test` 通过，Node test `157 passed`。
- [x] ~~L7.4 实现 `agentmesh correction supersede`。验收：superseded records 仍可读，context packs 优先 active corrections。~~ 证据：`supersedeCorrection()` 创建 replacement active record，写入 `supersedes = [old_id]`，并把旧 record 的 status 精准替换为 `superseded` 以保留注释；`agentmesh correction supersede <id> --statement <text> [--scope <scope>] [--id <replacement-id>] [--source <source>] [--owner <owner>] [--json]` 支持 human/JSON 输出；active list 只返回 replacement，superseded list 仍可读取旧 record；`npm test` 通过，Node test `159 passed`。
- [x] ~~L7.5 接入 context packs。验收：active corrections 带 provenance 出现，可通过重复的 `--exclude-correction <id>` 显式排除。~~ 证据：`ContextSourceTypeSchema` 增加 `project_correction`；`buildContextPack()` 默认读取 active corrections，写入 `## Project Correction`、`source_type = "project_correction"`、`source` correction id、`source_path` TOML 路径、owner 和 statement；`run` / `flow run` 支持重复 `--exclude-correction <id>`，unsafe id 在 packet 创建前失败；superseded records 不进入 context；`npm test` 通过，Node test `160 passed`。
- [x] ~~L7.6 Dogfood。验收：至少一个 project correction 进入真实 packet，packet validate 通过。~~ 证据：新增真实 project correction `.agentmesh/corrections/l7-context-policy.toml`；运行 `flow run --workflow implementation-plan --plan current --decide current --run-id l7-6-corrections-dogfood` 后，`.agentmesh/runs/l7-6-corrections-dogfood/context.md` 包含 `source_type = "project_correction"`、`source = "l7-context-policy"`、`source_path` 和 correction statement；`agentmesh packet validate l7-6-corrections-dogfood --json` 返回 `ok: true`；`npm test` 通过，Node test `160 passed`。

Out of scope：

- Invisible memory。
- Automatic correction inference。
- Remote synchronization。

### L8. Studio

目标：创建本地 observability 和 control surface，同时不复制 CLI 业务逻辑。

入口门槛：

- L2 到 L7 已完成，或被明确 deferred。
- Packet/events/status contracts 已稳定到足够给 UI 观察。
- 至少有三个真实本地 packets 可检查。

Deliverables：

- Studio scope decision doc。
- Read-only packet browser。
- CLI subprocess mutation bridge。
- Review/release views。
- UI verification.

Slices：

- [x] ~~L8.1 定义 Studio product scope。验收：doc 写清 jobs-to-be-done、non-goals、mutation rules、为什么 CLI 仍是事实源。~~ 证据：新增 `docs/decisions/studio-scope.md`，定义 Studio v1 是本地 observability/control surface；列出 run inspection、events tail、artifact preview、review/release evidence 和 safe next action 等 jobs-to-be-done；明确 packet files 是 source of truth，Studio v1 不 import runtime，所有 mutation 经 CLI subprocess；记录 non-goals、UI surface 和 acceptance boundary。
- [x] ~~L8.2 选择 shell tech。候选：Tauri、Electron、local web wrapper。验收：decision doc 记录 constraints 和 tradeoffs。~~ 证据：新增 `docs/decisions/studio-shell.md`，基于 L8 constraints 选择 local web wrapper；记录 Tauri、Electron、local web wrapper 的 pros/cons、revisit triggers、implementation boundary 和 deferred UI decisions；官方 Tauri/Electron/Vite 文档已作为校准来源。
- [x] ~~L8.3 构建 read-only packet browser。验收：列出 runs、读取 `status.json`、tail `events.jsonl`、预览 artifacts。~~ 证据：新增 `apps/studio/src/packet-browser.ts` 和 `apps/studio/src/server.ts`；`npm run studio` 启动本地 Studio server；API 支持 `/api/runs`、`/api/runs/<id>`、`/api/runs/<id>/artifacts/<name>`；UI 可列出 runs、显示 status/stages/events/artifacts 并预览文本 artifact；`tests-node/studio.test.ts` 覆盖 run list、status/events tail、artifact preview、escape path 拒绝和 HTTP endpoints；真实 workspace smoke 读取到 11 个 runs；`npm test` 通过，Node test `164 passed`。
- [x] ~~L8.4 增加 CLI subprocess mutations。验收：Studio 通过 CLI 调用 `flow dispatch`、`retry`、`resume`、`attach`；不复制 protocol logic。~~ 证据：新增 `apps/studio/src/mutations.ts`，把 Studio action 映射成 `node dist-node/packages/cli/src/cli.js flow dispatch|retry|resume|attach ...` 子进程调用；`server.ts` 暴露 `/api/mutations` POST 端点并保留 packet browser read API；UI 新增 Actions 面板，支持 dispatch、retry、resume 和 text attach；`tests-node/studio.test.ts` 覆盖命令构造、unsafe token 拒绝、真实 fake CLI subprocess 和 HTTP mutation endpoint；`tests-node/package-structure.test.ts` 继续确认 Studio 不 import runtime；`npm test` 通过，Node test `167 passed`。
- [x] ~~L8.5 增加 release/review views。验收：展示 findings groups、raw reviews、release verdict、skipped checks、residual risk。~~ 证据：`readStudioRun()` 新增 `review_release` 视图数据，读取 `status.json` 的 `release_verdict`、`findings.md` 的 Accepted/Rejected/Needs Decision、`reviews/*.md` 和 `findings.md#Raw Review Outputs` raw reviews、`release-summary.md` 的 skipped/missing evidence 与 residual risk；Studio UI 新增 Release / Review 面板展示 verdict、findings groups、skipped/missing、residual risk 和 raw review 内容；真实 workspace HTTP smoke 对 `final-release-check-20260514-0315` 返回 `ready/ok`、8 条 accepted findings、skipped evidence 和 `codex55` raw review；`npm test` 通过，Node test `168 passed`。
- [x] ~~L8.6 增加 UI coverage。验收：Playwright 或等价覆盖页面加载、packet list、artifact preview、mutation command trigger。~~ 证据：新增 `tests-node/studio-ui.test.ts`，用真实 `createStudioServer()` 覆盖 `/`、`/style.css`、`/studio.js` 页面资源加载；用轻量 fake DOM 执行 `STUDIO_JS`，覆盖 run list 渲染、release/review 面板渲染、artifact preview click 和 dispatch mutation POST body；不新增浏览器依赖，仍覆盖 UI 行为；`npm test` 通过，Node test `170 passed`。

Out of scope：

- Cloud UI。
- 直接编辑 packet files。
- 在 frontend code 中重新实现 runtime state transitions。
