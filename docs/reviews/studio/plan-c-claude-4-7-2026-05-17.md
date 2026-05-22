读完了 plan-c.md，并对照了仓库现状（`apps/studio/src/server.ts` 已实现 dynamic port + token via URL/cookie/Bearer；`apps/studio-desktop` 还是空的 Tauri 壳；plan-s.md 同时在做 macOS DMG，里面已经在落 Tauri shell + sidecar + tokenized URL）。以 reviewer 视角输出 findings。

## Must Fix

**M1. React 选定缺少可审计的理由。**
§1 只说"不要再 React/Vue 之间反复横跳，选 React"，但没记录 *为什么是 React*（生态：React Flow / Monaco wrapper / Radix / TanStack 主线？团队熟悉度？与同类工具一致？）。当前形态接近"决议但不留证据"。reviewer 没有判断依据；后续如果有人挑战该选型，文档无法防御。补一段 ≤5 行的 rationale，并明确列出 *被压倒的 Vue 路径优势*（你接受丢什么）。

**M2. P1.3–P2.6 期间的新旧 UI 共存机制完全缺失。**
现在的前端是 `apps/studio/src/assets.ts` 里 inline 的 `STUDIO_HTML/CSS/JS`，App Server 在 `/` 直接返回它。P1.3 选一个 pilot view 迁到 React 后：
- 是整页切到 React SPA、剩余视图作为 SPA 里的 vanilla 嵌入？
- 还是按 path 区分（部分 path → 旧 HTML，部分 path → React shell）？
- 还是 feature flag / 环境变量切换？

P2.x 是"逐 slice 迁移"的前提是这套 coexistence 模型存在。不写就是 big-bang：要么 P1.3 那一刻整个 shell 切到 React、其它视图同步重写；要么有兼容层但你没设计。这是 plan 当前最大的隐性 big-bang 风险。

**M3. `/api/bootstrap` fallback 存在循环依赖，未说明如何打破。**
§4 把 token 视为请求门票（与现有 `authorizeRequest` 一致），又把 `/api/bootstrap` 作为"前端没拿到 token 时的获取路径"。但 `/api/bootstrap` 本身在受保护源下也需要 token，否则就是个无凭据可读端点。看 `server.ts:104,299` 现状：实际上 token 是通过 GET `/` 时的 `Set-Cookie` 投递的。Plan 必须显式声明 fallback 的语义之一：
- (a) Tauri 侧通过 IPC/`window.__BOOTSTRAP__` 注入，HTTP 不参与（最干净）；
- (b) `/` 响应继续 set-cookie，React 后续请求带 cookie，`/api/bootstrap` 返回非密会话信息；
- (c) URL `?token=` + `history.replaceState`，`/api/bootstrap` 仅用于 token 已过期时的可读错误。

不挑一个，"acceptable fallback"就是漏洞或者死锁。

**M4. plan-c.md 与 plan-s.md 在 Tauri shell / sidecar / dynamic port / token 上完全重叠，却互不引用。**
plan-s.md §1、§5 已经在落 `src-tauri/src/main.rs` 捕获 Node 输出的 tokenized URL 并打开 WebView；plan-c.md §3、§4、P3.1 又重新描述同一边界。两份计划现在并行存在（仓库根目录），实施时必然冲突或重复。Plan C 必须显式声明：plan-s.md 的 desktop 边界结论是输入还是输出；P3 是否就是把 plan-s.md 的 outcome 接到 React baseline 上。否则两个 plan 会在 `tauri.conf.json` / `apps/studio-desktop/src/main.ts` 互相覆盖。

## Should Fix

**S1. 测试栈未选型。**
现仓库测试是 `node --test`（`package.json:21`），没有 jsdom / RTL / Vitest。P1.1 加 Vite + React 后，"React behavior tests for migrated views"（§7）需要选一个 runner。不锁定就意味着 P1.1 时临场决定，等于把架构决策延后到实施。建议：明确 Vitest + RTL + jsdom，并写明它如何与现有 `node --test dist-node/tests-node/*.test.js` 共存（两条并行的 `npm test` 子目标）。

**S2. 开发态前后端 origin / 代理未定义。**
"App Server serves Vite-built UI" 只描述了打包态。开发态如果跑 Vite dev server（5173 之类），与 App Server（127.0.0.1:动态）不同源，token cookie 不会自动到位，HMR 行为也会被 token gate 干扰。需要说明：dev 模式是 Vite middleware mode 嵌进 App Server，还是 Vite dev + 代理到 App Server，还是 dev 完全跳过 token。这与 M3 强相关。

**S3. P1.Z / P2.Z 没有回退分支。**
两个 phase review 只问"够不够稳定 / 是否拆掉旧路径"，没有"不够怎么办"的分支。一个 plan 没有 rollback 路径 ≈ 没有 review gate。补：若 P1.Z 判定 React baseline 不稳，旧 inline asset shell 留多久、谁负责清退、什么条件下可以重启 P2。

**S4. "AgentMesh local design system" 是隐性大坑。**
§2 baseline 里把 "Radix-style primitives + an AgentMesh local design system" 列为基线依赖。Radix-style primitives 是 headless 库（确定的），"local design system" 是 *未量化的工作量*。建议要么承诺基线 = Radix primitives + Tailwind 或 vanilla CSS tokens（明确无设计系统），要么把"建立 design system"列为独立 slice（P1.4）。否则它会偷偷在 P1.3 把一周拉到三周。

**S5. P2 缺少"一次迁完才能下一步"的硬约束。**
P2.1..P2.6 看起来独立，但 run navigator 选中态、run overview、stage timeline、artifacts、events 之间存在跨视图状态（当前选中 run / event offset / artifact selection）。P2.1 单独迁完后，旧/新视图之间的选中态如何同步？这是 M2 的细化版本。要么强制 P2.1 + P2.2 同 slice（因为它们共享选中态），要么写明"跨视图状态通过 URL/路由序列化、新旧视图都从 URL 读"。

**S6. P2.6 "safe actions" 没枚举 allowlist。**
`apps/studio/src/mutations.ts` 已经维护一个固定子集（dispatch/retry/resume/attach 之外可能还有其它）。Plan 应该指明 React 上线不扩大 allowlist；这是 §8 "frontend only calls UI-shaped APIs" 的可验证版本，也是 reviewer 在 PR 阶段拦住膨胀的钩子。

## Nit

**N1. lucide-react 整库引入会显著放大 bundle。**所有 icon 都 tree-shake 友好，但 import 路径要走 `lucide-react/dist/esm/icons/...`，plan 顺手提一句即可。

**N2. i18n 目录有，库没选。**`features/.../i18n` 出现在 §5 source layout，但 §2 baseline 没列 react-i18next / lingui / 自研。现在 vanilla shell 估计 hardcoded 文案，迁移时需要决策。

**N3. 可访问性 / 键盘导航 / focus order 在验证策略里没出现。**Studio 是本地开发工具，aria 严苛度可以低，但至少在 §7 manual check 里加一行"键盘可达 run 切换"。

**N4. §6 P3.3 "Preserve CLI Studio path"。**值得明说：CLI Studio 走的是浏览器，没有 Tauri 注入的 bootstrap，意味着 §4 的 token 投递路径必须有"非 Tauri 浏览器"分支（很可能就是 §4 的 URL ?token 或当前 cookie 方案）。把这条写进 §4 的"required contract"会更对称。

**N5. "Forms: React Hook Form + Zod when non-trivial forms arrive"** — `zod` 已经是仓库顶层依赖（`package.json:34`），可以删掉"when"，直接表态 Zod 默认入栈，RHF 按需。

## 最终建议

**Verdict: needs_decision**（在两个 Must 之前不建议进入实施）。

最小改动让 plan 可执行：
1. M2 给出一个 coexistence 模型（推荐：P1.3 起 App Server `/` 返回 React SPA shell，未迁移视图通过 `iframe src=/legacy/...` 或不出现，且 P2.x 必须按 URL 路由序列化跨视图状态——见 S5）。
2. M3 从三个 fallback 选项里挑一个；推荐 (a) Tauri IPC 注入 + (b) cookie 兜底浏览器态，禁止 URL token 形态（避免 history 里残留）。
3. M4 在 §3 顶部一句话标注："Tauri shell 边界以 plan-s.md §5 为准；本 plan §3 仅约束 React 与 App Server 的接缝。"
4. M1 补一段选 React 的具体理由（哪怕 3 行）。

P1–P3 拆分本身是合理的，渐进式 + phase gate 的形态没问题。主要风险都在"共存与边界"两件事上，不在"是否上 React"。

---
_used_: mode=无 · skills=无 · tools=Read,Bash,Glob
