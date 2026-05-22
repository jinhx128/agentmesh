import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Group,
  MultiSelect,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useEffect, useState, type ReactElement } from "react";
import { useStudioCopy } from "../../app/copy.js";
import type {
  StudioAdvancedSettingsPayload,
  StudioAdvancedSettingsUpdateRequest,
  StudioDefaultStageAgentsConfig,
  StudioStageType,
} from "../../api/advanced-settings.js";
import type {
  StudioAgentSummary,
} from "../../api/agents.js";

const MAX_FANOUT_AGENTS = 6;
const MAX_EXECUTE_AGENTS = 1;
const MAX_FALLBACK_AGENTS = 3;
const STAGE_TYPES: StudioStageType[] = ["plan", "execute", "verify", "review", "decide"];
const ALLOW_AUTO_DISPATCH_HELP = "开启后，Studio 可以自动分发满足执行策略的阶段；关闭后需要手动触发分发。";
const REQUIRE_USER_GATE_HELP = "开启后，推进关键步骤前需要用户确认；关闭后按当前执行策略继续运行。";
type StageDefaultAgentFields = Record<StudioStageType, string[]>;

export type AdvancedSettingsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; settings: StudioAdvancedSettingsPayload };

export interface AdvancedSettingsPanelProps {
  state: AdvancedSettingsState;
  agents: StudioAgentSummary[];
  onSaveAdvancedSettings: (request: StudioAdvancedSettingsUpdateRequest) => Promise<StudioAdvancedSettingsPayload>;
}

export function AdvancedSettingsPanel({
  state,
  agents,
  onSaveAdvancedSettings,
}: AdvancedSettingsPanelProps): ReactElement {
  const { t } = useStudioCopy();
  const initialFormSettings = state.status === "ready" ? state.settings.resolved : undefined;
  const [defaultAgents, setDefaultAgents] = useState<string[]>(() => initialFormSettings?.default_stage_agents.agents ?? []);
  const [stageDefaultAgents, setStageDefaultAgents] = useState<StageDefaultAgentFields>(() =>
    stageDefaultAgentsFromConfig(initialFormSettings?.default_stage_agents),
  );
  const [fallbackAgents, setFallbackAgents] = useState<string[]>(() => initialFormSettings?.fallback.agents ?? []);
  const [fallbackAttempts, setFallbackAttempts] = useState(() => numberText(initialFormSettings?.fallback.max_attempts_per_agent));
  const [fallbackTimeout, setFallbackTimeout] = useState(() => numberText(initialFormSettings?.fallback.timeout_seconds));
  const [retryAttempts, setRetryAttempts] = useState(() => numberText(initialFormSettings?.run_defaults.retry_attempts));
  const [adapterTimeout, setAdapterTimeout] = useState(() => numberText(initialFormSettings?.run_defaults.adapter_timeout_secs));
  const [allowAutoDispatch, setAllowAutoDispatch] = useState(() => initialFormSettings?.execution_policy.allow_auto_dispatch ?? false);
  const [requireUserGate, setRequireUserGate] = useState(() => initialFormSettings?.execution_policy.require_user_gate ?? false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const settings = state.status === "ready" ? state.settings : undefined;

  useEffect(() => {
    if (!settings) {
      return;
    }
    const formSettings = settings.resolved;
    setDefaultAgents(formSettings.default_stage_agents.agents ?? []);
    setStageDefaultAgents(stageDefaultAgentsFromConfig(formSettings.default_stage_agents));
    setFallbackAgents(formSettings.fallback.agents ?? []);
    setFallbackAttempts(numberText(formSettings.fallback.max_attempts_per_agent));
    setFallbackTimeout(numberText(formSettings.fallback.timeout_seconds));
    setRetryAttempts(numberText(formSettings.run_defaults.retry_attempts));
    setAdapterTimeout(numberText(formSettings.run_defaults.adapter_timeout_secs));
    setAllowAutoDispatch(formSettings.execution_policy.allow_auto_dispatch ?? false);
    setRequireUserGate(formSettings.execution_policy.require_user_gate ?? false);
    setSaved(false);
    setErrorMessage(undefined);
  }, [settings]);

  async function save(): Promise<void> {
    setBusy(true);
    setSaved(false);
    setErrorMessage(undefined);
    try {
      await onSaveAdvancedSettings({
        default_stage_agents: {
          agents: optionalAgentList(defaultAgents),
          stage_types: stageDefaultAgentsRequest(stageDefaultAgents),
        },
        fallback: {
          agents: optionalAgentList(fallbackAgents),
          max_attempts_per_agent: optionalInteger(fallbackAttempts),
          timeout_seconds: optionalInteger(fallbackTimeout),
        },
        run_defaults: {
          retry_attempts: optionalInteger(retryAttempts),
          adapter_timeout_secs: optionalInteger(adapterTimeout),
        },
        execution_policy: {
          allow_auto_dispatch: allowAutoDispatch,
          require_user_gate: requireUserGate,
        },
      });
      setSaved(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") {
    return (
      <Paper component="section" className="studio-panel" data-studio-section="advanced-settings" withBorder radius="md" p="lg">
        <PanelHeader title={t("advanced")} meta={t("loadingConfig")} />
        <Alert mt="md" variant="light">{t("loadingConfig")}</Alert>
      </Paper>
    );
  }

  if (state.status === "error") {
    return (
      <Paper component="section" className="studio-panel" data-studio-section="advanced-settings" withBorder radius="md" p="lg">
        <PanelHeader title={t("advanced")} meta={t("noConfig")} />
        <Alert mt="md" color="red" variant="light">{state.message}</Alert>
      </Paper>
    );
  }

  if (!settings) {
    throw new Error("advanced settings must be loaded");
  }
  const formSettings = settings.resolved;
  const agentSelectData = agentSelectOptions(
    agents,
    defaultAgents,
    ...stageDefaultAgentLists(stageDefaultAgents),
    fallbackAgents,
    state.settings.user.default_stage_agents.agents,
    ...stageTypeAgentLists(state.settings.user.default_stage_agents.stage_types),
    state.settings.user.fallback.agents,
    formSettings.default_stage_agents.agents,
    ...stageTypeAgentLists(formSettings.default_stage_agents.stage_types),
    formSettings.fallback.agents,
  );
  function setStageDefaultAgentsForStage(stage: StudioStageType, value: string[]): void {
    setStageDefaultAgents((current) => ({
      ...current,
      [stage]: limitSelection(value, maxAgentsForStageDefaults(stage)),
    }));
  }
  return (
    <Paper component="section" className="studio-panel" data-studio-section="advanced-settings" withBorder radius="md" p="lg">
      <PanelHeader title={t("advanced")} meta={t("userDefaults")} />
      <Stack mt="md" gap="md">
        {state.settings.diagnostics.map((diagnostic) => (
          <Alert color="yellow" variant="light" key={diagnostic.message}>{diagnostic.message}</Alert>
        ))}
        {errorMessage ? <Alert color="red" variant="light">{errorMessage}</Alert> : null}
        {saved ? <Alert color="green" variant="light">{t("advancedSettingsSaved")}</Alert> : null}
        <Card withBorder radius="md" p="md">
          <Stack gap={4}>
            <Text size="sm" c="dimmed">{t("userConfig")}</Text>
            <Text fw={800}>{state.settings.user_config_path}</Text>
          </Stack>
        </Card>
        <Tabs
          defaultValue="user-defaults"
          keepMounted
          keepMountedMode="display-none"
          data-studio-section="advanced-settings-tabs"
        >
          <Tabs.List grow>
            <Tabs.Tab value="user-defaults">{t("userDefaults")}</Tabs.Tab>
            <Tabs.Tab value="stage-defaults">{t("stageDefaultAgents")}</Tabs.Tab>
            <Tabs.Tab value="fallback">{t("fallbackSettings")}</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="user-defaults" pt="md">
            <Stack gap="sm" data-studio-section="advanced-user-defaults-tab">
              <Title order={3} size="h4">{t("userDefaults")}</Title>
              <MultiSelect
                data-studio-section="advanced-default-agents-select"
                label={t("defaultAgents")}
                aria-label={t("defaultAgents")}
                placeholder={t("selectAgents")}
                value={defaultAgents}
                data={agentSelectData}
                maxValues={MAX_FANOUT_AGENTS}
                searchable
                clearable
                nothingFoundMessage={t("noAgents")}
                onChange={(value) => setDefaultAgents(limitSelection(value, MAX_FANOUT_AGENTS))}
              />
              <div className="agent-create-field-grid">
                <TextInput
                  label={t("retryAttempts")}
                  aria-label={t("retryAttempts")}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={retryAttempts}
                  onChange={(event) => setRetryAttempts(sanitizeIntegerText(event.currentTarget.value))}
                />
                <TextInput
                  label={t("adapterTimeout")}
                  aria-label={t("adapterTimeout")}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={adapterTimeout}
                  onChange={(event) => setAdapterTimeout(sanitizeIntegerText(event.currentTarget.value))}
                />
              </div>
              <AdvancedSwitchRow
                label={t("allowAutoDispatch")}
                help={ALLOW_AUTO_DISPATCH_HELP}
                section="advanced-allow-auto-dispatch-help"
                checked={allowAutoDispatch}
                onChange={setAllowAutoDispatch}
              />
              <AdvancedSwitchRow
                label={t("requireUserGate")}
                help={REQUIRE_USER_GATE_HELP}
                section="advanced-require-user-gate-help"
                checked={requireUserGate}
                onChange={setRequireUserGate}
              />
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="stage-defaults" pt="md">
            <Stack gap="sm" data-studio-section="advanced-stage-defaults-tab">
              <Title order={3} size="h4">{t("stageDefaultAgents")}</Title>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                {STAGE_TYPES.map((stage) => (
                  <MultiSelect
                    data-studio-section={`advanced-stage-${stage}-default-agents-select`}
                    key={stage}
                    label={`${stage} ${t("defaultAgents")}`}
                    aria-label={`${stage} ${t("defaultAgents")}`}
                    placeholder={t("selectAgents")}
                    value={stageDefaultAgents[stage]}
                    data={agentSelectData}
                    maxValues={maxAgentsForStageDefaults(stage)}
                    searchable
                    clearable
                    nothingFoundMessage={t("noAgents")}
                    onChange={(value) => setStageDefaultAgentsForStage(stage, value)}
                  />
                ))}
              </SimpleGrid>
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="fallback" pt="md">
            <Stack gap="sm" data-studio-section="advanced-fallback-tab">
              <Title order={3} size="h4">{t("fallbackSettings")}</Title>
              <MultiSelect
                data-studio-section="advanced-fallback-agents-select"
                label={t("fallbackAgents")}
                aria-label={t("fallbackAgents")}
                placeholder={t("selectAgents")}
                value={fallbackAgents}
                data={agentSelectData}
                maxValues={MAX_FALLBACK_AGENTS}
                searchable
                clearable
                nothingFoundMessage={t("noAgents")}
                onChange={(value) => setFallbackAgents(limitSelection(value, MAX_FALLBACK_AGENTS))}
              />
              <div className="agent-create-field-grid">
                <TextInput
                  label={t("fallbackAttempts")}
                  aria-label={t("fallbackAttempts")}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={fallbackAttempts}
                  onChange={(event) => setFallbackAttempts(sanitizeIntegerText(event.currentTarget.value))}
                />
                <TextInput
                  label={t("fallbackTimeout")}
                  aria-label={t("fallbackTimeout")}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={fallbackTimeout}
                  onChange={(event) => setFallbackTimeout(sanitizeIntegerText(event.currentTarget.value))}
                />
              </div>
            </Stack>
          </Tabs.Panel>
        </Tabs>
        <Group justify="flex-end">
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {t("saveAdvancedSettings")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

function PanelHeader({ title, meta }: { title: string; meta: string }): ReactElement {
  return (
    <Group justify="space-between" align="flex-start" gap="md">
      <Title order={2} size="h3">{title}</Title>
      <Text size="sm" c="dimmed" fw={700}>{meta}</Text>
    </Group>
  );
}

interface AdvancedSwitchRowProps {
  label: string;
  help: string;
  section: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function AdvancedSwitchRow({
  label,
  help,
  section,
  checked,
  onChange,
}: AdvancedSwitchRowProps): ReactElement {
  return (
    <Group gap="sm" align="center" wrap="nowrap">
      <Switch
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <Group gap={6} align="center" wrap="nowrap">
        <Text>{label}</Text>
        <Tooltip
          label={help}
          withArrow
          multiline
          w={280}
          position="right"
          events={{ hover: true, focus: true, touch: false }}
        >
          <ActionIcon
            aria-label={`${label}说明`}
            color="gray"
            data-studio-section={section}
            radius="xl"
            size={18}
            type="button"
            variant="outline"
            style={{ fontSize: 12, lineHeight: 1 }}
          >
            ?
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}

function optionalAgentList(values: string[]): string[] | null {
  return values.length > 0 ? values : null;
}

function stageDefaultAgentsFromConfig(config: StudioDefaultStageAgentsConfig | undefined): StageDefaultAgentFields {
  return Object.fromEntries(
    STAGE_TYPES.map((stage) => [stage, config?.stage_types[stage]?.agents ?? []]),
  ) as StageDefaultAgentFields;
}

function stageDefaultAgentsRequest(
  fields: StageDefaultAgentFields,
): NonNullable<NonNullable<StudioAdvancedSettingsUpdateRequest["default_stage_agents"]>["stage_types"]> {
  return Object.fromEntries(
    STAGE_TYPES.map((stage) => [stage, { agents: optionalAgentList(fields[stage]) }]),
  );
}

function stageDefaultAgentLists(fields: StageDefaultAgentFields): string[][] {
  return STAGE_TYPES.map((stage) => fields[stage]);
}

function stageTypeAgentLists(stageTypes: StudioDefaultStageAgentsConfig["stage_types"]): string[][] {
  return STAGE_TYPES.map((stage) => stageTypes[stage]?.agents ?? []);
}

function maxAgentsForStageDefaults(stage: StudioStageType): number {
  return stage === "execute" ? MAX_EXECUTE_AGENTS : MAX_FANOUT_AGENTS;
}

function limitSelection(values: string[], maxValues: number): string[] {
  return values.slice(0, maxValues);
}

function agentSelectOptions(
  agents: StudioAgentSummary[],
  ...configuredValues: Array<string[] | undefined>
): Array<{ value: string; label: string }> {
  const labelsById = new Map<string, string>();
  for (const agent of agents) {
    labelsById.set(agent.id, agentOptionLabel(agent));
  }
  for (const values of configuredValues) {
    for (const value of values ?? []) {
      if (!labelsById.has(value)) {
        labelsById.set(value, value);
      }
    }
  }
  return Array.from(labelsById, ([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function agentOptionLabel(agent: StudioAgentSummary): string {
  const label = agent.label?.trim();
  return label && label !== agent.id ? label : agent.id;
}

function optionalInteger(value: string): number | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? Number.parseInt(trimmed, 10) : null;
}

function sanitizeIntegerText(value: string): string {
  return value.replace(/\D/g, "");
}

function numberText(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}
