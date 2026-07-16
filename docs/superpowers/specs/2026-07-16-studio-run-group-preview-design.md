# Studio 运行分组预览设计

## 目标

强化运行导航中的日期分组层级，并限制大分组的默认长度。用户进入 Studio 时能快速浏览多个日期，而不是被单个含十余条运行的分组占满侧栏；需要时可直接点击分组标题展开全部。

## 已批准视觉

- 分组 header 高度从 `30px` 提升到 `36px`。
- 日期名称使用约 `15px`、`font-weight: 900`，与组内 `14px` 运行标题形成明确层级。
- 日期前的展开箭头独立为 `16px`、较粗字重，与标题保持约 `6px` 间距，不再继承小号 dimmed 文本尺寸。
- 计数 Badge 继续显示分组总数，尺寸从 `xs` 提升到 `sm`。
- header 保持整行点击区域和现有 hover/focus 反馈，不增加第二个展开按钮。

## 预览与展开行为

常量 `RUN_GROUP_PREVIEW_LIMIT` 固定为 `5`：

- 空查询下，超过 5 条的日期分组默认只渲染最新 5 条，箭头向右。
- 点击整个分组 header 后渲染该组全部运行，箭头向下，`aria-expanded="true"`。
- 再次点击收回前 5 条，`aria-expanded="false"`。
- 5 条及以内始终完整显示，不提供无意义的展开/收起操作，也不把静态 header 暴露为按钮。
- 搜索 query 非空时显示全部匹配运行，不应用 5 条截断，保证筛选结果不会被隐藏。

分组内顺序继续沿用 App Server 提供的运行顺序；本改动不重新排序、不改变当前选择或数据请求。

## 组件边界

- `RunNavigator.tsx` 将现有 `collapsedGroups` 改为 `expandedGroups`，状态仍以日期字符串为 key。
- 增加纯函数 `visibleRunGroupRuns(runs, expanded, query)`，集中表达 5 条预览、全部展开和搜索例外，便于真实数据单测。
- `NavGroupToggle` 收敛为支持可点击/静态两种语义的 group header；只有 `count > 5` 且 query 为空时可点击。
- `styles.css` 使用 `.studio-nav-group-header`、`.studio-nav-group-icon`、`.studio-nav-group-label` 和现有 Badge selector 建立视觉层级。
- Call navigator、运行条目、搜索输入、刷新、自动刷新、AppShell 和 API 不变。

## 可访问性

- 可展开 header 使用原生 button/Mantine button 语义，保留 `data-nav-group`，并提供正确的 `aria-expanded`。
- 5 条及以内的静态 header 不进入 Tab 顺序，不伪装成可点击控件。
- 箭头只表达视觉状态，使用 `aria-hidden="true"`；日期名称和总数仍由 header 文本与 Badge 提供。
- focus-visible 必须清晰；不依赖颜色单独表达展开状态。

## 验证

- 纯函数先 RED 后 GREEN：7 条默认返回 5 条，expanded 返回 7 条，非空 query 返回全部匹配条目，5 条输入保持 5 条。
- 静态 render contract 断言 `RUN_GROUP_PREVIEW_LIMIT = 5`、`expandedGroups`、两种 header 语义、`aria-expanded`、16px icon、15px label、36px header 和 `sm` Badge。
- 聚焦 Run navigator 测试通过后，运行完整 `npm test`、Desktop dev package 和 `git diff --check`。
- 在现有 `4317` 页面确认大分组默认只显示 5 条、点击后显示全部/再次收回，搜索不截断匹配项；检查 console error 为 0。
- 本改动与已完成但尚未提交的精简品牌栏合并为同一 UI slice，验证后再恢复 `0.1.12` 发布流程。

## 非目标

- 不增加用户可配置的预览数量。
- 不把分组展开状态写入 localStorage、配置文件或 URL。
- 不新增虚拟列表、分页 API 或动画依赖。
- 不修改 Call navigator 的数据结构或分组方式。
