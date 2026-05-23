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
  TextInput,
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
  onInstallCommandLineTool: (request: {
    bin_dir: string;
    confirm_existing: boolean;
  }) => Promise<void>;
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
  "copilot",
  "claude",
];

export function AgentIntegrationsPanel({
  state,
  onInstallCommandLineTool,
  onInstallAgentSkills,
}: AgentIntegrationsPanelProps): ReactElement {
  const { t } = useStudioCopy();
  const [binDir, setBinDir] = useState("");
  const [confirmExisting, setConfirmExisting] = useState(false);
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
  const effectiveBinDir = binDir || commandLine.default_bin_dir;
  const effectiveTargetPath = `${effectiveBinDir.replace(/\/+$/, "")}/agentmesh`;
  const customBinDir = effectiveBinDir !== commandLine.default_bin_dir;
  const confirmationRequired = commandLine.requires_confirmation || customBinDir;
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
  const confirmationReason = commandConfirmationReason(commandLine, customBinDir, t);

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
        <Tabs.List grow>
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
              <Badge color={commandLine.path_command.found ? "green" : "gray"}>
                {commandLine.path_command.found ? commandLine.path_command.source : t("targetMissing")}
              </Badge>
            </Group>
            <Stack gap={4} mb="md">
              <Fact label={t("commandLinePath")} value={commandLine.path_command.path ?? t("targetMissing")} />
              <Fact label={t("version")} value={commandLine.path_command.version} />
              <Fact label={t("installTarget")} value={customBinDir ? effectiveTargetPath : commandLine.target_path} />
              <Fact label={t("targetFile")} value={customBinDir ? t("targetCheckedDuringInstall") : targetFileText(commandLine.target_file, t)} />
            </Stack>
            {confirmationReason ? <Alert color="yellow" variant="light" mb="sm">{confirmationReason}</Alert> : null}
            <TextInput
              label={t("binDirectory")}
              value={effectiveBinDir}
              onChange={(event) => setBinDir(event.target.value)}
            />
            <Checkbox
              mt="sm"
              checked={confirmExisting}
              label={t("confirmReplacement")}
              onChange={(event) => setConfirmExisting(event.target.checked)}
            />
            <Button
              mt="sm"
              type="button"
              disabled={!commandLine.supported || (confirmationRequired && !confirmExisting)}
              onClick={() => void onInstallCommandLineTool({
                bin_dir: effectiveBinDir,
                confirm_existing: confirmExisting,
              })}
            >
              {t("commandLineInstall")}
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
  if ("installed" in result) {
    return `${t("installed")} ${result.installed.path}`;
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

function commandConfirmationReason(
  commandLine: StudioIntegrationsReport["command_line_tool"],
  customBinDir: boolean,
  t: (key: StudioCopyKey) => string,
): string | undefined {
  if (commandLine.requires_confirmation) {
    if (commandLine.path_command.found && commandLine.path_command.path !== commandLine.target_path) {
      return `${t("commandLineShadowWarning")}: ${commandLine.path_command.path}`;
    }
    if (commandLine.target_file.exists && commandLine.target_file.different) {
      return `${t("installTargetDifferent")}: ${commandLine.target_path}`;
    }
  }
  if (customBinDir) {
    return t("customBinConfirmWarning");
  }
  return undefined;
}

function targetFileText(
  targetFile: StudioIntegrationsReport["command_line_tool"]["target_file"],
  t: (key: StudioCopyKey) => string,
): string {
  if (!targetFile.exists) {
    return t("targetMissing");
  }
  return `${targetFile.source} - ${targetFile.different ? t("different") : t("targetCurrent")} - ${targetFile.version}`;
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
