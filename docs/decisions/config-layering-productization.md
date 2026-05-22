# 配置分层产品化方案

`schema_version`: 1

Decision: AgentMesh 继续支持 user/project 分层，但 project 层现在表示当前 checkout
里的本地项目配置，不表示要随仓库同步给团队。运行事实继续留在 packet，敏感信息
继续留在宿主 CLI / env / 系统凭证里。

## 当前事实

详细现状以 `docs/contracts/config-layering.md` 的 Current Inventory 为准。本方案只记录后续产品化方向。

- Agent registry 已支持用户级和项目级写入，默认写用户级。
- Workflow registry 已支持 built-in、用户级、项目级和一次性 `--workflow-file`。
- `workflow_defaults` 和 `mcp_servers` 已经在 layered config 中解析，但 MCP 的 add/remove scope、Studio 展示和 doctor 诊断还没有完整产品化。
- `context_policy` 仍只是目标位置，执行语义尚未落地。
- Packet 还没有完整记录 config source layer、config hash 和 resolved policy provenance。

## 方案到计划的映射

| 方案能力 | 计划 slice |
| --- | --- |
| MCP servers 和 resource hints | P2.10 |
| Context policy 和 context sources | P2.11 |
| Review / release policy | P2.12 |
| Run defaults 和 execution policy | P2.13 |
| Model aliases 和 capability profiles | P2.14 |

## 分层判断规则

- 用户级：跟“这个人/这台机器怎么运行 AgentMesh”有关，可跨项目复用。
- 项目级：跟“这个 checkout 里怎么运行 AgentMesh”有关，默认不提交，不能依赖个人登录态。
- 单次运行级：只影响一次 run，应写入 packet provenance，不进入长期配置。
- 敏感信息：不写入 AgentMesh config，包括 token、session、cookie、API key、provider 登录态。

## 值得产品化的分层能力

### 1. MCP servers 和 resource hints

优先级最高，因为 MCP 已经进入 config layering，只差产品入口和展示闭环。

用户级适合保存：

- 个人常用 MCP server，例如本机文档索引、个人文件搜索、浏览器上下文。
- 个人 server 的 command、args、默认 resource hints。

项目级不再保存 MCP server；项目配置只保存运行策略、workflow defaults 和项目上下文策略。

需要补齐：

- `agentmesh mcp add/list/remove` 用户级全局 registry。
- `mcp inventory` human/JSON 输出 source layer 和 source path。
- Studio 配置视图展示 MCP 来源层、resource hints 和诊断。
- Doctor 检查重复 id、命令缺失、不可启动、resource list 失败，并给 actionable hint。

### 2. Context policy 和 context sources

优先级第二，因为它决定 agent 看到什么，也决定项目安全边界。

用户级适合保存：

- 默认 context byte/token budget。
- 个人 redaction 偏好。
- 是否允许某些本机来源，例如用户级 MCP server、用户指定文件。
- 默认 freshness 策略。

项目级适合保存：

- 当前 checkout 运行时希望进入上下文的项目事实，例如 `.agentmesh/spec/project.toml`、架构文档、release checklist。
- 禁止读取的路径或 glob，例如 secrets、build output、vendor cache。
- 项目要求的 context freshness、validation、provenance 规则。

需要补齐：

- `docs/contracts/context-policy.md`。
- `[context_policy]` schema 和 merge rules，第一版字段为 `max_bytes`、`max_files`、`freshness_max_age_seconds`、`redact_patterns`、`required_sources`、`denied_paths`。
- `flow run` 在 packet 创建时解析并记录最终 policy。
- packet `context.md` 和 `status.json` 记录 resolved policy source layer。
- Studio 展示 run 使用了哪些 context policy 和哪些输入被拒绝。

### 3. Review / release policy

优先级第三，因为它应该表达项目质量要求，而不是个人模型偏好。

用户级适合保存：

- 哪些本机 agent 具备 review / decide 能力。
- 个人默认 reviewer 偏好。
- 模型别名和 reviewer 能力偏好。

项目级适合保存：

- 当前 checkout 的每类 workflow 需要哪些 review capability。
- release gate 必须检查的 evidence。
- 哪些风险必须进入 `needs_decision`。
- 是否要求 docs / tests / security / migration review。

需要补齐：

- `docs/contracts/review-release-policy.md`。
- 项目级 policy 使用 capability profile，不直接写死个人 agent id 或个人模型。
- `flow run` 把 project policy 和 user agents 解析成具体 reviewer assignment。
- release summary 记录 policy source layer 和被跳过的 gate。

Capability profile 不改变现有 `[workflow_defaults]` 语义。`workflow_defaults` 继续只接受 bare agent id 或 agent id list。Capability profile 只出现在新的 `[review_policy.<workflow-id>]` / `[release_policy.<workflow-id>]` 中，由 run 创建时解析为 concrete agent ids，并把解析结果写入 packet。

### 4. Run defaults 和 execution policy

优先级第四，因为它会影响实际执行，但要避免变成隐藏行为。

用户级适合保存：

- 默认 dispatch timeout。
- 本机 fanout concurrency 上限。
- 默认事件分页大小。
- 默认重试偏好。

项目级适合保存：

- 当前 checkout 允许的最大并发。
- 当前 checkout 的某些 workflow 是否必须 user gate。
- 当前 checkout 的某些 stage 是否禁止自动 dispatch。
- 当前 checkout 的 timeout 上限。

需要补齐：

- `[run_defaults]` 和 `[execution_policy]` contract。
- merge 规则：项目可以收紧用户设置，不能放宽项目安全上限。
- resolved 值必须写入 packet，避免事后无法解释当时为什么这样跑。
- Studio 在 run detail 中展示 resolved execution policy。

第一版字段分工：

- `[run_defaults]` 是普通默认值：`dispatch_timeout_secs`、`adapter_timeout_secs`、`event_page_size`、`retry_attempts`。
- `[execution_policy]` 是安全边界：`max_fanout_concurrency`、`max_dispatch_timeout_secs`、`max_adapter_timeout_secs`、`max_retry_attempts`、`require_user_gate`、`allow_auto_dispatch`。

安全边界 merge 规则：

- 数字上限取更严格值：较小的 `max_*` 生效。
- `require_user_gate` 只要任一层为 true，最终就是 true。
- `allow_auto_dispatch` 只要任一层为 false，最终就是 false。
- dispatch/retry 必须使用 packet 内 resolved execution policy，不重新读取当前 config 猜历史 run。

### 5. Model aliases 和 capability profiles

优先级第五，和 agent 添加前验证一起做更合适。

用户级适合保存：

- 明确的模型别名，例如 `mimo`、`gpt55`、`claude-fast`。
- 本机实际可用模型的解析结果和验证状态。
- agent capability 标签，例如 `long_context_review`、`fast_plan`。

项目级适合保存：

- capability profile 名称，例如 `reviewer.long_context`、`planner.high_reasoning`。
- 当前 checkout 的 workflow 对 capability 的要求。

项目级不应该保存：

- 个人 agent 的 provider 登录态。
- 只有某个人机器上才可用的模型简称。
- provider session 文件路径。

## 暂时不做分层的内容

- Secrets、tokens、cookies、API keys、provider session。
- Runs、events、artifacts；这些是 packet 事实源，不是配置。
- Corrections；当前保持项目级，但默认跟随 `.agentmesh/` 作为本地项目事实，不通过普通 commit 同步。
- Studio 主题、语言、布局；这些可以做用户偏好，不需要项目级。
- 云端、团队、账号、权限、远程 runner。

## Packet provenance additions

所有影响 run 行为的分层配置都必须在 run 创建时固定，并写入 packet。后续 dispatch、retry、resume 读取 packet 内 resolved 值，不用当前 config 重新推断历史 run。

第一版新增字段：

- `status.json.config_provenance`
  - `schema_version`
  - `resolved_at`
  - `layers[]`: `kind`、`path`、`sha256`
- `status.json.resolved_context_policy`
  - `source_layers[]`
  - `policy_hash`
  - `max_bytes`
  - `max_files`
  - `freshness_max_age_seconds`
  - `required_sources[]`
  - `denied_paths[]`
- `status.json.resolved_execution_policy`
  - `source_layers[]`
  - `policy_hash`
  - `dispatch_timeout_secs`
  - `adapter_timeout_secs`
  - `max_fanout_concurrency`
  - `retry_attempts`
  - `require_user_gate`
  - `allow_auto_dispatch`
- `status.json.resolved_review_release_policy`
  - `source_layers[]`
  - `policy_hash`
  - `required_review_profiles[]`
  - `required_evidence[]`
  - `needs_decision_risks[]`
- `assignment.toml`
  - 新增 `[assignment_provenance.<stage>.<agent-id>]`
  - 字段：`source_layer`、`source_path`、`adapter`、`model`、`resolved_from_profile`
- `context.md`
  - 新增 `## Resolved Context Policy` 区块，记录 policy hash、source layers、required sources 和 denied paths summary。

字段名变更只能通过对应 contract doc 和测试一起改，不能在实现 slice 里临时发明新名字。

## TOML examples

用户级配置示例：

```toml
schema_version = 1

[mcp_servers.personal-docs]
command = "docs-mcp"
args = ["serve"]
resource_hints = ["notes:index"]

[context_policy]
max_bytes = 262144
max_files = 20
freshness_max_age_seconds = 604800
redact_patterns = ["*.env", "secrets/**"]

[run_defaults]
dispatch_timeout_secs = 600
adapter_timeout_secs = 900
event_page_size = 50
retry_attempts = 1

[execution_policy]
max_fanout_concurrency = 3
max_dispatch_timeout_secs = 900
max_adapter_timeout_secs = 1200
max_retry_attempts = 2
require_user_gate = false
allow_auto_dispatch = true

[model_aliases.mimo]
adapter = "claude-code-cli"
model = "mimo-v2.5-pro"

[capability_profile_preferences."reviewer.long_context"]
agents = ["mimo"]
```

项目级配置示例：

```toml
schema_version = 1

[mcp_servers.project-docs]
command = "project-docs-mcp"
args = ["serve", "."]
resource_hints = ["docs:architecture", "docs:release-checklist"]

[context_policy]
required_sources = [".agentmesh/spec/project.toml", "docs/architecture.md"]
denied_paths = [".env", "dist/**", "node_modules/**"]
freshness_max_age_seconds = 86400

[review_policy.w-f43236a0]
required_review_profiles = ["reviewer.long_context"]

[release_policy.default]
required_evidence = ["tests", "diff-check"]
needs_decision_risks = ["security", "migration", "data-loss"]

[capability_profiles."reviewer.long_context"]
stage = "review"
required_capabilities = ["review"]
min_count = 1

[execution_policy]
max_fanout_concurrency = 2
max_dispatch_timeout_secs = 600
max_adapter_timeout_secs = 900
max_retry_attempts = 1
require_user_gate = true
allow_auto_dispatch = false
```

Capability profile 解析规则：

- 先读取项目级 `[capability_profiles.<id>]` 定义 profile 需求。
- 再读取用户级 `[capability_profile_preferences.<id>]` 选择本机 agent。
- 如果 preference 中的 agent 不满足 profile capability，fail fast。
- 如果没有 preference 且只有一个 agent 满足，自动选择该 agent。
- 如果没有 preference 且多个 agent 满足，fail fast 并列出候选。
- 最终 concrete agent ids 写入 `status.json.stage_assignments` 和 `assignment.toml`。

## 推荐落地顺序

1. 先产品化 MCP scope，因为已有 layered config 基础。
2. 再实现 context policy，因为它影响上下文安全和 provenance。
3. 然后实现 review/release policy，因为它能减少 workflow defaults 硬编码个人 agent。
4. 再实现 execution policy，所有 resolved 值必须进 packet。
5. 最后把 model aliases / capability profiles 合并进 agent registration 验证。

## 验收边界

- 每个新增分层能力都要有 contract doc。
- 每个新增 section 都要有 schema 校验和 merge tests。
- CLI human/JSON 输出必须展示 source layer。
- Doctor 必须能解释 config layer 错误。
- Studio 必须能展示影响当前 run 的 resolved config。
- Packet 必须记录最终 resolved 值和来源层，不能只依赖当前 config。
