import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Group,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useRef, useState, type ReactElement } from "react";
import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import { showStudioError, showStudioSuccess } from "../../app/mutation-feedback.js";
import { skillTargetStatusLabel } from "../../app/status-labels.js";
import type {
  AgentMeshSkillTarget,
  InstallAgentSkillsResponse,
  StudioProviderCliToolReport,
  StudioIntegrationsReport,
} from "../../api/integrations.js";

export type AgentIntegrationsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      report: StudioIntegrationsReport;
      skillResult?: InstallAgentSkillsResponse | { error: string };
      refreshError?: string;
    };

export interface AgentIntegrationsPanelProps {
  state: AgentIntegrationsState;
  onRefreshIntegrations: () => Promise<void>;
  onInstallAgentSkills: (request: {
    targets: AgentMeshSkillTarget[];
    force: boolean;
  }) => Promise<void>;
}

const defaultTargets: AgentMeshSkillTarget[] = [
  "codex",
  "cursor",
  "antigravity",
  "opencode",
  "claude",
];

export function AgentIntegrationsPanel({
  state,
  onRefreshIntegrations,
  onInstallAgentSkills,
}: AgentIntegrationsPanelProps): ReactElement {
  const { t } = useStudioCopy();
  const refreshBusyRef = useRef(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [skillBusy, setSkillBusy] = useState(false);
  const [forceSkill, setForceSkill] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<AgentMeshSkillTarget[]>(["codex"]);

  if (state.status === "loading") {
    return (
      <Paper component="section" className="studio-panel" data-studio-section="agent-integrations" withBorder radius="md" p="lg">
        <PanelHeader title={t("environment")} meta={t("running")} />
        <Alert mt="md" variant="light">{t("loadingIntegrations")}</Alert>
      </Paper>
    );
  }

  if (state.status === "error") {
    return (
      <Paper component="section" className="studio-panel" data-studio-section="agent-integrations" withBorder radius="md" p="lg">
        <PanelHeader title={t("environment")} meta="Error" />
        <Alert mt="md" color="red" title={t("noIntegrations")} variant="light">{state.message}</Alert>
      </Paper>
    );
  }

  const report = state.report;
  const providerCliRows = report.provider_clis.tools;
  const selectedTargetSet = new Set(selectedTargets);
  const targetRows: StudioIntegrationsReport["skills"]["targets"] = report.skills.targets.length > 0
    ? report.skills.targets
    : defaultTargets.map((target) => ({
      target,
      expected_path: "",
      status: "missing" as const,
      ok: false,
      expected: true,
    }));
  const selectedCount = selectedTargets.length;
  async function refreshIntegrations(
    successTitle: string,
    failureTitle: string,
  ): Promise<void> {
    if (refreshBusyRef.current) {
      return;
    }
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

  async function installSkills(): Promise<void> {
    setSkillBusy(true);
    try {
      await onInstallAgentSkills({ targets: selectedTargets, force: forceSkill });
      showStudioSuccess("Agent Skill 安装成功", `已处理 ${selectedTargets.length} 个目标`);
    } catch (error) {
      showStudioError("Agent Skill 安装失败", readableError(error, "请稍后重试"));
    } finally {
      setSkillBusy(false);
    }
  }

  return (
    <Paper component="section" className="studio-panel" data-studio-section="agent-integrations" withBorder radius="md" p="lg">
      <PanelHeader title={t("environment")} />
      <Tabs
        defaultValue="skills"
        keepMounted
        keepMountedMode="display-none"
        mt="md"
        data-studio-section="agent-integrations-tabs"
      >
        <Tabs.List grow aria-label={t("environment")}>
          <Tabs.Tab value="skills" data-studio-section="agent-integrations-skill-tab">
            {t("agentSkill")}
          </Tabs.Tab>
          <Tabs.Tab value="cli-diagnostics" data-studio-section="agent-integrations-cli-tab">
            {t("cliDiagnostics")}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="skills" pt="md" data-studio-section="agent-integrations-skill-panel">
          <Card withBorder radius="md" p="md">
            <Group justify="space-between" align="flex-start" mb="sm">
              <Title order={3} size="h4">{t("agentSkill")}</Title>
              <Badge>{selectedCount} {t("selectedCount")}</Badge>
            </Group>
            <Stack gap="xs">
              {targetRows.map((target) => (
                <Checkbox
                  key={target.target}
                  checked={selectedTargetSet.has(target.target)}
                  onChange={(event) => {
                    setSelectedTargets((current) =>
                      event.target.checked
                        ? [...new Set([...current, target.target])]
                        : current.filter((item) => item !== target.target),
                    );
                  }}
                  label={(
                    <Group justify="space-between" align="flex-start" gap="md" wrap="nowrap">
                      <Stack gap={2} miw={0}>
                        <Text size="sm" fw={800}>{target.target}</Text>
                        <Text size="xs" c="dimmed">{target.hint ?? target.expected_path}</Text>
                      </Stack>
                      <Code>{skillTargetStatusLabel(target.status)}</Code>
                    </Group>
                  )}
                />
              ))}
            </Stack>
            <Checkbox
              mt="sm"
              checked={forceSkill}
              label={t("refreshExistingFiles")}
              onChange={(event) => setForceSkill(event.target.checked)}
            />
            <Button
              mt="sm"
              type="button"
              loading={skillBusy}
              disabled={selectedTargets.length === 0 || skillBusy}
              onClick={() => void installSkills()}
            >
              {t("installSelectedSkills")}
            </Button>
          </Card>
        </Tabs.Panel>
        <Tabs.Panel value="cli-diagnostics" pt="md" data-studio-section="agent-integrations-cli-panel">
          <Card withBorder radius="md" p="md">
            <Group justify="space-between" align="flex-start" mb="sm">
              <Title order={3} size="h4">{t("cliDiagnostics")}</Title>
              <Group gap="xs" wrap="nowrap">
                <Button
                  type="button"
                  size="xs"
                  variant="light"
                  loading={refreshBusy}
                  disabled={refreshBusy}
                  leftSection={<RefreshIcon />}
                  data-studio-action="refresh-cli-diagnostics"
                  onClick={() => void refreshIntegrations(
                    "外部 CLI 状态已刷新",
                    "外部 CLI 状态刷新失败",
                  )}
                >
                  刷新
                </Button>
                <Badge>{providerCliRows.filter((tool) => tool.found).length}/{providerCliRows.length}</Badge>
              </Group>
            </Group>
            <Stack gap="sm">
              {providerCliRows.map((tool) => (
                <Paper
                  key={tool.tool}
                  withBorder
                  radius="md"
                  p="sm"
                  data-studio-section={`provider-cli-${tool.tool}`}
                >
                  <Group justify="space-between" align="flex-start" gap="md" mb="xs">
                    <Stack gap={2} miw={0}>
                      <Text size="sm" fw={800}>{tool.label}</Text>
                      <Text size="xs" c="dimmed">{tool.adapter} · {tool.command}</Text>
                    </Stack>
                    <Badge color={tool.found ? "green" : "gray"}>
                      {tool.found ? t("detected") : t("targetMissing")}
                    </Badge>
                  </Group>
                  <Stack gap={2}>
                    <Fact label={t("path")} value={tool.path ?? t("targetMissing")} />
                    <Fact label={t("version")} value={tool.version} />
                    <Fact label={t("source")} value={providerCliSourceText(tool, t)} />
                    {tool.diagnostic ? <Text size="xs" c="dimmed">{tool.diagnostic}</Text> : null}
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Card>
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
}

function RefreshIcon(): ReactElement {
  return (
    <svg viewBox="0 0 18 18" width="14" height="14" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M14.5 5.5V2.75m0 0h-2.75m2.75 0-2.1 2.1A5.75 5.75 0 1 0 14.1 11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;
}

function providerCliSourceText(
  tool: StudioProviderCliToolReport,
  t: (key: StudioCopyKey) => string,
): string {
  if (!tool.found) {
    return t("targetMissing");
  }
  switch (tool.source) {
    case "configured_path":
      return t("configuredPath");
    case "path":
      return t("pathSource");
    case "app_preference":
      return t("appPreference");
    case "well_known":
      return t("wellKnownPath");
    case "login_shell_probe":
      return t("loginShellProbe");
    case "missing":
      return t("targetMissing");
  }
}

function PanelHeader({ title, meta }: { title: string; meta?: string }): ReactElement {
  return (
    <Group justify="space-between" align="flex-start" gap="md">
      <Title order={2} size="h3">{title}</Title>
      {meta ? <Text size="sm" c="dimmed" fw={700}>{meta}</Text> : null}
    </Group>
  );
}

function Fact({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <Group justify="space-between" gap="md" wrap="nowrap">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="sm" fw={700} ta="right">{value}</Text>
    </Group>
  );
}
