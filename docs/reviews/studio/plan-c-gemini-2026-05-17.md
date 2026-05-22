# Plan C Review Findings

基于只读 Reviewer 视角，以下是对 `plan-c.md` 的架构审查结论与具体 Findings：

## 1. 核心挑战回应 (Addressing Core Challenges)

- **React 作为最终栈是否足够成立？** **完全成立。** Plan 明确终结了栈的摇摆，锁定了 Vite + React + TS + TanStack Query 的现代标准组合。最明智的是其克制性：将 Zustand、React Flow、Monaco 等重型库明确列为 Deferred（按需延迟加载），避免了初始包体积膨胀和复杂度失控。
- **是否存在过度一步到位或大爆炸风险？** **风险已被有效控制。** 方案采用了清晰的平滑演进切片（P1 基础设施 -> 低耦合视图先导 -> P2 核心工作台验证 -> 最终下线旧版）。“在新栈达到对等前不移除旧前端”是极其稳妥的做法。
- **Tauri/Node/React 边界是否清晰？** **非常清晰且优雅。** Tauri 仅作为宿主生命周期壳，Node App Server 充当本地网关（读取文件、调度 CLI 锁），React 退化为纯视图层。这彻底阻断了前端直接读写 `.agentmesh/runs/*` 的路径，从架构级保证了状态一致性。
- **动态端口 + Token Bootstrap 是否可落地？** **可落地且是最佳实践。** 通过 `127.0.0.1:<port>/?token=<token>` 引导并用 `history.replaceState` 抹除 URL Token，优雅解决了多实例端口冲突问题，且有效防御了本地恶意网页的 CSRF 攻击。
- **依赖分层是否合理？** **合理。** Baseline 极简，高阶能力（如图表、终端、复杂表格）被严格 Feature Gate 到 P4 阶段，依赖管理非常健康。
- **实施切片和验证是否足够？** 阶段划分合理，但验证层面对 E2E 测试的覆盖略显单薄，强依赖人工 Smoke Test，长远看有疲劳漏测风险（见下方 Should Fix）。

---

## 2. Review Findings (Must / Should / Nit)

### [Must Fix] Bootstrap 与 Sidecar 崩溃恢复机制缺失
**发现：** Section 4 的动态端口和 Per-launch token 设计很安全，但未考虑 Node App Server (Sidecar) 异常崩溃的情况。
**建议：** 如果 Node 进程崩溃后被 Tauri 重新拉起，必然会生成新的动态端口和 Token。此时前端 React UI 会因为旧 Token 失效或连接被拒绝而彻底“死锁”。必须在 P1.2 或 P3.1 中补充**重连与重载策略**（例如：API 返回网络级错误或 401 时，Tauri 能捕获侧边车重启事件并主动 Reload Webview 进行二次 Bootstrap，或前端给出明确的“服务重启中”错误提示）。

### [Must Fix] Mutation 调用的性能预期与锁说明
**发现：** Section 3 提到 App Server "invokes the app-bundled CLI/runtime for allowed mutations"。
**建议：** 需要在方案中明确这里的 invoke 方式。如果是以 Child Process (spawn) 的形式执行 CLI，高频操作（如快速重试阶段、频繁变更配置）会带来明显的进程启动开销和 UI 延迟。方案需明确 App Server 是直接 require `packages/runtime` 核心库执行，还是基于子进程执行；若是后者，React 前端必须被强制要求实现健壮的 Optimistic UI 或清晰的 Loading 过渡态。

### [Should Fix] P2 阶段的双线维护与“旧代码冻结”声明
**发现：** P2.Z 提出 "remove old embedded frontend paths only after React parity is proven"。
**建议：** 这意味着在长达数个 Sprint 的 P2 期间，团队需要同时维护两套 UI。为了避免无底洞，建议在 Plan 中增加明确的策略约束：**进入 P2 即触发旧版 UI 的 Feature Freeze**。旧版仅修复 P0 崩溃，所有新需求或 UX 优化仅在新 React 栈上实现。

### [Should Fix] 引入自动化的 E2E 回归测试
**发现：** Section 7 的验证策略强依赖 `npm test` 和手动的人工冒烟测试 (desktop viewport smoke)。
**建议：** 作为一个涉及 Rust Shell、Node Sidecar 和 React UI 的三层复合应用，仅靠单元测试和人工验收极易退化。建议在 P2 核心链路打通后（即 P2.Z 阶段），引入类似 Playwright 的端到端测试，针对核心 User Journey（打开应用 -> 查看最新 Run -> 查看 Artifact -> 触发一次 Action）编写自动化断言，替代低效的人工回归。

### [Nit] 强制的 tsconfig 目录隔离
**发现：** Section 5 的 Source Layout 拆分了 `src/server/` 和 `src/frontend/`。
**建议：** 建议在计划中明确：这两个目录必须拥有独立的 `tsconfig.node.json` 和 `tsconfig.web.json`。通过编译链严格阻断前端代码意外 `import` Node 模块（如 `fs`、`path` 或后端专用的配置模型实体）的可能性，从物理层面落实 "React UI talks only to App Server APIs"。

---

## 3. Final Recommendation

**Verdict: Ready**

**总结：** Plan C 是一个极其务实、架构边界定义严谨的优秀方案。其对重型依赖的克制（Deferred 策略）和对大爆炸重构的规避（分段验证对等性）展示了成熟的工程化考量。在稍微补充容灾恢复策略 (Sidecar 重启) 和构建层隔离约束后，即可直接投入 P1 阶段的实施。

---
_used_: mode=无 · skills=无 · tools=update_topic, read_file
