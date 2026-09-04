# Call Artifact Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将调用产物改为右侧纵向选择、主区域下方单一内容预览。

**Architecture:** `CallDetailView` 根据详情中已加载的三个预览建立本地选择状态。组件内部拆分主区、产物侧栏和选中内容区，CSS 在桌面端使用双栏，在窄屏改为单栏。

**Tech Stack:** React 19、Mantine、TypeScript、Node test、CSS。

## Global Constraints

- 不修改 API 和 Call Record。
- 默认选择顺序为输出、提示词、错误输出。
- 侧栏固定展示提示词、输出和错误输出；状态为“已生成 / 无内容”。
- 提示词使用调用创建时间，输出和错误输出使用调用结束时间，缺少结束时间时显示 `--:--:--`。
- 失败摘要不是产物，只在内容模块中展示。
- 保留工作区已有未提交改动。

### Task 1: 调用产物双栏布局

**Files:**
- Modify: `tests-node/studio-ui.test.ts`
- Modify: `apps/studio-web/src/features/calls/CallDetailView.tsx`
- Modify: `apps/studio-web/src/styles.css`

**Interfaces:**
- Consumes: `StudioCallDetail.prompt/output/stderr`
- Produces: 内部产物描述、默认选择函数、右侧列表和单一内容预览

- [x] **Step 1: 写失败测试**

断言调用详情包含右侧纵向产物列表、默认选中输出、主区仅渲染一次预览内容，并且不存在旧横向流程和三列网格。

- [x] **Step 2: 验证测试因缺少新布局失败**

Run: `npm run build:node && node --test --test-name-pattern "Call detail renders invocation evidence" dist-node/tests-node/studio-ui.test.js`

Expected: FAIL，缺少 `call-artifact-sidebar` 或仍存在 `call-detail-evidence-grid`。

- [x] **Step 3: 实现最小组件改动**

加入内部 `selectedArtifactId`，按 `output -> prompt -> stderr` 选择默认值；渲染 `call-workspace-main`、`call-artifact-sidebar` 和单个 `CallPreviewPanel`。

- [x] **Step 4: 增加响应式样式**

桌面端使用主区加窄侧栏网格；移动端改为单栏，并将侧栏排到内容前。

- [x] **Step 5: 验证**

Run: `npm run build:node && node --test --test-name-pattern "Call detail renders invocation evidence" dist-node/tests-node/studio-ui.test.js`

Run: `npm run build:studio-frontend`

Expected: 定向测试与前端构建均通过。

### Task 2: 固定产物项与时间

**Files:**
- Modify: `tests-node/studio-ui.test.ts`
- Modify: `apps/studio-web/src/features/calls/CallDetailView.tsx`
- Modify: `apps/studio-web/src/app/copy.ts`

- [x] **Step 1: 写失败测试**

断言没有错误输出文件时仍展示“错误输出”，三项分别显示“已生成 / 无内容”，并使用创建时间或结束时间。

- [x] **Step 2: 实现并验证**

保持三项固定，增加状态和时间展示；运行 Studio UI 测试、前端构建和桌面端实测。

### Task 3: 调用 Markdown 预览

**Files:**
- Modify: `tests-node/studio-ui.test.ts`
- Modify: `apps/studio-web/src/features/artifacts/ArtifactPreviewPanel.tsx`
- Modify: `apps/studio-web/src/features/calls/CallDetailView.tsx`

- [x] **Step 1: 写失败测试并验证**

断言 `.md` 输出产生标题、强调和列表节点，并确认旧实现因纯文本展示而失败。

- [x] **Step 2: 复用运行产物 Markdown 渲染**

导出既有安全 React Markdown 渲染函数；调用详情按 `.md` / `.markdown` 扩展名使用它，其他文件保留纯文本。

- [x] **Step 3: 完整验证与本机安装**

运行 Studio UI 测试、前端构建、真实页面验证，并重新安装桌面端。

### Task 4: 调用详情与关联 Tab

**Files:**
- Modify: `tests-node/studio-ui.test.ts`
- Modify: `apps/studio-web/src/features/calls/CallDetailView.tsx`

**Interfaces:**
- Consumes: `StudioCallDetail.call.id`、既有 `CallMetric` 与 `CallRelated`
- Produces: `call-detail-tabs`、`details` / `related` 两个 Tab 面板

- [x] **Step 1: 写失败测试**

在 `Call detail renders a vertical artifact sidebar and one selected artifact preview` 中断言：

```ts
assert.match(html, /data-studio-section="call-detail-tabs"/);
assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>详情</);
assert.match(html, /role="tab"[^>]*>关联</);
assert.doesNotMatch(html, /call-detail-summary[\s\S]*call-detail-related-panel/);
assert.match(html, /call-detail-tabs[\s\S]*call-detail-evidence-panel/);
```

- [x] **Step 2: 运行测试并确认红灯**

Run: `npm run build:node && node --test --test-name-pattern "Call detail renders a vertical artifact sidebar" dist-node/tests-node/studio-ui.test.js`

Expected: FAIL，缺少 `data-studio-section="call-detail-tabs"`。

- [x] **Step 3: 实现最小 Tab 结构**

在 `CallDetailView.tsx` 导入 `Tabs`，将详情和关联卡片改为：

```tsx
<Tabs key={call.id} defaultValue="details" keepMounted={false} data-studio-section="call-detail-tabs">
  <Tabs.List aria-label={t("callsSubtitle")} grow>
    <Tabs.Tab value="details">{t("details")}</Tabs.Tab>
    <Tabs.Tab value="related">{t("related")}</Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel value="details" pt="md">...</Tabs.Panel>
  <Tabs.Panel value="related" pt="md">...</Tabs.Panel>
</Tabs>
```

`CallWarnings` 与 `CallEvidencePanel` 保持在 Tabs 之后，右侧 `CallArtifactSidebar` 不变；`key={call.id}` 保证切换调用时恢复默认详情。

- [x] **Step 4: 运行定向与完整验证**

Run: `npm run build:node && node --test --test-name-pattern "Call detail renders a vertical artifact sidebar" dist-node/tests-node/studio-ui.test.js`

Run: `node --test dist-node/tests-node/studio-ui.test.js && npm run build:studio-frontend && git diff --check`

Expected: 定向测试通过，Studio UI 测试全部通过，前端构建和 diff 检查通过。

- [x] **Step 5: 浏览器验收与本机安装**

在本地 Studio 中验证默认详情、切换关联、内容和产物持续可见、切换调用恢复详情；随后构建、签名并替换 `/Applications/AgentMesh.app`，核对版本、签名和进程路径。

**审查：** 本任务为局部 UI 结构调整，复用既有 Tab 组件，不改 API、数据或公共接口；定向测试、完整 Studio UI 测试与浏览器验收充分覆盖，采用主控自审，不发起外审。

**日志 / 提交：** 本轮不单独新增 changelog；未收到提交请求，不创建 commit。
