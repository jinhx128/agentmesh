# Studio 运行分组预览实施计划

> 状态（2026-07-16）：已合并。两层展开和轻量文件树实现将由统一 `ActivityNavigator` 吸收；剩余视觉、日志和提交步骤迁入 `2026-07-16-studio-activity-and-v012-release.md`，本文件不再维护独立“当前下一步”。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留日期组头的整组折叠功能，并在展开的分组内部增加默认 5 条、底部展开全部/收回 5 条的独立控制。

**Architecture:** `collapsedGroups` 继续管理整组显示，新增 `expandedItemGroups` 管理组内前 5 条/全部。纯函数负责裁剪；日期 header 与底部 more button 使用不同状态和可访问语义。

**Tech Stack:** React 19、TypeScript 5.9、Mantine 9、CSS、Node.js `node:test`

## Global Constraints

- 日期组头原有折叠/展开行为必须保持，所有组头都是 button。
- `RUN_GROUP_PREVIEW_LIMIT = 5`；超过 5 条时第 5 条下方显示 `展开其余 N 条`。
- 展开全部后，按钮移动到列表底部并显示 `收起到 5 条`。
- 搜索非空时显示全部匹配项并隐藏 more button。
- 日期 header `36px`、日期 `16px/700`、SVG chevron/calendar `18px`、纯数字计数。
- 运行选中态使用柔和实心背景；禁止青色粗描边、左侧色条和 more button 虚线框。
- 与精简品牌栏作为同一 UI slice 验证提交，不改变 API、Call navigator、updater 或版本。

---

### Task 1: 修正两层状态与底部预览按钮

**Files:**
- Modify: `tests-node/studio-ui.test.ts`
- Modify: `apps/studio-web/src/features/runs/RunNavigator.tsx`

- [x] **Step 1: 写 RED 行为 contract**

保留纯函数 7→5 测试，并增加：

```ts
assert.match(runNavigatorSource, /const \[collapsedGroups, setCollapsedGroups\]/);
assert.match(runNavigatorSource, /const \[expandedItemGroups, setExpandedItemGroups\]/);
assert.match(runNavigatorSource, /className="studio-nav-group-more"/);
assert.match(runNavigatorSource, /`展开其余 \$\{hiddenCount\} 条`/);
assert.match(runNavigatorSource, /`收起到 \$\{RUN_GROUP_PREVIEW_LIMIT\} 条`/);
assert.match(runNavigatorSource, /collapsed \? null :/);
assert.match(runs, /<button[^>]*data-nav-group=/);
assert.match(runs, /aria-expanded="true"/);
```

用同日期 7 条 fixture 静态渲染，断言只出现 `preview-run-1` 到 `preview-run-5`，不出现 `preview-run-6/7`，且出现 `展开其余 2 条`。

- [x] **Step 2: 运行 RED**

```bash
npm run build:node
node --test --test-name-pattern "Run groups preview five items|Run and call navigators" \
  dist-node/tests-node/studio-ui.test.js
```

Expected: FAIL，当前错误实现只有 `expandedGroups`，小组 header 不是 button，也没有底部 more button。

- [x] **Step 3: 写最小实现**

恢复两套状态：

```ts
const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
const [expandedItemGroups, setExpandedItemGroups] = useState<Set<string>>(() => new Set());
```

每组计算：

```ts
const collapsed = collapsedGroups.has(group.date);
const showAllItems = expandedItemGroups.has(group.date);
const visibleRuns = visibleRunGroupRuns(group.runs, showAllItems, query);
const showMoreControl = query.trim().length === 0
  && group.runs.length > RUN_GROUP_PREVIEW_LIMIT;
const hiddenCount = group.runs.length - RUN_GROUP_PREVIEW_LIMIT;
```

`NavGroupToggle` 恢复 `collapsed` prop、`aria-expanded={!collapsed}` 和原 `toggleGroup`。运行与 more button 都放在 `collapsed ? null : (...)` 内。新增：

```tsx
function NavGroupMoreButton({ expanded, hiddenCount, onToggle }: {
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
}): ReactElement {
  return (
    <Button
      className="studio-nav-group-more"
      variant="subtle"
      color="gray"
      fullWidth
      size="xs"
      type="button"
      onClick={onToggle}
    >
      {expanded
        ? `收起到 ${RUN_GROUP_PREVIEW_LIMIT} 条`
        : `展开其余 ${hiddenCount} 条`}
    </Button>
  );
}
```

- [x] **Step 4: 运行 GREEN**

```bash
npm run build:node
node --test --test-name-pattern "Run groups preview five items|Run and call navigators" \
  dist-node/tests-node/studio-ui.test.js
git diff --check
```

Expected: 2/2 PASS。

进度记录：修正后的 RED 同时证明小分组 header 被错误改成静态 div，且 7 条预览缺少 `展开其余 2 条`。恢复 `collapsedGroups`、增加 `expandedItemGroups` 与 `NavGroupMoreButton` 后，两层状态源码/SSR contract GREEN。

### Task 2: 改为轻量文件树视觉

**Files:**
- Modify: `tests-node/studio-ui.test.ts`
- Modify: `apps/studio-web/src/features/runs/RunNavigator.tsx`
- Modify: `apps/studio-web/src/styles.css`

- [x] **Step 1: 写 RED 视觉 contract**

```ts
assert.match(runNavigatorSource, /className="studio-nav-group-header studio-nav-group-toggle"/);
assert.doesNotMatch(runNavigatorSource, /if \(!expandable\)/);
assert.match(runNavigatorSource, /className="studio-nav-group-chevron"/);
assert.match(runNavigatorSource, /className="studio-nav-group-calendar"/);
assert.match(runNavigatorSource, /className="studio-nav-group-count"/);
assert.match(runNavigatorSource, /className="studio-nav-group-more-icon"/);
assert.doesNotMatch(runNavigatorSource, /"▸"|"▾"|<Badge/);
assert.match(frontendCss, /\.studio-nav-group-chevron,[\s\S]*\.studio-nav-group-calendar\s*\{[^}]*width:\s*18px;/s);
assert.match(frontendCss, /\.studio-nav-group-label\s*\{[^}]*font-size:\s*16px;[^}]*font-weight:\s*700;/s);
assert.match(frontendCss, /\.studio-nav-group-more\s*\{/);
assert.match(frontendCss, /\.studio-nav-item\[aria-current="true"\]\s*\{[^}]*border-color:\s*transparent[^}]*background:\s*#e9edf2[^}]*box-shadow:\s*none/s);
assert.doesNotMatch(frontendCss, /\.studio-nav-item\[aria-current="true"\]::before/);
```

- [x] **Step 2: 运行 RED**

Run focused navigator tests；Expected: FAIL on Unicode arrow、Badge、重字重、虚线 more button 与青色描边选中态。

- [x] **Step 3: 写最小 DOM/CSS 修复**

- 用 inline SVG chevron + calendar 替换 Unicode 箭头，均为 18px、`currentColor` stroke。
- 用 `.studio-nav-group-count` Text 替换 Badge，日期降到 `16px/700`。
- more button 改成无边框文本行并加入 SVG 上下箭头。
- RunButton 标题降到 `700`；选中态改为 `#e9edf2` 实心背景，无 border、shadow、左侧色条。

- [x] **Step 4: 运行 GREEN**

```bash
npm run build
node --test --test-name-pattern "Run groups preview five items|Run and call navigators" \
  dist-node/tests-node/studio-ui.test.js
git diff --check
```

Expected: 2/2 PASS，frontend build 通过。

进度记录：日期 header 已恢复为所有分组均可点击的 36px Button，`aria-expanded` 只表达整组状态；箭头提升到 20px，日期为 15px/900，Badge 为 sm，底部 more button 具备展开/收回两种文案与 hover。聚焦测试 2/2、frontend build 与 `git diff --check` 通过。

### Task 3: 视觉验收、完整回归、日志与提交

- [ ] **Step 1: 刷新 `4317` 验收两层交互**

验证日期组头仍整组隐藏/显示；26 条组默认 5 条；第 5 条下方展开全部；全部底部收回 5 条；搜索不截断；SVG 图标、轻量选中态与品牌栏最终外观正确。

- [ ] **Step 2: 完整回归**

```bash
npm test
npm run studio-desktop:package:dev
git diff --check
```

- [ ] **Step 3: 同步 changelog、三个实施计划和总发布计划**

历史要求为记录视觉与自动化证据；该步骤现已迁入统一总计划，不再从本文件恢复发布下一步。

- [ ] **Step 4: 提交合并 UI slice**

```bash
git add apps/studio-web/src tests-node/studio-ui.test.ts \
  apps/studio-web/vite.config.ts changelog/2026-07-16.md \
  docs/superpowers/specs/2026-07-16-studio-compact-brand-header-design.md \
  docs/superpowers/specs/2026-07-16-studio-run-group-preview-design.md \
  docs/superpowers/plans/2026-07-16-studio-compact-brand-header.md \
  docs/superpowers/plans/2026-07-16-studio-run-group-preview.md \
  docs/superpowers/plans/2026-07-16-studio-silver-interface-release.md
git diff --cached --check
git commit -m "界面：收敛 Studio 品牌栏与运行分组"
```

完成定义：两层展开语义、组内 more button、20px 箭头、精简品牌栏、RED/GREEN、视觉验收、完整回归和日志全部完成；随后重新生成 `0.1.12` 资产。
