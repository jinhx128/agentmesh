# 2026-09-22（续）

## 22:00 - 准备 AgentMesh 0.3.3 发布

把 v0.3.2 的代理例外改写补齐到桌面端的 Rust 路径。

- `apps/studio-desktop/src-tauri/src/lib.rs` 新增 `normalize_proxy_exception`，`parse_mac_system_proxy` 收集例外时调用它并去重。规则与 runtime 侧 `process-env.ts` 一致：`*.example.com` 与 `.example.com` 改写为 `example.com`，丢弃 `<local>`，`*` 保持原样，CIDR 与裸主机名不变。
- v0.3.2 只修了 `packages/runtime/src/process-env.ts`。桌面端另有一份独立的 `scutil --proxy` 解析，`mac_system_proxy_env()` 把它的结果写进自身进程环境，`sidecar_proxy_envs()` 再转发给 sidecar，因此 Desktop Studio 内的更新检查与 agent 派发拿到的仍是 `*.` glob 与 `<local>`。
- 顺带修复 `cargo test` 的编译失败：`DesktopPreferences` 早前新增了 `auto_check_cli` 字段，但三处测试初始化未同步，导致 4 个 E0063。该问题在本次改动前已存在（`git stash` 后复现同样 4 个错误），挡住了新测试运行。
- 将 root、全部 workspace、内部 exact dependencies、Tauri/Cargo、updater 示例、运行时版本常量和版本测试同步到 `0.3.3`。
- 更新 README 当前发布入口，新增 `docs/distribution/v0.3.3-release-notes.md`。

### 验证

- `cargo test`：7 passed，0 failed（含新增 3 项代理改写测试）。
- `npm test`：718 passed，0 failed。
- `cargo build --release` 通过。
- 用真实 `scutil --proxy` 输出复刻修复后的 Rust 解析，产出 `127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,local,crashlytics.com,zhuanspirit.com`，与 runtime 侧 `buildAgentProcessEnv()` 的结果逐项一致。
- 新增 3 个 Rust 测试覆盖：glob 与前导点折叠为裸域名并去重、`*` 条目保持全部绕过、全部条目都无 `NO_PROXY` 语义时不写入 `__exceptions__`。

### 排查过程中被否掉的假设

桌面端关于页报「部分更新状态检查失败」时，第一反应是这个 `NO_PROXY` 缺陷导致的。实测否掉了：带上 Rust 原样注入的 `NO_PROXY` 跑 GitHub 请求仍返回 302，因为 `github.com` 本来就不在例外列表内，写法对它没有影响。

那次报错的真实原因是用户的代理隧道 `github.com` 时间歇性失败：连续 5 次经代理请求为「超时 5s / 302 / 302 / 302 / 302」，耗时在 1.6–6.5s 之间波动；同时直连 3 次全部 302，稳定在 0.3–0.5s。属于环境问题，不在本次代码修复范围。

本次修复的实际影响面是 Desktop Studio 访问例外列表**内**的端点（例如内网网关），与该报错无关。

### 未验证

- 仅在 macOS 上验证。其他平台 `mac_system_proxy_settings()` 返回 `None`，代码路径不变，但未实机运行。
- 未安装 clippy，`cargo clippy` 未执行。
- 桌面端内 agent 派发访问例外列表内端点的端到端行为，未在新 DMG 安装后逐一复跑；改写结果与 runtime 侧一致性已用真实 scutil 输出逐项核对。
