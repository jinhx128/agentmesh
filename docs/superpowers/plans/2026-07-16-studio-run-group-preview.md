# Studio 运行分组预览实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 放大运行日期分组的标题与展开箭头，并让超过 5 条的分组默认仅显示前 5 条、点击后显示全部。

**Architecture:** 在 `RunNavigator.tsx` 增加纯函数统一裁剪规则，用 `expandedGroups` 记录大分组的显式展开状态；搜索时绕过裁剪。大分组渲染可点击 header，小分组渲染静态 header；CSS 只调整运行分组视觉，不影响 Call navigator。

**Tech Stack:** React 19、TypeScript 5.9、Mantine 9、CSS、Node.js `node:test`

## Global Constraints

- `RUN_GROUP_PREVIEW_LIMIT` 固定为 `5`，不增加配置项或持久化。
- 空查询的大分组默认前 5 条；点击 header 在前 5 条与全部之间切换。
- 5 条及以内始终全部显示且 header 不进入 Tab 顺序。
- 非空搜索显示全部匹配项，不隐藏筛选结果。
- 组头 `36px`、日期 `15px/900`、展开箭头 `16px`、Badge `sm`。
- 展开箭头 `aria-hidden`，可点击 header 保留 `aria-expanded` 和 `data-nav-group`。
- 不修改运行排序、选择、API、Call navigator、AppShell、updater 或 `0.1.12` 版本。
- 与当前未提交的精简品牌栏作为同一 UI slice 验证和提交。

---

### Task 1: 实现每组前 5 条预览与展开状态

**Files:**
- Modify: `tests-node/studio-ui.test.ts`
- Modify: `apps/studio-web/src/features/runs/RunNavigator.tsx`

**Interfaces:**
- Produces: `RUN_GROUP_PREVIEW_LIMIT = 5`。
- Produces: `visibleRunGroupRuns(runs: StudioRunSummary[], expanded: boolean, query: string): StudioRunSummary[]`。
- Consumes: 现有日期分组顺序与 `query`。

- [ ] **Step 1: 写 RED 纯函数 contract**

在 RunNavigator import 中加入 `RUN_GROUP_PREVIEW_LIMIT` 与 `visibleRunGroupRuns`，新增测试：

```ts
test("Run groups preview five items until explicitly expanded", () => {
  const runs = Array.from({ length: 7 }, (_, index) => ({
    ...studioRunSummariesFixture()[0],
    run_id: `preview-run-${index + 1}`,
  }));

  assert.equal(RUN_GROUP_PREVIEW_LIMIT, 5);
  assert.deepEqual(
    visibleRunGroupRuns(runs, false, "").map((run) => run.run_id),
    runs.slice(0, 5).map((run) => run.run_id),
  );
  assert.equal(visibleRunGroupRuns(runs, true, "").length, 7);
  assert.equal(visibleRunGroupRuns(runs, false, "preview").length, 7);
  assert.equal(visibleRunGroupRuns(runs.slice(0, 5), false, "").length, 5);
});
```

- [ ] **Step 2: 运行 RED**

Run: `npm run build:node`

Expected: TypeScript FAIL，报告两个新 export 尚不存在。

- [ ] **Step 3: 写最小纯函数与状态实现**

```ts
export const RUN_GROUP_PREVIEW_LIMIT = 5;

export function visibleRunGroupRuns(
  runs: StudioRunSummary[],
  expanded: boolean,
  query: string,
): StudioRunSummary[] {
  if (expanded || query.trim().length > 0) {
    return runs;
  }
  return runs.slice(0, RUN_GROUP_PREVIEW_LIMIT);
}
```

将 `collapsedGroups` 改为 `expandedGroups`。每组计算：

```ts
const expandable = query.trim().length === 0
  && group.runs.length > RUN_GROUP_PREVIEW_LIMIT;
const expanded = expandable && expandedGroups.has(group.date);
const visibleRuns = visibleRunGroupRuns(group.runs, expanded, query);
```

`toggleGroup(date)` 在 `expandedGroups` 中添加/删除日期；列表始终渲染 `visibleRuns.map(...)`。把 header props 改为 `expanded` 与 `expandable`，Task 2 再收敛语义和 CSS。

- [ ] **Step 4: 运行 GREEN**

```bash
npm run build:node
node --test --test-name-pattern "Run groups preview five items" \
  dist-node/tests-node/studio-ui.test.js
git diff --check
```

Expected: 1/1 PASS；diff check 无输出。

### Task 2: 放大分组 header 并区分可点击/静态语义

**Files:**
- Modify: `tests-node/studio-ui.test.ts`
- Modify: `apps/studio-web/src/features/runs/RunNavigator.tsx`
- Modify: `apps/studio-web/src/styles.css`

**Interfaces:**
- Consumes: Task 1 的 `expandable`、`expanded` 与 `onToggle`。
- Produces: `.studio-nav-group-header`、`.studio-nav-group-toggle`、`.studio-nav-group-icon`、`.studio-nav-group-label`。

- [ ] **Step 1: 写 RED DOM/CSS contract**

```ts
assert.match(runNavigatorSource, /const \[expandedGroups, setExpandedGroups\]/);
assert.match(runNavigatorSource, /RUN_GROUP_PREVIEW_LIMIT = 5/);
assert.match(runNavigatorSource, /className="studio-nav-group-header studio-nav-group-toggle"/);
assert.match(runNavigatorSource, /className="studio-nav-group-header"/);
assert.match(runNavigatorSource, /className="studio-nav-group-icon"/);
assert.match(runNavigatorSource, /className="studio-nav-group-label"/);
assert.match(runNavigatorSource, /aria-expanded=\{expanded\}/);
assert.match(runNavigatorSource, /<Badge size="sm"/);
assert.match(frontendCss, /\.studio-nav-group-header\s*\{[^}]*min-height:\s*36px;/s);
assert.match(frontendCss, /\.studio-nav-group-icon\s*\{[^}]*font-size:\s*16px;/s);
assert.match(frontendCss, /\.studio-nav-group-label\s*\{[^}]*font-size:\s*15px;[^}]*font-weight:\s*900;/s);
```

更新现有 SSR 断言：小分组不再输出 `aria-expanded`；Call navigator 的 `aria-expanded="true"` 断言保持不变。

- [ ] **Step 2: 运行 RED**

```bash
npm run build:node
node --test --test-name-pattern "Run and call navigators" \
  dist-node/tests-node/studio-ui.test.js
```

Expected: FAIL，缺少新 header classes、尺寸与静态小分组语义。

- [ ] **Step 3: 写最小 header 实现**

`NavGroupToggle` 增加 `expandable`。大分组返回：

```tsx
<Button
  className="studio-nav-group-header studio-nav-group-toggle"
  variant="subtle"
  color="gray"
  fullWidth
  h={36}
  px={6}
  type="button"
  aria-expanded={expanded}
  data-nav-group={label}
  onClick={onToggle}
>
  {content}
</Button>
```

5 条及以内返回不带 button/`aria-expanded` 的：

```tsx
<Group className="studio-nav-group-header" h={36} px={6} data-nav-group={label}>
  {content}
</Group>
```

共享 content：

```tsx
<Group justify="space-between" gap="xs" wrap="nowrap" w="100%">
  <Group gap={6} wrap="nowrap" miw={0}>
    <Text className="studio-nav-group-icon" component="span" aria-hidden="true">
      {expandable ? (expanded ? "▾" : "▸") : "▾"}
    </Text>
    <Text className="studio-nav-group-label" component="span" truncate="end">{label}</Text>
  </Group>
  <Badge size="sm" variant="light">{count}</Badge>
</Group>
```

- [ ] **Step 4: 写最小 CSS**

```css
.studio-nav-group-header {
  width: 100%;
  min-height: 36px;
  border-radius: 8px;
  color: var(--studio-muted);
}

.studio-nav-group-icon {
  flex: 0 0 16px;
  font-size: 16px;
  font-weight: 900;
  line-height: 1;
  text-align: center;
}

.studio-nav-group-label {
  min-width: 0;
  color: var(--studio-muted);
  font-size: 15px;
  font-weight: 900;
  line-height: 1.2;
}
```

保留 `.studio-nav-group-toggle:not(:disabled):hover` 和 Badge 色彩，只删除旧 `min-height: 30px`。

- [ ] **Step 5: 运行 GREEN**

```bash
npm run build
node --test --test-name-pattern "Run groups preview five items|Run and call navigators" \
  dist-node/tests-node/studio-ui.test.js
git diff --check
```

Expected: 2/2 PASS；Call navigator contract 不变；diff check 无输出。

### Task 3: 视觉验收、完整回归、日志与合并 UI slice

**Files:**
- Modify: `changelog/2026-07-16.md`
- Modify: `docs/superpowers/plans/2026-07-16-studio-run-group-preview.md`
- Modify: `docs/superpowers/plans/2026-07-16-studio-compact-brand-header.md`
- Modify: `docs/superpowers/plans/2026-07-16-studio-silver-interface-release.md`

- [ ] **Step 1: 在 `4317` 验收**

确认 14 条分组默认仅显示 5 条；箭头 `16px`、日期 `15px/900`、组头 `36px`、Badge `sm`；点击 header 显示 14 条，再点收回 5 条；输入搜索词时全部匹配项可见。检查精简品牌栏最终外观与 console error 0。

- [ ] **Step 2: 完整回归**

```bash
npm test
npm run studio-desktop:package:dev
git diff --check
```

Expected: Node tests 0 failed；Desktop package `ok: true`；记录实际测试数。

- [ ] **Step 3: 同步日志与计划**

changelog 记录精简品牌栏、11px 副标题、4px 标题间距、运行分组 5 条预览、视觉结论和自动化结果。三个计划勾选实际完成项，总发布计划的当前下一步恢复为 `P3.2 Step 1`。

- [ ] **Step 4: 提交合并 UI slice**

```bash
git add apps/studio-web/src tests-node/studio-ui.test.ts \
  apps/studio-web/vite.config.ts changelog/2026-07-16.md \
  docs/superpowers/specs/2026-07-16-studio-compact-brand-header-design.md \
  docs/superpowers/plans/2026-07-16-studio-compact-brand-header.md \
  docs/superpowers/plans/2026-07-16-studio-run-group-preview.md \
  docs/superpowers/plans/2026-07-16-studio-silver-interface-release.md
git diff --cached --check
git commit -m "界面：收敛 Studio 品牌栏与运行分组"
```

完成定义：品牌栏与运行分组两项视觉改动、RED/GREEN、交互/搜索语义、完整回归、视觉验收、日志和独立 commit 全部完成；随后从 clean release commit 重新生成 `0.1.12` 签名资产。
