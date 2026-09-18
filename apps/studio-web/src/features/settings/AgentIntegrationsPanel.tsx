import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Paper,
  Stack,
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

type SkillTargetRow = StudioIntegrationsReport["skills"]["targets"][number];

/** One entry per supported agent tool; the CLI and its Skill file are two facets of the same tool. */
interface IntegrationToolRow {
  tool: AgentMeshSkillTarget;
  label: string;
  cli?: StudioProviderCliToolReport;
  skill: SkillTargetRow & { target: AgentMeshSkillTarget };
}

const defaultTargets: AgentMeshSkillTarget[] = [
  "codex",
  "cursor",
  "antigravity",
  "opencode",
  "claude",
];

const skillTargetLabels: Record<AgentMeshSkillTarget, string> = {
  codex: "Codex",
  cursor: "Cursor",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  claude: "Claude Code",
};

export function AgentIntegrationsPanel({
  state,
  onRefreshIntegrations,
  onInstallAgentSkills,
}: AgentIntegrationsPanelProps): ReactElement {
  const { t } = useStudioCopy();
  const refreshBusyRef = useRef(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [busyTarget, setBusyTarget] = useState<AgentMeshSkillTarget | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const targetRows = state.status === "ready" ? skillTargetRows(state.report.skills.targets) : [];

  if (state.status === "loading") {
    return (
      <Alert variant="light">{t("loadingIntegrations")}</Alert>
    );
  }

  if (state.status === "error") {
    return (
      <Alert color="red" title={t("noIntegrations")} variant="light">{state.message}</Alert>
    );
  }

  const report = state.report;
  const toolRows = integrationToolRows(targetRows, report.provider_clis.tools);
  const readyCount = toolRows.filter((row) => row.cli?.found && row.skill.status === "ok").length;
  // Only tools whose CLI was found can have their Skill written, so they define the bulk action.
  const actionableRows = toolRows.filter((row) => row.cli?.found && row.skill.status !== "ok");
  const bulkLabel = actionableRows.every((row) => row.skill.status === "missing")
    ? "一键安装"
    : "一键修复";
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

  async function installSkill(target: AgentMeshSkillTarget): Promise<void> {
    setBusyTarget(target);
    try {
      await onInstallAgentSkills({ targets: [target], force: true });
      showStudioSuccess("Agent Skill 安装成功", skillTargetLabels[target] ?? target);
    } catch (error) {
      showStudioError("Agent Skill 安装失败", readableError(error, "请稍后重试"));
    } finally {
      setBusyTarget(null);
    }
  }

  async function installAllSkills(): Promise<void> {
    const targets = actionableRows.map((row) => row.tool);
    if (targets.length === 0) {
      return;
    }
    setBulkBusy(true);
    try {
      await onInstallAgentSkills({ targets, force: true });
      showStudioSuccess("Agent Skill 安装成功", targets.map((target) => skillTargetLabels[target] ?? target).join("、"));
    } catch (error) {
      showStudioError("Agent Skill 安装失败", readableError(error, "请稍后重试"));
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <Box component="section" data-studio-section="agent-integrations">
      <Card withBorder radius="md" p="md" data-studio-section="agent-integrations-tools">
        <Group justify="space-between" align="center" mb="sm">
          <Text size="xs" c="dimmed">CLI 可用后才需要安装 Agent Skill。</Text>
          <Group gap="xs" wrap="nowrap">
            <ActionIcon
              type="button"
              size={30}
              variant="light"
              loading={refreshBusy}
              disabled={refreshBusy || busyTarget !== null || bulkBusy}
              data-studio-action="refresh-agent-integrations"
              onClick={() => void refreshIntegrations(
                "环境状态已刷新",
                "环境状态刷新失败",
              )}
              title="刷新"
              aria-label="刷新"
            >
              <RefreshIcon />
            </ActionIcon>
            <Badge color={readyCount === toolRows.length ? "green" : "gray"}>
              {readyCount} / {toolRows.length}
            </Badge>
            {actionableRows.length > 0 ? (
              <Button
                size="compact-xs"
                loading={bulkBusy}
                disabled={refreshBusy || busyTarget !== null || bulkBusy}
                data-studio-action="install-all-agent-skills"
                onClick={() => void installAllSkills()}
              >
                {bulkLabel}
              </Button>
            ) : null}
          </Group>
        </Group>
        <Stack gap="sm">
          {toolRows.map((row) => (
            <IntegrationToolCard
              key={row.tool}
              row={row}
              busy={busyTarget === row.tool}
              anyBusy={busyTarget !== null || refreshBusy || bulkBusy}
              onInstallSkill={() => void installSkill(row.tool)}
              t={t}
            />
          ))}
        </Stack>
      </Card>
    </Box>
  );
}

function IntegrationToolCard({
  row,
  busy,
  anyBusy,
  onInstallSkill,
  t,
}: {
  row: IntegrationToolRow;
  busy: boolean;
  anyBusy: boolean;
  onInstallSkill: () => void;
  t: (key: StudioCopyKey) => string;
}): ReactElement {
  const cli = row.cli;
  const cliFound = cli?.found === true;
  const skillOk = row.skill.status === "ok";
  return (
    <Paper withBorder radius="md" p="sm" data-studio-section={`agent-tool-${row.tool}`}>
      <Group justify="space-between" align="flex-start" gap="md" wrap="nowrap" mb="xs">
        <Stack gap={2} miw={0}>
          <Text size="sm" fw={800}>{row.label}</Text>
          {cli ? <Text size="xs" c="dimmed">{cli.adapter} · {cli.command}</Text> : null}
        </Stack>
        {cliFound ? null : <Badge color="gray">{t("targetMissing")}</Badge>}
      </Group>
      {cliFound && cli ? (
        <Stack gap={2}>
          <Fact label={t("path")} value={cli.path ?? t("targetMissing")} />
          <Fact label={t("version")} value={cli.version} />
          <Fact label={t("source")} value={providerCliSourceText(cli, t)} />
          {cli.diagnostic ? <Text size="xs" c="dimmed">{cli.diagnostic}</Text> : null}
        </Stack>
      ) : (
        <Text size="xs" c="dimmed">
          {cli?.diagnostic ?? "未检测到该 CLI，安装并确认它在 PATH 中可执行后再刷新。"}
        </Text>
      )}
      <Divider my="xs" />
      <Group justify="space-between" align="center" gap="md" wrap="nowrap">
        <Stack gap={2} miw={0} style={{ flex: 1 }}>
          <Text size="xs" fw={800} c={cliFound ? undefined : "dimmed"}>{t("agentSkill")}</Text>
          <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
            {row.skill.expected_path || row.skill.hint}
          </Text>
          {cliFound && manualSkillHint(row.skill.status) ? (
            <Text size="xs" c="red">{manualSkillHint(row.skill.status)}</Text>
          ) : null}
        </Stack>
        <Group gap="xs" wrap="nowrap">
          <Badge
            color={cliFound ? skillTargetColorFor(row.skill.status) : "gray"}
            variant={cliFound ? "filled" : "light"}
          >
            {skillTargetStatusLabel(row.skill.status)}
          </Badge>
          {cliFound && !skillOk ? (
            <Button size="compact-xs" loading={busy} disabled={anyBusy} onClick={onInstallSkill}>
              {row.skill.status === "missing" ? "安装" : "修复"}
            </Button>
          ) : null}
        </Group>
      </Group>
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

/** Build a unified row per supported tool, matching skill target + its CLI provider if found. */
function integrationToolRows(
  skillTargets: SkillTargetRow[],
  providerClis: StudioProviderCliToolReport[],
): IntegrationToolRow[] {
  const cliByTool = new Map(providerClis.map((cli) => [cli.tool, cli]));
  return skillTargetRows(skillTargets).map((skill) => ({
    tool: skill.target,
    label: skillTargetLabels[skill.target] ?? skill.target,
    cli: cliByTool.get(skill.target),
    skill,
  }));
}

/** Only surface a hint when the install button cannot resolve the problem by itself. */
function manualSkillHint(status: SkillTargetRow["status"]): string | undefined {
  if (status === "unreadable") {
    return "无法读取该文件，请检查文件与上级目录的权限。";
  }
  if (status === "failed") {
    return "安装失败，请查看运行日志或改用命令行安装。";
  }
  return undefined;
}

function skillTargetColorFor(status: SkillTargetRow["status"]): string {
  switch (status) {
    case "ok":
      return "green";
    case "missing":
      return "gray";
    case "content_mismatch":
      return "yellow";
    default:
      return "red";
  }
}

function skillTargetRows(rows: SkillTargetRow[]): Array<SkillTargetRow & { target: AgentMeshSkillTarget }> {
  return defaultTargets.map((target) => {
    const row = rows.find((item) => item.target === target);
    return row
      ? { ...row, target }
      : { target, expected_path: "", status: "missing" as const, ok: false, expected: true };
  });
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

function Fact({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <Group justify="space-between" gap="md" wrap="nowrap">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="sm" fw={700} ta="right">{value}</Text>
    </Group>
  );
}
