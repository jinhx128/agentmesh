# Studio Converge 品牌标记实施计划

> 状态（2026-07-16）：历史已完成。实现提交为 `9ed581d`；随后用户批准从 Studio 页面移除 logo，Desktop canonical 图标仍保留。下方未勾选项不再作为执行状态，当前唯一事实源为 `2026-07-16-studio-activity-and-v012-release.md`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Studio 左上角直接复用唯一 canonical Converge SVG，删除独立设计的圆芯/双轨道标记。

**Architecture:** `apps/studio-desktop/src-tauri/icons/agentmesh.svg` 继续作为唯一可编辑源；`StudioBrandMark` 使用 `new URL("...svg?no-inline", import.meta.url).href` 引用并渲染装饰性图片，同时兼容 Node 静态渲染与 Vite asset 转换。`?no-inline` 保证 production build 输出带 hash 的 SVG asset；Vite dev server 只增加 canonical icon 目录读取权限。

**Tech Stack:** React 19、TypeScript 5.9、Vite 8、CSS、Node.js `node:test`

## Global Constraints

- 不修改 canonical Converge SVG、PNG、ICNS 或 ICO。
- 不复制或内联第二份 SVG path markup。
- 不改变 App 路由、API、状态、导航布局、主题或 Tauri updater。
- 图标保持装饰性，页面可访问名称继续来自 `AgentMesh` 标题。
- 完成后继续并入当前 `0.1.12` 发布，不单独创建新版本。

---

### Task 1: 用 canonical SVG 替换 Studio 独立品牌图形

**Files:**
- Modify: `tests-node/studio-ui.test.ts`
- Modify: `apps/studio-web/src/app/StudioBrandMark.tsx`
- Modify: `apps/studio-web/src/styles.css`
- Modify: `apps/studio-web/vite.config.ts`

**Interfaces:**
- Consumes: `apps/studio-desktop/src-tauri/icons/agentmesh.svg` canonical asset。
- Produces: `StudioBrandMark(): ReactElement`，DOM 为单个装饰性 `<img className="studio-brand-mark">`。

- [x] **Step 1: 写 RED 品牌一致性 contract**

将 `Studio silver shell renders the approved brand hierarchy` 改为断言：

```ts
assert.match(brandSource, /new URL\(/);
assert.match(brandSource, /agentmesh\.svg\?no-inline/);
assert.match(brandSource, /import\.meta\.url/);
assert.doesNotMatch(brandSource, /\?url/);
assert.match(brandSource, /<img/);
assert.match(brandSource, /className="studio-brand-mark"/);
assert.match(brandSource, /src=\{agentMeshIconUrl\}/);
assert.match(brandSource, /alt=""/);
assert.match(brandSource, /aria-hidden="true"/);
assert.match(brandSource, /draggable=\{false\}/);
assert.doesNotMatch(brandSource, /studio-brand-(?:core|track)/);
assert.doesNotMatch(frontendCss, /\.studio-brand-(?:core|track)/);
assert.match(viteConfigSource, /studio-desktop\/src-tauri\/icons/);
```

- [x] **Step 2: 验证 RED**

Run:

```bash
npm run build:node
node --test --test-name-pattern "Studio silver shell" dist-node/tests-node/studio-ui.test.js
```

Expected: FAIL，现有组件仍包含 `studio-brand-core` 与 `studio-brand-track-*`，且未导入 canonical SVG。

- [x] **Step 3: 写最小实现**

`StudioBrandMark.tsx` 使用：

```tsx
import type { ReactElement } from "react";

const agentMeshIconUrl = new URL(
  "../../../studio-desktop/src-tauri/icons/agentmesh.svg?no-inline",
  import.meta.url,
).href;

export function StudioBrandMark(): ReactElement {
  return (
    <img
      className="studio-brand-mark"
      src={agentMeshIconUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
```

`vite.config.ts` 增加：

```ts
const canonicalIconDir = fileURLToPath(
  new URL("../studio-desktop/src-tauri/icons/", import.meta.url),
);
```

并将 `server.fs.allow` 改为 `[studioRoot, canonicalIconDir]`。`styles.css` 删除 core/track selectors，把 `.studio-brand-mark` 收敛为：

```css
.studio-brand-mark {
  display: block;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  object-fit: contain;
}
```

- [x] **Step 4: 验证 GREEN**

Run:

```bash
npm run build
node --test --test-name-pattern "Studio silver shell|canonical AgentMesh icon" \
  dist-node/tests-node/studio-ui.test.js \
  dist-node/tests-node/studio-desktop-distribution.test.js
git diff --check
```

Expected: selected tests PASS；Vite 输出包含 canonical SVG asset；旧 core/track contract 为 0。

进度记录：Task 1 已完成。RED 以缺少 canonical `agentmesh.svg` 引用失败；首次 `?url` 实现暴露 root `tsc` 缺少 Vite asset type，局部声明后又由 Node 静态渲染暴露 ESM 无法加载 asset module。最终使用同时兼容 Node 与 Vite 的 `new URL("...agentmesh.svg?no-inline", import.meta.url).href`；`?no-inline` 避免 692-byte SVG 被内联。GREEN 为 canonical icon/silver shell 2/2，Vite 产出 `agentmesh-Brvk6PAm.svg`，旧 core/track 源码为 0，`git diff --check` 通过。

### Task 2: 浏览器验收、日志与提交

**Files:**
- Modify: `changelog/2026-07-16.md`
- Modify: `docs/superpowers/plans/2026-07-16-studio-converge-brand-mark.md`

**Interfaces:**
- Consumes: Task 1 构建后的 Studio frontend。
- Produces: 两个目标尺寸的视觉证据、完整测试证据和独立品牌修正 commit。

- [x] **Step 1: 浏览器视觉验收**

在 `1280 x 720` 与 `1024 x 640` 检查：左上角为四色 Converge 图标、浅色圆角底板未裁切、没有旧双轨道图形、标题未挤压、console error 为 0。

- [x] **Step 2: 完整回归**

Run:

```bash
npm test
npm run studio-desktop:package:dev
git diff --check
```

Expected: Node tests 0 failed；Desktop package `ok: true`；diff check 无输出。

进度记录：`npm test` 553/553，`npm run studio-desktop:package:dev` 为 `ok: true`，`git diff --check` 通过。浏览器在 `1280 x 720` 与 `1024 x 640` 均确认左上角为 canonical 四色 Converge 图标，浅色圆角底板、标题和品牌 lockup 未裁切，旧双轨道图形已消失；`1024 x 640` 下图标为 `44 x 44`、横向溢出为 0，两个尺寸 console error 均为 0。用户已确认外观。

- [x] **Step 3: 同步 changelog 与计划证据**

在 `changelog/2026-07-16.md` 追加事实：Studio 内品牌标记改为 canonical Converge SVG、旧图形已删除、两个尺寸和自动化验证结果。把本计划所有 checklist 标为完成并记录实际命令、测试数与截图/浏览器结论。

- [x] **Step 4: 提交品牌修正**

```bash
git add apps/studio-web/src/app/StudioBrandMark.tsx \
  apps/studio-web/src/styles.css apps/studio-web/vite.config.ts \
  tests-node/studio-ui.test.ts changelog/2026-07-16.md \
  docs/superpowers/plans/2026-07-16-studio-converge-brand-mark.md
git diff --cached --check
git commit -m "界面：统一 Studio 与 Converge 应用图标"
```

完成定义：canonical asset 单一来源、RED/GREEN 证据、目标尺寸视觉验收、完整回归、changelog 和独立 commit 全部完成；随后返回 `0.1.12` 发布收尾。

进度记录：上述品牌范围已作为独立 `界面：统一 Studio 与 Converge 应用图标` commit 提交，未混入 `0.1.12` 启动修复与版本同步文件。
