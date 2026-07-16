# Studio 精简品牌栏实施计划

> 状态（2026-07-16）：已合并并完成。实现、双 viewport 验收、日志与提交均由 `2026-07-16-studio-activity-and-v012-release.md` 完成；本文件保留为历史设计证据，不再维护独立“当前下一步”。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Studio 左上角改为左侧 `AgentMesh` / `编排你的Agent` 两行文字、右侧设置/手册双图标按钮的单行紧凑品牌栏。

**Architecture:** 保留 `workspace-brand` 面板和现有 `workspaceView` 状态，只替换品牌区 DOM 与局部 CSS。按钮使用 Mantine `ActionIcon` 和内联 SVG，不增加依赖；移除仅供页面 logo 使用的 `StudioBrandMark` 与 Vite filesystem allow，Desktop canonical 应用图标保持不变。

**Tech Stack:** React 19、TypeScript 5.9、Mantine 9、Vite 8、CSS、Node.js `node:test`

## Global Constraints

- 主标题固定为 `AgentMesh`，副标题固定为 `编排你的Agent`。
- 品牌栏保持单行：文字左对齐，两个 `30 x 30` 图标按钮右对齐。
- 设置使用齿轮轮廓，手册使用打开书本轮廓；使用内联 SVG，不新增图标依赖或 Unicode fallback。
- 保留现有 click handler、`workspaceView`、`aria-label`、`aria-pressed`、title、键盘焦点和 `viewNavigation` nav 名称。
- 删除 Studio 页面 logo 引用，但不修改 Desktop canonical SVG、PNG、ICNS、ICO。
- 不改变 AppShell 宽度、路由、API、状态机、updater 或 `0.1.12` 版本。
- 此 UI slice 完成并提交后，重新从 clean `0.1.12` release commit 生成签名产物，不复用已中止构建。

---

### Task 1: 用单行文字与图标操作替换品牌区

**Files:**
- Modify: `tests-node/studio-ui.test.ts`
- Modify: `apps/studio-web/src/app/App.tsx`
- Modify: `apps/studio-web/src/styles.css`
- Modify: `apps/studio-web/vite.config.ts`
- Delete: `apps/studio-web/src/app/StudioBrandMark.tsx`

**Interfaces:**
- Consumes: `workspaceView: "runs" | "calls" | "settings" | "definitions"`、`setWorkspaceView(...)`、`t("settings")`、`t("definitions")`、`t("viewNavigation")`。
- Produces: `.studio-brand-header` 单行布局、`.studio-brand-copy` 两行文字、`.studio-brand-actions` 双 `ActionIcon` 导航。

- [x] **Step 1: 写 RED shell contract**

把 `tests-node/studio-ui.test.ts` 的品牌 contract 改为直接读取 `App.tsx`、CSS 与 Vite config，并断言：

```ts
const brandPath = path.resolve("apps/studio-web/src/app/StudioBrandMark.tsx");
assert.equal(existsSync(brandPath), false, "Studio page brand logo component must be removed");
assert.doesNotMatch(appSource, /StudioBrandMark/);
assert.match(appSource, /className="studio-brand-header"/);
assert.match(appSource, /className="studio-brand-copy"/);
assert.match(appSource, /className="studio-brand-subtitle"/);
assert.match(appSource, />编排你的Agent</);
assert.match(appSource, /className="studio-brand-actions"/);
assert.match(appSource, /className="studio-brand-action studio-brand-settings-action"/);
assert.match(appSource, /className="studio-brand-action studio-brand-manual-action"/);
assert.equal((appSource.match(/<ActionIcon/g) ?? []).length >= 2, true);
assert.equal((appSource.match(/<svg/g) ?? []).length >= 2, true);
assert.match(appSource, /aria-pressed=\{workspaceView === "settings"\}/);
assert.match(appSource, /aria-pressed=\{workspaceView === "definitions"\}/);
assert.doesNotMatch(frontendCss, /\.studio-brand-mark/);
for (const selector of [
  ".studio-brand-header",
  ".studio-brand-copy",
  ".studio-brand-subtitle",
  ".studio-brand-actions",
  ".studio-brand-action",
]) {
  assert.ok(frontendCss.includes(selector), `missing compact brand selector: ${selector}`);
}
assert.doesNotMatch(viteConfigSource, /canonicalIconDir|studio-desktop\/src-tauri\/icons/);
assert.match(viteConfigSource, /allow:\s*\[studioRoot\]/);
```

在静态 render contract 中把可见按钮文字断言替换为：

```ts
assert.match(app, /aria-label="设置"/);
assert.match(app, /aria-label="手册"/);
assert.match(app, /title="设置"/);
assert.match(app, /title="手册"/);
assert.match(app, />编排你的Agent</);
assert.doesNotMatch(app, />设置<\/button>/);
assert.doesNotMatch(app, />手册<\/button>/);
```

- [x] **Step 2: 运行 RED 并确认失败原因**

Run:

```bash
npm run build:node
node --test --test-name-pattern "React app renders the one-shot Mantine shell semantics|Studio silver shell" \
  dist-node/tests-node/studio-ui.test.js
```

Expected: FAIL，至少报告 `Studio page brand logo component must be removed`；失败来自现有 `StudioBrandMark.tsx` 和旧 DOM，而不是编译错误。

- [x] **Step 3: 写最小 React 实现**

在 `App.tsx` 的 Mantine imports 加入 `ActionIcon`，删除 `StudioBrandMark` import，把 `Paper` 内部替换为：

```tsx
<Group className="studio-brand-header" justify="space-between" align="center" wrap="nowrap">
  <Stack className="studio-brand-copy" gap={4}>
    <Title order={1}>AgentMesh</Title>
    <Text className="studio-brand-subtitle" size="xs">编排你的Agent</Text>
  </Stack>
  <Group
    className="studio-brand-actions"
    gap={6}
    wrap="nowrap"
    component="nav"
    aria-label={t("viewNavigation")}
  >
    <ActionIcon
      className="studio-brand-action studio-brand-settings-action"
      variant="light"
      size={30}
      title={t("settings")}
      aria-label={t("settings")}
      aria-pressed={workspaceView === "settings"}
      onClick={() => setWorkspaceView("settings")}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04-2.86 2.86-.04-.04A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.06A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.04.04-2.86-2.86.04-.04A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H1V9.6h.9A1.7 1.7 0 0 0 3.6 8a1.7 1.7 0 0 0-.34-1.88l-.04-.04 2.86-2.86.04.04A1.7 1.7 0 0 0 8 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V1h4v.9A1.7 1.7 0 0 0 15 3.6a1.7 1.7 0 0 0 1.88-.34l.04-.04 2.86 2.86-.04.04A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.9v4h-.9A1.7 1.7 0 0 0 19.4 15Z" />
      </svg>
    </ActionIcon>
    <ActionIcon
      className="studio-brand-action studio-brand-manual-action"
      variant="light"
      size={30}
      title={t("definitions")}
      aria-label={t("definitions")}
      aria-pressed={workspaceView === "definitions"}
      onClick={() => setWorkspaceView("definitions")}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H9a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H3Z" />
        <path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H15a3 3 0 0 0-3 3v14a3 3 0 0 1 3-3h6Z" />
      </svg>
    </ActionIcon>
  </Group>
</Group>
```

删除 `apps/studio-web/src/app/StudioBrandMark.tsx`。不修改其他 `workspaceView` 分支或 handler。

- [x] **Step 4: 写最小 CSS 与 Vite 收敛**

删除 `.studio-brand-lockup`、`.studio-brand-mark`、旧 `.studio-brand-panel .mantine-Button-root` 以及窄屏对应规则，增加：

```css
.studio-brand-header {
  min-width: 0;
}

.studio-brand-copy {
  min-width: 0;
  flex: 1 1 auto;
}

.studio-brand-panel .mantine-Title-root {
  min-width: 0;
  color: var(--studio-ink);
  font-size: 22px;
  letter-spacing: -0.025em;
  line-height: 1.15;
}

.studio-brand-subtitle {
  overflow: hidden;
  color: var(--studio-muted);
  font-size: 11px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-brand-actions {
  flex: 0 0 auto;
}

.studio-brand-action {
  width: 30px;
  height: 30px;
  border: 1px solid var(--studio-border);
  background: #f4f6f8;
  color: var(--studio-muted);
  box-shadow: none;
}

.studio-brand-action[aria-pressed="true"] {
  border-color: rgb(62 184 200 / 34%);
  background: var(--studio-primary-soft);
  color: var(--studio-primary-ink);
}

.studio-brand-action svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
```

`vite.config.ts` 删除 `canonicalIconDir`，把 filesystem allow 恢复为：

```ts
server: {
  fs: {
    allow: [studioRoot],
  },
},
```

- [x] **Step 5: 运行 GREEN 与 production asset contract**

Run:

```bash
npm run build
node --test --test-name-pattern "React app renders the one-shot Mantine shell semantics|Studio silver shell|canonical AgentMesh icon" \
  dist-node/tests-node/studio-ui.test.js \
  dist-node/tests-node/studio-desktop-distribution.test.js
test -z "$(find dist-node/apps/studio-web/frontend/assets -name 'agentmesh-*.svg' -print -quit)"
git diff --check
```

Expected: selected tests PASS；Studio frontend 不再产出品牌 SVG；Desktop canonical icon contract 仍 PASS；diff check 无输出。

进度记录：RED 为 0/2，分别缺少 `aria-label="设置"` 和仍存在 `StudioBrandMark.tsx`；最小实现后 GREEN 为 3/3。production frontend 从 808 降为 807 modules，assets 中无 `agentmesh-*.svg`，Desktop canonical icon contract 保持通过，`git diff --check` 无输出。

### Task 2: 浏览器验收、回归、日志与提交

**Files:**
- Modify: `changelog/2026-07-16.md`
- Modify: `docs/superpowers/plans/2026-07-16-studio-compact-brand-header.md`
- Modify: `docs/superpowers/plans/2026-07-16-studio-silver-interface-release.md`

**Interfaces:**
- Consumes: Task 1 build 后的 Studio frontend 与现有 `0.1.12` release plan。
- Produces: 两个目标尺寸的视觉证据、完整自动化证据、独立 UI commit，以及恢复到 `P3.2` 资产生成的发布状态。

- [ ] **Step 1: 浏览器视觉验收**

在 `1280 x 720` 与 `1024 x 640` 检查：`AgentMesh` / `编排你的Agent` 左对齐；设置与手册按钮右对齐且均为 `30 x 30`；当前按钮选中态正确；无 logo、文字/按钮裁切、横向溢出或 console error。

- [x] **Step 2: 完整回归**

Run:

```bash
npm test
npm run studio-desktop:package:dev
git diff --check
```

Expected: Node tests 0 failed；Desktop package `ok: true`；diff check 无输出。记录实际测试数。

进度记录：`npm test` 553/553，`npm run studio-desktop:package:dev` 为 `ok: true`，`git diff --check` 通过。in-app browser 自动化连续两次无法附着现有或新建标签页，未使用其他浏览器工具绕过；Task 2 Step 1 保持未完成，等待当前 `4317` 标签人工刷新确认。

视觉调整记录：用户查看初版后确认副标题偏大，已将 `编排你的Agent` 从 `13px` 收敛到 `11px`；字号 contract 先以实际 `13px` 正确 RED，再修改 CSS。

间距调整记录：用户确认标题与副标题过近，已将文字 stack 从 `gap={1}` 增加到 `gap={4}`；结构 contract 先以实际 `gap={1}` 正确 RED，再修改 React。

- [x] **Step 3: 同步 changelog 与两个计划**

历史要求为追加精简品牌栏事实、两个尺寸与自动化验证结果；该步骤现已迁入统一总计划，不再从本文件恢复发布下一步。

- [x] **Step 4: 提交 UI slice**

```bash
git add apps/studio-web/src/app/App.tsx \
  apps/studio-web/src/app/StudioBrandMark.tsx \
  apps/studio-web/src/styles.css apps/studio-web/vite.config.ts \
  tests-node/studio-ui.test.ts changelog/2026-07-16.md \
  docs/superpowers/plans/2026-07-16-studio-compact-brand-header.md \
  docs/superpowers/plans/2026-07-16-studio-silver-interface-release.md
git diff --cached --check
git commit -m "界面：收敛 Studio 左上品牌栏"
```

完成定义：单行文字品牌、固定副标题、双 SVG ActionIcon、active/accessibility contract、两个尺寸视觉验收、完整回归、日志与独立 commit 全部完成；随后重新执行 `0.1.12 P3.2`，从 clean release commit 生成签名资产。
