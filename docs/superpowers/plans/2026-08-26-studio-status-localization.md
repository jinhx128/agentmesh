# Studio 状态中文化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Studio 普通界面的已知状态全部显示中文，同时保持 API、记录、请求和日志中的英文枚举不变。

**Architecture:** 新增一个前端状态展示模块，按 Call、运行、Reviewer Session、发布结论、Skill 和错误类型分别映射，避免同值跨语境误译。组件只在渲染文本时调用映射函数，原始状态继续参与 CSS、条件判断和请求。

**Tech Stack:** TypeScript、React、Mantine、Node.js test runner、React DOM Server

## Global Constraints

- 不修改运行时 schema、API 类型、本地记录或 CLI 的英文枚举。
- 不翻译 Agent、适配器、模型、文件名、命令、日志和诊断原文。
- 已知状态显示中文，未知状态在普通界面统一显示“未知状态”。
- 状态颜色、操作行为、接口请求和历史数据格式保持不变。

---

### Task 1: 建立按业务域区分的状态展示模块

**Files:**
- Create: `apps/studio-web/src/app/status-labels.ts`
- Modify: `tests-node/studio-ui.test.ts`

**Interfaces:**
- Consumes: `StudioCallStatus`、`StudioCallAdoptionStatus`、`StudioSkillTargetReport["status"]`、`workflowStageLabel()`。
- Produces: `callStatusLabel()`、`callAdoptionStatusLabel()`、`runStatusLabel()`、`reviewerSessionModeLabel()`、`releaseVerdictLabel()`、`skillTargetStatusLabel()`、`callErrorKindLabel()`、`viewStateLabel()`。

- [ ] **Step 1: Write the failing test**

在 `tests-node/studio-ui.test.ts` 导入展示函数，并新增断言：

```ts
test("Studio status labels localize known domain values and hide unknown enums", () => {
  assert.equal(callStatusLabel("success"), "成功");
  assert.equal(callAdoptionStatusLabel("superseded"), "已取代");
  assert.equal(runStatusLabel("review_running"), "审查中");
  assert.equal(reviewerSessionModeLabel("interactive_continuous"), "连续会话");
  assert.equal(releaseVerdictLabel("not_ready"), "暂不可发布");
  assert.equal(skillTargetStatusLabel("content_mismatch"), "内容不一致");
  assert.equal(callErrorKindLabel("provider_auth"), "Provider 登录失败");
  assert.equal(viewStateLabel("error"), "错误");
  assert.equal(runStatusLabel("future_state"), "未知状态");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:node`

Expected: FAIL because `apps/studio-web/src/app/status-labels.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

创建 `status-labels.ts`。使用穷尽映射处理 Call 和 Skill 的联合类型；运行状态识别 `created/pending/running/success/completed/failed/error/aborted/cancelled/timeout/timed_out/stale` 及 `<stage>_<suffix>`；Reviewer Session、发布结论、Call 错误类型和视图状态使用独立映射。所有未知值返回“未知状态”，`releaseVerdictLabel(null)` 返回“暂无结论”，`callErrorKindLabel("none")` 返回“无错误”。

核心签名：

```ts
export function callStatusLabel(status: StudioCallStatus): string;
export function callAdoptionStatusLabel(status: StudioCallAdoptionStatus): string;
export function runStatusLabel(status: string | null | undefined): string;
export function reviewerSessionModeLabel(mode: string): string;
export function releaseVerdictLabel(verdict: string | null | undefined): string;
export function skillTargetStatusLabel(status: StudioSkillTargetReport["status"]): string;
export function callErrorKindLabel(kind: string): string;
export function viewStateLabel(status: string): string;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build:node && node --test --test-name-pattern "Studio status labels" dist-node/tests-node/studio-ui.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio-web/src/app/status-labels.ts tests-node/studio-ui.test.ts
git commit -m "界面：增加状态中文映射"
```

### Task 2: 中文化 Call 详情的所有状态文本

**Files:**
- Modify: `apps/studio-web/src/features/calls/CallDetailView.tsx`
- Modify: `tests-node/studio-ui.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `callStatusLabel()`、`callAdoptionStatusLabel()`、`callErrorKindLabel()`、`viewStateLabel()`。
- Produces: Call 详情头部、指标、采纳历史、禁用原因和反馈消息的中文状态展示。

- [ ] **Step 1: Write the failing rendering test**

扩展现有 Call 详情测试：

```ts
const localizedDetail = studioCallDetailFixture();
localizedDetail.call.status = "success";
localizedDetail.call.adoption_status = "superseded";
localizedDetail.adoption_events[0]!.status = "superseded";
const localizedHtml = renderCallDetailView({ status: "ready", detail: localizedDetail });
assert.match(localizedHtml, /成功 · 采纳 · 已取代/);
assert.match(localizedHtml, />已取代</);
assert.doesNotMatch(localizedHtml, />success</);
assert.doesNotMatch(localizedHtml, />superseded</);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:node && node --test --test-name-pattern "Call detail renders" dist-node/tests-node/studio-ui.test.js`

Expected: FAIL because the rendered HTML still contains `success` and `superseded`.

- [ ] **Step 3: Apply the display mappings**

在 `CallDetailView.tsx` 中：

- 头部 meta 和两个指标使用中文标签。
- 采纳历史使用 `callAdoptionStatusLabel(event.status)`。
- 已处理提示、提交中/成功消息和响应消息不再拼接英文状态。
- 失败摘要使用 `callErrorKindLabel(call.error_kind)`；`exit=<number>` 保留技术格式。
- 错误占位页头使用 `viewStateLabel("error")`。
- 保留 `className={\`status ${call.status}\`}` 和提交请求的英文枚举。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build:node && node --test --test-name-pattern "Call detail renders" dist-node/tests-node/studio-ui.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio-web/src/features/calls/CallDetailView.tsx tests-node/studio-ui.test.ts
git commit -m "界面：中文化调用状态"
```

### Task 3: 中文化其余 Studio 状态表面

**Files:**
- Modify: `apps/studio-web/src/features/runs/RunOverview.tsx`
- Modify: `apps/studio-web/src/features/review-release/ReviewReleaseView.tsx`
- Modify: `apps/studio-web/src/features/settings/AgentIntegrationsPanel.tsx`
- Modify: `apps/studio-web/src/features/agents/AgentLifecyclePanel.tsx`
- Modify: `apps/studio-web/src/features/navigation/ActivityNavigator.tsx`
- Modify: `tests-node/studio-ui.test.ts`

**Interfaces:**
- Consumes: Task 1 的运行、会话、发布、Skill 和视图状态展示函数。
- Produces: 运行总览、Reviewer Session、发布结论、Skill 状态和活动提示的中文展示。

- [ ] **Step 1: Write failing integration assertions**

在已有各组件渲染测试中加入：

```ts
const localizedRun = studioRunDetailFixture();
localizedRun.summary.status = "review_running";
assert.match(renderRunOverview({ status: "ready", detail: localizedRun }), /审查中/);
assert.match(reviewerSessionOverview, /连续会话/);
assert.match(releaseHtml, /需要决策/);
const mismatchedIntegrations = integrationsFixture();
mismatchedIntegrations.skills.targets[0]!.status = "content_mismatch";
const mismatchHtml = renderAgentIntegrationsPanel({ status: "ready", report: mismatchedIntegrations });
assert.match(mismatchHtml, /内容不一致/);
assert.doesNotMatch(mismatchHtml, />content_mismatch</);
```

并更新活动状态测试，确认 `title` 和 `aria-label` 不含原始英文枚举。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build:node && node --test --test-name-pattern "Run overview|Reviewer session|Review release|Agent integrations|activity status" dist-node/tests-node/studio-ui.test.js`

Expected: FAIL on the new Chinese assertions.

- [ ] **Step 3: Apply mappings to each component**

- `RunOverview.tsx`：总览头部和状态字段调用 `runStatusLabel()`；Session 模式调用 `reviewerSessionModeLabel()`；错误 meta 调用 `viewStateLabel()`。
- `ReviewReleaseView.tsx`：两个发布结论 Badge 调用 `releaseVerdictLabel()`，颜色判断继续使用原始值。
- `AgentIntegrationsPanel.tsx`：Skill target Code 改为 `skillTargetStatusLabel(target.status)`。
- `AgentLifecyclePanel.tsx`：非嵌入页头中的加载/错误 meta 调用 `viewStateLabel()`。
- `ActivityNavigator.tsx`：状态 Badge 的 `title` 与 `aria-label` 只使用中文展示值。

- [ ] **Step 4: Run targeted and full Studio tests**

Run:

```bash
npm run build:node
node --test dist-node/tests-node/studio-ui.test.js
npm run build:studio-frontend
```

Expected: all commands PASS with no TypeScript or Vite errors.

- [ ] **Step 5: Commit**

```bash
git add apps/studio-web/src/features/runs/RunOverview.tsx apps/studio-web/src/features/review-release/ReviewReleaseView.tsx apps/studio-web/src/features/settings/AgentIntegrationsPanel.tsx apps/studio-web/src/features/agents/AgentLifecyclePanel.tsx apps/studio-web/src/features/navigation/ActivityNavigator.tsx tests-node/studio-ui.test.ts
git commit -m "界面：统一 Studio 状态中文显示"
```

### Task 4: 最终验证与范围检查

**Files:**
- Modify only if verification finds a defect in the files already listed.

**Interfaces:**
- Consumes: Tasks 1–3 的完整实现。
- Produces: 可交付的构建和测试证据。

- [ ] **Step 1: Search for remaining raw status rendering**

Run:

```bash
rg -n 'meta=\{[^\n]*status|value=\{[^}]+\.status|>\{[^}]+\.status\}<' apps/studio-web/src --glob '*.tsx'
```

Expected: matches are either routed through a label function or intentionally retained as non-text logic; no known status enum is directly rendered in ordinary UI.

- [ ] **Step 2: Run regression verification**

Run:

```bash
npm run build
node --test dist-node/tests-node/studio-ui.test.js
npm run check:boundaries
git diff --check
```

Expected: all commands PASS and `git diff --check` prints nothing.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --stat HEAD~3..HEAD && git status --short --branch`

Expected: only the planned Studio status files, tests and plan document changed; worktree is clean after commits.
