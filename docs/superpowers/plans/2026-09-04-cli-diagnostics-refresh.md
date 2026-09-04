# CLI 检测刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置 / 环境的命令行工具与 CLI 检测标题栏增加“刷新”按钮，重新读取 AgentMesh CLI 和本机 Provider CLI 状态且不清空现有结果。

**Architecture:** 复用现有 `loadStudioIntegrations` 请求。`App` 提供一个返回 `Promise<void>` 的静默刷新回调，只在成功时替换完整报告；`AgentIntegrationsPanel` 管理按钮的互斥加载状态及成功、失败 toast。

**Tech Stack:** React 18、TypeScript、Mantine、Node `node:test`、Vite。

## Global Constraints

- 复用 `GET /api/desktop/integrations`，不增加后端 API。
- 按钮名称固定为“刷新”；命令行工具页按钮位于状态徽标左侧，CLI 检测页按钮位于检测数量徽标左侧。
- 刷新时保留当前列表，不能把整个环境页切换成 `loading` 或 `error`。
- 成功和失败提示按入口区分：命令行工具使用“命令行工具状态已刷新”/“命令行工具状态刷新失败”，CLI 检测使用“CLI 检测已刷新”/“CLI 检测刷新失败”；失败提示保留规范化错误。
- 刷新未结束时忽略重复触发。
- 不增加依赖，不改变 CLI 探测规则、路径解析或版本检测逻辑。

---

### Task 1: 固化 CLI 检测刷新 UI 契约

**Files:**
- Modify: `/Users/zz/Documents/WebStorm/agentmesh/tests-node/studio-ui.test.ts:2243-2260`
- Modify: `/Users/zz/Documents/WebStorm/agentmesh/tests-node/studio-ui.test.ts:3198-3235`

**Interfaces:**
- Consumes: `renderAgentIntegrationsPanel(state)`、`renderSettingsView("environment")`。
- Produces: `AgentIntegrationsPanelProps.onRefreshIntegrations: () => Promise<void>` 的测试调用方，以及刷新按钮和静默刷新源码契约。

- [x] **Step 1: 写失败的 SSR 与源码契约断言**

为现有 integrations 断言增加：

```ts
assert.match(integrations, /data-studio-action="refresh-command-line-tool"/);
assert.match(integrations, /data-studio-action="refresh-cli-diagnostics"/);
assert.match(integrations, />刷新</);
assert.match(integrations, /data-studio-action="refresh-cli-diagnostics"[\s\S]*>1\/2</);
assert.match(agentIntegrationsSource, /refreshBusyRef\.current/);
assert.match(agentIntegrationsSource, /"命令行工具状态已刷新"/);
assert.match(agentIntegrationsSource, /"命令行工具状态刷新失败"/);
assert.match(agentIntegrationsSource, /"CLI 检测已刷新"/);
assert.match(agentIntegrationsSource, /"CLI 检测刷新失败"/);
const refreshAgentIntegrationsSource = appSource.slice(
  appSource.indexOf("async function refreshAgentIntegrations"),
  appSource.indexOf("async function createAgent"),
);
assert.match(refreshAgentIntegrationsSource, /loadStudioIntegrations\(apiClient\)/);
assert.match(refreshAgentIntegrationsSource, /setAgentIntegrationsState\(\{ status: "ready", report \}\)/);
assert.doesNotMatch(refreshAgentIntegrationsSource, /status: "loading"|status: "error"/);
```

在两个渲染 helper 的环境属性中加入：

```ts
onRefreshIntegrations: async () => {},
```

- [x] **Step 2: 运行定向测试并确认失败**

Run:

```bash
npm run build:node
node --test dist-node/tests-node/studio-ui.test.js
```

Expected: FAIL，刷新按钮和新回调尚不存在。

### Task 2: 实现保留旧结果的环境状态刷新

**Files:**
- Modify: `/Users/zz/Documents/WebStorm/agentmesh/apps/studio-web/src/features/settings/AgentIntegrationsPanel.tsx:1-245`
- Modify: `/Users/zz/Documents/WebStorm/agentmesh/apps/studio-web/src/app/App.tsx:440-455`
- Modify: `/Users/zz/Documents/WebStorm/agentmesh/apps/studio-web/src/app/App.tsx:1120-1148`

**Interfaces:**
- Consumes: `loadStudioIntegrations(client)`、`normalizeStudioApiError(error)`、现有 `showStudioSuccess` 和 `showStudioError`。
- Produces: `AgentIntegrationsPanelProps.onRefreshIntegrations: () => Promise<void>`。

- [x] **Step 1: 给环境面板增加刷新回调和互斥状态**

扩展属性并在组件内加入：

```ts
onRefreshIntegrations: () => Promise<void>;

const [refreshBusy, setRefreshBusy] = useState(false);
const refreshBusyRef = useRef(false);

async function refreshIntegrations(successTitle: string, failureTitle: string): Promise<void> {
  if (refreshBusyRef.current) return;
  refreshBusyRef.current = true;
  setRefreshBusy(true);
  try {
    await onRefreshIntegrations();
    showStudioSuccess(successTitle);
  } catch (error) {
    showStudioError(failureTitle, readableError(error, "请稍后重试"));
  } finally {
    refreshBusyRef.current = false;
    setRefreshBusy(false);
  }
}
```

- [x] **Step 2: 在两个标题栏增加小型刷新按钮**

命令行工具标题栏使用 `data-studio-action="refresh-command-line-tool"`，点击时调用 `refreshIntegrations("命令行工具状态已刷新", "命令行工具状态刷新失败")`；CLI 检测标题栏使用 `data-studio-action="refresh-cli-diagnostics"`，点击时调用 `refreshIntegrations("CLI 检测已刷新", "CLI 检测刷新失败")`。两处顺序均固定为按钮、徽标：

```tsx
<Group gap="xs" wrap="nowrap">
  <Button
    size="xs"
    variant="light"
    loading={refreshBusy}
    disabled={refreshBusy}
    data-studio-action="refresh-cli-diagnostics"
    onClick={() => void refreshIntegrations("CLI 检测已刷新", "CLI 检测刷新失败")}
    leftSection={<RefreshIcon />}
  >
    刷新
  </Button>
  <Badge>{providerCliRows.filter((tool) => tool.found).length}/{providerCliRows.length}</Badge>
</Group>
```

`RefreshIcon` 使用现有 Studio 刷新图标的 18×18 SVG 路径，设置 `aria-hidden="true"` 和 `focusable="false"`，不增加图标依赖。

- [x] **Step 3: 在 App 中实现静默刷新并接入面板**

新增：

```ts
async function refreshAgentIntegrations(): Promise<void> {
  if (!apiClient) {
    throw new Error("AgentMesh API is not ready.");
  }
  try {
    const report = await loadStudioIntegrations(apiClient);
    setAgentIntegrationsState({ status: "ready", report });
  } catch (error) {
    throw new Error(normalizeStudioApiError(error).message);
  }
}
```

并向 `environment` 属性传递：

```ts
onRefreshIntegrations: refreshAgentIntegrations,
```

- [x] **Step 4: 运行定向测试**

Run:

```bash
npm run build:node
node --test dist-node/tests-node/studio-ui.test.js
```

Expected: PASS。

### Task 3: 完整验证

**Files:**
- Verify: `/Users/zz/Documents/WebStorm/agentmesh/apps/studio-web/src/features/settings/AgentIntegrationsPanel.tsx`
- Verify: `/Users/zz/Documents/WebStorm/agentmesh/apps/studio-web/src/app/App.tsx`
- Verify: `/Users/zz/Documents/WebStorm/agentmesh/tests-node/studio-ui.test.ts`

**Interfaces:**
- Consumes: Task 2 的刷新回调和 UI。
- Produces: 构建、测试和格式检查证据。

- [x] **Step 1: 构建 Studio 前端**

Run: `npm run build:studio-frontend`

Expected: Vite build 成功。

- [x] **Step 2: 运行完整测试**

Run: `npm test`

Expected: 全部测试通过。

- [x] **Step 3: 检查格式和范围**

Run:

```bash
git diff --check
git diff --stat -- apps/studio-web/src/app/App.tsx apps/studio-web/src/features/settings/AgentIntegrationsPanel.tsx tests-node/studio-ui.test.ts
```

Expected: `git diff --check` 无输出，变更只落在刷新数据流、按钮和相应测试中。
