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
  type StudioAgentLifecycleOperation,
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
  loadStudioArtifactPreview,
  loadStudioRunDetail,
  loadStudioRuns,
  nextSelectedRunKey,
  studioRunKey,
} from "../api/runs.js";
import {
  loadStudioCallDetail,
  loadStudioCalls,
  nextSelectedCallKey,
  studioCallKey,
  submitStudioCallAdoption,
  type StudioCallAdoptionRequest,
  type StudioCallAdoptionResponse,
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
  type RunOverviewState,
  type WorkflowDisplayNames,
} from "../features/runs/RunOverview.js";
import {
  type AutoRefreshSeconds,
} from "../features/navigation/AutoRefreshSelect.js";
import {
  ActivityNavigator,
  activityCalls,
  activityRuns,
  type ActivityCallsState,
  type ActivityRunsState,
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
export type RunDetailTab = "details" | "actions" | "events" | "diagnostics";

const RUN_DETAIL_TABS: Array<{
  id: RunDetailTab;
  labelKey: StudioCopyKey;
}> = [
  { id: "details", labelKey: "details" },
  { id: "actions", labelKey: "action" },
  { id: "events", labelKey: "logEvents" },
  { id: "diagnostics", labelKey: "diagnostics" },
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

  function loadRunsWithClient(client: StudioApiClient, options: NavigatorLoadOptions = {}): void {
    if (options.showLoading !== false) {
      setRunsState({ status: "loading" });
    }
    void loadStudioRuns(client)
      .then(({ runs }) => {
        setRunsState({ status: "ready", runs });
        setSelectedRunKey((current) => nextSelectedRunKey(runs, current));
      })
      .catch((error: unknown) => {
        setRunsState((current) => ({
          status: "error",
          message: normalizeStudioApiError(error).message,
          runs: activityRuns(current),
        }));
      });
  }

  function loadCallsWithClient(client: StudioApiClient, options: NavigatorLoadOptions = {}): void {
    if (options.showLoading !== false) {
      setCallsState({ status: "loading" });
    }
    void loadStudioCalls(client)
      .then(({ calls }) => {
        setCallsState({ status: "ready", calls });
        setSelectedCallKey((current) => nextSelectedCallKey(calls, current));
      })
      .catch((error: unknown) => {
        setCallsState((current) => ({
          status: "error",
          message: normalizeStudioApiError(error).message,
          calls: activityCalls(current),
        }));
      });
  }

  function loadActivitiesWithClient(
    client: StudioApiClient,
    options: NavigatorLoadOptions = {},
  ): void {
    loadRunsWithClient(client, options);
    loadCallsWithClient(client, options);
  }

  function loadAgentLifecycleWithClient(
    client: StudioApiClient,
    lastOperation?: StudioAgentLifecycleOperation,
  ): void {
    setAgentLifecycleState({ status: "loading" });
    void loadStudioAgents(client)
      .then(({ agents }) => {
        setAgentLifecycleState({
          status: "ready",
          agents,
          ...(lastOperation ? { lastOperation } : {}),
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

  async function createAgent(request: StudioAgentCreateRequest): Promise<void> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await submitStudioAgentLifecycleOperation(apiClient, {
      action: "create",
      request,
    });
    loadAgentLifecycleWithClient(apiClient, response.payload);
    void loadStudioCatalog(apiClient).then((catalog) => setCatalogState({ status: "ready", catalog }));
  }

  async function submitAgentLifecycle(request: StudioAgentLifecycleSubmit): Promise<void> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await submitStudioAgentLifecycleOperation(apiClient, request);
    loadAgentLifecycleWithClient(apiClient, response.payload);
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

  async function submitCallAdoption(
    request: StudioCallAdoptionRequest,
  ): Promise<StudioCallAdoptionResponse> {
    if (!apiClient || !selectedCall) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await submitStudioCallAdoption(
      apiClient,
      selectedCall.id,
      request,
      selectedCall.workspace.id,
    );
    if (response.ok && "call" in response.payload) {
      setCallDetailState({ status: "ready", detail: response.payload });
      loadCallsWithClient(apiClient, { showLoading: false });
    }
    return response;
  }

  async function submitCommandLineToolInstall(): Promise<void> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await installCommandLineTool(apiClient, {});
    if (response.ok && "command_line_tool" in response.payload) {
      setAgentIntegrationsState({
        status: "ready",
        report: response.payload,
        commandResult: response.payload,
      });
      return;
    }
    setAgentIntegrationsState((current) => current.status === "ready"
      ? { ...current, commandResult: response.payload }
      : current);
  }

  async function submitAgentSkillInstall(request: {
    targets: AgentMeshSkillTarget[];
    force: boolean;
  }): Promise<void> {
    if (!apiClient) {
      throw new Error("AgentMesh API is not ready.");
    }
    const response = await installAgentSkills(apiClient, request);
    if (response.ok && "skills" in response.payload) {
      setAgentIntegrationsState({
        status: "ready",
        report: response.payload,
        skillResult: response.payload,
      });
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
  const workflowDisplayNames = useMemo<WorkflowDisplayNames>(() => {
    const entries = new Map<string, string>();
    if (catalogState.status === "ready") {
      for (const workflow of catalogState.catalog.workflows ?? []) {
        entries.set(workflow.workflowId, workflow.name?.trim() || workflow.workflowId);
      }
    }
    return Object.fromEntries(entries);
  }, [catalogState]);

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
                        workflowLabels={workflowDisplayNames}
                      />
                    </Tabs.Panel>
                    <Tabs.Panel value="actions" pt="md">
                      <SafeActionsPanel
                        selectedRunId={selectedRun?.workspace.current ? selectedRun.run_id : undefined}
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
                    <Tabs.Panel value="diagnostics" pt="md">
                      <RunOverview
                        state={overviewState}
                        view="diagnostics"
                        agentLabels={agentDisplayNames}
                        workflowLabels={workflowDisplayNames}
                      />
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
              <CallDetailView state={callDetailState} onSubmitAdoption={submitCallAdoption} />
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
                  onInstallCommandLineTool: submitCommandLineToolInstall,
                  onInstallAgentSkills: submitAgentSkillInstall,
                }}
                advanced={{
                  state: advancedSettingsState,
                  agents: advancedAgentOptions,
                  onSaveAdvancedSettings: saveAdvancedSettings,
                }}
                about={{
                  state: settingsAboutState,
                  desktopUpdater: {
                    state: desktopUpdaterState,
                    onCheck: checkDesktopUpdater,
                    onInstall: installDesktopUpdater,
                  },
                  onRefreshUpdate: () => {
                    if (apiClient) {
                      loadUpdateWithClient(apiClient);
                    }
                  },
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
