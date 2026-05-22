以下是对 `docs/decisions/studio-frontend-stack-proposal.md` 的**只读 reviewer**意见，按你列的重点做了刻意挑战，并给出分级结论与最终建议。

---

## Must（应优先回应的风险 / 缺口）

1. **框架触发门槛可能过松或过紧，且可博弈空间大**
   「至少两条」同时成立的条件里，多项高度相关（例如复杂表单 ↔ 多区域 UI 状态 ↔ 难测的 DOM 字符串断言）。容易出现：**真需要框架时已欠债很重**，或**用相关性“凑两条”**提前上框架。文档缺少**互斥/独立**的判定口径或优先级（哪一条单独就应升级讨论）。

2. **Vite 与「先拆模块」的顺序缺少对“鸡生蛋”的反证**
   推荐是先拆 `assets.ts` 再上 Vite；但若痛点是「需要真实 browser module 与 bundling」，**先加一个最小 Vite 入口 + 渐进搬文件**有时比「先在无 bundler 下硬拆大文件」阻力更小。文档没有说明为何排除「Vite 先于深度拆分」或何时应反转顺序，**在挑战「是否应先引入 Vite」时论证不完整**。

3. **Tauri 边界在“原则”上清晰，在“工程防呆”上偏薄**
   文档正确强调不把 packet/workflow 等逻辑放进 Rust，但**未列出典型越界信号**（例如在 `invoke` 里做校验/编排、与前端重复业务规则、用 Tauri 文件 API 绕过既有 CLI 变异路径等）。「thin shell + tokenized URL」一句不够让团队在日复一日实现里自检是否越界。

4. **Trigger gates 可测性不足，易导致无限推迟**
   Vite/React 触发条件多为定性（「变慢」「需要」「脆弱」）。**缺少可核验的阈值或产物**（例如：`assets.ts` 行数/模块数上限、构建时间、某类改动的 touch 文件数、测试里字符串断言占比、新增一屏功能的估计工时）。在「是否够具体」这一点上，**与 success criteria 里的「explicit trigger conditions」有落差**。

---

## Should（建议在修订或评审结论里补强）

1. **对「延迟 React/Vue」既要坚持也要承认临界点**
   文内 Review Questions 已点到约 2800 行量级；仓库里 `assets.ts` 非空行约在 **2600+** 量级，与「大肉球」叙事一致。建议在决策上明确：**延迟框架不等于无限期**，并写清 **P1.Z 若仍痛苦则默认进入 Vite 或框架 POC**，避免「永远 stabilizing」。

2. **React vs Vue 的「适配性」对 Studio 仍偏泛**
   两套栈都合理，但论证较多来自生态默认值（Radix/shadcn vs Element Plus/Naive），**对 AgentMesh Studio 的差异点**（例如：与现有 Node 测试的衔接、桌面密度布局、可访问性/国际化是否已有方向、团队维护谁更熟）着墨少。**「默认 React」**主要写在 P3.1，而非由 Studio 形态推出，容易被视为偏好而非约束推导。

3. **「先 Vite 再上框架」与默认技术选型之间的路径可再钉一下**
   若最终是 React+Vite 或 Vue+Vite，**Vite 往往不是临时台阶而是长期底座**；文档可以更早声明：**Vite 引入不等于选框架**，但 **Vite 很可能是框架的前置**，以减少日后「先 TanStack Query 再反过来动构建」的摩擦。

4. **Tauri 从 packaging 到「产品面」的开关写得较好**
   「Signed distribution、更新、通知、文件关联…」一条很实用；可再补半句 **与「仅多一个浏览器窗口包壳」的区分**，防止把「我们想发包」误当成必须上 Tauri 日活开发。

---

## Nit（可改可不改）

- `schema_version` 与正文混排，若未来机器消费可换成统一 frontmatter；纯人文档则无妨。
- Status 写「pending external review」，§7 又点名具体模型 — 对外部读者略跳跃。
- Vue 侧写 Pinia、React 侧写 TanStack Query，**服务端状态与本地 UI 状态**的对应关系略不对称，可能引发「为何 Vue 不提 SWR/TanStack Vue」之类杂音（不一定要展开， awareness 即可）。

---

## 最终建议（reviewer 结论）

- **延迟引入 React/Vue：总体赞同**，与非云、CLI 后端、协议边界稳定的叙述一致；但**应用「规模 + P1 结果 + 可量化 gate」把延迟变成有时间盒与证据的延迟**，而不是哲学上的 postpone。
- **是否先引入 Vite：不必教条式排在「深度拆分」之后**。更稳的表述是：**默认先模块化拆分；一旦出现「需要真实 ESM/bundling、稳定 dist、或 Tauri 要标准 frontend 输出」任一条，就允许 Vite 与拆分并行或略提前**，避免为顺序牺牲效率。
- **React vs Vue**：对「密集工作台」两者都可行；文档的**默认 React**在生态与「流式图编辑器」链路上略顺，但**若团队 Vue 明显更强，Vue 栈不会从提案里被证伪**——缺的是**与 Org/技能/测试基建绑定的选择标准**。
- **Tauri 边界**：**原则清晰，落地细则不足**；建议补「禁止/警惕模式」清单，而不加长§4。
- **Trigger gates**：方向对，**建议加最小可测指标或阶段评审产出物**，否则「具体 enough」在严格意义下**尚未完全达标**。

若只采纳一件事：**把 gate 从纯叙事改成带阈值或评审工件（哪怕很轻）**，这份提案会从未定稿的共识草案，变成更能驱动节奏 decisions 的文档。

---
_used_: mode=无 · skills=无 · tools=Read,Grep
