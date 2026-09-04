import {
  ActionIcon,
  Alert,
  AppShell,
  Box,
  Button,
  Group,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { useStudioCopy, type StudioCopyKey } from "./copy.js";
import {
  requireStudioMutationSuccess,
  showStudioError,
  showStudioSuccess,
} from "./mutation-feedback.js";
import {
  createActivityLoadGeneration,
  settleLatestActivityLoad,
} from "./activity-load-generation.js";
import {
  bootstrapStudio,
  type StudioBootstrapPayload,
} from "../api/bootstrap.js";
import {
  loadStudioAdvancedSettings,
  updateStudioAdvancedSettings,
  type StudioAdvancedSettingsPayload,
  type StudioAdvancedSettingsUpdateRequest,
} from "../api/advanced-settings.js";
import {
  loadStudioAgentModels,
  loadStudioAgents,
  submitStudioAgentLifecycleOperation,
  type StudioAgentCreateRequest,
  type StudioAgentLifecycleSubmit,
  type StudioAgentModelListPayload,
} from "../api/agents.js";
import {
  loadStudioCatalog,
} from "../api/catalog.js";
import {
  submitStudioWorkflowCreate,
  submitStudioWorkflowDelete,
  submitStudioWorkflowUpdate,
  type StudioWorkflowCreateRequest,
  type StudioWorkflowLifecycleResponse,
  type StudioWorkflowUpdateRequest,
} from "../api/workflows.js";
import {
  submitStudioPresetCreate,
  submitStudioPresetDelete,
  submitStudioPresetUpdate,
  type StudioPresetCreateRequest,
  type StudioPresetLifecycleResponse,
  type StudioPresetUpdateRequest,
} from "../api/presets.js";
import {
  loadStudioCompatibility,
} from "../api/compatibility.js";
import {
  loadStudioUpdate,
} from "../api/update.js";
import {
  installAgentSkills,
  installCommandLineTool,
  loadStudioIntegrations,
  type AgentMeshSkillTarget,
} from "../api/integrations.js";
import {
  normalizeStudioApiError,
  type StudioApiClient,
  type StudioApiError,
} from "../api/client.js";
import {
  submitStudioMutation,
  type StudioMutationRequest,
  type StudioMutationResponse,
} from "../api/mutations.js";
import {
  closeStudioReviewerSession,
  deleteStudioRun,
  loadStudioArtifactPreview,
  loadStudioRunDetail,
  loadStudioRuns,
  nextSelectedRunKey,
  purgeExpiredStudioReviewerSessions,
  studioRunKey,
} from "../api/runs.js";
import {
  deleteStudioCall,
  loadStudioCallDetail,
  loadStudioCalls,
  nextSelectedCallKey,
  studioCallKey,
} from "../api/calls.js";
import {
  ArtifactPreviewDrawer,
  ArtifactSidebarPanel,
  sortStudioArtifacts,
  type ArtifactPreviewState,
} from "../features/artifacts/ArtifactPreviewPanel.js";
import {
  type CatalogViewState,
} from "../features/catalog/CatalogView.js";
import {
  SafeActionsPanel,
} from "../features/actions/SafeActionsPanel.js";
import {
  type AgentLifecycleState,
} from "../features/agents/AgentLifecyclePanel.js";
import {
  type DesktopAutoUpdatePreferenceState,
  type SettingsCommandLineToolState,
  type SettingsAboutState,
} from "../features/settings/SettingsAboutPanel.js";
import {
  checkDesktopAppUpdate,
  installDesktopAppUpdate,
  isDesktopUpdaterAvailable,
  normalizeDesktopUpdaterError,
  relaunchDesktopApp,
  type DesktopAppUpdaterState,
} from "../api/desktop-updater.js";
import {
  isDesktopPreferencesAvailable,
  loadDesktopPreferences,
  normalizeDesktopPreferenceError,
  saveDesktopAutoUpdatePreference,
} from "../api/desktop-preferences.js";
import {
  type AgentIntegrationsState,
} from "../features/settings/AgentIntegrationsPanel.js";
import {
  type AdvancedSettingsState,
} from "../features/settings/AdvancedSettingsPanel.js";
import {
  SettingsView,
} from "../features/settings/SettingsView.js";
import {
  ManualView,
} from "../features/manual/ManualView.js";
import {
  EventLogView,
} from "../features/runs/EventLogView.js";
import {
  RunOverview,
  type AgentDisplayNames,
  type AgentDisplayTools,
  type RunOverviewState,
  type WorkflowDisplayNames,
} from "../features/runs/RunOverview.js";
import {
  type AutoRefreshSeconds,
} from "../features/navigation/AutoRefreshSelect.js";
import {
  ActivityNavigator,
  activityCalls,
  activityItems,
  activityRuns,
  type ActivityCallsState,
  type ActivityRunsState,
  type StudioActivityItem,
} from "../features/navigation/ActivityNavigator.js";
import {
  CallDetailView,
  type CallDetailState,
} from "../features/calls/CallDetailView.js";

type BootstrapViewState =
  | { status: "loading" }
  | { status: "ready"; bootstrap: StudioBootstrapPayload }
  | { status: "error"; error: StudioApiError };

type WorkspaceView = "runs" | "calls" | "settings" | "definitions";
export type RunDetailTab = "details" | "actions" | "events";

const RUN_DETAIL_TABS: Array<{
  id: RunDetailTab;
  labelKey: StudioCopyKey;
}> = [
  { id: "details", labelKey: "details" },
  { id: "actions", labelKey: "action" },
  { id: "events", labelKey: "logEvents" },
];

const STUDIO_RUN_EVENT_LIMIT = 200;

interface NavigatorLoadOptions {
  showLoading?: boolean;
}

export function App(): ReactElement {
  const { t } = useStudioCopy();
  const [bootstrapState, setBootstrapState] = useState<BootstrapViewState>({ status: "loading" });
  const [catalogState, setCatalogState] = useState<CatalogViewState>({ status: "loading" });
  const [settingsAboutState, setSettingsAboutState] = useState<SettingsAboutState>({ status: "loading" });
  const [desktopUpdaterState, setDesktopUpdaterState] = useState<DesktopAppUpdaterState>(
    isDesktopUpdaterAvailable() ? { status: "idle" } : { status: "unavailable" },
  );
  const [desktopUpdaterRefreshError, setDesktopUpdaterRefreshError] = useState<string | undefined>(undefined);
  const [desktopAutoUpdateState, setDesktopAutoUpdateState] = useState<DesktopAutoUpdatePreferenceState>({
    status: "loading",
  });
  const [advancedSettingsState, setAdvancedSettingsState] = useState<AdvancedSettingsState>({ status: "loading" });
  const [agentIntegrationsState, setAgentIntegrationsState] = useState<AgentIntegrationsState>({ status: "loading" });
  const [agentLifecycleState, setAgentLifecycleState] = useState<AgentLifecycleState>({ status: "loading" });
  const [runsState, setRunsState] = useState<ActivityRunsState>({ status: "loading" });
  const [runDetailState, setRunDetailState] = useState<RunOverviewState>({ status: "empty" });
  const [callsState, setCallsState] = useState<ActivityCallsState>({ status: "loading" });
  const [callDetailState, setCallDetailState] = useState<CallDetailState>({ status: "empty" });
  const [selectedArtifactName, setSelectedArtifactName] = useState<string | undefined>(undefined);
  const [artifactPreviewState, setArtifactPreviewState] = useState<ArtifactPreviewState>({ status: "idle" });
  const [artifactDrawerOpened, setArtifactDrawerOpened] = useState(false);
  const [selectedRunKey, setSelectedRunKey] = useState<string | undefined>(undefined);
  const [selectedCallKey, setSelectedCallKey] = useState<string | undefined>(undefined);
  const [activityQuery, setActivityQuery] = useState("");
  const [apiClient, setApiClient] = useState<StudioApiClient | undefined>(undefined);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("runs");
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState<AutoRefreshSeconds>(15);
  const [runDetailTab, setRunDetailTab] = useState<RunDetailTab>("details");
  const [runDetailReloadKey, setRunDetailReloadKey] = useState(0);
  const previousSelectedRunKeyRef = useRef<string | undefined>(undefined);
  const desktopStartupCheckStartedRef = useRef(false);
  const versionRefreshBusyRef = useRef(false);
  const [versionRefreshBusy, setVersionRefreshBusy] = useState(false);
  const activityLoadGenerationRef = useRef(createActivityLoadGeneration());

  function loadRunsWithClient(
    client: StudioApiClient,
    options: NavigatorLoadOptions = {},
    generation = activityLoadGenerationRef.current.begin(),
  ): void {
    if (options.showLoading !== false) {
      setRunsState({ status: "loading" });
    }
    void settleLatestActivityLoad(
      activityLoadGenerationRef.current,
      generation,
      loadStudioRuns(client),
      ({ runs }) => {
        setRunsState({ status: "ready", runs });
        setSelectedRunKey((current) => nextSelectedRunKey(runs, current));
      },
      (error: unknown) => {
        setRunsState((current) => ({
          status: "error",
          message: normalizeStudioApiError(error).message,
          runs: activityRuns(current),
        }));
      },
    );
  }

  function loadCallsWithClient(
    client: StudioApiClient,
    options: NavigatorLoadOptions = {},
    generation = activityLoadGenerationRef.current.begin(),
  ): void {
    if (options.showLoading !== false) {
      setCallsState({ status: "loading" });
    }
    void settleLatestActivityLoad(
      activityLoadGenerationRef.current,
      generation,
      loadStudioCalls(client),
      ({ calls }) => {
        setCallsState({ status: "ready", calls });
        setSelectedCallKey((current) => nextSelectedCallKey(calls, current));
      },
      (error: unknown) => {
        setCallsState((current) => ({
          status: "error",
          message: normalizeStudioApiError(error).message,
          calls: activityCalls(current),
        }));
      },
    );
  }

  function loadActivitiesWithClient(
    client: StudioApiClient,
    options: NavigatorLoadOptions = {},
  ): void {
    const generation = activityLoadGenerationRef.current.begin();
    loadRunsWithClient(client, options, generation);
    loadCallsWithClient(client, options, generation);
  }

  function loadAgentLifecycleWithClient(
    client: StudioApiClient,
  ): void {
    setAgentLifecycleState({ status: "loading" });
    void loadStudioAgents(client)
      .then(({ agents }) => {
        setAgentLifecycleState({
          status: "ready",
          agents,
        });
      })
      .catch((error: unknown) => {
        setAgentLifecycleState({ status: "error", message: normalizeStudioApiError(error).message });
      });
  }

  function loadCompatibilityWithClient(client: StudioApiClient): void {
    setSettingsAboutState({ status: "loading" });
    void loadStudioCompatibility(client)
      .then((compatibility) => {
        setSettingsAboutState({
          status: "ready",
          compatibility,
          update: { status: "loading" },
        });
        loadUpdateWithClient(client);
      })
      .catch((error: unknown) => {
        setSettingsAboutState({ status: "error", message: normalizeStudioApiError(error).message });
      });
  }

  function loadUpdateWithClient(client: StudioApiClient): void {
    setSettingsAboutState((current) => current.status === "ready"
      ? { ...current, update: { status: "loading" } }
      : current);
    void loadStudioUpdate(client)
      .then((report) => {
        setSettingsAboutState((current) => current.status === "ready"
          ? { ...current, update: { status: "ready", report } }
          : current);
      })
      .catch((error: unknown) => {
        setSettingsAboutState((current) => current.status === "ready"
          ? { ...current, update: { status: "error", message: normalizeStudioApiError(error).message } }
          : current);
      });
  }

  async function checkDesktopUpdater(): Promise<void> {
    setDesktopUpdaterState({ status: "checking" });
    setDesktopUpdaterRefreshError(undefined);
    try {
      setDesktopUpdaterState(await checkDesktopAppUpdate());
    } catch (error) {
      setDesktopUpdaterState({ status: "error", message: normalizeDesktopUpdaterError(error) });
    }
  }

  async function installDesktopUpdater(): Promise<void> {
    try {
      setDesktopUpdaterState({ status: "downloading", downloadedBytes: 0 });
      await installDesktopAppUpdate((downloadedBytes, totalBytes) => {
        setDesktopUpdaterState({
          status: "downloading",
          downloadedBytes,
          ...(totalBytes === undefined ? {} : { totalBytes }),
        });
      });
      setDesktopUpdaterState({ status: "restarting" });
      await relaunchDesktopApp();
    } catch (error) {
      setDesktopUpdaterState({ status: "error", message: normalizeDesktopUpdaterError(error) });
    }
  }

  async function saveDesktopAutoUpdate(enabled: boolean): Promise<void> {
    const previousEnabled = desktopAutoUpdateState.status === "loading"
      ? true
      : desktopAutoUpdateState.enabled;
    setDesktopAutoUpdateState({ status: "saving", enabled });
    try {
      const saved = await saveDesktopAutoUpdatePreference(enabled);
      setDesktopAutoUpdateState({ status: "ready", enabled: saved.auto_check_updates });
      showStudioSuccess("桌面更新设置已保存", saved.auto_check_updates ? "已开启自动检测" : "已关闭自动检测");
    } catch (error) {
      const message = normalizeDesktopPreferenceError(error);
      setDesktopAutoUpdateState({
        status: "error",
        enabled: previousEnabled,
        message,
      });
      showStudioError("桌面更新设置保存失败", message);
    }
  }

  async function deleteActivity(item: StudioActivityItem): Promise<void> {
    if (!apiClient) {
      throw new Error("AgentMesh API 尚未就绪，请稍后重试。");
    }
    activityLoadGenerationRef.current.invalidate();
    const response = item.kind === "run"
      ? await deleteStudioRun(apiClient, item.run.run_id, item.run.workspace.id)
      : await deleteStudioCall(apiClient, item.call.id, item.call.workspace.id);
    if (!response.ok) {
      const message = "error" in response.payload ? response.payload.error : "删除失败，请重试";
      throw new Error(message);
    }

    const selectedKind = workspaceView === "runs"
      ? "run"
      : workspaceView === "calls"
        ? "call"
        : undefined;
    const selectedKey = selectedKind === "run"
      ? selectedRunKey
      : selectedKind === "call"
        ? selectedCallKey
        : undefined;
    const nextSelection = activitySelectionAfterDelete(
      activityItems(activityRuns(runsState), activityCalls(callsState)),
      item,
      selectedKind,
      selectedKey,
    );

    if (item.kind === "run") {
      setRunsState({
        status: "ready",
        runs: activityRuns(runsState).filter((run) => studioRunKey(run) !== item.key),
      });
    } else {
      setCallsState({
        status: "ready",
        calls: activityCalls(callsState).filter((call) => studioCallKey(call) !== item.key),
      });
    }

    if (selectedKind === item.kind && selectedKey === item.key) {
      setSelectedRunKey(nextSelection?.kind === "run" ? nextSelection.key : undefined);
      setSelectedCallKey(nextSelection?.kind === "call" ? nextSelection.key : undefined);
      if (nextSelection) {
        setWorkspaceView(nextSelection.kind === "run" ? "runs" : "calls");
      }
      setRunDetailState({ status: "empty" });
      setCallDetailState({ status: "empty" });
      setSelectedArtifactName(undefined);
      setArtifactPreviewState({ status: "idle" });
      setArtifactDrawerOpened(false);
    }
    loadActivitiesWithClient(apiClient, { showLoading: false });
  }

  function loadAgentIntegrationsWithClient(client: StudioApiClient): void {
    setAgentIntegrationsState({ status: "loading" });
    void loadStudioIntegrations(client)
      .then((report) => {
        setAgentIntegrationsState({ status: "ready", report });
      })
      .catch((error: unknown) => {
        setAgentIntegrationsState({ status: "error", message: normalizeStudioApiError(error).message });
      });
  }

  function loadAdvancedSettingsWithClient(client: StudioApiClient): void {
    setAdvancedSettingsState({ status: "loading" });
    void loadStudioAdvancedSettings(client)
      .then((settings) => {
        setAdvancedSettingsState({ status: "ready", settings });
      })
      .catch((error: unknown) => {
        setAdvancedSettingsState({ status: "error", message: normalizeStudioApiError(error).message });
      });
  }

  useEffect(() => {
    if (!isDesktopPreferencesAvailable()) {
      return undefined;
    }
    let active = true;
    void loadDesktopPreferences()
      .then((preferences) => {
        if (!active) {
          return;
        }
        setDesktopAutoUpdateState({ status: "ready", enabled: preferences.auto_check_updates });
        if (preferences.auto_check_updates && !desktopStartupCheckStartedRef.current) {
          desktopStartupCheckStartedRef.current = true;
          void checkDesktopUpdater();
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setDesktopAutoUpdateState({
            status: "error",
            enabled: true,
            message: normalizeDesktopPreferenceError(error),
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void bootstrapStudio()
      .then(({ bootstrap, client }) => {
        if (active) {
          setBootstrapState({ status: "ready", bootstrap });
          setApiClient(client);
          loadActivitiesWithClient(client);
          loadAgentLifecycleWithClient(client);
          loadCompatibilityWithClient(client);
          loadAdvancedSettingsWithClient(client);
          loadAgentIntegrationsWithClient(client);
        }
        return loadStudioCatalog(client);
      })
      .then((catalog) => {
        if (active) {
          setCatalogState({ status: "ready", catalog });
        }
      })
      .catch((error: unknown) => {
        const apiError = normalizeStudioApiError(error);
        if (active) {
          setBootstrapState({ status: "error", error: apiError });
          setCatalogState({ status: "error", message: apiError.message });
          setSettingsAboutState({ status: "error", message: apiError.message });
          setAdvancedSettingsState({ status: "error", message: apiError.message });
          setAgentIntegrationsState({ status: "error", message: apiError.message });
          setAgentLifecycleState({ status: "error", message: apiError.message });
          setRunsState({ status: "error", message: apiError.message });
          setRunDetailState({ status: "error", message: apiError.message });
          setCallsState({ status: "error", message: apiError.message });
          setCallDetailState({ status: "error", message: apiError.message });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!apiClient || autoRefreshSeconds === 0) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      loadActivitiesWithClient(apiClient, { showLoading: false });
    }, autoRefreshSeconds * 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [apiClient, autoRefreshSeconds]);

  useEffect(() => {
    const previousRunKey = previousSelectedRunKeyRef.current;
    previousSelectedRunKeyRef.current = selectedRunKey;
    setRunDetailTab((current) => runDetailTabAfterRunSelection(previousRunKey, selectedRunKey, current));
    if (previousRunKey !== selectedRunKey) {
      setArtifactDrawerOpened(false);
    }
  }, [selectedRunKey]);

  useEffect(() => {
    if (workspaceView !== "runs") {
      setArtifactDrawerOpened(false);
    }
  }, [workspaceView]);

  const selectedRun = activityRuns(runsState)
    .find((run) => studioRunKey(run) === selectedRunKey);

  useEffect(() => {
    if (!apiClient || !selectedRun) {
      setRunDetailState({ status: "empty" });
      return;
    }
    let active = true;
    setRunDetailState({ status: "loading" });
    void loadStudioRunDetail(apiClient, selectedRun.run_id, {
      eventLimit: STUDIO_RUN_EVENT_LIMIT,
      workspaceId: selectedRun.workspace.id,
    })
      .then((detail) => {
        if (active) {
          setRunDetailState({ status: "ready", detail });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setRunDetailState({ status: "error", message: normalizeStudioApiError(error).message });
        }
      });
    return () => {
      active = false;
    };
  }, [apiClient, selectedRun?.run_id, selectedRun?.workspace.id, runDetailReloadKey]);

  const selectedCall = activityCalls(callsState)
    .find((call) => studioCallKey(call) === selectedCallKey);

  useEffect(() => {
    if (!apiClient || !selectedCall) {
      setCallDetailState({ status: "empty" });
      return;
    }
    let active = true;
    setCallDetailState({ status: "loading" });
    void loadStudioCallDetail(apiClient, selectedCall.id, selectedCall.workspace.id)
      .then((detail) => {
        if (active) {
          setCallDetailState({ status: "ready", detail });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setCallDetailState({ status: "error", message: normalizeStudioApiError(error).message });
        }
      });
    return () => {
      active = false;
    };
  }, [apiClient, selectedCall?.id, selectedCall?.workspace.id]);

  const selectedDetail = runDetailState.status === "ready" ? runDetailState.detail : undefined;
  const selectedDetailRunId = selectedDetail?.summary.run_id;
  const selectedDetailWorkspaceId = selectedDetail?.summary.workspace.id;
  const artifactNamesKey = useMemo(() => {
    return selectedDetail
      ? sortStudioArtifacts(selectedDetail).map((artifact) => artifact.name).join("\0")
      : "";
  }, [selectedDetail]);

  useEffect(() => {
    if (!selectedDetail) {
      if (runDetailState.status === "empty" || runDetailState.status === "error") {
        setSelectedArtifactName(undefined);
        setArtifactPreviewState({ status: "idle" });
        setArtifactDrawerOpened(false);
      }
      return;
    }
    const artifacts = sortStudioArtifacts(selectedDetail);
    setSelectedArtifactName((current) =>
      current && artifacts.some((artifact) => artifact.name === current)
        ? current
        : artifacts[0]?.name,
    );
  }, [selectedDetailRunId, artifactNamesKey]);

  useEffect(() => {
    if (!apiClient || !selectedDetailRunId || !selectedDetailWorkspaceId || !selectedArtifactName) {
      setArtifactPreviewState({ status: "idle" });
      return;
    }
    let active = true;
    setArtifactPreviewState({ status: "loading", artifactName: selectedArtifactName });
    void loadStudioArtifactPreview(
      apiClient,
      selectedDetailRunId,
      selectedArtifactName,
      selectedDetailWorkspaceId,
    )
      .then((preview) => {
        if (active) {
          setArtifactPreviewState({ status: "ready", preview });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setArtifactPreviewState({
            status: "error",
            artifactName: selectedArtifactName,
            message: normalizeStudioApiError(error).message,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [apiClient, selectedDetailRunId, selectedDetailWorkspaceId, selectedArtifactName]);

  const overviewState: RunOverviewState = bootstrapState.status === "loading"
    ? { status: "loading" }
    : runDetailState;
  const settingsCommandLineToolState: SettingsCommandLineToolState = agentIntegrationsState.status === "ready"
    ? {
        status: "ready",
        report: agentIntegrationsState.report.command_line_tool,
        ...(agentIntegrationsState.refreshError ? { refreshError: agentIntegrationsState.refreshError } : {}),
      }
    : agentIntegrationsState.status === "error"
      ? { status: "error", message: agentIntegrationsState.message }
      : { status: "loading" };

  async function submitSafeAction(request: StudioMutationRequest): Promise<StudioMutationResponse> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    return submitStudioMutation(apiClient, request);
  }

  function refreshAfterMutation(): void {
    if (apiClient) {
      loadRunsWithClient(apiClient, { showLoading: false });
      setRunDetailReloadKey((current) => current + 1);
    }
  }

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

  async function refreshVersionAndUpdates(): Promise<void> {
    if (!apiClient || versionRefreshBusyRef.current) {
      return;
    }
    versionRefreshBusyRef.current = true;
    setVersionRefreshBusy(true);

    const checks: Array<Promise<void>> = [
      loadStudioUpdate(apiClient)
        .then((report) => {
          setSettingsAboutState((current) => current.status === "ready"
            ? { ...current, update: { status: "ready", report } }
            : current);
        })
        .catch((error: unknown) => {
          const message = normalizeStudioApiError(error).message;
          setSettingsAboutState((current) => {
            if (current.status !== "ready") return current;
            return current.update?.status === "ready"
              ? { ...current, update: { ...current.update, refreshError: message } }
              : { ...current, update: { status: "error", message } };
          });
          throw new Error(`发布版本：${message}`);
        }),
      loadStudioIntegrations(apiClient)
        .then((report) => {
          setAgentIntegrationsState({ status: "ready", report });
        })
        .catch((error: unknown) => {
          const message = normalizeStudioApiError(error).message;
          setAgentIntegrationsState((current) => current.status === "ready"
            ? { ...current, refreshError: message }
            : { status: "error", message });
          throw new Error(`命令行工具：${message}`);
        }),
    ];

    if (isDesktopUpdaterAvailable()) {
      checks.push(
        checkDesktopAppUpdate()
          .then((result) => {
            setDesktopUpdaterRefreshError(undefined);
            setDesktopUpdaterState(result);
          })
          .catch((error: unknown) => {
            const message = normalizeDesktopUpdaterError(error);
            setDesktopUpdaterRefreshError(message);
            throw new Error(`桌面应用：${message}`);
          }),
      );
    }

    try {
      const results = await Promise.allSettled(checks);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length > 0) {
        showStudioError(
          "部分更新状态检查失败",
          failures.map((failure) => readablePromiseRejection(failure.reason)).join("；"),
        );
      } else {
        showStudioSuccess("更新状态已刷新");
      }
    } finally {
      versionRefreshBusyRef.current = false;
      setVersionRefreshBusy(false);
    }
  }

  async function closeReviewerSession(sessionRef: string): Promise<void> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await closeStudioReviewerSession(apiClient, sessionRef);
    if (!response.ok) {
      throw new Error("error" in response.payload ? response.payload.error : "关闭会话失败");
    }
    refreshAfterMutation();
  }

  async function purgeExpiredReviewerSessions(): Promise<void> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await purgeExpiredStudioReviewerSessions(apiClient);
    if (!response.ok) {
      throw new Error("error" in response.payload ? response.payload.error : "清理会话失败");
    }
    refreshAfterMutation();
  }

  async function createAgent(request: StudioAgentCreateRequest): Promise<void> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await submitStudioAgentLifecycleOperation(apiClient, {
      action: "create",
      request,
    });
    requireStudioMutationSuccess(response, "创建 Agent 失败");
    loadAgentLifecycleWithClient(apiClient);
    void loadStudioCatalog(apiClient).then((catalog) => setCatalogState({ status: "ready", catalog }));
  }

  async function submitAgentLifecycle(request: StudioAgentLifecycleSubmit): Promise<void> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await submitStudioAgentLifecycleOperation(apiClient, request);
    requireStudioMutationSuccess(response, "Agent 操作失败");
    loadAgentLifecycleWithClient(apiClient);
    void loadStudioCatalog(apiClient).then((catalog) => setCatalogState({ status: "ready", catalog }));
  }

  async function loadAgentModels(adapter: string): Promise<StudioAgentModelListPayload> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    return loadStudioAgentModels(apiClient, adapter);
  }

  async function createWorkflow(request: StudioWorkflowCreateRequest): Promise<StudioWorkflowLifecycleResponse> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await submitStudioWorkflowCreate(apiClient, request);
    void loadStudioCatalog(apiClient).then((catalog) => setCatalogState({ status: "ready", catalog }));
    return response;
  }

  async function updateWorkflow(
    workflowId: string,
    request: StudioWorkflowUpdateRequest,
  ): Promise<StudioWorkflowLifecycleResponse> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await submitStudioWorkflowUpdate(apiClient, workflowId, request);
    void loadStudioCatalog(apiClient).then((catalog) => setCatalogState({ status: "ready", catalog }));
    return response;
  }

  async function deleteWorkflow(workflowId: string): Promise<StudioWorkflowLifecycleResponse> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await submitStudioWorkflowDelete(apiClient, workflowId);
    void loadStudioCatalog(apiClient).then((catalog) => setCatalogState({ status: "ready", catalog }));
    return response;
  }

  async function createPreset(request: StudioPresetCreateRequest): Promise<StudioPresetLifecycleResponse> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await submitStudioPresetCreate(apiClient, request);
    void loadStudioCatalog(apiClient).then((catalog) => setCatalogState({ status: "ready", catalog }));
    return response;
  }

  async function updatePreset(
    presetId: string,
    request: StudioPresetUpdateRequest,
  ): Promise<StudioPresetLifecycleResponse> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await submitStudioPresetUpdate(apiClient, presetId, request);
    void loadStudioCatalog(apiClient).then((catalog) => setCatalogState({ status: "ready", catalog }));
    return response;
  }

  async function deletePreset(presetId: string): Promise<StudioPresetLifecycleResponse> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await submitStudioPresetDelete(apiClient, presetId);
    void loadStudioCatalog(apiClient).then((catalog) => setCatalogState({ status: "ready", catalog }));
    return response;
  }

  async function submitCommandLineToolInstall(): Promise<void> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await installCommandLineTool(apiClient, {});
    requireStudioMutationSuccess(response, "命令行工具安装失败");
    if (response.ok && "command_line_tool" in response.payload) {
      setAgentIntegrationsState({
        status: "ready",
        report: response.payload,
      });
      return;
    }
  }

  async function submitAgentSkillInstall(request: {
    targets: AgentMeshSkillTarget[];
    force: boolean;
  }): Promise<void> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await installAgentSkills(apiClient, request);
    requireStudioMutationSuccess(response, "Agent Skill 安装失败");
    if (response.ok && "skills" in response.payload) {
      setAgentIntegrationsState({
        status: "ready",
        report: response.payload,
        skillResult: response.payload,
      });
      const failedTargets = response.payload.installed_targets.filter((target) => !target.ok);
      if (failedTargets.length > 0) {
        throw new Error(failedTargets
          .map((target) => target.error ?? `${target.target} 安装失败`)
          .join("；"));
      }
      return;
    }
    setAgentIntegrationsState((current) => current.status === "ready"
      ? { ...current, skillResult: response.payload }
      : current);
  }

  async function saveAdvancedSettings(
    request: StudioAdvancedSettingsUpdateRequest,
  ): Promise<StudioAdvancedSettingsPayload> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const settings = await updateStudioAdvancedSettings(apiClient, request);
    setAdvancedSettingsState({ status: "ready", settings });
    return settings;
  }

  const workspaceTitle = workspaceLabel(workspaceView, t);
  const advancedAgentOptions = agentLifecycleState.status === "ready" ? agentLifecycleState.agents : [];
  const agentDisplayNames = useMemo<AgentDisplayNames>(() => {
    const entries = new Map<string, string>();
    if (catalogState.status === "ready") {
      for (const agent of catalogState.catalog.agents ?? []) {
        entries.set(agent.id, agent.label?.trim() || agent.id);
      }
    }
    if (agentLifecycleState.status === "ready") {
      for (const agent of agentLifecycleState.agents) {
        entries.set(agent.id, agent.label?.trim() || agent.id);
      }
    }
    return Object.fromEntries(entries);
  }, [catalogState, agentLifecycleState]);
  const agentDisplayTools = useMemo<AgentDisplayTools>(() => {
    const entries = new Map<string, string>();
    const addAgent = (agent: { id: string; adapter: string }): void => {
      entries.set(agent.id, displayAgentTool(agent.adapter));
    };
    if (catalogState.status === "ready") {
      for (const agent of catalogState.catalog.agents ?? []) {
        addAgent(agent);
      }
    }
    if (agentLifecycleState.status === "ready") {
      for (const agent of agentLifecycleState.agents) {
        addAgent(agent);
      }
    }
    return Object.fromEntries(entries);
  }, [catalogState, agentLifecycleState]);
  const workflowDisplayNames = useMemo<WorkflowDisplayNames>(() => {
    const entries = new Map<string, string>();
    if (catalogState.status === "ready") {
      for (const workflow of catalogState.catalog.workflows ?? []) {
        entries.set(workflow.workflowId, workflow.name?.trim() || workflow.workflowId);
      }
    }
    return Object.fromEntries(entries);
  }, [catalogState]);
  const runDisplayNames = useMemo<Record<string, string>>(() => {
    const entries = new Map<string, string>();
    for (const run of activityRuns(runsState)) {
      const workflowName = run.workflow ? workflowDisplayNames[run.workflow]?.trim() : undefined;
      const label = workflowName || run.title?.trim() || run.run_id;
      entries.set(studioRunKey(run), label);
      entries.set(run.run_id, label);
    }
    return Object.fromEntries(entries);
  }, [runsState, workflowDisplayNames]);

  function openArtifactDrawer(artifactName: string): void {
    setSelectedArtifactName(artifactName);
    setArtifactDrawerOpened(true);
  }

  return (
    <AppShell
      className="studio-shell"
      data-studio-section="react-baseline"
      navbar={{ width: 300, breakpoint: "xs" }}
      padding={0}
    >
      <AppShell.Navbar className="studio-navbar" data-studio-section="activity-navigator">
        <Stack gap="sm" h="100%" p="md">
          <Paper className="studio-brand-panel" withBorder p="md" radius="md" data-studio-section="workspace-brand">
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
          </Paper>
          <Box className="studio-navigator-list">
            <ActivityNavigator
              runsState={runsState}
              callsState={callsState}
              selectedKind={workspaceView === "runs" ? "run" : workspaceView === "calls" ? "call" : undefined}
              selectedRunKey={selectedRunKey}
              selectedCallKey={selectedCallKey}
              query={activityQuery}
              autoRefreshSeconds={autoRefreshSeconds}
              onQueryChange={setActivityQuery}
              onAutoRefreshSecondsChange={setAutoRefreshSeconds}
              onRefresh={() => {
                if (apiClient) {
                  loadActivitiesWithClient(apiClient, { showLoading: false });
                }
              }}
              onSelectRun={(runKey) => {
                setRunDetailTab((current) => runDetailTabAfterRunSelection(selectedRunKey, runKey, current));
                setSelectedRunKey(runKey);
                setWorkspaceView("runs");
              }}
              onSelectCall={(callKey) => {
                setSelectedCallKey(callKey);
                setWorkspaceView("calls");
              }}
              onDeleteActivity={deleteActivity}
            />
          </Box>
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main className="studio-main">
        <Stack className="studio-workspace-shell" gap="md">
          <Paper className="studio-topbar" withBorder radius="md" p="sm">
            <Group justify="space-between" align="center" gap="md">
              <Group className="studio-topbar-copy" align="baseline" gap="sm" wrap="nowrap">
                <Title className="studio-topbar-title" order={2} size="h3">{workspaceTitle}</Title>
                <Text className="studio-topbar-subtitle" size="sm" c="dimmed" title={workspaceSubtitle(workspaceView, t)}>
                  {workspaceSubtitle(workspaceView, t)}
                </Text>
              </Group>
            </Group>
          </Paper>

          <Box className={workspaceScrollClassName(workspaceView)}>
            <Stack data-studio-section="run-workspace" hidden={workspaceView !== "runs"} gap="md">
              <Box className="run-workspace-layout">
                <Box className="run-workspace-main">
                  <Tabs
                    value={runDetailTab}
                    onChange={(value) => setRunDetailTab(isRunDetailTab(value) ? value : "details")}
                    data-studio-section="run-detail-tabs"
                    className="run-detail-tabs"
                  >
                    <Tabs.List aria-label={t("runsSubtitle")} grow>
                      {RUN_DETAIL_TABS.map((tab) => (
                        <Tabs.Tab
                          value={tab.id}
                          key={tab.id}
                          onKeyDown={(event) => selectRelativeRunDetailTab(event, tab.id, setRunDetailTab)}
                        >
                          {t(tab.labelKey)}
                        </Tabs.Tab>
                      ))}
                    </Tabs.List>
                    <Tabs.Panel value="details" pt="md">
                      <RunOverview
                        state={overviewState}
                        view="details"
                        agentLabels={agentDisplayNames}
                        agentTools={agentDisplayTools}
                        workflowLabels={workflowDisplayNames}
                        onCloseReviewerSession={closeReviewerSession}
                        onPurgeExpiredReviewerSessions={purgeExpiredReviewerSessions}
                      />
                    </Tabs.Panel>
                    <Tabs.Panel value="actions" pt="md">
                      <SafeActionsPanel
                        detail={selectedRun?.workspace.current && runDetailState.status === "ready"
                          ? runDetailState.detail
                          : undefined}
                        unavailableMessage={selectedRun && !selectedRun.workspace.current
                          ? "只能操作当前工作区的运行。"
                          : runDetailState.status === "loading"
                            ? "正在加载运行详情..."
                            : runDetailState.status === "error"
                              ? `运行详情加载失败：${runDetailState.message}`
                              : undefined}
                        onSubmit={submitSafeAction}
                        onSettled={refreshAfterMutation}
                      />
                    </Tabs.Panel>
                    <Tabs.Panel value="events" pt="md">
                      {runDetailState.status === "ready" ? (
                        <EventLogView
                          detail={runDetailState.detail}
                          agentLabels={agentDisplayNames}
                        />
                      ) : <RunDetailPlaceholder state={runDetailState} />}
                    </Tabs.Panel>
                  </Tabs>
                </Box>
                <Box className="run-workspace-side">
                  {runDetailState.status === "ready" ? (
                    <ArtifactSidebarPanel
                      detail={runDetailState.detail}
                      selectedArtifactName={selectedArtifactName}
                      onSelectArtifact={openArtifactDrawer}
                    />
                  ) : (
                    <RunArtifactSidebarPlaceholder state={runDetailState} />
                  )}
                </Box>
              </Box>
              <ArtifactPreviewDrawer
                opened={artifactDrawerOpened && workspaceView === "runs"}
                previewState={artifactPreviewState}
                agentLabels={agentDisplayNames}
                onClose={() => setArtifactDrawerOpened(false)}
              />
            </Stack>

            <Stack data-studio-section="calls-workspace" hidden={workspaceView !== "calls"} gap="md">
              <CallDetailView
                state={callDetailState}
                runLabels={runDisplayNames}
                agentLabels={agentDisplayNames}
              />
            </Stack>

            <Stack data-studio-section="settings-workspace" hidden={workspaceView !== "settings"} gap="md">
              <SettingsView
                resources={{
                  state: catalogState,
                  agentLifecycle: {
                    state: agentLifecycleState,
                    onCreateAgent: createAgent,
                    onAgentAction: submitAgentLifecycle,
                    onLoadAgentModels: loadAgentModels,
                  },
                  onCreateWorkflow: createWorkflow,
                  onUpdateWorkflow: updateWorkflow,
                  onDeleteWorkflow: deleteWorkflow,
                  onCreatePreset: createPreset,
                  onUpdatePreset: updatePreset,
                  onDeletePreset: deletePreset,
                }}
                environment={{
                  state: agentIntegrationsState,
                  onRefreshIntegrations: refreshAgentIntegrations,
                  onInstallAgentSkills: submitAgentSkillInstall,
                }}
                advanced={{
                  state: advancedSettingsState,
                  agents: advancedAgentOptions,
                  onSaveAdvancedSettings: saveAdvancedSettings,
                }}
                about={{
                  state: settingsAboutState,
                  refreshBusy: versionRefreshBusy,
                  commandLineTool: {
                    state: settingsCommandLineToolState,
                    onInstall: submitCommandLineToolInstall,
                  },
                  desktopUpdater: {
                    state: desktopUpdaterState,
                    ...(desktopUpdaterRefreshError ? { refreshError: desktopUpdaterRefreshError } : {}),
                    onInstall: installDesktopUpdater,
                  },
                  desktopAutoUpdate: isDesktopPreferencesAvailable() ? {
                    state: desktopAutoUpdateState,
                    onChange: saveDesktopAutoUpdate,
                  } : undefined,
                  onRefreshUpdate: refreshVersionAndUpdates,
                }}
              />
            </Stack>

            <Stack data-studio-section="system-definitions" hidden={workspaceView !== "definitions"} gap="md">
              <ManualView />
            </Stack>
          </Box>
        </Stack>
      </AppShell.Main>
    </AppShell>
  );
}

export function activitySelectionAfterDelete(
  items: StudioActivityItem[],
  deleted: StudioActivityItem,
  selectedKind: StudioActivityItem["kind"] | undefined,
  selectedKey: string | undefined,
): { kind: StudioActivityItem["kind"]; key: string } | undefined {
  if (!selectedKind || !selectedKey) {
    return undefined;
  }
  if (selectedKind !== deleted.kind || selectedKey !== deleted.key) {
    return { kind: selectedKind, key: selectedKey };
  }
  const deletedIndex = items.findIndex((item) => item.kind === deleted.kind && item.key === deleted.key);
  const remaining = items.filter((item) => item.kind !== deleted.kind || item.key !== deleted.key);
  if (remaining.length === 0) {
    return undefined;
  }
  const nextIndex = deletedIndex < 0 ? 0 : Math.min(deletedIndex, remaining.length - 1);
  const next = remaining[nextIndex];
  return next ? { kind: next.kind, key: next.key } : undefined;
}

function readablePromiseRejection(reason: unknown): string {
  return reason instanceof Error && reason.message.trim().length > 0
    ? reason.message
    : "检查失败";
}

function RunDetailPlaceholder({ state }: { state: RunOverviewState }): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Alert color={state.status === "error" ? "red" : "gray"} variant="light">
      {runDetailPlaceholderMessage(state, t)}
    </Alert>
  );
}

function RunArtifactSidebarPlaceholder({ state }: { state: RunOverviewState }): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Paper
      component="aside"
      className="studio-panel artifact-sidebar-panel"
      data-studio-section="current-node-artifacts-placeholder"
      withBorder
      radius="md"
      p="md"
    >
      <Stack gap="xs">
        <Text size="sm" fw={800}>{t("currentNode")}</Text>
        <Alert color={state.status === "error" ? "red" : "gray"} variant="light">
          {runDetailPlaceholderMessage(state, t)}
        </Alert>
      </Stack>
    </Paper>
  );
}

function runDetailPlaceholderMessage(
  state: RunOverviewState,
  t: (key: StudioCopyKey) => string,
): string {
  switch (state.status) {
    case "loading":
      return t("loadingRunDetails");
    case "error":
      return `${t("runDetailsFailed")}: ${state.message}`;
    case "ready":
      return "";
    case "empty":
      return t("selectRun");
  }
}

function isRunDetailTab(value: string | null): value is RunDetailTab {
  return RUN_DETAIL_TABS.some((tab) => tab.id === value);
}

function displayAgentTool(adapter: string): string {
  return {
    command: "Command Agent",
    "codex-cli": "Codex CLI",
    codex: "Codex CLI",
    "claude-code-cli": "Claude Code CLI",
    claude: "Claude Code CLI",
    "cursor-agent": "Cursor Agent",
    cursor: "Cursor Agent",
    "antigravity-cli": "Antigravity CLI",
    antigravity: "Antigravity CLI",
    "opencode-cli": "OpenCode CLI",
    opencode: "OpenCode CLI",
  }[adapter] ?? adapter;
}

export function runDetailTabAfterRunSelection(
  previousRunId: string | undefined,
  nextRunId: string | undefined,
  currentTab: RunDetailTab,
): RunDetailTab {
  return previousRunId === nextRunId ? currentTab : "details";
}

function workspaceLabel(workspace: WorkspaceView, t: (key: StudioCopyKey) => string): string {
  return {
    runs: t("runs"),
    calls: t("calls"),
    settings: t("settings"),
    definitions: t("definitions"),
  }[workspace];
}

function workspaceSubtitle(workspace: WorkspaceView, t: (key: StudioCopyKey) => string): string {
  return {
    runs: t("runsSubtitle"),
    calls: t("callsSubtitle"),
    settings: t("settingsSubtitle"),
    definitions: t("definitionsSubtitle"),
  }[workspace];
}

function workspaceScrollClassName(workspaceView: WorkspaceView): string {
  return workspaceView === "runs" ? "studio-workspace-scroll run-workspace-scroll" : "studio-workspace-scroll";
}

function selectRelativeRunDetailTab(
  event: KeyboardEvent<HTMLButtonElement>,
  currentTab: RunDetailTab,
  onSelect: (tab: RunDetailTab) => void,
): void {
  const currentIndex = RUN_DETAIL_TABS.findIndex((tab) => tab.id === currentTab);
  if (currentIndex < 0) {
    return;
  }
  const nextIndex = relativeRunDetailTabIndex(event.key, currentIndex, RUN_DETAIL_TABS.length);
  if (nextIndex === undefined) {
    return;
  }
  event.preventDefault();
  onSelect(RUN_DETAIL_TABS[nextIndex].id);
}

function relativeRunDetailTabIndex(
  key: string,
  currentIndex: number,
  length: number,
): number | undefined {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (currentIndex + 1) % length;
    case "ArrowLeft":
    case "ArrowUp":
      return (currentIndex - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return undefined;
  }
}
