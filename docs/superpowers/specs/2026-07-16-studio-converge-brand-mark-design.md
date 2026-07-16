# Studio Converge 品牌标记设计

## 目标

Studio 左上角直接使用 AgentMesh Desktop 已批准的 Converge 图标，不再维护另一套圆芯/双轨道品牌标记。应用图标、分发资产和产品内品牌保持同一视觉来源。

## 唯一资产源

`apps/studio-desktop/src-tauri/icons/agentmesh.svg` 继续作为唯一可编辑品牌源。Studio 不复制 SVG、不内联第二份 path markup，也不把生成的 PNG 当作源文件。

`StudioBrandMark.tsx` 通过 Vite `?url` 导入该 SVG，并渲染为装饰性 `<img>`。Vite dev server 只额外允许读取 canonical icon 所在目录；production build 将 SVG 作为带 hash 的 frontend asset 输出，Tauri 沿用现有 frontend bundle 打包流程。

## 组件与样式

- 保留 `StudioBrandMark(): ReactElement` 和 `.studio-brand-mark`，避免改变 `App.tsx` 的品牌区结构。
- 删除 `.studio-brand-core`、`.studio-brand-track`、`.studio-brand-track-a`、`.studio-brand-track-b` 及对应 DOM。
- 图标使用 canonical SVG 自带的浅色圆角底板和四色 Converge 几何，不叠加新渐变、边框或第二套图形。
- 导航内尺寸保持约 `44 x 44`，使用 `object-fit: contain`，在银灰 shell 中保持清晰且不挤压标题。
- 图标为装饰内容：`alt=""`、`aria-hidden="true"`、不可拖拽；页面的可访问名称仍由 `AgentMesh` 标题提供。

## 失败边界

canonical SVG 缺失或导入失败时应让 frontend build 失败，不使用静默 fallback，以免再次产生品牌漂移。该改动不触及路由、API、状态机、Desktop updater 或应用图标生成流程。

## 验证

- Node contract 断言 `StudioBrandMark` 引用 canonical `agentmesh.svg?url`，包含装饰性 `<img>`，且旧 core/track DOM 与 CSS 已删除。
- 现有 canonical icon contract 继续锁定 Converge 几何与配色。
- `npm run build`、完整 `studio-ui` 测试和 `git diff --check` 通过。
- 在 `1280 x 720` 与 `1024 x 640` 检查左上角图标清晰、未裁切、与 Desktop 图标一致；console error 为 0。

## 非目标

- 不修改 Converge 图标本身。
- 不重新生成 PNG、ICNS 或 ICO。
- 不改变导航布局、标题、主题色或其他 Studio 控件。
