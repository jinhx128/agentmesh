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
import { useState, type ReactElement } from "react";
import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import type {
  AgentMeshSkillTarget,
  InstallAgentSkillsResponse,
  InstallCommandLineToolResponse,
  StudioProviderCliToolReport,
  StudioIntegrationsReport,
} from "../../api/integrations.js";

export type AgentIntegrationsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      report: StudioIntegrationsReport;
      commandResult?: InstallCommandLineToolResponse | { error: string };
      skillResult?: InstallAgentSkillsResponse | { error: string };
    };

export interface AgentIntegrationsPanelProps {
  state: AgentIntegrationsState;
  onInstallCommandLineTool: () => Promise<void>;
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
  onInstallCommandLineTool,
  onInstallAgentSkills,
}: AgentIntegrationsPanelProps): ReactElement {
  const { t } = useStudioCopy();
  const [commandBusy, setCommandBusy] = useState(false);
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
  const commandLine = report.command_line_tool;
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
  const commandResultText = resultText(state.commandResult, t);
  const skillResultText = resultText(state.skillResult, t);

  return (
    <Paper component="section" className="studio-panel" data-studio-section="agent-integrations" withBorder radius="md" p="lg">
      <PanelHeader title={t("environment")} />
      <Tabs
        defaultValue="command-line"
        keepMounted
        keepMountedMode="display-none"
        mt="md"
        data-studio-section="agent-integrations-tabs"
      >
        <Tabs.List grow aria-label={t("environment")}>
          <Tabs.Tab value="command-line" data-studio-section="agent-integrations-command-tab">
            {t("commandLineTool")}
          </Tabs.Tab>
          <Tabs.Tab value="skills" data-studio-section="agent-integrations-skill-tab">
            {t("agentSkill")}
          </Tabs.Tab>
          <Tabs.Tab value="cli-diagnostics" data-studio-section="agent-integrations-cli-tab">
            {t("cliDiagnostics")}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="command-line" pt="md" data-studio-section="agent-integrations-command-panel">
          <Card withBorder radius="md" p="md">
            <Group justify="space-between" align="flex-start" mb="sm">
              <Title order={3} size="h4">{t("commandLineTool")}</Title>
              <Badge color={commandLine.status === "current" ? "green" : commandLine.status === "update_available" ? "yellow" : "gray"}>
                {commandStatusLabel(commandLine.status)}
              </Badge>
            </Group>
            <Stack gap={4} mb="md">
              <Fact label={t("commandLinePath")} value={commandLine.path ?? t("targetMissing")} />
              <Fact label={t("installedVersion")} value={commandLine.installed_version} />
              <Fact label={t("latestVersion")} value={commandLine.latest_version} />
              <Fact label={t("source")} value={commandLine.source} />
            </Stack>
            {commandLine.diagnostics.map((diagnostic, diagnosticIndex) => (
              <Alert key={`${diagnostic}-${diagnosticIndex}`} color="yellow" variant="light" mb="sm">{diagnostic}</Alert>
            ))}
            <Button
              mt="sm"
              type="button"
              loading={commandBusy}
              disabled={!commandLine.supported}
              onClick={() => {
                setCommandBusy(true);
                void onInstallCommandLineTool().finally(() => setCommandBusy(false));
              }}
            >
              {t(commandActionKey(commandLine.status))}
            </Button>
            {commandResultText ? <Alert mt="sm" variant="light">{commandResultText}</Alert> : null}
          </Card>
        </Tabs.Panel>
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
                      <Code>{target.status}</Code>
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
              disabled={selectedTargets.length === 0}
              onClick={() => void onInstallAgentSkills({
                targets: selectedTargets,
                force: forceSkill,
              })}
            >
              {t("installSelectedSkills")}
            </Button>
            {skillResultText ? <Alert mt="sm" variant="light">{skillResultText}</Alert> : null}
          </Card>
        </Tabs.Panel>
        <Tabs.Panel value="cli-diagnostics" pt="md" data-studio-section="agent-integrations-cli-panel">
          <Card withBorder radius="md" p="md">
            <Group justify="space-between" align="flex-start" mb="sm">
              <Title order={3} size="h4">{t("cliDiagnostics")}</Title>
              <Badge>{providerCliRows.filter((tool) => tool.found).length}/{providerCliRows.length}</Badge>
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

function resultText(
  result: InstallCommandLineToolResponse | InstallAgentSkillsResponse | { error: string } | undefined,
  t: (key: StudioCopyKey) => string,
): string | undefined {
  if (!result) {
    return undefined;
  }
  if ("error" in result) {
    return result.error;
  }
  if ("operation" in result) {
    return `${t("installed")} ${result.command_line_tool.installed_version}`;
  }
  const installedCount = result.installed_targets.filter((target) => target.ok).length;
  const failedTargets = result.installed_targets
    .filter((target) => !target.ok)
    .map((target) => target.target);
  if (failedTargets.length > 0) {
    return `${t("installedTargets")} ${installedCount}; failed: ${failedTargets.join(", ")}`;
  }
  return `${t("installedTargets")} ${installedCount}`;
}

function commandActionKey(
  status: StudioIntegrationsReport["command_line_tool"]["status"],
): StudioCopyKey {
  if (status === "missing") {
    return "commandLineInstall";
  }
  if (status === "update_available") {
    return "commandLineUpdate";
  }
  return "commandLineReinstall";
}

function commandStatusLabel(
  status: StudioIntegrationsReport["command_line_tool"]["status"],
): string {
  switch (status) {
    case "current": return "已是最新";
    case "update_available": return "可更新";
    case "missing": return "未安装";
    case "unknown": return "状态未知";
  }
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
