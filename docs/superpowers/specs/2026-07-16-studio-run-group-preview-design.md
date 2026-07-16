# Studio 运行分组预览设计

## 目标

强化运行导航中的日期分组层级，并在日期分组内部增加独立的 5 条预览控制。日期组头原有的“整组展开/隐藏”行为保持不变；大分组展开后默认显示前 5 条，在第 5 条下方提供显示全部的按钮。

## 已批准视觉

- 日期组头保持 `36px`，使用无边框的轻量文件树结构。
- Unicode 三角形替换为 `18px` SVG chevron，并增加 `18px` 日历轮廓图标；统一 stroke 与光学对齐。
- 日期名称使用 `16px / 700`，避免与运行标题同时使用重黑字重。
- 计数改为低对比度纯数字，不使用圆形 Badge 或背景胶囊。
- 组内预览控制改为无边框文本行，搭配轻量上下箭头；不使用虚线框。
- 运行条目默认无边框；选中项只使用柔和灰青实心背景，不使用青色粗描边、内描边或左侧色条。

## 两层展开行为

两套状态必须独立：

1. 日期组头沿用原有 `collapsedGroups`。所有日期 header 都可点击；向下箭头表示整组已展开，向右箭头表示整组隐藏。折叠时该组的运行与组内预览按钮全部隐藏。
2. 组内列表使用独立 `expandedItemGroups`。展开的日期组若超过 `ACTIVITY_GROUP_PREVIEW_LIMIT = 5`，默认只渲染前 5 条，并在第 5 条下面显示 `展开其余 N 条`。

点击 `展开其余 N 条` 后显示该组全部运行，按钮移动到全部运行的下方并变成 `收起到 5 条`；再次点击回到前 5 条。日期组头的折叠/展开不重置组内状态，保证用户重新打开日期分组时保持刚才的选择。

5 条及以内不显示组内预览按钮。搜索 query 非空时显示全部匹配运行，并隐藏组内预览按钮，避免筛选结果被截断。

## 组件边界

- `ActivityNavigator` 使用 `collapsedGroups` 管理整组可见性，使用 `expandedItemGroups` 管理前 5 条/全部。
- 纯函数 `visibleActivityGroupItems(items, expanded, query)` 集中表达 5 条预览、显示全部和搜索例外。
- `NavGroupToggle` 保持所有日期分组都是 button，保留 `aria-expanded` 与 `data-nav-group`。
- `NavGroupMoreButton` 只负责 `展开其余 N 条` / `收起到 5 条` 的组内切换。
- `styles.css` 使用 `.studio-nav-group-header`、`.studio-nav-group-chevron`、`.studio-nav-group-calendar`、`.studio-nav-group-label`、`.studio-nav-group-count` 与 `.studio-nav-group-more`。
- 运行与调用统一投影到 `ActivityNavigator`；数据主键、详情请求、AppShell 与 updater 均不变。

## 可访问性

- 日期 header 的 `aria-expanded` 只表达整组是否隐藏，不表达组内是否显示全部。
- 组内预览按钮使用真实 button，文案包含隐藏数量；展开后明确显示 `收起到 5 条`。
- 箭头使用 `aria-hidden="true"`，不依赖颜色单独表达状态。
- 两类按钮都保留清晰的 hover 和 focus-visible。

## 验证

- 纯函数先 RED 后 GREEN：7 条默认返回 5 条，showAll 返回 7 条，非空 query 返回全部，5 条输入保持 5 条。
- 源码/SSR contract 锁定两层状态、SVG chevron/calendar、纯数字计数、底部按钮两种文案、18px icons、16px/700 label、36px header 与柔和选中背景。
- 聚焦测试后运行完整 `npm test`、Desktop dev package 与 `git diff --check`。
- `4317` 页面验证：日期 header 仍可隐藏/显示整组；26 条分组默认 5 条；第 5 条下方展开全部；全部列表底部可收回 5 条；搜索不截断匹配项；console error 0。
- 与精简品牌栏合并为同一 UI slice，验证后恢复 `0.1.12` 发布。

## 非目标

- 不增加可配置预览数量或持久化。
- 不新增分页 API、虚拟列表或动画依赖。
- 不修改运行/调用的后端数据模型与详情接口。
