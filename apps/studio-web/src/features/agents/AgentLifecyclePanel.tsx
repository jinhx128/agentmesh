import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Modal,
  MultiSelect,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import { workflowStageLabel } from "../../app/stages.js";
import type {
  StudioAgentCreateRequest,
  StudioAgentLifecycleOperation,
  StudioAgentLifecycleSubmit,
  StudioAgentModelListPayload,
  StudioAgentSummary,
  StudioAgentUpdateRequest,
} from "../../api/agents.js";

export type AgentToolId =
  | "antigravity-cli"
  | "codex-cli"
  | "claude-code-cli"
  | "cursor-agent"
  | "opencode-cli";

export interface AgentToolOption {
  id: AgentToolId;
  label: string;
  supportsReasoning: boolean;
}

export const AGENT_TOOLS: AgentToolOption[] = [
  {
    id: "codex-cli",
    label: "Codex CLI",
    supportsReasoning: true,
  },
  {
    id: "claude-code-cli",
    label: "Claude Code CLI",
    supportsReasoning: true,
  },
  {
    id: "cursor-agent",
    label: "Cursor Agent",
    supportsReasoning: false,
  },
  {
    id: "antigravity-cli",
    label: "Antigravity CLI",
    supportsReasoning: false,
  },
  {
    id: "opencode-cli",
    label: "OpenCode CLI",
    supportsReasoning: true,
  },
];

const REASONING_EFFORT_OPTIONS = ["none", "minimal", "low", "medium", "high", "xhigh"];
const AGENT_CAPABILITY_OPTIONS = ["plan", "execute", "verify", "review", "decide"];
const ANTIGRAVITY_CURRENT_MODEL = "current";

type ModelSelectStatus = "idle" | "loading" | "ready" | "empty";
type AgentModelOptionCacheEntry = {
  status: ModelSelectStatus;
  options: string[];
};
type AgentModelOptionCache = Record<AgentToolId, AgentModelOptionCacheEntry>;

export type AgentLifecycleState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      agents: StudioAgentSummary[];
      lastOperation?: StudioAgentLifecycleOperation;
    };

export interface AgentLifecyclePanelProps {
  state: AgentLifecycleState;
  embedded?: boolean;
  onCreateAgent: (request: StudioAgentCreateRequest) => Promise<void>;
  onAgentAction: (request: StudioAgentLifecycleSubmit) => Promise<void>;
  onLoadAgentModels: (adapter: string) => Promise<StudioAgentModelListPayload>;
}

export function AgentLifecyclePanel({
  state,
  embedded = false,
  onCreateAgent,
  onAgentAction,
  onLoadAgentModels,
}: AgentLifecyclePanelProps): ReactElement {
  const { t } = useStudioCopy();
  const [toolId, setToolId] = useState<AgentToolId>("codex-cli");
  const toolIdRef = useRef<AgentToolId>(toolId);
  const loadAgentModelsRef = useRef(onLoadAgentModels);
  const [model, setModel] = useState("");
  const [createModelCache, setCreateModelCache] = useState<AgentModelOptionCache>(() => emptyAgentModelOptionCache("idle"));
  const [reasoningEffort, setReasoningEffort] = useState("high");
  const [agentName, setAgentName] = useState(suggestAgentLabel("codex-cli", ""));
  const [agentNameTouched, setAgentNameTouched] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<StudioAgentSummary | null>(null);
  const [deleteConfirmationAgent, setDeleteConfirmationAgent] = useState<StudioAgentSummary | null>(null);
  const selectedTool = agentToolById(toolId);
  const createModelEntry = modelOptionCacheEntry(createModelCache, toolId);
  const createToolData = agentToolSelectData(toolId, createModelCache);
  const createModelData = agentModelSelectData(toolId, createModelEntry.options, model);
  const createModelPlaceholder = modelSelectPlaceholder(createModelEntry.status, createModelData, t);
  const createToolDisabled = areAllToolOptionsDisabled(createToolData);
  const createModelDisabled = isModelSelectDisabled(createModelEntry, createModelData);
  const suggestedAgentLabel = suggestAgentLabel(toolId, model);
  const submittedAgentName = agentName.trim() || suggestedAgentLabel;
  const canCreate = !createModelDisabled && model.trim().length > 0;

  useEffect(() => {
    toolIdRef.current = toolId;
  }, [toolId]);

  useEffect(() => {
    loadAgentModelsRef.current = onLoadAgentModels;
  }, [onLoadAgentModels]);

  useEffect(() => {
    if (!createModalOpen) {
      return;
    }
    let active = true;
    setCreateModelCache(emptyAgentModelOptionCache("loading"));
    void loadAgentModelOptionCache((adapter) => loadAgentModelsRef.current(adapter))
      .then((nextCache) => {
        if (!active) {
          return;
        }
        setCreateModelCache(nextCache);
        setModel((current) => {
          const nextModel = firstModelForTool(nextCache, toolIdRef.current);
          return current.trim().length > 0 && toolIdRef.current !== "antigravity-cli"
            ? current
            : nextModel;
        });
      })
      .catch(() => {
        if (active) {
          setCreateModelCache(emptyAgentModelOptionCache("empty"));
        }
      });
    return () => {
      active = false;
    };
  }, [createModalOpen]);

  function changeTool(value: string | null): void {
    const nextToolId = isAgentToolId(value) ? value : "codex-cli";
    if (isToolOptionDisabled(modelOptionCacheEntry(createModelCache, nextToolId))) {
      return;
    }
    const nextModel = firstModelForTool(createModelCache, nextToolId);
    toolIdRef.current = nextToolId;
    setToolId(nextToolId);
    setModel(nextModel);
    setReasoningEffort(agentToolById(nextToolId).supportsReasoning ? "high" : "none");
    if (!agentNameTouched) {
      setAgentName(suggestAgentLabel(nextToolId, nextModel));
    }
  }

  function changeModel(value: string): void {
    setModel(value);
    if (!agentNameTouched) {
      setAgentName(suggestAgentLabel(toolId, value));
    }
  }

  function changeAgentName(value: string): void {
    setAgentName(value);
    setAgentNameTouched(value.trim().length > 0);
  }

  function resetCreateForm(): void {
    const nextToolId: AgentToolId = "codex-cli";
    setToolId(nextToolId);
    setModel("");
    setCreateModelCache(emptyAgentModelOptionCache("idle"));
    setReasoningEffort("high");
    setAgentName(suggestAgentLabel(nextToolId, ""));
    setAgentNameTouched(false);
  }

  async function createAgent(): Promise<void> {
    if (!canCreate) {
      return;
    }
    const request: StudioAgentCreateRequest = {
      adapter: toolId,
      model: model.trim(),
      label: submittedAgentName,
      reasoning_effort: selectedTool.supportsReasoning ? reasoningEffort : "none",
    };
    setBusyAction("create");
    try {
      await onCreateAgent(request);
      resetCreateForm();
      setCreateModalOpen(false);
    } finally {
      setBusyAction(null);
    }
  }

  async function agentAction(action: "delete" | "enable" | "disable", id: string): Promise<void> {
    setBusyAction(`${action}:${id}`);
    try {
      await onAgentAction({ action, agentId: id });
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmDeleteAgent(): Promise<void> {
    if (!deleteConfirmationAgent) {
      return;
    }
    await agentAction("delete", deleteConfirmationAgent.id);
    setDeleteConfirmationAgent(null);
  }

  async function updateAgent(agentId: string, request: StudioAgentUpdateRequest): Promise<void> {
    setBusyAction(`edit:${agentId}`);
    try {
      await onAgentAction({ action: "update", agentId, request });
      setEditingAgent(null);
    } finally {
      setBusyAction(null);
    }
  }

  const agents = state.status === "ready" ? state.agents : [];
  const showAgentList = !embedded;
  const content = (
    <>
      {embedded ? null : (
        <PanelHeader title="Agent Lifecycle" meta={state.status === "ready" ? `${t("agents")} · ${agents.length}` : state.status} />
      )}
      {state.status === "error" ? (
        <Alert mt="md" color="red" variant="light">{state.message}</Alert>
      ) : null}
      <Group mt={embedded ? 0 : "md"} justify="flex-end" data-studio-section="agent-create-entry">
        <Button
          type="button"
          data-studio-section="agent-create-open"
          onClick={() => setCreateModalOpen(true)}
        >
          {t("createAgent")}
        </Button>
      </Group>
      <Modal
        opened={createModalOpen}
        onClose={() => {
          if (busyAction !== "create") {
            setCreateModalOpen(false);
          }
        }}
        title={t("createAgent")}
        centered
        size="lg"
        data-studio-section="agent-create-modal"
      >
        <Stack gap="sm">
          <Select
            aria-label={t("tool")}
            label={t("tool")}
            value={toolId}
            data={createToolData}
            disabled={createToolDisabled}
            allowDeselect={false}
            onChange={changeTool}
          />
          <div className={selectedTool.supportsReasoning ? "agent-create-field-grid" : "agent-create-field-grid single"}>
            <Select
              aria-label={t("model")}
              label={t("model")}
              placeholder={createModelPlaceholder}
              value={model}
              data={createModelData}
              disabled={createModelDisabled}
              nothingFoundMessage={t("noModelsFound")}
              allowDeselect={false}
              onChange={(value) => changeModel(value ?? model)}
            />
            {selectedTool.supportsReasoning ? (
              <Select
                aria-label={t("reasoningEffort")}
                label={t("reasoningEffort")}
                value={reasoningEffort}
                data={REASONING_EFFORT_OPTIONS}
                allowDeselect={false}
                onChange={(value) => setReasoningEffort(value ?? "high")}
              />
            ) : null}
          </div>
          <TextInput
            data-studio-section="agent-create-name-field"
            aria-label={t("agentName")}
            label={t("agentName")}
            placeholder={suggestedAgentLabel}
            value={agentName}
            onChange={(event) => changeAgentName(event.currentTarget.value)}
          />
          <Button type="button" disabled={busyAction !== null || !canCreate} onClick={() => void createAgent()}>
            {t("createAgent")}
          </Button>
        </Stack>
      </Modal>
      <AgentEditModal
        opened={editingAgent !== null}
        agent={editingAgent}
        busy={busyAction !== null}
        onClose={() => {
          if (busyAction === null) {
            setEditingAgent(null);
          }
        }}
        onSubmit={updateAgent}
        onLoadAgentModels={onLoadAgentModels}
      />
      <AgentDeleteConfirmationModal
        agent={deleteConfirmationAgent}
        busy={busyAction !== null}
        onCancel={() => setDeleteConfirmationAgent(null)}
        onConfirm={() => void confirmDeleteAgent()}
      />
      {showAgentList ? (
        <Stack mt="md" gap="sm">
          {state.status === "loading" ? <Alert variant="light">{t("loadingAgents")}</Alert> : null}
          {state.status === "ready" && agents.length === 0 ? <Alert variant="light">{t("noAgents")}</Alert> : null}
          {agents.map((agent) => {
            const displayName = agentDisplayName(agent);
            const details = agentToolModelLabel(agent);
            return (
              <Card withBorder radius="md" p="md" key={agent.id}>
                <Group justify="space-between" align="flex-start" gap="md">
                  <Stack gap={3} miw={0}>
                    <Group gap="xs">
                      <Text fw={800}>{displayName}</Text>
                      <Badge color={agent.disabled ? "gray" : "green"}>{agentStatusLabel(agent.status, t)}</Badge>
                    </Group>
                    <Text size="sm" c="dimmed">{details}</Text>
                    <Text size="xs" c="dimmed">
                      {agent.capabilities.map(workflowStageLabel).join(", ") || "no capabilities"}
                    </Text>
                  </Stack>
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="light"
                      type="button"
                      data-agent-action="edit"
                      disabled={busyAction !== null}
                      onClick={() => setEditingAgent(agent)}
                    >
                      {t("edit")}
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      type="button"
                      data-agent-action={agent.disabled ? "enable" : "disable"}
                      disabled={busyAction !== null}
                      onClick={() => void agentAction(agent.disabled ? "enable" : "disable", agent.id)}
                    >
                      {agent.disabled ? t("reEnable") : t("disable")}
                    </Button>
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      type="button"
                      data-agent-action="delete"
                      disabled={busyAction !== null}
                      onClick={() => setDeleteConfirmationAgent(agent)}
                    >
                      {t("delete")}
                    </Button>
                  </Group>
                </Group>
              </Card>
            );
          })}
        </Stack>
      ) : null}
      {state.status === "ready" && state.lastOperation ? (
        <Code block className="studio-code-block" mt="md">{formatAgentLifecycleOperation(state.lastOperation)}</Code>
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <Stack data-studio-section="react-agent-lifecycle" gap={0}>
        {content}
      </Stack>
    );
  }

  return (
    <Paper component="section" className="studio-panel" data-studio-section="react-agent-lifecycle" withBorder radius="md" p="lg">
      {content}
    </Paper>
  );
}

export interface AgentEditableSummary {
  id: string;
  label?: string;
  adapter: string;
  capabilities: string[];
  model?: string;
  reasoning_effort?: string;
  source_layer?: string;
}

function AgentDeleteConfirmationModal({
  agent,
  busy,
  onCancel,
  onConfirm,
}: {
  agent: AgentEditableSummary | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Modal
      opened={agent !== null}
      onClose={() => {
        if (!busy) {
          onCancel();
        }
      }}
      title={t("confirmDelete")}
      centered
      data-studio-section="agent-delete-confirmation-modal"
    >
      <Stack gap="md">
        <Text>{agent ? `${t("confirmDelete")} Agent：${agentDisplayName(agent)}` : t("confirmDelete")}</Text>
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

export function AgentEditModal({
  opened,
  agent,
  busy,
  onClose,
  onSubmit,
  onLoadAgentModels,
}: {
  opened: boolean;
  agent: AgentEditableSummary | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (agentId: string, request: StudioAgentUpdateRequest) => Promise<void>;
  onLoadAgentModels: (adapter: string) => Promise<StudioAgentModelListPayload>;
}): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("editAgent")}
      centered
      size="lg"
      data-studio-section="agent-edit-modal"
    >
      <AgentEditForm agent={agent} busy={busy} onSubmit={onSubmit} onLoadAgentModels={onLoadAgentModels} />
    </Modal>
  );
}

export function AgentEditForm({
  agent,
  busy,
  onSubmit,
  onLoadAgentModels,
}: {
  agent: AgentEditableSummary | null;
  busy: boolean;
  onSubmit: (agentId: string, request: StudioAgentUpdateRequest) => Promise<void>;
  onLoadAgentModels: (adapter: string) => Promise<StudioAgentModelListPayload>;
}): ReactElement {
  const { t } = useStudioCopy();
  const [label, setLabel] = useState(() => agent?.label ?? "");
  const [adapter, setAdapter] = useState(() => agent?.adapter ?? "");
  const adapterRef = useRef(adapter);
  const loadAgentModelsRef = useRef(onLoadAgentModels);
  const [model, setModel] = useState(() => agent?.model ?? "");
  const [modelCache, setModelCache] = useState<AgentModelOptionCache>(() => emptyAgentModelOptionCache("idle"));
  const [reasoningEffort, setReasoningEffort] = useState(() => agent?.reasoning_effort ?? "");
  const [capabilities, setCapabilities] = useState<string[]>(() => agent?.capabilities ?? []);

  useEffect(() => {
    adapterRef.current = adapter;
  }, [adapter]);

  useEffect(() => {
    loadAgentModelsRef.current = onLoadAgentModels;
  }, [onLoadAgentModels]);

  useEffect(() => {
    if (!agent) {
      return;
    }
    setLabel(agent.label ?? "");
    adapterRef.current = agent.adapter;
    setAdapter(agent.adapter);
    setModel(agent.model ?? "");
    setModelCache(emptyAgentModelOptionCache("idle"));
    setReasoningEffort(agent.reasoning_effort ?? "");
    setCapabilities(agent.capabilities);
  }, [
    agent?.id,
    agent?.label,
    agent?.adapter,
    agent?.model,
    agent?.reasoning_effort,
    agent?.capabilities.join(","),
  ]);

  useEffect(() => {
    if (!agent) {
      return;
    }
    let active = true;
    setModelCache(emptyAgentModelOptionCache("loading"));
    void loadAgentModelOptionCache((adapter) => loadAgentModelsRef.current(adapter))
      .then((nextCache) => {
        if (!active) {
          return;
        }
        setModelCache(nextCache);
        setModel((current) => {
          const nextModel = firstModelForTool(nextCache, adapterRef.current);
          return current.trim().length > 0 && adapterRef.current !== "antigravity-cli"
            ? current
            : nextModel;
        });
      })
      .catch(() => {
        if (active) {
          setModelCache(emptyAgentModelOptionCache("empty"));
        }
      });
    return () => {
      active = false;
    };
  }, [agent?.id]);

  const selectedTool = agentToolForAdapter(adapter);
  const modelEntry = modelOptionCacheEntry(modelCache, adapter);
  const toolData = agentToolSelectData(adapter, modelCache);
  const modelData = agentModelSelectData(adapter, modelEntry.options, model);
  const modelPlaceholder = modelSelectPlaceholder(modelEntry.status, modelData, t);
  const toolDisabled = areAllToolOptionsDisabled(toolData);
  const modelDisabled = isModelSelectDisabled(modelEntry, modelData);
  const capabilityData = capabilitySelectData(capabilities);
  const canSubmit = agent !== null
    && adapter.length > 0
    && !modelDisabled
    && model.trim().length > 0;

  function changeAdapter(value: string | null): void {
    const nextAdapter = value ?? adapter;
    if (isToolOptionDisabled(modelOptionCacheEntry(modelCache, nextAdapter))) {
      return;
    }
    adapterRef.current = nextAdapter;
    setAdapter(nextAdapter);
    const nextTool = AGENT_TOOLS.find((tool) => tool.id === nextAdapter);
    if (!nextTool) {
      return;
    }
    setModel(firstModelForTool(modelCache, nextTool.id));
    setReasoningEffort((current) => (
      nextTool.supportsReasoning
        ? (current.trim().length > 0 && current !== "none" ? current : "high")
        : "none"
    ));
  }

  async function submit(): Promise<void> {
    if (!agent || !canSubmit) {
      return;
    }
    await onSubmit(agent.id, {
      adapter,
      model: model.trim(),
      label: label.trim() || undefined,
      capabilities,
      reasoning_effort: selectedTool.supportsReasoning
        ? (reasoningEffort.trim() || "high")
        : "none",
    });
  }

  return (
    <Stack gap="sm">
      <div data-studio-section="agent-edit-id-field">
        <Group gap="sm" align="center" data-studio-section="agent-edit-id-line">
          <Text fw={800}>{t("agentId")}</Text>
          <Text c="dimmed">{agent?.id ?? ""}</Text>
        </Group>
      </div>
      <TextInput
        data-studio-section="agent-edit-name-field"
        aria-label={t("agentName")}
        label={t("agentName")}
        value={label}
        onChange={(event) => setLabel(event.currentTarget.value)}
      />
      <div className="agent-create-field-grid">
        <Select
          data-studio-section="agent-edit-tool-select"
          aria-label={t("tool")}
          label={t("tool")}
          value={adapter}
          data={toolData}
          disabled={toolDisabled}
          allowDeselect={false}
          onChange={changeAdapter}
        />
        <Select
          data-studio-section="agent-edit-model-select"
          aria-label={t("model")}
          label={t("model")}
          placeholder={modelPlaceholder}
          value={model}
          data={modelData}
          disabled={modelDisabled}
          nothingFoundMessage={t("noModelsFound")}
          allowDeselect={false}
          onChange={(value) => setModel(value ?? model)}
        />
      </div>
      {selectedTool.supportsReasoning ? (
        <Select
          data-studio-section="agent-edit-reasoning-select"
          aria-label={t("reasoningEffort")}
          label={t("reasoningEffort")}
          value={reasoningEffort.trim() || "high"}
          data={REASONING_EFFORT_OPTIONS}
          allowDeselect={false}
          onChange={(value) => setReasoningEffort(value ?? "high")}
        />
      ) : null}
      <MultiSelect
        data-studio-section="agent-edit-capabilities-select"
        aria-label={t("capabilities")}
        label={t("capabilities")}
        value={capabilities}
        data={capabilityData}
        clearable
        onChange={setCapabilities}
      />
      <Button type="button" disabled={busy || !canSubmit} onClick={() => void submit()}>
        {t("saveChanges")}
      </Button>
    </Stack>
  );
}

export function formatAgentLifecycleOperation(operation: StudioAgentLifecycleOperation): string {
  return [
    `$ ${operation.command.join(" ")}`,
    `status: ${operation.status}`,
    `exit_code: ${operation.exit_code ?? "n/a"}`,
    operation.stdout ? `\nstdout:\n${operation.stdout.trimEnd()}` : "",
    operation.stderr ? `\nstderr:\n${operation.stderr.trimEnd()}` : "",
  ].filter(Boolean).join("\n");
}

function agentToolSelectData(
  currentAdapter: string,
  modelCache?: AgentModelOptionCache,
): Array<{ value: string; label: string; disabled?: boolean }> {
  const options = AGENT_TOOLS.map((tool) => {
    const entry = modelCache ? modelOptionCacheEntry(modelCache, tool.id) : undefined;
    return {
      value: tool.id,
      label: tool.label,
      ...(entry && isToolOptionDisabled(entry) ? { disabled: true } : {}),
    };
  });
  return currentAdapter && !AGENT_TOOLS.some((tool) => tool.id === currentAdapter)
    ? [...options, { value: currentAdapter, label: currentAdapter }]
    : options;
}

function agentModelSelectData(
  adapter: string,
  modelOptions: string[],
  currentModel: string,
): Array<{ value: string; label: string }> {
  const values = uniqueValues(
    adapter !== "antigravity-cli" && currentModel.trim().length > 0
      ? [...modelOptions, currentModel]
      : modelOptions,
  );
  return values.map((value) => ({ value, label: value }));
}

function modelOptionsFromPayload(payload: StudioAgentModelListPayload): string[] {
  const discoveredModels = payload.status === "discovered" ? payload.models.filter(Boolean) : [];
  if (payload.adapter_id === "antigravity-cli") {
    return discoveredModels.length > 0 ? [ANTIGRAVITY_CURRENT_MODEL] : [];
  }
  return uniqueValues(discoveredModels);
}

export async function loadAgentModelOptionCache(
  onLoadAgentModels: (adapter: string) => Promise<StudioAgentModelListPayload>,
  toolIds: AgentToolId[] = AGENT_TOOLS.map((tool) => tool.id),
): Promise<AgentModelOptionCache> {
  const cache = emptyAgentModelOptionCache("idle");
  await Promise.all(toolIds.map(async (toolId) => {
    try {
      const options = modelOptionsFromPayload(await onLoadAgentModels(toolId));
      cache[toolId] = {
        status: options.length > 0 ? "ready" : "empty",
        options,
      };
    } catch {
      cache[toolId] = {
        status: "empty",
        options: [],
      };
    }
  }));
  return cache;
}

function emptyAgentModelOptionCache(status: ModelSelectStatus): AgentModelOptionCache {
  return AGENT_TOOLS.reduce((cache, tool) => ({
    ...cache,
    [tool.id]: {
      status,
      options: [],
    },
  }), {} as AgentModelOptionCache);
}

function modelOptionCacheEntry(
  cache: AgentModelOptionCache,
  adapter: string,
): AgentModelOptionCacheEntry {
  return isAgentToolId(adapter) ? cache[adapter] : { status: "empty", options: [] };
}

function firstModelForTool(cache: AgentModelOptionCache, adapter: string): string {
  return modelOptionCacheEntry(cache, adapter).options[0] ?? "";
}

function isModelSelectDisabled(
  entry: AgentModelOptionCacheEntry,
  data: Array<{ value: string; label: string }>,
): boolean {
  return entry.status !== "ready" || data.length === 0;
}

function isToolOptionDisabled(entry: AgentModelOptionCacheEntry): boolean {
  return entry.status !== "ready" || entry.options.length === 0;
}

function areAllToolOptionsDisabled(data: Array<{ disabled?: boolean }>): boolean {
  return data.length === 0 || data.every((option) => option.disabled === true);
}

function modelSelectPlaceholder(
  status: ModelSelectStatus,
  data: Array<{ value: string; label: string }>,
  t: (key: StudioCopyKey) => string,
): string {
  if (status === "loading" && data.length === 0) {
    return t("loadingModels");
  }
  if (data.length === 0) {
    return t("noModelsFound");
  }
  return t("selectModel");
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function capabilitySelectData(currentCapabilities: string[]): Array<{ value: string; label: string }> {
  const values = new Set([...AGENT_CAPABILITY_OPTIONS, ...currentCapabilities]);
  return Array.from(values, (value) => ({ value, label: workflowStageLabel(value) }));
}

function agentToolById(toolId: AgentToolId): AgentToolOption {
  return AGENT_TOOLS.find((tool) => tool.id === toolId) ?? AGENT_TOOLS[0];
}

function agentToolForAdapter(adapter: string): AgentToolOption {
  return AGENT_TOOLS.find((tool) => tool.id === adapter) ?? {
    id: "cursor-agent",
    label: adapter,
    supportsReasoning: false,
  };
}

function isAgentToolId(value: string | null): value is AgentToolId {
  return AGENT_TOOLS.some((tool) => tool.id === value);
}

export function suggestAgentLabel(toolId: AgentToolId, model: string): string {
  return `${agentToolDisplayName(toolId)} ${modelDisplayName(model)}`.trim();
}

function agentToolDisplayName(toolId: AgentToolId): string {
  switch (toolId) {
    case "antigravity-cli":
      return "Antigravity";
    case "codex-cli":
      return "Codex";
    case "claude-code-cli":
      return "Claude";
    case "cursor-agent":
      return "Cursor";
    case "opencode-cli":
      return "OpenCode";
  }
}

function modelDisplayName(model: string): string {
  const segment = model.split("/").filter(Boolean).at(-1) ?? model;
  return segment
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => modelDisplayNamePart(part))
    .join(" ");
}

function modelDisplayNamePart(part: string): string {
  if (/^(gpt|glm|mimo)$/i.test(part)) {
    return part.toUpperCase();
  }
  if (/^v\d+/i.test(part)) {
    return part.toUpperCase();
  }
  return `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`;
}

function agentDisplayName(agent: { id: string; label?: string }): string {
  const label = agent.label?.trim();
  return label && label !== agent.id ? label : agent.id;
}

function agentToolModelLabel(agent: { adapter: string; model?: string }): string {
  return [agent.adapter, agent.model].filter((value): value is string => typeof value === "string" && value.length > 0).join(" · ");
}

function PanelHeader({ title, meta }: { title: string; meta: string }): ReactElement {
  return (
    <Group justify="space-between" align="flex-start" gap="md">
      <Title order={2} size="h3">{title}</Title>
      <Text size="sm" c="dimmed" fw={700}>{meta}</Text>
    </Group>
  );
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
