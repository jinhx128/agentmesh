# Reviewer Session 能力矩阵

探测日期：2026-07-17（Asia/Shanghai）。本次仅使用 `agentmesh cli detect --json`、公开 CLI 的版本/帮助、非交互结构化输出和公开 resume 参数；未读取 provider 的 token、cookie、keychain、登录状态或私有 session store。

原始 JSON/JSONL、stderr 和真实 session ID 只短暂保存在 `/tmp` 下的临时目录。每次 probe 后均已删除；本文只保留字段名、占位命令、exit code、结果和脱敏错误形状。

## 摘要

`agentmesh cli detect --json` 确认五个注册 adapter 均由 PATH 发现。Claude Code、Cursor Agent 和 OpenCode 都完成了本次调用的结构化 start、立即显式 resume 与精确回复闭环；Codex CLI 和 Antigravity CLI 未完成。

| Provider | start / resume 实测 | 耗时（本次） | enablement |
| --- | --- | ---: | --- |
| codex-cli | JSONL 有 `thread_id`，但 start 和实际/伪 ID resume 都 exit 1，未得到精确回复 | start 16 s；两次 resume 合计 14 s | fresh-only |
| claude-code-cli | start 与实际 ID resume 均 exit 0，并返回精确回复 | start 约 4 s；完整三调用 9 s | experimental |
| cursor-agent | start 与实际 ID resume 均 exit 0，并返回精确回复 | start 约 21 s；resume/fake 同次调用约 24 s | experimental |
| antigravity-cli | start 和伪 ID conversation 调用均 exit 1，无结构化输出 | start 10 s；fake 6 s | fresh-only |
| opencode-cli | start 与实际 ID resume 均 exit 0，并返回精确回复 | start 6 s；resume 6 s；fake 1 s | experimental |

## codex-cli

- `cli_version`: `codex-cli 0.144.1`
- `structured_start`: `true`
- `session_id_field`: `thread_id`
- `explicit_resume`: `false`
- `resume_command_shape`: `codex exec resume --json --ignore-user-config --skip-git-repo-check SESSION_ID 'Reply with exactly SESSION_RESUME_OK'`
- `failure_classification`: `nonzero-after-public-jsonl-init`（start、从该次 JSONL 提取的实际 ID resume、伪 ID resume 都 exit 1，均未返回精确回复；stderr 还出现脱敏后的 remote plugin catalog authentication warning）。
- `retention_observation`: `unknown`
- `enablement`: `fresh-only`

公开帮助确认 `codex exec --json` 和 `codex exec resume [SESSION_ID] --json`。本次 JSONL 的公开 `thread_id` 可被提取，但请求未成功完成，因此不能把参数存在或初始化 event 视为可用 session reuse 证据。

## claude-code-cli

- `cli_version`: `2.1.207 (Claude Code)`
- `structured_start`: `true`
- `session_id_field`: `session_id`
- `explicit_resume`: `true`
- `resume_command_shape`: `claude -p --verbose --output-format stream-json --permission-mode plan --safe-mode --no-chrome --resume SESSION_ID 'Reply with exactly SESSION_RESUME_OK'`
- `failure_classification`: `unknown-session-id`（伪 UUID exit 1，stderr 为 `No conversation found with session ID: SESSION_ID`）。
- `retention_observation`: `immediate`（同一 probe 序列中立即恢复成功；未测更长窗口）。
- `enablement`: `experimental`

`-p --verbose --output-format stream-json` 的 start exit 0，返回 `SESSION_PROBE_OK`；从同一次公共 stream event 的 `session_id` 提取 ID 后，显式 `--resume` exit 0 并返回 `SESSION_RESUME_OK`。

## cursor-agent

- `cli_version`: `2026.07.09-a3815c0`
- `structured_start`: `true`
- `session_id_field`: `session_id`
- `explicit_resume`: `true`
- `resume_command_shape`: `cursor-agent --print --output-format stream-json --mode ask --trust --resume SESSION_ID 'Reply with exactly SESSION_RESUME_OK'`
- `failure_classification`: `unrecognized-id-accepted`（伪 UUID exit 0、返回精确回复，且返回的 `session_id` 与伪 UUID 相同）。
- `retention_observation`: `immediate`（同一 probe 序列中立即恢复成功；未测更长窗口）。
- `enablement`: `experimental`

start 和从同一次 stream JSON `session_id` 发起的实际 ID resume 都 exit 0 并返回预期精确回复。伪 ID 的接受行为意味着 adapter 必须把 CLI 成功退出与 provider 端“已存在会话”校验区分开。

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
- `enablement`: `experimental`

`opencode run --format json` 的 start exit 0，返回 `SESSION_PROBE_OK` 和 `sessionID`。以同一次输出中的 ID 调用 `--session` 后 exit 0、返回 `SESSION_RESUME_OK`，且输出 `sessionID` 与 start 相同。

## 结论与适用边界

当前证据支持将 Claude Code、Cursor Agent、OpenCode 的显式会话恢复作为实验性能力接入；三者只验证了立即恢复。Codex 与 Antigravity 保持 fresh-only。特别是 Cursor 的伪 ID 被接受，后续 adapter 不应把 exit 0 本身解释为远端会话存在或恢复成功。
