# Studio 活动项分隔优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让左侧活动导航中的未选中项具有清楚、克制且一致的卡片边界。

**Architecture:** 保持 `ActivityNavigator` 的结构和行为不变，只在现有活动项 CSS 契约上增加默认、悬停和选中三态。测试继续读取真实 `styles.css`，用样式契约断言防止边界回退。

**Tech Stack:** React 19、Mantine、CSS、Node.js `node:test`

## Global Constraints

- 不修改活动数据结构、选择逻辑、删除逻辑、日期分组或展开逻辑。
- 不新增依赖，不增加阴影，不改变运行/调用、状态和时间标签。
- 未选中项使用浅灰白背景与 1px 中性边框；选中项使用品牌色浅底与强调边框。
- 相邻活动项的最终视觉间距为 8px。

---

### Task 1: 活动导航项三态分隔样式

**Files:**
- Modify: `tests-node/studio-ui.test.ts:330-415`
- Modify: `apps/studio-web/src/styles.css:401-420`

**Interfaces:**
- Consumes: `.studio-activity-item-shell`、`.studio-nav-item` 和 `aria-current="true"` 现有 DOM/CSS 契约。
- Produces: 未选中、悬停、选中三态的稳定样式契约；不产生新的 TypeScript 接口。

- [x] **Step 1: 写入失败的样式契约测试**

在读取 `frontendCss` 的现有 Studio UI 测试中增加：

```ts
assert.match(frontendCss, /\.studio-activity-item-shell\s+\.studio-nav-item\s*\{[^}]*border:\s*1px solid var\(--studio-border\);[^}]*border-radius:\s*var\(--studio-radius-control\);[^}]*background:\s*#f8fafb;/s);
assert.match(frontendCss, /\.studio-activity-item-shell\s*\+\s*\.studio-activity-item-shell\s*\{[^}]*margin-top:\s*2px;/s);
assert.match(frontendCss, /\.studio-activity-item-shell\s+\.studio-nav-item:hover\s*\{[^}]*border-color:\s*var\(--studio-border-strong\);[^}]*background:\s*#f3f6f8;[^}]*box-shadow:\s*none;/s);
assert.match(frontendCss, /\.studio-activity-item-shell\s+\.studio-nav-item\[aria-current="true"\]\s*\{[^}]*border-color:\s*rgb\(62 184 200 \/ 38%\)\s*!important;[^}]*background:\s*var\(--studio-primary-soft\)\s*!important;/s);
```

- [x] **Step 2: 运行定向测试并确认 RED**

Run:

```bash
npm run build:node && node --test --test-name-pattern "React app CSS uses new layout hooks" dist-node/tests-node/studio-ui.test.js
```

Expected: FAIL，错误指出 `styles.css` 缺少活动项边框、背景或三态选择器。

- [x] **Step 3: 写入最小 CSS 实现**

将活动项相关样式调整为：

```css
.studio-activity-item-shell + .studio-activity-item-shell {
  margin-top: 2px;
}

.studio-activity-item-shell .studio-nav-item {
  padding-right: 36px;
  border: 1px solid var(--studio-border);
  border-radius: var(--studio-radius-control);
  background: #f8fafb;
  transition:
    border-color var(--studio-motion-fast) ease,
    background-color var(--studio-motion-fast) ease;
}

.studio-activity-item-shell .studio-nav-item:hover {
  border-color: var(--studio-border-strong);
  background: #f3f6f8;
  box-shadow: none;
}

.studio-activity-item-shell .studio-nav-item[aria-current="true"] {
  border-color: rgb(62 184 200 / 38%) !important;
  background: var(--studio-primary-soft) !important;
}
```

- [x] **Step 4: 运行定向测试并确认 GREEN**

Run:

```bash
npm run build:node && node --test --test-name-pattern "React app CSS uses new layout hooks" dist-node/tests-node/studio-ui.test.js
```

Expected: PASS，0 fail。

- [x] **Step 5: 完成自审与全量验证**

Run:

```bash
npm test
git diff --check
```

Expected: 全量测试 0 fail；`git diff --check` 无输出。自审确认只有活动项视觉层和对应测试发生变化，现有未提交 Agent 模型加载修复不被覆盖或回退。

- [x] **Step 6: 提交实现**

```bash
git add apps/studio-web/src/styles.css tests-node/studio-ui.test.ts
git commit -m "界面：增强活动项分隔层级"
```

提交前仅暂存本任务对应的 CSS 与测试差异；如果 `tests-node/studio-ui.test.ts` 同时含有前序未提交修改，使用交互式暂存或拆分 patch，避免把无关变更混入本提交。

## 收尾约束

- 审查方式：自审。
- 审查判定依据：本任务仅改变局部 CSS，无新依赖、接口、状态或数据变化；真实样式契约测试和全量回归覆盖核心风险。
- 审查重点：未选中项边界、选中态优先级、悬停态对比度、删除按钮定位和 8px 项间距。
- 外审执行：不适用。
- 外审失败策略：不适用；若全量验证失败则停止提交，回到失败测试定位根因。
- 日志：本轮未要求版本发布或同步更新日志，不修改 changelog。
- 回滚：回退新增的四段活动项 CSS 和对应四条测试断言即可恢复原视觉。
- 当前状态：Task 1 已实现、验证并提交。

## 验证记录

- 定向样式测试完成 RED → GREEN；自审发现通用选中态的 `!important` 会覆盖局部品牌样式，已补强契约后再次完成 RED → GREEN。
- 全量测试首次在并发环境中暴露既有 1 秒准备调用窗口的时序波动；单测和整文件测试均通过后，将准备调用窗口放宽至 5 秒，真正的恢复超时断言仍保持 1 秒。
- 修正后全量 `npm test`：700 pass，0 fail；提交前将再执行一次最终全量验证。
