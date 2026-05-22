我直接以只读 reviewer 视角完成评审，不读 skill、不修改文件。下面是基于 `studio-distribution.md` / `studio-shell.md` / `plan-c.md` 三份现有决策的复盘。

---

## 1. 对“同类 AI desktop 都用 Electron”这条新事实的校准

事实成立但解释要克制：

- Claude.app / Codex.app / OpenCode.app 用 Electron + Vite/React，这是**渲染层归宿一致**（都是 web 技术 + Node 后端），不是“Electron 是这类产品的必要条件”。它更多反映：这些团队的工程师是 JS/TS 背景，需要 `node-pty`/Chromium DevTools/原生菜单/IME 一致性，以及交付时间窗压力。
- 这条事实可以推翻“Tauri 是 AI 客户端业界默认”这种没人主张过的命题；它**不能直接推翻** AgentMesh Studio 在 plan-c.md 第 3 节的具体边界（Tauri 仅做 lifecycle shell，业务逻辑全在 Node sidecar）。
- 真正决定要不要换 Electron 的，是**项目自身的需求清单**，不是同类工具的选择分布。

下面按需求维度逐项挑战。

---

## 2. 维度逐项挑战

### 2.1 Sidecar / App Server 生命周期

- 当前设计：Tauri 用 sidecar 启动 app-bundled Node App Server，UI 通过 `127.0.0.1:<dyn>?token=...` 加载。
- Electron 替代：renderer + main 进程都内置 Node，可以直接 `child_process.fork` 或在 main 进程内嵌 App Server，省去跨进程 token bootstrap。
- 校准：Tauri sidecar 这条路**可走但更脆弱**——signing、notarization 时 sidecar 二进制需要单独 codesign，Node sidecar 在 macOS hardened runtime 下容易触发 `EXC_BAD_ACCESS`（V8 JIT + RWX 页），需要 entitlements `com.apple.security.cs.allow-jit` 等。这块 plan-c.md / studio-distribution.md **没有**点名。Electron 的 helper 进程已经把这套打通。
- 结论：sidecar 路径的“风险还没量化”，是当前最大的未验证项。

### 2.2 node-pty / 原生 Node 模块

- `studio-distribution.md:48` 已经把 “需要 node-pty / native Node 模块” 列为 Electron fallback 触发条件。
- `plan-c.md:64` 把 xterm.js 列为 deferred，也明确说当前不需要终端流。
- 校准：**如果 AgentMesh Studio 的产品路线里确实有“在 UI 内跑 entry agent terminal / claude code 风格的交互式 PTY”，那 Electron 几乎不可避免**——Tauri 里要么把 node-pty 放到 sidecar 通过 WS 流到 webview（多一跳、ANSI/resize/中文 IME 处理都要自己重写），要么用 Rust 端 portable-pty + tauri command 桥接（业务逻辑会渗到 Rust，违反 `studio-shell.md:73-75` 的硬约束）。
- 问题：当前文档**没有显式回答** “Studio 是否要内嵌交互式 agent terminal”。这是要 Must 解决的产品决策。

### 2.3 WebView 差异

- Tauri 在 macOS 用系统 WKWebView；Windows 用 WebView2（Edge Chromium，需要 runtime 已安装，Win11 默认有，Win10 多数有）；Linux 用 WebKitGTK（**已知最弱**，CSS/JS 行为常与 Chromium/Safari 都不一致）。
- Electron 在所有平台都打包 Chromium（一致性赢，包体输）。
- 对 AgentMesh Studio 影响：
  - 若 UI 严格走 plan-c 里的 Radix + TanStack Query + 普通组件，WKWebView 基本够用。
  - 若用 Monaco（plan-c 已 defer）：Monaco 对 WKWebView 的兼容**有过 bug 历史**（worker、字体度量、IME），需要实测。
  - 若用 React Flow：DOM/SVG 重排在 WKWebView 通常 OK，但拖拽/手势在 Linux WebKitGTK 上是高风险。
  - **macOS-only 首发**这点对 Tauri 反而是利好——WKWebView 是三平台里最稳的那个。

### 2.4 签名 / 更新

- macOS Developer ID + notarize：Tauri 和 Electron 都成熟。Tauri 的优势是 app 主二进制小（几 MB Rust），但 sidecar Node 仍需 codesign + entitlements + notarize。Electron 的 helper 已经是签名/公证社区标配。
- 更新框架：
  - `tauri-plugin-updater` + 静态 JSON：方案干净，但生态比 `electron-updater` (Squirrel.Mac / NSIS / AppImage) 小一个数量级；rollback、差分包、回滚白名单基本要自建。
  - Electron 的 `electron-updater` 提供 staged rollout、provider 抽象、delta 包，更成熟。
- 校准：plan-c §4 的 bootstrap 契约和 studio-distribution §“Updater Stack” 都已写明白单通道 JSON 即可，**第一版需求范围内 Tauri updater 不落败**。但跨平台扩展时差距会显著拉开。

### 2.5 包体 / 资源占用

- Tauri 主程序通常 ~8-15 MB，加上 Node sidecar runtime（~40-60 MB 取决于是否用 single executable application / SEA / pkg / nexe）→ 总安装 50-100 MB。
- Electron ~120-180 MB 起步。
- 内存：Tauri 主 shell + WKWebView ~150-250 MB；Electron Chromium + Node ~300-500 MB。
- 对**“运维工具/IDE 周边”这类长驻应用**，安装体积差异已经不那么关键（用户 IDE 都是 GB 级）。这条不应作为关键决策因素。

### 2.6 开发速度 / 团队能力

- Tauri 强制 Rust 工具链 + 一套 IPC 学习曲线，**即便业务逻辑全在 Node**，调试 sidecar 启动/退出、token 注入、URL bootstrap、deep link、tray、菜单时仍要写 Rust 命令或用 `tauri-plugin-shell`。
- Electron 全栈 TS，App Server 直接在 main 进程，调试链路最短。
- 这是当前最被低估的成本——`plan-c.md` 没有评估团队 Rust 经验。如果团队没有现成 Rust skill，**P3.1 / P3.2 实际工时会被严重低估**。

### 2.7 安全边界

- Tauri 默认更保守：allowlist 化的 command 表 + CSP + 系统 WebView。
- Electron 安全配置正确（`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, preload bridge, CSP）也能做到等价隔离，但**默认是错的**，需要团队纪律。
- AgentMesh Studio 的写入面已经被 `studio-shell.md:101-110` 和 `app-server.md`（推断）约束为 “UI 只走 App Server 的 allowlist”，**安全边界主要由 App Server 决定**，shell 选择对安全的边际贡献被稀释了。
- 这条不是决定性因素。

### 2.8 跨平台策略

- `studio-distribution.md:114-124` 明确：Windows/Linux 需要单独决策，不继承 macOS 假设。
- 现实：如果 v2 要上 Linux 且 UI 复杂，**WebKitGTK 是 Tauri 的真实痛点**。Electron 在 Linux 上 UI 一致性远胜。
- 但 v1 = macOS only，这条**当前不是命中条件**，只是未来风险。

---

## 3. Findings

### Must

- **M1 — Sidecar 风险量化缺失。** `studio-distribution.md:39-42` 写了 “P4.3 必须先证明 sidecar packaging”，但没有列具体验收项：Node sidecar 在 hardened runtime 下是否需要 `allow-jit` / `allow-unsigned-executable-memory`、SEA vs pkg vs full Node 三种打包的体积与启动时间、sidecar 崩溃后 Tauri shell 的恢复策略、notarize 失败的最常见原因。这是触发 Electron fallback 的最高概率原因，必须先跑实验再投入 P3。
- **M2 — 产品路线必须先回答“是否要内嵌交互式 PTY/Terminal”。** plan-c 把 xterm.js 列为 deferred，但没有说“产品永不内嵌交互式 terminal”。如果未来要做 entry-agent 的 inline terminal 或 claude-code 风格 chat-with-shell，Tauri 路径会被迫把 PTY 桥到 Rust 或单独 sidecar。这个决策点必须在 P3 启动前明确，否则 P3 做完后会被迫返工到 Electron。
- **M3 — Electron fallback 触发条件需要补一条“团队 Rust 能力不足以维护 Tauri shell”。** 当前 `studio-distribution.md:46-58` 的 fallback 条件全部是技术维度，没有运维/能力维度。一个长期没人能 review 的 Rust shell 是真实风险。

### Should

- **S1 — 把 “macOS-only 首发” 作为 Tauri 选择的限定语写进 distribution.md。** 当前文档只说 “Windows/Linux 另议”，但没把 “Tauri 的选择隐含依赖 v1 只上 macOS” 写明。一旦产品需求改成 v1 同时上 Windows + Linux，Tauri 的胜负要重算（WebView2 runtime 依赖、WebKitGTK 兼容性）。
- **S2 — Updater 路径补一条“失败上报回执”。** plan-c §4 / distribution §“Failure And Rollback” 已经写了不静默重试，但没写如何让用户告诉团队“我更新失败了”。Electron 生态有现成的 Sentry release tracking + electron-updater 事件；Tauri 自建。这个差距应纳入实验项。
- **S3 — Bootstrap token 在 URL 上的方案需要补 CSP / Referer 风险评注。** `plan-c.md:120-123` 用 `?token=...` + `history.replaceState`。这个 token 在加载瞬间会出现在 WebView 进程内存、可能出现在 `document.referrer` 给到任何被嵌入的子资源（哪怕是 same-origin），也可能出现在 devtools 历史。建议优先 `/api/bootstrap` 走 `Authorization` header 或 `Set-Cookie HttpOnly + SameSite=Strict` 的方案，把 URL token 改为 fallback。
- **S4 — Sidecar 进程的“App Server 死了 Tauri 不要崩，反过来也成立”这一对称性没写进 contract。** plan-c §3 只描述了 Tauri 启停 sidecar，没说 sidecar OOM/panic 时 Tauri 是否自愈、用户看到什么。Electron 在 main 进程内嵌时这是天然单元；Tauri sidecar 必须显式设计。

### Nit

- **N1 — `studio-shell.md:62-82` 关于“为什么不选 Tauri”的旧理由已被 P4.2 推翻，文件里两节并存读起来矛盾。** 不改写历史也行，但建议在 “Tauri” 小节顶部加一行 “Superseded by P4.2 / studio-distribution.md” 指针。
- **N2 — `plan-c.md` §2 列出 “Electron as a parallel target” 为 rejected，但没说“rejected as parallel target，仍是 fallback”。** 与 `studio-distribution.md:44-59` 表述存在轻微张力，一行注脚就能消除。
- **N3 — “app-managed signed update artifacts” 与 `tauri-plugin-updater` 的 minisign/RSA 签名方案的关系没在文档里展开**，第一次实施时容易把 codesign 和 updater signature 混为一谈。

---

## 4. 推荐结论

**保留 Tauri，但把 M1/M2 作为 P3 入口的硬阻塞。**

理由：

1. AgentMesh Studio 当前需求清单（macOS-only 首发、无交互式 PTY、无 Monaco、无 Chromium-only API）**没有命中任何 Electron 必须项**。
2. 业务边界（`studio-shell.md:101-110`、`plan-c.md` §3）已经把 desktop shell 限制到 lifecycle-only，这种 “thin shell + Node 内核” 的拓扑正是 Tauri 的甜区，Electron 在这个拓扑下的优势会被 sidecar 模型抵消大半。
3. 同类工具用 Electron 不构成换栈理由——它们的产品里**普遍内嵌 PTY、Chromium DevTools、复杂键盘/IME 流**，那才是它们选 Electron 的实因。AgentMesh Studio 没有这些命中。

**触发立即切换 Electron 的条件（写进 fallback）：**

- 产品决定 v1 内嵌交互式 agent terminal / PTY（命中 `studio-distribution.md:48`）。
- M1 实验里 sidecar Node 在 macOS hardened runtime + notarize 路径上有任一项无法在 2 周内打通。
- v1 范围被改为同时发布 macOS + Windows + Linux 且 UI 引入 Monaco 或 React Flow。
- 团队评估后确认无人能长期 owner Rust shell（M3 触发）。

---

## 5. 如果保留 Tauri，需要补的验证实验（建议放在 P3.1 之前，作为 P2.Z 后的 “P3.0 spike”）

每项都要给出明确的“通过 / 退回 Electron”判据：

1. **Node sidecar 打包形态 spike**
   - 比较 full Node binary、Node SEA（v22+ stable）、`pkg`、`@yao-pkg/pkg`、`nexe` 四种。
   - 指标：体积、冷启动 ms、是否需要 `allow-jit` entitlement、notarize 是否一次通过、未来给 sidecar 装 native module（`better-sqlite3` / `node-pty`）是否可行。
   - 通过判据：至少一种方案 ≤ 60 MB、冷启动 ≤ 400ms、notarize 一次通过、未来可加 native module。

2. **Codesign + Notarize 端到端**
   - main app + sidecar + 所有嵌入二进制（含 helper、node、ffmpeg 之类如果有）全部走 Developer ID + notarize + staple。
   - 通过判据：clean install on a fresh macOS account 不弹 Gatekeeper 警告，离线启动也不报错。

3. **Sidecar 生命周期容错矩阵**
   - 用例：sidecar OOM、sidecar panic、端口占用冲突、token 校验失败、systemd-equiv 杀掉子进程、Tauri shell 强退是否留孤儿 Node 进程。
   - 通过判据：所有用例下用户看到具体错误，进程表无孤儿，第二次启动可恢复。

4. **Bootstrap 契约最终方案**
   - 实测 `?token=` + replaceState vs `/api/bootstrap` + `Authorization` header vs 短期 cookie 三种，确认 WKWebView 下没有 token 落到 devtools history / referer / 持久化 storage。
   - 通过判据：token 在 Web Inspector Network/Storage/Console 三个面板都看不到持久化痕迹。

5. **WKWebView UI smoke**
   - 用 P1.3 的 pilot view 在 WKWebView 跑一遍，专门覆盖：中文 IME、`position: sticky`、`<dialog>`、`Intl.Segmenter`、SVG filter、`scrollbar-gutter`、`scroll-behavior: smooth`、custom font 加载抖动。
   - 通过判据：与 Chrome 行为差异都有 workaround，且 workaround 不污染组件库。

6. **Auto-update 完整闭环**
   - 发一版、升一版、模拟下载失败、模拟签名校验失败、模拟 metadata 404、模拟用户离线、模拟 staple 失效。
   - 通过判据：六种失败都不卡死、有用户可读错误、下次启动可重试或可被引导手动安装。

7. **构建产物 macOS Intel + Apple Silicon**
   - 至少 universal 或双产物，CI 上能产出。
   - 通过判据：CI 在 GitHub-hosted macOS runner 上可重复构建并签名。

任何一项**两周内未通过**，按 `studio-distribution.md:46-58` 触发 Electron fallback 评估，不要拖到 P3.2 才发现。

---

总评：当前 Tauri 决策**在 AgentMesh Studio 的实际需求下站得住**，但文档把太多“稳的部分”写实了、把“真正风险的部分”（sidecar Node 打包 + notarize + 生命周期容错）放在一句 “P4.3 应先证明” 里轻描淡写。建议把上面 7 个 spike 作为 P3 的硬前置，并把 M2（PTY 决策）和 M3（团队 Rust 能力）写进 fallback 触发条件。同类工具用 Electron 这条事实**不足以反转决策**，但**应该提高对 sidecar 风险量化的标准**。

---
_used_: mode=coding-mode · skills=无 · tools=Read
