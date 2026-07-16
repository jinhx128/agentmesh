# Studio 精简品牌栏设计

## 目标

将 Studio 左上角品牌区收敛为参考图式的单行紧凑 header：左侧只使用文字品牌，右侧并排放置设置与手册图标按钮。减少当前图标、标题和下一行全宽文字按钮造成的视觉重量，同时保持所有导航行为与可访问性不变。

## 已批准结构

品牌面板保留现有 `data-studio-section="workspace-brand"`，内部改为一个不换行的水平布局：

- 左侧是两行、左对齐的文字 stack：主标题 `AgentMesh`，副标题固定为 `编排你的Agent`。
- 主标题约 `22px`，使用现有深色 ink；副标题约 `13px`，使用 muted 色，不增加产品名或版本信息。
- 右侧是设置与手册两个 `30 x 30` 的 Mantine `ActionIcon`，间距紧凑，视觉上与参考图的方形工具按钮一致。
- 当前页面对应按钮使用青蓝浅色选中态；非当前按钮使用中性表面和边框。

品牌区不再显示任何 logo。Desktop 应用图标和分发资产保持不变，只移除 Studio 页面内的品牌图片。

## 图标与交互

项目当前没有独立图标依赖，本次不引入新依赖。两个按钮直接使用轻量内联 SVG：

- 设置：简洁齿轮轮廓。
- 手册：简洁打开的书本轮廓。

SVG 使用 `currentColor`、`fill="none"` 和一致的 stroke，尺寸约 `16 x 16`，不承担独立可访问名称。每个 `ActionIcon` 保留明确的 `title`、`aria-label`、`aria-pressed`、键盘焦点和现有 click handler；品牌区继续使用 `nav` 与现有 `viewNavigation` 可访问名称。

## 代码边界

- `App.tsx` 删除 `StudioBrandMark` import 和渲染，保留 `workspaceView`、设置/手册切换及所有其他导航状态。
- 删除不再使用的 `StudioBrandMark.tsx`。
- `styles.css` 删除 `.studio-brand-mark` 和旧品牌按钮的全宽样式，增加文字 stack、subtitle 和 icon action 样式；窄屏仍保持同一行，不重新堆叠成两行按钮。
- `vite.config.ts` 移除只为读取 canonical SVG 增加的 filesystem allow；Vite dev server 恢复只允许 `studioRoot`。
- canonical `apps/studio-desktop/src-tauri/icons/agentmesh.svg` 及 PNG、ICNS、ICO 均不修改。
- 不改变 AppShell 宽度、路由、API、状态机、Desktop updater 或发布版本。

## 响应式与失败边界

在现有 `300px` sidebar 内，品牌文字允许收缩但不覆盖右侧按钮；按钮固定尺寸且不换行。`1024 x 640` 与 `1280 x 720` 下标题、副标题和两个按钮必须完整可见，无横向溢出或裁切。

若内联 SVG markup 无法构建，应让 TypeScript/Vite 构建失败，不使用 emoji、Unicode glyph 或外部网络图标作为 fallback，以避免跨平台视觉漂移。

## 验证

- Node 静态渲染 contract 先 RED：要求副标题、两个 `ActionIcon`、`aria-label`/`aria-pressed` 与新 class，禁止 `StudioBrandMark` 和 `studio-brand-mark`。
- GREEN 后执行聚焦 Studio shell 测试、完整 `npm test`、`npm run studio-desktop:package:dev` 与 `git diff --check`。
- production Vite 输出不再包含品牌 SVG asset；canonical Desktop icon contract 继续通过。
- in-app browser 在 `1280 x 720` 与 `1024 x 640` 验收文字左对齐、按钮右对齐、选中态、无裁切/横向溢出且 console error 为 0。
- 视觉与自动化通过后，重新生成全部 `0.1.12` 签名发布产物；此前中止的构建结果不得复用。

## 非目标

- 不增加副标题编辑、国际化切换或品牌配置项。
- 不修改设置页、手册页内容或导航目标。
- 不重新设计 Desktop 应用图标。
- 不引入图标库、动画或新的 UI 依赖。
