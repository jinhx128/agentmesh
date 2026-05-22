import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  FileInput,
  Group,
  Modal,
  MultiSelect,
  Paper,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useEffect, useState, type KeyboardEvent, type ReactElement } from "react";
import {
  AgentEditModal,
  AgentLifecyclePanel,
  AGENT_TOOLS,
  type AgentEditableSummary,
  type AgentLifecyclePanelProps,
} from "../agents/AgentLifecyclePanel.js";

import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import type {
  StudioAgentSummary,
  StudioAgentUpdateRequest,
} from "../../api/agents.js";
import type {
  StudioCatalog,
  StudioCatalogAgent,
  StudioCatalogMcpServer,
  StudioCatalogPreset,
  StudioCatalogWorkflow,
} from "../../api/catalog.js";
import type {
  StudioWorkflowCreateRequest,
  StudioWorkflowLifecycleOperation,
  StudioWorkflowLifecycleResponse,
  StudioWorkflowUpdateRequest,
} from "../../api/workflows.js";
import type {
  StudioPresetCreateRequest,
  StudioPresetLifecycleOperation,
  StudioPresetLifecycleResponse,
  StudioPresetUpdateRequest,
} from "../../api/presets.js";

export type CatalogViewState =
  | { status: "loading" }
  | { status: "ready"; catalog: StudioCatalog }
  | { status: "error"; message: string };

export interface CatalogViewProps {
  state: CatalogViewState;
  agentLifecycle?: AgentLifecyclePanelProps;
  initialTab?: CatalogTabId;
  onCreateWorkflow?: (request: StudioWorkflowCreateRequest) => Promise<StudioWorkflowLifecycleResponse>;
  onUpdateWorkflow?: (workflowId: string, request: StudioWorkflowUpdateRequest) => Promise<StudioWorkflowLifecycleResponse>;
  onDeleteWorkflow?: (workflowId: string) => Promise<StudioWorkflowLifecycleResponse>;
  onCreatePreset?: (request: StudioPresetCreateRequest) => Promise<StudioPresetLifecycleResponse>;
  onUpdatePreset?: (presetId: string, request: StudioPresetUpdateRequest) => Promise<StudioPresetLifecycleResponse>;
  onDeletePreset?: (presetId: string) => Promise<StudioPresetLifecycleResponse>;
}

type CatalogTabId = "agents" | "workflows" | "presets" | "mcp";

const CATALOG_TABS: Array<{
  id: CatalogTabId;
  labelKey: StudioCopyKey;
}> = [
  { id: "agents", labelKey: "agents" },
  { id: "workflows", labelKey: "workflows" },
  { id: "presets", labelKey: "presets" },
  { id: "mcp", labelKey: "mcp" },
];

export function CatalogView({
  state,
  agentLifecycle,
  initialTab = "agents",
  onCreateWorkflow,
  onUpdateWorkflow,
  onDeleteWorkflow,
  onCreatePreset,
  onUpdatePreset,
  onDeletePreset,
}: CatalogViewProps): ReactElement {
  const { t } = useStudioCopy();
  const [selectedTab, setSelectedTab] = useState<CatalogTabId>(initialTab);
  const [busyAgentAction, setBusyAgentAction] = useState<string | null>(null);
  const [busyDeleteAction, setBusyDeleteAction] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentEditableSummary | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<StudioCatalogWorkflow | null>(null);
  const [editingPreset, setEditingPreset] = useState<StudioCatalogPreset | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmationTarget | null>(null);

  if (state.status === "loading") {
    return (
      <Paper component="section" className="studio-panel" data-studio-section="react-catalog-pilot" withBorder radius="md" p="lg">
        <PanelHeader title={t("resources")} meta={t("loadingResources")} />
        <Alert mt="md" variant="light">{t("loadingResources")}</Alert>
      </Paper>
    );
  }

  if (state.status === "error") {
    return (
      <Paper component="section" className="studio-panel" data-studio-section="react-catalog-pilot" withBorder radius="md" p="lg">
        <PanelHeader title={t("resources")} meta={t("noResources")} />
        <Alert mt="md" color="red" title={t("noResources")} variant="light">{state.message}</Alert>
      </Paper>
    );
  }

  const { catalog } = state;
  const agents = catalog.agents ?? [];
  const workflows = catalog.workflows ?? [];
  const presets = catalog.presets ?? [];
  const mcpServers = catalog.mcpServers ?? [];
  const diagnostics = catalog.diagnostics ?? [];
  const lifecycleAgents = agentLifecycle?.state.status === "ready"
    ? new Map(agentLifecycle.state.agents.map((agent) => [agent.id, agent]))
    : new Map<string, StudioAgentSummary>();

  async function submitAgentAction(
    action: "delete" | "enable" | "disable",
    agentId: string,
  ): Promise<void> {
    if (action === "delete") {
      const agent = lifecycleAgents.get(agentId) ?? agents.find((item) => item.id === agentId);
      setDeleteConfirmation({
        kind: "Agent",
        id: agentId,
        label: agent ? agentDisplayName(agent) : agentId,
      });
      return;
    }
    await runAgentAction(action, agentId);
  }

  async function runAgentAction(
    action: "delete" | "enable" | "disable",
    agentId: string,
  ): Promise<void> {
    if (!agentLifecycle) {
      return;
    }
    setBusyAgentAction(`${action}:${agentId}`);
    try {
      await agentLifecycle.onAgentAction({ action, agentId });
    } finally {
      setBusyAgentAction(null);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteConfirmation) {
      return;
    }
    setBusyDeleteAction(true);
    try {
      if (deleteConfirmation.kind === "Agent") {
        await runAgentAction("delete", deleteConfirmation.id);
      } else if (deleteConfirmation.kind === "Workflow" && onDeleteWorkflow) {
        await onDeleteWorkflow(deleteConfirmation.id);
      } else if (deleteConfirmation.kind === "Preset" && onDeletePreset) {
        await onDeletePreset(deleteConfirmation.id);
      }
      setDeleteConfirmation(null);
    } finally {
      setBusyDeleteAction(false);
    }
  }

  async function submitAgentUpdate(agentId: string, request: StudioAgentUpdateRequest): Promise<void> {
    if (!agentLifecycle) {
      return;
    }
    setBusyAgentAction(`edit:${agentId}`);
    try {
      await agentLifecycle.onAgentAction({ action: "update", agentId, request });
      setEditingAgent(null);
    } finally {
      setBusyAgentAction(null);
    }
  }

  return (
    <Paper component="section" className="studio-panel" data-studio-section="react-catalog-pilot" withBorder radius="md" p="lg">
      <PanelHeader
        title={t("resources")}
        meta={catalogStatus(agents.length, workflows.length, presets.length, mcpServers.length, diagnostics.length, t)}
      />
      {diagnostics.length > 0 ? (
        <Stack mt="md" gap="xs">
          {diagnostics.map((diagnostic) => (
            <Alert color="yellow" variant="light" key={`${diagnostic.target}:${diagnostic.message}`}>
              <Text fw={800}>{diagnostic.target}</Text>
              <Text size="sm">{diagnostic.message}</Text>
            </Alert>
          ))}
        </Stack>
      ) : null}
      <Tabs
        mt="md"
        value={selectedTab}
        onChange={(value) => setSelectedTab(isCatalogTab(value) ? value : "agents")}
        keepMounted={false}
      >
        <Tabs.List aria-label={t("resourceView")} grow>
          {CATALOG_TABS.map((tab) => (
            <Tabs.Tab
              value={tab.id}
              key={tab.id}
              onKeyDown={(event) => selectRelativeTab(event, CATALOG_TABS.map((item) => item.id), tab.id, setSelectedTab)}
            >
              {t(tab.labelKey)} · {catalogTabCount(tab.id, agents.length, workflows.length, presets.length, mcpServers.length)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="agents" pt="md">
          <Stack gap="md">
            {agentLifecycle ? (
              <AgentLifecyclePanel
                {...agentLifecycle}
                embedded
              />
            ) : null}
            {agents.length > 0 ? (
              <AgentToolGroups
                agents={agents}
                controls={agentLifecycle ? {
                  busyAction: busyAgentAction,
                  lifecycleAgents,
                  onAgentAction: submitAgentAction,
                  onAgentEdit: setEditingAgent,
                } : undefined}
              />
            ) : <EmptyCatalogRow label={t("noAgents")} />}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="workflows" pt="md">
          <Stack gap="md">
            {onCreateWorkflow ? (
              <WorkflowLifecyclePanel
                onCreateWorkflow={onCreateWorkflow}
              />
            ) : null}
            {workflows.length > 0 ? (
              <WorkflowGroups
                workflows={workflows}
                onWorkflowEdit={onUpdateWorkflow ? setEditingWorkflow : undefined}
                onWorkflowDelete={onDeleteWorkflow ? (workflow) => setDeleteConfirmation({
                  kind: "Workflow",
                  id: workflow.workflowId,
                  label: workflow.name || workflow.workflowId,
                }) : undefined}
              />
            ) : <EmptyCatalogRow label={t("noWorkflows")} />}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="presets" pt="md">
          <Stack gap="md">
            {onCreatePreset ? (
              <PresetLifecyclePanel
                onCreatePreset={onCreatePreset}
                workflows={workflows}
                agents={agents}
              />
            ) : null}
            {presets.length > 0 ? presets.map((preset) => renderPreset(
              preset,
              onUpdatePreset || onDeletePreset ? {
                ...(onUpdatePreset ? { onPresetEdit: setEditingPreset } : {}),
                ...(onDeletePreset ? { onPresetDelete: (item) => setDeleteConfirmation({
                  kind: "Preset",
                  id: item.presetId,
                  label: item.name || item.presetId,
                }) } : {}),
              } : undefined,
              t,
            )) : <EmptyCatalogRow label={t("noPresets")} />}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="mcp" pt="md">
          <Stack gap="sm">
            {mcpServers.length > 0 ? mcpServers.map(renderMcpServer) : <EmptyCatalogRow label={t("noMcpServers")} />}
          </Stack>
        </Tabs.Panel>
      </Tabs>
      {agentLifecycle ? (
        <AgentEditModal
          opened={editingAgent !== null}
          agent={editingAgent}
          busy={busyAgentAction !== null}
          onClose={() => {
            if (busyAgentAction === null) {
              setEditingAgent(null);
            }
          }}
          onSubmit={submitAgentUpdate}
          onLoadAgentModels={agentLifecycle.onLoadAgentModels}
        />
      ) : null}
      {onUpdateWorkflow ? (
        <WorkflowEditModal
          opened={editingWorkflow !== null}
          workflow={editingWorkflow}
          onClose={() => setEditingWorkflow(null)}
          onSubmit={onUpdateWorkflow}
        />
      ) : null}
      {onUpdatePreset ? (
        <PresetEditModal
          opened={editingPreset !== null}
          preset={editingPreset}
          workflows={workflows}
          agents={agents}
          onClose={() => setEditingPreset(null)}
          onSubmit={onUpdatePreset}
        />
      ) : null}
      <DeleteConfirmationModal
        target={deleteConfirmation}
        busy={busyDeleteAction || busyAgentAction !== null}
        onCancel={() => setDeleteConfirmation(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Paper>
  );
}

type DeleteConfirmationTarget = {
  kind: "Agent" | "Workflow" | "Preset";
  id: string;
  label: string;
};

interface AgentToolGroupControls {
  lifecycleAgents: Map<string, StudioAgentSummary>;
  busyAction: string | null;
  onAgentAction: (action: "delete" | "enable" | "disable", agentId: string) => Promise<void>;
  onAgentEdit: (agent: AgentEditableSummary) => void;
}

function AgentToolGroups({
  agents,
  controls,
}: {
  agents: StudioCatalogAgent[];
  controls?: AgentToolGroupControls;
}): ReactElement {
  const { t } = useStudioCopy();
  const groups = agentToolGroups(agents);
  const [selectedTool, setSelectedTool] = useState(groups[0]?.tool ?? "");
  const firstGroup = groups[0];
  if (!firstGroup) {
    return <EmptyCatalogRow label={t("noAgents")} />;
  }
  const selectedGroup = groups.find((group) => group.tool === selectedTool) ?? firstGroup;

  return (
    <Tabs
      data-studio-section="agent-tool-groups"
      value={selectedGroup.tool}
      onChange={(value) => setSelectedTool(groups.some((group) => group.tool === value) ? value ?? firstGroup.tool : firstGroup.tool)}
      keepMounted={false}
    >
      <Tabs.List aria-label={t("tool")}>
        {groups.map((group) => (
          <Tabs.Tab
            value={group.tool}
            data-agent-tool={group.tool}
            key={group.tool}
            onKeyDown={(event) => selectRelativeTab(event, groups.map((item) => item.tool), group.tool, setSelectedTool)}
          >
            {group.tool} · {group.agents.length}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {groups.map((group) => (
        <Tabs.Panel value={group.tool} pt="sm" key={group.tool}>
          <Stack gap="sm">
            {group.agents.length === 0 ? <EmptyCatalogRow label={t("noAgents")} /> : null}
            {group.agents.map((agent) => renderAgent(agent, controls ? {
              busyAction: controls.busyAction,
              lifecycleAgent: controls.lifecycleAgents.get(agent.id),
              onAgentAction: controls.onAgentAction,
              onAgentEdit: controls.onAgentEdit,
            } : undefined, t))}
          </Stack>
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

function agentToolGroups(agents: StudioCatalogAgent[]): Array<{
  tool: string;
  agents: StudioCatalogAgent[];
}> {
  const groups = new Map<string, StudioCatalogAgent[]>(
    AGENT_TOOLS.map((tool) => [tool.id, []]),
  );
  for (const agent of agents) {
    const tool = agent.adapter || "unknown";
    const currentAgents = groups.get(tool);
    if (currentAgents) {
      currentAgents.push(agent);
    } else {
      groups.set(tool, [agent]);
    }
  }
  return Array.from(groups.entries()).map(([tool, groupAgents]) => ({
    tool,
    agents: groupAgents,
  }));
}

interface TomlRegistrationFieldsProps {
  sourceMode: TomlSourceMode;
  sourceFile: File | null;
  manualContent?: ReactElement;
  section: string;
  submitLabel: string;
  submitDisabled: boolean;
  onSourceModeChange: (mode: TomlSourceMode) => void;
  onSourceFileChange: (file: File | null) => void;
  onSubmit: () => void;
}

type TomlSourceMode = "file" | "manual";

export interface WorkflowManualFields {
  name: string;
  stages: string;
  description: string;
  whenToUse: string;
  packetArtifacts: string;
  qualityGates: string;
}

const MAX_FANOUT_AGENTS = 6;
const MAX_EXECUTE_AGENTS = 1;

const WORKFLOW_STAGE_OPTIONS = ["plan", "execute", "verify", "review", "decide"].map((stage) => ({
  value: stage,
  label: stage,
}));

export interface PresetManualFields {
  name: string;
  workflowId: string;
  description: string;
  defaultAgents: string[];
  stageAssignments: Record<string, string[]>;
}

export function TomlRegistrationFields({
  sourceMode,
  sourceFile,
  manualContent,
  section,
  submitLabel,
  submitDisabled,
  onSourceModeChange,
  onSourceFileChange,
  onSubmit,
}: TomlRegistrationFieldsProps): ReactElement {
  const { t } = useStudioCopy();
  return (
    <>
      <Stack gap="sm" data-studio-section="toml-registration-layout">
        <Stack gap={4} data-studio-section={`${section}-source`}>
          <Text fw={700}>{t("importSource")}</Text>
          <SegmentedControl
            data-studio-section={`${section}-source-mode`}
            aria-label={t("importSource")}
            fullWidth
            value={sourceMode}
            data={[
              { value: "manual", label: t("manualInput") },
              { value: "file", label: t("importToml") },
            ]}
            onChange={(value) => onSourceModeChange(value === "manual" ? "manual" : "file")}
          />
          {sourceMode === "file" ? (
            <FileInput
              aria-label={t("tomlFile")}
              placeholder={t("selectTomlFile")}
              accept=".toml,text/plain"
              value={sourceFile}
              clearable
              onChange={onSourceFileChange}
            />
          ) : null}
        </Stack>
      </Stack>
      {sourceMode === "manual" ? manualContent : null}
      <Button
        type="button"
        disabled={submitDisabled}
        onClick={onSubmit}
      >
        {submitLabel}
      </Button>
    </>
  );
}

function WorkflowLifecyclePanel({
  onCreateWorkflow,
}: {
  onCreateWorkflow: (request: StudioWorkflowCreateRequest) => Promise<StudioWorkflowLifecycleResponse>;
}): ReactElement {
  const { t } = useStudioCopy();
  const [workflowTomlFile, setWorkflowTomlFile] = useState<File | null>(null);
  const [workflowToml, setWorkflowToml] = useState("");
  const [workflowSourceMode, setWorkflowSourceMode] = useState<TomlSourceMode>("manual");
  const [manualWorkflowFields, setManualWorkflowFields] = useState<WorkflowManualFields>(emptyWorkflowManualFields());
  const [busy, setBusy] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [lastOperation, setLastOperation] = useState<StudioWorkflowLifecycleOperation | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const trimmedWorkflowToml = workflowToml.trim();
  const canSubmitManualWorkflow = manualWorkflowFields.name.trim().length > 0
    && parseListField(manualWorkflowFields.stages).length > 0
    && manualWorkflowFields.description.trim().length > 0;
  const workflowSubmitDisabled = busy || (
    workflowSourceMode === "manual"
      ? !canSubmitManualWorkflow
      : trimmedWorkflowToml.length === 0
  );

  async function loadWorkflowToml(file: File | null): Promise<void> {
    setWorkflowTomlFile(file);
    setErrorMessage(undefined);
    if (!file) {
      setWorkflowToml("");
      return;
    }
    try {
      setWorkflowToml(await file.text());
    } catch (error) {
      setWorkflowToml("");
      setErrorMessage(error instanceof Error ? error.message : t("tomlReadFailed"));
    }
  }

  async function createWorkflow(): Promise<void> {
    const workflowTomlToCreate = workflowSourceMode === "manual"
      ? buildWorkflowTomlFromManualFields(manualWorkflowFields)
      : trimmedWorkflowToml;
    if (workflowTomlToCreate.trim().length === 0) {
      setErrorMessage(t("workflowTomlRequired"));
      return;
    }
    setBusy(true);
    setErrorMessage(undefined);
    try {
      const response = await onCreateWorkflow({
        workflow_toml: workflowTomlToCreate,
        ...(workflowSourceMode === "manual"
          ? { source_name: sourceNameFromId(manualWorkflowFields.name, "workflow") }
          : workflowTomlFile ? { source_name: workflowTomlFile.name } : {}),
      });
      setLastOperation(response.payload);
      if (response.ok && response.payload.status === "succeeded") {
        setWorkflowTomlFile(null);
        setWorkflowToml("");
        setManualWorkflowFields(emptyWorkflowManualFields());
        setCreateModalOpen(false);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack data-studio-section="react-workflow-lifecycle" gap="sm">
      <Group justify="flex-end" data-studio-section="workflow-create-entry">
        <Button
          type="button"
          data-studio-section="workflow-create-open"
          onClick={() => setCreateModalOpen(true)}
        >
          {t("createWorkflow")}
        </Button>
      </Group>
      <Modal
        opened={createModalOpen}
        onClose={() => {
          if (!busy) {
            setCreateModalOpen(false);
          }
        }}
        title={t("createWorkflow")}
        centered
        size="lg"
        data-studio-section="workflow-create-modal"
      >
        <Stack gap="sm">
          <TomlRegistrationFields
            sourceMode={workflowSourceMode}
            sourceFile={workflowTomlFile}
            manualContent={(
              <WorkflowManualFieldsForm
                fields={manualWorkflowFields}
                onChange={setManualWorkflowFields}
              />
            )}
            section="workflow-create"
            submitLabel={t("createWorkflow")}
            submitDisabled={workflowSubmitDisabled}
            onSourceModeChange={setWorkflowSourceMode}
            onSourceFileChange={(file) => void loadWorkflowToml(file)}
            onSubmit={() => void createWorkflow()}
          />
        </Stack>
      </Modal>
      {errorMessage ? <Alert color="red" variant="light">{errorMessage}</Alert> : null}
      {lastOperation ? (
        <Code block className="studio-code-block">{formatWorkflowLifecycleOperation(lastOperation)}</Code>
      ) : null}
    </Stack>
  );
}

function PresetLifecyclePanel({
  onCreatePreset,
  workflows,
  agents,
}: {
  onCreatePreset: (request: StudioPresetCreateRequest) => Promise<StudioPresetLifecycleResponse>;
  workflows: StudioCatalogWorkflow[];
  agents: StudioCatalogAgent[];
}): ReactElement {
  const { t } = useStudioCopy();
  const [presetTomlFile, setPresetTomlFile] = useState<File | null>(null);
  const [presetToml, setPresetToml] = useState("");
  const [presetSourceMode, setPresetSourceMode] = useState<TomlSourceMode>("manual");
  const [manualPresetFields, setManualPresetFields] = useState<PresetManualFields>({
    name: "",
    workflowId: "",
    description: "",
    defaultAgents: [],
    stageAssignments: {},
  });
  const [busy, setBusy] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [lastOperation, setLastOperation] = useState<StudioPresetLifecycleOperation | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const trimmedPresetToml = presetToml.trim();
  const canSubmitManualPreset = manualPresetFields.name.trim().length > 0
    && manualPresetFields.workflowId.trim().length > 0
    && hasPresetAgentSelection(manualPresetFields);
  const presetSubmitDisabled = busy || (
    presetSourceMode === "manual"
      ? !canSubmitManualPreset
      : trimmedPresetToml.length === 0
  );

  async function loadPresetToml(file: File | null): Promise<void> {
    setPresetTomlFile(file);
    setErrorMessage(undefined);
    if (!file) {
      setPresetToml("");
      return;
    }
    try {
      setPresetToml(await file.text());
    } catch (error) {
      setPresetToml("");
      setErrorMessage(error instanceof Error ? error.message : t("tomlReadFailed"));
    }
  }

  async function createPreset(): Promise<void> {
    const presetTomlToCreate = presetSourceMode === "manual"
      ? buildPresetTomlFromManualFields(manualPresetFields)
      : trimmedPresetToml;
    if (presetTomlToCreate.trim().length === 0) {
      setErrorMessage(t("presetTomlRequired"));
      return;
    }
    setBusy(true);
    setErrorMessage(undefined);
    try {
      const response = await onCreatePreset({
        preset_toml: presetTomlToCreate,
        ...(presetSourceMode === "manual"
          ? { source_name: sourceNameFromId(manualPresetFields.name, "preset") }
          : presetTomlFile ? { source_name: presetTomlFile.name } : {}),
      });
      setLastOperation(response.payload);
      if (response.ok && response.payload.status === "succeeded") {
        setPresetTomlFile(null);
        setPresetToml("");
        setManualPresetFields({
          name: "",
          workflowId: "",
          description: "",
          defaultAgents: [],
          stageAssignments: {},
        });
        setCreateModalOpen(false);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack data-studio-section="react-preset-lifecycle" gap="sm">
      <Group justify="flex-end" data-studio-section="preset-create-entry">
        <Button
          type="button"
          data-studio-section="preset-create-open"
          onClick={() => setCreateModalOpen(true)}
        >
          {t("createPreset")}
        </Button>
      </Group>
      <Modal
        opened={createModalOpen}
        onClose={() => {
          if (!busy) {
            setCreateModalOpen(false);
          }
        }}
        title={t("createPreset")}
        centered
        size="lg"
        data-studio-section="preset-create-modal"
      >
        <Stack gap="sm">
          <TomlRegistrationFields
            sourceMode={presetSourceMode}
            sourceFile={presetTomlFile}
            manualContent={(
              <PresetManualFieldsForm
                fields={manualPresetFields}
                onChange={setManualPresetFields}
                workflows={workflows}
                agents={agents}
              />
            )}
            section="preset-create"
            submitLabel={t("createPreset")}
            submitDisabled={presetSubmitDisabled}
            onSourceModeChange={setPresetSourceMode}
            onSourceFileChange={(file) => void loadPresetToml(file)}
            onSubmit={() => void createPreset()}
          />
        </Stack>
      </Modal>
      {errorMessage ? <Alert color="red" variant="light">{errorMessage}</Alert> : null}
      {lastOperation ? (
        <Code block className="studio-code-block">{formatPresetLifecycleOperation(lastOperation)}</Code>
      ) : null}
    </Stack>
  );
}

function WorkflowEditModal({
  opened,
  workflow,
  onClose,
  onSubmit,
}: {
  opened: boolean;
  workflow: StudioCatalogWorkflow | null;
  onClose: () => void;
  onSubmit: (workflowId: string, request: StudioWorkflowUpdateRequest) => Promise<StudioWorkflowLifecycleResponse>;
}): ReactElement {
  const { t } = useStudioCopy();
  const [workflowTomlFile, setWorkflowTomlFile] = useState<File | null>(null);
  const [workflowToml, setWorkflowToml] = useState("");
  const [workflowSourceMode, setWorkflowSourceMode] = useState<TomlSourceMode>("manual");
  const [manualWorkflowFields, setManualWorkflowFields] = useState<WorkflowManualFields>(emptyWorkflowManualFields());
  const [busy, setBusy] = useState(false);
  const [lastOperation, setLastOperation] = useState<StudioWorkflowLifecycleOperation | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const trimmedWorkflowToml = workflowToml.trim();
  const canSubmitManualWorkflow = manualWorkflowFields.name.trim().length > 0
    && parseListField(manualWorkflowFields.stages).length > 0
    && manualWorkflowFields.description.trim().length > 0;
  const workflowSubmitDisabled = !workflow || busy || (
    workflowSourceMode === "manual"
      ? !canSubmitManualWorkflow
      : trimmedWorkflowToml.length === 0
  );

  useEffect(() => {
    if (!workflow || !opened) {
      return;
    }
    setWorkflowTomlFile(null);
    setWorkflowToml("");
    setWorkflowSourceMode("manual");
    setManualWorkflowFields(workflowToManualFields(workflow));
    setLastOperation(undefined);
    setErrorMessage(undefined);
  }, [opened, workflow]);

  async function loadWorkflowToml(file: File | null): Promise<void> {
    setWorkflowTomlFile(file);
    setErrorMessage(undefined);
    if (!file) {
      setWorkflowToml("");
      return;
    }
    try {
      setWorkflowToml(await file.text());
    } catch (error) {
      setWorkflowToml("");
      setErrorMessage(error instanceof Error ? error.message : t("tomlReadFailed"));
    }
  }

  async function updateWorkflow(): Promise<void> {
    if (!workflow) {
      return;
    }
    const workflowTomlToUpdate = workflowSourceMode === "manual"
      ? buildWorkflowTomlFromManualFields(manualWorkflowFields)
      : trimmedWorkflowToml;
    if (workflowTomlToUpdate.trim().length === 0) {
      setErrorMessage(t("workflowTomlRequired"));
      return;
    }
    setBusy(true);
    setErrorMessage(undefined);
    try {
      const response = await onSubmit(workflow.workflowId, {
        workflow_toml: workflowTomlToUpdate,
        ...(workflowSourceMode === "manual"
          ? { source_name: sourceNameFromId(manualWorkflowFields.name, "workflow") }
          : workflowTomlFile ? { source_name: workflowTomlFile.name } : {}),
      });
      setLastOperation(response.payload);
      if (response.ok && response.payload.status === "succeeded") {
        onClose();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      title={t("editWorkflow")}
      centered
      size="lg"
      data-studio-section="workflow-edit-modal"
    >
      <Stack gap="sm">
        <TomlRegistrationFields
          sourceMode={workflowSourceMode}
          sourceFile={workflowTomlFile}
          manualContent={(
            <WorkflowManualFieldsForm
              fields={manualWorkflowFields}
              onChange={setManualWorkflowFields}
            />
          )}
          section="workflow-edit"
          submitLabel={t("saveChanges")}
          submitDisabled={workflowSubmitDisabled}
          onSourceModeChange={setWorkflowSourceMode}
          onSourceFileChange={(file) => void loadWorkflowToml(file)}
          onSubmit={() => void updateWorkflow()}
        />
        {errorMessage ? <Alert color="red" variant="light">{errorMessage}</Alert> : null}
        {lastOperation ? (
          <Code block className="studio-code-block">{formatWorkflowLifecycleOperation(lastOperation)}</Code>
        ) : null}
      </Stack>
    </Modal>
  );
}

function PresetEditModal({
  opened,
  preset,
  workflows,
  agents,
  onClose,
  onSubmit,
}: {
  opened: boolean;
  preset: StudioCatalogPreset | null;
  workflows: StudioCatalogWorkflow[];
  agents: StudioCatalogAgent[];
  onClose: () => void;
  onSubmit: (presetId: string, request: StudioPresetUpdateRequest) => Promise<StudioPresetLifecycleResponse>;
}): ReactElement {
  const { t } = useStudioCopy();
  const [presetTomlFile, setPresetTomlFile] = useState<File | null>(null);
  const [presetToml, setPresetToml] = useState("");
  const [presetSourceMode, setPresetSourceMode] = useState<TomlSourceMode>("manual");
  const [manualPresetFields, setManualPresetFields] = useState<PresetManualFields>(emptyPresetManualFields());
  const [busy, setBusy] = useState(false);
  const [lastOperation, setLastOperation] = useState<StudioPresetLifecycleOperation | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const trimmedPresetToml = presetToml.trim();
  const canSubmitManualPreset = manualPresetFields.name.trim().length > 0
    && manualPresetFields.workflowId.trim().length > 0
    && hasPresetAgentSelection(manualPresetFields);
  const presetSubmitDisabled = !preset || busy || (
    presetSourceMode === "manual"
      ? !canSubmitManualPreset
      : trimmedPresetToml.length === 0
  );

  useEffect(() => {
    if (!preset || !opened) {
      return;
    }
    setPresetTomlFile(null);
    setPresetToml("");
    setPresetSourceMode("manual");
    setManualPresetFields(presetToManualFields(preset));
    setLastOperation(undefined);
    setErrorMessage(undefined);
  }, [opened, preset]);

  async function loadPresetToml(file: File | null): Promise<void> {
    setPresetTomlFile(file);
    setErrorMessage(undefined);
    if (!file) {
      setPresetToml("");
      return;
    }
    try {
      setPresetToml(await file.text());
    } catch (error) {
      setPresetToml("");
      setErrorMessage(error instanceof Error ? error.message : t("tomlReadFailed"));
    }
  }

  async function updatePreset(): Promise<void> {
    if (!preset) {
      return;
    }
    const presetTomlToUpdate = presetSourceMode === "manual"
      ? buildPresetTomlFromManualFields(manualPresetFields)
      : trimmedPresetToml;
    if (presetTomlToUpdate.trim().length === 0) {
      setErrorMessage(t("presetTomlRequired"));
      return;
    }
    setBusy(true);
    setErrorMessage(undefined);
    try {
      const response = await onSubmit(preset.presetId, {
        preset_toml: presetTomlToUpdate,
        ...(presetSourceMode === "manual"
          ? { source_name: sourceNameFromId(manualPresetFields.name, "preset") }
          : presetTomlFile ? { source_name: presetTomlFile.name } : {}),
      });
      setLastOperation(response.payload);
      if (response.ok && response.payload.status === "succeeded") {
        onClose();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      title={t("editPreset")}
      centered
      size="lg"
      data-studio-section="preset-edit-modal"
    >
      <Stack gap="sm">
        <TomlRegistrationFields
          sourceMode={presetSourceMode}
          sourceFile={presetTomlFile}
          manualContent={(
            <PresetManualFieldsForm
              fields={manualPresetFields}
              onChange={setManualPresetFields}
              workflows={workflows}
              agents={agents}
            />
          )}
          section="preset-edit"
          submitLabel={t("saveChanges")}
          submitDisabled={presetSubmitDisabled}
          onSourceModeChange={setPresetSourceMode}
          onSourceFileChange={(file) => void loadPresetToml(file)}
          onSubmit={() => void updatePreset()}
        />
        {errorMessage ? <Alert color="red" variant="light">{errorMessage}</Alert> : null}
        {lastOperation ? (
          <Code block className="studio-code-block">{formatPresetLifecycleOperation(lastOperation)}</Code>
        ) : null}
      </Stack>
    </Modal>
  );
}

export function WorkflowManualFieldsForm({
  fields,
  onChange,
}: {
  fields: WorkflowManualFields;
  onChange: (fields: WorkflowManualFields) => void;
}): ReactElement {
  const { t } = useStudioCopy();
  function setField<Key extends keyof WorkflowManualFields>(key: Key, value: WorkflowManualFields[Key]): void {
    onChange({ ...fields, [key]: value });
  }
  return (
    <Stack gap="sm" data-studio-section="workflow-create-manual-fields">
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <TextInput
          aria-label={t("workflowName")}
          label={t("workflowName")}
          value={fields.name}
          onChange={(event) => setField("name", event.currentTarget.value)}
        />
        <MultiSelect
          data-studio-section="workflow-stage-select"
          aria-label={t("workflowStages")}
          label={t("workflowStages")}
          placeholder={t("selectStages")}
          value={uniqueStrings(parseListField(fields.stages))}
          data={WORKFLOW_STAGE_OPTIONS}
          searchable
          clearable
          onChange={(value) => setField("stages", value.join(", "))}
        />
      </SimpleGrid>
      <Textarea
        aria-label={t("workflowDescription")}
        label={t("workflowDescription")}
        autosize
        minRows={2}
        value={fields.description}
        onChange={(event) => setField("description", event.currentTarget.value)}
      />
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <Textarea
          aria-label={t("workflowWhenToUse")}
          label={t("workflowWhenToUse")}
          description={t("workflowWhenToUseHelp")}
          placeholder={t("oneItemPerLine")}
          autosize
          minRows={3}
          value={fields.whenToUse}
          onChange={(event) => setField("whenToUse", event.currentTarget.value)}
        />
        <Textarea
          aria-label={t("workflowPacketArtifacts")}
          label={t("workflowPacketArtifacts")}
          description={t("workflowPacketArtifactsHelp")}
          placeholder={t("emptyUsesDefaultArtifacts")}
          autosize
          minRows={3}
          value={fields.packetArtifacts}
          onChange={(event) => setField("packetArtifacts", event.currentTarget.value)}
        />
        <Textarea
          aria-label={t("workflowQualityGates")}
          label={t("workflowQualityGates")}
          description={t("workflowQualityGatesHelp")}
          placeholder={t("oneItemPerLine")}
          autosize
          minRows={3}
          value={fields.qualityGates}
          onChange={(event) => setField("qualityGates", event.currentTarget.value)}
        />
      </SimpleGrid>
    </Stack>
  );
}

export function PresetManualFieldsForm({
  fields,
  onChange,
  workflows,
  agents,
}: {
  fields: PresetManualFields;
  onChange: (fields: PresetManualFields) => void;
  workflows: StudioCatalogWorkflow[];
  agents: StudioCatalogAgent[];
}): ReactElement {
  const { t } = useStudioCopy();
  function setField<Key extends keyof PresetManualFields>(key: Key, value: PresetManualFields[Key]): void {
    onChange({ ...fields, [key]: value });
  }
  const workflowData = workflowSelectData(workflows);
  const agentData = catalogAgentSelectData(agents);
  const selectedWorkflow = workflows.find((workflow) => workflow.workflowId === fields.workflowId);
  const stageIds = selectedWorkflow?.stages ?? Object.keys(fields.stageAssignments);

  function setWorkflowId(workflowId: string): void {
    const workflow = workflows.find((item) => item.workflowId === workflowId);
    onChange({
      ...fields,
      workflowId,
      stageAssignments: workflow
        ? Object.fromEntries(workflow.stages.map((stageId) => [stageId, fields.stageAssignments[stageId] ?? []]))
        : {},
    });
  }

  function setStageAgents(stageId: string, value: string[]): void {
    const maxAgents = maxAgentsForStageAssignment(stageId);
    onChange({
      ...fields,
      stageAssignments: {
        ...fields.stageAssignments,
        [stageId]: limitSelection(value, maxAgents),
      },
    });
  }

  return (
    <Stack gap="sm" data-studio-section="preset-create-manual-fields">
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <TextInput
          aria-label={t("presetName")}
          label={t("presetName")}
          value={fields.name}
          onChange={(event) => setField("name", event.currentTarget.value)}
        />
        <Select
          data-studio-section="preset-workflow-select"
          aria-label={t("presetWorkflowId")}
          label={t("presetWorkflowId")}
          placeholder={t("selectWorkflow")}
          value={fields.workflowId || null}
          data={workflowData}
          searchable
          allowDeselect={false}
          nothingFoundMessage={t("noWorkflows")}
          onChange={(value) => setWorkflowId(value ?? "")}
        />
      </SimpleGrid>
      <Textarea
        aria-label={t("presetDescription")}
        label={t("presetDescription")}
        autosize
        minRows={2}
        value={fields.description}
        onChange={(event) => setField("description", event.currentTarget.value)}
      />
      <MultiSelect
        data-studio-section="preset-default-agents-select"
        aria-label={t("defaultAgents")}
        label={t("defaultAgents")}
        placeholder={t("selectAgents")}
        value={fields.defaultAgents}
        data={agentData}
        maxValues={MAX_FANOUT_AGENTS}
        searchable
        clearable
        nothingFoundMessage={t("noAgents")}
        onChange={(value) => setField("defaultAgents", limitSelection(value, MAX_FANOUT_AGENTS))}
      />
      <Stack gap="xs" data-studio-section="preset-stage-assignments">
        <Text fw={700}>{t("stageAssignments")}</Text>
        {stageIds.length > 0 ? stageIds.map((stageId) => (
          <MultiSelect
            data-studio-section={`preset-stage-${stageId}-agents-select`}
            aria-label={`${t("stageAssignments")} ${stageId}`}
            label={stageId}
            placeholder={t("selectAgents")}
            value={fields.stageAssignments[stageId] ?? []}
            data={agentData}
            maxValues={maxAgentsForStageAssignment(stageId)}
            searchable
            clearable
            nothingFoundMessage={t("noAgents")}
            key={stageId}
            onChange={(value) => setStageAgents(stageId, value)}
          />
        )) : (
          <Text size="sm" c="dimmed">{t("selectWorkflowFirst")}</Text>
        )}
      </Stack>
    </Stack>
  );
}

export function buildWorkflowTomlFromManualFields(fields: WorkflowManualFields): string {
  const stages = parseListField(fields.stages);
  const workflowName = fields.name.trim();
  const whenToUse = parseListField(fields.whenToUse);
  const packetArtifacts = parseListField(fields.packetArtifacts);
  const qualityGates = parseListField(fields.qualityGates);
  const lines = [
    "schema_version = 1",
    "workflow_recipe_version = 1",
    "compatible_packet_schema_versions = [1]",
    `name = ${tomlString(workflowName)}`,
    `stages = ${tomlArray(stages)}`,
    `description = ${tomlString(fields.description.trim())}`,
    `when_to_use = ${tomlArray(whenToUse.length > 0 ? whenToUse : [`使用 ${workflowName} 工作流。`])}`,
    `packet_artifacts = ${tomlArray(packetArtifacts.length > 0 ? packetArtifacts : defaultPacketArtifacts(stages))}`,
    `quality_gates = ${tomlArray(qualityGates.length > 0 ? qualityGates : ["完成后记录决策和风险。"])}`,
    "",
  ];
  return lines.join("\n");
}

function emptyWorkflowManualFields(): WorkflowManualFields {
  return {
    name: "",
    stages: "plan, review, decide",
    description: "",
    whenToUse: "",
    packetArtifacts: "",
    qualityGates: "",
  };
}

function workflowToManualFields(workflow: StudioCatalogWorkflow): WorkflowManualFields {
  return {
    name: workflow.name,
    stages: workflow.stages.join(", "),
    description: workflow.description ?? `${workflow.name} 工作流。`,
    whenToUse: (workflow.whenToUse ?? []).join("\n"),
    packetArtifacts: (workflow.packetArtifacts ?? []).join("\n"),
    qualityGates: (workflow.qualityGates ?? []).join("\n"),
  };
}

function maxAgentsForStageAssignment(stageId: string): number {
  return stageId === "execute" || stageId.startsWith("execute_")
    ? MAX_EXECUTE_AGENTS
    : MAX_FANOUT_AGENTS;
}

function limitSelection(values: string[], maxValues: number): string[] {
  return values.slice(0, maxValues);
}

export function buildPresetTomlFromManualFields(fields: PresetManualFields): string {
  const presetName = fields.name.trim();
  const defaultAgents = normalizeAgentSelection(fields.defaultAgents);
  const assignments = normalizeStageAssignments(fields.stageAssignments);
  const lines = [
    "schema_version = 1",
    `name = ${tomlString(presetName)}`,
    `workflow = ${tomlString(fields.workflowId.trim())}`,
  ];
  if (fields.description.trim().length > 0) {
    lines.push(`description = ${tomlString(fields.description.trim())}`);
  }
  if (assignments.length > 0) {
    lines.push("", "[stage_assignments]");
    for (const [nodeId, agents] of assignments) {
      lines.push(`${nodeId} = ${tomlArray(agents)}`);
    }
  }
  lines.push(
    "",
    "[default_stage_agents]",
    `agents = ${tomlArray(defaultAgents)}`,
    "",
  );
  return lines.join("\n");
}

function emptyPresetManualFields(): PresetManualFields {
  return {
    name: "",
    workflowId: "",
    description: "",
    defaultAgents: [],
    stageAssignments: {},
  };
}

function presetToManualFields(preset: StudioCatalogPreset): PresetManualFields {
  return {
    name: preset.name,
    workflowId: preset.workflowId,
    description: preset.description ?? "",
    defaultAgents: preset.defaultAgents ?? [],
    stageAssignments: preset.stageAssignments,
  };
}

function hasPresetAgentSelection(fields: PresetManualFields): boolean {
  return normalizeAgentSelection(fields.defaultAgents).length > 0
    || normalizeStageAssignments(fields.stageAssignments).some(([, agents]) => agents.length > 0);
}

function normalizeAgentSelection(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean));
  }
  return typeof value === "string" ? parseListField(value) : [];
}

function normalizeStageAssignments(value: unknown): Array<[string, string[]]> {
  if (typeof value === "string") {
    return parseStageAssignmentLines(value);
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value)
    .map(([stageId, agents]) => [stageId, normalizeAgentSelection(agents)] as [string, string[]])
    .filter(([stageId, agents]) => stageId.trim().length > 0 && agents.length > 0);
}

function workflowSelectData(workflows: StudioCatalogWorkflow[]): Array<{ value: string; label: string }> {
  return workflows.map((workflow) => ({
    value: workflow.workflowId,
    label: `${workflow.name} · ${workflow.workflowId}`,
  }));
}

function catalogAgentSelectData(agents: StudioCatalogAgent[]): Array<{ value: string; label: string }> {
  return agents.map((agent) => ({
    value: agent.id,
    label: agentDisplayName(agent),
  }));
}

function parseListField(value: string): string[] {
  return uniqueStrings(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean));
}

function parseStageAssignmentLines(value: string): Array<[string, string[]]> {
  const assignments: Array<[string, string[]]> = [];
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const separatorIndex = firstAssignmentSeparator(trimmed);
    if (separatorIndex === -1) {
      continue;
    }
    const nodeId = trimmed.slice(0, separatorIndex).trim();
    const agents = parseListField(trimmed.slice(separatorIndex + 1));
    if (nodeId && agents.length > 0) {
      assignments.push([nodeId, agents]);
    }
  }
  return assignments;
}

function firstAssignmentSeparator(value: string): number {
  const equalsIndex = value.indexOf("=");
  const colonIndex = value.indexOf(":");
  if (equalsIndex === -1) {
    return colonIndex;
  }
  if (colonIndex === -1) {
    return equalsIndex;
  }
  return Math.min(equalsIndex, colonIndex);
}

const CANONICAL_STAGE_ARTIFACTS: Record<string, string> = {
  plan: "plan.md",
  execute: "handoff.md",
  verify: "verification.md",
  review: "findings.md",
  decide: "decision.md",
};

function defaultPacketArtifacts(stages: string[]): string[] {
  return uniqueStrings([
    "request.md",
    ...stages.map((stage) => CANONICAL_STAGE_ARTIFACTS[stage]).filter(isString),
  ]);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function sourceNameFromId(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return `${slug || fallback}.toml`;
}

function formatPresetLifecycleOperation(operation: StudioPresetLifecycleOperation): string {
  return [
    `$ ${operation.command.join(" ")}`,
    `status: ${operation.status}`,
    `exit_code: ${operation.exit_code ?? "n/a"}`,
    operation.preset_id ? `preset_id: ${operation.preset_id}` : "",
    operation.stdout ? `\nstdout:\n${operation.stdout.trimEnd()}` : "",
    operation.stderr ? `\nstderr:\n${operation.stderr.trimEnd()}` : "",
  ].filter(Boolean).join("\n");
}

function formatWorkflowLifecycleOperation(operation: StudioWorkflowLifecycleOperation): string {
  return [
    `$ ${operation.command.join(" ")}`,
    `status: ${operation.status}`,
    `exit_code: ${operation.exit_code ?? "n/a"}`,
    operation.workflow_id ? `workflow_id: ${operation.workflow_id}` : "",
    operation.stdout ? `\nstdout:\n${operation.stdout.trimEnd()}` : "",
    operation.stderr ? `\nstderr:\n${operation.stderr.trimEnd()}` : "",
  ].filter(Boolean).join("\n");
}

function catalogTabCount(
  tabId: CatalogTabId,
  agentCount: number,
  workflowCount: number,
  presetCount: number,
  mcpCount: number,
): number {
  switch (tabId) {
    case "agents":
      return agentCount;
    case "workflows":
      return workflowCount;
    case "presets":
      return presetCount;
    case "mcp":
      return mcpCount;
  }
}

function catalogStatus(
  agentCount: number,
  workflowCount: number,
  presetCount: number,
  mcpCount: number,
  diagnosticCount: number,
  t: (key: StudioCopyKey) => string,
): string {
  return diagnosticCount > 0
    ? `${diagnosticCount} ${t("diagnosticCount")}`
    : [
      resourceCount(agentCount, t("agents")),
      resourceCount(workflowCount, t("workflows")),
      resourceCount(presetCount, t("presets")),
      resourceCount(mcpCount, "MCP"),
    ].join(" · ");
}

interface AgentLifecycleCardControls {
  lifecycleAgent?: StudioAgentSummary;
  busyAction: string | null;
  onAgentAction: (action: "delete" | "enable" | "disable", agentId: string) => Promise<void>;
  onAgentEdit: (agent: AgentEditableSummary) => void;
}

function renderAgent(
  agent: StudioCatalogAgent,
  controls: AgentLifecycleCardControls | undefined,
  t: (key: StudioCopyKey) => string,
): ReactElement {
  const lifecycleAgent = controls?.lifecycleAgent;
  const editableAgent: AgentEditableSummary = lifecycleAgent
    ? {
        ...agent,
        ...lifecycleAgent,
      }
    : agent;
  const disabled = lifecycleAgent?.disabled ?? agent.disabled ?? false;
  const status = lifecycleAgent?.status ?? agent.status ?? (disabled ? "disabled" : undefined);
  const displayName = agentDisplayName(editableAgent);
  const details = agentToolModelLabel(editableAgent);

  return (
    <Card className="studio-resource-card" key={agent.id} withBorder radius="md" p="md">
      <Group justify="space-between" align="flex-start" gap="md">
        <Stack gap={3} miw={0}>
          <Text fw={800} truncate="end">{displayName}</Text>
          <Text size="sm" c="dimmed">{details}</Text>
          <Text size="sm">{agent.capabilities.join(", ") || "no capabilities"}</Text>
        </Stack>
        <Stack gap="xs" align="flex-end">
          <Group gap={4} justify="flex-end">
            {status ? <Badge size="sm" color={status === "disabled" ? "gray" : "green"}>{agentStatusLabel(status, t)}</Badge> : null}
          </Group>
          {controls ? (
            <Group gap="xs" justify="flex-end">
              <Button
                size="xs"
                variant="light"
                type="button"
                data-agent-action="edit"
                disabled={controls.busyAction !== null}
                onClick={() => controls.onAgentEdit(editableAgent)}
              >
                {t("edit")}
              </Button>
              <Button
                size="xs"
                variant="light"
                type="button"
                data-agent-action={disabled ? "enable" : "disable"}
                disabled={controls.busyAction !== null}
                onClick={() => void controls.onAgentAction(disabled ? "enable" : "disable", agent.id)}
              >
                {disabled ? t("reEnable") : t("disable")}
              </Button>
              <Button
                size="xs"
                color="red"
                variant="light"
                type="button"
                data-agent-action="delete"
                disabled={controls.busyAction !== null}
                onClick={() => void controls.onAgentAction("delete", agent.id)}
              >
                {t("delete")}
              </Button>
            </Group>
          ) : null}
        </Stack>
      </Group>
    </Card>
  );
}

function agentDisplayName(agent: { id: string; label?: string }): string {
  const label = agent.label?.trim();
  return label && label !== agent.id ? label : agent.id;
}

function agentToolModelLabel(agent: { adapter: string; model?: string }): string {
  return [agent.adapter, agent.model].filter(isString).join(" · ");
}

function renderMcpServer(server: StudioCatalogMcpServer): ReactElement {
  return (
    <Card className="studio-resource-card" key={server.id} withBorder radius="md" p="md">
      <Group justify="space-between" align="flex-start" gap="md">
        <Stack gap={3} miw={0}>
          <Text fw={800} truncate="end">{server.id}</Text>
          <Text size="sm" c="dimmed">{server.command}</Text>
        </Stack>
        <CatalogBadges values={server.resource_hints} />
      </Group>
    </Card>
  );
}

function renderPreset(
  preset: StudioCatalogPreset,
  controls?: {
    onPresetEdit?: (preset: StudioCatalogPreset) => void;
    onPresetDelete?: (preset: StudioCatalogPreset) => void;
  },
  t?: (key: StudioCopyKey) => string,
): ReactElement {
  const badges = preset.validationWarnings.length > 0
    ? [`warnings ${preset.validationWarnings.length}`]
    : [];
  const presetTitle = preset.name || preset.presetId;
  return (
    <Card className="studio-resource-card" key={preset.presetId} withBorder radius="md" p="md">
      <Group justify="space-between" align="flex-start" gap="md">
        <Stack gap={3} miw={0}>
          <Text fw={800} truncate="end">{presetTitle}</Text>
          <Text size="sm" c="dimmed">{preset.presetId} · {preset.workflowId} · {preset.source}</Text>
          <Text size="sm">{presetAssignmentSummary(preset.stageAssignments)}</Text>
        </Stack>
        <Stack gap="xs" align="flex-end">
          <CatalogBadges values={badges} />
          {controls ? (
            <Group gap="xs" justify="flex-end">
              {controls.onPresetEdit ? (
                <Button
                  size="xs"
                  variant="light"
                  type="button"
                  data-preset-action="edit"
                  onClick={() => controls.onPresetEdit?.(preset)}
                >
                  {t?.("edit") ?? "编辑"}
                </Button>
              ) : null}
              {controls.onPresetDelete && preset.source !== "builtin" ? (
                <Button
                  size="xs"
                  color="red"
                  variant="light"
                  type="button"
                  data-preset-action="delete"
                  onClick={() => controls.onPresetDelete?.(preset)}
                >
                  {t?.("delete") ?? "删除"}
                </Button>
              ) : null}
            </Group>
          ) : null}
        </Stack>
      </Group>
    </Card>
  );
}

function WorkflowGroups({
  workflows,
  onWorkflowEdit,
  onWorkflowDelete,
}: {
  workflows: StudioCatalogWorkflow[];
  onWorkflowEdit?: (workflow: StudioCatalogWorkflow) => void;
  onWorkflowDelete?: (workflow: StudioCatalogWorkflow) => void;
}): ReactElement {
  const { t } = useStudioCopy();
  const groups = [
    { key: "builtin", label: "内置", workflows: workflows.filter((workflow) => workflow.source === "builtin") },
    { key: "custom", label: "自定义", workflows: workflows.filter((workflow) => workflow.source !== "builtin") },
  ];
  const [selectedKey, setSelectedKey] = useState(groups.find((group) => group.workflows.length > 0)?.key ?? "builtin");
  const selectedPanelKey = groups.some((group) => group.key === selectedKey)
    ? selectedKey
    : groups[0].key;

  return (
    <Tabs value={selectedPanelKey} onChange={(value) => setSelectedKey(value ?? "builtin")} keepMounted={false}>
      <Tabs.List aria-label={t("workflowSources")}>
        {groups.map((group) => (
          <Tabs.Tab
            value={group.key}
            data-workflow-source={group.key}
            key={group.key}
            onKeyDown={(event) => selectRelativeTab(event, groups.map((item) => item.key), group.key, setSelectedKey)}
          >
            {group.label} · {group.workflows.length}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {groups.map((group) => (
        <Tabs.Panel value={group.key} pt="sm" key={group.key}>
          <Stack gap="sm">{group.workflows.map((workflow) => (
            <WorkflowCard
              workflow={workflow}
              onEdit={group.key === "custom" ? onWorkflowEdit : undefined}
              onDelete={group.key === "custom" ? onWorkflowDelete : undefined}
              key={workflow.workflowId}
            />
          ))}</Stack>
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

function WorkflowCard({
  workflow,
  onEdit,
  onDelete,
}: {
  workflow: StudioCatalogWorkflow;
  onEdit?: (workflow: StudioCatalogWorkflow) => void;
  onDelete?: (workflow: StudioCatalogWorkflow) => void;
}): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Card className="studio-resource-card" key={workflow.workflowId} withBorder radius="md" p="md">
      <Group justify="space-between" align="flex-start" gap="md">
        <Stack gap={3} miw={0}>
          <Text fw={800} truncate="end">{workflow.name}</Text>
          <Text size="sm" c="dimmed">{workflow.workflowId} · {workflow.source}</Text>
          <Text size="sm">{workflow.stages.join(" -> ")}</Text>
        </Stack>
        {onEdit || onDelete ? (
          <Group gap="xs" justify="flex-end">
            {onEdit ? (
              <Button
                size="xs"
                variant="light"
                type="button"
                data-workflow-action="edit"
                onClick={() => onEdit(workflow)}
              >
                {t("edit")}
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                size="xs"
                color="red"
                variant="light"
                type="button"
                data-workflow-action="delete"
                onClick={() => onDelete(workflow)}
              >
                {t("delete")}
              </Button>
            ) : null}
          </Group>
        ) : null}
      </Group>
    </Card>
  );
}

function presetAssignmentSummary(stageAssignments: Record<string, string[]>): string {
  const entries = Object.entries(stageAssignments);
  return entries.length > 0
    ? entries.map(([stage, agents]) => `${stage}: ${agents.join(", ")}`).join(" · ")
    : "no stage assignments";
}

function agentStatusLabel(status: string, t: (key: StudioCopyKey) => string): string {
  if (status === "enabled") {
    return t("enabledStatus");
  }
  if (status === "disabled") {
    return t("disabledStatus");
  }
  return status;
}

function CatalogBadges({ values }: { values: string[] }): ReactElement | null {
  return values.length > 0 ? (
    <Group gap={4} justify="flex-end">
      {values.map((value) => <Badge size="sm" variant="light" key={value}>{value}</Badge>)}
    </Group>
  ) : null;
}

function EmptyCatalogRow({ label }: { label: string }): ReactElement {
  return <Alert variant="light" color="gray">{label}</Alert>;
}

function PanelHeader({ title, meta }: { title: string; meta: string }): ReactElement {
  return (
    <Group justify="space-between" align="flex-start" gap="md">
      <Title order={2} size="h3">{title}</Title>
      <Text size="sm" c="dimmed" fw={700}>{meta}</Text>
    </Group>
  );
}

function DeleteConfirmationModal({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: DeleteConfirmationTarget | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Modal
      opened={target !== null}
      onClose={() => {
        if (!busy) {
          onCancel();
        }
      }}
      title={t("confirmDelete")}
      centered
      data-studio-section="delete-confirmation-modal"
    >
      <Stack gap="md">
        <Text>
          {target ? `${t("confirmDelete")} ${target.kind}：${target.label}` : t("confirmDelete")}
        </Text>
        <Text size="sm" c="dimmed">{t("deleteWarning")}</Text>
        <Group justify="flex-end">
          <Button type="button" variant="light" disabled={busy} onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            color="red"
            disabled={busy}
            loading={busy}
            data-studio-section="confirm-delete-action"
            onClick={onConfirm}
          >
            {t("delete")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function isCatalogTab(value: string | null): value is CatalogTabId {
  return CATALOG_TABS.some((tab) => tab.id === value);
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resourceCount(count: number, label: string): string {
  return `${label} · ${count}`;
}

function selectRelativeTab<T extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  tabs: T[],
  currentTab: T,
  onSelect: (tab: T) => void,
): void {
  const currentIndex = tabs.indexOf(currentTab);
  if (currentIndex < 0) {
    return;
  }
  const nextIndex = relativeTabIndex(event.key, currentIndex, tabs.length);
  if (nextIndex === undefined) {
    return;
  }
  event.preventDefault();
  onSelect(tabs[nextIndex]);
}

function relativeTabIndex(
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
