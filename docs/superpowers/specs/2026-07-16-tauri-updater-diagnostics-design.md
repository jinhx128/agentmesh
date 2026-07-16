# Tauri updater 真机诊断与 0.1.13 修复设计

## 背景与事实

- `/Applications/AgentMesh.app`、bundled Node sidecar 与运行时均为 `0.1.12`；真机活动列表、详情、CLI 更新检查和 Desktop 版本检查已经正常加载。
- 原生“应用更新”检查仍显示 `Network request failed`。
- updater endpoint `https://github.com/jinhx128/agentmesh/releases/latest/download/latest.json` 可以通过 `curl` 正常跟随重定向并读取 `0.1.12` metadata。
- 使用与 `tauri-plugin-updater 2.10.1` 相同的 `reqwest 0.13.3 + rustls` 组合执行最小 Rust 探针，也能正常读取同一 metadata。
- `latest.json` 包含 `darwin-aarch64`、不可变 `v0.1.12` archive URL 和已验证签名；因此目前没有证据支持地区限制、GitHub 不可达、TLS provider 缺失或 release metadata 缺失。
- `App.tsx` 把 updater 的任意异常交给 `normalizeStudioApiError()`；该函数只保留 `StudioApiError`，其余 `Error` 或 Tauri IPC 字符串都被统一改写为 `Network request failed`。真实根因因此不可见。

## 目标与成功标准

- 先安全展示原生 updater 的真实错误类别和消息，再基于真机证据修复唯一明确根因。
- 不改变浏览器 Studio、App Server 通用 API 错误策略或 CLI 更新渠道。
- 开发包在相同机器、相同 endpoint 下能够返回“已是最新”，或给出足以定位且不泄露敏感信息的具体错误。
- 若需要修改已公开 `v0.1.12` 的代码，使用新的不可变补丁版本 `0.1.13`；不移动或覆盖 `v0.1.12` tag、Release 和资产。

## 方案选择

### 采用：updater 专用安全错误归一化

在 `desktop-updater.ts` 增加 updater 专用纯函数，仅处理原生 updater 错误：

- `Error.message`：保留非空消息。
- Tauri IPC 返回的非空字符串：原样作为候选消息。
- 其他值或空白消息：回退 `应用更新检查失败`。
- 对候选消息中的 URL query/fragment 做脱敏，并限制最大展示长度；不输出 launch token、签名 URL query 或本机私有路径。

`App.tsx` 的“检查、下载、重启”三个 updater catch 只调用这个专用函数。其他 HTTP/API 调用继续使用 `normalizeStudioApiError()`，避免扩大行为变化。

### 不采用：直接 `String(error)`

诊断最直接，但可能把临时签名 URL query、内部 IPC 内容或超长错误直接展示给用户，安全边界不足。

### 不采用：通过 Node sidecar 代理 updater

可以绕过原生网络栈，但会复制 Tauri 的版本比较、签名、安装和重启职责，破坏现有官方 updater 边界；当前证据也不支持原生网络栈不可用。

## 执行与数据流

1. 先写 RED 测试，覆盖 `Error`、Tauri 字符串、空值、URL query/fragment 脱敏和长度限制。
2. 最小实现 updater 专用错误归一化，并只替换三个 updater catch。
3. 构建可运行的 Desktop 开发包，在真机再次点击“检查应用更新”，记录原始安全消息。
4. 根据消息回到 Rust plugin、配置、metadata 或前端调用边界定位根因；一次只验证一个假设。
5. 为明确根因增加失败测试，再做最小修复；如果开发包已经返回 current，则只保留错误可观测性修复并记录原 0.1.12 失败不可稳定复现。

## 验证

- 聚焦测试：updater 错误归一化、非 Tauri fallback、Settings/About updater 状态。
- 构建：Studio frontend production build、Desktop dev package、Cargo check/test。
- 真机：无参数启动、活动数据加载、About 运行时/CLI/Desktop 版本、原生应用更新检查。
- 全量：`npm test`、`npm audit --json`、`git diff --check`。
- 按用户要求不进行逐轮 reviewer；只保留主控自审和最终一次发布门禁验证。

## 发布与回滚

- 根因修复或用户可见错误行为发生变化时发布 `0.1.13`，重新生成并验证 npm tgz、DMG、updater archive、signature、`latest.json`、Skill metadata 和 `SHA256SUMS`。
- npm 发布仍取决于有效 npm 登录；认证未恢复时不得声称 npm 渠道完成。
- 回滚以恢复现有通用错误提示或回退 `0.1.13` App 为限，不删除 workspace、registry、run 或 call 数据。

## 非目标

- 不引入 beta channel、代理设置、镜像 endpoint 或自建更新服务。
- 不重构 App Server 通用错误模型。
- 不重新审查已经通过的 Studio 活动导航、展示标题和 0.1.12 发布资产。
