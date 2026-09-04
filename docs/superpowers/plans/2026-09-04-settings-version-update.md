# 关于页“版本与更新”整合实施计划

> 按 `docs/superpowers/specs/2026-09-04-settings-version-update-design.md` 执行；采用 TDD，先验证失败，再做最小实现。

**目标：** 将 AgentMesh CLI 与桌面应用的版本、状态、更新操作收敛到关于页的一张“版本与更新”卡片，并让环境页只保留 Agent Skill 与外部 Provider CLI。

**架构：** 复用 `StudioUpdateReport`、`StudioIntegrationsReport.command_line_tool` 和 `DesktopAppUpdaterState`。`App` 组合数据和统一刷新动作，`SettingsAboutPanel` 负责一个无嵌套卡片的双分区视图，`AgentIntegrationsPanel` 不再消费 AgentMesh CLI 状态或安装动作。后端契约不变。

**约束：** 工作区已有大量未提交修改；仅做本需求所需的局部编辑，不回退、不清理、不覆盖其他改动。用户已明确允许直接在 `main` 工作。

## Task 1：先更新 UI 与刷新契约测试

**文件：** `tests-node/studio-ui.test.ts`

- [ ] 关于页断言同一卡片内存在“AgentMesh CLI”和“桌面应用”分区，且只保留一个“重新检查”入口和一个总状态。
- [ ] 断言 CLI 分区展示已安装版本、最新版本、安装路径、状态和安装/更新/重装操作，不显示原始来源或安装命令。
- [ ] 断言桌面分区保留 native updater 状态、安装并重启、进度、错误和自动检测设置，不再存在独立 `desktop-app-updater` 卡片。
- [ ] 环境页断言只保留 Agent Skill 与“外部 CLI”，默认选中 Agent Skill，不存在“命令行工具”页签。
- [ ] 对 `App.tsx` 增加统一刷新契约：并发刷新可用数据源、共享 busy 锁、保留旧数据、一次汇总 toast；部分失败不阻断成功数据落盘。
- [ ] 运行定向测试并确认因缺少新实现而失败。

## Task 2：迁移 AgentMesh CLI 到关于页

**文件：** `apps/studio-web/src/features/settings/SettingsAboutPanel.tsx`、`apps/studio-web/src/features/settings/AgentIntegrationsPanel.tsx`、`apps/studio-web/src/app/copy.ts`

- [ ] 扩展 `SettingsAboutPanelProps`，只传入 `commandLineTool` 数据和安装回调，不依赖完整 integrations report。
- [ ] 将关于页两张更新卡片合成一张卡片：统一标题栏、总状态徽标、CLI 分区、桌面应用分区和自动检测开关。
- [ ] 移除四宫格摘要、独立“应用更新”标题/徽标/检查按钮、CLI source/命令与桌面下载 URL。
- [ ] 环境页删除 AgentMesh CLI 页签及相关安装状态，默认页签改为 `skills`，可见文案“CLI 检测”改为“外部 CLI”。
- [ ] 保持外部 CLI 检测和 Agent Skill 安装逻辑不变。

## Task 3：实现统一刷新与局部失败

**文件：** `apps/studio-web/src/app/App.tsx`

- [ ] 将现有发布版本刷新、集成刷新和桌面 updater 检查组合为一个 `refreshVersionAndUpdates`。
- [ ] 使用共享 ref/state 防止重复点击；刷新时保留既有报告，不把页面重置为空白。
- [ ] 三个可用检查并发执行；各自仍负责成功数据落盘，单项失败不清空其他结果。
- [ ] 全部成功仅显示一次“更新状态已刷新”；存在失败仅显示一次“部分更新状态检查失败”。
- [ ] CLI 安装成功后刷新 CLI 分区，失败保留现有信息并显示 toast。

## Task 4：样式收口

**文件：** `apps/studio-web/src/styles.css`

- [ ] 使用同一卡片内的普通分区、分隔线和响应式网格，不嵌套 Card。
- [ ] 桌面宽度下信息与操作左右分布；窄屏按顺序堆叠，路径和错误文本可换行。
- [ ] 复用现有设计 token，避免新增重复阴影和深色底块。

## Task 5：验证、打包和本机安装

- [ ] 运行 `npm run build:node && node --test dist-node/tests-node/studio-ui.test.js`。
- [ ] 运行 `npm test`、`npm run build:studio-frontend` 和 `git diff --check`。
- [ ] 运行 Desktop packaging smoke，构建当前源码对应的 macOS 应用。
- [ ] 安装到 `/Applications/AgentMesh.app`，校验版本、签名和进程，并打开关于页供用户验收。
- [ ] 最后复查实际 diff 范围；本轮不自动提交混合源码改动，除非用户明确要求提交。
