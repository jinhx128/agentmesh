# Reviewer Session 能力矩阵

探测日期：2026-07-17（Asia/Shanghai）。本次仅使用 `agentmesh cli detect --json`、公开 CLI 的版本/帮助、非交互结构化输出和公开 resume 参数；未读取 provider 的 token、cookie、keychain、登录状态或私有 session store。

原始 JSON/JSONL、stderr 和真实 session ID 只短暂保存在 `/tmp` 下的临时目录。每次 probe 后均已删除；本文只保留字段名、占位命令、exit code、结果和脱敏错误形状。

## 摘要

`agentmesh cli detect --json` 确认五个注册 adapter 均由 PATH 发现。Claude Code 和 OpenCode 完成了早期精确回复 probe 的结构化 start/立即 resume，但 P5.2 真实审查 A/B 未产生合格 resumed arm；runtime 默认因此将五个 adapter 全部保持 fresh-only。Cursor Agent 虽接受 `--resume`，但伪 ID 也被同样接受；Codex CLI 和 Antigravity CLI 未完成结构化闭环。

| Provider | start / resume 实测 | 耗时（本次） | enablement |
| --- | --- | ---: | --- |
| codex-cli | 公开 JSONL 曾观察到 `thread_id`，但 start 和实际/伪 ID resume 都 exit 1，未得到精确回复 | start 16 s；两次 resume 合计 14 s | fresh-only |
| claude-code-cli | 精确回复 probe 可 start/resume；真实审查 continuous start 失败 | probe start 约 4 s；P5.2 continuous 15.4 s 失败 | fresh-only |
| cursor-agent | start exit 0 并返回 `session_id`；实际 ID 和伪 ID 的 `--resume` 都 exit 0、返回精确回复，不能证明会话连续性 | start 约 21 s；resume/fake 同次调用约 24 s | fresh-only |
| antigravity-cli | start 和伪 ID conversation 调用均 exit 1，无结构化输出 | start 10 s；fake 6 s | fresh-only |
| opencode-cli | 精确回复 probe 可 start/resume；真实审查 continuous start 失败 | probe start/resume 各约 6 s；P5.2 continuous 25.5 s 失败 | fresh-only |

## codex-cli

- `cli_version`: `codex-cli 0.144.1`
- `structured_start`: `false`
- `session_id_field`: `thread_id`
- `explicit_resume`: `false`
- `resume_command_shape`: `codex exec resume --json --ignore-user-config --skip-git-repo-check SESSION_ID 'Reply with exactly SESSION_RESUME_OK'`
- `failure_classification`: `nonzero-after-public-jsonl-init`（start、从该次 JSONL 提取的实际 ID resume、伪 ID resume 都 exit 1，均未返回精确回复；stderr 还出现脱敏后的 remote plugin catalog authentication warning）。
- `retention_observation`: `unknown`
- `enablement`: `fresh-only`

公开帮助确认 `codex exec --json` 和 `codex exec resume [SESSION_ID] --json`。虽然本次失败调用的公开 JSONL 中观察到并可提取 `thread_id`，但 start 未成功完成；因此 `structured_start` 为 `false`，不能把该初始化 event 或参数存在视为可用 session reuse 证据。

## claude-code-cli

- `cli_version`: `2.1.207 (Claude Code)`
- `structured_start`: `true`
- `session_id_field`: `session_id`
- `explicit_resume`: `true`
- `resume_command_shape`: `claude -p --verbose --output-format stream-json --permission-mode plan --safe-mode --no-chrome --resume SESSION_ID 'Reply with exactly SESSION_RESUME_OK'`
- `failure_classification`: `unknown-session-id`（伪 UUID exit 1，stderr 为 `No conversation found with session ID: SESSION_ID`）。
- `retention_observation`: `immediate`（同一 probe 序列中立即恢复成功；未测更长窗口）。
- `enablement`: `fresh-only`（P5.2 真实审查 A/B 后降级）

`-p --verbose --output-format stream-json` 的 start exit 0，返回 `SESSION_PROBE_OK`；从同一次公共 stream event 的 `session_id` 提取 ID 后，显式 `--resume` exit 0 并返回 `SESSION_RESUME_OK`。

## cursor-agent

- `cli_version`: `2026.07.09-a3815c0`
- `structured_start`: `true`
- `session_id_field`: `session_id`
- `explicit_resume`: `false`
- `resume_command_shape`: `cursor-agent --print --output-format stream-json --mode ask --trust --resume SESSION_ID 'Reply with exactly SESSION_RESUME_OK'`
- `failure_classification`: `unrecognized-id-accepted`（伪 UUID exit 0、返回精确回复，且返回的 `session_id` 与伪 UUID 相同）。
- `retention_observation`: `unknown`
- `enablement`: `fresh-only`

start exit 0 并从同一次 stream JSON 得到 `session_id`；以实际 ID 调用 `--resume` 也 exit 0 并返回预期精确回复。然而伪 ID 得到相同的 exit 0、精确回复和相同 ID 回显，因此本次 probe 不能区分真实恢复、按指定 ID 新建或其他等价行为。不能证明显式 resume 的会话连续性，故保持 fresh-only。

## antigravity-cli

- `cli_version`: `1.1.3`
- `structured_start`: `false`
- `session_id_field`: `none`
- `explicit_resume`: `false`
- `resume_command_shape`: `agy --print --mode plan --sandbox --conversation SESSION_ID 'Reply with exactly SESSION_RESUME_OK'`
- `failure_classification`: `agent-execution-terminated`（start 与伪 ID `--conversation` 均 exit 1，stderr 为 `Error: Agent execution terminated due to error.`）。
- `retention_observation`: `unknown`
- `enablement`: `fresh-only`

注册 adapter 名为 `antigravity-cli`，PATH 命令为 `agy`。公开帮助提供 `--conversation`，但没有 JSON/stream-JSON 输出模式；本次非交互调用亦未返回可用 ID 或精确回复。

## opencode-cli

- `cli_version`: `1.17.18`
- `structured_start`: `true`
- `session_id_field`: `sessionID`
- `explicit_resume`: `true`
- `resume_command_shape`: `opencode run --format json --dir TEMP_WORKSPACE --session SESSION_ID 'Reply with exactly SESSION_RESUME_OK'`
- `failure_classification`: `session-not-found`（伪 UUID exit 1，stderr 为 `Error: Session not found`）。
- `retention_observation`: `immediate`（同一 probe 序列中立即恢复成功；未测更长窗口）。
- `enablement`: `fresh-only`（P5.2 真实审查 A/B 后降级）

`opencode run --format json` 的 start exit 0，返回 `SESSION_PROBE_OK` 和 `sessionID`。以同一次输出中的 ID 调用 `--session` 后 exit 0、返回 `SESSION_RESUME_OK`，且输出 `sessionID` 与 start 相同。

## P5.2 Fresh/Reuse 质量门禁

使用同一个临时 Git fixture、同一 `src/access.ts` diff、同一审查提示和同一注入缺陷（非 owner 授权绕过）执行。未读取 provider token、cookie、keychain、登录态或私有 session store；packet 不保存 propagated raw token。`tool_reads` 当前不在 AgentMesh timing schema 中，记为 `not_observable`，不伪造数字，也不把它当作性能收益。

| Provider / arm | Run ID | 结果 | wall time | 输出有效 | 缺陷检出 | false-LGTM |
| --- | --- | --- | ---: | --- | --- | --- |
| Claude continuous fresh | `workflow-20260719093653` | structured start exit 1；未创建可复用 entry | 15.4 s | 否 | 不可评估 | 不可评估 |
| Claude independent fresh | `workflow-20260719094407` | 完成 | 31.2 s | 是 | 是 | 否 |
| Claude default-gate fresh | `workflow-20260719095819` | 降级后完成且保持 hermetic fresh | 19.9 s | 是 | 是 | 否 |
| Claude resumed | 无 | fresh arm 未产生安全可复用 session，按门禁跳过 | — | — | — | — |
| OpenCode continuous fresh | `workflow-20260719094031` | structured start exit 1；未创建可复用 entry | 25.5 s | 否 | 不可评估 | 不可评估 |
| OpenCode independent fresh | `workflow-20260719094438` | 240 s 超时 | 240.0 s | 否 | 不可评估 | 不可评估 |
| OpenCode resumed | 无 | fresh arm 未产生安全可复用 session，按门禁跳过 | — | — | — | — |

这组证据无法证明 resumed 的 latency/tool-read 收益，也无法完成 resumed 输出有效性、缺陷检出和 false-LGTM 对照。失败不可降级为“实验通过”，因此 runtime 默认 gate 不启用任何内置 adapter 的 reviewer session reuse。底层 Claude/OpenCode argv/parser probe 与 disposable fake-CLI 状态机测试继续保留，只有未来真实 A/B 同时通过性能、输出和缺陷检出门禁后才能重新提升单个 adapter。

## 结论与适用边界

所有五个内置 reviewer provider 当前均为 fresh-only。Claude Code/OpenCode 的早期精确回复 probe 只证明特定三事件输出可立即恢复，不足以证明真实审查生命周期可用；Cursor 的伪 ID 被接受且被原样回显；Codex 与 Antigravity 未完成结构化闭环。后续 adapter 不应把 exit 0、精确回复、ID 回显或底层 parser 存在本身解释为 runtime enablement。
