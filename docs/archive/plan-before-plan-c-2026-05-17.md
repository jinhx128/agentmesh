# AgentMesh Workflow Stage Semantics 技术计划

## 1. 背景

- 当前现状：旧版 `plan.md` 已归档到 `docs/archive/plan-before-plan-a-2026-05-16.md`；当前计划以 Plan A 为唯一执行事实源。
- 问题来源：需要把 `decide` 从最终唯一 gate 调整为可重复 decision checkpoint，并同步收敛 workflow、preset、default primary agents、failure policy、fallback routing、agent timeout、packet v2、artifact 命名、dispatch、Studio 和测试策略。
- 相关上下文：方案来源为原 `plan-a.md`；4.7 review 已审过 fallback/default primary/packet v2/agent timeout 相关空洞；ds/opencode review 当前 invocation 超时，待恢复后可补跑。
- 计划维护：本文件是当前任务唯一事实源。草稿必须合并回本文件或删除；本轮已删除 `plan-a.md`，避免并行计划漂移。

## 2. 目的

- 要达成：把 AgentMesh workflow stage 模型收敛到最终开发态，不做兼容/过渡方案，直接实现更方便的长期模型。
- 成功标准：
  - `decide` 可以重复，但不能作为第一个 stage，不能连续出现。
  - assignment 只以 node-id keyed `stage_assignments` 为事实源，不再写 legacy 顶层 role 字段。
  - packet schema 升到 v2，固化 default primary、failure policy、fallback、timeout、attempt 和 provenance 解析结果。
  - workflow / preset / global config / direct run 的职责边界清晰，dispatch 只读 packet。
  - docs、Studio、tests、README、index 和中文术语同步到最终规则。
- 入口门槛：本计划是设计和实施计划；开始代码实现前，应按 P1.1 重新核对当前代码，因为代码可能已经被其他任务改动。
- 不解决：不做 v1 packet migration；不引入 DAG branching；不支持 execute fanout；不保留 `workflow_defaults` 作为用户快捷入口。

## 3. 边界与约束

- 影响范围：`packages/core`、`packages/runtime`、`packages/cli`、`packages/sdk`、`apps/studio`、`docs/contracts`、`docs/workflows`、`README.md`、`index.html`、`tests-node`。
- 技术约束：保持 TypeScript/Node runtime；遵循现有 workflow TOML、packet/status/event/artifact contract 风格；新 packet 直接 v2。
- 产品约束：workflow 不绑定具体 agent；preset 是 workflow 的具体运行实现；global config 只提供用户环境默认值；packet 是 run 创建时的不可变执行事实。
- 假设：开发阶段允许破坏旧 packet/旧 workflow 行为；现有测试可按最终模型更新。
- 阻塞问题：P1.Z 已补跑 Claude 4.7 review；opencode lane 启动后未在 900s 窗口内产出 review artifact，已记录为不可用证据，不阻塞主方案落地。

## 4. 详细方案

以下为原 `plan-a.md` 的方案内容，已合并为本计划的技术方案正文。

### Plan A: Decide As Checkpoint

#### Goal

把 `decide` 从“全局唯一的最终 gate”改成普通 workflow checkpoint：

- `decide` 可以在流程中出现多次。
- 每个 `decide` 都基于前序证据产出一次决策。
- 后续 stage 必须能把前面的 decision 当作证据继续消费。
- 支持 fanout 的 stage 每个节点最多分配 6 个 agent。
- Packet assignment 只保留 `stage_assignments`，不再写 legacy 顶层角色字段。
- Packet schema 升到 v2；不做 v1 兼容或迁移。
- 新增 Preset 作为 workflow 的具体运行实现：固定 workflow、stage agents 和常用 run defaults，
  让用户用一条短命令重复调用。
- 新增 default primary agents，用于直接运行 workflow 或简化 preset 时补齐主执行 agent。
- 不做兼容/过渡方案，直接按最终方便的模型收敛。

#### Terminology

`review` 的中文统一叫“审查”，不要叫“评审”。

需要同步替换的中文 UI / docs 语义包括：

- 发布 / 审查
- 原始审查
- 审查证据
- 审查者
- 审查阶段
- `review`：审查风险、遗漏和发布阻断项

英文 protocol 名仍然保持 `review`，不改成其他 stage type。

#### Final Mental Model

Workflow 是线性的 stage node 序列。所有 stage 都先是 node，再由 node type 决定行为。

```text
stages:      ["plan", "decide", "execute", "verify", "review", "decide"]
stage_nodes: plan, decide, execute, verify, review, decide_2
```

`decide` 不再表示“流程只能在这里结束”，而表示：

> 基于当前 packet 中已有证据做一次显式决策，并把该决策写成后续节点可引用的 artifact。

所以这些 workflow 合法：

```text
plan -> decide -> execute -> verify -> review -> decide
plan -> execute -> review -> decide -> execute -> verify -> decide
plan -> plan -> decide -> execute -> execute -> verify -> review -> decide
plan -> decide -> review -> decide
verify -> decide -> verify -> decide
```

这些 workflow 非法：

```text
decide -> plan
plan -> decide -> decide -> execute
```

#### Stage Rules

通用规则：

- stage type 只允许：`plan`, `execute`, `verify`, `review`, `decide`
- workflow 必须包含 `1-15` 个 stage node
- workflow `stages` 里只写 type，不写 `execute_2` 这类 suffix
- runtime 根据出现次数生成 node id
- 所有 stage type 都允许重复
- `decide` 不能是第一个 stage
- `decide` 不能连续出现
- 可 fanout 的 stage node 最多 6 个 agent

连续重复的语义：

- `plan -> plan`：允许。适合粗计划后细化计划。
- `execute -> execute`：允许。适合顺序拆分实现阶段。
- `verify -> verify`：允许。适合分层验证。
- `review -> review`：允许。适合分层审查。
- `decide -> review -> decide`：允许。适合先决定是否进入审查，再基于审查证据做下一次决策。
- `verify -> decide -> verify -> decide`：允许。适合分阶段验证和阶段性 gate。
- `decide -> decide`：禁止。中间没有新增证据，第二个 decision 没有独立价值。

#### Assignment Model

最终模型只以 `stage_assignments` 作为 runtime 分配来源。

```json
{
  "stage_assignments": {
    "plan": ["planner"],
    "decide": ["architect"],
    "execute": ["worker"],
    "verify": ["verifier"],
    "review": ["reviewer"],
    "decide_2": ["decider"]
  }
}
```

最终 packet 不再写顶层角色字段：

```json
{
  "plan": "planner",
  "execute": "worker",
  "review": ["reviewer"],
  "decide": "decider"
}
```

展示层需要角色信息时，也从 `stage_assignments` 和 `stage_nodes` 派生。

这样 `verify` 不再特殊，所有 stage 都走同一套分配规则。

这也解决当前 `verify` 没有 legacy 顶层字段的问题：最终态里没有任何 stage
拥有 legacy 顶层 assignment 字段，`verify` 和其他 stage 完全一致。

#### Preset Model

Workflow 和 Preset 分工如下：

- Workflow 是流程协议：定义 stage 顺序、artifact 契约和质量门，不绑定用户机器上的 agent。
- Preset 是 workflow 的具体运行实现：引用一个 workflow，并固定每个 stage node 用哪些
  agents、是否自动 dispatch、是否 user gate、默认 scope/context 等常用参数。

用户常用入口应该是 preset，而不是每次手写 workflow 和所有 role flags：

```bash
agentmesh run bugfix --task "fix login failure"
agentmesh run verified --task-file request.md
agentmesh run review-plan --context-file plan-a.md
```

Preset TOML 示例：

```toml
schema_version = 1
id = "verified"
name = "Verified Delivery"
workflow = "verified-delivery"

[stage_assignments]
plan = ["claude"]
execute = ["codex"]
decide = ["current"]

[default_stage_agents.stage_types]
verify = ["gemini"]
review = ["gemini"]

[fallback]
agents = ["claude"]
max_attempts_per_agent = 1
timeout_seconds = 900

[fallback.stage_types.verify]
agents = ["gemini"]
inherit_common = true

[fallback.nodes.verify_2]
agents = ["codex-reviewer"]
inherit_stage_type = true
inherit_common = false

[failure_policy.stage_types.verify]
mode = "required"
max_fallback_agents = 2

[run]
auto_dispatch = true
user_gate = true

[defaults]
scope = ["packages", "tests-node"]
context_file = ["README.md"]
```

Preset 中的 `[stage_assignments]` 使用 workflow 派生出的 stage node id。没有重复节点时，
node id 刚好等于 stage type；有重复节点时必须写 `execute_2`, `review_2`, `decide_2`
这类 node id。

为了避免用户手写错 repeated node id，CLI 需要提供模板生成：

```bash
agentmesh preset init verified --workflow verified-delivery
```

Preset registry 默认是用户级：

```text
~/.config/agentmesh/presets/*.toml
```

Preset 创建和运行都必须 fail fast：

- preset id 必填且全 registry 唯一。
- preset 引用的 workflow 必须存在。
- preset `[stage_assignments]` 加 preset/global default primary agents 解析后，必须覆盖 workflow
  的每个 stage node。
- preset 不允许引用 workflow 中不存在的 node id；错误信息必须列出该 workflow 派生出的合法
  node ids。
- preset 引用的 agents 必须存在且 capability 匹配。
- preset add/doctor 必须基于引用的 workflow 派生 node ids，并校验 preset default primary
  agents 对所有适用 target stage type 的 capability；global defaults 仍在 run 创建时结合
  具体 workflow 校验。
- 每个 node 最多 6 个 agents。
- `execute` node 必须刚好 1 个 agent。
- `plan` / `decide` 配置 4 个或更多 agents 时给 soft warning，但不 fail；
  这两个 stage 是合成型 fanout，过多候选意见会降低可读性。warning 必须在
  `preset add`、`preset doctor` 和 run 创建 stdout/stderr 中可见，并写入 validation
  warnings 供 Studio 展示。
- `current` node 必须是纯 `["current"]`，禁止和 worker 混合。
- preset run 创建 packet 时写入 `preset` 和 `preset_source` provenance。
- preset 可以定义 common 和 stage-type default primary agents；node 级主执行者仍使用
  `[stage_assignments]`。
- preset 可以定义 common、stage-type、node 三层 fallback agents。
- preset 也可以定义 `failure_policy`，用于给该 preset 收紧或细化失败策略。
- 每个 fallback agents 配置列表最多 3 个 agents。
- fallback agents 必须存在、不能是 `current`、且 capability 必须匹配目标 node type。
- preset `failure_policy` 只能引用有效 stage type 或 workflow 派生出的 stage node id。
- preset 不能把 workflow 中的 `terminal` 放宽成 `allow` 或 `required`。
- preset `failure_policy.max_fallback_agents` 默认 1，最大 3。

`workflow_defaults` 不再作为用户快捷入口。最终产品语义里，保存“这个 workflow
每个节点由谁来跑”的结构就是 preset。

#### Agent Invocation Timeout

Agent 可以配置默认调用超时，用于保护 primary、review、fallback 和 synthesis 这类
真实 adapter invocation。它是 agent 身份的一部分，不决定失败后是否接管：

```toml
[agents.opencode]
label = "OpenCode DeepSeek V4 Pro"
adapter = "opencode-cli"
command = "opencode"
args = ["run"]
model = "zhuanzhuan/deepseek-v4-pro"
timeout_seconds = 1200
```

规则：

- `agents.<id>.timeout_seconds` 是可选标量；不配置时使用 system default `900`。
- 不支持 per-capability timeout，例如不支持 `timeout_seconds.review`。
- 合法范围是 `30-3600`。
- `reasoning_effort = "xhigh"` 的 agent 如果经常超过 900 秒，应显式调高该 agent 的
  `timeout_seconds`。
- `current` 不是 invokable worker，纯 `current` node 忽略 agent timeout。
- `agents add` 的 readiness/connectivity probe 使用独立的 probe timeout，不使用
  `agents.<id>.timeout_seconds`；probe timeout 默认 `60`，合法范围 `5-300`。

Timeout 解析优先级：

```text
CLI --timeout-seconds
> preset fallback.timeout_seconds       # only fallback candidates
> global fallback.timeout_seconds       # only fallback candidates
> agents.<id>.timeout_seconds
> system default 900
```

`--timeout-seconds` 是最终 CLI 名称，作用于本次 run 的所有 invokable primary、
fallback 和 synthesis calls，并在创建 packet 时固化。现有 `--timeout-secs` 不作为最终
文档入口。

Timeout 是 per attempt 预算，不是整条 lane 的累计预算。比如
`max_attempts_per_agent = 2` 且 `timeout_seconds = 900`，表示同一个 fallback agent
最多尝试两次，每次最多 900 秒。

Timeout 过期时，该 attempt 的 status 写 `timed_out`。它仍然被 failure policy 视为一次
stage failure：

- `mode = "terminal"`：timeout 后直接停。
- `mode = "allow"` / `required`：timeout 后按已固化 fallback chain 接管。

`plan` / `decide` 只有在同一个 node 有 2 个或更多 invokable worker agents 时才创建
synthesis call；单 agent node 和纯 `current` node 不创建 synthesis lane。Synthesis call
使用第一个 assigned invokable agent 执行，使用独立 invocation 和 timeout attempt budget；
如果 synthesis invocation 失败或超时，使用 `lane_id = "<node-id>:synthesis"` 记录；
是否 fallback 仍由该 node 的 `failure_policy` 决定。

#### Default Primary Agents

Default primary agents 解决“没有显式指定某个 node 时，默认谁主跑”。它不是 fallback：

- default primary agents：主执行 agent 缺省值。
- fallback agents：主执行 agent 运行失败后的接管者。
- failure policy：失败后能不能接管，以及最多接管几次。

用户能配置 default primary agents 的地方：

| config source | storage | scope |
| --- | --- | --- |
| global config | `~/.config/agentmesh/config.toml` | common default, stage-type default |
| preset | `~/.config/agentmesh/presets/*.toml` | common default, stage-type default |

Workflow 不配置 default primary agents。Workflow 不绑定用户机器上的具体 agent。

Node 级主执行者不用另设 default 语法，直接用 `[stage_assignments]`：

```toml
[stage_assignments]
verify_2 = ["local-verifier"]
```

Global config 示例：

```toml
[default_stage_agents]
agents = ["codex"]

[default_stage_agents.stage_types]
plan = ["claude"]
execute = ["codex"]
verify = ["gemini"]
review = ["claude"]
decide = ["current"]
```

Preset 示例：

```toml
[default_stage_agents.stage_types]
verify = ["gemini"]
review = ["claude"]

[stage_assignments]
plan = ["claude"]
execute = ["codex"]
decide = ["current"]
```

Primary agent 解析优先级分两类。

Preset run 使用 preset 作为具体运行实现，`agentmesh run <preset-id>` 不接受 role flags
覆盖 primary assignments：

```text
explicit node assignment
> preset stage-type default
> preset common default
> global stage-type default
> global common default
> fail fast
```

Direct workflow run 使用 CLI role flags 作为显式 stage-type assignment：

```text
CLI role flags
> global stage-type default
> global common default
> fail fast
```

Direct workflow run 的 CLI role flags 只能按 stage type 指定，不能区分同一 workflow 中的
重复 node。比如 workflow 同时有 `decide` 和 `decide_2` 时，`--decide claude` 会展开到
所有 `decide` type nodes；如果需要 `decide` 和 `decide_2` 使用不同 agents，必须创建
preset，并用 node-id keyed `[stage_assignments]` 表达。

解析后写入 packet 的仍然只有 node-id keyed `stage_assignments`。Dispatch 不读取
global config 或 preset 来猜默认 agent。

限制：

- default primary agents 必须存在且 capability 匹配目标 stage type。
- default primary agents 不支持 workflow 级配置。
- default primary agents 配置列表最多 6 个 agents。
- `[default_stage_agents.stage_types].execute` 必须刚好 1 个 agent。
- common default 可以配置 1-6 个 agents，但如果它最终被用于 `execute` 且数量不是 1，
  run 创建必须 fail fast；不能静默取第一个。
- `execute` 在所有来源解析后必须刚好 1 个 agent。
- fanout-capable stage 解析后最多 6 个 agents。
- `current` 只能作为纯节点默认；不能和 worker agent 混用。
- 直接 `flow run --workflow <id>` 不使用 preset 时，可以通过 CLI 显式 role flags 或
  global default primary agents 补齐所有 stage nodes；解析不完整则创建 run 失败。

#### Fallback And Failure Policy

```text
failure_policy is the gate; fallback chain is the route.
```

Fallback 拆成两个概念：

- `failure_policy`：失败策略，决定当前 node 失败后能不能接管，以及最多尝试几个 fallback agents。
- `fallback agents`：接管路由，决定如果允许接管，谁按什么顺序接管。

用户能配置 fallback agents 的地方：

| config source | storage | scope |
| --- | --- | --- |
| global config | `~/.config/agentmesh/config.toml` | common fallback, stage-type fallback |
| preset | `~/.config/agentmesh/presets/*.toml` | common fallback, stage-type fallback, node fallback |

用户能配置 `failure_policy` 的地方：

| config source | storage | scope |
| --- | --- | --- |
| workflow | workflow TOML | stage-type policy, node policy |
| preset | preset TOML | stage-type policy, node policy |

Workflow 不配置具体 fallback agent。Workflow 可以表达流程语义：哪些节点失败必须停、
哪些节点必须有兜底；具体谁来接管由 global config 或 preset 决定。

`failure_policy.mode` 只允许：

| mode | meaning |
| --- | --- |
| `allow` | 默认值。失败后允许 fallback；没有可用 fallback agent 就停住 |
| `terminal` | 失败后立刻停住，不解析 fallback chain |
| `required` | 创建 run 时必须能解析到至少一个可用 fallback agent，否则 fail fast |

`failure_policy.max_fallback_agents` 控制每个失败 lane 最多尝试几个 fallback agents：

- 默认值是 `1`。
- 最大值是 `3`。
- `mode = "terminal"` 时不能配置 `max_fallback_agents`。
- `mode = "required"` 时，创建 run 阶段先验证能解析到至少 1 个 fallback agent；运行时
  primary 失败后仍然受 `max_fallback_agents` 限制。

Fallback execution settings 控制每个 fallback agent 自身怎么运行：

| field | default | bounds | meaning |
| --- | --- | --- | --- |
| `max_attempts_per_agent` | `1` | `1-2` | 同一个 fallback agent 最多尝试几次 |
| `timeout_seconds` | `900` | `30-3600` | 单次 fallback agent 调用超时时间 |

这些字段可以配置在 global `[fallback]` 或 preset `[fallback]`。Preset 值覆盖 global 值。
最终值按 fallback candidate 固化进 packet 的 `stage_fallbacks.<node>.agents[]`，
dispatch 只读 packet。

配置数量限制：

- 每个 fallback agents 列表最多 3 个 agents。
- 包括 global common、global stage-type、preset common、preset stage-type、preset node。
- 解析后的 fallback chain 可以来自多层配置，但实际尝试数量永远受
  `failure_policy.max_fallback_agents` 限制。

执行顺序：

1. 先读取当前 node 的 effective `failure_policy`。
2. 如果 `mode = "terminal"`，直接失败停住，不解析 fallback chain。
3. 如果 `mode = "allow"`，再解析 fallback chain；有可用 agent 就按
   `max_fallback_agents` 尝试，没有就失败停住。
4. 如果 `mode = "required"`，创建 run 时必须解析 fallback chain 并确认至少 1 个可用
   fallback agent；运行时 primary 失败后再按 `max_fallback_agents` 尝试。

Pure `current` nodes 是 host-owned attach/gate 节点，不走自动 fallback：

- primary assignment 为纯 `["current"]` 时，effective fallback chain 强制为空。
- `mode = "required"` 用在 `current` node 上是创建错误。
- global/preset fallback agents 都不能接管 `current` node。

Workflow/preset policy 合并规则：

1. 先计算 workflow effective policy：system default -> workflow stage-type -> workflow node。
2. 再计算 preset effective policy：workflow effective -> preset stage-type -> preset node。
3. 同一个 policy 对象按字段继承；更具体层只覆盖自己写了的字段。
4. `mode` 严格度为 `allow < required < terminal`。
5. Preset 不能把 workflow effective `mode` 放宽。例如 `terminal` 不能变成 `allow/required`，
   `required` 不能变成 `allow`。
6. 如果 workflow 显式设置了 `max_fallback_agents`，preset 只能设为小于或等于该值；
   如果 workflow 没显式设置，preset 可以在 `1-3` 内设置。
7. `terminal` 不能配置 `max_fallback_agents`，也不会继承下层 fallback chain。
8. 如果更具体层把 `mode` 收紧为 `terminal`，effective policy 必须清掉继承来的
   `max_fallback_agents`，packet 中只保留 `{ "mode": "terminal" }`。

Built-in workflows 不使用 `mode = "required"`，避免内置 recipe 依赖用户本机是否配置了
global fallback。`required` 主要用于项目/用户自定义 workflow 或 preset。

Fallback agent 选择优先级：

```text
preset node fallback
> preset stage-type fallback
> preset common fallback
> global stage-type fallback
> global common fallback
```

继承开关：

- `[fallback.stage_types.<type>]` 支持 `inherit_common`，默认 `true`。
- `[fallback.nodes.<node-id>]` 支持 `inherit_stage_type` 和 `inherit_common`，默认都为 `true`。
- 解析顺序是先继承，再去重，再过滤 primary agents，再按 `max_fallback_agents` 截断。
- `inherit_*` 只允许出现在 stage-type 或 node fallback 表里，不允许放在顶层 `[fallback]`。

去重后保持顺序，并且过滤掉当前 node 的所有 primary assigned agents。这样失败的 primary
不会被当作自己的 fallback 再跑一次；多 agent stage 中已经成功的 primary 也不会被重复用来
补另一路 lane。哪个 fallback agent 先成功，就用它的结果继续流程，后面的不再运行。
如果全部失败，stage 标记 failed，run 停在该节点等待人工处理。

Global config 示例：

```toml
[fallback]
agents = ["claude"]

[fallback.stage_types.verify]
agents = ["gemini", "local-verifier"]
```

Workflow policy 示例：

```toml
[failure_policy.stage_types.decide]
mode = "terminal"

[failure_policy.stage_types.verify]
mode = "required"
max_fallback_agents = 2
```

Preset fallback 示例：

```toml
[fallback]
agents = ["claude"]

[fallback.stage_types.verify]
agents = ["gemini", "local-verifier"]
inherit_common = true

[fallback.nodes.verify_2]
agents = ["codex-reviewer"]
inherit_stage_type = true
inherit_common = false
```

Workflow 里的 `terminal` 是语义底线，preset 不能把它放宽成 `allow` 或 `required`。
Preset 可以把 workflow 的 `allow` 收紧为 `terminal`，也可以把 workflow 的 `allow`
收紧为 `required`。

#### Artifact Naming

每个 stage node 都必须有独立 canonical artifact。重复 node 使用 occurrence suffix。

| node id | canonical artifact |
| --- | --- |
| `plan` | `plan.md` |
| `plan_2` | `plan_2.md` |
| `execute` | `handoff.md` |
| `execute_2` | `handoff_2.md` |
| `verify` | `verification.md` |
| `verify_2` | `verification_2.md` |
| `review` | `findings.md` |
| `review_2` | `findings_2.md` |
| `decide` | `decision.md` |
| `decide_2` | `decision_2.md` |
| `decide_3` | `decision_3.md` |

`review` raw outputs 保持现有模型：

```text
reviews/<reviewer>.md
reviews/review_2/<reviewer>.md
```

Artifact id 跟文件名语义保持一致：

```text
plan
plan_2
handoff
handoff_2
verification
verification_2
findings
findings_2
decision
decision_2
decision_3
```

这意味着要改掉当前重复节点 artifact id 里包含 node id 前缀的风格。最终态使用
`handoff_2`，不是 `handoff_execute_2`；使用 `decision_2`，不是 `decide_2`
或其他混合形式。

#### Prompt Assembly

Prompt 组装统一改成 prior evidence 模型，不再区分“有重复 stage”和“无重复 stage”两套分支。
实现上要彻底删除 `hasRepeatedStageNodes(status)` 分支，所有 workflow 都走同一套
ordered prior evidence。

每个 stage prompt 都包含：

1. request
2. assignment
3. context
4. 当前 stage 之前所有 stage node 的 canonical artifact
5. 如果前序 stage 是 review，同时附带 raw review outputs
6. release summary，如存在
7. 当前 stage 的专属 contract

Prior evidence 不能只留下抽象标题。为了不丢旧 prompt 的语义标签，每个 prior output
都要保留 type-specific label：

| prior type | semantic label |
| --- | --- |
| `plan` | Current Plan |
| `execute` | Handoff |
| `verify` | Verification |
| `review` | Findings |
| `decide` | Decision |

例如可以输出：

```text
#### Prior Output: decide (Decision)
Artifact: decision.md
```

`release-check` contract 只追加给 `workflow === "release-check"` 且当前 node type 是
`review` 或 `decide` 的 prompt，不能泄漏到其他 stage type。

这样：

```text
plan -> decide -> execute
```

`execute` 会看到：

```text
Prior Output: plan
Prior Output: decide
```

这样：

```text
execute -> decide -> execute_2
```

`execute_2` 会自然看到前一次 `decision.md`，不会丢掉中间决策。

#### Multi-Agent Behavior

保留当前分工，但把 node id 处理做彻底。

通用限制：

- 单个 stage node 最多 6 个 assigned agents。
- 超过 6 个时，preset 校验或创建 run 阶段直接 fail fast。
- 上限按 node id 计算。例如 `review` 最多 6 个，`review_2` 也最多 6 个。
- `execute` 不支持自动 fanout，所以最终态应拒绝 `execute` 节点配置多个 agent。
- fallback 不增加并发度，只在某个 assigned agent 尝试失败后，按 fallback chain 顺序替换该 lane。

| stage type | multi-agent behavior |
| --- | --- |
| `plan` | fanout 到多个 planner，写 `outputs/<node-id>/<agent>.md`，第一个 agent 合成 canonical plan |
| `execute` | 不支持自动 fanout；需要多执行者时用连续 `execute -> execute` |
| `verify` | fanout 到多个 verifier，AgentMesh 聚合 canonical verification |
| `review` | fanout 到多个 reviewer，AgentMesh 汇总 raw reviews 到 findings |
| `decide` | fanout 到多个 decider，写 `outputs/<node-id>/<agent>.md`，第一个 agent 合成 canonical decision |

原因：

- `plan` 和 `decide` 是候选意见合成型 stage。
- `verify` 和 `review` 是证据聚合型 stage。
- `execute` 会改变工作区状态，并发多 executor 容易冲突，应该用线性 stage 显式拆分。

Fallback 行为：

- `execute` 只有一个执行 lane。primary agent 失败后按 fallback chain 顺序接管，仍然一次只运行一个 executor。
- `plan`, `verify`, `review`, `decide` 的 fallback 是替换失败 lane，不是追加一个新的并行 agent。
- 如果一个 fanout node 有 3 个 assigned agents，只有其中 1 个失败，那么只为失败的那一路寻找 fallback；
  已成功的 lanes 不重跑。
- fallback agent 成功后，artifact/event/status 必须记录 requested agent 和 actual agent。
- 如果 fallback chain 全部失败，或 effective `failure_policy.mode = "terminal"`，该 stage 标记 failed，
  run 停在该节点等待人工处理。

#### Final Packet Shape

新 packet schema version 是 `2`。因为本方案删除 legacy top-level assignment 字段、
新增 failure/fallback/attempt 结构，并改变 repeated stage artifact 命名，不做 v1 migration。

`status.json` 的 assignment 事实源：

```json
{
  "schema_version": 2,
  "stage_assignments": {
    "plan": ["planner"],
    "decide": ["architect"],
    "execute": ["worker"],
    "verify": ["verifier"],
    "review": ["reviewer_a", "reviewer_b"],
    "decide_2": ["decider"]
  }
}
```

不再写：

```json
{
  "plan": "planner",
  "execute": "worker",
  "review": ["reviewer_a"],
  "decide": "decider"
}
```

`assignment.toml` 同理，不写 legacy 顶层 `plan` / `execute` / `review` / `decide`；
它保留 identity 字段、`[[stage_nodes]]`、`[stage_assignments]`，以及 v2 resolved
execution facts。

packet 需要记录解析后的 `stage_failure_policies`, `stage_invocations`, `stage_fallbacks`
和 timeout provenance，作为本次 run 的不可变执行事实。不要在 dispatch 时重新读取
workflow、preset、global config 或 agent registry 当前内容，否则后续配置修改会改变已创建
packet 的行为。

解析规则是：先固化每个 node 的 effective failure policy；只有 policy 允许或要求 fallback 时，
才解析该 node 的 effective fallback chain。`stage_fallbacks` 为每个 stage node 都写一个 entry；
terminal/current node 写 `agents = []`。`stage_fallbacks.<node>.agents` 只保存本次实际可能
尝试的 fallback candidates，已经过滤 primary agents 并按 `max_fallback_agents` 截断；
每个 candidate 都带自己的 effective `timeout_seconds`。

`stage_invocations` 只记录实际会被 dispatch 的 lanes。`plan` / `decide` fanout node
会额外写一个 `kind = "synthesis"` lane；单 agent node 和纯 `current` node 不写 synthesis
lane。

示例：

```json
{
  "stage_invocations": {
    "review": [
      {
        "lane_id": "review:reviewer_a",
        "kind": "primary",
        "agent": "reviewer_a",
        "timeout_seconds": 900
      },
      {
        "lane_id": "review:reviewer_b",
        "kind": "primary",
        "agent": "reviewer_b",
        "timeout_seconds": 1200
      }
    ],
    "plan": [
      {
        "lane_id": "plan:planner_a",
        "kind": "primary",
        "agent": "planner_a",
        "timeout_seconds": 900
      },
      {
        "lane_id": "plan:planner_b",
        "kind": "primary",
        "agent": "planner_b",
        "timeout_seconds": 900
      },
      {
        "lane_id": "plan:synthesis",
        "kind": "synthesis",
        "agent": "planner_a",
        "timeout_seconds": 900
      }
    ],
    "decide": [
      {
        "lane_id": "decide:current",
        "kind": "current",
        "agent": "current",
        "timeout_seconds": null
      }
    ]
  },
  "stage_failure_policies": {
    "verify": {
      "mode": "required",
      "max_fallback_agents": 2
    },
    "decide": {
      "mode": "terminal"
    }
  },
  "stage_fallbacks": {
    "verify": {
      "agents": [
        {
          "agent": "gemini",
          "timeout_seconds": 900
        },
        {
          "agent": "claude",
          "timeout_seconds": 1200
        }
      ],
      "max_attempts_per_agent": 1
    },
    "decide": {
      "agents": []
    }
  }
}
```

agent 尝试也要可审计。`stage_attempts` 使用 flat list，但每条记录必须带 `lane_id`
和 `primary_agent`，让 fanout stage 能明确是哪一路失败和接管。`status` 只允许
`completed`, `failed`, `timed_out`：

```json
{
  "stage_attempts": {
    "review": [
      {
        "lane_id": "review:gemini",
        "primary_agent": "gemini",
        "requested_agent": "gemini",
        "actual_agent": "gemini",
        "lane_attempt": 1,
        "attempt": 1,
        "timeout_seconds": 1200,
        "status": "timed_out"
      },
      {
        "lane_id": "review:gemini",
        "primary_agent": "gemini",
        "requested_agent": "codex-reviewer",
        "actual_agent": "codex-reviewer",
        "fallback_from": "gemini",
        "lane_attempt": 2,
        "attempt": 1,
        "timeout_seconds": 900,
        "status": "completed"
      }
    ]
  }
}
```

`lane_attempt` 在同一个 lane 内单调递增，用于审计这个 lane 的第几次实际调用；
`attempt` 是当前 `actual_agent` 自己的尝试次数，换到下一个 fallback agent 时重新从 1
开始，并受 `max_attempts_per_agent` 约束。

Provenance：

- Preset run 写 `preset = "<id>"` 和 `preset_source = "<path>"`。
- Direct workflow run 写 `preset = null` 和 `preset_source = null`。
- `assignment_provenance` 按 node id 记录主 agent 来源，例如 `cli`, `preset_assignment`,
  `preset_stage_default`, `preset_common_default`, `global_stage_default`, `global_common_default`。
- `fallback_provenance` 按 node id 记录 fallback chain 来源，例如 `preset_node`,
  `preset_stage_type`, `preset_common`, `global_stage_type`, `global_common`。
- `timeout_provenance` 按 node id 和 lane/candidate id 记录 timeout 来源，例如 `cli`,
  `preset_fallback`, `global_fallback`, `agent`, `system_default`。

示例：

```json
{
  "timeout_provenance": {
    "review": {
      "review:reviewer_a": "system_default",
      "review:reviewer_b": "agent",
      "fallback:review:gemini": "preset_fallback"
    }
  }
}
```

#### Creation Validation

创建入口必须 fail fast。不要把明显不可用的 agent、workflow、assignment 写进配置
或 packet 后再等 dispatch 才失败。

##### Agent Add

`agentmesh agents add` 在写配置前必须完成全部校验：

- `agent-id` 必须显式或派生为安全 id：以字母开头，只包含字母、数字、`_`、`-`。
- `alias` 必须是安全 token，不能和任何已存在 agent id 或 alias 冲突。
- `alias` 列表必须去重。
- `capability` 必须属于 `plan`, `execute`, `verify`, `review`, `decide`。
- `capability` 列表必须去重。
- `reasoning_effort` 必须属于 `none`, `minimal`, `low`, `medium`, `high`, `xhigh`；
  没有提供时使用默认值。
- `timeout_seconds` 可选，必须在 `30-3600` 内；没有提供时使用 system default `900`。
- CLI 使用 `--timeout-seconds <seconds>` 配置 agent 默认调用超时。
- adapter 和 model 必须解析到 canonical 值。
- agent id 不能和任何已解析 config layer 中的 agent id 冲突。
- 写入前必须用候选 agent 执行 readiness/connectivity probe。
- readiness/connectivity probe 必须确认命令可执行、adapter 可启动、认证可用、
  model 可访问，并能完成一次最小探测调用。
- readiness/connectivity probe 使用独立 probe timeout，不能被 agent 的
  `timeout_seconds` 拉长；probe timeout 默认 `60`，合法范围 `5-300`。
- probe 失败时不写配置。
- 不提供跳过连通性校验的成功路径；Plan A 不包含 offline/draft agent add 命令。
- `--skip-verify` 不再允许成功写入配置；如果保留该 flag，只能作为不落盘的诊断模式。
- append 后必须 dry-parse 最终 config 内容；如果 parse 失败，本次写入必须回滚或不落盘。

##### Workflow Add

`agentmesh workflows add` 在复制到 registry 前必须完成全部校验：

- `id` 必填；不再从文件名兜底。
- 只允许已定义的顶层字段；未知字段 fail fast。
- 顶层字段 allowlist：`schema_version`, `workflow_recipe_version`,
  `compatible_packet_schema_versions`, `id`, `name`, `status`, `stages`,
  `description`, `when_to_use`, `packet_artifacts`, `quality_gates`,
  `user_gate`, `recipe_source`, `failure_policy`。
- `schema_version`, `workflow_recipe_version`, `compatible_packet_schema_versions`
  必须完整有效。
- 新 workflow 和内置 workflow 的 `compatible_packet_schema_versions` 必须等于 `[2]`；
  不允许 `[1, 2]`。`schema_version` 表示 TOML 文件结构版本，`workflow_recipe_version`
  表示 recipe contract 版本，`compatible_packet_schema_versions` 表示该 workflow 能创建的
  packet schema 版本，本轮最终态只允许创建 v2 packet。
- `name`, `description`, `when_to_use`, `packet_artifacts`, `quality_gates` 必须存在。
- `when_to_use`, `packet_artifacts`, `quality_gates` 必须是非空 string list。
- `stages` 必须通过最终 stage 规则：`decide` 可重复、不能第一个、不能连续。
- `failure_policy` 如果存在，必须只引用有效 stage type 或派生出的 stage node id；
  mode 只能是 `allow`, `terminal`, `required`；`max_fallback_agents` 必须在 `1-3` 内；
  `terminal` 不能配置 `max_fallback_agents`。
- `failure_policy` 引用未知 node id 时，错误信息必须列出该 workflow 派生出的合法 node ids。
- `packet_artifacts` 必须覆盖 workflow stages 的 canonical artifacts：
  - `plan` -> `plan.md`
  - `execute` -> `handoff.md`
  - `verify` -> `verification.md`
  - `review` -> `findings.md`
  - `decide` -> `decision.md`
  repeated stage 的 suffix artifacts 由 runtime 派生，不要求 workflow 手写所有出现次数。
- workflow id 不能和 built-in、user、project 任一 registry layer 冲突。
- 复制前必须用最终 workflow parser/schema dry-parse 目标文件内容，确保 registry 中的文件
  不只是 TOML 语法正确，而且满足完整 workflow 契约。

##### Flow Run

`flow run` 创建 packet 前必须完成全部校验：

- workflow 已通过 workflow 校验。
- 如果使用 preset，preset 已通过 preset 校验，并解析出 workflow + node-id assignments。
- 如果不使用 preset，仍然必须用 workflow `failure_policy` + global fallback 解析出
  node-id keyed fallback 执行事实。
- CLI role flags、preset assignments、preset/global default primary agents 和显式 stage
  assignment 解析后必须展开成 node-id keyed `stage_assignments`。
- Direct workflow run 的 CLI role flags 按 stage type 展开到所有同 type nodes；
  repeated nodes 如需不同 agents，必须使用 preset 的 node-id keyed `[stage_assignments]`。
- 每个 invokable primary lane 和 synthesis lane 都必须解析出 effective timeout，并写入
  node-id keyed `stage_invocations`。
- 每个 stage node 必须至少有一个 assigned agent。
- 每个 stage node 最多 6 个 assigned agents。
- `execute` node 必须刚好 1 个 assigned agent。
- 每个 assigned agent 必须存在。
- 每个 assigned agent 必须具备该 node type capability。
- `current` 只允许用于 host-owned attach/gate 路径。一个 node 要么是纯 `["current"]`，
  要么完全不包含 `current`；禁止 `["worker", "current"]` 这类混合 assignment。
- 纯 `current` node 不解析 fallback chain；`mode = "required"` 用在纯 `current` node 上创建失败。
- failure policy 解析后必须以 node-id 为 key 固化到 packet。
- fallback settings 解析后必须以 node-id 为 key 固化到 packet；`max_attempts_per_agent`
  只能是 `1-2`，`timeout_seconds` 只能是 `30-3600`。
- CLI `--timeout-seconds` 如果存在，必须在 `30-3600` 内，并覆盖所有 invokable primary、
  fallback 和 synthesis calls。
- 每个 fallback agents 配置列表最多 3 个 agents。
- fallback agents 必须存在、不能是 `current`，且必须具备目标 node type capability。
- `failure_policy.max_fallback_agents` 默认 1，最大 3。
- effective fallback chain 必须先继承、去重、过滤 primary agents，再按 `max_fallback_agents`
  截断；每个 fallback candidate 必须带 effective timeout 后固化到 packet。
- `mode = "terminal"` 的 node 不解析 fallback chain，并且 packet 中该 node 的
  `stage_fallbacks` 必须为空。
- `mode = "terminal"` 的 node 不能保留继承来的 `max_fallback_agents`。
- `mode = "required"` 的 node 创建 run 时必须解析到至少 1 个 effective fallback agent。

#### Release Verdict

`release-check` 仍然可以把最后一个 `decide` 当作 release gate，但这个语义不能污染所有 `decide`。

规则：

- 只有 `workflow === "release-check"` 时才解析 `Verdict:`。
- 只有当前 node 是 `stage_nodes` 的最后一个 node，且 node type 是 `decide` 时才更新
  `release_verdict`。
- release verdict 失败时写当前 node id，例如 `failed_stage = "decide_2"`，不能硬编码 `"decide"`。

定义共享 helper：

```ts
isReleaseVerdictNode(status, nodeId)
```

它必须同时满足：

```text
status.workflow === "release-check"
nodeId === status.stage_nodes[status.stage_nodes.length - 1].id
stageNodeForId(status, nodeId).type === "decide"
```

`dispatch` 和 `attach` 两条路径都必须走这个 helper，不能各自实现一份判断。

目标接口：

```ts
updateReleaseVerdict(runDir, stageId, decisionContent)
```

不要再用：

```ts
updateReleaseVerdict(runDir, decisionContent)
```

#### Code Change Areas

##### Core

Modify `packages/core/src/index.ts`:

- Packet schema version becomes `2`
- `deriveStageNodes()` 删除 `decide may appear at most once`
- 删除 `decide must be the final stage node`
- 新增 `decide must not be the first stage node`
- 新增 `decide must not immediately follow decide`
- 导出 fanout agent 上限常量，值为 `6`
- `PacketStatusSchema` 不再要求顶层 `plan` / `execute` / `review` / `decide`
  assignment 字段
- `PacketStatusSchema` v2 要求 `stage_invocations`, `stage_failure_policies`,
  `stage_fallbacks`, `stage_attempts`, `assignment_provenance`, `fallback_provenance`,
  `timeout_provenance`，并校验它们都以 stage node id 为 key
- `stage_attempts.status` 枚举包含 `completed`, `failed`, `timed_out`
- `stage_attempts` 每条记录包含 `lane_attempt` 和 `attempt`；`lane_attempt` 是同一 lane 的
  单调序号，`attempt` 是当前 actual agent 的尝试次数
- `PacketStatus` 类型和所有 status readers 改成从 `stage_assignments` + `stage_nodes`
  派生角色信息
- 保持 deterministic node id 派生逻辑

##### Public Readers

Modify SDK, Studio catalog, status rendering, packet fixtures, and tests:

- SDK read surface 不再依赖顶层 `plan` / `execute` / `review` / `decide`
- SDK/status readers 遇到 packet schema v1 必须 hard error，错误类型/文案为
  `unsupported packet schema version: 1`；不做 degraded read、warning 或 v1 迁移
- Studio 展示 agents/assignments 时从 `stage_assignments` 派生
- packet fixtures 删除 legacy assignment 字段
- packet fixtures 升到 `schema_version = 2`
- 增加 schema 测试：v2 `status.json` 不含 legacy 顶层 assignment 字段且能通过校验

##### Runtime State

Modify `packages/runtime/src/flow/state.ts`:

- `stageArtifactFile()` 支持 `decision_2.md`, `decision_3.md`
- `stageArtifactName()` 支持 `decision_2`, `decision_3`
- `stageAgents()` 只按 `stage_assignments[node.id]` 取值
- 不再从顶层 `plan` / `execute` / `review` / `decide` 字段 fallback
- 增加 `stageInvocations()` / `stageFailurePolicy()` / `stageFallbacks()` /
  `stageAttempts()` 读取 helper，避免 dispatch、status、Studio 各自解析 packet shape

##### Flow Creation

Modify `packages/runtime/src/flow/create.ts`:

- `resolvedStageAssignments()` 输出 node-id keyed assignments
- 增加 `resolvedDefaultStageAgents()`：从 preset/global default primary agents 和 CLI flags
  解析 node-id keyed primary assignments
- 增加 `resolvedStageInvocations()`：为每个 invokable primary lane 和 synthesis lane 固化
  effective timeout；纯 `current` lane 的 `timeout_seconds` 为 `null`
- 增加 `resolvedStageFailurePolicies()`：按 workflow policy、preset policy 和默认规则展开为
  node-id keyed `stage_failure_policies`
- 增加 `resolvedStageFallbacks()`：为每个 node 写 node-id keyed `stage_fallbacks`；
  terminal/current node 写空 agents，其他 node 把 preset/global fallback 展开、去重、
  过滤 primary agents、按 `max_fallback_agents` 截断后，以带 timeout 的 fallback
  candidate objects 写入
- repeated node 必须有自己的 resolved assignment
- CLI role flags 可以按 stage type 输入，并展开到所有同 type nodes；preset assignments
  可以按 stage type default 或 node id 输入；进入 packet 后必须展开成 node id
- direct CLI role flags 不能区分 repeated nodes，差异化 repeated node assignment 必须使用 preset
- `assignment.toml` 和 `status.json` 以 `[stage_assignments]` 为事实源
- `assignment.toml` 和 `status.json` 写入解析后的 `[stage_invocations]`,
  `[stage_failure_policies]` 和 `[stage_fallbacks]`，以及 assignment/fallback/timeout
  provenance；不在 dispatch 时读 workflow、preset、global config 或 agent registry
- 删除顶层 `plan` / `execute` / `review` / `decide` 写入
- 创建 run 时校验每个 node assignment 数量不能超过 6
- 创建 run 时拒绝 `execute` 节点配置多个 agent
- `assignment.toml` 保留 identity 字段：`schema_version`, `workflow`, `stages`
- assigned agent 存在性和 capability 匹配校验放在 CLI command 层完成，因为 CLI 层持有
  `configPath` 和 resolved agent registry；`createFlowRun` 只接收已经校验过的 assignments
- 创建 run 时仍可做纯结构校验：每个 node 有 assignment、数量上限、`execute` 单 agent、
  `current` 纯节点规则
- 创建 run 时仍可做 fallback 结构校验：node id 有效、mode 有效、`max_fallback_agents`
  在 `1-3` 内、`terminal` 不解析 fallback chain、`required` 至少解析到 1 个 fallback agent、
  `current` 不可出现在 fallback chain
- 创建 run 时必须写 v2 packet required fields，即使对应结构为空也写 `{}`。

##### Global Config

Modify config loading and validation:

- 支持 global `[default_stage_agents]` common default primary agents。
- 支持 global `[default_stage_agents.stage_types]` stage-type default primary agents。
- global default primary agents 不支持 node default。
- 每个 global default primary agents 列表最多 6 个 agents。
- global `[default_stage_agents.stage_types].execute` 必须刚好 1 个 agent；如果 common default
  最终被用于 `execute` 且数量不是 1，run 创建 fail fast。
- global default primary agents 必须存在且不能和 `current` 混用；capability 在 run 创建解析到
  target node type 时校验。
- 支持 global `[fallback]` common fallback。
- 支持 global `[fallback.stage_types.<stage-type>]` stage-type fallback。
- global 不支持 node fallback，因为 node id 依赖具体 workflow。
- 每个 global fallback agents 列表最多 3 个 agents。
- global `[fallback]` 支持 `max_attempts_per_agent` 和 `timeout_seconds`，作为 fallback
  execution settings 的默认值。
- global fallback agents 必须存在且不能是 `current`；capability 在 run 创建解析到具体
  target node type 时校验。

##### Preset Registry And Run Shortcut

Create:

- `docs/contracts/preset-toml.md`
- `packages/runtime/src/preset/registry.ts`
- `packages/cli/src/commands/preset.ts`
- `tests-node/preset-registry.test.ts`
- `tests-node/preset-cli.test.ts`
- `tests-node/flow-preset-run.test.ts`

Implement:

- `agentmesh preset list`
- `agentmesh preset show <id>`
- `agentmesh preset init <id> --workflow <workflow-id>`
- `agentmesh preset add <preset-file>`
- `agentmesh preset remove <id>`
- `agentmesh preset doctor <id>`
- `agentmesh run <preset-id> --task ...`

Bare `agentmesh run <id>` 只解析 preset namespace，不直接按 workflow id 创建 run。
如果 `<id>` 不是 preset 但存在同名 workflow，命令必须 fail fast，并提示使用
`agentmesh run --workflow <workflow-id>` 或 `agentmesh flow run --workflow <workflow-id>`。
如果 preset id 与 workflow id 同名，bare run 仍按 preset 解析；workflow 直跑必须显式
写 `--workflow`。

Preset run resolution:

1. Resolve preset.
2. Resolve referenced workflow.
3. Derive workflow stage nodes.
4. Resolve primary agents from explicit node assignments, preset defaults, then global defaults.
5. Write resolved primary agents to node-id keyed `stage_assignments`.
6. Resolve effective timeout for primary and synthesis lanes from CLI override, agent timeout, and system default.
7. Write resolved primary/synthesis invocation settings to node-id keyed `stage_invocations`.
8. Resolve effective `stage_failure_policies` from workflow policy, preset policy, and defaults.
9. For nodes whose policy is not `terminal`, resolve fallback chain from preset fallback and global fallback.
10. Inherit fallback scopes, deduplicate fallback agents, filter out primary agents, validate capability,
   and truncate each node fallback chain by `max_fallback_agents`.
11. Resolve fallback execution settings from CLI override, preset/global fallback settings, agent timeout,
   and system default.
12. Apply per-run CLI overrides that affect task/context/scope, but not fallback policy in the core model.
13. Validate agents, capabilities, max fanout, `execute` single-agent, `current` pure-node rule,
   fallback agents, fallback capability, fallback list length, and required-policy constraints.
14. Create packet with resolved preset provenance, assignment provenance, resolved stage invocations,
   resolved failure policies, fallback provenance, resolved fallback chains, fallback execution settings,
   and timeout provenance.

Direct workflow run resolution:

1. Resolve workflow from registry or `--workflow-file`.
2. Derive workflow stage nodes.
3. Resolve primary agents from CLI role flags, then global default primary agents.
4. Fail fast if any node still has no primary agents.
5. Resolve effective timeout for primary and synthesis lanes from CLI override, agent timeout, and system default.
6. Resolve workflow failure policy plus defaults.
7. Resolve fallback chain from global fallback only for non-terminal, non-current nodes.
8. Resolve fallback execution settings from CLI override, global fallback settings, agent timeout, and system default.
9. Filter primary agents, validate capability, truncate by `max_fallback_agents`, and materialize packet.
10. Write `preset = null`, `preset_source = null`, plus assignment/fallback/timeout provenance.

##### Agent Registration

Modify `packages/cli/src/commands/agents.ts` and
`packages/runtime/src/adapters/registration.ts`:

- 添加 agent id / alias / capability / reasoning effort 校验
- 添加 agent `timeout_seconds` 校验和 config parser 支持
- `agents add` 支持 `--timeout-seconds <seconds>`，写入 `agents.<id>.timeout_seconds`
- 添加 alias 与现有 agent id / alias 冲突校验
- 去重 aliases 和 capabilities
- `agents add` 必须通过 readiness/connectivity probe 才能写配置
- 移除 `--skip-verify` 的成功写入路径；如果保留 flag，只输出诊断，不写配置
- 写入前后都用 config parser 校验最终 TOML

##### Workflow Registration

Modify `packages/cli/src/commands/workflows.ts` and
`packages/runtime/src/workflow/registry.ts`:

- workflow `id` 改为必填，不再从文件名兜底
- 拒绝未知顶层字段
- 显式维护 workflow 顶层字段 allowlist
- 必填字段缺失或空数组时 fail fast
- 内置和新增 workflow 的 `compatible_packet_schema_versions` 改为精确 `[2]`
- 解析并校验 workflow `failure_policy`
- 校验 `packet_artifacts` 覆盖完整 stage canonical artifact 表
- 复制到 registry 前 dry-parse 目标内容

##### Prompt

Modify `packages/runtime/src/flow/prompt.ts`:

- 删除 legacy prompt 分支
- 所有 workflow 都用 ordered prior evidence，并保留 plan/handoff/verification/findings/decision
  的语义标签
- 前序 decision artifact 必须出现在后续 stage prompt 中
- release-check contract 只追加给 release-check 的 review/decide 节点

##### Dispatch

Modify `packages/runtime/src/flow/dispatch.ts`:

- dispatch 以 packet 内的 `stage_invocations`, `stage_failure_policies` 和
  `stage_fallbacks` 为准，不读取 workflow、preset registry、global config 或 agent registry
- `decide` fanout synthesis 输出当前 node 的 canonical artifact
- plan/decide fanout synthesis instruction 使用 `stageArtifactFile(status, node.id)` 派生出的文件名
- release verdict 更新只在 `isReleaseVerdictNode(status, node.id)` 为 true 时触发
- 失败、completed、events 全部使用 node id
- dispatch 入口再次校验 assigned agent 数量不超过 6
- dispatch 入口拒绝 `execute` 多 agent，统一错误信息：
  `stage '<node-id>' does not support multi-agent dispatch`
- dispatch 入口拒绝混合 `current` 和 worker assignment
- dispatch 入口拒绝纯 `current` node 的自动 dispatch；继续使用 prompt/attach 路径
- agent 尝试失败后先读取该 node 的 `failure_policy`
- `mode = "terminal"` 时不解析、不尝试 fallback，stage 标记 failed，run 不自动进入下一 stage
- `mode = "allow"` 或 `mode = "required"` 时，按 packet 中已截断的 node/lane fallback chain
  顺序接管；成功后继续当前 stage 聚合/合成流程
- fallback chain 耗尽时，stage 标记 failed，run 不自动进入下一 stage
- 每次尝试都写入 `stage_attempts`，记录 lane_id、primary_agent、requested_agent、
  actual_agent、fallback_from、lane_attempt、per-agent attempt、timeout_seconds、status、
  started_at、completed_at、error summary
- attempt 超时时写 `status = "timed_out"`；timeout 按 failure policy 处理，`terminal`
  直接停，`allow` / `required` 可继续 fallback
- timeout 和 retry 使用 packet 中固化的 invocation/fallback settings；同一 agent 超过
  `max_attempts_per_agent` 后才进入下一个 fallback agent；实际 fallback agent 数量不得超过
  `max_fallback_agents`
- multi-agent plan/decide synthesis invocation 使用独立 `lane_id = "<node-id>:synthesis"`
  和自己的 timeout budget；它失败或超时时同样走该 node 的 failure policy

##### Release Verdict

Modify `packages/runtime/src/release/verdict.ts`:

- `updateReleaseVerdict()` 接收 `stageId`
- 新增并导出 `isReleaseVerdictNode(status, stageId)` helper
- invalid verdict 时写 `failed_stage = stageId`
- invalid verdict 时从 `completed_stages` 移除 `stageId`
- invalid verdict 时 `setStageState(status, stageId, "failed")`

##### Docs And Studio

Modify:

- `docs/contracts/config-toml.md`
- `docs/contracts/workflow-toml.md`
- `docs/contracts/preset-toml.md`
- `docs/contracts/stage-dispatch.md`
- `docs/contracts/status-json.md`
- `README.md`
- `index.html`
- `apps/studio/src/assets.ts` and Studio workflow/status/assignment/artifact view modules found by P1.1
- tests that assert old decide final-only rule
- 中文 UI/docs/tests 中现有的“评审”统一替换为“审查”；历史 changelog 不改
- Studio workflow detail/status views must render repeated node ids such as `decide_2`, `review_2`
  and link to canonical artifacts such as `decision_2.md`, `findings_2.md`
- Studio assignment/status/fallback panels must render v2 `stage_assignments`,
  `stage_invocations`, `stage_failure_policies`, `stage_fallbacks`, and `stage_attempts`
  without relying on legacy top-level role fields
- Studio status panels must surface per-attempt `timeout_seconds` and `timed_out` status;
  assignment panels may show each agent's configured default timeout

文案统一成：

```text
decide is a decision checkpoint. It may repeat, but cannot be first or adjacent to another decide.
```

中文术语统一成：

```text
review = 审查
raw reviews = 原始审查
release / review = 发布 / 审查
```

#### Test Plan

Core tests:

- accepts `["plan", "decide", "execute", "review", "decide"]`
- accepts `["plan", "decide", "review", "decide"]`
- accepts `["verify", "decide", "verify", "decide"]`
- derives `decide_2`
- rejects `["decide", "plan"]`
- rejects `["plan", "decide", "decide", "execute"]`
- keeps max stage node count behavior
- accepts workflow with exactly 15 stage nodes
- rejects suffix input like `decide_2`
- PacketStatus v2 validates without top-level `plan`, `execute`, `review`, or `decide`
- PacketStatus v2 requires `stage_invocations`, `stage_failure_policies`, `stage_fallbacks`,
  `stage_attempts`, `assignment_provenance`, `fallback_provenance`, and `timeout_provenance`
- PacketStatus v2 accepts `stage_attempts.status = "timed_out"`
- PacketStatus v2 requires `stage_attempts[].lane_attempt` and per-agent `attempt`
- v1 packet status is rejected with `unsupported packet schema version: 1`; no migration path

Runtime tests:

- repeated decide writes `decision.md` and `decision_2.md`
- downstream prompt after first decide includes `decision.md`
- downstream prompt after second decide includes `decision_2.md`
- repeated decide fanout writes `outputs/decide_2/<agent>.md`
- repeated decide synthesis writes `decision_2.md`
- repeated plan/decide synthesis prompt names the derived artifact file, such as `plan_2.md` or `decision_2.md`
- release-check invalid verdict marks the actual node id as failed
- attach on non-final release-check `decide` does not write `release_verdict`
- prompt for `decide_2` includes prior `findings.md` and prior `decision.md`
- rejects more than 6 assigned agents for one fanout-capable node
- warns, but does not fail, when `plan` or `decide` fanout has 4 or more agents
- 4+ `plan` / `decide` soft warning appears in preset add/doctor and run creation validation output
- rejects multi-agent assignment for an `execute` node
- rejects run creation when assigned agent is unknown
- rejects run creation when assigned agent lacks required capability
- rejects mixed `current` + worker assignment
- global default primary agents fill missing primary assignments for direct workflow runs
- direct CLI role flags apply to every repeated node of the same stage type
- repeated node differentiated assignment requires preset node-id keyed `[stage_assignments]`
- preset default primary agents override global default primary agents
- explicit node assignment overrides preset/global default primary agents
- default primary agents reject missing agents, capability mismatch, execute fanout, and mixed `current`
- `[default_stage_agents.stage_types].execute` rejects anything except exactly one agent
- common default with multiple agents fails at run creation if it is the effective default for `execute`
- agent-level `timeout_seconds` resolves into `stage_invocations` for primary lanes
- synthesis lanes are materialized only for multi-agent `plan` / `decide` nodes and resolve their own
  timeout budget in `stage_invocations`
- CLI `--timeout-seconds` overrides primary, fallback, and synthesis lane timeouts
- fallback timeout resolution uses preset/global fallback timeout before agent timeout
- agent timeout falls back to system default 900 when omitted
- timeout provenance records `cli`, `preset_fallback`, `global_fallback`, `agent`, or `system_default`
- timeout is per attempt when `max_attempts_per_agent = 2`
- pure `current` node has `timeout_seconds = null` and ignores agent timeout
- resolved packet stores node-id keyed `stage_failure_policies`
- resolved packet stores node-id keyed `stage_fallbacks` for every node, with empty agents for
  terminal/current nodes
- `failure_policy.mode = "terminal"` prevents fallback chain resolution and marks the stage failed
- `failure_policy.mode = "required"` rejects run creation when no fallback agent resolves
- `failure_policy.max_fallback_agents` truncates the effective fallback chain
- preset that omits `failure_policy` inherits workflow policy and system defaults
- policy field-level merge keeps inherited `max_fallback_agents` when only a non-terminal `mode` is
  overridden; overriding to `terminal` clears `max_fallback_agents`
- preset policy cannot loosen workflow `terminal` or `required`
- workflow explicit `max_fallback_agents` prevents preset from increasing that limit
- node fallback takes precedence over preset stage-type, preset common, global stage-type, and global common fallback
- `inherit_common` and `inherit_stage_type` default to true
- fallback execution settings resolve from CLI/preset/global/agent/default and are written into
  `stage_fallbacks`
- primary assigned agents are filtered out of the effective fallback chain before truncation
- `inherit_common = false` prevents common fallback from being added to the effective chain
- fallback agent success records lane_id, primary_agent, requested agent, actual agent, fallback_from,
  lane_attempt, and per-agent attempt number
- timeout attempt records `status = "timed_out"` and then follows `failure_policy`
- fanout fallback replaces only the failed lane and does not rerun successful lanes
- `execute` fallback runs sequentially and never creates execute fanout
- dispatch refuses fallback chain containing `current`
- dispatch refuses fallback agent without target stage capability
- dispatch stops after fallback chain exhaustion and does not advance to the next stage
- pure `current` node ignores global/preset fallback and rejects `mode = "required"`

CLI/workflow tests:

- custom workflow with mid-flow decide loads
- `agents add` refuses unsafe ids, unsafe aliases, duplicate aliases, unsupported capabilities, and unsupported reasoning effort
- `agents add` rejects `timeout_seconds` outside `30-3600`
- `agents add` probe timeout is independent from agent `timeout_seconds`
- `agents add` rejects `--capability decide_2` and any value outside stage types
- `agents add` refuses to write config when connectivity probe fails
- `agents add` writes config only after command/auth/model connectivity succeeds
- `workflows add` rejects missing id instead of deriving from filename
- `workflows add` rejects unknown top-level fields
- `workflows add` rejects concrete unknown top-level example such as `foo = "bar"`
- `workflows add` rejects missing or empty `when_to_use`, `packet_artifacts`, or `quality_gates`
- `workflows add` rejects invalid `failure_policy` mode, unknown stage type/node id, and
  `max_fallback_agents` outside `1-3`
- `workflows add` error for unknown failure policy node id lists valid derived node ids
- `workflows add` rejects `compatible_packet_schema_versions` other than exactly `[2]`
- built-in workflows do not use `failure_policy.mode = "required"`
- `workflows add` rejects packet artifacts that do not cover required canonical outputs
- `preset add` rejects unknown preset id duplicates and unknown workflow refs
- `preset add` rejects unresolved primary assignments after applying explicit assignments and defaults
- `preset add` rejects unknown agents, incompatible capabilities, too many agents, execute fanout, and mixed current assignments
- `preset add` error for unknown assignment/failure/fallback node id lists valid derived node ids
- `preset add` validates preset defaults against the referenced workflow stage types where determinable
- global config rejects invalid default primary agents
- global config rejects fallback agent lists longer than 3
- global config rejects fallback execution settings outside allowed bounds
- CLI rejects `--timeout-seconds` outside `30-3600`
- `preset add` rejects unknown fallback agents, fallback capability mismatch, fallback agent lists longer than 3,
  `current` fallback, invalid failure policy, and attempts to loosen workflow terminal policy
- `preset add` rejects fallback execution settings outside allowed bounds
- `preset init <id> --workflow <workflow-id>` emits derived node ids, default primary placeholders,
  failure policy placeholders, and fallback placeholders
- `preset doctor <id>` validates assignments, defaults, fallback agents, failure policy, capabilities,
  and provenance materialization
- `agentmesh run <preset-id> --task ...` creates a packet with preset provenance and resolved node-id `stage_assignments`
- `agentmesh run <preset-id> --task ...` creates a packet with resolved node-id `stage_failure_policies`
- `agentmesh run <preset-id> --task ...` creates a packet with resolved node-id `stage_fallbacks`
- bare `agentmesh run <workflow-id>` fails with guidance unless `<workflow-id>` is also a preset id;
  direct workflow run requires `--workflow`
- `flow run` expands assignments to node ids
- direct `flow run --workflow <id>` without preset still resolves workflow `failure_policy` and global fallback
- direct `flow run --workflow <id>` without preset writes `preset = null`, `preset_source = null`,
  `assignment_provenance`, `fallback_provenance`, and `timeout_provenance`
- `status.json` does not write top-level `plan`, `execute`, `review`, or `decide`
- `assignment.toml` does not write top-level `plan`, `execute`, `review`, or `decide`
- `flow dispatch --stage all` runs through mid-flow decide and continues
- `flow status` displays repeated decide node ids correctly

Docs/UI tests:

- Studio workflow rules no longer say final-only
- Studio Chinese copy says 审查, not 评审
- Studio renders `decide_2`, `review_2`, and corresponding artifact links correctly
- Studio renders v2 invocation/fallback/failure/attempt details, including timeout and timed_out,
  without legacy top-level role fields
- docs no longer say decide may appear at most once
- examples show decide checkpoint workflows
- README and `index.html` show preset-first quick usage

#### Non-Goals

- Do not support execute fanout.
- Do not keep final-only decide semantics.
- Do not add migration behavior for old packets.
- Do not preserve runtime fallback to legacy top-level assignment fields.
- Do not write legacy top-level assignment fields to new packets.
- Do not keep `workflow_defaults` as the user-facing quick-run abstraction; preset replaces it.
- Do not let workflow bind concrete default primary agents.
- Do not let workflow bind concrete fallback agents; workflow only defines failure policy.
- Do not add per-capability agent timeouts; `agents.<id>.timeout_seconds` is a single scalar.
- Do not let presets override `agents.<id>.timeout_seconds` for primary lanes; presets only override
  fallback candidate timeouts through `[fallback]`.
- Do not add implicit fallback agents outside explicit global config or preset configuration.
- Do not let fallback bypass a node explicitly marked terminal failure.
- Do not introduce DAG branching; this remains a linear workflow model.

## 5. 完整计划

### P0. Token Budget 与 Prompt 成本护栏

- [x] P0 阶段完成门禁（仅在 `P0.Z` 完成 review、日志和 commit 后勾选）
- 阶段目标：在 Plan A 的 fanout、prompt、prior evidence 改造前，先让 context/prompt 成本可观测，并补上最小预算护栏，避免后续实现继续放大 token 成本。
- 阶段门禁：完成 P0.1-P0.3 和 P0.Z。
- 背景事实：4.7、Cursor、Gemini review 已确认 token 成本主因不是 task 关键词，而是大 `context.md` / diff payload、fanout per-agent prompt duplication、synthesis prompt 重复 base context，以及 findings / prior raw reviews replay。
- 非目标：本阶段不做 shared-context fanout reference mode，不做大文件 reference mode，不改变 worker 必须能独立理解 prompt 的基础契约；这些语义变化延后到 P4/P5 结合 prompt contract 一起做。

- [x] P0.1 增加 context / prompt 字节观测。
  - Slice：`P0.1`
  - 依赖：无
  - 文件：`packages/runtime/src/flow/context-pack.ts`、`packages/runtime/src/flow/prompt.ts`、`packages/runtime/src/flow/dispatch.ts`、`packages/runtime/src/packet/io.ts`、`packages/core/src/index.ts`、`packages/sdk/src/index.ts`、`tests-node/flow-context.test.ts`、`tests-node/flow-dispatch.test.ts`、`tests-node/packet-validate.test.ts`
  - 目标：让每个 run 能看到最终 `context.md` bytes、每个 prompt artifact bytes、fanout per-agent prompt bytes 和 synthesis prompt bytes。
  - 动作：在 context 写入后记录 `context_bytes`；在 `writePrompt()` 和 synthesis prompt 写入后记录 prompt byte metrics；将 metrics 写入 `status.json` 或稳定 event/artifact summary，并通过 `flow status --json` 暴露；先只观测，不硬 fail。
  - 产出：status/schema/SDK reader 更新、runtime metrics、targeted tests。
  - 验证：创建含 context + multi-review fanout 的 fake run，断言 `flow status --json` 能看到 context bytes 和每个 reviewer prompt bytes；断言无 context 时 metrics 为 0 或字段缺省语义明确。
  - Review：重点看 schema 命名、历史 packet 容忍度、Studio 后续消费字段是否稳定。
  - 证据：测试命令、sample `flow status --json` 摘要、review 结论。
  - 进度记录：已完成。`status.json` 写入 `context_bytes` 和 `prompt_bytes`；`flow status --json` 与 SDK run summary 可读；fanout per-agent prompt 与 synthesis prompt 都记录 UTF-8 bytes、path、stage、agent 和 kind。
  - 收尾：已更新 checklist 和 `changelog/2026-05-16.md`，待本 slice commit。
  - 提交：`feat(flow): record context and prompt byte metrics`

- [x] P0.2 补 context policy 默认建议与 denied paths 文档。
  - Slice：`P0.2`
  - 依赖：P0.1
  - 文件：`.agentmesh/config.toml` 模板或 `agentmesh init` 输出、`docs/contracts/context-policy.md`、`README.md`、`agentmesh-skill/SKILL.md`、相关 config/init tests
  - 目标：把已有 `[context_policy]` 能力从“有字段”变成“用户知道怎么低风险使用”，尤其是 `denied_paths`。
  - 动作：文档给出推荐默认：`max_files`、保守 `max_bytes`、`.agentmesh/runs`、`docs/archive`、`dist-node`、`node_modules` deny 示例；说明 bytes 是 token 代理，不等于精确 token；说明 `--exclude-correction` 适用场景；如改 `agentmesh init`，只写注释模板或保守默认，避免突然破坏现有 dogfood run。
  - 产出：docs / skill / init 示例更新。
  - 验证：config parsing tests；README / contract 示例可解析；`git diff --check`。
  - Review：docs review，重点看默认是否过严、是否会误导用户以为完全按 token 计费。
  - 证据：示例片段、测试结果、review 结论。
  - 进度记录：已完成。`agentmesh init` 模板新增注释版 `[context_policy]` 保守示例；`context-policy.md`、`README.md`、`agentmesh-skill/SKILL.md` 同步 denied paths、bytes 代理语义和 `--exclude-correction` 用法。
  - 收尾：已更新 checklist 和 `changelog/2026-05-16.md`，待本 slice commit。
  - 提交：`docs(context): add token budget policy guidance`

- [x] P0.3 给 scoped diff 和生成后 context 加预算边界。
  - Slice：`P0.3`
  - 依赖：P0.1、P0.2
  - 文件：`packages/runtime/src/flow/context-pack.ts`、`packages/runtime/src/flow/context-policy.ts`、`packages/runtime/src/config.ts`、`docs/contracts/context-policy.md`、`tests-node/flow-context.test.ts`、`tests-node/config-layering.test.ts`
  - 目标：修复现有 `max_bytes` 主要按输入文件 stat 估算、无法覆盖 `git diff HEAD -- <scope>` stdout、MCP/spec/corrections 生成内容的预算盲区。
  - 动作：对 `scopedGitDiffContextEntry()` 的 stdout 计算 bytes，超过阈值时写明确 marker 和 source command；最终 `context.md` 生成后按实际 UTF-8 bytes 记录并参与 policy 判定；MCP/spec/corrections 先至少进入 metrics 和总量判断，是否 per-source cap 由 review 决定。
  - 产出：context budget enforcement、truncation marker contract、tests。
  - 验证：构造超大 scoped diff fake repo，断言 context 中有 truncation marker、source command、实际 bytes metrics；构造 MCP/spec/correction oversized case，断言至少能在 metrics/total budget 中暴露；现有 flow context tests 通过。
  - Review：重点看截断是否会造成 review blindness；marker 必须可被 downstream prompt 和 reviewer 明确识别，且保留完整 source path / command。
  - 证据：测试结果、截断样例、review 结论。
  - 进度记录：已完成。最终 `context.md` 生成后按 `context_policy.max_bytes` 重新计算 UTF-8 bytes；超限时写入 `AGENTMESH_CONTEXT_TRUNCATED` marker、`max_bytes`、`original_bytes` 和 scoped diff `source_command`，并让 `context_bytes` 记录实际写入的 bounded bytes。
  - 收尾：已更新 checklist、docs 和 `changelog/2026-05-16.md`，待本 slice commit。
  - 提交：`feat(context): cap scoped diff context size`

- [x] P0.Z 阶段收尾校准。
  - Slice：`P0.Z`
  - 目标：确认 token budget 观测、docs 默认、scoped diff budget 与后续 Plan A prompt/fanout 改造边界一致。
  - 验证：P0 targeted tests；`git diff --check`；一次 review-gate dogfood run 中 `flow status --json` 可见 prompt bytes。
  - Review：4.7 + Cursor/Gemini 或至少 4.7 只读 review；accepted findings 必须处理或写入 residual risk。
  - 证据：`npm test` 343/343；`git diff --check` 无输出；临时 review-gate fake fanout run 的 `flow status --json` 显示 `context_bytes = 1138`，`prompt_review_reviewer_a.bytes = 1668`，`prompt_review_reviewer_b.bytes = 1668`；P0 slice commits `9538541`、`1d7c4cc`、`f5b03fb`。
  - 进度记录：已完成。主控 review 未发现 Must findings；residual risk：bytes 是 token 成本代理，不等同具体模型 tokenizer。
  - 提交：`docs(plan): finalize token budget baseline`

### P1. 基线校准与契约冻结

- [x] P1 阶段完成门禁（仅在 `P1.Z` 完成 review、日志和 commit 后勾选）
- 阶段目标：冻结最终 contract：stage rules、packet v2、default primary agents、failure policy、fallback routing、agent timeout、provenance 和 artifact 命名。
- 阶段门禁：P0.Z 完成后，完成 P1.1-P1.4 和 P1.Z。

- [x] P1.1 重新核对当前代码事实。
  - Slice：`P1.1`
  - 依赖：P0.Z
  - 文件：`packages/core/src/index.ts`、`packages/runtime/src/flow/*`、`packages/cli/src/cli.ts`、`packages/cli/src/commands/flow.ts`、`packages/cli/src/commands/workflows.ts`、`packages/cli/src/commands/agents.ts`、Studio view modules、`docs/contracts/*`、`tests-node/*`
  - 目标：确认当前代码仍与本计划的问题陈述一致。
  - 动作：使用 `rg` 定位 `deriveStageNodes`、`PacketStatusSchema`、`stageAgents`、artifact naming、prompt assembly、dispatch、retry/resume/attach、agent registration、workflow registry、preset/run shortcut、status readers、Studio packet rendering。
  - 产出：事实核对记录写回本 slice 进度记录。
  - 验证：命令输出能定位关键实现点；如事实变化，先 patch 本计划再实现。
  - Review：主控自检；必要时让 reviewer 只读确认差异。
  - 证据：`rg`/文件路径/行号摘要。
  - 进度记录：已完成。事实核对支持计划问题陈述：`packages/core/src/index.ts` 仍为 `CURRENT_SCHEMA_VERSION = 1`，`deriveStageNodes()` 仍拒绝重复 `decide` 并要求 final-only；`PacketStatusSchema` 仍要求顶层 `plan` / `execute` / `review` / `decide`，`stage_invocations` / `stage_failure_policies` / `stage_fallbacks` / `stage_attempts` / provenance 仍未建模；`packages/runtime/src/flow/state.ts` 的 `stageAgents()` 仍 fallback 到 legacy 顶层字段，`decide` artifact 仍固定 `decision.md`；`packages/runtime/src/flow/prompt.ts` 仍有 `hasRepeatedStageNodes()` 分支；`packages/runtime/src/release/verdict.ts` 的 `updateReleaseVerdict()` 仍硬编码 `failed_stage = "decide"`；workflow registry 和 tests 仍使用 packet compatibility `[1]`；preset/default primary/failure/fallback/timeout 尚未实现；Studio/README/index 中文仍有“评审”，Studio workflow rule 仍写 `decide` 最多一次且最终。
  - 收尾：记录事实 -> 更新计划差异 -> 进入 P1.2。
  - 提交：`docs(plan): calibrate workflow semantics baseline`

- [x] P1.2 固化 packet v2 和 workflow recipe compatibility。
  - Slice：`P1.2`
  - 依赖：P1.1
  - 文件：`packages/core/src/index.ts`、`docs/contracts/status-json.md`、`docs/contracts/workflow-toml.md`、fixtures、workflow TOML
  - 目标：明确 packet schema v2、required fields、v1 unsupported 行为、workflow compatible packet schema。
  - 动作：定义 v2 fields：`stage_assignments`、`stage_nodes`、`stage_failure_policies`、`stage_fallbacks`、`stage_invocations`、`stage_attempts`、`assignment_provenance`、`fallback_provenance`、`timeout_provenance`；移除 legacy role fields。
  - 产出：schema、docs、fixtures、tests。
  - 验证：core schema tests；packet fixture validation；v1 unsupported test。
  - Review：schema review 重点看 breaking change 是否清晰。
  - 证据：`tests-node/fixtures/packets/valid-basic/status.json` 已升级为 packet v2；`docs/workflows/review-gate.toml` 和 workflow tests 使用 `compatible_packet_schema_versions = [2]`；`tests-node/packet-validate.test.ts` 覆盖 v1 status rejected。
  - 进度记录：已完成。`CURRENT_PACKET_SCHEMA_VERSION = 2` 独立于通用 `CURRENT_SCHEMA_VERSION = 1`；`PacketStatusSchema` 必填 `stage_assignments`、`stage_invocations`、`stage_failure_policies`、`stage_fallbacks`、`stage_attempts` 和三类 provenance；新建 run 的 `status.json` 与 `assignment.toml` 不再写顶层 `plan` / `execute` / `review` / `decide` legacy role 字段；workflow compatibility 改为必须包含 packet schema 2。
  - 收尾：已更新 checklist、docs、fixtures 和 `changelog/2026-05-16.md`，待本 slice commit。
  - 提交：`feat(core): introduce packet schema v2`

- [x] P1.3 固化 stage node / artifact / prompt / release verdict 规则。
  - Slice：`P1.3`
  - 依赖：P1.2
  - 文件：`packages/core/src/index.ts`、`packages/runtime/src/flow/state.ts`、`packages/runtime/src/flow/prompt.ts`、`packages/runtime/src/release/verdict.ts`
  - 目标：实现 repeatable decide、canonical artifacts、prior evidence prompt、release verdict helper。
  - 动作：删除 final-only decide；新增 decide 非首位和非连续校验；统一 artifact suffix；删除 repeated prompt 分支；新增 release verdict node helper。
  - 产出：核心规则实现和 tests。
  - 验证：core + runtime targeted tests。
  - Review：重点看 repeated node id、artifact id、release-check gating。
  - 证据：`deriveStageNodes()` 允许非连续 repeated `decide`，同时拒绝首位和连续 `decide`；runtime artifact id/file 使用 `decision_2.md` / `decision_2`、`handoff_2`、`verification_2`、`findings_2` 语义后缀；prompt assembly 统一 ordered prior evidence 和 semantic label；`isReleaseVerdictNode()` 只允许 `release-check` 最终 `decide` 写入 release verdict，invalid verdict 的 `failed_stage` 指向实际 stage node id；`npm test` 346/346，`git diff --check` 无输出。
  - 进度记录：已完成。P1.3 规则已在 core、runtime flow、prompt、review artifacts、release verdict helper 和 contract docs 中固化；新增 release-check 中间 `decide` 回归测试，确认中间 checkpoint 不写 `release_verdict`，最终 `decide_2` 才记录 `Verdict: ready`。
  - 收尾：已更新 checklist、docs、tests 和 `changelog/2026-05-16.md`，待本 slice commit。
  - 提交：`feat(core): make decide a repeatable checkpoint`

- [x] P1.4 固化 default/failure/fallback/timeout resolution contract。
  - Slice：`P1.4`
  - 依赖：P1.2
  - 文件：`docs/contracts/config-toml.md`、`docs/contracts/preset-toml.md`、`docs/contracts/stage-dispatch.md`、core/runtime types
  - 目标：把 default primary agents、failure policy、fallback routing、agent timeout、CLI timeout 和 provenance 的优先级写成可实现 contract。
  - 动作：定义 primary agent resolution、policy merge、fallback inheritance、primary filtering、`current` exclusion、`stage_invocations`、`stage_attempts.status = timed_out`、`lane_attempt` / per-agent `attempt` 语义、timeout provenance。
  - 产出：contract docs、type sketches、test checklist。
  - 验证：docs self-check，不能出现未定义字段或冲突优先级。
  - Review：4.7 或另一个 reviewer 只读审 contract。
  - 证据：新增 `docs/contracts/config-toml.md` 和 `docs/contracts/preset-toml.md`；`stage-dispatch.md`、`status-json.md`、`workflow-toml.md`、`execution-policy.md`、`config-layering.md`、`agent-registration.md` 同步 default primary agents、policy merge、fallback inheritance、primary filtering、`current` exclusion、invocation timeout、fallback timeout、`stage_attempts.status = timed_out`、`lane_attempt` / per-agent `attempt` 和 provenance；core 导出 fanout/fallback/timeout 常量并把 packet timeout schema 收紧到 `30-3600`；workflow compatibility 收紧为精确 `[2]`。
  - 进度记录：已完成。Contract docs 已由 `core-contracts.test` 固定关键词，runtime workflow registry 和 flow create compatibility gate 与 docs 对齐；`npm test` 346/346，`git diff --check` 无输出。
  - 收尾：已更新 checklist、contract docs、schema tests 和 `changelog/2026-05-16.md`，待本 slice commit。
  - 提交：`docs(contracts): define execution routing resolution`

- [x] P1.Z 阶段收尾校准。
  - Slice：`P1.Z`
  - 目标：确认 P1 contract、review findings、docs 和下一阶段实现范围一致。
  - 验证：`git diff --check`；targeted docs/schema tests；open Must findings 为 0；
    accepted Should/Nit 要么处理，要么记录 residual risk。
  - Review：4.7 review；ds/opencode 可用时补跑，否则记录不可用原因。
  - 证据：`docs/reviews/workflow/p1-workflow-contract-freeze-2026-05-16.md`；review-gate run `p1z-contract-freeze-20260516-2050`；Claude review 无 Must findings；opencode lane 失败并记录为不可用证据；accepted Should 1-3 已处理；pure `current` fallback 默认和未来 timeout provenance 值延后到 P3；targeted P1.Z tests 67/67，cleanup targeted tests 66/66，P1.Z full `npm test` 346/346。
  - 进度记录：已完成。P1 contract、docs、schema/runtime touchpoints 和下一阶段范围一致；P2.1/P2.2 已由 P1.2-P1.4 提前满足，P2 后续从 P2.3 workflow validation 开始。
  - 提交：`docs(plan): freeze workflow contract phase`

### P2. Core Schema 与 Workflow Registry

- [x] P2 阶段完成门禁（仅在 `P2.Z` 完成 review、日志和 commit 后勾选）
- 阶段目标：实现 stage derivation、PacketStatus v2、workflow TOML validation 和 public readers 基础。
- 阶段门禁：完成 P2.1-P2.4 和 P2.Z。

- [x] P2.1 更新 core stage derivation。
  - Slice：`P2.1`
  - 依赖：P1.Z
  - 文件：`packages/core/src/index.ts`、core tests
  - 目标：实现所有 stage 可重复、decide 非首位、decide 非连续、最大 15 node、suffix 输入拒绝。
  - 动作：修改 `deriveStageNodes` 和错误信息；导出 fanout 上限常量。
  - 产出：core rule tests。
  - 验证：`npm test -- tests-node/core-contracts.test.ts` 或对应 targeted test。
  - Review：检查错误信息是否包含 derived node ids。
  - 证据：P1.3/P1.4 已实现：`deriveStageNodes()` 支持所有 stage 重复、拒绝 suffix 输入、拒绝首位/连续 `decide`，并导出 `MAX_FANOUT_AGENTS = 6`；`tests-node/core-contracts.test.ts` 覆盖 repeated decide、first/consecutive decide、stage count 和 suffix 输入。
  - 进度记录：已完成（由 P1.3/P1.4 提前落地）。
  - 收尾：P1.Z 校准中标记完成。
  - 提交：`feat(core): relax decide stage placement`

- [x] P2.2 更新 PacketStatus v2 schema 和 fixtures。
  - Slice：`P2.2`
  - 依赖：P2.1
  - 文件：`packages/core/src/index.ts`、fixtures、SDK/readers tests
  - 目标：v2 packet required fields 生效；legacy top-level role fields 删除。
  - 动作：更新 schema、types、fixtures、reader behavior、unsupported v1 handling。
  - 产出：v2 fixture 和 schema tests。
  - 验证：packet validation tests。
  - Review：重点看 v1 unsupported 是否明确。
  - 证据：P1.2/P1.4 已实现：`PacketStatusSchema` 必填 v2 execution fields，fixture `tests-node/fixtures/packets/valid-basic/status.json` 已升级，`loadStatus()` 和 packet validation 拒绝 v1，packet timeout schema 收紧到 `30-3600`；targeted P1.Z packet tests 通过。
  - 进度记录：已完成（由 P1.2/P1.4 提前落地）。
  - 收尾：P1.Z 校准中标记完成。
  - 提交：`feat(core): require packet status v2 fields`

- [x] P2.3 加强 workflow add validation。
  - Slice：`P2.3`
  - 依赖：P2.1
  - 文件：`packages/runtime/src/workflow/registry.ts`、`packages/cli/src/commands/workflows.ts`、workflow docs/tests
  - 目标：workflow id 必填、字段 allowlist、required arrays、packet_artifacts coverage、failure_policy validation、packet compatibility v2。
  - 动作：实现严格 parser；未知 node id 报错列出合法 derived node ids；内置 workflow 不使用 required policy。
  - 产出：registry/CLI tests。
  - 验证：workflow registry targeted tests。
  - Review：重点看 temporary workflow 和 registry workflow 行为一致。
  - 证据：`loadWorkflowToml()` 现在要求显式 `id`、拒绝 unknown top-level fields、支持并校验 `[failure_policy.stage_types.*]` / `[failure_policy.nodes.*]`、校验 required arrays 非空、校验 `packet_artifacts` 覆盖 stage canonical artifacts、未知 node id 错误列出合法 node ids；`workflows add` 通过同一 parser 在复制前拒绝无效 workflow 文件；`npm test` 350/350。
  - 进度记录：已完成。Workflow registry、temporary workflow 和 CLI add 路径共用严格校验；`docs/contracts/workflow-toml.md` 同步 allowlist、required arrays、artifact coverage 和 failure policy 规则。
  - 收尾：已更新 checklist、日志和测试，待本 slice commit。
  - 提交：`feat(workflow): validate v2 workflow recipes`

- [x] P2.4 更新 SDK/Studio/status readers 基础。
  - Slice：`P2.4`
  - 依赖：P2.2
  - 文件：`packages/sdk/src/index.ts`、`apps/studio/src/assets.ts`、Studio workflow/status/assignment/artifact view modules、status rendering tests
  - 目标：所有展示从 `stage_assignments`、`stage_nodes` 和 v2 execution fields 派生。
  - 动作：删除 legacy role reader assumptions；显示 repeated node ids；支持 v2 fields。
  - 产出：SDK/Studio tests。
  - 验证：targeted UI/read tests。
  - Review：检查中文术语是否为“审查”。
  - 证据：SDK summary 暴露 `stage_nodes`、`stage_assignments`、`stage_invocations`、`stage_failure_policies`、`stage_fallbacks`、`stage_attempts` 和 provenance；Studio Workflow Flow 改用 node-id 渲染 repeated `decide_2`，详情展示 assignment / invocation / failure policy / fallback / attempt / provenance；中文 UI/Studio docs 统一“审查”；targeted SDK/Studio DOM tests 14/14。
  - 进度记录：已完成。`tests-node/sdk-read.test.ts` 覆盖 packet v2 repeated node reader 和 `current_stage = decide_2`；`tests-node/studio-ui.test.ts` 覆盖 repeated node DOM、v2 execution facts 和“评审”术语清空。
  - 收尾：已更新 checklist 和日志，待本 slice commit。
  - 提交：`feat(sdk): read packet v2 stage assignments`

- [x] P2.Z 阶段收尾校准。
  - Slice：`P2.Z`
  - 目标：确认 core/schema/workflow/readers 基础已稳定。
  - 验证：core + workflow + SDK targeted tests；`git diff --check`。
  - Review：schema/readers review；open Must findings 为 0，accepted Should/Nit 要么处理，要么记录 residual risk。
  - 证据：`docs/reviews/workflow/p2-workflow-schema-readers-2026-05-16.md`；review-gate run `p2z-schema-readers-20260516-2133`；Claude review 无 Must findings；accepted Should 1/3/6 已处理；provenance schema tightening 延后到 P3，agent_timing exact-key finding 已拒绝并记录理由，SDK 双读和 schema guard cleanup 记录为 residual/deferred；P2.Z targeted tests 67/67；`npm test` 352/352；`git diff --check` 无输出。
  - 进度记录：已完成。Packet schema 现在 exact-key 校验 `stage_assignments`，failure policy schema / workflow parser 拒绝 unknown policy fields，Studio 空 invocation 显示“无”而不是“未知”。
  - 提交：`test(core): lock workflow schema semantics`

### P3. Runtime Creation 与 Config/Preset Resolution

- [x] P3 阶段完成门禁（仅在 `P3.Z` 完成 review、日志和 commit 后勾选）
- 阶段目标：创建 run 时完整解析 primary/default/failure/fallback/timeout/provenance，并写入 packet v2。
- 阶段门禁：完成 P3.1-P3.5 和 P3.Z。

- [x] P3.1 实现 global config default primary 与 fallback settings。
  - Slice：`P3.1`
  - 依赖：P2.Z
  - 文件：config loader、docs/contracts/config-toml.md、config tests
  - 目标：支持 `[default_stage_agents]`、`[fallback]`、fallback execution settings、bounds validation。
  - 动作：解析 common/stage-type defaults；禁止 global node default；校验 agent id、current 混用、列表上限、execute stage-type default 必须刚好 1 个 agent、timeout bounds。
  - 产出：config schema/tests/docs。
  - 验证：config-layering targeted tests。
  - Review：重点看 direct workflow run 依赖 global defaults 是否清晰。
  - 证据：`npm run build && node --test dist-node/tests-node/config-layering.test.js` 30/30。
  - 进度记录：已完成。config loader 支持 `[default_stage_agents]` common defaults、`[default_stage_agents.stage_types]` flat shorthand、`[default_stage_agents.stage_types.<type>]` nested tables、`[fallback]` common fallback 和 `[fallback.stage_types.<type>]` stage fallback settings；校验 global node defaults 禁用、agent id、`current` 混用、execute stage-type exactly one、fanout/fallback list bounds、fallback attempts 和 timeout bounds；config contract 同步 global default/fallback 语义。
  - 提交：`feat(config): add default agents and fallback settings`

- [x] P3.2 实现 preset registry 和 run shortcut。
  - Slice：`P3.2`
  - 依赖：P2.Z
  - 文件：`packages/runtime/src/preset/registry.ts`、`packages/cli/src/commands/preset.ts`、`packages/cli/src/cli.ts`、`packages/cli/src/commands/flow.ts`、CLI wiring、tests
  - 目标：支持 preset list/show/init/add/remove/doctor 和 `agentmesh run <preset-id>`。
  - 动作：实现 registry、template generation、doctor validation、provenance；裸
    `agentmesh run <id>` 只解析 preset namespace，workflow 直跑必须显式 `--workflow`。
  - 产出：preset CLI/tests/docs。
  - 验证：preset CLI targeted tests。
  - Review：检查 `preset init` 是否列出 derived node ids 和 placeholders。
  - 证据：`npm run build && node --test dist-node/tests-node/management-cli.test.js dist-node/tests-node/flow-preset-run.test.js dist-node/tests-node/core-contracts.test.js` 23/23。
  - 进度记录：已完成。新增 preset registry parser/validator/template/provenance helper，支持用户级与项目级 preset registry；CLI 支持 `preset list/show/init/add/remove/doctor`；`agentmesh run <preset-id>` 只解析 preset namespace，写入 `preset` / `preset_source`，同名 workflow 直跑必须显式 `--workflow`；`preset init` 输出 workflow 派生 node ids、assignment、failure policy 和 fallback placeholders。
  - 提交：`feat(cli): add workflow presets`

- [x] P3.3 实现 primary assignment resolution。
  - Slice：`P3.3`
  - 依赖：P3.1、P3.2
  - 文件：`packages/runtime/src/flow/create.ts`、tests
  - 目标：解析 explicit node assignment、preset defaults、global defaults、CLI role flags 到 node-id keyed `stage_assignments`。
  - 动作：实现 precedence、capability validation、execute 单 agent、fanout 6 上限、plan/decide 4+ warning、current pure node rule、assignment_provenance；direct CLI role flags 按 stage type 展开到所有 repeated nodes。
  - 产出：flow creation tests。
  - 验证：direct workflow run + preset run tests。
  - Review：重点看没有 preset 时是否能靠 global defaults 创建 run。
  - 证据：`npm run build && node --test dist-node/tests-node/flow-run.test.js dist-node/tests-node/flow-preset-run.test.js dist-node/tests-node/management-cli.test.js dist-node/tests-node/config-layering.test.js` 62/62；`npm run build && node --test dist-node/tests-node/flow-run.test.js dist-node/tests-node/flow-preset-run.test.js dist-node/tests-node/flow-dispatch.test.js` 50/50；`git diff --check`；`npm test` 363/363。
  - 进度记录：已完成。`createFlowRun()` 解析 node explicit assignment、CLI stage-type role flags、legacy workflow defaults、preset stage/common defaults 和 global stage/common defaults，写入 node-id keyed `stage_assignments` 与 `assignment_provenance`；direct workflow run 可仅依赖 global defaults 创建 packet；preset run 支持 preset defaults fallback 到 global defaults；run creation 校验 unknown agent、capability mismatch、execute exactly one、fanout 上限和 `current` 混用；CLI role flags 会展开到 repeated node ids。
  - 提交：`feat(flow): resolve default primary agents`

- [x] P3.4 实现 failure/fallback/timeout resolution。
  - Slice：`P3.4`
  - 依赖：P3.3
  - 文件：`packages/runtime/src/flow/create.ts`、state helpers、tests
  - 目标：解析 `stage_failure_policies`、`stage_fallbacks`、`stage_invocations`、timeout_provenance 和 fallback_provenance。
  - 动作：实现 policy merge、mode strictness、required validation、current exclusion、inherit flags、primary filtering、max_fallback_agents truncation、agent timeout chain、CLI timeout override materialization。
  - 产出：runtime tests 和 packet fixtures。
  - 验证：fallback/timeout targeted tests。
  - Review：重点看 dispatch 是否无需读取 config/preset/agent registry。
  - 证据：`npm run build && node --test dist-node/tests-node/flow-run.test.js dist-node/tests-node/flow-preset-run.test.js` 25/25；`node --test dist-node/tests-node/flow-run.test.js dist-node/tests-node/flow-preset-run.test.js dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/workflow-registry.test.js dist-node/tests-node/config-layering.test.js dist-node/tests-node/core-contracts.test.js dist-node/tests-node/sdk-read.test.js dist-node/tests-node/studio-ui.test.js dist-node/tests-node/management-cli.test.js` 138/138；`git diff --check`；`npm test` 367/367。
  - 进度记录：已完成。`createFlowRun()` 解析 workflow/preset failure policy、preset/global fallback route、primary/synthesis/fallback timeout 和 provenance，写入 node-id keyed `stage_invocations`、`stage_failure_policies`、`stage_fallbacks`、`fallback_provenance` 与 `timeout_provenance`；支持 `--timeout-seconds` 在 run creation 冻结 primary/fallback/synthesis lanes；校验 required fallback、terminal/current exclusion、preset policy strictness、fallback capability、primary filtering 和 `max_fallback_agents` 截断。
  - 提交：`feat(flow): materialize execution routing`

- [x] P3.5 强化 agent registration validation。
  - Slice：`P3.5`
  - 依赖：P3.1
  - 文件：`packages/cli/src/commands/agents.ts`、`packages/runtime/src/adapters/registration.ts`、tests
  - 目标：agent id/alias/capability/reasoning_effort/timeout/readiness 校验 fail fast。
  - 动作：新增 optional scalar `agents.<id>.timeout_seconds`，默认 system 900，bounds 30-3600；connectivity probe 使用独立 probe timeout，不使用 agent 长 timeout；移除 successful `--skip-verify` write path。
  - 产出：agent registration tests。
  - 验证：agents add targeted tests；doctor tests。
  - Review：检查 offline/draft 不在 Plan A 范围是否清楚。
  - 证据：`npm run build && node --test dist-node/tests-node/agent-registration.test.js dist-node/tests-node/cli-surface.test.js` 36/36；`npm run build && node --test dist-node/tests-node/agent-registration.test.js dist-node/tests-node/cli-surface.test.js dist-node/tests-node/config-layering.test.js dist-node/tests-node/readiness.test.js dist-node/tests-node/core-contracts.test.js` 110/110；`git diff --check`；`npm test` 371/371。
  - 进度记录：已完成。`agents add` 与 config loader fail fast 校验 agent id、alias、capability、reasoning_effort 和 `timeout_seconds`；新增 registration-time `--timeout-seconds` 写入 agent 配置，bounds 为 30-3600；readiness probe 继续使用独立 probe timeout；`--skip-verify` 改为 diagnostic-only，不再写配置；CLI 阻止 alias 与既有 agent id / alias 冲突。
  - 提交：`feat(agents): validate registration readiness`

- [x] P3.Z 阶段收尾校准。
  - Slice：`P3.Z`
  - 目标：确认 run creation 已能稳定产出 packet v2 执行事实。
  - 验证：config + preset + flow creation targeted tests；`git diff --check`。
  - Review：runtime creation review；open Must findings 为 0，accepted Should/Nit 要么处理，要么记录 residual risk。
  - 证据：`docs/reviews/workflow/p3-runtime-creation-2026-05-17.md`；runtime creation review open Must findings 为 0；accepted Should 1 已处理；`npm run build && node --test dist-node/tests-node/config-layering.test.js dist-node/tests-node/flow-preset-run.test.js dist-node/tests-node/flow-run.test.js` 57/57；`git diff --check`；`npm test` 372/372。
  - 进度记录：已完成。新增 end-to-end preset routing materialization 回归，覆盖 config + preset + workflow run creation 生成 packet v2 后的 `stage_assignments`、`stage_invocations`、`stage_failure_policies`、`stage_fallbacks`、`stage_attempts` 和三类 provenance exact node-id records，并用 `PacketStatusSchema` 与 `packet validate` 校验；README / index 同步 P3 runtime creation 状态和 372 测试基线；dispatch-time fallback attempts/timeout execution 继续保留为 P4 范围。
  - 提交：`test(flow): cover routing materialization`

### P4. Dispatch、Attempts 与 Runtime Execution

- [x] P4 阶段完成门禁（仅在 `P4.Z` 完成 review、日志和 commit 后勾选）
- 阶段目标：dispatch 只读 packet v2，正确处理 fanout、fallback、timeout、retry、stage attempts 和 artifacts。
- 阶段门禁：完成 P4.1-P4.4 和 P4.Z。

- [x] P4.1 更新 stage artifact 和 raw output 写入。
  - Slice：`P4.1`
  - 依赖：P2.2
  - 文件：`packages/runtime/src/flow/state.ts`、dispatch tests
  - 目标：support `decision_2.md`、`verification_2.md`、`findings_2.md`、`outputs/<node-id>/<agent>.md`。
  - 动作：实现 canonical artifact file/name；review raw outputs repeated path；artifact id 跟文件名一致。
  - 产出：artifact tests。
  - 验证：runtime artifact targeted tests。
  - Review：检查 artifact id 是否没有混用 node id 前缀。
  - 证据：red `npm run build && node --test --test-name-pattern "dispatch all runs repeated workflow nodes" dist-node/tests-node/flow-dispatch.test.js` failed on missing `review_2_runner`; green same command 1/1；`npm run build && node --test dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/review-artifacts.test.js dist-node/tests-node/core-contracts.test.js dist-node/tests-node/packet-validate.test.js` 54/54；`git diff --check`；`npm test` 372/372。
  - 进度记录：已完成。重复 stage canonical artifacts 已由既有 runtime 覆盖 `decision_2.md`、`verification_2.md`、`findings_2.md` 与 `outputs/<node-id>/<agent>.md`；本 slice 修正 repeated review raw output artifact id，从 `review_review_2_<agent>` 收敛为 `review_2_<agent>`，避免混用 node id 前缀，并同步 artifacts contract。
  - 提交：`feat(runtime): name repeated stage artifacts canonically`

- [x] P4.2 更新 dispatch fanout 与 synthesis。
  - Slice：`P4.2`
  - 依赖：P4.1
  - 文件：`packages/runtime/src/flow/dispatch.ts`、prompt/synthesis tests
  - 目标：plan/decide fanout synthesis 使用当前 node canonical artifact；verify/review 聚合按 node id。
  - 动作：合成 prompt 使用 derived artifact file；execute 多 agent fail fast；events/completed 用 node id；结合 P0 metrics，避免 synthesis prompt 重复携带无必要的 full base context，优先传 request/assignment、stage contract 和 fanout outputs。
  - 产出：fanout tests。
  - 验证：dispatch targeted tests；synthesis prompt bytes 相比候选 fanout prompt 不重复线性携带同一份 `context.md`。
  - Review：重点看 release-check decide fanout、non-final decide 不写 release verdict，以及 synthesis 去重是否丢失必要证据。
  - 证据：red `npm run build && node --test --test-name-pattern "plan fanout synthesis prompt references context" dist-node/tests-node/flow-dispatch.test.js` failed because synthesis prompt replayed `CONTEXT_SENTINEL` full context；green same command 1/1；`npm run build && node --test dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/release-check-flow.test.js dist-node/tests-node/release-check.test.js dist-node/tests-node/flow-context.test.js` 58/58；`git diff --check`；`npm test` 373/373。
  - 进度记录：已完成。Fanout synthesis prompt 改为 synthesis-specific base：保留 request、assignment、prior artifacts、release/user-gate contract 和 fanout outputs；存在 context 时只引用 `context.md`，不再重复携带完整 context；plan/decide synthesis 继续写当前 node canonical artifact，release-check decide fanout verdict 回归通过。
  - 提交：`feat(dispatch): synthesize repeated checkpoint outputs`

- [x] P4.3 实现 fallback attempts 与 timeout。
  - Slice：`P4.3`
  - 依赖：P3.4、P4.2
  - 文件：`packages/runtime/src/flow/dispatch.ts`、adapter invocation、tests
  - 目标：超时/失败按 lane 记录，按 failure_policy 判断是否 fallback，按 packet 中 fallback chain 接管。
  - 动作：实现 `stage_attempts.status = completed | failed | timed_out`；每条 attempt 写 lane_id、primary_agent、lane_attempt、per-agent attempt、timeout_seconds、error_kind；timeout 是 per attempt；synthesis 只在 multi-agent plan/decide node 创建并使用独立 timeout budget；terminal 对 timeout 同样生效。
  - 产出：fallback/timeout dispatch tests。
  - 验证：timeout fake adapter tests；fanout fallback tests。
  - Review：检查 primary lane 和 fallback lane timeout precedence。
  - 证据：red `npm run build && node --test --test-name-pattern "fallback attempts|timed out attempts" dist-node/tests-node/flow-dispatch.test.js` failed because dispatch ignored packet fallback and did not record timeout attempts；green same command 2/2；red `npm run build && node --test --test-name-pattern "plan fanout records fallback" dist-node/tests-node/flow-dispatch.test.js` failed because fanout primary failure aborted the stage；green same command 1/1；`npm run build && node --test dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/release-check-flow.test.js dist-node/tests-node/release-check.test.js dist-node/tests-node/flow-run.test.js dist-node/tests-node/flow-preset-run.test.js dist-node/tests-node/packet-validate.test.js` 85/85；`git diff --check`；`npm test` 376/376。
  - 进度记录：已完成。Dispatch 现在按 packet `stage_invocations` 与 `stage_fallbacks` 执行 primary/fallback attempts，记录 `stage_attempts` 的 lane_id、primary/requested/actual agent、fallback_from、lane_attempt、per-agent attempt、timeout_seconds、status 和 error_kind；terminal policy 超时直接失败且不走 fallback；fanout primary 失败可由 fallback 写回原 lane 输出并继续 synthesis。
  - 提交：`feat(dispatch): record fallback attempts and timeouts`

- [x] P4.4 更新 retry/resume/attach 行为。
  - Slice：`P4.4`
  - 依赖：P4.3
  - 文件：`packages/cli/src/commands/flow.ts`、`packages/runtime/src/flow/dispatch.ts`、retry/resume/attach commands、release verdict code、tests
  - 目标：retry/resume 与 v2 node id、stage attempts、release verdict helper 一致。
  - 动作：retry failed node/lane；attach current node 不走 fallback；release verdict only final release-check decide node；invalid verdict 写 stageId。
  - 产出：retry/release tests。
  - 验证：runtime targeted tests。
  - Review：release gate review。
  - 证据：`npm run build && node --test dist-node/tests-node/flow-retry-resume.test.js dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/release-check-flow.test.js dist-node/tests-node/release-check.test.js` 49/49；`git diff --check`；`npm test` 376/376。
  - 进度记录：已完成。Retry/resume 已按 exact node id 操作；新增断言确认 retry 后同一 lane 的 `lane_attempt` 从 1 递增到 2，current attach 不创建 fallback/attempt，invalid release verdict event 写入 `node_id`；release verdict 仍只由 release-check 最终 decide node 记录。
  - 提交：`feat(release): gate verdicts by final decide node`

- [x] P4.Z 阶段收尾校准。
  - Slice：`P4.Z`
  - 目标：确认 dispatch runtime 与 packet v2 contract 一致。
  - 验证：runtime dispatch tests；`git diff --check`。
  - Review：dispatch review，重点看 stuck agent、timeout、fallback 和 audit trail；open Must findings 为 0，accepted Should/Nit 要么处理，要么记录 residual risk。
  - 证据：`docs/reviews/workflow/p4-dispatch-runtime-2026-05-17.md`；dispatch runtime review open Must findings 为 0，accepted Should 1-4 已处理；`npm run build && node --test dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/flow-retry-resume.test.js dist-node/tests-node/release-check-flow.test.js dist-node/tests-node/release-check.test.js dist-node/tests-node/packet-validate.test.js dist-node/tests-node/sdk-read.test.js dist-node/tests-node/studio-ui.test.js` 75/75；`git diff --check`；`npm test` 376/376。
  - 进度记录：已完成。新增 P4 dispatch runtime review，确认 runtime dispatch 与 packet v2 execution facts 对齐；P4.1-P4.4 已覆盖 repeated artifact 命名、synthesis context 去重、packet-driven fallback/timeout attempts、retry/resume lane attempts、current attach boundary 和 final release-check decide verdict gate；README / index 同步 P4 runtime 状态与 376 测试基线。
  - 提交：`test(dispatch): cover packet v2 execution`

### P5. Prompt、Docs、Studio 与项目收尾

- [x] P5 阶段完成门禁（仅在 `P5.Z` 完成 review、日志和 commit 后勾选）
- 阶段目标：同步 prompt model、Studio、docs、README、index、中文术语和最终 release gate。
- 阶段门禁：完成 P5.1-P5.5 和 P5.Z。

- [x] P5.1 统一 prompt assembly。
  - Slice：`P5.1`
  - 依赖：P4.1
  - 文件：`packages/runtime/src/flow/prompt.ts`、prompt tests
  - 目标：所有 workflow 使用 ordered prior evidence，保留 type-specific labels。
  - 动作：删除 `hasRepeatedStageNodes` 分支；prior evidence 包含 previous decision/review raw outputs；release-check contract 只给 release-check review/decide；结合 P0 metrics，对 `findings.md` raw reviews 和 repeated-stage prior raw reviews 设计摘要/截断边界，避免 decide prompt 和后续 prompt 无界 replay 全量审查原文。
  - 产出：prompt tests。
  - 验证：prompt targeted tests；含多 reviewer findings 和 repeated review 的 prompt bytes 不随 raw review 全文无限增长；truncation marker / summary marker 可见。
  - Review：检查旧 prompt 语义标签未丢失，且摘要/截断没有让 reviewer 误以为片段就是完整证据。
  - 证据：red `npm run build && node --test --test-name-pattern "prompt assembly truncates" dist-node/tests-node/flow-prompt.test.js` failed because long raw review output replayed without truncation marker；green same command 1/1；`npm run build && node --test dist-node/tests-node/flow-prompt.test.js dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/flow-retry-resume.test.js dist-node/tests-node/release-check-flow.test.js dist-node/tests-node/release-check.test.js` 50/50；`git diff --check`；`npm test` 377/377。
  - 进度记录：已完成。Stage prompt 与 fanout synthesis prompt 现在共用 ordered prior evidence，保留 `plan`/`execute`/`verify`/`review`/`decide` 的 type-specific labels；review findings 中的 raw review tail 会移到 bounded `Prior Raw Reviews` section，每个 raw review 超预算时显示 `AgentMesh prompt assembly truncated` marker、来源路径和已展示/原始 bytes，避免 decide prompt 与后续 prompt 无界 replay 全量审查原文。
  - 提交：`feat(prompt): use ordered prior evidence`

- [x] P5.2 更新 docs contracts 和 examples。
  - Slice：`P5.2`
  - 依赖：P1.Z、P4.Z
  - 文件：`docs/contracts/config-toml.md`、`workflow-toml.md`、`preset-toml.md`、`stage-dispatch.md`、`status-json.md`、`docs/workflows`
  - 目标：docs 完整描述 v2、stage rules、preset、global defaults、failure/fallback/timeout、direct run。
  - 动作：同步 examples、field bounds、error behavior、version field relationship、`--task`/`--task-file` mutual exclusion、non-goals。
  - 产出：docs updates。
  - 验证：docs link/path check；contract examples parse tests。
  - Review：docs review。
  - 证据：red `npm run build && node --test --test-name-pattern "workflow run rejects inline task|contract docs exist" dist-node/tests-node/flow-run.test.js dist-node/tests-node/core-contracts.test.js` failed because docs lacked P5.2 direct-run/task sections and CLI accepted `--task` with `--task-file`；green `npm run build && node --test --test-name-pattern "workflow run rejects inline task|contract docs exist|contract TOML examples parse" dist-node/tests-node/flow-run.test.js dist-node/tests-node/core-contracts.test.js` 3/3；`npm run build && node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/workflow-registry.test.js dist-node/tests-node/flow-run.test.js dist-node/tests-node/flow-preset-run.test.js dist-node/tests-node/config-layering.test.js` 88/88；`git diff --check`；`npm test` 379/379。
  - 进度记录：已完成。Contracts 同步 packet v2 workflow/preset/config/dispatch/status 语义，补齐 stage rules、direct run input、`--task`/`--task-file` mutual exclusion、no v1 migration、non-goals、packet-v2 execution facts 和 docs/workflows review-gate source 注释；CLI 现在在 direct workflow run 与 preset run 前拒绝同时提供 `--task` 和 `--task-file`；新增 contract TOML examples parse smoke。
  - 提交：`docs(contracts): document workflow packet v2`

- [x] P5.3 更新 Studio 和 SDK 展示。
  - Slice：`P5.3`
  - 依赖：P2.4、P4.Z
  - 文件：`apps/studio/src/assets.ts`、Studio workflow/status/assignment/artifact view modules、`packages/sdk/src/index.ts`、Studio tests
  - 目标：Studio 渲染 repeated node ids、artifact links、v2 fallback/failure/attempt/timeout details，中文“审查”。
  - 动作：更新 copy、status panels、assignment panels、artifact links、language tests。
  - 产出：Studio/SDK tests。
  - 验证：targeted Studio tests；必要时浏览器截图检查。
  - Review：UI/UX review，重点看窄屏不重排错乱。
  - 证据：red `npm run build && node --test --test-name-pattern "renders run navigator details|renders packet v2 stage nodes" dist-node/tests-node/studio-ui.test.js` failed because stage detail artifact links were static and attempt audit trail omitted lane/fallback/timeout fields；green same command 2/2；`npm run build && node --test dist-node/tests-node/studio-ui.test.js dist-node/tests-node/studio.test.js dist-node/tests-node/sdk-read.test.js` 26/26；`git diff --check`；`npm test` 379/379。
  - 进度记录：已完成。Studio workflow detail 现在把 related artifacts 渲染为可点击 preview link，保留 repeated node ids，并展开 stage attempt audit summary 中的 lane、primary/requested/actual、fallback、lane_attempt、attempt、timeout 和 error details；现有 SDK packet v2 read surface 保持 targeted 覆盖。
  - 提交：`feat(studio): render packet v2 workflow stages`

- [x] P5.4 更新 README 和 index。
  - Slice：`P5.4`
  - 依赖：P5.2、P5.3
  - 文件：`README.md`、`index.html`
  - 目标：项目入口文档体现 preset-first UX、decide checkpoint、packet v2、global defaults、fallback/failure policy。
  - 动作：更新 feature overview、commands、config snippets、limitations、migration note。
  - 产出：README/index updates。
  - 验证：链接和命令示例检查。
  - Review：docs/product review。
  - 证据：red `npm run build && node --test --test-name-pattern "README and landing page describe final workflow semantics" dist-node/tests-node/core-contracts.test.js` failed because README/index lacked final preset-first packet v2 semantics；green same command 1/1；`npm run build && node --test dist-node/tests-node/core-contracts.test.js dist-node/tests-node/management-cli.test.js dist-node/tests-node/flow-preset-run.test.js dist-node/tests-node/workflow-registry.test.js` 47/47；`git diff --check`；`npm test` 380/380。
  - 进度记录：已完成。README 和 index 现在说明 preset-first UX、direct workflow run namespace、decide checkpoint、packet schema version 2、No v1 packet migration、default primary agents、fallback/failure policy、preset commands、packet v2 repeated artifact / attempt facts 和当前 380 测试基线；新增 docs smoke 回归防止入口文档回退到旧口径。
  - 提交：`docs: update workflow semantics overview`

- [x] P5.5 同步 changelog / 工作日志。
  - Slice：`P5.5`
  - 依赖：P5.4
  - 文件：`changelog/`
  - 目标：记录 breaking packet v2、workflow/preset/global config 行为、Studio/docs 更新。
  - 动作：按项目 changelog 规则写事实记录；说明不做 v1 migration。
  - 产出：changelog entry。
  - 验证：changelog 格式检查。
  - Review：changelog review。
  - 证据：`changelog/2026-05-17.md`；`rg -n "^# 2026-05-17|^## [0-9]{2}:[0-9]{2} - |packet v2|No v1 packet migration|preset-first UX|fallback/failure|Studio|审查" changelog/2026-05-17.md`；`git diff --check`。
  - 进度记录：已完成。当天 changelog 新增 P5.5 汇总，记录 breaking packet v2、No v1 packet migration、workflow/preset/global config 分工、Studio/docs 更新范围和中文“审查”口径。
  - 提交：`docs(changelog): record packet v2 workflow plan`

- [x] P5.Z 阶段收尾校准。
  - Slice：`P5.Z`
  - 目标：最终校准文档、实现、测试、review、release gate 和当前下一步。
  - 验证：targeted tests + full `npm test`；`git diff --check`；README/index/docs smoke。
  - Review：4.7 + ds/opencode（如可用）最终 review；open Must findings 为 0，
    accepted Should/Nit 要么处理，要么记录 residual risk。
  - 证据：`docs/reviews/workflow/p5-final-workflow-stage-semantics-2026-05-17.md`；`npm run agentmesh -- doctor --agent claude --agent opencode --json` showed `claude` ready and `opencode` auth probe timed out after 30s；Claude 4.7 final review Must Fix 0；accepted Should 1/2 handled；`npm run build && node --test --test-name-pattern "preset run rejects inline task|accessibility and responsive guardrails" dist-node/tests-node/flow-preset-run.test.js dist-node/tests-node/studio-ui.test.js` 2/2；`npm run build && node --test dist-node/tests-node/flow-preset-run.test.js dist-node/tests-node/studio-ui.test.js dist-node/tests-node/core-contracts.test.js dist-node/tests-node/flow-prompt.test.js dist-node/tests-node/flow-dispatch.test.js dist-node/tests-node/flow-run.test.js dist-node/tests-node/workflow-registry.test.js dist-node/tests-node/sdk-read.test.js` 107/107；`git diff --check`；`npm test` 381/381；release verdict ready。
  - 进度记录：已完成。新增 P5 final review/release gate 记录，处理 Claude review 的 preset task input coverage 与 Studio wrap guardrail Should findings；README/index 测试基线更新到 381；P5 阶段门禁已完成，open Must findings 为 0，residual risks 已记录。
  - 提交：`release: finalize workflow stage semantics`

## 6. 整体验证

- 自动化验证：core schema tests、workflow registry tests、flow creation tests、dispatch tests、SDK/Studio tests、packet fixture validation、full `npm test`。
- 手工验证：使用 direct workflow run、preset run、repeated decide workflow、fallback timeout fake agent、pure current attach、release-check final decide 各跑一次 smoke。
- 文档验证：README、index、docs/contracts、workflow examples、preset examples、中文术语、artifact links。
- 成本验证：至少一次含 context + fanout review 的 dogfood run 必须在 `flow status --json` 中展示 `context_bytes` 和 per-agent prompt bytes；后续 prompt/fanout 改造必须证明没有引入新的无界重复 context。
- Release gate：最终 verdict 必须包含 diff summary、验证命令和结果、跳过项、accepted/rejected/unresolved findings、残余风险、最终决策人或依据。
- 验收标准：所有 P 阶段门禁完成；测试通过；docs/Studio 同步；open Must findings 为 0；
  accepted Should/Nit 已处理或进入 residual risk；无 unresolved release blocker。

## 7. 风险与回滚

- 风险：packet v2 breaking change 影响旧 run；规避：明确 no migration，旧 packet unsupported；回滚：回退 schema/fixtures/docs commit。
- 风险：default/fallback/failure/timeout 配置层过多；规避：packet materialization 和 provenance 让 dispatch 单一事实源；回滚：先禁用 fallback/default，只保留 explicit assignment。
- 风险：fallback 导致长时间失败循环；规避：每列表最多 3、`max_fallback_agents` 最大 3、`max_attempts_per_agent` 最大 2、timeout bounds。
- 风险：workflow/preset 语义边界混乱；规避：workflow 不写具体 agent，preset/global 才写 concrete agents。
- 风险：Studio/docs 与 runtime 不一致；规避：P5 专门收尾，并以 packet fixtures 驱动显示测试。
- 风险：token budget 使用 byte 作为 token 代理，可能对中文、代码、minified assets 估算偏差；规避：P0 先观测，hard limit 保守推进，并在文档中明确 bytes 不是精确 token。
- 风险：截断或摘要让 reviewer 误以为片段是完整证据；规避：所有截断/摘要必须有标准 marker、source path / command 和 residual risk 提示，reference mode 延后到 prompt contract 稳定后再做。
- 风险：fanout、synthesis、findings 和 prior raw reviews 重复携带同一份 context；规避：P0 metrics 先暴露重复，P4/P5 再按 prompt contract 去重或摘要。

## 8. 大任务收尾

- 阶段收尾：每个 `P<n>` 完成前必须执行 `P<n>.Z`，校准 plan 状态、证据、README / index、changelog 和 release gate。
- 项目收尾：P5.Z 完成后整理最终实现、docs、tests、review 和 release verdict。
- 更新项目入口文档：必须检查并更新 `README.md` 和 `index.html`。
- 确认 changelog / 工作日志完整。
- 做最终 review / release gate，处理 accepted findings，记录 unresolved findings 和 residual risk。
- 做最终提交；如有多个逻辑边界，按阶段或责任边界拆 commit。

## 9. 当前下一步

- 当前下一步：无，计划已完成。
