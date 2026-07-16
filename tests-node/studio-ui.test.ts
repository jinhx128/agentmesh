import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { build as viteBuild } from "vite";

import { createStudioApiClient } from "../apps/studio-web/src/api/client.js";
import {
  checkDesktopAppUpdate,
  installDesktopAppUpdate,
  isDesktopUpdaterAvailable,
  relaunchDesktopApp,
} from "../apps/studio-web/src/api/desktop-updater.js";
import {
  loadStudioAdvancedSettings,
  updateStudioAdvancedSettings,
  type StudioAdvancedSettingsPayload,
} from "../apps/studio-web/src/api/advanced-settings.js";
import {
  submitStudioMutation,
  type StudioMutationResponse,
} from "../apps/studio-web/src/api/mutations.js";
import {
  loadStudioAgentModels,
  loadStudioAgents,
  submitStudioAgentLifecycleOperation,
  type StudioAgentModelListPayload,
  type StudioAgentSummary,
} from "../apps/studio-web/src/api/agents.js";
import {
  loadStudioCatalog,
  type StudioCatalog,
} from "../apps/studio-web/src/api/catalog.js";
import {
  submitStudioWorkflowCreate,
  submitStudioWorkflowDelete,
  submitStudioWorkflowUpdate,
  type StudioWorkflowLifecycleOperation,
  type StudioWorkflowLifecycleResponse,
} from "../apps/studio-web/src/api/workflows.js";
import {
  submitStudioPresetCreate,
  submitStudioPresetDelete,
  submitStudioPresetUpdate,
  type StudioPresetLifecycleOperation,
  type StudioPresetLifecycleResponse,
} from "../apps/studio-web/src/api/presets.js";
import {
  loadStudioArtifactPreview,
  loadStudioRunDetail,
  loadStudioRuns,
  nextSelectedRunKey,
  studioRunKey,
  type StudioArtifactPreview,
  type StudioRunDetail,
  type StudioRunSummary,
} from "../apps/studio-web/src/api/runs.js";
import {
  loadStudioCallDetail,
  loadStudioCalls,
  nextSelectedCallKey,
  studioCallKey,
  submitStudioCallAdoption,
  type StudioCallDetail,
  type StudioCallSummary,
} from "../apps/studio-web/src/api/calls.js";
import {
  App,
  runDetailTabAfterRunSelection,
} from "../apps/studio-web/src/app/App.js";
import {
  formatLocalDate,
  formatLocalDateTime,
  formatLocalTime,
} from "../apps/studio-web/src/app/time.js";
import {
  workflowStageLabel,
} from "../apps/studio-web/src/app/stages.js";
import type { StudioCopyKey } from "../apps/studio-web/src/app/copy.js";
import { StudioThemeProvider } from "../apps/studio-web/src/app/StudioThemeProvider.js";
import {
  buildPresetTomlFromManualFields,
  buildWorkflowTomlFromManualFields,
  CatalogView,
  PresetManualFieldsForm,
  TomlRegistrationFields,
  WorkflowManualFieldsForm,
  type CatalogViewState,
} from "../apps/studio-web/src/features/catalog/CatalogView.js";
import {
  parseAutoRefreshSeconds,
} from "../apps/studio-web/src/features/navigation/AutoRefreshSelect.js";
import {
  ACTIVITY_GROUP_PREVIEW_LIMIT,
  ActivityNavigator,
  activityCalls,
  activityGroupCollapsed,
  activityItems,
  activityRuns,
  filterActivityItems,
  groupActivityItems,
  visibleActivityGroupItems,
  type ActivityCallsState,
  type ActivityRunsState,
} from "../apps/studio-web/src/features/navigation/ActivityNavigator.js";
import {
  CallDetailView,
  type CallDetailState,
} from "../apps/studio-web/src/features/calls/CallDetailView.js";
import {
  EventLogView,
  sortStudioEventsDescending,
} from "../apps/studio-web/src/features/runs/EventLogView.js";
import {
  RunOverview,
  preferredWorkflowStage,
  workflowStageAgentLabel,
  workflowStageExitLabel,
  workflowStageIds,
  workflowStageStatus,
  workflowStageNodeTimeLabel,
  type RunOverviewState,
} from "../apps/studio-web/src/features/runs/RunOverview.js";
import {
  ArtifactPreviewDrawer,
  ArtifactPreviewPanel,
  ArtifactSidebarPanel,
  artifactDisplayName,
  sortStudioArtifacts,
  type ArtifactPreviewState,
} from "../apps/studio-web/src/features/artifacts/ArtifactPreviewPanel.js";
import { ReviewReleaseView } from "../apps/studio-web/src/features/review-release/ReviewReleaseView.js";
import {
  SafeActionsPanel,
  buildSafeActionRequest,
  formatStudioMutationResult,
  type SafeActionMutationState,
} from "../apps/studio-web/src/features/actions/SafeActionsPanel.js";
import {
  AgentEditForm,
  AgentLifecyclePanel,
  formatAgentLifecycleOperation,
  loadAgentModelOptionCache,
  suggestAgentLabel,
  type AgentLifecyclePanelProps,
  type AgentLifecycleState,
} from "../apps/studio-web/src/features/agents/AgentLifecyclePanel.js";
import {
  SettingsAboutPanel,
  type SettingsAboutState,
} from "../apps/studio-web/src/features/settings/SettingsAboutPanel.js";
import {
  AgentIntegrationsPanel,
  type AgentIntegrationsState,
} from "../apps/studio-web/src/features/settings/AgentIntegrationsPanel.js";
import {
  SettingsView,
  type SettingsTabId,
} from "../apps/studio-web/src/features/settings/SettingsView.js";
import {
  installAgentSkills,
  installCommandLineTool,
  loadStudioIntegrations,
} from "../apps/studio-web/src/api/integrations.js";
import {
  loadStudioUpdate,
  type StudioUpdateReport,
} from "../apps/studio-web/src/api/update.js";
import {
  MANUAL_SECTIONS,
  ManualView,
} from "../apps/studio-web/src/features/manual/ManualView.js";
import { STUDIO_CSS, STUDIO_HTML, STUDIO_JS } from "../packages/app-server/src/assets.js";
import { createStudioServer } from "../packages/app-server/src/server.js";

test("Studio fallback serves only a minimal non-legacy shell", async () => {
  const { server, url } = await listen(createStudioServer());
  test.after(() => server.close());

  const html = await fetchText(`${url}/`);
  const css = await fetchText(`${url}/style.css`);
  const js = await fetchText(`${url}/studio.js`);

  assert.match(html, /data-studio-section="studio-fallback"/);
  assert.match(html, /正在等待 AgentMesh 资源/);
  assert.doesNotMatch(html, /AgentMesh Studio|React Studio/);
  assert.match(css, /\.fallback-panel/);
  assert.match(js, /studioFallback/);
  assert.doesNotMatch(html, /run-workspace|navigator-data-tabs|catalog-row/);
  assert.doesNotMatch(STUDIO_HTML, /run-workspace|workspace-layout|id="runs"/);
  assert.doesNotMatch(STUDIO_CSS, /navigator-data-tabs|run-search-row|catalog-row/);
  assert.match(STUDIO_JS, /minimal/);
});

test("React app renders the one-shot Mantine shell semantics", () => {
  const app = renderStudioElement(React.createElement(App));

  assert.match(app, /data-studio-section="react-baseline"/);
  assert.match(app, /data-studio-section="activity-navigator"/);
  assert.match(app, /data-studio-section="workspace-brand"/);
  assert.doesNotMatch(app, /data-studio-section="language-settings"/);
  assert.doesNotMatch(app, /data-studio-section="language-switch"/);
  assert.match(app, />AgentMesh</);
  assert.doesNotMatch(app, />Studio</);
  assert.doesNotMatch(app, /AgentMesh Studio/);
  assert.doesNotMatch(app, />English</);
  assert.doesNotMatch(app, />配置</);
  assert.match(app, /aria-label="设置"/);
  assert.match(app, /aria-label="手册"/);
  assert.match(app, /title="设置"/);
  assert.match(app, /title="手册"/);
  assert.match(app, />编排你的Agent</);
  assert.doesNotMatch(app, />设置<\/button>/);
  assert.doesNotMatch(app, />手册<\/button>/);
  assert.match(app, />资源</);
  assert.match(app, />环境</);
  assert.match(app, />关于</);
  assert.doesNotMatch(app, /data-studio-section="navigator-data-switch"/);
  assert.doesNotMatch(app, /studio-data-switch/);
  assert.match(app, /aria-label="搜索活动"/);
  assert.match(app, /title="刷新活动"/);
  assert.match(app, /data-studio-section="navigator-auto-refresh"/);
  assert.match(app, /aria-label="自动刷新"/);
  assert.match(app, /data-studio-section="navigator-auto-refresh"[\s\S]*value="15s"/);
  assert.doesNotMatch(app, /<option value="15" selected="">15s<\/option>/);
  assert.match(app, /data-studio-section="run-workspace"/);
  assert.match(app, /data-studio-section="settings-workspace"/);
  assert.match(app, /data-studio-section="studio-settings-view"/);
  assert.match(app, /data-studio-section="settings-resource-workspace"/);
  assert.doesNotMatch(app, /data-studio-section="configuration-workspace"/);
  assert.match(app, /data-studio-section="system-definitions"/);
  assert.doesNotMatch(app, /个 agent|个 workflow|个 MCP|个Agents|个Workflows|智能体 ·|工作流 ·/);
  assert.match(app, />详情</);
  assert.doesNotMatch(app, /mantine-Tabs-tabLabel">总览</);
  assert.doesNotMatch(app, /mantine-Tabs-tabLabel">阶段</);
  assert.match(app, />操作</);
  assert.doesNotMatch(app, />审查发布</);
  assert.doesNotMatch(app, />产物</);
  assert.match(app, />日志</);
  assert.doesNotMatch(app, />日志事件</);
  assert.match(app, />诊断</);

  const appSource = readFileSync(path.resolve("apps/studio-web/src/app/App.tsx"), "utf-8");
  const copySource = readFileSync(path.resolve("apps/studio-web/src/app/copy.ts"), "utf-8");
  const mainSource = readFileSync(path.resolve("apps/studio-web/src/main.tsx"), "utf-8");
  assert.match(appSource, /navbar=\{\{\s*width:\s*300,\s*breakpoint:\s*"xs"\s*\}\}/);
  assert.match(appSource, /if\s*\(\s*workspaceView !== "runs"\s*\)\s*\{[\s\S]*setArtifactDrawerOpened\(false\)/);
  assert.match(appSource, /opened=\{artifactDrawerOpened && workspaceView === "runs"\}/);
  assert.doesNotMatch(appSource, /opened=\{artifactDrawerOpened && runDetailState\.status === "ready"\}/);
  assert.match(appSource, /className="studio-topbar-copy"/);
  assert.match(appSource, /className="studio-topbar-title"/);
  assert.match(appSource, /className="studio-topbar-subtitle"/);
  assert.match(appSource, /className=\{workspaceScrollClassName\(workspaceView\)\}/);
  assert.match(appSource, /className="run-detail-tabs"/);
  assert.match(appSource, /function workspaceScrollClassName\(workspaceView: WorkspaceView\): string/);
  assert.match(appSource, /workspaceView === "runs" \? "studio-workspace-scroll run-workspace-scroll" : "studio-workspace-scroll"/);
  assert.match(appSource, /const STUDIO_RUN_EVENT_LIMIT = 200;/);
  assert.match(appSource, /eventLimit:\s*STUDIO_RUN_EVENT_LIMIT/);
  assert.doesNotMatch(appSource, /EVENT_PAGE_LIMIT|eventOffset|setEventOffset|onSelectEventOffset/);
  assert.doesNotMatch(appSource, /<Box>\s*<Title order=\{2\} size="h3">\{workspaceTitle\}<\/Title>\s*<Text size="sm" c="dimmed">\{workspaceSubtitle\(workspaceView,\s*t\)\}<\/Text>\s*<\/Box>/s);
  assert.doesNotMatch(appSource, /\{ id: "artifacts", labelKey: "artifacts" \}/);
  assert.doesNotMatch(appSource, /<Tabs\.Panel value="artifacts"/);
  assert.doesNotMatch(appSource, /ReviewReleaseView/);
  assert.doesNotMatch(appSource, /\{ id: "release", labelKey: "reviewPublish" \}/);
  assert.doesNotMatch(appSource, /<Tabs\.Panel value="release"/);
  assert.doesNotMatch(copySource, /查看详情、操作、审查发布、产物、日志事件和诊断。/);
  assert.doesNotMatch(copySource, /查看详情、操作、审查发布、日志事件和诊断。/);
  assert.doesNotMatch(copySource, /查看详情、操作、审查发布、日志和诊断。/);
  assert.match(copySource, /查看详情、操作、日志和诊断。/);
  assert.doesNotMatch(copySource, /createContext|StudioI18nProvider|locale:/);
  assert.doesNotMatch(copySource, /StudioI18n|StudioMessage|i18n/i);
  assert.doesNotMatch(copySource, /chineseMessages|\bzh\s*:/);
  assert.match(copySource, /artifactTotal:/);
  assert.doesNotMatch(mainSource, /StudioI18nProvider/);
});

test("App uses one activity navigator without losing run and call detail routing", () => {
  const appSource = readFileSync(
    path.resolve("apps/studio-web/src/app/App.tsx"),
    "utf-8",
  );
  const app = renderStudioElement(React.createElement(App));

  assert.match(appSource, /ActivityNavigator/);
  assert.match(appSource, /const \[activityQuery, setActivityQuery\]/);
  assert.doesNotMatch(appSource, /navigatorView|setNavigatorView|runQuery|callQuery|SegmentedControl/);
  assert.match(appSource, /function loadActivitiesWithClient/);
  assert.match(appSource, /loadRunsWithClient\(client, options\);\s*loadCallsWithClient\(client, options\);/);
  assert.match(appSource, /selectedKind=\{workspaceView === "runs" \? "run" : workspaceView === "calls" \? "call" : undefined\}/);
  assert.match(appSource, /onSelectRun=\{\(runKey\) => \{[\s\S]*setSelectedRunKey\(runKey\);[\s\S]*setWorkspaceView\("runs"\)/);
  assert.match(appSource, /onSelectCall=\{\(callKey\) => \{[\s\S]*setSelectedCallKey\(callKey\);[\s\S]*setWorkspaceView\("calls"\)/);
  assert.match(appSource, /onClick=\{\(\) => setWorkspaceView\("settings"\)\}/);
  assert.match(appSource, /onClick=\{\(\) => setWorkspaceView\("definitions"\)\}/);
  assert.doesNotMatch(appSource, /setSelectedRunKey\(undefined\)|setSelectedCallKey\(undefined\)/);
  assert.match(appSource, /function refreshAfterMutation[\s\S]*loadRunsWithClient\(apiClient, \{ showLoading: false \}\)/);
  assert.match(appSource, /async function submitCallAdoption[\s\S]*loadCallsWithClient\(apiClient, \{ showLoading: false \}\)/);
  assert.match(app, /aria-label="搜索活动"/);
  assert.match(app, /title="刷新活动"/);
  assert.doesNotMatch(app, /navigator-data-switch|studio-data-switch/);
  assert.equal(existsSync(path.resolve("apps/studio-web/src/features/runs/RunNavigator.tsx")), false);
  assert.equal(existsSync(path.resolve("apps/studio-web/src/features/calls/CallNavigator.tsx")), false);
});

test("React app CSS uses new layout hooks and no legacy selector contract", () => {
  const frontendCss = readFileSync(
    path.join(process.cwd(), "apps", "studio-web", "src", "styles.css"),
    { encoding: "utf-8" },
  );

  assert.match(frontendCss, /\.studio-workspace-scroll\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(frontendCss, /\.studio-workspace-scroll\.run-workspace-scroll\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(frontendCss, /\.studio-workspace-scroll\.run-workspace-scroll\s*\{[^}]*padding-right:\s*0;/s);
  assert.match(frontendCss, /\.studio-topbar-copy\s*\{[^}]*flex:\s*1 1 auto;/s);
  assert.match(frontendCss, /\.studio-topbar-copy\s*\{[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(frontendCss, /\.studio-topbar-title\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(frontendCss, /\.studio-topbar-subtitle\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(frontendCss, /\.studio-topbar-subtitle\s*\{[^}]*text-overflow:\s*ellipsis;/s);
  assert.match(frontendCss, /\.studio-nav-scroll\s*\{/);
  assert.match(frontendCss, /\.studio-data-navigator\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(frontendCss, /\.studio-nav-item\s+\.mantine-Button-label\s*\{[^}]*justify-content:\s*flex-start/s);
  assert.match(frontendCss, /\.studio-nav-item-title\s*\{[^}]*text-align:\s*left/s);
  assert.match(frontendCss, /\.studio-auto-refresh-select\s*\{[^}]*flex:\s*0 0 56px/s);
  assert.match(frontendCss, /\.studio-auto-refresh-select\s+\.mantine-Select-input\s*\{/);
  assert.doesNotMatch(frontendCss, /\.studio-auto-refresh-select\s+\.mantine-NativeSelect-input\s*\{/);
  assert.doesNotMatch(frontendCss, /\.studio-data-switch\s*\{/);
  assert.match(frontendCss, /\.studio-resource-card-layout\s*\{[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(frontendCss, /\.studio-resource-card-main\s*\{[^}]*flex:\s*1 1 auto;/s);
  assert.match(frontendCss, /\.studio-resource-card-main\s*\{[^}]*min-width:\s*0;/s);
  assert.match(frontendCss, /\.studio-resource-card-actions\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(frontendCss, /\.studio-resource-card-actions\s*\{[^}]*margin-left:\s*auto;/s);
  assert.match(frontendCss, /\.event-field-badge\s+\.mantine-Badge-label\s*\{[^}]*text-transform:\s*none;/s);
  assert.match(frontendCss, /\.run-summary-row\s*\{[^}]*display:\s*grid;/s);
  assert.match(frontendCss, /\.run-summary-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(frontendCss, /\.run-summary-item\s*\{[^}]*display:\s*grid;/s);
  assert.match(frontendCss, /\.run-summary-item\s*\{[^}]*grid-template-columns:\s*72px\s+minmax\(0,\s*1fr\);/s);
  assert.match(frontendCss, /\.run-summary-item\s*\{[^}]*justify-items:\s*start;/s);
  assert.match(frontendCss, /\.run-summary-value\s*\{[^}]*text-align:\s*left;/s);
  assert.match(frontendCss, /@media \(max-width:\s*36em\)[\s\S]*\.run-summary-row\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  assert.match(frontendCss, /\[data-studio-section="run-workspace"\]\s*\{[^}]*height:\s*100%;/s);
  assert.match(frontendCss, /\[data-studio-section="run-workspace"\]\s*\{[^}]*min-height:\s*100%;/s);
  assert.match(frontendCss, /\.run-workspace-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(210px,\s*260px\)/s);
  assert.doesNotMatch(frontendCss, /\.run-workspace-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(220px,\s*280px\)/s);
  assert.match(frontendCss, /\.run-workspace-layout\s*\{[^}]*height:\s*100%;/s);
  assert.match(frontendCss, /\.run-workspace-layout\s*\{[^}]*min-height:\s*100%;/s);
  assert.match(frontendCss, /\.run-workspace-layout\s*\{[^}]*align-items:\s*stretch;/s);
  assert.match(frontendCss, /\.run-workspace-main,\s*\.run-workspace-side\s*\{[^}]*min-height:\s*0;/s);
  assert.match(frontendCss, /\.run-workspace-main\s*\{[^}]*height:\s*100%;/s);
  assert.match(frontendCss, /\.run-workspace-main\s*\{[^}]*display:\s*flex;/s);
  assert.match(frontendCss, /\.run-workspace-main\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(frontendCss, /\.run-workspace-main\s*\{[^}]*overflow-x:\s*hidden;/s);
  assert.match(frontendCss, /\.run-detail-tabs\s*\{[^}]*display:\s*flex;/s);
  assert.match(frontendCss, /\.run-detail-tabs\s*\{[^}]*height:\s*100%;/s);
  assert.match(frontendCss, /\.run-detail-tabs\s*\{[^}]*min-height:\s*0;/s);
  assert.match(frontendCss, /\.run-detail-tabs\s*>\s*\.mantine-Tabs-list\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(frontendCss, /\.run-detail-tabs\s*>\s*\.mantine-Tabs-panel\s*\{[^}]*min-height:\s*0;/s);
  assert.match(frontendCss, /\.run-detail-tabs\s*>\s*\.mantine-Tabs-panel\s*\{[^}]*flex:\s*1 1 0;/s);
  assert.match(frontendCss, /\.run-detail-tabs\s*>\s*\.mantine-Tabs-panel\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(frontendCss, /\.run-detail-tabs\s*>\s*\.mantine-Tabs-panel\s*\{[^}]*overflow-x:\s*hidden;/s);
  assert.match(frontendCss, /\.run-workspace-side\s*\{[^}]*display:\s*flex;/s);
  assert.match(frontendCss, /\.run-workspace-side\s*\{[^}]*align-self:\s*stretch;/s);
  assert.match(frontendCss, /\.run-workspace-side\s*\{[^}]*height:\s*100%;/s);
  assert.match(frontendCss, /\.run-workspace-side\s*\{[^}]*max-height:\s*100%;/s);
  assert.match(frontendCss, /\.run-workspace-side\s*\{[^}]*overflow:\s*hidden;/s);
  assert.doesNotMatch(frontendCss, /\.run-workspace-side\s*\{[^}]*position:\s*sticky;/s);
  assert.doesNotMatch(frontendCss, /--run-workspace-fixed-height:\s*calc\(100vh - 176px\);/s);
  assert.match(frontendCss, /\.artifact-sidebar-panel\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(frontendCss, /\.run-workspace-side\s+\.artifact-sidebar-panel\s*\{[^}]*height:\s*100%;/s);
  assert.match(frontendCss, /\.run-workspace-side\s+\.artifact-sidebar-panel\s*\{[^}]*min-height:\s*0;/s);
  assert.match(frontendCss, /\.artifact-sidebar-panel\s*>\s*\.mantine-Stack-root\s*\{[^}]*height:\s*100%;/s);
  assert.match(frontendCss, /\.artifact-sidebar-summary\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(frontendCss, /\.artifact-sidebar-list-heading\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(frontendCss, /\.artifact-sidebar-artifacts\s*\{[^}]*flex:\s*1 1 0;/s);
  assert.match(frontendCss, /\.artifact-sidebar-artifacts\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(frontendCss, /\.artifact-sidebar-list\s*\{[^}]*flex:\s*1 1 0;/s);
  assert.match(frontendCss, /\.artifact-sidebar-list\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(frontendCss, /\.artifact-sidebar-list\s*\{[^}]*padding:\s*3px 4px 4px;/s);
  assert.match(frontendCss, /\.artifact-sidebar-list\s*\{[^}]*box-sizing:\s*border-box;/s);
  assert.doesNotMatch(frontendCss, /\.studio-nav-item\[aria-current="true"\]\s*\{[^}]*outline:/s);
  assert.match(frontendCss, /\.artifact-sidebar-item\[aria-current="true"\]\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--mantine-color-agentmesh-6\);/s);
  assert.doesNotMatch(frontendCss, /\.artifact-sidebar-item\[aria-current="true"\]\s*\{[^}]*outline:/s);
  assert.doesNotMatch(frontendCss, /\.artifact-sidebar-panel\s*\{[^}]*max-height:\s*calc\(100vh - 160px\);/s);
  assert.doesNotMatch(frontendCss, /\.run-workspace-side\s+\.artifact-sidebar-panel\s*\{[^}]*min-height:\s*calc\(100vh - 244px\);/s);
  assert.match(frontendCss, /\.mantine-Tabs-list\s*\{[^}]*width:\s*fit-content/s);
  assert.match(frontendCss, /\.mantine-Tabs-list::before\s*\{[^}]*display:\s*none/s);
  assert.match(frontendCss, /\.mantine-Tabs-tab\[data-active\]\s*\{[^}]*background:\s*#ffffff/s);
  assert.match(frontendCss, /\.mantine-Tabs-tab\[data-active\]::after\s*\{[^}]*display:\s*none/s);
  assert.match(frontendCss, /\.manual-section-tabs\s*>\s*\.mantine-Tabs-list\s*\{[^}]*position:\s*sticky;/s);
  assert.match(frontendCss, /\.manual-section-tabs\s*>\s*\.mantine-Tabs-list\s*\{[^}]*top:\s*0;/s);
  assert.match(frontendCss, /\.manual-section-tabs\s*>\s*\.mantine-Tabs-list\s*\{[^}]*z-index:\s*5;/s);
  assert.match(frontendCss, /\.settings-section-tabs\s*>\s*\.mantine-Tabs-list\s*\{[^}]*position:\s*sticky;/s);
  assert.match(frontendCss, /\.settings-section-tabs\s*>\s*\.mantine-Tabs-list\s*\{[^}]*top:\s*0;/s);
  assert.match(frontendCss, /\.settings-section-tabs\s*>\s*\.mantine-Tabs-list\s*\{[^}]*z-index:\s*5;/s);
  assert.doesNotMatch(frontendCss, /\.studio-language-switch/);
  assert.match(frontendCss, /button:not\(:disabled\)[\s\S]*cursor:\s*pointer/s);
  assert.match(frontendCss, /--studio-flow-node-width:\s*156px;/);
  assert.match(frontendCss, /--studio-flow-node-min-height:\s*88px;/);
  assert.match(frontendCss, /--studio-workflow-node-width:\s*132px;/);
  assert.match(frontendCss, /--studio-workflow-node-min-height:\s*72px;/);
  assert.match(frontendCss, /--studio-flow-connector-width:\s*28px;/);
  assert.match(frontendCss, /--studio-flow-connector-color:\s*#6f7f96;/);
  assert.match(frontendCss, /\.workflow-nodes,\s*\.artifact-flow\s*\{[^}]*display:\s*flex/s);
  assert.match(frontendCss, /\.workflow-nodes,\s*\.artifact-flow\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(frontendCss, /\.workflow-nodes,\s*\.artifact-flow\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(frontendCss, /\.workflow-nodes,\s*\.artifact-flow\s*\{[^}]*overflow-y:\s*hidden/s);
  assert.match(frontendCss, /\.workflow-nodes,\s*\.artifact-flow\s*\{[^}]*scroll-snap-type:\s*x proximity/s);
  assert.doesNotMatch(frontendCss, /\.workflow-step-stack/);
  assert.doesNotMatch(frontendCss, /\.workflow-step-stack\.selected\s*\{[^}]*flex-basis:\s*min\(560px/s);
  assert.doesNotMatch(frontendCss, /\.workflow-step-stack\.selected\s*\{[^}]*width:\s*min\(560px/s);
  assert.match(frontendCss, /\.workflow-step,\s*\.artifact-step\s*\{[^}]*display:\s*flex/s);
  assert.match(frontendCss, /\.workflow-step,\s*\.artifact-step\s*\{[^}]*flex:\s*0 0 auto/s);
  assert.match(frontendCss, /\.workflow-connector,\s*\.artifact-connector\s*\{[^}]*flex:\s*0 0 var\(--studio-flow-connector-width\)/s);
  assert.match(frontendCss, /\.workflow-connector,\s*\.artifact-connector\s*\{[^}]*margin:\s*0 8px 0 4px/s);
  assert.match(frontendCss, /\.workflow-connector,\s*\.artifact-connector\s*\{[^}]*background:\s*var\(--studio-flow-connector-color\)/s);
  assert.match(frontendCss, /\.workflow-connector::after,\s*\.artifact-connector::after\s*\{[^}]*right:\s*0/s);
  assert.match(frontendCss, /\.workflow-connector::after,\s*\.artifact-connector::after\s*\{[^}]*border-left:\s*9px solid var\(--studio-flow-connector-color\)/s);
  assert.match(frontendCss, /\.workflow-stage-card\s*\{[^}]*min-height:\s*var\(--studio-workflow-node-min-height\)/s);
  assert.match(frontendCss, /\.workflow-stage-card\s*\{[^}]*width:\s*var\(--studio-workflow-node-width\)/s);
  assert.match(frontendCss, /\.workflow-stage-card\s*\{[^}]*max-width:\s*var\(--studio-workflow-node-width\)/s);
  assert.match(frontendCss, /\.workflow-stage-card\s+\*\s*\{[^}]*cursor:\s*pointer;/s);
  assert.match(frontendCss, /\.artifact-node\s*\{[^}]*min-height:\s*var\(--studio-flow-node-min-height\)/s);
  assert.match(frontendCss, /\.artifact-node\s*\{[^}]*width:\s*var\(--studio-flow-node-width\)/s);
  assert.match(frontendCss, /\.artifact-node\s*\{[^}]*max-width:\s*var\(--studio-flow-node-width\)/s);
  assert.doesNotMatch(frontendCss, /\.workflow-connector,\s*\.artifact-connector\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(frontendCss, /\.workflow-stage-card,\s*\.artifact-node\s*\{[^}]*width:\s*100%/s);
  assert.doesNotMatch(frontendCss, /\.workflow-stage-card,\s*\.artifact-node\s*\{[^}]*min-height:\s*122px;/s);
  assert.doesNotMatch(frontendCss, /\.artifact-node\s*\{[^}]*min-height:\s*138px;/s);
  assert.match(frontendCss, /\.artifact-preview-panel\s+\.studio-code-block\s*\{[^}]*max-height:\s*min\(70vh,\s*760px\)/s);
  assert.match(frontendCss, /\.artifact-preview-panel\s+\.artifact-markdown\s*\{[^}]*max-height:\s*min\(70vh,\s*760px\)/s);
  assert.match(frontendCss, /\.artifact-preview-drawer\s+\.studio-code-block\s*\{[^}]*white-space:\s*pre;/s);
  assert.match(frontendCss, /\.artifact-preview-drawer\s+\.studio-code-block\s*\{[^}]*overflow-wrap:\s*normal;/s);
  assert.match(frontendCss, /\.artifact-preview-drawer\s+\.artifact-markdown\s*\{[^}]*max-height:\s*calc\(100vh - 240px\)/s);
  assert.match(frontendCss, /\.artifact-preview-drawer-layout\s*\{[^}]*width:\s*100%;/s);
  assert.doesNotMatch(frontendCss, /--artifact-preview-drawer-main-width/);
  assert.doesNotMatch(frontendCss, /\.artifact-preview-drawer-layout\s*\{[^}]*grid-template-columns:/s);
  assert.match(frontendCss, /\.artifact-preview-drawer-main\s*\{[^}]*display:\s*flex;/s);
  assert.match(frontendCss, /\.artifact-preview-drawer-main\s*\{[^}]*flex-direction:\s*column;/s);
  assert.match(frontendCss, /\.artifact-preview-drawer-main\s+\.artifact-info-panel\s*\{[^}]*padding:\s*6px 8px;/s);
  assert.match(frontendCss, /\.artifact-preview-drawer-main\s+\.artifact-info-panel\s*\{[^}]*margin-top:\s*0;/s);
  assert.match(frontendCss, /\.artifact-preview-drawer-main\s+\.artifact-info-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(frontendCss, /\.artifact-preview-drawer-main\s+\.artifact-info-grid\s*\{[^}]*gap:\s*4px;/s);
  assert.match(frontendCss, /\.artifact-info-item\s*\{[^}]*display:\s*grid;/s);
  assert.match(frontendCss, /\.artifact-info-item\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0,\s*1fr\);/s);
  assert.match(frontendCss, /\.artifact-info-item\s*\{[^}]*align-items:\s*center;/s);
  assert.match(frontendCss, /\.artifact-info-label\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(frontendCss, /\.artifact-preview-drawer-main\s+\.artifact-info-item\s*\{[^}]*padding:\s*4px 7px;/s);
  assert.match(frontendCss, /\.artifact-preview-drawer-main\s+\.artifact-info-value\s*\{[^}]*font-size:\s*13px;/s);
  assert.match(frontendCss, /\.artifact-preview-drawer-main\s+\.artifact-info-panel,\s*\.artifact-preview-drawer-main\s+\.studio-code-block,\s*\.artifact-preview-drawer-main\s+\.artifact-markdown\s*\{[^}]*width:\s*100%;/s);
  assert.doesNotMatch(frontendCss, /\.artifact-preview-drawer-gutter/);
  assert.match(frontendCss, /\.artifact-sidebar-item\s*\{[^}]*min-height:\s*42px;/s);
  assert.match(frontendCss, /\.artifact-sidebar-item\s+\.mantine-Button-label\s*\{[^}]*padding:\s*8px 10px;/s);
  assert.match(frontendCss, /\.artifact-sidebar-item-row\s*\{[^}]*align-items:\s*flex-start;/s);
  assert.match(frontendCss, /\.artifact-sidebar-item-row\s*\{[^}]*min-width:\s*0;/s);
  assert.match(frontendCss, /\.artifact-sidebar-item-main\s*\{[^}]*flex:\s*1 1 0;/s);
  assert.match(frontendCss, /\.artifact-sidebar-item-main\s*\{[^}]*min-width:\s*0;/s);
  assert.match(frontendCss, /\.artifact-sidebar-item-time\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(frontendCss, /\.artifact-sidebar-item-time\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.doesNotMatch(frontendCss, /\.artifact-sidebar-item-status/);
  assert.match(frontendCss, /@media \(max-width:\s*36em\)/);
  assert.match(frontendCss, /\.studio-navbar\s*\{[^}]*position:\s*static !important/s);
  assert.match(frontendCss, /\.studio-navbar\s*\{[^}]*height:\s*auto !important/s);
  assert.match(frontendCss, /\.studio-workspace-scroll\.run-workspace-scroll\s*\{[^}]*overflow:\s*visible;/s);
  assert.match(frontendCss, /\.run-workspace-main\s*\{[^}]*height:\s*auto;[^}]*overflow:\s*visible;/s);
  assert.doesNotMatch(frontendCss, /\.navigator-data-tabs|\.run-search-row|\.catalog-row|\.app-tab/);
  assert.doesNotMatch(frontendCss, /font-size:\s*[^;]*vw|orb/i);

  const autoRefreshSource = readFileSync(
    path.join(process.cwd(), "apps", "studio-web", "src", "features", "navigation", "AutoRefreshSelect.tsx"),
    { encoding: "utf-8" },
  );
  assert.match(autoRefreshSource, /Select,/);
  assert.doesNotMatch(autoRefreshSource, /NativeSelect/);
});

test("Studio silver theme exposes canonical tokens", () => {
  const frontendCss = readFileSync(
    path.join(process.cwd(), "apps", "studio-web", "src", "styles.css"),
    "utf-8",
  );
  const themeSource = readFileSync(
    path.join(process.cwd(), "apps", "studio-web", "src", "app", "StudioThemeProvider.tsx"),
    "utf-8",
  );
  const gitignoreSource = readFileSync(path.join(process.cwd(), ".gitignore"), "utf-8");

  for (const token of [
    "--studio-canvas: #edf0f3",
    "--studio-surface: #ffffff",
    "--studio-ink: #1d2937",
    "--studio-muted: #5e6b77",
    "--studio-primary: #3eb8c8",
    "--studio-primary-ink: #1f6570",
    "--studio-success: #46b978",
    "--studio-warning: #e4a63d",
    "--studio-danger: #dc6666",
    "--studio-radius-shell: 18px",
    "--studio-motion-fast: 140ms",
  ]) {
    assert.ok(frontendCss.includes(token), `missing silver UI token: ${token}`);
  }
  assert.doesNotMatch(frontendCss, /#fbf7f4/i);
  assert.match(themeSource, /const agentmeshCyan: MantineColorsTuple/);
  assert.match(themeSource, /"#3eb8c8"/i);
  assert.match(themeSource, /defaultRadius:\s*"md"/);
  assert.match(themeSource, /autoContrast:\s*true/);
  assert.match(themeSource, /primaryShade:\s*\{[\s\S]*light:\s*5/);
  assert.doesNotMatch(themeSource, /agentmeshBlue/);
  assert.match(gitignoreSource, /(?:^|\n)\.superpowers\/(?:\n|$)/);
});

test("Studio silver shell renders the approved brand hierarchy", () => {
  const brandPath = path.resolve("apps/studio-web/src/app/StudioBrandMark.tsx");
  assert.equal(existsSync(brandPath), false, "Studio page brand logo component must be removed");

  const appSource = readFileSync(
    path.resolve("apps/studio-web/src/app/App.tsx"),
    "utf-8",
  );
  const frontendCss = readFileSync(
    path.resolve("apps/studio-web/src/styles.css"),
    "utf-8",
  );
  const viteConfigSource = readFileSync(
    path.resolve("apps/studio-web/vite.config.ts"),
    "utf-8",
  );

  assert.doesNotMatch(appSource, /StudioBrandMark/);
  assert.match(appSource, /className="studio-brand-header"/);
  assert.match(appSource, /className="studio-brand-copy" gap=\{4\}/);
  assert.match(appSource, /className="studio-brand-subtitle"/);
  assert.match(appSource, />编排你的Agent</);
  assert.match(appSource, /className="studio-brand-actions"/);
  assert.match(appSource, /className="studio-brand-action studio-brand-settings-action"/);
  assert.match(appSource, /className="studio-brand-action studio-brand-manual-action"/);
  assert.equal((appSource.match(/<ActionIcon/g) ?? []).length >= 2, true);
  assert.equal((appSource.match(/<svg/g) ?? []).length >= 2, true);
  assert.match(appSource, /aria-pressed=\{workspaceView === "settings"\}/);
  assert.match(appSource, /aria-pressed=\{workspaceView === "definitions"\}/);
  for (const selector of [
    ".studio-brand-header",
    ".studio-brand-copy",
    ".studio-brand-subtitle",
    ".studio-brand-actions",
    ".studio-brand-action",
  ]) {
    assert.ok(frontendCss.includes(selector), `missing compact brand selector: ${selector}`);
  }
  assert.doesNotMatch(frontendCss, /\.studio-brand-mark/);
  assert.match(frontendCss, /\.studio-brand-subtitle\s*\{[^}]*font-size:\s*11px;/s);
  assert.doesNotMatch(viteConfigSource, /canonicalIconDir|studio-desktop\/src-tauri\/icons/);
  assert.match(viteConfigSource, /allow:\s*\[studioRoot\]/);
  assert.match(frontendCss, /@supports \(backdrop-filter:\s*blur\(1px\)\)/);
});

test("Studio silver components map update and status semantics", () => {
  const settings = renderSettingsAboutPanel({
    status: "ready",
    compatibility: compatibilityFixture(),
    update: { status: "ready", report: updateFixture() },
  }, {
    state: {
      status: "update_available",
      currentVersion: "0.1.10",
      version: "0.1.11",
      notes: "Updater enabled",
    },
    onCheck: async () => {},
    onInstall: async () => {},
  });
  const frontendCss = readFileSync(
    path.resolve("apps/studio-web/src/styles.css"),
    "utf-8",
  );
  const integrationsSource = readFileSync(
    path.resolve("apps/studio-web/src/features/settings/AgentIntegrationsPanel.tsx"),
    "utf-8",
  );
  const settingsAboutSource = readFileSync(
    path.resolve("apps/studio-web/src/features/settings/SettingsAboutPanel.tsx"),
    "utf-8",
  );

  assert.match(settings, /class="[^"]*studio-subcard[^"]*"/);
  assert.match(settings, /class="[^"]*studio-update-card[^"]*"/);
  assert.match(settings, /class="[^"]*studio-info-item[^"]*"/);
  for (const selector of [
    ".mantine-Button-root",
    ".mantine-Input-input",
    ".mantine-Tabs-list",
    ".studio-subcard",
    ".studio-update-card",
    ".studio-info-item",
    ".studio-resource-card",
    ".artifact-markdown",
  ]) {
    assert.ok(frontendCss.includes(selector), `missing component selector: ${selector}`);
  }
  assert.match(frontendCss, /\.status\.ready,[\s\S]*var\(--studio-success\)/);
  assert.match(frontendCss, /\.status\.failed,[\s\S]*var\(--studio-danger\)/);
  assert.match(frontendCss, /--mantine-color-dimmed:\s*var\(--studio-muted\)/);
  assert.match(frontendCss, /\.mantine-Tabs-tab\[data-active\][^{]*\{[^}]*color:\s*var\(--studio-primary-ink\)/s);
  assert.match(frontendCss, /\.mantine-Tabs-tab:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--studio-primary-ink\)/s);
  assert.match(frontendCss, /\.status\.current,[\s\S]*\.status\.running\s*\{[^}]*color:\s*var\(--studio-primary-ink\)/s);
  assert.doesNotMatch(frontendCss, /#7b8492|#5d6674/i);
  assert.match(integrationsSource, /<Tabs\.List grow aria-label=\{t\("environment"\)\}>/);
  assert.match(integrationsSource, /commandStatusLabel\(commandLine\.status\)/);
  assert.doesNotMatch(integrationsSource, /\{commandLine\.status\}/);
  assert.match(settingsAboutSource, /state\.status === "error" \? "red"/);
  assert.match(settingsAboutSource, /state\.status === "error" \? <Alert color="red"/);
  assert.match(settingsAboutSource, /role="status"/);
  assert.match(settingsAboutSource, /aria-live="polite"/);
  assert.doesNotMatch(
    frontendCss,
    /#f45d3d|#fff3ee|#ffd0c4|#ffe0d7|#b5432d|#fffdfc|#fff8f5|#fffaf8|#ffc7ba|#ffb19f|#ffb4b0/i,
  );
  assert.doesNotMatch(
    frontendCss,
    /var\(--studio-(?:bg|text|accent|accent-soft|surface-soft|surface-tint)\)/,
  );
  assert.doesNotMatch(
    frontendCss,
    /--studio-(?:bg|text|accent|accent-soft|surface-soft|surface-tint):/,
  );
  assert.doesNotMatch(
    readFileSync(path.resolve("tests-node/studio-ui.test.ts"), "utf-8"),
    /\}\s+as unknown as Extract<AgentIntegrationsState/,
  );
});

test("Studio silver responsive rules preserve accessibility", () => {
  const frontendCss = readFileSync(
    path.resolve("apps/studio-web/src/styles.css"),
    "utf-8",
  );
  const themeSource = readFileSync(
    path.resolve("apps/studio-web/src/app/StudioThemeProvider.tsx"),
    "utf-8",
  );

  assert.match(frontendCss, /@media \(max-width:\s*64em\)/);
  assert.match(frontendCss, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(frontendCss, /@media \(max-width:\s*36em\)[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(frontendCss, /:focus-visible/);
  assert.match(
    frontendCss,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*transition-duration:\s*0\.01ms !important/,
  );
  for (const component of ["Modal", "Drawer"]) {
    assert.match(
      themeSource,
      new RegExp(`${component}\\.extend\\(\\{[\\s\\S]*closeButtonProps:\\s*\\{[\\s\\S]*"aria-label":\\s*"关闭"`),
    );
  }
});

test("Studio frontend build keeps JavaScript chunks under the Vite warning threshold", async () => {
  const result = await viteBuild({
    configFile: path.join(process.cwd(), "apps", "studio-web", "vite.config.ts"),
    logLevel: "silent",
    build: {
      write: false,
    },
  });
  const buildOutputs = result as Array<{ output: unknown[] }> | { output: unknown[] };
  const outputs = Array.isArray(buildOutputs)
    ? buildOutputs.flatMap((item) => item.output)
    : buildOutputs.output;
  const oversizedChunks = outputs
    .filter((item): item is { type: "chunk"; fileName: string; code: string } => (
      typeof item === "object"
      && item !== null
      && "type" in item
      && item.type === "chunk"
      && "fileName" in item
      && typeof item.fileName === "string"
      && "code" in item
      && typeof item.code === "string"
    ))
    .map((chunk) => ({
      fileName: chunk.fileName,
      size: Buffer.byteLength(chunk.code, "utf-8"),
    }))
    .filter((chunk) => chunk.size > 500 * 1024);

  assert.deepEqual(oversizedChunks, []);
});

test("Studio frontend formats timestamps in the system timezone", () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = "Asia/Shanghai";
    assert.equal(formatLocalDateTime("2026-05-18T07:00:00.000Z"), "2026-05-18 15:00:00");
    assert.equal(formatLocalTime("2026-05-18T07:00:00.000Z"), "15:00:00");
    assert.equal(formatLocalDate("2026-05-18T17:00:00.000Z"), "2026-05-19");
    assert.equal(formatLocalDateTime("not-a-date"), "not-a-date");
  } finally {
    if (previousTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTimezone;
    }
  }
});

test("Catalog view renders Mantine tabs, cards, diagnostics and states", () => {
  const loaded = renderReactCatalog({ status: "ready", catalog: studioCatalogFixture() });

  assert.match(loaded, /data-studio-section="react-catalog-pilot"/);
  assert.match(loaded, />资源</);
  assert.match(loaded, /Agents · 2/);
  assert.match(loaded, /Workflows · 2/);
  assert.match(loaded, /Presets · 1/);
  assert.match(loaded, /MCP · 1/);
  assert.match(loaded, /data-studio-section="agent-tool-groups"/);
  assert.match(loaded, /data-agent-tool="claude-code-cli"/);
  assert.match(loaded, /data-agent-tool="codex-cli"/);
  assert.match(loaded, /data-agent-tool="antigravity-cli"/);
  assert.match(loaded, /data-agent-tool="cursor-agent"/);
  assert.match(loaded, /data-agent-tool="opencode-cli"/);
  assert.match(loaded, /claude-code-cli · 1/);
  assert.match(loaded, /codex-cli · 1/);
  assert.match(loaded, /antigravity-cli · 0/);
  assert.match(loaded, /cursor-agent · 0/);
  assert.match(loaded, /opencode-cli · 0/);
  assert.doesNotMatch(loaded, /data-agent-tool="gemini-cli"/);
  assert.match(loaded, /Codex GPT-5\.5 High<\/p><p[^>]*>codex-cli · gpt-5\.5/);
  assert.doesNotMatch(loaded, /<p[^>]*>codex-gpt-5-5<\/p><p[^>]*>Codex GPT-5\.5 High · codex-cli/);
  assert.match(loaded, /agent source timed out/);
  assert.match(loaded, /mantine-Paper-root|mantine-Card-root/);
  assert.doesNotMatch(loaded, /catalog-row/);

  const loadedWithLifecycle = renderReactCatalog({
    status: "ready",
    catalog: studioCatalogFixture(),
  }, {
    state: {
      status: "ready",
      agents: studioAgentsFixture(),
      lastOperation: agentOperationFixture(),
    },
    onCreateAgent: async () => {},
    onAgentAction: async () => {},
    onLoadAgentModels: async (adapter) => agentModelsFixture(adapter),
  });
  assert.match(loadedWithLifecycle, /data-studio-section="react-agent-lifecycle"/);
  assert.match(loadedWithLifecycle, /data-studio-section="agent-create-open"/);
  assert.match(loadedWithLifecycle, /创建 Agent/);
  assert.doesNotMatch(loadedWithLifecycle, /placeholder="agent-id"/);
  assert.match(loadedWithLifecycle, /Codex GPT-5\.5<\/p><p[^>]*>codex · gpt-5\.5/);
  assert.doesNotMatch(loadedWithLifecycle, /<p[^>]*>codex-gpt-5-5<\/p><p[^>]*>Codex GPT-5\.5 · codex/);
  assert.match(loadedWithLifecycle, /data-agent-action="edit"/);
  assert.match(loadedWithLifecycle, /data-agent-action="disable"/);
  assert.match(loadedWithLifecycle, /data-agent-action="delete"/);
  assert.match(loadedWithLifecycle, />编辑</);
  assert.match(loadedWithLifecycle, />停用</);
  assert.doesNotMatch(loadedWithLifecycle, /Codex GPT-5\.5 · codex</);
  assert.match(loadedWithLifecycle, /计划, 执行, 审查/);
  assert.doesNotMatch(loadedWithLifecycle, /plan, execute, review/);
  assert.ok(loadedWithLifecycle.indexOf("创建 Agent") < loadedWithLifecycle.indexOf("Codex GPT-5.5"));

  const loadedWorkflowLifecycle = renderReactCatalog({
    status: "ready",
    catalog: studioCatalogFixture(),
  }, undefined, "workflows");
  assert.match(loadedWorkflowLifecycle, /data-studio-section="react-workflow-lifecycle"/);
  assert.match(loadedWorkflowLifecycle, /data-studio-section="workflow-create-open"/);
  assert.match(loadedWorkflowLifecycle, /创建 Workflow/);
  assert.match(loadedWorkflowLifecycle, /计划 -&gt; 执行 -&gt; 审查/);
  assert.doesNotMatch(loadedWorkflowLifecycle, /plan -&gt; execute -&gt; review/);
  assert.ok(loadedWorkflowLifecycle.indexOf("创建 Workflow") < loadedWorkflowLifecycle.indexOf("Bug Fix"));
  const workflowCreateFields = renderTomlRegistrationFields("workflow-create", "创建 Workflow");
  assert.doesNotMatch(workflowCreateFields, /保存到/);
  assert.match(workflowCreateFields, /导入来源/);
  assert.match(workflowCreateFields, /data-studio-section="workflow-create-source-mode"/);
  assert.match(workflowCreateFields, />选择 TOML</);
  assert.match(workflowCreateFields, />手动填写</);
  assert.ok(workflowCreateFields.indexOf(">手动填写<") < workflowCreateFields.indexOf(">选择 TOML<"));
  assert.match(workflowCreateFields, /data-studio-section="workflow-create-manual-placeholder"/);
  assert.doesNotMatch(workflowCreateFields, /选择要导入的 TOML 文件/);
  assert.doesNotMatch(workflowCreateFields, /保存文件夹|配置目录固定|scope 自动决定/);
  assert.doesNotMatch(workflowCreateFields, />项目目录</);
  assert.doesNotMatch(workflowCreateFields, /保存路径由项目或用户 scope 自动决定/);
  assert.doesNotMatch(workflowCreateFields, /placeholder="\.\/workflows\/custom-flow\.toml"/);
  const workflowManualFields = renderWorkflowManualFields();
  assert.match(workflowManualFields, />名称</);
  assert.match(workflowManualFields, />说明</);
  assert.doesNotMatch(workflowManualFields, />Workflow 名称</);
  assert.doesNotMatch(workflowManualFields, />Workflow 说明</);
  assert.match(workflowManualFields, /data-studio-section="workflow-stage-select"/);
  assert.match(workflowManualFields, /选择阶段/);
  assert.match(workflowManualFields, /计划/);
  assert.match(workflowManualFields, /审查/);
  assert.match(workflowManualFields, /决策/);
  const catalogSource = readFileSync(path.resolve("apps/studio-web/src/features/catalog/CatalogView.tsx"), "utf-8");
  const agentLifecyclePanelSource = readFileSync(path.resolve("apps/studio-web/src/features/agents/AgentLifecyclePanel.tsx"), "utf-8");
  assert.match(agentLifecyclePanelSource, /data-studio-section="agent-delete-confirmation-modal"/);
  assert.match(agentLifecyclePanelSource, /setDeleteConfirmationAgent\(agent\)/);
  assert.doesNotMatch(agentLifecyclePanelSource, /onClick=\{\(\) => void agentAction\("delete", agent\.id\)\}/);
  assert.doesNotMatch(catalogSource, /StudioWorkflowScope/);
  assert.match(catalogSource, /useState<TomlSourceMode>\("manual"\)/);
  assert.match(catalogSource, /data-studio-section="toml-registration-layout"/);
  assert.match(catalogSource, /<MultiSelect[\s\S]*data-studio-section="workflow-stage-select"/);
  assert.match(catalogSource, /WORKFLOW_STAGE_OPTIONS[\s\S]*workflowStageLabel\(stage\)/);
  assert.match(catalogSource, /workflowStageListLabel\(workflow\.stages\)/);
  assert.match(catalogSource, /workflowStageLabel\(stageId\)/);
  assert.match(agentLifecyclePanelSource, /workflowStageLabel\(value\)/);
  assert.doesNotMatch(catalogSource, /scopeFixedPathHint|scopeAutoPathHint|importSourceHint/);

  const loadedPresets = renderReactCatalog({
    status: "ready",
    catalog: studioCatalogFixture(),
  }, undefined, "presets");
  assert.match(loadedPresets, /data-studio-section="preset-create-open"/);
  assert.match(loadedPresets, /创建 Preset/);
  assert.match(loadedPresets, /data-preset-action="edit"/);
  assert.match(loadedPresets, /data-preset-action="delete"/);
  assert.match(loadedPresets, /studio-resource-card-layout/);
  assert.match(loadedPresets, /studio-resource-card-main/);
  assert.match(loadedPresets, /studio-resource-card-actions/);
  const presetCreateFields = renderTomlRegistrationFields("preset-create", "创建 Preset");
  assert.doesNotMatch(presetCreateFields, /保存到/);
  assert.match(presetCreateFields, /导入来源/);
  assert.match(presetCreateFields, /data-studio-section="preset-create-source-mode"/);
  assert.match(presetCreateFields, />选择 TOML</);
  assert.match(presetCreateFields, />手动填写</);
  assert.ok(presetCreateFields.indexOf(">手动填写<") < presetCreateFields.indexOf(">选择 TOML<"));
  assert.match(presetCreateFields, /data-studio-section="preset-create-manual-placeholder"/);
  assert.doesNotMatch(presetCreateFields, /选择要导入的 TOML 文件/);
  assert.doesNotMatch(presetCreateFields, /保存文件夹|配置目录固定|scope 自动决定/);
  assert.doesNotMatch(presetCreateFields, />项目目录</);
  assert.doesNotMatch(presetCreateFields, /保存路径由项目或用户 scope 自动决定/);
  assert.doesNotMatch(presetCreateFields, /placeholder="\.\/presets\/review-duo\.toml"/);
  const presetManualFields = renderPresetManualFields();
  assert.match(presetManualFields, />名称</);
  assert.match(presetManualFields, />说明</);
  assert.doesNotMatch(presetManualFields, />Preset 名称</);
  assert.doesNotMatch(presetManualFields, />Preset 说明</);
  assert.match(presetManualFields, />关联 Workflow</);
  assert.match(presetManualFields, />计划</);
  assert.match(presetManualFields, />决策</);
  const copySource = readFileSync(path.resolve("apps/studio-web/src/app/copy.ts"), "utf-8");
  assert.doesNotMatch(catalogSource, /StudioPresetScope/);
  assert.doesNotMatch(catalogSource, /aria-label=\{t\("presetId"\)\}/);
  assert.doesNotMatch(catalogSource, /aria-label=\{t\("workflowId"\)\}/);
  assert.match(catalogSource, /aria-label=\{t\("presetName"\)\}/);
  assert.match(catalogSource, /data-studio-section="preset-workflow-select"/);
  assert.match(catalogSource, /data-studio-section="preset-default-agents-select"/);
  assert.match(catalogSource, /data-studio-section=\{`preset-stage-\$\{stageId\}-agents-select`\}/);
  assert.match(catalogSource, /data-studio-section="preset-default-agents-select"[\s\S]*maxValues=\{MAX_FANOUT_AGENTS\}/);
  assert.match(catalogSource, /maxValues=\{maxAgentsForStageAssignment\(stageId\)\}/);
  assert.match(catalogSource, /stageId === "execute" \|\| stageId\.startsWith\("execute_"\)/);
  assert.match(catalogSource, /data-studio-section="workflow-edit-modal"/);
  assert.match(catalogSource, /data-studio-section="preset-edit-modal"/);
  assert.match(catalogSource, /data-workflow-action="edit"/);
  assert.match(catalogSource, /data-studio-section="delete-confirmation-modal"/);
  assert.match(catalogSource, /data-studio-section="confirm-delete-action"/);
  assert.match(catalogSource, /data-workflow-action="delete"/);
  assert.match(catalogSource, /data-preset-action="delete"/);
  assert.match(catalogSource, /setDeleteConfirmation\(\{[\s\S]*kind: "Agent"/);
  assert.match(catalogSource, /setDeleteConfirmation\(\{[\s\S]*kind: "Workflow"/);
  assert.match(catalogSource, /setDeleteConfirmation\(\{[\s\S]*kind: "Preset"/);
  assert.doesNotMatch(catalogSource, /review = claude-reviewer\\ndecide = codex-gpt-5-5/);
  assert.match(copySource, /presetName: "名称"/);
  assert.match(copySource, /presetDescription: "说明"/);
  assert.doesNotMatch(copySource, /保存文件夹|配置目录固定|scope 自动决定/);
  assert.match(loadedPresets, /Review Duo/);
  assert.match(loadedPresets, /review-duo/);
  assert.match(loadedPresets, /w-9d94d0db · user/);
  assert.match(loadedPresets, /审查: Claude Opus 4\.7 High · 决策: current/);
  assert.doesNotMatch(loadedPresets, /review: Claude Opus 4\.7 High · decide: current/);
  assert.doesNotMatch(loadedPresets, /review: claude-claude-opus-4-7/);

  assert.match(renderReactCatalog({ status: "loading" }), /正在加载资源/);
  assert.match(renderReactCatalog({ status: "error", message: "Authentication required" }), /无法加载资源/);
  assert.match(
    renderReactCatalog({
      status: "ready",
      catalog: { agents: [], workflows: [], presets: [], mcpServers: [], diagnostics: [] },
    }),
    /暂无 Agents。/,
  );
});

test("Unified activities sort runs and calls, group missing timestamps, and search stable fields", () => {
  const run = {
    ...studioRunSummariesFixture()[0],
    run_id: "run-technical",
    title: undefined,
    workflow: "release-workflow",
    status: "running",
    updated_at: "2026-05-18T11:00:00.000Z",
  };
  const missingTimestampRun = {
    ...studioRunSummariesFixture()[1],
    run_id: "run-without-time",
    title: "无时间运行",
    workspace: {
      ...studioRunSummariesFixture()[1].workspace,
      label: "other-workspace",
      path: "/workspace/other",
    },
    created_at: undefined,
    updated_at: undefined,
    latest_event_timestamp: undefined,
  };
  const call = {
    ...studioCallSummaryFixture(),
    id: "call-technical",
    title: "审查发布结果",
    purpose: "review-purpose",
    agent_id: "review-agent",
    model: "review-model",
    status: "success" as const,
    created_at: "2026-05-18T12:00:00.000Z",
    workspace: {
      ...studioCallSummaryFixture().workspace,
      label: "call-workspace",
      path: "/workspace/call",
    },
  };

  const items = activityItems([run, missingTimestampRun], [call]);
  assert.deepEqual(items.map((item) => item.kind), ["call", "run", "run"]);
  assert.deepEqual(items.map((item) => item.title), ["审查发布结果", "run-technical", "无时间运行"]);

  const equalTimestampItems = activityItems(
    [
      { ...run, run_id: "run-z", updated_at: call.created_at },
      { ...run, run_id: "run-a", updated_at: call.created_at },
    ],
    [
      { ...call, id: "call-z" },
      { ...call, id: "call-a" },
    ],
  );
  const equalTimestampKeys = equalTimestampItems.map((item) => `${item.kind}:${item.key}`);
  assert.deepEqual(equalTimestampKeys, [...equalTimestampKeys].sort());

  const groups = groupActivityItems(items);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups.at(-1)?.date, "unknown");
  assert.deepEqual(groups.at(-1)?.items.map((item) => item.title), ["无时间运行"]);

  for (const [query, expectedKind] of [
    ["审查发布", "call"],
    ["call-technical", "call"],
    ["review-purpose", "call"],
    ["review-agent", "call"],
    ["review-model", "call"],
    ["call-workspace", "call"],
    ["success", "call"],
    ["run-technical", "run"],
    ["release-workflow", "run"],
    ["/workspace/project", "run"],
  ] as const) {
    assert.deepEqual(filterActivityItems(items, query).map((item) => item.kind), [expectedKind]);
  }
});

test("Unified activity groups preview five items and keep partial data visible on errors", () => {
  const call = {
    ...studioCallSummaryFixture(),
    title: "可用调用记录",
    purpose: "internal-summary-must-not-render",
    created_at: "2026-05-18T12:00:00.000Z",
  };
  const calls = Array.from({ length: 7 }, (_, index) => ({
    ...call,
    id: `activity-call-${index + 1}`,
  }));
  const items = activityItems([], calls);

  assert.equal(ACTIVITY_GROUP_PREVIEW_LIMIT, 5);
  assert.equal(visibleActivityGroupItems(items, false, "").length, 5);
  assert.equal(visibleActivityGroupItems(items, true, "").length, 7);
  assert.equal(visibleActivityGroupItems(items, false, "activity").length, 7);
  assert.equal(activityGroupCollapsed(true, ""), true);
  assert.equal(activityGroupCollapsed(true, "activity"), false);
  assert.equal(parseAutoRefreshSeconds("15"), 15);
  assert.equal(parseAutoRefreshSeconds("bad"), 0);

  const previewMarkup = renderActivityNavigator(
    { status: "ready", runs: [] },
    { status: "ready", calls },
  );
  assert.match(previewMarkup, /data-nav-group=/);
  assert.match(previewMarkup, /studio-activity-refresh-icon/);
  assert.doesNotMatch(previewMarkup, />↻</);
  assert.match(previewMarkup, /aria-expanded="true"/);
  assert.match(previewMarkup, /aria-expanded="false"/);
  assert.match(previewMarkup, /展开其余 2 条/);
  for (let index = 1; index <= 5; index += 1) {
    assert.match(previewMarkup, new RegExp(`activity-call-${index}`));
  }
  assert.doesNotMatch(previewMarkup, /activity-call-6|activity-call-7/);
  const searchMarkup = renderActivityNavigator(
    { status: "ready", runs: [] },
    { status: "ready", calls },
    "activity-call",
  );
  assert.match(searchMarkup, /activity-call-6/);
  assert.match(searchMarkup, /activity-call-7/);
  assert.doesNotMatch(searchMarkup, /展开其余/);

  const selectedCallKey = studioCallKey(calls[0]);
  const selectedMarkup = renderActivityNavigator(
    { status: "ready", runs: [] },
    { status: "ready", calls },
    "",
    { selectedKind: "call", selectedCallKey },
  );
  assert.match(
    selectedMarkup,
    new RegExp(`data-activity-key="${escapeRegExp(selectedCallKey)}"[^>]*aria-current="true"`),
  );
  const overlayMarkup = renderActivityNavigator(
    { status: "ready", runs: [] },
    { status: "ready", calls },
    "",
    { selectedKind: undefined, selectedCallKey },
  );
  assert.doesNotMatch(overlayMarkup, /aria-current="true"/);

  const markup = renderActivityNavigator(
    { status: "error", message: "run endpoint failed" },
    { status: "ready", calls: [call] },
  );
  assert.match(markup, /运行加载失败/);
  assert.match(markup, /run endpoint failed/);
  assert.match(markup, /可用调用记录/);
  assert.match(markup, /\[调用\]/);
  assert.match(markup, new RegExp(formatLocalTime(call.created_at)));
  assert.doesNotMatch(markup, /internal-summary-must-not-render/);

  const staleRun = studioRunSummariesFixture()[0];
  const staleMarkup = renderActivityNavigator(
    { status: "error", message: "run refresh failed", runs: [staleRun] },
    { status: "error", message: "call refresh failed", calls: [call] },
  );
  assert.deepEqual(
    activityRuns({ status: "error", message: "run refresh failed", runs: [staleRun] }),
    [staleRun],
  );
  assert.deepEqual(
    activityCalls({ status: "error", message: "call refresh failed", calls: [call] }),
    [call],
  );
  assert.match(staleMarkup, /编排发布流程/);
  assert.match(staleMarkup, /可用调用记录/);
  assert.match(staleMarkup, /运行加载失败/);
  assert.match(staleMarkup, /调用加载失败/);

  const symmetricMarkup = renderActivityNavigator(
    { status: "ready", runs: [studioRunSummariesFixture()[0]] },
    { status: "error", message: "call endpoint failed" },
  );
  assert.match(symmetricMarkup, /调用加载失败/);
  assert.match(symmetricMarkup, /编排发布流程/);

  const missingTimeMarkup = renderActivityNavigator(
    {
      status: "ready",
      runs: [{
        ...studioRunSummariesFixture()[0],
        title: "无时间运行",
        created_at: undefined,
        updated_at: undefined,
        latest_event_timestamp: undefined,
      }],
    },
    { status: "ready", calls: [] },
  );
  assert.match(missingTimeMarkup, /无时间运行/);
  assert.match(missingTimeMarkup, /时间未知/);
  assert.doesNotMatch(missingTimeMarkup, /<time/);

});

test("Run overview, artifacts, events and review release render Mantine panels", () => {
  const detail = studioRunDetailFixture();
  const overview = renderRunOverview({ status: "ready", detail });
  assert.match(overview, /Workflow Flow/);
  assert.doesNotMatch(overview, /工作流流程/);
  assert.match(overview, />执行</);
  assert.match(overview, />审查</);
  assert.match(overview, /data-workflow-stage="review"/);
  assert.match(overview, /workflow-step/);
  assert.match(overview, /workflow-connector/);
  assert.equal(preferredWorkflowStage(detail.summary), "review");
  assert.equal(workflowStageStatus(detail.summary, "execute"), "completed");
  assert.equal(workflowStageStatus(detail.summary, "review"), "current");
  assert.equal(workflowStageLabel("review"), "审查");
  assert.equal(workflowStageLabel("execute"), "执行");
  assert.equal(workflowStageLabel("custom_stage"), "custom_stage");
  const details = renderRunOverview({ status: "ready", detail }, "details");
  const overviewIndex = details.indexOf('data-studio-section="current-run-overview"');
  const workflowIndex = details.indexOf('data-studio-section="workflow-flow"');
  assert.ok(overviewIndex >= 0);
  assert.ok(workflowIndex >= 0);
  assert.ok(overviewIndex < workflowIndex);
  const summaryHtml = details.slice(overviewIndex, workflowIndex);
  assert.match(summaryHtml, /data-studio-section="run-summary-row"/);
  assert.match(summaryHtml, /data-summary-field="workspace"[\s\S]*工作区[\s\S]*project/);
  assert.match(summaryHtml, /data-summary-field="run"[\s\S]*运行[\s\S]*run-1/);
  assert.match(summaryHtml, /data-summary-field="workflow"[\s\S]*Workflow[\s\S]*w-7db15660/);
  assert.match(summaryHtml, /data-summary-field="workspace"[\s\S]*data-summary-field="status"[\s\S]*data-summary-field="run"[\s\S]*data-summary-field="workflow"/);
  assert.doesNotMatch(summaryHtml, /class="[^"]*studio-metric/);
  assert.match(details, /data-studio-section="workflow-flow"/);
  assert.match(details, /data-studio-section="workflow-flow-node-metrics"/);
  assert.match(details, /title="审查"/);
  assert.match(details, /审查 · 当前/);
  assert.match(details, /data-workflow-stage="review"/);
  assert.match(details, /data-workflow-stage="execute"/);
  assert.doesNotMatch(details, /workflow-step-stack/);
  const stageDetailIndex = details.indexOf('data-studio-section="workflow-stage-detail"');
  const stageEvidenceIndex = details.indexOf('data-studio-section="review-stage-evidence"', stageDetailIndex);
  assert.ok(stageDetailIndex >= 0);
  assert.ok(stageEvidenceIndex > stageDetailIndex);
  const stageDetailHtml = details.slice(stageDetailIndex, stageEvidenceIndex);
  assert.match(stageDetailHtml, /data-studio-section="workflow-stage-summary-row"/);
  assert.match(stageDetailHtml, /data-stage-field="stage"[\s\S]*阶段[\s\S]*审查/);
  assert.match(stageDetailHtml, /data-stage-field="status"[\s\S]*状态[\s\S]*当前/);
  assert.match(stageDetailHtml, /data-stage-field="agent"[\s\S]*Agent[\s\S]*current/);
  assert.match(stageDetailHtml, /data-stage-field="type"[\s\S]*类型[\s\S]*审查/);
  assert.doesNotMatch(stageDetailHtml, /title="review"[^>]*>review/);
  assert.match(stageDetailHtml, /data-stage-field="stage"[\s\S]*data-stage-field="status"[\s\S]*data-stage-field="type"[\s\S]*data-stage-field="agent"/);
  assert.doesNotMatch(stageDetailHtml, /class="[^"]*studio-metric/);
  assert.doesNotMatch(stageDetailHtml, /问题/);
  assert.doesNotMatch(stageDetailHtml, /原始审查/);
  const stageEvidenceHtml = details.slice(stageEvidenceIndex);
  assert.match(stageEvidenceHtml, /data-studio-section="review-stage-evidence"[\s\S]*审查 \/ 发布/);
  assert.match(stageEvidenceHtml, /问题[\s\S]*已接受 #1[\s\S]*fix run scroll/);
  assert.match(stageEvidenceHtml, /原始审查[\s\S]*Cursor Reviewer/);
  const runOverviewSource = readFileSync(path.resolve("apps/studio-web/src/features/runs/RunOverview.tsx"), "utf-8");
  const workflowStageDetailSource = runOverviewSource.slice(
    runOverviewSource.indexOf("function WorkflowStageDetail"),
    runOverviewSource.indexOf("function OverviewMetric"),
  );
  assert.doesNotMatch(workflowStageDetailSource, /ReviewReleaseStageEvidence/);
  assert.match(details, /padding:calc\(0\.375rem \* var\(--mantine-scale\)\)/);
  assert.match(details, /300\.0s · 2 次尝试/);
  assert.match(details, /data-studio-section="workflow-flow-node-time"/);
  assert.match(details, /data-workflow-stage="execute"[\s\S]*data-studio-section="workflow-flow-node-time"[\s\S]*14:55:00/);
  assert.doesNotMatch(details, /data-studio-section="workflow-flow-node-agents"/);
  assert.match(details, /Agent[\s\S]*current/);
  assert.match(details, /退出码[\s\S]*无外部进程/);
  assert.doesNotMatch(details, /退出码[\s\S]*未知/);
  assert.doesNotMatch(details, /耗时 · 300\.0s/);
  assert.doesNotMatch(details, /尝试次数 · 2 次尝试/);
  assert.match(details, /data-studio-section="current-run-overview"/);
  assert.doesNotMatch(details, /data-studio-section="run-diagnostics"/);
  const namedWorkflowDetails = renderRunOverview(
    { status: "ready", detail },
    "details",
    undefined,
    { "w-7db15660": "Bug Fix" },
  );
  assert.match(namedWorkflowDetails, /title="Bug Fix"[^>]*>Bug Fix/);
  assert.match(namedWorkflowDetails, /Workflow[\s\S]*Bug Fix/);
  assert.doesNotMatch(namedWorkflowDetails, /title="w-7db15660"[^>]*>w-7db15660/);
  const executeDetails = renderRunOverview({
    status: "ready",
    detail: {
      ...detail,
      summary: {
        ...detail.summary,
        current_stage: "execute",
      },
    },
  }, "details");
  assert.match(executeDetails, /Agent[\s\S]*worker/);
  assert.match(executeDetails, /退出码[\s\S]*exit=0/);
  const agentLabels = {
    builder: "Builder Agent",
    current: "当前入口",
    fallback: "Fallback Agent",
    planner: "Planner Agent",
    worker: "Worker Agent",
  };
  const namedDetails = renderRunOverview({ status: "ready", detail }, "details", agentLabels);
  assert.match(namedDetails, /data-studio-section="workflow-flow-node-time"/);
  assert.doesNotMatch(namedDetails, /data-studio-section="workflow-flow-node-agents"/);
  assert.match(namedDetails, /title="当前入口"[^>]*>当前入口/);
  assert.doesNotMatch(namedDetails, /title="current"[^>]*>current/);
  const longAgentDetails = renderRunOverview({ status: "ready", detail }, "details", {
    ...agentLabels,
    current: "Claude Code Opus 4.8 High, Cursor Composer 2.5, Antigravity Current",
  });
  const longAgentFieldStart = longAgentDetails.indexOf('data-stage-field="agent"');
  const longAgentFieldEnd = longAgentDetails.indexOf('data-stage-field="startedAt"', longAgentFieldStart);
  assert.ok(longAgentFieldStart >= 0);
  assert.ok(longAgentFieldEnd > longAgentFieldStart);
  const longAgentFieldHtml = longAgentDetails.slice(longAgentFieldStart, longAgentFieldEnd);
  assert.match(longAgentFieldHtml, /run-summary-value wrap/);
  assert.doesNotMatch(longAgentFieldHtml, /data-truncate/);
  assert.match(longAgentFieldHtml, /Claude Code Opus 4\.8 High, Cursor Composer 2\.5, Antigravity Current/);
  const namedExecuteDetails = renderRunOverview({
    status: "ready",
    detail: {
      ...detail,
      summary: {
        ...detail.summary,
        current_stage: "execute",
      },
    },
  }, "details", agentLabels);
  assert.match(namedExecuteDetails, /data-studio-section="workflow-flow-node-time"[\s\S]*14:55:00/);
  assert.doesNotMatch(namedExecuteDetails, /data-studio-section="workflow-flow-node-agents"/);
  assert.match(namedExecuteDetails, /title="Worker Agent"[^>]*>Worker Agent/);
  assert.doesNotMatch(namedExecuteDetails, /title="worker"[^>]*>worker/);

  const attemptsOnlySummary = {
    ...detail.summary,
    stages: ["build"],
    stage_nodes: [],
    completed_stages: ["build"],
    current_stage: undefined,
    stage_assignments: {},
    stage_invocations: {},
    stage_attempts: {
      build: [
        { actual_agent: "builder", exit_code: 1, status: "failed" },
        { actual_agent: "fallback", exit_code: 2, status: "failed" },
      ],
    },
    stage_timing: [
      {
        stage: "build",
        attempt_count: 2,
        exit_code: null,
      },
    ],
  };
  assert.deepEqual(workflowStageIds(attemptsOnlySummary), ["build"]);
  assert.equal(workflowStageAgentLabel(attemptsOnlySummary, "build", testStudioCopy), "builder, fallback");
  assert.equal(workflowStageAgentLabel(attemptsOnlySummary, "build", testStudioCopy, agentLabels), "Builder Agent, Fallback Agent");
  assert.equal(workflowStageNodeTimeLabel(detail.summary, "execute", testStudioCopy), "14:55:00");
  assert.equal(workflowStageNodeTimeLabel(attemptsOnlySummary, "build", testStudioCopy), "未知");
  assert.equal(workflowStageNodeTimeLabel({
    ...attemptsOnlySummary,
    stage_timing: [{ stage: "build", attempt_count: 1, started_at: "2026-05-18T08:03:04.000Z", completed_at: "2026-05-18T08:08:09.000Z" }],
  }, "build", testStudioCopy), "16:03:04");
  assert.equal(workflowStageExitLabel(attemptsOnlySummary, "build", testStudioCopy), "exit=1, exit=2");
  assert.equal(workflowStageExitLabel({
    ...attemptsOnlySummary,
    stage_attempts: {
      build: [{ actual_agent: "builder", exit_code: 0, status: "completed" }],
    },
  }, "build", testStudioCopy), "exit=0");
  assert.equal(workflowStageExitLabel({
    ...detail.summary,
    stage_assignments: {},
    stage_invocations: {
      review: [{ kind: "current" }],
    },
    stage_attempts: {
      review: [],
    },
  }, "review", testStudioCopy), "无外部进程");
  assert.equal(workflowStageExitLabel({
    ...detail.summary,
    stage_assignments: {},
    stage_invocations: {
      review: [{ agent: "current", kind: "current" }],
    },
    stage_attempts: {
      review: [{ actual_agent: "reviewer", status: "completed" }],
    },
  }, "review", testStudioCopy), "未记录");
  assert.equal(workflowStageExitLabel({
    ...detail.summary,
    stage_assignments: {
      review: ["reviewer"],
    },
    stage_invocations: {
      review: [{ agent: "reviewer", kind: "primary" }],
    },
    stage_attempts: {
      review: [],
    },
  }, "review", testStudioCopy), "未记录");

  const artifacts = sortStudioArtifacts(detail);
  assert.deepEqual(artifacts.map((artifact) => artifact.name), ["prompt.md", "output.md"]);
  const artifactHtml = renderArtifactPreviewPanel(detail, "output.md", {
    status: "ready",
    preview: {
      ...detail.artifacts[1],
      content: "final output",
      truncated: false,
    },
  });
  assert.match(artifactHtml, /data-studio-section="packet-artifacts"/);
  assert.match(artifactHtml, /data-studio-section="artifact-preview"/);
  assert.match(artifactHtml, /data-studio-section="artifact-info"/);
  assert.match(artifactHtml, /artifact-preview-panel/);
  assert.match(artifactHtml, /产物信息/);
  assert.match(artifactHtml, /路径/);
  assert.match(artifactHtml, /output\.md/);
  assert.match(artifactHtml, /final output/);
  assert.ok(artifactHtml.indexOf("产物信息") < artifactHtml.indexOf("预览: 输出"));
  assert.doesNotMatch(artifactHtml, /预览: output\.md/);
  assert.match(artifactHtml, /artifact-node/);
  assert.match(artifactHtml, /artifact-step/);
  assert.match(artifactHtml, /artifact-connector/);
  assert.match(artifactHtml, /padding:var\(--mantine-spacing-xs\)/);
  assert.match(artifactHtml, /data-studio-section="artifact-generated-at"/);
  assert.doesNotMatch(artifactHtml, /生成时间 ·/);
  assert.match(artifactHtml, /2026-05-18/);
  assert.doesNotMatch(artifactHtml, /共 2 个/);
  assert.match(artifactHtml, /2 个产物/);
  assert.equal(artifactDisplayName(detail.artifacts[0]), "提示词");
  assert.equal(artifactDisplayName(detail.artifacts[1]), "输出");
  assert.equal(artifactDisplayName({
    name: "scope-confirm",
    path: "docs/03-Scope确认.md",
    kind: "markdown",
    stage: "review",
  }), "范围确认");
  const assignmentHtml = renderArtifactPreviewPanel({
    ...detail,
    artifacts: [
      ...detail.artifacts,
      {
        name: "assignment.toml",
        path: "assignment.toml",
        kind: "assignment",
        stage: "run",
        written_at: "2026-05-18T06:00:00.000Z",
      },
    ],
  }, "assignment.toml", {
    status: "ready",
    preview: {
      name: "assignment.toml",
      path: "assignment.toml",
      kind: "assignment",
      stage: "run",
      content: [
        "schema_version = 1",
        "workflow = \"w-9d94d0db\"",
        "stages = [\"review\", \"decide\"]",
        "",
        "[[stage_nodes]]",
        "id = \"review\"",
        "type = \"review\"",
        "occurrence = 1",
        "",
        "[[stage_nodes]]",
        "id = \"decide\"",
        "type = \"decide\"",
        "occurrence = 1",
        "",
        "[stage_assignments]",
        "review = [\"a-a9d455aa\", \"a-32c98ad9\"]",
        "decide = [\"a-a9d455aa\"]",
      ].join("\n"),
      truncated: false,
    },
  }, {
    "a-32c98ad9": "Cursor Composer 2.5",
    "a-a9d455aa": "Claude Code Opus 4.8 High",
  });
  assert.match(assignmentHtml, /data-studio-section="artifact-assignment-summary"/);
  assert.match(assignmentHtml, /任务分配摘要/);
  assert.match(assignmentHtml, /类型[\s\S]*任务分配/);
  assert.match(assignmentHtml, /阶段[\s\S]*运行/);
  assert.match(assignmentHtml, /Agent[\s\S]*运行级产物/);
  assert.match(assignmentHtml, /Workflow[\s\S]*w-9d94d0db/);
  assert.match(assignmentHtml, /阶段顺序[\s\S]*审查 -&gt; 决策/);
  assert.match(assignmentHtml, /节点[\s\S]*审查[\s\S]*类型：审查[\s\S]*第 1 次/);
  assert.match(assignmentHtml, /Agent 分配[\s\S]*审查：Claude Code Opus 4\.8 High、Cursor Composer 2\.5/);
  assert.match(assignmentHtml, /决策：Claude Code Opus 4\.8 High/);
  assert.match(assignmentHtml, /运行调度生成/);
  assert.doesNotMatch(assignmentHtml, /artifact-info-item wide/);
  assert.doesNotMatch(assignmentHtml, /schema_version = 1/);
  assert.doesNotMatch(assignmentHtml, /a-a9d455aa/);
  assert.doesNotMatch(assignmentHtml, /a-32c98ad9/);
  assert.doesNotMatch(assignmentHtml, /Agent[\s\S]*未知/);
  const statusHtml = renderArtifactPreviewPanel({
    ...detail,
    artifacts: [
      ...detail.artifacts,
      {
        name: "status",
        path: "status.json",
        kind: "status",
        stage: "run",
        written_at: "2026-05-18T06:01:04.460Z",
      },
    ],
  }, "status", {
    status: "ready",
    preview: {
      name: "status",
      path: "status.json",
      kind: "status",
      stage: "run",
      content: JSON.stringify({
        schema_version: 1,
        run_id: "workflow-20260617140101",
        created_at: "2026-06-17T06:01:01.057Z",
        updated_at: "2026-06-17T06:01:04.460Z",
        status: "review_running",
        stage_assignments: {
          review: ["a-a9d455aa", "a-32c98ad9"],
          decide: ["a-a9d455aa"],
        },
        stage_invocations: {
          review: [
            { lane_id: "review:a-a9d455aa", kind: "primary", agent: "a-a9d455aa" },
          ],
        },
        stage_attempts: {
          review: [
            {
              agent: "a-a9d455aa",
              actual_agent: "a-a9d455aa",
              status: "running",
              started_at: "2026-06-17T06:01:04.000Z",
            },
          ],
        },
      }, null, 2),
      truncated: false,
    },
  }, {
    "a-32c98ad9": "Cursor Composer 2.5",
    "a-a9d455aa": "Claude Code Opus 4.8 High",
  });
  assert.match(statusHtml, /data-studio-section="artifact-status-summary"/);
  assert.match(statusHtml, /运行状态摘要/);
  assert.match(statusHtml, /名称[\s\S]*运行状态/);
  assert.match(statusHtml, /类型[\s\S]*运行状态/);
  assert.match(statusHtml, /Agent[\s\S]*运行级产物/);
  assert.match(statusHtml, /运行 ID[\s\S]*workflow-20260617140101/);
  assert.match(statusHtml, /当前状态[\s\S]*审查中/);
  assert.match(statusHtml, /创建时间[\s\S]*2026-06-17/);
  assert.match(statusHtml, /更新时间[\s\S]*2026-06-17/);
  assert.match(statusHtml, /阶段分配[\s\S]*审查：Claude Code Opus 4\.8 High、Cursor Composer 2\.5/);
  assert.match(statusHtml, /调用记录[\s\S]*审查：主分配，Claude Code Opus 4\.8 High/);
  assert.match(statusHtml, /尝试记录[\s\S]*审查：运行中，Claude Code Opus 4\.8 High/);
  assert.doesNotMatch(statusHtml, /"schema_version"/);
  assert.doesNotMatch(statusHtml, /a-a9d455aa/);
  const contextHtml = renderArtifactPreviewPanel({
    ...detail,
    artifacts: [
      ...detail.artifacts,
      {
        name: "context",
        path: "context.md",
        kind: "context",
        stage: "run",
        written_at: "2026-06-17T05:56:45.680Z",
      },
    ],
  }, "context", {
    status: "ready",
    preview: {
      name: "context",
      path: "context.md",
      kind: "context",
      stage: "run",
      content: [
        "# Context",
        "",
        "## Scoped Git Diff",
        "",
        "### Provenance",
        "",
        "```toml",
        "schema_version = 1",
        "source_type = \"scoped_git_diff\"",
        "source = \"recycle_superman/service/src/main/java/com/zhuanzhuan/recycle\"",
        "source_command = \"git diff HEAD -- recycle_superman/service/src/main/java/com/zhuanzhuan/recycle\"",
        "capture_timestamp = \"2026-06-17T05:56:45.680Z\"",
        "freshness = \"unknown\"",
        "owner = \"unknown\"",
        "validation_state = \"failed\"",
        "ingestion_error = \"git diff failed with exit code 129\\nwarning: Not a git repository.\"",
        "redaction_state = \"none\"",
        "```",
        "",
        "### Content",
        "",
        "(no scoped diff captured)",
      ].join("\n"),
      truncated: false,
    },
  });
  assert.match(contextHtml, /data-studio-section="artifact-context-summary"/);
  assert.match(contextHtml, /上下文摘要/);
  assert.match(contextHtml, /名称[\s\S]*上下文/);
  assert.match(contextHtml, /类型[\s\S]*上下文/);
  assert.match(contextHtml, /范围 Git Diff/);
  assert.match(contextHtml, /抓取失败/);
  assert.match(contextHtml, /命令[\s\S]*git diff HEAD -- recycle_superman/);
  assert.match(contextHtml, /失败原因[\s\S]*git diff 执行失败/);
  assert.match(contextHtml, /not a git repository/i);
  assert.doesNotMatch(contextHtml, /source_type/);
  assert.doesNotMatch(contextHtml, /validation_state/);
  assert.doesNotMatch(contextHtml, /ingestion_error/);
  const sidebarHtml = renderStudioElement(React.createElement(ArtifactSidebarPanel, {
    detail,
    selectedArtifactName: "output.md",
    onSelectArtifact: () => {},
  }));
  assert.match(sidebarHtml, /data-studio-section="current-node-artifacts"/);
  assert.match(sidebarHtml, /当前节点/);
  assert.match(sidebarHtml, /review/);
  assert.match(sidebarHtml, /产物/);
  assert.match(sidebarHtml, /提示词/);
  assert.match(sidebarHtml, /输出/);
  assert.match(sidebarHtml, /data-artifact-sidebar-item="output\.md"/);
  assert.doesNotMatch(sidebarHtml, />output\.md</);
  assert.match(sidebarHtml, /15:01:00/);
  assert.doesNotMatch(sidebarHtml, /已生成/);
  const artifactPreviewSource = readFileSync(
    path.resolve("apps/studio-web/src/features/artifacts/ArtifactPreviewPanel.tsx"),
    "utf-8",
  );
  assert.match(artifactPreviewSource, /className="artifact-sidebar-summary"/);
  assert.match(artifactPreviewSource, /className="artifact-sidebar-artifacts"[\s\S]*className="artifact-sidebar-list-heading"/);
  assert.match(artifactPreviewSource, /className="artifact-sidebar-item-row"/);
  assert.match(artifactPreviewSource, /className="artifact-sidebar-item-main"/);
  assert.match(artifactPreviewSource, /className="artifact-sidebar-item-time"/);
  assert.doesNotMatch(artifactPreviewSource, /className="artifact-sidebar-item-status"/);
  assert.doesNotMatch(artifactPreviewSource, /t\("generated"\)/);
  assert.match(artifactPreviewSource, /p=\{0\}/);
  renderStudioElement(React.createElement(ArtifactPreviewDrawer, {
    opened: true,
    previewState: {
      status: "ready",
      preview: {
        ...detail.artifacts[1],
        content: "final output",
        truncated: false,
      },
    },
    onClose: () => {},
  }));
  assert.match(artifactPreviewSource, /size="50vw"/);
  assert.match(artifactPreviewSource, /offset="clamp\(16px,\s*1\.5vw,\s*32px\)"/);
  assert.match(artifactPreviewSource, /classNames=\{\{\s*content:\s*"artifact-preview-drawer"\s*\}\}/s);
  assert.doesNotMatch(artifactPreviewSource, /withinPortal=\{false\}/);
  assert.match(artifactPreviewSource, /data-studio-section="artifact-preview-drawer"/);
  assert.match(artifactPreviewSource, /drawerTitle\(previewState,\s*t\)/);
  assert.match(artifactPreviewSource, /<ArtifactPreviewContent state=\{previewState\} t=\{t\} agentLabels=\{agentLabels\} \/>/);
  assert.match(artifactPreviewSource, /return artifactDisplayName\(state\.preview\)/);
  assert.match(artifactPreviewSource, /className="artifact-preview-drawer-layout"/);
  assert.match(artifactPreviewSource, /className="artifact-preview-drawer-main"/);
  assert.doesNotMatch(artifactPreviewSource, /artifact-preview-drawer-gutter/);

  const eventHtml = renderEventLogView(detail);
  assert.match(eventHtml, /显示 1-4 \/ 共 120 个事件/);
  assert.doesNotMatch(eventHtml, />120 个事件</);
  assert.match(eventHtml, /阶段完成/);
  assert.match(eventHtml, /产物写入/);
  assert.match(eventHtml, /阶段: 执行/);
  assert.match(eventHtml, /产物: output\.md/);
  assert.match(eventHtml, /路径: artifacts\/output\.md/);
  assert.match(eventHtml, /运行创建/);
  assert.match(eventHtml, /阶段列表: 计划, 执行/);
  assert.match(eventHtml, /阶段节点: 节点=计划, 类型=计划, 序号=1/);
  assert.doesNotMatch(eventHtml, /stage\.completed/);
  assert.doesNotMatch(eventHtml, /artifact\.written/);
  assert.doesNotMatch(eventHtml, /stage_nodes/);
  assert.doesNotMatch(eventHtml, /stages:/);
  assert.doesNotMatch(eventHtml, /STAGE:/);
  assert.doesNotMatch(eventHtml, /PATH:/);
  assert.doesNotMatch(eventHtml, /事件分页/);
  assert.doesNotMatch(eventHtml, /data-event-offset/);
  assert.doesNotMatch(eventHtml, />最新</);
  assert.doesNotMatch(eventHtml, />更新</);
  assert.doesNotMatch(eventHtml, />更早</);
  assert.equal(sortStudioEventsDescending(detail.events)[0].event, "artifact.written");
  const namedEventHtml = renderEventLogView({
    ...detail,
    events: [
      ...detail.events,
      {
        event: "stage.agent_completed",
        timestamp: "2026-05-18T07:02:00.000Z",
        started_at: "2026-05-18T06:58:00.000Z",
        stage: "review",
        agent: "reviewer-id",
        actual_agent: "worker",
        agents: ["reviewer-id", "worker"],
      },
    ],
  }, {
    "reviewer-id": "Reviewer Agent",
    worker: "Worker Agent",
  });
  assert.match(namedEventHtml, /智能体完成/);
  assert.match(namedEventHtml, /智能体: Reviewer Agent/);
  assert.match(namedEventHtml, /实际智能体: Worker Agent/);
  assert.match(namedEventHtml, /智能体列表: Reviewer Agent, Worker Agent/);
  assert.match(namedEventHtml, /2026-05-18 14:58:00/);
  assert.doesNotMatch(namedEventHtml, /2026-05-18 15:02:00/);
  assert.doesNotMatch(namedEventHtml, /智能体: reviewer-id/);
  assert.doesNotMatch(namedEventHtml, /实际智能体: worker/);

  const releaseHtml = renderReviewReleaseView(detail);
  assert.match(releaseHtml, /审查 \/ 发布/);
  assert.match(releaseHtml, /needs_decision/);
  assert.match(releaseHtml, /manual approval required/);
  assert.match(releaseHtml, /data-studio-section="review-finding-item"/);
  assert.match(releaseHtml, /已接受 #1[\s\S]*fix run scroll/);
  assert.match(releaseHtml, /需要决策 #1[\s\S]*ship now\?/);
  assert.match(releaseHtml, /原始审查/);
  assert.match(releaseHtml, /Cursor Reviewer/);
});

test("Review release keeps structured sections visible with empty classified findings", () => {
  const detail: StudioRunDetail = {
    ...studioRunDetailFixture(),
    review_release: {
      findings: {
        present: true,
        accepted: [],
        rejected: [],
        needs_decision: [],
      },
      raw_reviews: [
        {
          reviewer: "claude",
          reviewer_label: "Claude Code Opus 4.6 Hight",
          path: "reviews/claude.md",
          content: "[Must Fix] src/app.ts:1 - Needs follow-up.",
          truncated: false,
        },
      ],
      release_summary: {
        present: false,
        path: "release-summary.md",
        truncated: false,
        sections: [],
      },
      skipped_checks: [],
      residual_risk: [],
    },
  };

  const html = renderReviewReleaseView(detail);
  assert.match(html, /Claude Code Opus 4\.6 Hight/);
  assert.match(html, /Needs follow-up/);
  assert.match(html, /aria-label="发布结论"/);
  assert.match(html, /aria-label="问题"/);
  assert.match(html, /aria-label="发布摘要"/);
  assert.match(html, /aria-label="跳过的检查"/);
  assert.match(html, /aria-label="剩余风险"/);
  assert.match(html, /已接受 · 0/);
  assert.match(html, /已拒绝 · 0/);
  assert.match(html, /需要决策 · 0/);
  assert.doesNotMatch(html, /仅原始审查/);
});

test("Review release ignores placeholder finding labels in the UI", () => {
  const detail: StudioRunDetail = {
    ...studioRunDetailFixture(),
    review_release: {
      ...studioRunDetailFixture().review_release,
      findings: {
        present: true,
        accepted: ["TBD"],
        rejected: ["TBD"],
        needs_decision: [
          "Reviewer a-a9d455aa failed during review dispatch (exit 1); decider must classify partial review evidence before completion.",
        ],
      },
    },
  };

  const html = renderReviewReleaseView(detail);
  assert.match(html, /已接受 · 0/);
  assert.match(html, /已拒绝 · 0/);
  assert.match(html, /需要决策 · 1/);
  assert.match(html, /需要决策 #1[\s\S]*Reviewer a-a9d455aa failed during review dispatch/);
  assert.doesNotMatch(html, /已接受 #1[\s\S]*TBD/);
  assert.doesNotMatch(html, /已拒绝 #1[\s\S]*TBD/);
});

test("Artifact preview renders markdown artifacts as formatted content", () => {
  const detail = studioRunDetailFixture();
  const markdownHtml = renderArtifactPreviewPanel(detail, "output.md", {
    status: "ready",
    preview: {
      ...detail.artifacts[1],
      content: [
        "## Review",
        "",
        "Overall **looks good** with `preset-YYYYMMDDHHmmss`.",
        "",
        "| Requirement | Status |",
        "|---|---|",
        "| Preset id | Met |",
        "",
        "- Keep collision suffixes",
      ].join("\n"),
      truncated: false,
    },
  });

  assert.match(markdownHtml, /class="[^"]*artifact-markdown/);
  assert.match(markdownHtml, /<h2>Review<\/h2>/);
  assert.match(markdownHtml, /<strong>looks good<\/strong>/);
  assert.match(markdownHtml, /<code>preset-YYYYMMDDHHmmss<\/code>/);
  assert.match(markdownHtml, /<table>/);
  assert.match(markdownHtml, /<th>Requirement<\/th>/);
  assert.match(markdownHtml, /<td>Preset id<\/td>/);
  assert.match(markdownHtml, /<li>Keep collision suffixes<\/li>/);
  assert.doesNotMatch(markdownHtml, />## Review</);
});

test("Call detail renders previews, warnings, adoption controls and history", () => {
  const detail = studioCallDetailFixture();
  const html = renderCallDetailView({ status: "ready", detail });

  assert.match(html, /直接调用/);
  assert.match(html, /输出路径悬空/);
  assert.match(html, /Prompt/);
  assert.match(html, /Please review this change/);
  assert.match(html, /本地证据标记/);
  assert.match(html, /接受/);
  assert.match(html, /采纳历史/);
  assert.match(renderCallDetailView({ status: "empty" }), /请选择调用。/);
  assert.match(renderCallDetailView({ status: "error", message: "no call" }), /调用详情加载失败/);
});

test("Safe actions, settings, integrations, agent lifecycle and manual use Mantine controls", () => {
  const mutationState: SafeActionMutationState = {
    status: "result",
    response: mutationResponseFixture(),
  };
  const actions = renderSafeActionsPanel("run-1", mutationState);
  assert.match(actions, /操作阶段/);
  assert.match(actions, /附加阶段/);
  assert.match(actions, /node agentmesh flow dispatch/);
  assert.match(actions, /No mutation output yet.|exit_code/);

  assert.deepEqual(buildSafeActionRequest({
    action: "dispatch",
    selectedRunId: "run-1",
    actionStage: "review",
    attachStage: "decide",
    attachText: "ok",
  }), { action: "dispatch", run_id: "run-1", stage: "review" });
  assert.throws(() => buildSafeActionRequest({
    action: "resume",
    selectedRunId: undefined,
    actionStage: "all",
    attachStage: "decide",
    attachText: "",
  }), /Select a run first/);

  const settings = renderSettingsAboutPanel({
    status: "ready",
    compatibility: compatibilityFixture(),
    update: { status: "ready", report: updateFixture() },
  }, {
    state: {
      status: "update_available",
      currentVersion: "0.1.10",
      version: "0.1.11",
      notes: "Updater enabled",
    },
    onCheck: async () => {},
    onInstall: async () => {},
  });
  assert.match(settings, /可读写/);
  assert.match(settings, /运行时版本/);
  assert.match(settings, /当前入口/);
  assert.match(settings, /Web 端（studio）/);
  assert.match(settings, /兼容性文件/);
  assert.match(settings, /\.agentmesh\/compatibility\.json/);
  assert.match(settings, /元数据状态/);
  assert.match(settings, /已记录/);
  assert.match(settings, /Packet Schema 版本/);
  assert.match(settings, /最低读取版本/);
  assert.match(settings, /最低写入版本/);
  assert.match(settings, /最后写入方/);
  assert.match(settings, /Codex（codex） · 运行时 0\.1\.8/);
  assert.match(settings, /最后更新时间/);
  assert.match(settings, /2026-05-18/);
  assert.match(settings, /版本更新/);
  assert.match(settings, /重新检查/);
  assert.match(settings, /当前版本/);
  assert.match(settings, /0\.1\.8/);
  assert.match(settings, /最新版本/);
  assert.match(settings, /0\.1\.9/);
  assert.match(settings, /CLI 更新/);
  assert.match(settings, /npm install -g https:\/\/example\.invalid\/agentmesh-0\.1\.9\.tgz/);
  assert.match(settings, /桌面端更新/);
  assert.match(settings, /AgentMesh_0\.1\.9_aarch64\.dmg/);
  assert.match(settings, /应用更新/);
  assert.match(settings, /安装并重启/);
  assert.match(settings, /0\.1\.10/);
  assert.match(settings, /0\.1\.11/);
  assert.doesNotMatch(settings, /Runtime 0\.1\.8|entrypoint|Last writer|Metadata ·/);
  const updateError = renderSettingsAboutPanel({
    status: "ready",
    compatibility: compatibilityFixture(),
    update: { status: "error", message: "update check failed: 403 rate limit exceeded" },
  });
  assert.match(updateError, /暂时无法检查/);
  assert.match(updateError, /重新检查/);
  assert.match(updateError, /GitHub 更新检查请求受限/);
  assert.doesNotMatch(updateError, /检查失败|update check failed: 403/);
  const legacySettings = renderSettingsAboutPanel({
    status: "ready",
    compatibility: legacyCompatibilityFixture(),
    update: { status: "loading" },
  });
  assert.match(legacySettings, /命令行/);
  assert.match(legacySettings, /旧工作区：缺少兼容性元数据/);
  assert.match(legacySettings, /兼容性元数据/);
  assert.match(legacySettings, /Packet Schema 版本/);
  assert.match(legacySettings, /最低读取版本/);
  assert.match(legacySettings, /最低写入版本/);
  assert.match(legacySettings, /最后写入方/);
  assert.match(legacySettings, /最后更新时间/);
  assert.match(legacySettings, /尚未生成（旧工作区首次成功写入后补齐）/);
  assert.match(legacySettings, /尚未生成兼容性元数据/);
  assert.match(legacySettings, /诊断说明/);
  assert.match(legacySettings, /当前按旧工作区可读写处理，下次成功写入后会自动补齐/);
  assert.doesNotMatch(legacySettings, /compatibility metadata is missing|legacy workspace|packet schema unknown|未知|未记录/);

  const integrations = renderAgentIntegrationsPanel({ status: "ready", report: integrationsFixture() });
  assert.match(integrations, /data-studio-section="agent-integrations-tabs"/);
  assert.match(integrations, /data-studio-section="agent-integrations-command-tab"/);
  assert.match(integrations, /data-studio-section="agent-integrations-skill-tab"/);
  assert.match(integrations, /data-studio-section="agent-integrations-cli-tab"/);
  assert.match(integrations, /data-studio-section="agent-integrations-command-panel"/);
  assert.match(integrations, /data-studio-section="agent-integrations-skill-panel"/);
  assert.match(integrations, /data-studio-section="agent-integrations-cli-panel"/);
  assert.match(integrations, /命令行工具/);
  assert.match(integrations, /Agent Skill/);
  assert.match(integrations, /CLI 检测/);
  assert.match(integrations, /OpenCode CLI/);
  assert.match(integrations, /\.opencode\/bin\/opencode/);
  assert.match(integrations, /可更新/);
  assert.doesNotMatch(integrations, /update_available/);
  assert.match(integrations, /更新命令行工具/);
  assert.match(integrations, /0\.1\.9/);
  assert.match(integrations, /0\.1\.10/);
  assert.doesNotMatch(integrations, /Bin 目录|确认替换或 PATH shadowing/);
  assert.match(integrations, /安装选中的 Skill/);
  assert.doesNotMatch(integrations, />studio-desktop</);

  const settingsResources = renderSettingsView("resources");
  assert.match(settingsResources, /data-studio-section="studio-settings-view"/);
  assert.match(settingsResources, /settings-section-tabs/);
  assert.match(settingsResources, />资源</);
  assert.match(settingsResources, />高级</);
  assert.match(settingsResources, />环境</);
  assert.match(settingsResources, />关于</);
  assert.ok(settingsResources.indexOf(">资源") < settingsResources.indexOf(">高级"));
  assert.ok(settingsResources.indexOf(">高级") < settingsResources.indexOf(">环境"));
  assert.match(settingsResources, /data-studio-section="settings-resource-workspace"/);
  assert.match(settingsResources, /data-studio-section="react-catalog-pilot"/);

  const settingsAdvanced = renderSettingsView("advanced");
  assert.match(settingsAdvanced, /data-studio-section="settings-advanced-workspace"/);
  assert.match(settingsAdvanced, /data-studio-section="advanced-settings"/);
  assert.match(settingsAdvanced, /用户默认值/);
  assert.match(settingsAdvanced, /用户配置/);
  assert.match(settingsAdvanced, /Codex GPT-5\.5/);
  assert.doesNotMatch(settingsAdvanced, /Codex GPT-5\.5 · codex-gpt-5-5/);
  assert.match(settingsAdvanced, /fallback-codex/);
  assert.match(settingsAdvanced, /data-studio-section="advanced-settings-tabs"/);
  assert.match(settingsAdvanced, /data-studio-section="advanced-user-defaults-tab"/);
  assert.match(settingsAdvanced, /data-studio-section="advanced-stage-defaults-tab"/);
  assert.match(settingsAdvanced, /data-studio-section="advanced-fallback-tab"/);
  assert.match(settingsAdvanced, /data-studio-section="advanced-default-agents-select"/);
  assert.match(settingsAdvanced, /阶段默认 Agent/);
  assert.match(settingsAdvanced, /data-studio-section="advanced-stage-plan-default-agents-select"/);
  assert.match(settingsAdvanced, /data-studio-section="advanced-stage-execute-default-agents-select"/);
  assert.match(settingsAdvanced, /data-studio-section="advanced-fallback-agents-select"/);
  assert.match(settingsAdvanced, /data-studio-section="advanced-allow-auto-dispatch-help"/);
  assert.match(settingsAdvanced, /data-studio-section="advanced-require-user-gate-help"/);
  assert.match(settingsAdvanced, /自动分发/);
  assert.match(settingsAdvanced, /确认/);
  assert.match(settingsAdvanced, /保存高级设置/);
  assert.doesNotMatch(settingsAdvanced, /当前生效/);
  const advancedSettingsSource = readFileSync(path.resolve("apps/studio-web/src/features/settings/AdvancedSettingsPanel.tsx"), "utf-8");
  assert.match(advancedSettingsSource, /<Tabs[\s\S]*defaultValue="user-defaults"[\s\S]*keepMounted[\s\S]*keepMountedMode="display-none"[\s\S]*data-studio-section="advanced-settings-tabs"/);
  assert.match(advancedSettingsSource, /<Tabs\.Tab value="stage-defaults">\{t\("stageDefaultAgents"\)\}<\/Tabs\.Tab>/);
  assert.match(advancedSettingsSource, /<Tabs\.Tab value="fallback">\{t\("fallbackSettings"\)\}<\/Tabs\.Tab>/);
  assert.match(advancedSettingsSource, /data-studio-section="advanced-default-agents-select"[\s\S]*maxValues=\{MAX_FANOUT_AGENTS\}/);
  assert.match(advancedSettingsSource, /data-studio-section=\{`advanced-stage-\$\{stage\}-default-agents-select`\}/);
  assert.match(advancedSettingsSource, /stage_types: stageDefaultAgentsRequest\(stageDefaultAgents\)/);
  assert.match(advancedSettingsSource, /maxAgentsForStageDefaults\(stage\)/);
  assert.match(advancedSettingsSource, /return stage === "execute" \? MAX_EXECUTE_AGENTS : MAX_FANOUT_AGENTS;/);
  assert.match(advancedSettingsSource, /data-studio-section="advanced-fallback-agents-select"[\s\S]*maxValues=\{MAX_FALLBACK_AGENTS\}/);
  assert.match(advancedSettingsSource, /setDefaultAgents\(limitSelection\(value, MAX_FANOUT_AGENTS\)\)/);
  assert.match(advancedSettingsSource, /setFallbackAgents\(limitSelection\(value, MAX_FALLBACK_AGENTS\)\)/);
  assert.match(advancedSettingsSource, /function sanitizeIntegerText\(value: string\): string/);
  assert.match(advancedSettingsSource, /return value\.replace\(\/\\D\/g, ""\);/);
  assert.match(advancedSettingsSource, /setRetryAttempts\(sanitizeIntegerText\(event\.currentTarget\.value\)\)/);
  assert.match(advancedSettingsSource, /setAdapterTimeout\(sanitizeIntegerText\(event\.currentTarget\.value\)\)/);
  assert.match(advancedSettingsSource, /setFallbackAttempts\(sanitizeIntegerText\(event\.currentTarget\.value\)\)/);
  assert.match(advancedSettingsSource, /setFallbackTimeout\(sanitizeIntegerText\(event\.currentTarget\.value\)\)/);
  assert.match(advancedSettingsSource, /pattern="\[0-9\]\*"/);
  assert.match(advancedSettingsSource, /"advanced-allow-auto-dispatch-help"/);
  assert.match(advancedSettingsSource, /"advanced-require-user-gate-help"/);
  assert.match(advancedSettingsSource, /<AdvancedSwitchRow[\s\S]*help=\{ALLOW_AUTO_DISPATCH_HELP\}[\s\S]*section="advanced-allow-auto-dispatch-help"[\s\S]*checked=\{allowAutoDispatch\}[\s\S]*onChange=\{setAllowAutoDispatch\}/);
  assert.match(advancedSettingsSource, /<AdvancedSwitchRow[\s\S]*help=\{REQUIRE_USER_GATE_HELP\}[\s\S]*section="advanced-require-user-gate-help"[\s\S]*checked=\{requireUserGate\}[\s\S]*onChange=\{setRequireUserGate\}/);
  assert.match(advancedSettingsSource, /function AdvancedSwitchRow/);
  assert.match(advancedSettingsSource, /<Switch[\s\S]*aria-label=\{label\}[\s\S]*checked=\{checked\}[\s\S]*onChange=\{\(event\) => onChange\(event\.currentTarget\.checked\)\}/);
  assert.match(advancedSettingsSource, /<Tooltip[\s\S]*events=\{\{ hover: true, focus: true, touch: false \}\}[\s\S]*<ActionIcon/);
  assert.match(advancedSettingsSource, /<ActionIcon[\s\S]*data-studio-section=\{section\}[\s\S]*size=\{18\}[\s\S]*type="button"/);
  assert.match(advancedSettingsSource, /variant="outline"/);
  assert.match(advancedSettingsSource, /fontSize: 12/);
  assert.doesNotMatch(advancedSettingsSource, /advancedSettingLabel|<Popover|variant="subtle"|label=\{advancedSettingLabel/);
  const agentLifecycleSource = readFileSync(path.resolve("apps/studio-web/src/features/agents/AgentLifecyclePanel.tsx"), "utf-8");
  const agentServerSource = readFileSync(path.resolve("packages/app-server/src/agent-lifecycle.ts"), "utf-8");
  const catalogViewSource = readFileSync(path.resolve("apps/studio-web/src/features/catalog/CatalogView.tsx"), "utf-8");
  const themeSource = readFileSync(path.resolve("apps/studio-web/src/app/StudioThemeProvider.tsx"), "utf-8");
  const copySource = readFileSync(path.resolve("apps/studio-web/src/app/copy.ts"), "utf-8");
  assert.match(themeSource, /Select\.extend\(\{[\s\S]*defaultProps:\s*\{[\s\S]*searchable:\s*true/s);
  assert.match(themeSource, /MultiSelect\.extend\(\{[\s\S]*defaultProps:\s*\{[\s\S]*searchable:\s*true/s);
  assert.match(themeSource, /MultiSelect\.extend\(\{[\s\S]*defaultProps:\s*\{[\s\S]*hidePickedOptions:\s*false/s);
  assert.match(themeSource, /MultiSelect\.extend\(\{[\s\S]*defaultProps:\s*\{[\s\S]*withCheckIcon:\s*true/s);
  assert.doesNotMatch(`${advancedSettingsSource}\n${agentLifecycleSource}`, /hidePickedOptions/);
  assert.match(agentLifecycleSource, /onLoadAgentModels/);
  assert.match(agentLifecycleSource, /loadAgentModelOptionCache/);
  assert.match(agentLifecycleSource, /AGENT_TOOLS\.map\(\(tool\) => tool\.id\)/);
  assert.doesNotMatch(agentLifecycleSource, /void onLoadAgentModels/);
  assert.doesNotMatch(agentLifecycleSource, /onLoadAgentModels\(currentAdapter\)/);
  assert.doesNotMatch(agentLifecycleSource, /\[createModalOpen,\s*toolId,\s*onLoadAgentModels\]/);
  assert.match(agentLifecycleSource, /agentModelSelectData\(toolId, createModelEntry\.options, model\)/);
  assert.match(agentLifecycleSource, /agentModelSelectData\(adapter, modelEntry\.options, model\)/);
  assert.match(agentLifecycleSource, /currentModel\.trim\(\)\.length > 0/);
  assert.match(agentLifecycleSource, /entry\.status !== "ready" && data\.length === 0/);
  assert.doesNotMatch(agentLifecycleSource, /agentModelSelectData\(createModelEntry\.options, model\)/);
  assert.doesNotMatch(agentLifecycleSource, /staticModelsForAdapter|defaultModelForTool|models:\s*\[/);
  assert.doesNotMatch(agentLifecycleSource, /suggestAgentName/);
  assert.doesNotMatch(agentLifecycleSource, /agent-create-id-field/);
  assert.doesNotMatch(agentLifecycleSource, /agentIdTouched|changeAgentId|submittedAgentId/);
  assert.match(agentLifecycleSource, /const createToolDisabled = areAllToolOptionsDisabled\(createToolData\);/);
  assert.match(agentLifecycleSource, /const createModelDisabled = isModelSelectDisabled\(createModelEntry, createModelData\);/);
  assert.match(agentLifecycleSource, /const canCreate = !createModelDisabled && model\.trim\(\)\.length > 0;/);
  assert.match(agentLifecycleSource, /disabled=\{createToolDisabled\}/);
  assert.match(agentLifecycleSource, /disabled=\{createModelDisabled\}/);
  assert.match(agentLifecycleSource, /disabled=\{modelDisabled\}/);
  assert.match(agentLifecycleSource, /const toolDisabled = areAllToolOptionsDisabled\(toolData\);/);
  assert.match(agentLifecycleSource, /function isToolOptionDisabled\(entry: AgentModelOptionCacheEntry\): boolean/);
  assert.match(agentLifecycleSource, /function areAllToolOptionsDisabled/);
  assert.doesNotMatch(agentLifecycleSource, /const (?:createToolDisabled|toolDisabled) = isToolSelectDisabled\(/);
  assert.doesNotMatch(agentLifecycleSource, /ANTIGRAVITY_CURRENT_MODEL/);
  assert.doesNotMatch(agentLifecycleSource, /payload\.adapter_id === "antigravity-cli"[\s\S]*\["current"\]/);
  assert.doesNotMatch(agentLifecycleSource, /agent-create-model-help|agent-create-name-help|agent-edit-model-help|agent-edit-name-help/);
  assert.match(agentLifecycleSource, /selectedTool\.supportsReasoning[\s\S]*reasoningEffort\.trim\(\) \|\| "high"[\s\S]*: "none"/);
  assert.match(agentLifecycleSource, /label: "Claude Code CLI"/);
  assert.doesNotMatch(agentLifecycleSource, /label: "Claude Code",/);
  const agentApiSource = readFileSync(path.resolve("apps/studio-web/src/api/agents.ts"), "utf-8");
  const createAgentRequestSource = agentApiSource.match(/export interface StudioAgentCreateRequest \{[\s\S]*?\n\}/)?.[0] ?? "";
  const updateAgentRequestSource = agentApiSource.match(/export interface StudioAgentUpdateRequest \{[\s\S]*?\n\}/)?.[0] ?? "";
  const serverCreateRequestSource = agentServerSource.match(/export interface StudioAgentCreateRequest \{[\s\S]*?\n\}/)?.[0] ?? "";
  const serverUpdateRequestSource = agentServerSource.match(/export interface StudioAgentUpdateRequest \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(agentApiSource, /loadStudioAgentModels/);
  assert.match(agentApiSource, /\/api\/v1\/agents\/models\?adapter=/);
  assert.doesNotMatch(createAgentRequestSource, /agent_id/);
  assert.doesNotMatch(updateAgentRequestSource, /agent_id/);
  assert.doesNotMatch(serverCreateRequestSource, /agent_id/);
  assert.doesNotMatch(serverUpdateRequestSource, /agent_id/);
  assert.doesNotMatch(agentServerSource, /generateStudioAgentId/);
  assert.match(catalogViewSource, /data-studio-section=\{`\$\{section\}-source-mode`\}/);
  assert.match(catalogViewSource, /manualWorkflowFields/);
  assert.match(catalogViewSource, /manualPresetFields/);
  assert.match(catalogViewSource, /value: agent\.id/);
  assert.match(catalogViewSource, /value=\{fields\.defaultAgents\}/);
  assert.match(catalogViewSource, /value=\{fields\.stageAssignments\[stageId\] \?\? \[\]\}/);
  assert.match(advancedSettingsSource, /const formSettings = settings\.resolved;/);
  assert.doesNotMatch(`${advancedSettingsSource}\n${catalogViewSource}`, /agent\.label\} · \$\{agent\.id\}/);
  assert.doesNotMatch(advancedSettingsSource, /setDefaultAgents\(settings\.user|setFallbackAgents\(settings\.user|SettingSummary/);
  assert.doesNotMatch(copySource, /当前生效/);

  const settingsEnvironment = renderSettingsView("environment");
  assert.match(settingsEnvironment, /data-studio-section="settings-environment-workspace"/);
  assert.match(settingsEnvironment, /data-studio-section="agent-integrations"/);
  assert.match(settingsEnvironment, /命令行工具/);
  assert.doesNotMatch(settingsEnvironment, />studio-desktop</);

  const settingsAbout = renderSettingsView("about");
  assert.match(settingsAbout, /data-studio-section="settings-about-workspace"/);
  assert.match(settingsAbout, /data-studio-section="settings-about"/);
  assert.match(settingsAbout, /版本信息/);
  assert.match(settingsAbout, /运行时版本/);

  const lifecycle = renderAgentLifecyclePanel({
    status: "ready",
    agents: studioAgentsFixture(),
    lastOperation: agentOperationFixture(),
  });
  assert.match(lifecycle, /创建 Agent/);
  assert.match(lifecycle, /data-studio-section="agent-create-open"/);
  assert.doesNotMatch(lifecycle, /placeholder="agent-id"/);
  assert.match(lifecycle, /<p[^>]*>Codex GPT-5\.5<\/p>[\s\S]*?<p[^>]*>codex · gpt-5\.5/);
  assert.doesNotMatch(lifecycle, /<p[^>]*>codex-gpt-5-5<\/p>[\s\S]*?<p[^>]*>Codex GPT-5\.5 · codex/);
  assert.match(lifecycle, /data-agent-action="edit"/);
  assert.match(lifecycle, /agentmesh agents add/);
  const editModal = renderAgentEditModal();
  assert.match(editModal, /data-studio-section="agent-edit-tool-select"/);
  assert.match(editModal, /data-studio-section="agent-edit-id-field"/);
  assert.match(editModal, /data-studio-section="agent-edit-id-line"/);
  assert.match(editModal, /data-studio-section="agent-edit-id-field"[\s\S]*?>ID<\/p>[\s\S]*?>claude-claude-opus-4-7<\/p>/);
  assert.doesNotMatch(editModal, /<input[^>]*data-studio-section="agent-edit-id-field"/);
  assert.match(editModal, /data-studio-section="agent-edit-name-field"/);
  assert.doesNotMatch(editModal, /agent-edit-name-help|agent-edit-model-help/);
  assert.match(editModal, />名称</);
  assert.doesNotMatch(editModal, /<input[^>]*data-studio-section="agent-edit-tool-select"[^>]*(?:readOnly|readonly)/);
  assert.match(editModal, /data-studio-section="agent-edit-model-select"/);
  assert.doesNotMatch(editModal, /<input[^>]*data-studio-section="agent-edit-model-select"[^>]*disabled=""/);
  assert.match(editModal, /data-studio-section="agent-edit-reasoning-select"/);
  assert.match(editModal, /data-studio-section="agent-edit-capabilities-select"/);
  assert.doesNotMatch(editModal, /<input[^>]*data-studio-section="agent-edit-capabilities-select"[^>]*(?:readOnly|readonly)/);
  assert.match(editModal, /claude-code-cli/);
  assert.match(editModal, /计划/);
  assert.match(editModal, /决策/);
  const editModalWithoutModels = renderAgentEditModalWithoutModels();
  assert.match(editModalWithoutModels, /<input[^>]*data-studio-section="agent-edit-tool-select"[^>]*disabled=""/);
  assert.match(editModalWithoutModels, /data-studio-section="agent-edit-model-select"/);
  assert.match(editModalWithoutModels, /未发现可选模型/);
  assert.match(editModalWithoutModels, /disabled=""/);
  assert.doesNotMatch(editModalWithoutModels, /data-studio-section="agent-edit-reasoning-select"/);
  assert.doesNotMatch(editModalWithoutModels, />推理等级</);
  assert.equal(
    suggestAgentLabel("antigravity-cli", "gemini-3.5-flash"),
    "Antigravity Gemini 3.5 Flash",
  );
  assert.equal(
    buildWorkflowTomlFromManualFields({
      name: "Manual Flow",
      stages: "plan, review, decide",
      description: "Manual workflow from fields.",
      whenToUse: "需要字段创建 Workflow",
      packetArtifacts: "",
      qualityGates: "决策记录风险",
    }),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'name = "Manual Flow"',
      'stages = ["plan", "review", "decide"]',
      'description = "Manual workflow from fields."',
      'when_to_use = ["需要字段创建 Workflow"]',
      'packet_artifacts = ["request.md", "plan.md", "findings.md", "decision.md"]',
      'quality_gates = ["决策记录风险"]',
      "",
    ].join("\n"),
  );
  assert.equal(
    buildPresetTomlFromManualFields({
      name: "Manual Preset",
      workflowId: "w-9d94d0db",
      description: "Manual preset from fields.",
      defaultAgents: ["a-06ce8f90", "a-a9d455aa"],
      stageAssignments: {
        review: ["a-a9d455aa"],
        decide: ["a-06ce8f90"],
      },
    }),
    [
      "schema_version = 1",
      'name = "Manual Preset"',
      'workflow = "w-9d94d0db"',
      'description = "Manual preset from fields."',
      "",
      "[stage_assignments]",
      'review = ["a-a9d455aa"]',
      'decide = ["a-06ce8f90"]',
      "",
      "[default_stage_agents]",
      'agents = ["a-06ce8f90", "a-a9d455aa"]',
      "",
    ].join("\n"),
  );

  const manual = renderStudioElement(React.createElement(ManualView));
  assert.match(manual, /AgentMesh 是什么/);
  assert.match(manual, /本地优先的 AI coding agent 编排工具/);
  assert.match(manual, /架构与数据/);
  assert.match(manual, />概览</);
  assert.match(manual, />安装与环境</);
  assert.match(manual, />快速上手</);
  assert.match(manual, />核心概念</);
  assert.match(manual, />操作与排障</);
  assert.doesNotMatch(manual, /个章节/);
  assert.match(manual, /manual-section-tabs/);
  const manualTabsIndex = manual.indexOf('aria-label="手册章节"');
  const manualPanelIndex = manual.indexOf('data-studio-section="react-manual"');
  assert.ok(manualTabsIndex >= 0);
  assert.ok(manualPanelIndex >= 0);
  assert.ok(manualTabsIndex < manualPanelIndex);
  assert.doesNotMatch(manual, />组件</);
  assert.doesNotMatch(manual, />Packet</);
  assert.doesNotMatch(manual, />使用教程</);

  assert.deepEqual(
    MANUAL_SECTIONS.map((section) => section.label),
    ["概览", "安装与环境", "快速上手", "核心概念", "操作与排障", "架构与数据"],
  );
  const overview = MANUAL_SECTIONS.find((section) => section.id === "overview");
  assert.ok(overview);
  assert.deepEqual(
    overview.items.map((item) => item.title),
    ["AgentMesh 是什么", "适合的任务", "AgentMesh 不做什么"],
  );
  assert.match(
    overview.items.flatMap((item) => [item.body, ...item.details]).join("\n"),
    /不托管模型、不保存外部工具登录态/,
  );
  const setup = MANUAL_SECTIONS.find((section) => section.id === "setup");
  assert.ok(setup);
  assert.deepEqual(
    setup.items.map((item) => item.title),
    ["安装渠道", "CLI 检测与底层工具", "Agent Skill", "版本检查与更新"],
  );
  assert.match(
    setup.items.flatMap((item) => [item.body, ...item.details]).join("\n"),
    /npm install -g agentmesh|agentmesh cli detect --json|agentmesh update check --json/,
  );
  const quickstart = MANUAL_SECTIONS.find((section) => section.id === "quickstart");
  assert.ok(quickstart);
  assert.deepEqual(
    quickstart.items.map((item) => item.title),
    ["1. 确认环境", "2. 配置 Agent 与 Preset", "3. 启动一次运行", "4. 查看结果"],
  );
  const concepts = MANUAL_SECTIONS.find((section) => section.id === "concepts");
  assert.ok(concepts);
  assert.deepEqual(
    concepts.items.map((item) => item.title),
    [
      "Agent 与 Tool Adapter",
      "Workflow、Stage 与 Preset",
      "Stage 类型",
      "Run、Packet 与 Artifact",
      "Call、Context 与 MCP",
    ],
  );
  assert.match(
    concepts.items.flatMap((item) => [item.body, ...item.details]).join("\n"),
    /plan.md[\s\S]*handoff.md[\s\S]*verification.md[\s\S]*findings.md[\s\S]*decision.md/,
  );
  const operations = MANUAL_SECTIONS.find((section) => section.id === "operations");
  assert.ok(operations);
  assert.deepEqual(
    operations.items.map((item) => item.title),
    [
      "资源管理",
      "推进运行",
      "审查发布",
      "常见问题",
    ],
  );
  const architecture = MANUAL_SECTIONS.find((section) => section.id === "architecture");
  assert.ok(architecture);
  assert.deepEqual(
    architecture.items.map((item) => item.title),
    ["控制面边界", "文件事实源", "App Server 与 Runtime", "安全边界"],
  );
});

test("browser Studio keeps native updater APIs unavailable", async () => {
  assert.equal(isDesktopUpdaterAvailable(), false);
  assert.deepEqual(await checkDesktopAppUpdate(), { status: "unavailable" });
  await assert.rejects(
    installDesktopAppUpdate(() => undefined),
    /Check for an app update before installing it/,
  );
  await assert.rejects(
    relaunchDesktopApp(),
    /Desktop app updater is only available from AgentMesh\.app/,
  );
});

test("Studio API clients keep App Server endpoint contracts", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createStudioApiClient({
    baseUrl: "http://studio.test",
    token: "secret-token",
    fetch: async (url, init) => {
      calls.push({ url, init });
      const pathname = new URL(url).pathname;
      const payload = apiPayloadFor(pathname);
      return jsonResponse(payload);
    },
  });

  await loadStudioRuns(client);
  await loadStudioRunDetail(client, "run-1", { eventOffset: 50, eventLimit: 25 });
  await loadStudioArtifactPreview(client, "run-1", "output.md");
  await loadStudioCatalog(client);
  await loadStudioCalls(client);
  await loadStudioCallDetail(client, "call-1");
  await submitStudioCallAdoption(client, "call-1", { status: "accepted", reason: "looks good" });
  await submitStudioMutation(client, { action: "retry", run_id: "run-1" });
  await loadStudioAdvancedSettings(client);
  await updateStudioAdvancedSettings(client, {
    default_stage_agents: { agents: ["codex-gpt-5-5"] },
    fallback: { agents: ["fallback-codex"], max_attempts_per_agent: 2 },
  });
  await loadStudioAgents(client);
  await loadStudioAgentModels(client, "claude-code-cli");
  await submitStudioAgentLifecycleOperation(client, { action: "disable", agentId: "codex-gpt-5-5" });
  await submitStudioAgentLifecycleOperation(client, {
    action: "update",
    agentId: "codex-gpt-5-5",
    request: {
      adapter: "codex-cli",
      model: "gpt-5.4",
      label: "Codex GPT-5.4",
      capabilities: ["plan", "review"],
    },
  });
  await submitStudioWorkflowCreate(client, { workflow_file: "/workspace/custom-flow.toml" });
  await submitStudioWorkflowUpdate(client, "w-custom", { workflow_file: "/workspace/custom-flow.toml" });
  await submitStudioWorkflowDelete(client, "w-custom");
  await submitStudioPresetCreate(client, { preset_file: "/workspace/review-duo.toml" });
  await submitStudioPresetUpdate(client, "p-review", { preset_file: "/workspace/review-duo.toml" });
  await submitStudioPresetDelete(client, "p-review");
  await submitStudioPresetCreate(client, { preset_toml: "schema_version = 1", source_name: "review-duo.toml" });
  await loadStudioIntegrations(client);
  await installCommandLineTool(client, {});
  await installAgentSkills(client, { targets: ["codex"], force: false });
  await loadStudioUpdate(client);

  assert.deepEqual(calls.map((call) => `${call.init?.method ?? "GET"} ${new URL(call.url).pathname}`), [
    "GET /api/runs",
    "GET /api/runs/run-1",
    "GET /api/runs/run-1/artifacts/output.md",
    "GET /api/catalog",
    "GET /api/calls",
    "GET /api/calls/call-1",
    "POST /api/calls/call-1/adoption",
    "POST /api/mutations",
    "GET /api/v1/settings/advanced",
    "PUT /api/v1/settings/advanced",
    "GET /api/v1/agents",
    "GET /api/v1/agents/models",
    "POST /api/v1/agents/codex-gpt-5-5/disable",
    "PUT /api/v1/agents/codex-gpt-5-5",
    "POST /api/v1/workflows",
    "PUT /api/v1/workflows/w-custom",
    "DELETE /api/v1/workflows/w-custom",
    "POST /api/v1/presets",
    "PUT /api/v1/presets/p-review",
    "DELETE /api/v1/presets/p-review",
    "POST /api/v1/presets",
    "GET /api/desktop/integrations",
    "POST /api/desktop/integrations/command-line-tool",
    "POST /api/desktop/integrations/skills",
    "GET /api/v1/update/check",
  ]);
  assert.equal(new URL(calls[11].url).search, "?adapter=claude-code-cli");
  assert.equal((calls[0].init?.headers as Headers).get("authorization"), "Bearer secret-token");
});

test("Studio API clients encode ids and preserve non-2xx mutation payloads", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createStudioApiClient({
    baseUrl: "http://studio.test",
    fetch: async (url, init) => {
      calls.push({ url, init });
      const pathname = new URL(url).pathname;
      if (pathname.endsWith("/adoption")) {
        return jsonResponse({ error: "cannot adopt" }, 409);
      }
      if (pathname === "/api/mutations") {
        return jsonResponse({
          error: "run locked",
          error_code: "run_locked",
          lock: { operation: "dispatch", entrypoint: "studio" },
        }, 423);
      }
      return jsonResponse({});
    },
  });

  await loadStudioRunDetail(client, "run/with space");
  await loadStudioArtifactPreview(client, "run/with space", "logs/output file.md");
  await loadStudioCallDetail(client, "call/with space");
  const adoption = await submitStudioCallAdoption(client, "call/with space", {
    status: "rejected",
    reason: "not useful",
  });
  const mutation = await submitStudioMutation(client, {
    action: "dispatch",
    run_id: "run/with space",
    stage: "review",
  });

  assert.deepEqual(calls.map((call) => `${call.init?.method ?? "GET"} ${new URL(call.url).pathname}`), [
    "GET /api/runs/run%2Fwith%20space",
    "GET /api/runs/run%2Fwith%20space/artifacts/logs%2Foutput%20file.md",
    "GET /api/calls/call%2Fwith%20space",
    "POST /api/calls/call%2Fwith%20space/adoption",
    "POST /api/mutations",
  ]);
  assert.equal(adoption.ok, false);
  assert.equal(adoption.status, 409);
  assert.deepEqual(adoption.payload, { error: "cannot adopt" });
  assert.equal(mutation.ok, false);
  assert.equal(mutation.status, 423);
  assert.equal(mutation.payload.error_code, "run_locked");
  assert.deepEqual(mutation.payload.lock, { operation: "dispatch", entrypoint: "studio" });
});

test("Selection helpers preserve current ids when still present", () => {
  const runKey = studioRunKey(studioRunSummariesFixture()[1]);
  assert.equal(nextSelectedRunKey(studioRunSummariesFixture(), runKey), runKey);
  assert.equal(nextSelectedRunKey(studioRunSummariesFixture(), "missing"), studioRunKey(studioRunSummariesFixture()[0]));
  const callKey = studioCallKey(studioCallSummariesFixture()[0]);
  assert.equal(nextSelectedCallKey(studioCallSummariesFixture(), callKey), callKey);
  assert.equal(nextSelectedCallKey(studioCallSummariesFixture(), "missing"), callKey);
  assert.equal(runDetailTabAfterRunSelection("run-1", "run-1", "events"), "events");
  assert.equal(runDetailTabAfterRunSelection("run-1", "run-2", "events"), "details");
  assert.equal(runDetailTabAfterRunSelection(undefined, "run-1", "events"), "details");
});

test("Agent model option cache preloads every Studio tool once", async () => {
  const calls: string[] = [];
  const cache = await loadAgentModelOptionCache(async (adapter) => {
    calls.push(adapter);
    if (adapter === "antigravity-cli") {
      return {
        adapter_id: adapter,
        status: "unsupported",
        source: "unsupported",
        models: [],
        reason: "not available",
      };
    }
    return {
      adapter_id: adapter,
      status: "discovered",
      source: "adapter-cli",
      models: [`${adapter}-model`],
    };
  });

  assert.deepEqual(calls.sort(), [
    "claude-code-cli",
    "codex-cli",
    "cursor-agent",
    "antigravity-cli",
    "opencode-cli",
  ].sort());
  assert.deepEqual(cache["codex-cli"], {
    status: "ready",
    options: ["codex-cli-model"],
  });
  assert.deepEqual(cache["antigravity-cli"], {
    status: "empty",
    options: [],
  });

  const readyCache = await loadAgentModelOptionCache(async (adapter) => ({
    adapter_id: adapter,
    status: "discovered",
    source: "adapter-cli",
    models: adapter === "antigravity-cli" ? ["gemini-3.5-flash"] : [`${adapter}-model`],
  }));

  assert.deepEqual(readyCache["antigravity-cli"], {
    status: "ready",
    options: ["gemini-3.5-flash"],
  });
});

const testStudioCopyMessages: Partial<Record<StudioCopyKey, string>> = {
  agents: "Agents",
  exitCodeNotRecorded: "未记录",
  noExternalProcess: "无外部进程",
  unknown: "未知",
};

const testStudioCopy = (key: StudioCopyKey): string => testStudioCopyMessages[key] ?? key;

function renderStudioElement(element: React.ReactElement): string {
  return renderToStaticMarkup(
    React.createElement(
      StudioThemeProvider,
      null,
      element,
    ),
  );
}

function renderReactCatalog(
  state: CatalogViewState,
  agentLifecycle?: AgentLifecyclePanelProps,
  initialTab?: "agents" | "workflows" | "presets" | "mcp",
): string {
  return renderStudioElement(React.createElement(CatalogView, {
    state,
    agentLifecycle,
    initialTab,
    onCreateWorkflow: async () => workflowOperationResponseFixture(),
    onUpdateWorkflow: async () => workflowOperationResponseFixture(),
    onDeleteWorkflow: async () => workflowOperationResponseFixture(),
    onCreatePreset: async () => presetOperationResponseFixture(),
    onUpdatePreset: async () => presetOperationResponseFixture(),
    onDeletePreset: async () => presetOperationResponseFixture(),
  }));
}

function renderTomlRegistrationFields(
  section: string,
  submitLabel: string,
): string {
  return renderStudioElement(React.createElement(TomlRegistrationFields, {
    sourceMode: "manual",
    sourceFile: null,
    manualContent: React.createElement("div", { "data-studio-section": `${section}-manual-placeholder` }),
    section,
    submitLabel,
    submitDisabled: true,
    onSourceModeChange: () => {},
    onSourceFileChange: () => {},
    onSubmit: () => {},
  }));
}

function renderWorkflowManualFields(): string {
  return renderStudioElement(React.createElement(WorkflowManualFieldsForm, {
    fields: {
      name: "",
      stages: "plan, review, decide",
      description: "",
      whenToUse: "",
      packetArtifacts: "",
      qualityGates: "",
    },
    onChange: () => {},
  }));
}

function renderPresetManualFields(): string {
  const catalog = studioCatalogFixture();
  return renderStudioElement(React.createElement(PresetManualFieldsForm, {
    fields: {
      name: "",
      workflowId: "custom-flow",
      description: "",
      defaultAgents: [],
      stageAssignments: {},
    },
    onChange: () => {},
    workflows: catalog.workflows,
    agents: catalog.agents,
  }));
}

function renderActivityNavigator(
  runsState: ActivityRunsState,
  callsState: ActivityCallsState,
  query = "",
  selection: {
    selectedKind?: "run" | "call";
    selectedRunKey?: string;
    selectedCallKey?: string;
  } = {},
): string {
  return renderStudioElement(React.createElement(ActivityNavigator, {
    runsState,
    callsState,
    selectedKind: selection.selectedKind,
    selectedRunKey: selection.selectedRunKey,
    selectedCallKey: selection.selectedCallKey,
    query,
    autoRefreshSeconds: 0,
    onQueryChange: () => {},
    onAutoRefreshSecondsChange: () => {},
    onRefresh: () => {},
    onSelectRun: () => {},
    onSelectCall: () => {},
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderRunOverview(
  state: RunOverviewState,
  view?: "all" | "details" | "summary" | "stages" | "diagnostics",
  agentLabels?: Record<string, string>,
  workflowLabels?: Record<string, string>,
): string {
  return renderStudioElement(React.createElement(RunOverview, { state, view, agentLabels, workflowLabels }));
}

function renderArtifactPreviewPanel(
  detail: StudioRunDetail,
  selectedArtifactName: string | undefined,
  previewState: ArtifactPreviewState,
  agentLabels?: Record<string, string>,
): string {
  return renderStudioElement(React.createElement(ArtifactPreviewPanel, {
    detail,
    selectedArtifactName,
    previewState,
    agentLabels,
    onSelectArtifact: () => {},
  }));
}

function renderEventLogView(detail: StudioRunDetail, agentLabels?: Record<string, string>): string {
  return renderStudioElement(React.createElement(EventLogView, {
    detail,
    agentLabels,
  }));
}

function renderReviewReleaseView(detail: StudioRunDetail): string {
  return renderStudioElement(React.createElement(ReviewReleaseView, {
    view: detail.review_release,
  }));
}

function renderCallDetailView(state: CallDetailState): string {
  return renderStudioElement(React.createElement(CallDetailView, {
    state,
    onSubmitAdoption: async () => ({
      ok: true,
      status: 200,
      payload: studioCallDetailFixture(),
    }),
  }));
}

function renderSafeActionsPanel(
  selectedRunId: string | undefined,
  state?: SafeActionMutationState,
): string {
  return renderStudioElement(React.createElement(SafeActionsPanel, {
    selectedRunId,
    state,
    onSubmit: async () => mutationResponseFixture(),
  }));
}

function renderSettingsAboutPanel(state: SettingsAboutState, desktopUpdater?: unknown): string {
  return renderStudioElement(React.createElement(SettingsAboutPanel, {
    state,
    onRefreshUpdate: () => {},
    desktopUpdater,
  } as Parameters<typeof SettingsAboutPanel>[0]));
}

function renderAgentIntegrationsPanel(state: AgentIntegrationsState): string {
  return renderStudioElement(React.createElement(AgentIntegrationsPanel, {
    state,
    onInstallCommandLineTool: async () => {},
    onInstallAgentSkills: async () => {},
  }));
}

function renderSettingsView(initialTab: SettingsTabId): string {
  return renderStudioElement(React.createElement(SettingsView, {
    initialTab,
    resources: {
      state: { status: "ready", catalog: studioCatalogFixture() },
      agentLifecycle: {
        state: { status: "ready", agents: studioAgentsFixture() },
        onCreateAgent: async () => {},
        onAgentAction: async () => {},
        onLoadAgentModels: async (adapter) => agentModelsFixture(adapter),
      },
      onCreateWorkflow: async () => workflowOperationResponseFixture(),
      onCreatePreset: async () => presetOperationResponseFixture(),
    },
    environment: {
      state: { status: "ready", report: integrationsFixture() },
      onInstallCommandLineTool: async () => {},
      onInstallAgentSkills: async () => {},
    },
    advanced: {
      state: { status: "ready", settings: advancedSettingsFixture() },
      agents: studioAgentsFixture(),
      onSaveAdvancedSettings: async () => advancedSettingsFixture(),
    },
    about: {
      state: { status: "ready", compatibility: compatibilityFixture(), update: { status: "ready", report: updateFixture() } },
    },
  }));
}

function renderAgentLifecyclePanel(state: AgentLifecycleState): string {
  return renderStudioElement(React.createElement(AgentLifecyclePanel, {
    state,
    onCreateAgent: async () => {},
    onAgentAction: async () => {},
    onLoadAgentModels: async (adapter) => agentModelsFixture(adapter),
  }));
}

function renderAgentEditModal(): string {
  return renderStudioElement(React.createElement(AgentEditForm, {
    agent: {
      id: "claude-claude-opus-4-7",
      label: "Claude Opus 4.7 High",
      adapter: "claude-code-cli",
      capabilities: ["plan", "execute", "verify", "review", "decide"],
      model: "claude-opus-4-7",
      reasoning_effort: "high",
      source_layer: "user",
    },
    busy: false,
    onSubmit: async () => {},
    onLoadAgentModels: async (adapter) => agentModelsFixture(adapter),
  }));
}

function renderAgentEditModalWithoutModels(): string {
  return renderStudioElement(React.createElement(AgentEditForm, {
    agent: {
      id: "a-empty",
      label: "Antigravity Empty",
      adapter: "antigravity-cli",
      capabilities: ["plan", "execute", "verify", "review", "decide"],
      model: "",
      reasoning_effort: "none",
      source_layer: "user",
    },
    busy: false,
    onSubmit: async () => {},
    onLoadAgentModels: async (adapter) => ({
      adapter_id: adapter,
      status: "unsupported",
      source: "unsupported",
      models: [],
      reason: "no stable list models command",
    }),
  }));
}

function studioRunSummariesFixture(): StudioRunSummary[] {
  return [
    {
      run_id: "run-1",
      title: "编排发布流程",
      workspace: {
        id: "ws-project",
        label: "project",
        path: "/workspace/project",
        current: true,
      },
      status: "running",
      workflow: "w-7db15660",
      latest_event: "stage.started",
      latest_event_timestamp: "2026-05-18T07:00:00.000Z",
      created_at: "2026-05-18T06:50:00.000Z",
      updated_at: "2026-05-18T07:00:00.000Z",
    },
    {
      run_id: "run-2",
      workspace: {
        id: "ws-project",
        label: "project",
        path: "/workspace/project",
        current: true,
      },
      status: "needs_decision",
      workflow: "w-9d94d0db",
      latest_event: "review.completed",
      latest_event_timestamp: "2026-05-17T07:00:00.000Z",
      created_at: "2026-05-17T06:50:00.000Z",
      updated_at: "2026-05-17T07:00:00.000Z",
    },
  ];
}

function studioRunDetailFixture(): StudioRunDetail {
  return {
    summary: {
      ...studioRunSummariesFixture()[0],
      run_dir: "/workspace/.agentmesh/runs/run-1",
      stages: ["plan", "execute", "review"],
      stage_nodes: [
        { id: "plan", type: "plan", occurrence: 1 },
        { id: "execute", type: "execute", occurrence: 1 },
        { id: "review", type: "review", occurrence: 1 },
      ],
      completed_stages: ["plan", "execute"],
      current_stage: "review",
      stage_assignments: {
        plan: ["planner"],
        execute: ["worker"],
        review: ["current"],
      },
      stage_invocations: {
        plan: [{ agent: "planner", kind: "primary" }],
        execute: [{ agent: "worker", kind: "primary" }],
        review: [{ agent: "current", kind: "current" }],
      },
      stage_attempts: {
        execute: [{ actual_agent: "worker", exit_code: 0, status: "completed" }],
      },
      stage_timing: [
        {
          stage: "plan",
          attempt_count: 1,
          started_at: "2026-05-18T06:50:00.000Z",
          completed_at: "2026-05-18T06:55:00.000Z",
          duration_ms: 300000,
          exit_code: 0,
        },
        {
          stage: "execute",
          attempt_count: 2,
          started_at: "2026-05-18T06:55:00.000Z",
          completed_at: "2026-05-18T07:00:00.000Z",
          duration_ms: 300000,
        },
      ],
    },
    events: [
      {
        event: "run.created",
        timestamp: "2026-05-18T06:40:00.000Z",
        run_id: "run-1",
        workflow: "w-1",
        stages: ["plan", "execute"],
        stage_nodes: [{ id: "plan", type: "plan", occurrence: 1 }],
      },
      { event: "stage.started", timestamp: "2026-05-18T06:50:00.000Z", stage: "plan" },
      { event: "stage.completed", timestamp: "2026-05-18T07:00:00.000Z", stage: "execute", exit_code: 0 },
      { event: "artifact.written", timestamp: "2026-05-18T07:01:00.000Z", stage: "execute", artifact: "output.md", path: "artifacts/output.md" },
    ],
    events_page: {
      offset: 0,
      limit: 50,
      total: 120,
    },
    artifacts: [
      {
        name: "prompt.md",
        path: "prompts/execute.md",
        kind: "prompt",
        stage: "execute",
        agent: "codex",
        written_at: "2026-05-18T06:55:00.000Z",
      },
      {
        name: "output.md",
        path: "artifacts/output.md",
        kind: "markdown",
        stage: "execute",
        agent: "codex",
        written_at: "2026-05-18T07:01:00.000Z",
      },
    ],
    review_release: {
      release_verdict: {
        value: "needs_decision",
        diagnostic: "manual approval required",
      },
      findings: {
        present: true,
        accepted: ["fix run scroll"],
        rejected: [],
        needs_decision: ["ship now?"],
      },
      raw_reviews: [
        {
          reviewer: "cursor",
          reviewer_label: "Cursor Reviewer",
          path: ".agentmesh/calls/review.md",
          content: "LGTM with one question",
          truncated: false,
        },
      ],
      release_summary: {
        present: true,
        path: "release-summary.md",
        truncated: false,
        sections: [
          {
            heading: "Verification",
            content: "tests passed",
            items: ["npm run build"],
          },
        ],
      },
      skipped_checks: ["full npm test sidecar"],
      residual_risk: ["manual Safari check"],
    },
  };
}

function studioCatalogFixture(): StudioCatalog & {
    presets: Array<{
      presetId: string;
      name: string;
      workflowId: string;
      source: string;
      stageAssignments: Record<string, string[]>;
    validationWarnings: string[];
  }>;
} {
  return {
    agents: [
      {
        id: "claude-claude-opus-4-7",
        label: "Claude Opus 4.7 High",
        adapter: "claude-code-cli",
        model: "claude-opus-4-7",
        capabilities: ["plan", "execute", "review"],
        source_layer: "user",
      },
      {
        id: "codex-gpt-5-5",
        label: "Codex GPT-5.5 High",
        adapter: "codex-cli",
        model: "gpt-5.5",
        capabilities: ["plan", "execute", "review"],
        source_layer: "user",
      },
    ],
    workflows: [
      {
        workflowId: "w-7db15660",
        name: "Bug Fix",
        source: "builtin",
        stages: ["plan", "execute", "review"],
      },
      {
        workflowId: "custom-flow",
        name: "Custom Flow",
        source: "user",
        stages: ["plan", "decide"],
      },
    ],
    presets: [
      {
        presetId: "review-duo",
        name: "Review Duo",
        workflowId: "w-9d94d0db",
        source: "user",
        stageAssignments: {
          review: ["claude-claude-opus-4-7"],
          decide: ["current"],
        },
        validationWarnings: [],
      },
    ],
    mcpServers: [
      {
        id: "docs",
        command: "docs-mcp",
        args: ["--stdio"],
        resource_hints: ["memory://configured"],
        source_layer: "user",
      },
    ],
    diagnostics: [
      { target: "agents", message: "agent source timed out" },
    ],
  };
}

function studioCallSummariesFixture(): StudioCallSummary[] {
  return [
    studioCallSummaryFixture(),
    {
      ...studioCallSummaryFixture(),
      schema_version: 99,
      id: "call-unsupported",
      status: "stale",
      unsupported_schema: true,
      warnings: [{ code: "unsupported_schema", message: "future schema" }],
    },
  ];
}

function studioCallSummaryFixture(): StudioCallSummary {
  return {
    schema_version: 1,
    id: "call-1",
    title: "审查发布结果",
    workspace: {
      id: "ws-project",
      label: "project",
      path: "/workspace/project",
      current: true,
    },
    agent_id: "reviewer",
    adapter: "codex",
    model: "gpt-5.5",
    purpose: "review",
    status: "failed",
    cwd: "/workspace/project",
    created_at: "2026-05-18T07:00:00.000Z",
    started_at: "2026-05-18T07:00:00.000Z",
    completed_at: "2026-05-18T07:02:00.000Z",
    duration_ms: 120000,
    heartbeat_at: "2026-05-18T07:02:00.000Z",
    prompt_source: "inline",
    prompt_ref: {
      kind: "file",
      path: "prompt.md",
      sha256: "sha256:prompt",
      redaction_state: "not_applied",
      authoritative: true,
    },
    output_ref: {
      kind: "file",
      path: "output.md",
      sha256: "sha256:output",
      redaction_state: "not_applied",
      authoritative: true,
    },
    output_path: "output.md",
    exit_code: 1,
    error_kind: "process_failed",
    error_summary: "review failed",
    redaction_state: "not_applied",
    redactions_applied: [],
    related_files: ["apps/studio-web/src/app/App.tsx"],
    related_run_ids: ["run-1"],
    related_call_ids: [],
    tokens_in: 100,
    tokens_out: 200,
    cost_estimate_usd: 0.02,
    adoption_status: "unreviewed",
    unsupported_schema: false,
    warnings: [{ code: "dangling_output_path", message: "Output path missing", path: "output.md" }],
  };
}

function studioCallDetailFixture(): StudioCallDetail {
  return {
    schema_version: 1,
    call: studioCallSummaryFixture(),
    prompt: {
      present: true,
      path: "prompt.md",
      content: "Please review this change",
      truncated: false,
      sha256: "sha256:prompt",
      redaction_state: "not_applied",
      authoritative: true,
    },
    output: {
      present: true,
      path: "output.md",
      content: "Review output",
      truncated: false,
      sha256: "sha256:output",
      redaction_state: "not_applied",
      authoritative: true,
    },
    stderr: {
      present: false,
      path: null,
      content: "",
      truncated: false,
      sha256: null,
      redaction_state: null,
      authoritative: null,
    },
    adoption_events: [
      {
        schema_version: 1,
        call_id: "call-1",
        previous_status: "unreviewed",
        status: "accepted",
        updated_at: "2026-05-18T07:03:00.000Z",
        updated_by_entrypoint: "studio",
        reason: "useful",
        related_commit: "abc123",
        related_run_id: "run-1",
        superseded_by_call_id: null,
      },
    ],
    warnings: [{ code: "dangling_output_path", message: "Output path missing", path: "output.md" }],
  };
}

function compatibilityFixture(): Extract<SettingsAboutState, { status: "ready" }>["compatibility"] {
  return {
    decision: "read_write",
    metadata_state: "ok",
    current_runtime_version: "0.1.8",
    current_entrypoint: "studio",
    compatibility_path: ".agentmesh/compatibility.json",
    metadata: {
      schema_version: 1,
      packet_schema_version: 1,
      min_read_runtime_version: "0.1.8",
      min_write_runtime_version: "0.1.8",
      last_writer_runtime_version: "0.1.8",
      last_writer_entrypoint: "codex",
      updated_at: "2026-05-18T07:00:00.000Z",
    },
    reasons: [],
  };
}

function updateFixture(): StudioUpdateReport {
  return {
    schema_version: 1,
    current_version: "0.1.8",
    latest_version: "0.1.9",
    update_available: true,
    release_url: "https://example.invalid/releases/tag/v0.1.9",
    checked_at: "2026-05-23T13:00:00.000Z",
    cli: {
      status: "update_available",
      asset_name: "agentmesh-0.1.9.tgz",
      asset_url: "https://example.invalid/agentmesh-0.1.9.tgz",
      install_command: ["npm", "install", "-g", "https://example.invalid/agentmesh-0.1.9.tgz"],
    },
    desktop: {
      status: "manual_update_available",
      asset_name: "AgentMesh_0.1.9_aarch64.dmg",
      asset_url: "https://example.invalid/AgentMesh_0.1.9_aarch64.dmg",
      reason: "Desktop auto-update is not enabled for this release channel; download and install the DMG manually.",
    },
  };
}

function legacyCompatibilityFixture(): Extract<SettingsAboutState, { status: "ready" }>["compatibility"] {
  return {
    decision: "read_write",
    metadata_state: "missing_legacy",
    current_runtime_version: "0.1.8",
    current_entrypoint: "cli",
    compatibility_path: ".agentmesh/compatibility.json",
    metadata: null,
    reasons: [
      "compatibility metadata is missing; treating workspace as legacy readable until the next successful mutation backfills it",
    ],
  };
}

function integrationsFixture(): Extract<AgentIntegrationsState, { status: "ready" }>["report"] {
  return {
    schema_version: 1,
    entrypoint: "studio-desktop",
    workspace: "/workspace/project",
    command_line_tool: {
      supported: true,
      package_name: "@jinhx128/agentmesh",
      installed: true,
      path: "/usr/local/bin/agentmesh",
      source: "path",
      installed_version: "0.1.9",
      latest_version: "0.1.10",
      status: "update_available",
      diagnostics: [],
    },
    skills: {
      targets: [
        {
          target: "codex",
          expected_path: "~/.codex/skills/agentmesh/SKILL.md",
          status: "ok",
          ok: true,
          expected: true,
        },
      ],
    },
    provider_clis: {
      tools: [
        {
          tool: "opencode",
          adapter: "opencode-cli",
          label: "OpenCode CLI",
          command: "opencode",
          found: true,
          source: "well_known",
          path: "/Users/example/.opencode/bin/opencode",
          version: "opencode 9.9.9",
          diagnostics: ["well-known provider path found"],
          diagnostic: "well-known provider path found",
        },
        {
          tool: "codex",
          adapter: "codex-cli",
          label: "Codex CLI",
          command: "codex",
          found: false,
          source: "missing",
          version: "missing",
          diagnostics: ["provider command not found through desktop resolver: codex"],
          diagnostic: "provider command not found through desktop resolver: codex",
        },
      ],
    },
  };
}

function advancedSettingsFixture(): StudioAdvancedSettingsPayload {
  const userConfigPath = "/home/agentmesh/.config/agentmesh/config.toml";
  return {
    user_config_path: userConfigPath,
    layers: [{ source: "user", path: userConfigPath }],
    diagnostics: [],
    user: {
      default_stage_agents: {
        agents: ["codex-gpt-5-5"],
        stage_types: {
          plan: { agents: ["codex-gpt-5-5"] },
          execute: { agents: ["codex-gpt-5-5"] },
        },
      },
      fallback: {
        agents: ["fallback-codex"],
        max_attempts_per_agent: 2,
        timeout_seconds: 900,
        stage_types: {},
      },
      run_defaults: {
        retry_attempts: 1,
        adapter_timeout_secs: 600,
      },
      execution_policy: {
        allow_auto_dispatch: true,
        require_user_gate: false,
      },
      model_aliases: {
        fast: { adapter: "codex-cli", model: "gpt-5.4" },
      },
      capability_profile_preferences: {},
    },
    resolved: {
      default_stage_agents: {
        agents: ["codex-gpt-5-5"],
        stage_types: {
          plan: { agents: ["codex-gpt-5-5"] },
          execute: { agents: ["codex-gpt-5-5"] },
        },
      },
      fallback: {
        agents: ["fallback-codex"],
        max_attempts_per_agent: 2,
        timeout_seconds: 900,
        stage_types: {},
      },
      run_defaults: {
        retry_attempts: 1,
        adapter_timeout_secs: 600,
      },
      execution_policy: {
        allow_auto_dispatch: true,
        require_user_gate: false,
      },
      model_aliases: {
        fast: { adapter: "codex-cli", model: "gpt-5.4" },
      },
      capability_profile_preferences: {},
    },
  };
}

function studioAgentsFixture(): StudioAgentSummary[] {
  return [
    {
      id: "codex-gpt-5-5",
      label: "Codex GPT-5.5",
      adapter: "codex",
      capabilities: ["plan", "execute", "review"],
      status: "enabled",
      disabled: false,
      model: "gpt-5.5",
      source_layer: "user",
    },
  ];
}

function agentModelsFixture(adapter = "claude-code-cli"): StudioAgentModelListPayload {
  return {
    adapter_id: adapter,
    status: "discovered",
    source: "adapter-cli",
    models: ["claude-opus-4-7", "claude-sonnet-4.5", "claude-sonnet-4-6", "opus-4.7"],
  };
}

function agentOperationFixture(): NonNullable<Extract<AgentLifecycleState, { status: "ready" }>["lastOperation"]> {
  return {
    operation_id: "op-1",
    action: "create",
    status: "succeeded",
    command: ["agentmesh", "agents", "add", "--adapter", "codex", "--model", "gpt-5.5"],
    exit_code: 0,
    stdout: "created",
    stderr: "",
    started_at: "2026-05-18T07:00:00.000Z",
    completed_at: "2026-05-18T07:00:01.000Z",
    duration_ms: 1000,
    agent_id: "a-12345678",
  };
}

function workflowOperationFixture(): StudioWorkflowLifecycleOperation {
  return {
    operation_id: "workflow-op-1",
    action: "create",
    status: "succeeded",
    command: ["agentmesh", "workflows", "add", "/workspace/custom-flow.toml"],
    exit_code: 0,
    stdout: "Added workflow: custom-flow",
    stderr: "",
    started_at: "2026-05-18T07:00:00.000Z",
    completed_at: "2026-05-18T07:00:01.000Z",
    duration_ms: 1000,
    workflow_id: "custom-flow",
    workflow_file: "/workspace/custom-flow.toml",
  };
}

function workflowOperationResponseFixture(): StudioWorkflowLifecycleResponse {
  return {
    ok: true,
    status: 200,
    payload: workflowOperationFixture(),
  };
}

function presetOperationFixture(): StudioPresetLifecycleOperation {
  return {
    operation_id: "preset-op-1",
    action: "create",
    status: "succeeded",
    command: ["agentmesh", "preset", "add", "/workspace/review-duo.toml"],
    exit_code: 0,
    stdout: "Added preset: review-duo",
    stderr: "",
    started_at: "2026-05-18T07:00:00.000Z",
    completed_at: "2026-05-18T07:00:01.000Z",
    duration_ms: 1000,
    preset_id: "review-duo",
    preset_file: "/workspace/review-duo.toml",
  };
}

function presetOperationResponseFixture(): StudioPresetLifecycleResponse {
  return {
    ok: true,
    status: 200,
    payload: presetOperationFixture(),
  };
}

function mutationResponseFixture(): StudioMutationResponse {
  return {
    ok: true,
    status: 200,
    payload: {
      action: "dispatch",
      command: ["node", "agentmesh", "flow", "dispatch", "run-1"],
      exit_code: 0,
      stdout: "done",
      stderr: "",
      duration_ms: 10,
    },
  };
}

function apiPayloadFor(pathname: string): unknown {
  if (pathname === "/api/runs") {
    return {
      schema_version: 1,
      total: studioRunSummariesFixture().length,
      runs: studioRunSummariesFixture(),
      workspaces: [studioRunSummariesFixture()[0].workspace],
      diagnostics: [],
    };
  }
  if (pathname === "/api/runs/run-1") {
    return studioRunDetailFixture();
  }
  if (pathname === "/api/runs/run-1/artifacts/output.md") {
    return {
      ...studioRunDetailFixture().artifacts[1],
      content: "artifact preview",
      truncated: false,
    } satisfies StudioArtifactPreview;
  }
  if (pathname === "/api/catalog") {
    return studioCatalogFixture();
  }
  if (pathname === "/api/calls") {
    return {
      schema_version: 1,
      total: 1,
      calls: studioCallSummariesFixture(),
      groups: [],
      workspaces: [studioCallSummaryFixture().workspace],
      diagnostics: [],
    };
  }
  if (pathname === "/api/calls/call-1" || pathname === "/api/calls/call-1/adoption") {
    return studioCallDetailFixture();
  }
  if (pathname === "/api/mutations") {
    return mutationResponseFixture().payload;
  }
  if (pathname === "/api/v1/settings/advanced") {
    return advancedSettingsFixture();
  }
  if (pathname === "/api/v1/agents") {
    return { agents: studioAgentsFixture() };
  }
  if (pathname === "/api/v1/agents/models") {
    return agentModelsFixture();
  }
  if (pathname === "/api/v1/agents/codex-gpt-5-5/disable") {
    return agentOperationFixture();
  }
  if (pathname === "/api/v1/agents/codex-gpt-5-5") {
    return agentOperationFixture();
  }
  if (pathname === "/api/v1/workflows") {
    return workflowOperationFixture();
  }
  if (pathname === "/api/v1/presets") {
    return presetOperationFixture();
  }
  if (pathname === "/api/desktop/integrations" || pathname === "/api/desktop/integrations/command-line-tool") {
    return {
      ...integrationsFixture(),
      operation: {
        npm_path: "/usr/local/bin/npm",
        args: ["install", "--global", "@jinhx128/agentmesh@latest", "--no-audit", "--no-fund"],
        exit_code: 0,
        stdout: "",
        stderr: "",
      },
    };
  }
  if (pathname === "/api/desktop/integrations/skills") {
    return {
      ...integrationsFixture(),
      installed_targets: [{ target: "codex", ok: true, files: integrationsFixture().skills.targets }],
    };
  }
  if (pathname === "/api/v1/update/check") {
    return updateFixture();
  }
  return {};
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return response.text();
}

async function listen(server: Server): Promise<{ server: Server; url: string }> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}
