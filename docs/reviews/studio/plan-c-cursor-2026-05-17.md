以下是对 `plan-c.md` 的**只读 reviewer**意见，按你关心的维度收敛；**不修改文件**。

---

## Must（阻断或不写清就容易翻车）

1. **「选 React」缺少可审计的决策依据**
   文档用「停止在 React/Vue 间摇摆」作为动机，更像是流程约束，而不是**选型标准**（团队技能、现有代码资产、组件生态/无障碍/可测性、与 TanStack/Radix 的契合度、与现有 Studio 迁移成本对比）。对外部 review 而言，建议至少有一张「目标 vs 备选 vs 否决条件」的 decision record，否则「最终栈是否足够成立」在组织层面仍可能被反复挑战。

2. **动态端口：Tauri 如何拿到端口 —— 合同未闭合**
   正文规定了 `127.0.0.1:<dynamic-port>` 与 token，但**没有**写清 App Server 如何把端口（及失败/重试）同步给 Tauri：stdout 协议、临时文件、IPC、或 Tauri 轮询 health 等。没有这一条，`P3.1` 的验证点「app opens React UI from dynamic local server」在工程上不可验收。

3. **Token-in-URL 的威胁模型未写**
   `?token=` 在 referrer、日志、崩溃转储、屏幕共享场景有泄露面；`replaceState` 只缓解地址栏与部分历史记录问题。对本地 loopback 场景通常可接受，但**Must**在计划里明确：token 寿命、是否绑定 Origin、是否单次使用、日志脱敏、以及「泄露后的影响半径」（例如仅本机短时）。

4. **`/api/bootstrap` 回退与「同源」前提**
   若前端静态资源由同一 App Server 提供，回退合理；若曾考虑「静态文件与 API 分离」或 CDN，此条会失效。需要写明：**打包/开发模式下是否始终 same-origin**，避免后续有人把 UI 静态资源挪走而静默破坏 bootstrap。

5. **P2 阶段门仍然偏「大块」**
   虽有 P2.1–P2.6 切片，但阶段门是一次性要求 run list/detail/artifacts/events/review/actions **全部**迁移并「parity tests」。若没有**中间发布标准**（例如：旧 UI 与 React 路由共存、特性开关、按用户路径分批切换），仍存在「隐蔽大爆炸」：**长时间分支**、**大批量 diff 一次合并**、回归难以归因。

---

## Should（强烈建议补强，否则风险或成本偏高）

1. **P3（桌面）相对 P2（核心工作台）的顺序风险**
   先完成整条核心工作台再做 Tauri 接线，可能很晚才发现：侧车启动时序、窗口就绪与服务就绪、macOS Windows 签名路径、动态端口 + token 在真包环境下的边角。建议在 **P1 末尾或 P2 开头**增加**极窄纵向切片**：「Tauri 启侧车 → 动态端口 → 打开带 token 的 React → 调一次 health/API」，哪怕页面只是占位。这与文档「P1.2 bootstrap 在打包之前」一致，但**应落实到可演示产物**，而不仅是单测。

2. **「parity tests」需要可操作定义**
   现在依赖 `npm test` + 手工清单。对 P2 阶段门，应明确：关键路径的**组件/契约测试**范围、是否与现有 Golden/快照对齐、是否要有**最小 E2E**（哪怕只在 CI 可选跑）。否则「parity」容易变成主观判断。

3. **Node App Server「不当第二运行时」表述易误读**
   Node 侧本身就是长驻进程；更准确的是：**不复制执行语义/状态机**（runs、locks、packet 规则仍以 CLI/runtime 为准），App Server 只做 **I/O、编排与 allowlist 委托**。建议在边界小节用一句澄清，避免实现阶段把业务逻辑「图省事」堆进 server。

4. **依赖分层：补充「版本与准入」规则**
   baseline（React/Vite/TanStack Query/Radix 系）与 deferred 库的界限清楚；还应 **Should** 写：新依赖准入（bundle 体积、license、安全审计、与 Vite 的 SSR/纯客户端一致性），防止「Radix-style primitives」逐渐变成多套 UI 体系并存。

5. **React 作为「最终栈」与团队形状的匹配**
   若工程里仍有大量 Vue/其他栈，应写 **共存期**策略与 **sunset** 条件，否则「最终」容易被理解成「立刻唯一」。

---

## Nit（可改可不改；润色或一致性）

1. **§9「请 Claude Opus 4.7 / Gemini / Cursor 审」** 带具体模型版本，易过时；可改为「多工具/多人只读 review」类表述（不影响技术实质）。

2. **`apps/studio/` 下单 repo 同时含 `server/` 与 `frontend/`**：命名上「studio server」与「App Server」是否 1:1，建议在术语表一行对齐，减少口口相传偏差。

3. **P1.3 同时强调 i18n**：若当前 Studio i18n 很重，可作为 pilot 一部分；若尚轻，可标为「与 pilot 视图同 scope 的最小集」，避免 pilot 膨胀。

---

## 对你列的「重点挑战」的直接结论

| 维度 | 结论 |
|------|------|
| React 作为最终栈是否足够成立 | **技术栈组合自洽**（Vite + RQ + Radix 系 + 延迟重库）合理；**组织/产品层面的成立度**依赖补充**明确选型标准与决策记录**，目前documents略薄。 |
| 过度一步到位 / 大爆炸 | **意识与切片到位**（P1 pilot、延期重依赖）；**P2 阶段门仍偏整包**，Suggest 增加共存/渐进切换与中间里程碑，降低隐性大爆炸。 |
| Tauri / Node / React 边界 | **总体清晰**；建议精化「第二运行时」含义与 «谁拥有执行语义»。 |
| dynamic port + per-launch token | **方向可落地**；**Must 补** Tauri↔侧车端口发现与 token 威胁模型，否则验收悬空。 |
| 依赖分层 | **合理**；建议加**依赖准入/version 策略**。 |
| 实施切片与验证 | **P1 细腻**；**P2/P3 验证**宜加强「parity」定义与一条端到端/bootstrap 纵向切片。 |

---

## 最终建议（reviewer 总结）

- **可以按 Plan C 的大方向推进**，前提是：把 **动态端口发现**、**bootstrap 安全与失败表现**、**React 选型决策记录** 三块写成与 P1/P3 验收挂钩的**明确合同**（否则后期扯皮和返工概率高）。
- **保留当前「先轻量 pilot、defer 图/编辑器/终端」** 的策略，这是抑制大爆炸最有效的一刀。
- **对 P2 建议再切一层「发布语义」**：不是只有 P2.Z 才评审，而是每个子切片都可以 **可演示、可回滚、可对比旧 UI**，这样「最终栈是 React」和「过程可控」才能同时成立。

---

_used_: mode=无 · skills=无 · tools=Read
