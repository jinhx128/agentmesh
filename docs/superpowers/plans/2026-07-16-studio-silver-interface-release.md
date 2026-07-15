# AgentMesh Studio 银灰界面与 0.1.11 发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AgentMesh Studio/Desktop 改造成已批准的银灰浅色界面，完成下一补丁版本发布，并把本机 CLI 与 Desktop 升级到该版本。

**Architecture:** 保留 React 状态、API、路由和 Tauri 更新流程，只在 Mantine 主题、集中式 CSS token、少量语义 class 和品牌标记组件上建立新视觉层。UI 完成后再执行独立的版本、文档、签名产物、外审、发布和真机升级阶段；发布 tag 始终指向已通过门禁的干净提交。

**Tech Stack:** React 19、Mantine 9、TypeScript 5.9、Vite 8、Node.js `node:test`、Tauri 2/Rust、AgentMesh Review Gate、npm、GitHub CLI、macOS DMG/updater 签名

## Global Constraints

- 设计唯一依据：`docs/superpowers/specs/2026-07-16-studio-silver-interface-design.md`。
- 视觉方向固定为 A「银灰浅色」，密度固定为「均衡紧凑」。
- 不增加暗色主题、自动明暗切换、移动端信息架构或第二套 UI 库。
- 不修改现有产品路由、API、业务状态机、Tauri updater 行为或平台支持范围。
- 主色从珊瑚红切换为青蓝；绿、黄、红只承担 success、warning、danger 语义。
- 主要验收尺寸为 `1280 x 720`，次要验收尺寸为 `1024 x 640`。
- Desktop 继续支持 macOS 12+、Apple Silicon，保持当前未 notarize 分发策略。
- updater 私钥和密码只从仓库外环境加载，禁止打印、提交或写入计划进度记录。
- 每个 slice 按「RED → 最小实现 → GREEN → 审查 → 日志/进度 → commit」闭环；同一批 UI 文件只允许一个主控顺序修改。
- commit message 使用中文；命令、文件名、包名和版本号保持原文。

## 1. 背景与事实

- 当前实现分支：`codex/desktop-updates`，实现 worktree：`/Users/zz/Documents/WebStorm/agentmesh/.worktrees/desktop-updates`。
- 当前版本：`0.1.10`；本机 `/opt/homebrew/bin/agentmesh` 与 `/Applications/AgentMesh.app` 均为 `0.1.10`。
- 当前 UI 由 `StudioThemeProvider.tsx` 和约 1400 行 `styles.css` 统一驱动，已有稳定 `data-studio-section` 与 class contract。
- `tests-node/studio-ui.test.ts` 已检查 React 静态输出、主题源文件和 CSS 布局 contract，适合承载视觉回归约束。
- `0.1.10` 线上 Release 没有 `latest.json`；它无法应用内自举到第一个 updater-enabled 版本，因此本机 Desktop 升到本次发布版本仍需手动替换一次 DMG。
- 当前发布脚本已能产出 npm tarball、DMG、Tauri updater archive/signature、`latest.json`、Skill markdown 和 `SHA256SUMS`。

## 2. 目的、成功标准与非目标

### 目的

一次交付完成 UI 视觉统一、完整验证、多模型复审、版本发布和本机升级，避免连续发布两个补丁版本。

### 成功标准

1. Run、Call、Settings、Definitions、Manual、modal、drawer、空/加载/成功/警告/错误状态均使用同一银灰视觉语言。
2. `1280 x 720` 与 `1024 x 640` 无关键按钮裁切、文本重叠或滚动陷阱。
3. `npm test` 全绿，`cargo check`、Desktop dev package、签名 app/dmg 与 release asset 校验通过。
4. Cursor Composer 2.5、OpenCode GLM 5.2、Claude Code Opus 4.8 的 Review Gate 没有未处理的 Must Fix/Should Fix；不可用 reviewer 有明确证据和降级结论。
5. npm 与 GitHub Release 均可查到新版本和完整资产，`latest.json` 指向不可变 tag 资产。
6. 本机 PATH CLI 与 `/Applications/AgentMesh.app` 报告新版本，Desktop 启动、sidecar 生命周期和 updater 检查正常。

### 非目标

- 不重新设计应用图标。
- 不重排功能入口或把现有操作隐藏到新菜单。
- 不引入视觉截图测试依赖；自动化使用现有源 contract/静态渲染，像素级结果由浏览器与真机验收。
- 不构建 Intel、Windows 或 notarized macOS 产物。

## 3. 文件与模块规划

- Create `apps/studio-web/src/app/StudioBrandMark.tsx`：无交互、`aria-hidden` 的深色圆芯/青蓝轨道品牌标记。
- Modify `apps/studio-web/src/app/StudioThemeProvider.tsx`：青蓝 Mantine 色阶、圆角与 light scheme defaults。
- Modify `apps/studio-web/src/app/App.tsx`：品牌区语义结构与 class hook；不改 `WorkspaceView` 或加载逻辑。
- Modify `apps/studio-web/src/features/settings/SettingsAboutPanel.tsx`：给兼容性、版本、应用更新和 info item 增加稳定 class；不改状态机。
- Modify `apps/studio-web/src/styles.css`：新 token、材质、shell、组件、响应式、可访问性与 reduced-motion。
- Modify `tests-node/studio-ui.test.ts`：主题、token、品牌、语义状态、响应式和 reduced-motion contract。
- Modify `.gitignore`：忽略本地 `.superpowers/` Visual Companion 会话，保证发布工作区可清理。
- Modify root/workspace `package.json`、`package-lock.json`、Tauri `Cargo.toml`/`Cargo.lock`/`tauri.conf.json`、当前版本源和对应测试：同步新版本。
- Modify `README.md`、`apps/studio-desktop/distribution/latest.*.json`、`docs/distribution/*.md`：同步第一版 updater 发布资产和安装边界。
- Create `docs/distribution/v0.1.11-release-notes.md`：正式 GitHub Release notes；若远端检查证明目标版本不是 `0.1.11`，文件名和正文使用实际版本。
- Modify `changelog/2026-07-16.md` 与本计划：记录事实、验证、审查、发布和真机证据。

数据/schema/API 变化：无。

---

## 4. 完整计划

### P1. 银灰界面实现与验证

- [ ] P1 阶段完成门禁（仅在 `P1.Z` 完成审查、日志和 commit 后勾选）
- 阶段目标：在不改变产品行为的前提下完成主题、shell、组件、响应式与可访问性改造。
- 阶段门禁：`P1.1`–`P1.4` 全部 GREEN，`P1.Z` 外审通过且不存在未解决 Must Fix/Should Fix。

### P1.1 建立主题 token 与视觉 contract

- [x] ~~P1.1 建立主题 token 与视觉 contract。~~

**Files:**
- Modify: `.gitignore`
- Modify: `tests-node/studio-ui.test.ts`
- Modify: `apps/studio-web/src/app/StudioThemeProvider.tsx`
- Modify: `apps/studio-web/src/styles.css`

**Interfaces:**
- Consumes: `StudioThemeProvider({ children }: { children: ReactNode }): ReactElement`。
- Produces: CSS role tokens、`studioTheme` 青蓝主色和后续 shell/组件共用的 radius/shadow/motion variables。

- [x] **Step 1: 写 RED 主题与 token contract**

新增独立测试 `test("Studio silver theme exposes canonical tokens", ...)`，在该测试读取 `frontendCss`、`themeSource` 和 `.gitignore` 后增加：

```ts
for (const token of [
  "--studio-canvas: #edf0f3",
  "--studio-surface: #ffffff",
  "--studio-ink: #1d2937",
  "--studio-primary: #3eb8c8",
  "--studio-success: #46b978",
  "--studio-warning: #e4a63d",
  "--studio-danger: #dc6666",
  "--studio-radius-shell: 18px",
  "--studio-motion-fast: 140ms",
]) {
  assert.ok(frontendCss.includes(token), `missing silver UI token: ${token}`);
}
assert.doesNotMatch(frontendCss, /#fbf7f4/i);
```

在现有 `themeSource` assertions 后增加：

```ts
assert.match(themeSource, /const agentmeshCyan: MantineColorsTuple/);
assert.match(themeSource, /"#3eb8c8"/i);
assert.match(themeSource, /defaultRadius:\s*"md"/);
assert.match(themeSource, /primaryShade:\s*\{[\s\S]*light:\s*5/);
assert.doesNotMatch(themeSource, /agentmeshBlue/);
```

在同一测试读取 `.gitignore` 并增加：

```ts
const gitignoreSource = readFileSync(path.resolve(".gitignore"), "utf-8");
assert.match(gitignoreSource, /(?:^|\n)\.superpowers\/(?:\n|$)/);
```

- [x] **Step 2: 验证 RED**

```bash
npm run build:node
node --test --test-name-pattern "Studio silver theme" \
  dist-node/tests-node/studio-ui.test.js
```

Expected: FAIL，缺少银灰 token、`agentmeshCyan` 和 `.superpowers/` ignore。

- [x] **Step 3: 写最小主题实现**

将 Mantine 主色定义替换为：

```ts
const agentmeshCyan: MantineColorsTuple = [
  "#e9fbfc", "#d7f6f8", "#adebf0", "#7ddde5", "#58cad6",
  "#3eb8c8", "#2699a8", "#207b88", "#1f6570", "#1d535c",
];
```

`studioTheme` 保留 Select/MultiSelect 行为，将 `colors.agentmesh` 指向该 tuple，设置 `defaultRadius: "md"`，light `primaryShade: 5`。`MantineProvider defaultColorScheme="light"` 不变。

用以下 role token 替换 `styles.css` 顶部旧色板；flow 几何 token 原样保留。P1.1 先保留 legacy variable alias，保证后续 selector 尚未迁移时不出现未定义变量；P1.3 完成全部引用迁移后删除 alias：

```css
:root {
  --studio-canvas: #edf0f3;
  --studio-canvas-deep: #dce1e6;
  --studio-surface: #ffffff;
  --studio-surface-glass: rgb(255 255 255 / 72%);
  --studio-surface-grouped: #e7ebef;
  --studio-border: rgb(111 126 142 / 20%);
  --studio-border-strong: rgb(91 107 123 / 34%);
  --studio-ink: #1d2937;
  --studio-muted: #7b8794;
  --studio-primary: #3eb8c8;
  --studio-primary-strong: #2699a8;
  --studio-primary-soft: #def6f8;
  --studio-success: #46b978;
  --studio-success-soft: #e4f7ec;
  --studio-warning: #e4a63d;
  --studio-warning-soft: #fff3d9;
  --studio-danger: #dc6666;
  --studio-danger-soft: #fee9e9;
  --studio-radius-shell: 18px;
  --studio-radius-panel: 14px;
  --studio-radius-control: 10px;
  --studio-shadow-sm: 0 3px 10px rgb(37 49 62 / 6%);
  --studio-shadow-md: 0 10px 28px rgb(37 49 62 / 9%);
  --studio-motion-fast: 140ms;
  --studio-flow-connector-color: #6f7f96;
  --studio-bg: var(--studio-canvas);
  --studio-surface-soft: var(--studio-surface-grouped);
  --studio-surface-tint: var(--studio-surface-grouped);
  --studio-text: var(--studio-ink);
  --studio-accent: var(--studio-primary);
  --studio-accent-soft: var(--studio-primary-soft);
}
```

同一 slice 把 `body` 的暖色 `#fbf7f4` 渐变替换为：

```css
body {
  background:
    linear-gradient(145deg, var(--studio-canvas-deep), #f9fafb 44%, var(--studio-canvas)),
    var(--studio-canvas);
}
```

在 `.gitignore` 的 AgentMesh runtime section 后追加 `.superpowers/`。

- [x] **Step 4: 验证 GREEN 并审查**

```bash
npm run build:node
node --test --test-name-pattern "Studio silver theme" \
  dist-node/tests-node/studio-ui.test.js
git diff --check
```

Expected: selected tests PASS；旧布局 contract 仍 PASS；diff check 无输出。

审查方式：自审。判定依据：只建立 token/theme 和 ignore，不改变 React 行为。审查重点：色彩角色、旧珊瑚 token 清除、Mantine Select/MultiSelect defaults 未丢失。

- [x] **Step 5: 记录并提交**

```bash
git add .gitignore apps/studio-web/src/app/StudioThemeProvider.tsx apps/studio-web/src/styles.css \
  tests-node/studio-ui.test.ts docs/superpowers/plans/2026-07-16-studio-silver-interface-release.md
git commit -m "界面：建立 Studio 银灰主题基础"
```

进度记录：状态 `completed`；完成时间 `2026-07-16 05:26 CST`；RED 以 `missing silver UI token: --studio-canvas: #edf0f3` 失败；GREEN 为 `Studio silver theme` 与原有 CSS layout contract 共 2 tests passed；`git diff --check` 通过；自审确认仅修改主题、CSS token/canvas fallback 与 ignore，不改变 React 行为；changelog 在 `P1.Z` 聚合；commit 见本 slice 收尾提交；下一步 `P1.2 Step 1`。

### P1.2 实现品牌标记与 shell 层级

- [x] ~~P1.2 实现品牌标记与 shell 层级。~~

**Files:**
- Create: `apps/studio-web/src/app/StudioBrandMark.tsx`
- Modify: `apps/studio-web/src/app/App.tsx`
- Modify: `apps/studio-web/src/styles.css`
- Modify: `tests-node/studio-ui.test.ts`

**Interfaces:**
- Produces: `StudioBrandMark(): ReactElement`；仅视觉、`aria-hidden="true"`，不接收 props、不触发事件。
- Consumes: `AppShell`、现有 `WorkspaceView`、P1.1 CSS tokens。

- [x] **Step 1: 写 RED 品牌/shell contract**

新增独立测试 `test("Studio silver shell renders the approved brand hierarchy", ...)`；先用 `existsSync` 产生普通 assertion failure，再读取新文件：

```ts
const brandPath = path.resolve("apps/studio-web/src/app/StudioBrandMark.tsx");
assert.equal(existsSync(brandPath), true, "StudioBrandMark.tsx must exist");
const brandSource = readFileSync(brandPath, "utf-8");
assert.match(brandSource, /export function StudioBrandMark\(\): ReactElement/);
assert.match(brandSource, /className="studio-brand-mark"/);
assert.match(brandSource, /className="studio-brand-core"/);
assert.match(brandSource, /className="studio-brand-track studio-brand-track-a"/);
assert.match(brandSource, /className="studio-brand-track studio-brand-track-b"/);
assert.match(brandSource, /aria-hidden="true"/);
assert.match(appSource, /<StudioBrandMark\s*\/>/);
for (const selector of [
  ".studio-brand-lockup", ".studio-brand-mark", ".studio-brand-core",
  ".studio-brand-track-a", ".studio-brand-track-b",
  ".studio-navbar", ".studio-topbar",
]) assert.ok(frontendCss.includes(selector), `missing shell selector: ${selector}`);
```

- [x] **Step 2: 验证 RED**

```bash
npm run build:node
node --test --test-name-pattern "Studio silver shell" \
  dist-node/tests-node/studio-ui.test.js
```

Expected: FAIL，因为 `StudioBrandMark.tsx` 与 shell class 尚不存在。

- [x] **Step 3: 实现品牌组件与 App 结构**

创建完整组件：

```tsx
import type { ReactElement } from "react";

export function StudioBrandMark(): ReactElement {
  return (
    <span className="studio-brand-mark" aria-hidden="true">
      <span className="studio-brand-core" />
      <span className="studio-brand-track studio-brand-track-a" />
      <span className="studio-brand-track studio-brand-track-b" />
    </span>
  );
}
```

在 `App.tsx` 导入组件，把当前居中标题改为：

```tsx
<Group className="studio-brand-lockup" gap="sm" wrap="nowrap">
  <StudioBrandMark />
  <Title order={1} size="h2">AgentMesh</Title>
</Group>
```

保留设置/手册按钮、`navigatorView`、`WorkspaceView` 与所有事件 handler。`.studio-brand-track-a/-b` 使用青蓝椭圆描边并分别旋转正/负角度，深色 core 位于轨道上层；track 命名避免重新触发仓库禁止的 legacy `orb` contract。用 P1.1 token 重写 `.studio-navbar`、`.studio-brand-panel`、`.studio-data-navigator`、`.studio-topbar`、`.studio-workspace-shell`：shell radius 18px、panel radius 14px、低透明银灰背景、选中项 cyan rail。删除/重设旧 `--mantine-color-agentmesh-4/-6` 珊瑚覆盖。基础背景先声明 solid fallback，再在 `@supports (backdrop-filter: blur(1px))` 中启用 translucent/blur。

- [x] **Step 4: 验证 GREEN 并审查**

```bash
npm run build
node --test --test-name-pattern "Studio silver shell|React app CSS uses new layout hooks" \
  dist-node/tests-node/studio-ui.test.js
git diff --check
```

Expected: build PASS；新 contract 与旧 shell/scroll contract 全部 PASS。

审查方式：外审，阶段内先主控自审 DOM 顺序、可访问名称和事件 handler diff，阶段收尾 `P1.Z` 统一通过 AgentMesh Review Gate。Must/Should 在本 slice 修复并重跑命令；P1.Z 外审不可用不得直接完成 P1。

- [x] **Step 5: 记录并提交**

```bash
git add apps/studio-web/src/app/StudioBrandMark.tsx apps/studio-web/src/app/App.tsx \
  apps/studio-web/src/styles.css tests-node/studio-ui.test.ts \
  docs/superpowers/plans/2026-07-16-studio-silver-interface-release.md
git commit -m "界面：重塑 Studio 导航与工作区层级"
```

进度记录：状态 `completed`；完成时间 `2026-07-16 05:30 CST`；RED 以 `StudioBrandMark.tsx must exist` assertion failure 证明新结构缺失；GREEN 为完整 frontend build 通过，silver theme/shell/原 CSS layout 共 3 tests passed，`git diff --check` 通过；校准内部命名为 `studio-brand-track-*`，保留青蓝轨道设计并避免 legacy `orb` contract；自审确认 `WorkspaceView`、事件 handler 与 API 无变化；外审并入 `P1.Z`；changelog 在 `P1.Z` 聚合；commit 见本 slice 收尾提交；下一步 `P1.3 Step 1`。

### P1.3 统一控件、状态、卡片和内容表面

- [x] ~~P1.3 统一控件、状态、卡片和内容表面。~~

**Files:**
- Modify: `apps/studio-web/src/features/settings/SettingsAboutPanel.tsx`
- Modify: `apps/studio-web/src/styles.css`
- Modify: `tests-node/studio-ui.test.ts`

**Interfaces:**
- Consumes: 现有 `SettingsAboutState`、`DesktopAppUpdaterState`、`StudioUpdateReport`；类型与状态枚举不变。
- Produces: `.studio-subcard`、`.studio-update-card`、`.studio-info-item` presentation hooks。

- [x] **Step 1: 写 RED 组件 contract**

新增独立测试 `test("Studio silver components map update and status semantics", ...)`。该测试读取 `frontendCss`，并复用 `renderSettingsAboutPanel(...)` fixture；静态渲染断言为：

```ts
assert.match(settings, /class="[^"]*studio-subcard[^"]*"/);
assert.match(settings, /class="[^"]*studio-update-card[^"]*"/);
assert.match(settings, /class="[^"]*studio-info-item[^"]*"/);
```

给 CSS contract 增加：

```ts
for (const selector of [
  ".mantine-Button-root", ".mantine-Input-input", ".mantine-Tabs-list",
  ".studio-subcard", ".studio-update-card", ".studio-info-item",
  ".studio-resource-card", ".artifact-markdown",
]) assert.ok(frontendCss.includes(selector), `missing component selector: ${selector}`);
assert.match(frontendCss, /\.status\.ready,[\s\S]*var\(--studio-success\)/);
assert.match(frontendCss, /\.status\.failed,[\s\S]*var\(--studio-danger\)/);
assert.doesNotMatch(frontendCss, /#f45d3d|#fff3ee|#ffd0c4|#ffe0d7|#b5432d/i);
assert.doesNotMatch(frontendCss, /var\(--studio-(?:bg|text|accent|accent-soft|surface-soft|surface-tint)\)/);
```

- [x] **Step 2: 验证 RED**

```bash
npm run build:node
node --test --test-name-pattern "Studio silver components" \
  dist-node/tests-node/studio-ui.test.js
```

Expected: FAIL，缺少新增 hooks 和 semantic token mappings。

- [x] **Step 3: 增加语义 class 并完成组件样式**

在 `SettingsAboutPanel.tsx` 只增加 presentation class；`studio-info-item` 必须加在文件末尾 `InfoItem` 组件返回的 `Stack` 上，从而覆盖所有调用点：

```tsx
<Card className="studio-subcard studio-compatibility-card" ...>
<Card className="studio-subcard studio-update-card" ...>
<Stack className="studio-info-item" gap={2}>
```

Desktop updater 与 server update card 都使用 `studio-update-card`，仍通过既有 `data-studio-section` 区分；不改变 click handler、disabled 条件、progress 或错误文案。

在 `styles.css` 统一 Mantine button/action/input/tab/segmented control/badge/alert/modal/drawer/code，以及 `.studio-panel`、`.studio-metric`、`.studio-resource-card`、`.artifact-sidebar-*`、`.artifact-markdown`、`.workflow-stage-card`。显式迁移全部 `var(--studio-bg/text/accent/accent-soft/surface-soft/surface-tint)`、`.status.ready/read_write/completed/success`、`.status.failed/error/not_ready`、`.status.current/running`、`.status.pending/stale/missing` 和 `.manual-architecture-path`；删除 P1.1 legacy aliases 与所有珊瑚字面量。静态 grouping 不用 elevation；可交互 card 用 `--studio-shadow-sm`；选中态用 cyan rail/outline；code/markdown 保持不透明背景；状态映射 P1.1 semantic tokens。

- [x] **Step 4: 验证 GREEN 并审查**

```bash
npm run build
node --test --test-name-pattern "Studio silver components|Safe actions, settings, integrations|React app CSS uses new layout hooks" \
  dist-node/tests-node/studio-ui.test.js
git diff --check
```

Expected: focused tests PASS；update 状态渲染、安装按钮与原文案断言不变。

审查方式：外审并纳入 `P1.Z`。主控先核对状态颜色不替代文案、danger 不使用 cyan、update error 不暗示当前版本已被删除。

- [x] **Step 5: 记录并提交**

```bash
git add apps/studio-web/src/features/settings/SettingsAboutPanel.tsx \
  apps/studio-web/src/styles.css tests-node/studio-ui.test.ts \
  docs/superpowers/plans/2026-07-16-studio-silver-interface-release.md
git commit -m "界面：统一 Studio 控件与状态视觉"
```

进度记录：状态 `completed`；完成时间 `2026-07-16 05:36 CST`；RED 以 rendered Settings/About 缺少 `studio-subcard` 失败；GREEN 为完整 frontend build 通过，silver theme/shell/components、原 CSS layout 与现有 Settings/About/updater contract 共 5 tests passed；`git diff --check` 通过；presentation hooks 加在共享 `InfoItem` 和全部 update card，状态分支、按钮条件、progress 与错误恢复逻辑未变；legacy token 使用/声明和珊瑚/暖色交互字面量 contract 已清零；外审并入 `P1.Z`，changelog 在 `P1.Z` 聚合；commit 见本 slice 收尾提交；下一步 `P1.4 Step 1`。

### P1.4 响应式、可访问性与浏览器视觉验收

**Files:**
- Modify: `apps/studio-web/src/styles.css`
- Modify: `tests-node/studio-ui.test.ts`
- Verify: all Studio views/states in local browser

**Interfaces:**
- Consumes: P1.1–P1.3 selectors 与现有 `@media (max-width: 36em)` collapse contract。
- Produces: `prefers-reduced-motion` contract、1024/1280 viewport 视觉证据。

- [x] **Step 1: 写 RED 响应式/动效 contract**

```ts
assert.match(frontendCss, /@media \(prefers-reduced-motion:\s*reduce\)/);
assert.match(frontendCss, /@media \(max-width:\s*64em\)/);
assert.match(frontendCss, /@media \(max-width:\s*36em\)[\s\S]*grid-template-columns:\s*1fr/);
assert.match(frontendCss, /focus-visible/);
```

- [x] **Step 2: 验证 RED**

```bash
npm run build:node
node --test --test-name-pattern "React app CSS uses new layout hooks" \
  dist-node/tests-node/studio-ui.test.js
```

Expected: FAIL，缺少 64em density breakpoint 与 reduced-motion block。

- [x] **Step 3: 实现中等尺寸与 reduced-motion 规则**

```css
@media (max-width: 64em) {
  .studio-workspace-shell { padding: 10px; }
  .run-workspace-layout {
    gap: 10px;
    grid-template-columns: minmax(0, 1fr) minmax(200px, 236px);
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

保留 36em 现有 collapse/scroll 行为；中等尺寸先缩 gap/card columns，不缩正文字号。

- [x] **Step 4: 自动化 GREEN**

```bash
npm run build
node --test dist-node/tests-node/studio-ui.test.js
git diff --check
```

Expected: complete `studio-ui` suite PASS，frontend build PASS。

- [x] **Step 5: 浏览器视觉验收**

```bash
npm run studio -- --host 127.0.0.1 --port 4317
```

使用 in-app browser 依次在 `1280 x 720`、`1024 x 640` 检查 Run、Call、Settings/资源、高级、环境、关于、Definitions/Manual、modal、drawer。每个尺寸记录 shell 和 Settings/About 截图；检查主操作、scroll、长路径、空/加载/错误/成功状态。用浏览器读取正文、muted text、primary button、focus ring 的 computed foreground/background，按 WCAG relative-luminance 公式核对正文/控件至少 `4.5:1`、大字至少 `3:1`；键盘 Tab 逐个确认 focus-visible，状态标签必须同时含文字。浏览器 console error 必须为 0；本地 API 数据网络失败可作为环境状态记录，不能掩盖布局错误。

- [x] **Step 6: 记录并提交**

```bash
git add apps/studio-web/src/styles.css tests-node/studio-ui.test.ts \
  docs/superpowers/plans/2026-07-16-studio-silver-interface-release.md
git commit -m "界面：补齐 Studio 响应式与可访问性"
```

审查方式：外审并纳入 `P1.Z`；视觉证据由主控负责，reviewer 核对 CSS/DOM/contract。

进度记录：状态 `completed`；完成时间 `2026-07-16 05:56 CST`；原 RED 以缺少 `@media (max-width: 64em)` / `prefers-reduced-motion` contract 失败；浏览器补充发现 Modal/Drawer 关闭按钮无可访问名称、14px muted 文本仅 `3.53:1`、青蓝主按钮白字仅 `2.36:1`，分别新增失败 contract 后通过主题统一 `closeButtonProps`、`--studio-muted: #5e6b77` 与 Mantine `autoContrast` 最小修复；最终完整 frontend build、`studio-ui` 22/22 与 `git diff --check` 通过。in-app browser 在 `1280 x 720`、`1024 x 640` 逐项检查 Run、Call、Settings 资源/高级/环境/关于、Manual、modal、drawer，横向 overflow 为 0、可见按钮无裁切、console error 为 0；修复后 muted 为 `5.26:1`、primary button 为 `8.90:1`，状态均同时含文字；浏览器键盘注入不触发原生 Tab 默认移动，焦点证据由现有 `:focus-visible`、3px focus ring computed style 与自动化 contract 覆盖，Desktop 真机阶段补验；viewport 已 reset。开发态环境页的 CLI source shim 报 `ERR_MODULE_NOT_FOUND` 仅记录为打包态待复核项；下一步 `P1.Z Step 1`。

### P1.Z 阶段收尾校准与 UI 外审

- [ ] **Step 1: 阶段自动化验证**

```bash
npm test
cargo check --manifest-path apps/studio-desktop/src-tauri/Cargo.toml
npm run studio-desktop:package:dev
git diff --check
git status --short --branch
```

Expected: 全量 Node tests、Rust check 和 Desktop dev package PASS；只允许计划/日志的预期修改，`.superpowers/` 已被 ignore。

- [ ] **Step 2: AgentMesh Review Gate**

```bash
base="$(git merge-base origin/main HEAD)"
git diff "$base"...HEAD -- apps/studio-web tests-node/studio-ui.test.ts .gitignore \
  > /tmp/agentmesh-studio-silver.diff
```

通过 `w-9d94d0db` 分配 Cursor Composer 2.5、OpenCode GLM 5.2、Claude Code Opus 4.8 只读审查，`decide=current`。review task 要求输出 `[Must Fix|Should Fix|Nit] 文件:行号 — 描述` 或 `LGTM`，覆盖需求一致性、可访问性、响应式、状态语义、回归风险和依赖边界。先 `flow status --json`，再读取 findings；接受的问题回到对应 slice 修复并重跑，拒绝的问题把事实依据写入 decision。

外审失败策略：单 reviewer 失败先 retry 一次；仍失败可由另外两名 reviewer 形成结论，但必须记录原因。少于两份可用审查，或存在未解决 Must/Should 时，P1 为 `needs_decision`，不得进入 P2。

- [ ] **Step 3: 同步日志并提交阶段收尾**

按 `my-changelog` 在 `changelog/2026-07-16.md` 追加当前时间条目，记录 UI 改动、自动化验证、视觉尺寸和外审结论。更新本计划：`P1.1`–`P1.Z` 标为 `[x]`、任务文本加删除线、写入 commit/证据，P1 门禁标为 `[x]`，当前下一步改为 `P2.1 Step 1`。

```bash
git add changelog/2026-07-16.md docs/superpowers/plans/2026-07-16-studio-silver-interface-release.md
git diff --cached --check
git commit -m "记录 Studio 银灰界面验收结果"
```

审查方式：外审。判定依据：跨前端与 Desktop 共享 UI，且下一阶段进入公开发布。

---

### P2. 版本、发布与本机升级

- [ ] P2 阶段完成门禁（仅在 `P2.Z` 完成后勾选）
- 阶段目标：确定下一版本、同步所有版本源/文档、生成并发布完整产物、升级真机。
- 阶段门禁：远端版本核对、签名资产、本地/远端验证、Release Check、npm/GitHub 发布和真机升级全部完成。

### P2.1 确认版本并同步版本源、文档和 release notes

**Files:**
- Modify: root and all workspace `package.json`, `package-lock.json`
- Modify: `apps/studio-desktop/src-tauri/Cargo.toml`, `Cargo.lock`, `tauri.conf.json`
- Modify: `apps/studio-desktop/distribution/latest.beta.darwin-aarch64.example.json`
- Modify: `apps/studio-desktop/distribution/latest.stable.darwin-aarch64.example.json`
- Modify: `packages/sdk/src/index.ts`, `packages/runtime/src/mcp/client.ts`
- Modify: current-version assertions in `tests-node/*.test.ts`
- Modify: `README.md`, `docs/distribution/github-release.md`, `docs/distribution/studio-macos.md`
- Create: `docs/distribution/v0.1.11-release-notes.md`（版本按远端核验结果替换）

**Interfaces:**
- Produces: 一个全仓一致的 next patch version，当前预期 `0.1.11`。

- [ ] **Step 1: 核验远端并决定唯一版本**

```bash
git fetch origin main --tags
npm view @jinhx128/agentmesh version --registry https://registry.npmjs.org/
gh release view --repo jinhx128/agentmesh --json tagName,isDraft,isPrerelease,publishedAt
git tag --list 'v0.1.*' --sort=-version:refname | head -5
```

Expected: npm latest 与 GitHub latest 都是 `0.1.10`，目标为 `0.1.11`。若任一远端高于 `0.1.10`，停止本 slice，把目标改为两端最大 stable version 的下一 patch，并同步本计划所有版本化文件名/命令。

- [ ] **Step 2: 先改 current-version contract 并验证 RED**

更新 `package-structure.test.ts`、`readiness.test.ts`、`update.test.ts`、`flow-run.test.ts`、`flow-dispatch.test.ts`、`studio*.test.ts` 中代表“当前运行时/包版本”的旧版本断言。保留 updater fixture 中刻意表达 old/new/prerelease 比较的版本场景。

```bash
npm run build:node
node --test dist-node/tests-node/package-structure.test.js \
  dist-node/tests-node/readiness.test.js dist-node/tests-node/update.test.js \
  dist-node/tests-node/studio-desktop-distribution.test.js
```

Expected: FAIL，package/Tauri/runtime 源仍为旧版本。

- [ ] **Step 3: 同步 canonical version sources**

更新 root + 9 个 workspace package version、内部 `@agentmesh/*` exact dependencies、SDK runtime fallback、MCP client version、Tauri/Cargo version 与 distribution examples。随后：

```bash
npm install --package-lock-only --ignore-scripts
cargo check --manifest-path apps/studio-desktop/src-tauri/Cargo.toml
```

`package-lock.json` 由 npm 生成，`Cargo.lock` 由 Cargo 生成；不手改 lockfile 第三方依赖版本。

- [ ] **Step 4: 同步 README、分发文档和正式 release notes**

README 的资产列表包含目标版本 tgz、DMG、updater archive/signature、`latest.json`、Skill markdown 和 checksums，并明确从 `0.1.10` 需要一次手动 DMG 替换。release notes 使用完整结构：

```md
# AgentMesh v0.1.11

## Highlights

- Studio/Desktop 使用新的银灰浅色界面、青蓝主操作与统一状态反馈。
- Desktop 可在 Settings / About 检查、下载、验证并安装后续签名更新。
- Desktop 可检测、安装和更新 PATH 可见的 npm CLI，无需用户输入安装路径。

## Upgrade notes

- 从 v0.1.10 升级必须手动用本版本 DMG 替换一次 AgentMesh.app；之后可使用应用内更新。
- macOS DMG 仍为未 notarize 的 Apple Silicon 版本，首次打开可能需要右键 Open。
- CLI 是独立渠道，请使用 npm 安装同版本。

## Assets

- agentmesh-0.1.11.tgz
- AgentMesh_0.1.11_aarch64.dmg
- AgentMesh_0.1.11_aarch64.app.tar.gz
- AgentMesh_0.1.11_aarch64.app.tar.gz.sig
- latest.json
- agentmesh-skill-0.1.11.md
- SHA256SUMS
```

若目标版本改变，文件名和正文全部使用实际版本。

- [ ] **Step 5: 验证 GREEN、日志和提交**

```bash
npm test
cargo check --manifest-path apps/studio-desktop/src-tauri/Cargo.toml
rg -n '0\.1\.10' \
  package.json package-lock.json \
  apps/studio/package.json apps/studio-web/package.json apps/studio-desktop/package.json \
  apps/studio-desktop/src-tauri/Cargo.toml apps/studio-desktop/src-tauri/Cargo.lock \
  apps/studio-desktop/src-tauri/tauri.conf.json apps/studio-desktop/distribution/*.json \
  packages/*/package.json packages/sdk/src/index.ts packages/runtime/src/mcp/client.ts
git diff --check
```

Expected: tests/cargo PASS；canonical source 搜索无旧版本。按 `my-changelog` 追加“准备 `<version>` 发布”事实和验证。

```bash
git add package.json package-lock.json apps packages tests-node README.md docs/distribution \
  changelog/2026-07-16.md docs/superpowers/plans/2026-07-16-studio-silver-interface-release.md
git diff --cached --check
git commit -m "发布：准备 AgentMesh 0.1.11"
```

版本变化时 commit message 使用实际版本。审查方式：外审。判定依据：公共包版本、协议自报版本、Tauri 版本和迁移文档必须一致。

### P2.2 完整验证并生成签名发布产物

**Files:**
- Generated/verify only: `dist-node/`, `dist-release/`, `apps/studio-desktop/src-tauri/target/`
- External secrets: `~/.config/agentmesh/updater/agentmesh.key`、Keychain service `dev.agentmesh.studio.updater`

- [ ] **Step 1: 全量自动化与 Desktop smoke**

```bash
npm test
cargo check --manifest-path apps/studio-desktop/src-tauri/Cargo.toml
npm run studio-desktop:package:dev
git diff --check
```

Expected: 全部 PASS；记录实际测试数，不沿用旧的 547 数字。

- [ ] **Step 2: 安全加载签名凭据并准备资产**

```bash
test -f "$HOME/.config/agentmesh/updater/agentmesh.key"
test "$(stat -f '%Lp' "$HOME/.config/agentmesh/updater/agentmesh.key")" = "600"
export TAURI_SIGNING_PRIVATE_KEY="$(< "$HOME/.config/agentmesh/updater/agentmesh.key")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password \
  -a "$USER" -s dev.agentmesh.studio.updater -w)"
npm run release:assets
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

禁止开启 `set -x` 或输出 env。Expected: `dist-release/` 生成 7 个版本化资产。

- [ ] **Step 3: 校验 DMG、checksums、metadata/signature**

```bash
hdiutil verify dist-release/AgentMesh_0.1.11_aarch64.dmg
shasum -a 256 -c dist-release/SHA256SUMS
node -e '
const fs=require("node:fs");
const m=JSON.parse(fs.readFileSync("dist-release/latest.json","utf8"));
const sig=fs.readFileSync("dist-release/AgentMesh_0.1.11_aarch64.app.tar.gz.sig","utf8").trim();
if(m.version!=="0.1.11") throw new Error(`bad version ${m.version}`);
const p=m.platforms["darwin-aarch64"];
if(p.signature!==sig) throw new Error("signature mismatch");
if(!p.url.includes("/v0.1.11/AgentMesh_0.1.11_aarch64.app.tar.gz")) throw new Error(`bad url ${p.url}`);
'
```

实际版本变化时替换版本。Expected: DMG valid、7 个 checksum OK、metadata 与 signature/immutable URL 一致。

- [ ] **Step 4: 记录证据，不提交生成物**

把命令、测试数、资产名/大小、DMG/checksum/metadata 结论写入本计划；不写私钥或 password。`dist-node/`、`dist-release/`、Tauri `target/` 保持 ignored。

审查方式：外审，进入 `P2.3` Release Check。任一关键验证失败即 `not_ready`，修复后重新执行 P2.2 全部步骤。

### P2.3 多模型 Release Check 与发布门禁

- [ ] **Step 1: 生成审查上下文**

```bash
git diff bf3bf6b...HEAD -- . ':(exclude)docs/superpowers/plans/*.md' \
  > /tmp/agentmesh-v0.1.11-release.diff
```

创建 `/tmp/agentmesh-v0.1.11-verification.md`，只写 P2.2 命令/结果、资产清单、跳过项和残余风险。

- [ ] **Step 2: 运行 AgentMesh Release Check**

```bash
agentmesh run --workflow w-67ef1b1f \
  --review a-32c98ad9 --review a-a620d5c5 --review a-a9d455aa \
  --decide current \
  --scope apps/studio-web --scope apps/studio-desktop --scope scripts --scope docs/distribution \
  --context-file docs/superpowers/specs/2026-07-16-studio-silver-interface-design.md \
  --context-file docs/distribution/v0.1.11-release-notes.md \
  --diff-file /tmp/agentmesh-v0.1.11-release.diff \
  --verification-file /tmp/agentmesh-v0.1.11-verification.md \
  --task "审查 AgentMesh v0.1.11 银灰 UI、版本同步、Desktop updater 与发布产物，输出 Must Fix/Should Fix/Nit，重点检查需求偏差、回归、安全、版本一致性和发布门禁。"
```

取得 run id 后 dispatch review，使用 `flow status <run-id> --json` 聚合。`decide=current` 核对每个 finding 后 attach decision，并只包含一个 verdict：`Verdict: ready|not_ready|needs_decision`。

- [ ] **Step 3: 处理 findings 并锁定发布 commit**

接受的 Must/Should 回到对应 slice 修复并重跑，然后重新执行 P2.2 与 Release Check；拒绝 finding 写文件/测试/文档依据。单 reviewer 不可用时 retry 一次或换同能力 reviewer；少于两份可用 review 或存在未解决 Must/Should，verdict 不能为 ready。

ready 后更新本计划/changelog 的审查事实，提交 review 修正与记录，再完整重跑 `npm test`、`cargo check`、`studio-desktop:package:dev`、`release:assets`。发布 commit 后禁止修改 tag 内资产来源。

审查方式：AgentMesh 外审。外审失败策略：高风险发布门禁不得降级普通自审，状态为 `needs_decision`。

### P2.4 推送 main、打 tag、发布 npm 与 GitHub 资产

- [ ] **Step 1: 确认两个 worktree 可安全集成**

```bash
git -C /Users/zz/Documents/WebStorm/agentmesh/.worktrees/desktop-updates status --short --branch
git -C /Users/zz/Documents/WebStorm/agentmesh status --short --branch
git -C /Users/zz/Documents/WebStorm/agentmesh fetch origin main --tags
```

Expected: 实现 worktree clean；root main 无用户修改。若 root main 有用户修改，停止集成并报告，不 stash、不覆盖。

- [ ] **Step 2: 推送分支并 fast-forward main**

```bash
git -C /Users/zz/Documents/WebStorm/agentmesh/.worktrees/desktop-updates push origin codex/desktop-updates
git -C /Users/zz/Documents/WebStorm/agentmesh pull --ff-only origin main
git -C /Users/zz/Documents/WebStorm/agentmesh merge --ff-only codex/desktop-updates
git -C /Users/zz/Documents/WebStorm/agentmesh push origin main
```

Expected: feature 与 `origin/main` 指向同一 release commit。

- [ ] **Step 3: 创建 annotated tag 并推送**

```bash
git -C /Users/zz/Documents/WebStorm/agentmesh tag -a v0.1.11 -m "发布 v0.1.11"
git -C /Users/zz/Documents/WebStorm/agentmesh push origin v0.1.11
```

创建前确认 `HEAD`、feature、`origin/main` 三者一致；实际版本变化时替换 tag。

- [ ] **Step 4: 发布 npm**

```bash
cd /Users/zz/Documents/WebStorm/agentmesh/.worktrees/desktop-updates
git status --short --branch
npm run publish:npm
npm view @jinhx128/agentmesh@0.1.11 version --registry https://registry.npmjs.org/
npm view @jinhx128/agentmesh dist-tags --json --registry https://registry.npmjs.org/
```

Expected: version 和 `latest` 都为目标版本。若 npm 要求 OTP，使用脚本 `--otp` 参数但不记录 OTP。

- [ ] **Step 5: 发布并验证 GitHub Release**

```bash
cd /Users/zz/Documents/WebStorm/agentmesh/.worktrees/desktop-updates
test -f dist-release/AgentMesh_0.1.11_aarch64.dmg
test -f dist-release/AgentMesh_0.1.11_aarch64.app.tar.gz.sig
npm run publish:github -- --notes-file docs/distribution/v0.1.11-release-notes.md --skip-build
npm run release:github:verify -- --compare-local
gh release view v0.1.11 --repo jinhx128/agentmesh \
  --json tagName,isDraft,isPrerelease,assets,publishedAt
```

如果任一 `test -f` 失败，不使用 `--skip-build` 碰运气；按 P2.2 Step 2 重新安全加载签名凭据并执行 `npm run release:assets`，再重新检查工作区 clean。Expected: non-draft/non-prerelease；7 个资产完整；digest 与本地相同；stable `latest.json` 报告目标版本。

审查方式：Release Check ready + 发布脚本确定性验证。失败策略：npm 或 GitHub 任一半失败时不宣布完成，只修复缺失渠道；同版本源内容不变时允许补传，不重新 tag。

### P2.5 更新本机 CLI/Desktop 并记录发布结果

- [ ] **Step 1: 更新 PATH CLI**

```bash
npm install --global @jinhx128/agentmesh@0.1.11 --registry https://registry.npmjs.org/
command -v agentmesh
agentmesh --version
agentmesh update check --json
```

Expected: PATH 指向 npm global CLI，version 为目标版本，update check 报 current。

- [ ] **Step 2: 首次手动替换 updater-enabled Desktop**

```bash
osascript -e 'tell application "AgentMesh" to quit' || true
mount_dir="$(mktemp -d)"
hdiutil attach -nobrowse -readonly -mountpoint "$mount_dir" \
  dist-release/AgentMesh_0.1.11_aarch64.dmg
rm -rf -- /Applications/AgentMesh.app
ditto --rsrc --extattr "$mount_dir/AgentMesh.app" /Applications/AgentMesh.app
hdiutil detach "$mount_dir"
rmdir "$mount_dir"
open /Applications/AgentMesh.app --args --workspace /Users/zz/Documents/WebStorm/agentmesh
```

该删除仅针对用户明确授权更新的 `/Applications/AgentMesh.app`，且只在 DMG 验证成功后执行。

- [ ] **Step 3: 真机验证**

```bash
defaults read /Applications/AgentMesh.app/Contents/Info CFBundleShortVersionString
node -e "const p=require('/Applications/AgentMesh.app/Contents/Resources/package.json'); console.log(p.version)"
pgrep -fl 'agentmesh-studio-desktop|AgentMesh.app/Contents/Resources/dist-node/apps/studio-desktop/sidecar/node'
```

在 Settings/About 检查应用更新为“已是最新”；Agent Integrations 的 CLI 检测显示同版本。退出 app 后验证 sidecar 自动结束，再重新打开最终 App。

- [ ] **Step 4: 写发布后证据、提交并推送 main**

按 `my-changelog` 追加 npm/GitHub/资产/真机/sidecar/updater check 事实。此 evidence commit 位于 release tag 之后，不改变已发布资产：

```bash
git add changelog/2026-07-16.md docs/superpowers/plans/2026-07-16-studio-silver-interface-release.md
git diff --cached --check
git commit -m "记录 AgentMesh 0.1.11 发布与本机升级结果"
git push origin codex/desktop-updates
git -C /Users/zz/Documents/WebStorm/agentmesh merge --ff-only codex/desktop-updates
git -C /Users/zz/Documents/WebStorm/agentmesh push origin main
```

审查方式：自审。判定依据：只记录 registry/Release/真机命令证明的事实，不改变 release tag 源码。

### P2.Z 项目收尾校准

- [ ] **Step 1: 聚合发布门禁**

在本计划记录唯一结论 `ready|not_ready|needs_decision`，包含 diff 摘要、验证命令/结果、跳过项、接受/拒绝/未解决 findings、残余风险和决策依据。只有 npm、GitHub、CLI、Desktop 四项全部完成才可为 `ready`。

- [ ] **Step 2: 文档与仓库终检**

```bash
git status --short --branch
git log -8 --oneline --decorate
npm view @jinhx128/agentmesh version --registry https://registry.npmjs.org/
gh release view v0.1.11 --repo jinhx128/agentmesh --json tagName,isDraft,isPrerelease
agentmesh --version
defaults read /Applications/AgentMesh.app/Contents/Info CFBundleShortVersionString
```

检查 README、distribution docs、release notes、changelog 和本计划版本一致。`index.html` 是 Studio runtime HTML，不是文档首页，无需更新。

- [ ] **Step 3: 完成计划状态**

把 `P2.1`–`P2.Z` 与 P2 门禁标为 `[x]` 并加删除线，写完整进度记录；当前下一步改为“无，任务完成”。若产生 tracked diff，提交中文文档 commit 并 fast-forward/push main。

## 5. 整体验证矩阵

- 自动化：`npm test`、`npm run build`、`cargo check`、`studio-desktop:package:dev`、`git diff --check`。
- UI 手工：Run/Call/Settings/Definitions/Manual、modal/drawer、update/error；`1280 x 720`、`1024 x 640`。
- 资产：DMG verify、checksums、updater signature/URL/version、7 个 GitHub assets。
- Registry：npm version/dist-tag，GitHub non-draft Release 与 remote digest。
- 真机：PATH CLI、App Info/package version、Desktop/sidecar、退出清理、updater current。
- 审查：P1 Review Gate、P2 Release Check；finding 先事实核对再接受/拒绝。

## 6. 风险与回滚

- CSS 全局 selector 影响隐藏页面；规避：旧 layout contract + 全视图验收；回滚：逐个 UI commit revert。
- 银灰低对比；规避：AA contrast、focus-visible、solid fallback；回滚：只调整 role token。
- 版本源不一致；规避：tests RED 后同步 package/Tauri/runtime/lock/docs；回滚：发布前 revert P2.1。
- npm/GitHub 半发布；规避：同一 release commit/tag + remote verify；回滚：不覆盖 npm，补齐 GitHub 或发布新 patch。
- 0.1.10 不能自动升级首个 updater 版本；规避：release notes 明示 + 手动替换本机 DMG。
- reviewer 失败；规避：三 reviewer fanout + retry；少于两份有效 review 时 `needs_decision`。

## 7. 计划维护规则

- 本文件是当前任务唯一事实源；Visual Companion HTML 不是实施计划。
- 一次只推进一个 slice；commit 前不开始下一 slice。
- 完成项改成 `- [x] ~~P<n>.<m> ...~~`，下一行写状态、时间、验证、审查、finding、changelog、commit 和下一步。
- 每个 P 阶段必须完成 `.Z` 校准才能勾选阶段门禁。
- 后续 agent 的判断、风险和证据写回本计划或 changelog，不依赖聊天私有上下文。

## 8. 当前下一步

- 当前下一步：`P1.4 Step 1`，写响应式、focus 与 reduced-motion RED contract。
