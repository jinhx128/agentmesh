# AgentMesh

AgentMesh 是一个本地优先的 AI coding workflow 编排工具。它把已经安装在电脑上的
Codex CLI、Claude Code CLI、Cursor Agent、Antigravity CLI、OpenCode CLI 和自定义
shell command 注册成可复用的 agents，再用统一的 workflow、packet、event 和 artifact
文件记录一次协作过程。

它不替代任何一个 coding agent，也不托管模型或登录态。AgentMesh 负责把多个入口工具接到
同一套本地协议里，让 plan、execute、verify、review、decide 这些步骤可以被追踪、
重试、交接和复盘。

## v0.1.13 发布资产

GitHub 仓库：

```text
https://github.com/jinhx128/agentmesh
```

v0.1.13 Release：

```text
https://github.com/jinhx128/agentmesh/releases/tag/v0.1.13
```

Release 资产：

- `agentmesh-0.1.13.tgz`：CLI npm tarball，可用 `npm install -g` 安装。
- `AgentMesh_0.1.13_aarch64.dmg`：macOS Apple Silicon Desktop Studio，未签名、未 notarize。
- `AgentMesh_0.1.13_aarch64.app.tar.gz`：Tauri 应用内更新归档。
- `AgentMesh_0.1.13_aarch64.app.tar.gz.sig`：更新归档签名。
- `latest.json`：stable updater 元数据，使用不可变 `v0.1.13` 资产 URL。
- `agentmesh-skill-0.1.13.md`：单独下载的 AgentMesh Skill markdown。
- `SHA256SUMS`：发布文件校验值。

CLI 也发布到公共 npm registry：

```bash
npm install -g @jinhx128/agentmesh
agentmesh --help
```

`@jinhx128/agentmesh` 的 `bin` 仍然是 `agentmesh`，所以安装后命令名不变。
Release 资产是固定快照；Desktop Studio 修复需要安装包含该修复的新 DMG，不会因为
更新 PATH-visible CLI 自动改变已经安装的 `AgentMesh.app`。

## 组件

AgentMesh 由三层组成。

### CLI

`agentmesh` 是主要运行时入口，负责：

- 管理本机 agents、workflows、presets、MCP servers 和 model aliases。
- 创建 run packet，并把 workflow 的 stage assignment、fallback、timeout、context policy
  和 release policy 固化到本地文件。
- 调用底层 agent CLI，记录 stdout、stderr、timing、exit code、artifacts 和 events。
- 支持 dispatch、retry、resume、attach、status、events、packet validate 等运行操作。
- 生成 release-check summary，把 diff、verification、review findings、decision 和 verdict
  汇总成可读证据。

### Studio

Studio 是本地 Web UI。它读取同一套 runtime API 和 packet 文件，可以查看：

- Runs 与 Calls 会按活动时间混排在统一导航中，支持中文展示标题、日期分组、组内 5 条预览、搜索和自动刷新。
- 运行/调用详情、events、artifacts、review evidence 和 release evidence。
- Agents、workflows、presets、MCP、默认 agent、fallback 和高级设置。
- Agent lifecycle 操作的命令、stdout、stderr、状态和错误。

Studio 有两种运行方式：

- `agentmesh studio`：本地浏览器里的 Web Studio。
- `AgentMesh.app`：Tauri macOS Desktop Studio，包含 app-managed runtime。

### Skill

AgentMesh Skill 是给入口 agent 看的协议说明。安装后，Codex、Claude Code、
Cursor、Antigravity CLI 或 OpenCode 可以知道什么时候调用
`agentmesh`、怎么创建 run、怎么读取 packet、怎么提交 review 结果。

Skill 只是一份 host guidance，不包含私有 CLI 副本。入口 agent 要真正调用
AgentMesh，机器上必须先有 PATH-visible 的 `agentmesh` 命令。

## 系统要求

CLI：

- Node.js `>= 22`
- npm
- macOS、Linux 或其他能运行 Node.js 的本地环境

Desktop Studio DMG：

- macOS 12 或更新版本
- 当前 Release 的 DMG 是 `aarch64`，面向 Apple Silicon
- 未签名；首次打开可能需要右键 Open，或在系统安全设置里允许

底层 agent CLI 按需安装：

```bash
node --version
codex --help          # 使用 Codex CLI agent 时需要
claude --help         # 使用 Claude Code CLI agent 时需要
cursor-agent --help   # 使用 Cursor Agent 时需要
agy --help            # 使用 Antigravity CLI agent 时需要
opencode --help       # 使用 OpenCode CLI agent 时需要
```

也可以让 AgentMesh 用统一 resolver 检测当前机器上已安装的 provider CLI：

```bash
agentmesh cli detect --json
```

这些 CLI 的登录态由它们自己管理。AgentMesh 不保存 provider token，也不替它们登录。

## 安装 CLI

### 从 GitHub Release 安装

```bash
npm install -g https://github.com/jinhx128/agentmesh/releases/download/v0.1.13/agentmesh-0.1.13.tgz
agentmesh --help
agentmesh --version
agentmesh doctor --json
```

如果已经下载了 tarball：

```bash
npm install -g ./agentmesh-0.1.13.tgz
agentmesh --help
agentmesh --version
agentmesh doctor --json
```

检查当前安装版本和 GitHub Release 最新版本：

```bash
agentmesh version --json
agentmesh update check --json
```

CLI 更新使用 Release tarball，通过 npm 覆盖当前全局安装：

```bash
agentmesh update install --target cli
```

如果只想确认将执行的命令：

```bash
agentmesh update install --target cli --dry-run --json
```

### 从源码使用

```bash
git clone https://github.com/jinhx128/agentmesh.git
cd agentmesh
npm install
npm run build
node dist-node/packages/cli/src/cli.js --help
```

开发机上可以链接成全局命令：

```bash
npm link
agentmesh --help
agentmesh doctor --json
```

`npm link` 会把当前 checkout 作为本机全局 `agentmesh` 命令。换机器使用时，推荐重新
clone 或安装 Release tarball。

## 安装 Desktop Studio

从 Release 下载：

```text
AgentMesh_0.1.13_aarch64.dmg
```

打开 DMG，把 `AgentMesh.app` 拖到 Applications。因为 v0.1.13 的 DMG 未签名且未 notarize，macOS
可能提示无法验证开发者。可以右键应用选择 Open，或在 System Settings / Privacy &
Security 里允许打开。

升级时请退出正在运行的 AgentMesh Studio，然后用新 DMG 里的 `AgentMesh.app` 完整替换
旧应用。不要混用不同版本的 app resources、sidecar 或 UI assets；如果只更新全局 CLI，
已经安装的 Desktop Studio 不会随之更新。

可以用 CLI 查看 Desktop Studio 是否有新 DMG：

```bash
agentmesh update check --json
agentmesh update install --target desktop --dry-run --json
```

`0.1.10` 尚未包含应用内 updater，因此升级到首个 updater-enabled 版本 `0.1.11` 时仍需
手动用 DMG 替换 `/Applications/AgentMesh.app`。安装 `0.1.11` 后，Settings / About 可以
检查、下载、验签、安装并重启后续版本。

DMG 只提供 Desktop Studio。Codex、Cursor、Antigravity CLI、OpenCode 或
Claude Code 如果要通过 Skill 调用 AgentMesh，仍然需要 PATH-visible 的
`agentmesh` CLI。

Desktop Studio 内的 Settings / Agent Integrations 会检测 PATH 中的 `agentmesh`，执行
`--version` 显示实际版本，并通过公共 npm 安装或更新 `@jinhx128/agentmesh@latest`。
界面不要求用户输入 Bin 路径，也不会自动修改 shell profile 或请求管理员权限。
从 v0.1.12 开始，Finder、Dock 或 `open` 无参数启动会从 workspace registry 选择最近启用且
仍存在的工作区，不会把 macOS app 的 `/` 工作目录当作 workspace。CLI 和 flow 操作过的
项目会自动进入 registry；也可以显式注册并检查：

```bash
agentmesh workspaces add /path/to/project
agentmesh workspaces list
```

如果项目尚未注册，Desktop 会安全回退到 Home。需要固定启动项目时，可以用
`AGENTMESH_STUDIO_WORKSPACE=/path/to/project`，或运行
`/Applications/AgentMesh.app/Contents/MacOS/agentmesh-studio-desktop --workspace /path/to/project`。

## 安装 Skill

先确认 `agentmesh` 在 PATH 中可用：

```bash
agentmesh --help
```

然后只给实际使用的 host 安装 Skill：

```bash
agentmesh skill install --target codex
agentmesh skill install --target cursor
agentmesh skill install --target antigravity
agentmesh skill install --target opencode
agentmesh skill install --target claude
```

验证：

```bash
agentmesh skill verify --target codex --json
agentmesh skill verify --target antigravity --json
```

导出 Skill markdown：

```bash
agentmesh skill export --format markdown > agentmesh-skill.md
```

Release 里的 `agentmesh-skill-0.1.13.md` 是同一份可单独下载的 markdown。手动安装时，
Codex、Cursor、Antigravity CLI 和 OpenCode 使用：

```text
.agents/skills/agentmesh/SKILL.md
```

Claude Code 使用：

```text
.claude/skills/agentmesh/SKILL.md
```

## 支持的 agent 工具

`agentmesh adapters list` 会列出运行时支持的 adapters。
`agentmesh cli detect --json` 只检测上表这 5 个 provider CLI 的命令、路径来源和版本；
不检测 `command` adapter，也不要求 5 个工具全部安装。

| Adapter | Alias | 默认命令 | 模型处理 | 备注 |
| --- | --- | --- | --- | --- |
| `codex-cli` | `codex` | `codex exec` | AgentMesh 传 `-m <model>` 和 reasoning effort | 适合 plan、execute、verify、review、decide |
| `claude-code-cli` | `claude` | `claude -p` | AgentMesh 传 `--model <model>` 和 effort | 依赖 Claude Code CLI 自己的登录态 |
| `cursor-agent` | `cursor` | `cursor-agent --print --trust` | AgentMesh 传 `--model <model>` | prompt 不能为空 |
| `antigravity-cli` | `antigravity` | `agy` | AgentMesh 从 `agy models` 发现并保存实际模型标签 | 传 `--model <model>`，调用形式是 `agy --model <model> -p <prompt>` |
| `opencode-cli` | `opencode` | `opencode run` | AgentMesh 传 `--model <model>` 和 variant | 依赖 OpenCode CLI 自己的 provider 配置 |
| `command` | 无 | 自定义命令 | 无固定模型语义 | 用于接入任意本地可执行命令 |

所有 AI CLI adapters 默认可承担这些 stage：

```text
plan, execute, verify, review, decide
```

可以在 agent 注册时用 `--capability` 缩小能力范围。

## 注册 agents

查看可用 adapter：

```bash
agentmesh adapters list
```

添加 Codex agent：

```bash
agentmesh agents add \
  --adapter codex \
  --model gpt-5.5 \
  --label "Codex GPT-5.5 High" \
  --reasoning-effort high
```

添加 Claude Code agent：

```bash
agentmesh agents add \
  --adapter claude \
  --model claude-opus-4-6 \
  --label "Claude Opus 4.6 High" \
  --reasoning-effort high
```

添加 Cursor agent：

```bash
agentmesh agents add \
  --adapter cursor \
  --model composer-2.5 \
  --label "Cursor Composer 2.5"
```

添加 Antigravity agent：

```bash
agentmesh agents add \
  --adapter antigravity \
  --model "Claude Sonnet 4.6 (Thinking)" \
  --label "Antigravity Claude Sonnet 4.6" \
  --reasoning-effort none
```

模型值以 `agy models` 的实际输出为准。

Antigravity 的模型列表直接来自本机 `agy models`。AgentMesh 不写死 Gemini、Claude
或其他模型名；发现到什么就展示什么，并在注册时保存所选模型标签。运行时向 `agy`
传入 `--model <model>`，因此每个 Agent 的模型选择是可追踪、可复现的。旧配置中的
`model = "current"` 仍兼容为使用 Antigravity CLI 当前选择的模型。

添加 OpenCode agent：

```bash
agentmesh agents add \
  --adapter opencode \
  --model xiaomi/mimo-v2.5-pro \
  --label "OpenCode Mimo V2.5 Pro" \
  --reasoning-effort high
```

查看 agents：

```bash
agentmesh agents list
agentmesh agents show <agent-id> --json
```

禁用、启用、删除：

```bash
agentmesh agents disable <agent-id>
agentmesh agents enable <agent-id>
agentmesh agents remove <agent-id>
```

Agent 注册写入用户级配置：

```text
~/.config/agentmesh/config.toml
```

同一台电脑上的多个项目可以复用同一批 agents。

## 直接调用 agent

`call` 用于对单个 agent 发起一次直接调用，并在 `.agentmesh/calls/` 下记录证据。

```bash
agentmesh call --agent <agent-id> --prompt "检查当前改动有没有明显风险"
agentmesh call --agent <agent-id> --prompt-file ./prompt.md --output-file ./review.md
```

如果只想临时调用，不写 call record：

```bash
agentmesh call --agent <agent-id> --prompt "hello" --no-record
```

Call record 包含 prompt、output、stderr、exit code、timing 和 adoption 状态。

## Workflows

查看内置 workflows：

```bash
agentmesh workflows list
```

AgentMesh 的运行语义：

- `preset-first UX`：如果已有 preset，可以直接使用 `agentmesh run <preset-id> --task "..."`。
- `decide checkpoint`：workflow 中的 decide stage 可以作为中途决策点，也可以作为最终决策点。
- `current packet schema is active`：v0.1.13 只按当前 packet schema 创建和推进 run。
- `legacy packet migration is unsupported`：旧 packet 不自动迁移；需要按当前 schema 重新创建 run。
- `[default_stage_agents]`、`[fallback]` 和 `[failure_policy]` 是项目配置里的运行策略入口。
- Agent id 使用短内部 id，例如 `a-12d58754`，命令和配置都以 id 作为稳定引用。

Preset 入口示例：

```bash
agentmesh run <preset-id> --task "实现一个可验证的小修复" --title "验证并修复运行链路"
```

`run`、`flow run` 和被记录的 `call` 都支持可选的 `--title <title>`。用户未指定时，主控 Agent 应根据任务生成 4–24 字的中文标题并传入；若最终仍未传入，Runtime 会使用 `工作区名-摘要`，没有摘要时使用 `工作区名-HH:mm:ss`。标题只用于展示，不改变 run/call 技术 ID、目录或关联键。

v0.1.13 包含这些内置 workflow：

- `Verified Delivery`：plan、execute、verify、review、decide
- `Guided Delivery`：plan、execute、review、decide
- `Bug Fix`：plan、execute、review、decide
- `Research Spike`：plan、execute、decide
- `Implementation Plan`：plan、decide
- `Review Gate`：review、decide
- `Release Check`：review、decide
- `Handoff`：plan、execute、decide

创建 run：

```bash
agentmesh run \
  --workflow <workflow-id> \
  --plan <planner-agent-id> \
  --execute <worker-agent-id> \
  --verify <verifier-agent-id> \
  --review <reviewer-agent-id> \
  --decide <decider-agent-id> \
  --title "编排并验证小修复" \
  --task "实现一个小修复并给出验证结果"
```

同一个 stage 可以传多个 agent。`plan`、`verify`、`review` 和 `decide` 支持 fanout；
`execute` 按单主控执行，避免多个 agent 同时改同一批文件。

```bash
agentmesh run \
  --workflow <workflow-id> \
  --plan <planner-a> --plan <planner-b> \
  --execute <worker> \
  --review <reviewer-a> --review <reviewer-b> \
  --decide <decider> \
  --task-file ./task.md
```

查看和推进 run：

```bash
agentmesh flow status <run-id>
agentmesh flow events <run-id>
agentmesh flow dispatch <run-id> --stage all
agentmesh flow retry <run-id> --stage review
agentmesh flow resume <run-id> --stage decide
agentmesh flow prompt <run-id> --stage plan
agentmesh flow attach <run-id> --stage execute --text "补充上下文"
```

## Reviewer Session 复用

`agentmesh flow resume <run-id>` 恢复的是 AgentMesh Run 中断或待处理的 workflow stage；
Reviewer Session resume 则是在多次 Run 之间恢复底层 reviewer provider 的会话。两者不是同一件事，
也不会互相替代。

Reviewer Session 有三种请求模式：

- `interactive_continuous`：用于同一个入口宿主对话里的普通连续 review。每轮仍会重发当前 packet、diff、verification、corrections 和风险；恢复成功的证据标记为 `non-hermetic`，provider 历史只作辅助上下文。
- `independent`：始终新建 reviewer 会话并绕过本机 session registry。release、安全、合规、审批、首次冷读等正式 gate 必须使用该模式。
- `auto`：遵循 workflow policy；只有宿主 scope、adapter 能力和安全 registry 都可用时才可能连续恢复，否则安全退化为 fresh。`independent` workflow 不能被 CLI 参数降级。

当前 P5 A/B 未产生合格的 resumed arm：Claude Code 的 independent/fresh 审查能检出缺陷，
但 continuous structured start 失败；OpenCode 的 structured start 失败，independent 对照又超时。
因此所有五个内置 reviewer provider 均保持 fresh-only；Claude Code/OpenCode 的底层结构化 probe
代码仅供后续重新验证，不在默认 runtime 启用。入口宿主仍可传递安全的 conversation scope，
但这不代表对应 reviewer provider 已启用 resume。

同一入口对话第一次需要连续 review、且宿主没有 native scope 时，先生成 propagated scope：

```bash
agentmesh sessions scope create --host codex --json

agentmesh run \
  --workflow <review-workflow-id> \
  --review <reviewer-agent-id> \
  --decide current \
  --review-session-mode interactive_continuous \
  --host-kind codex \
  --conversation-scope amscope_v1:11111111-1111-4111-8111-111111111111 \
  --task "复审当前改动"
```

后续调用只在同一入口宿主对话内原样复用该 `amscope_v1` token。token 丢失或无效时省略
`--conversation-scope` 并 fresh；不得从 workspace、repository、worktree、旧 packet、provider state
或其他宿主对话推断或恢复 scope。不要传递 provider/native session ID。

本机会话管理命令：

```bash
agentmesh sessions list --json
agentmesh sessions inspect <session-ref> --json
agentmesh sessions close <session-ref> --json
agentmesh sessions close --scope <scope-ref> --json
agentmesh sessions purge --expired --json
```

默认生命周期是空闲 2 小时、绝对最多 12 小时、最多 8 次成功 resume；provider retention 更短时
以 provider 为准。过期、不存在、context overflow 或不支持的 adapter 最多一次有界 fresh recovery；
认证、权限或 trust 失败不会被静默伪装成 fresh 成功。

Registry 只保存在本机用户配置目录，保存 provider opaque ID 但不进入 packet、logs、errors 或 Studio。
AgentMesh 不读取 provider token、cookie、keychain、登录态或私有 session store；Studio 只展示不可逆
`session_ref` 与 reviewer、host、mode、last-used、expiry、hermetic 状态，并提供关闭和过期清理。

## Packet 文件

每个 workflow run 都落在 `.agentmesh/runs/<run-id>/`，核心文件包括：

- `request.md`：原始任务。
- `context.md`：输入上下文、MCP 资源、项目事实、corrections 和 provenance。
- `status.json`：workflow、stage、assignment、attempt、timeout、fallback 和 release verdict。
- `events.jsonl`：append-only 事件流。
- `artifacts.toml`：stage artifacts 的索引。
- `plan.md`、`handoff.md`、`findings.md`、`decision.md`、`release-summary.md` 等 stage 输出。

Packet 是本地事实来源。Studio、CLI status、release summary 和 read SDK 都读同一套文件。

## Review 和 release evidence

Review stage 会保留每个 reviewer 的原始输出、失败说明和聚合结果。Decide stage 负责把
review findings 分类成 controller 可执行的结论。

Release summary：

```bash
agentmesh release-check summary <run-id> --write
```

输出会记录：

- 相关 diff 或 scope。
- verification evidence。
- reviewer findings。
- skipped checks。
- residual risk。
- release verdict。

`release-check` 不替用户做发布决策；它把本地证据整理成可审计的文件。

## Studio 使用

Web Studio：

```bash
agentmesh studio --port 4777
```

常用选项：

```bash
agentmesh studio --host 127.0.0.1 --port 4777 --workspace /path/to/project
agentmesh studio --no-open
```

源码开发时也可以运行：

```bash
npm run studio -- --port 4777
```

Desktop host harness：

```bash
npm run studio-desktop
```

Studio 使用本地 App Server，不把通用 shell command 暴露成 HTTP API。Desktop Studio
通过 per-launch token 和 HttpOnly cookie 保护本地页面访问。

## 配置模型

AgentMesh 读取多个配置层：

1. 内置 defaults。
2. 用户配置：`~/.config/agentmesh/config.toml`
3. 项目配置：`./.agentmesh/config.toml`
4. 显式 overlay：`--config <path>` 或 `$AGENTMESH_CONFIG`

常见写入位置：

- `agents add/remove` 写用户级 `~/.config/agentmesh/config.toml`。
- `mcp add/remove` 写用户级 `~/.config/agentmesh/config.toml`。
- `workflows add/remove` 管理用户级 workflow registry。
- `preset add/remove` 管理用户级 preset registry。
- `agentmesh init` 初始化当前项目的 `.agentmesh/config.toml` 和 `.agentmesh/` 目录。

项目配置适合放 workflow defaults、run defaults、context policy、review policy、
release policy、default stage agents 和 fallback 设置。用户级配置适合放本机 agents、
model aliases、MCP servers 和个人偏好。

## MCP resources

添加 MCP server：

```bash
agentmesh mcp add docs --command node --arg ./mcp-server.js --resource-hint docs://overview
agentmesh mcp list
agentmesh mcp inventory --json
```

在 run 中引入 MCP text resource：

```bash
agentmesh run \
  --workflow <workflow-id> \
  --plan <planner> \
  --execute <worker> \
  --review <reviewer> \
  --decide <decider> \
  --mcp-resource docs:docs://overview \
  --task "根据文档完成修改"
```

MCP 读取失败不会被静默吞掉。Packet 会记录失败类型、server id、URI、stderr 或协议错误，
让 reviewer 能看到上下文缺口。

## Corrections 和 project spec

Corrections 是本地长期事实修正，用于提醒 agent 避免重复犯错：

```bash
agentmesh correction add \
  --scope repo \
  --statement "本项目不再使用 Gemini CLI adapter，使用 antigravity-cli"

agentmesh correction list --json
agentmesh correction supersede <correction-id> --statement "更新后的事实"
```

Project spec 可以记录项目事实：

```bash
agentmesh spec check --path .agentmesh/spec/project.toml --json
```

创建 run 时可用 `--include-spec` 把项目事实加入 context。

## Doctor 和诊断

查看整体环境：

```bash
agentmesh cli detect --json
agentmesh doctor --json
```

`cli detect` 只检查支持的 provider CLI 是否能通过 PATH、常见安装目录或登录 shell 解析到；
`doctor` 会进一步检查已注册 agent、模型、help/version probe、auth probe、MCP 和 packet compatibility。

只检查指定 agent：

```bash
agentmesh doctor --agent <agent-id> --json
```

跳过非交互 auth probe：

```bash
agentmesh doctor --skip-auth-probe --json
```

Doctor 会检查配置层、agent command、model 解析、help/version probe、auth probe、MCP
配置和 packet compatibility。底层 CLI 未登录、命令不存在、模型不可用或 Antigravity
尚未拉到模型列表时，AgentMesh 会把对应状态暴露给 CLI 和 Studio。

## 本地开发

安装依赖：

```bash
npm install
```

构建：

```bash
npm run build
```

测试：

```bash
npm test
```

CLI 安装包 smoke：

```bash
npm run cli:install-smoke
```

生成 GitHub Release 形态的本地资产：

```bash
npm run release:assets
```

生成未签名 macOS DMG：

```bash
npm run studio-desktop:package:dev
cargo tauri build --config apps/studio-desktop/src-tauri/tauri.conf.json --bundles dmg --debug
```

发布 npm 包：

```bash
npm run publish:npm
```

如果 npm 开了 2FA：

```bash
npm run publish:npm -- --otp <one-time-code>
```

准备并发布 GitHub Release：

```bash
npm run publish:github -- --notes-file <release-notes.md>
```

只推送 tag 不算完成发布；GitHub Releases 页面必须能看到同名 Release 和完整资产。
完整 checklist 见 `docs/distribution/github-release.md`。

打包前需要本机安装 Rust 和 Tauri CLI：

```bash
cargo install tauri-cli --version "^2" --locked
```

## 仓库结构

```text
apps/studio-web/              React/Vite Studio 前端
apps/studio/                  Web Studio 启动入口
apps/studio-desktop/          Tauri Desktop Studio 和 sidecar host
packages/cli/                 agentmesh CLI
packages/runtime/             config、workflow、packet、dispatch、doctor、adapter runtime
packages/core/                schema、stage type、packet contract
packages/sdk/                 read-only SDK
packages/skills/              AgentMesh Skill 生成、安装和验证
docs/contracts/               runtime 和文件格式 contract
docs/distribution/            CLI、DMG、coinstall 分发说明
tests-node/                   Node test suite
```

## 安全边界

- AgentMesh 不保存 provider token。
- AgentMesh 不绕过底层 CLI 的登录态。
- Desktop Studio 的本地 App Server 使用 per-launch token 和 cookie bootstrap。
- Studio API 不提供任意 shell command 路由。
- Project config 不应该存放 secret。
- DMG 当前未签名，不适合作为企业静默安装包。

## 常用命令速查

```bash
agentmesh --help
agentmesh adapters list
agentmesh agents list
agentmesh agents add --adapter codex --model gpt-5.5 --label "Codex"
agentmesh doctor --json
agentmesh skill install --target codex
agentmesh skill verify --target codex --json
agentmesh workflows list
agentmesh run --workflow <id> --plan <id> --execute <id> --review <id> --decide <id> --task "..."
agentmesh flow status <run-id>
agentmesh flow dispatch <run-id> --stage all
agentmesh release-check summary <run-id> --write
agentmesh studio --port 4777
```
