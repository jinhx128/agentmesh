import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  List,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import { useState, type ReactElement } from "react";
import { useStudioCopy } from "../../app/copy.js";
import { showStudioError, showStudioSuccess } from "../../app/mutation-feedback.js";
import type { StudioCompatibilityDiagnostics } from "../../api/compatibility.js";
import type { DesktopAppUpdaterState } from "../../api/desktop-updater.js";
import type { StudioIntegrationsReport } from "../../api/integrations.js";
import type { StudioUpdateReport, StudioUpdateTargetReport } from "../../api/update.js";

export type SettingsAboutState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      compatibility: StudioCompatibilityDiagnostics;
      update?: SettingsAboutUpdateState;
    };

export type SettingsAboutUpdateState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: StudioUpdateReport; refreshError?: string };

export interface SettingsAboutPanelProps {
  state: SettingsAboutState;
  refreshBusy?: boolean;
  onRefreshUpdate?: () => Promise<void>;
  commandLineTool?: {
    state: SettingsCommandLineToolState;
    onInstall: () => Promise<void>;
  };
  desktopUpdater?: {
    state: DesktopAppUpdaterState;
    refreshError?: string;
    onInstall: () => Promise<void>;
  };
  desktopAutoUpdate?: {
    state: DesktopAutoUpdatePreferenceState;
    onChange: (enabled: boolean) => Promise<void>;
  };
}

export type SettingsCommandLineToolState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      report: StudioIntegrationsReport["command_line_tool"];
      refreshError?: string;
    };

export type DesktopAutoUpdatePreferenceState =
  | { status: "loading" }
  | { status: "ready"; enabled: boolean }
  | { status: "saving"; enabled: boolean }
  | { status: "error"; enabled: boolean; message: string };

export function SettingsAboutPanel({
  state,
  refreshBusy = false,
  onRefreshUpdate,
  commandLineTool,
  desktopUpdater,
  desktopAutoUpdate,
}: SettingsAboutPanelProps): ReactElement {
  const { t } = useStudioCopy();
  if (state.status === "loading") {
    return (
      <Paper component="section" className="studio-panel" data-studio-section="settings-about" withBorder radius="md" p="lg">
        <PanelHeader title={t("about")} meta={t("versionInfo")} />
        <Alert mt="md" variant="light">{t("loadingWorkspaceStatus")}</Alert>
      </Paper>
    );
  }

  if (state.status === "error") {
    return (
      <Paper component="section" className="studio-panel" data-studio-section="settings-about" withBorder radius="md" p="lg">
        <PanelHeader title={t("about")} meta={t("versionInfo")} />
        <Alert mt="md" color="red" title={t("workspaceStatusUnavailable")} variant="light">{state.message}</Alert>
      </Paper>
    );
  }

  const compatibility = state.compatibility;
  const reasonItems = compatibility.reasons.map(localizeCompatibilityReason);
  return (
    <Paper component="section" className="studio-panel" data-studio-section="settings-about" withBorder radius="md" p="lg">
      <PanelHeader title={t("about")} meta={t("versionInfo")} />
      <VersionUpdateCard
        compatibility={compatibility}
        state={state.update ?? { status: "loading" }}
        refreshBusy={refreshBusy}
        onRefresh={onRefreshUpdate}
        commandLineTool={commandLineTool}
        desktopUpdater={desktopUpdater}
        desktopAutoUpdate={desktopAutoUpdate}
        reasonItems={reasonItems}
      />
    </Paper>
  );
}

function DesktopAutoUpdateSwitch({
  state,
  onChange,
}: NonNullable<SettingsAboutPanelProps["desktopAutoUpdate"]>): ReactElement {
  const enabled = state.status === "loading" ? true : state.enabled;
  const busy = state.status === "loading" || state.status === "saving";
  return (
    <Stack gap={4}>
      <Switch
        size="sm"
        label="自动检测桌面端更新"
        description="启动桌面应用时自动检查一次；手动检查始终可用。"
        checked={enabled}
        disabled={busy}
        onChange={(event) => void onChange(event.currentTarget.checked)}
      />
      {state.status === "error" ? (
        <Alert color="red" variant="light" role="alert">桌面更新偏好读取或保存失败：{state.message}</Alert>
      ) : null}
    </Stack>
  );
}

function desktopUpdaterLabel(state: DesktopAppUpdaterState): string {
  switch (state.status) {
    case "unavailable": return "仅桌面端可用";
    case "idle": return "尚未检查";
    case "checking": return "检查中";
    case "current": return "已是最新";
    case "update_available": return "发现新版本";
    case "downloading": return "下载并安装中";
    case "restarting": return "正在重启";
    case "error": return "更新失败";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function VersionUpdateCard({
  compatibility,
  state,
  refreshBusy,
  onRefresh,
  commandLineTool,
  desktopUpdater,
  desktopAutoUpdate,
  reasonItems,
}: {
  compatibility: StudioCompatibilityDiagnostics;
  state: SettingsAboutUpdateState;
  refreshBusy: boolean;
  onRefresh?: () => Promise<void>;
  commandLineTool?: SettingsAboutPanelProps["commandLineTool"];
  desktopUpdater?: SettingsAboutPanelProps["desktopUpdater"];
  desktopAutoUpdate?: SettingsAboutPanelProps["desktopAutoUpdate"];
  reasonItems: string[];
}): ReactElement {
  const compatibilityWarning = compatibility.decision === "read_only"
    ? "当前版本可以读取这个工作区；写入前需要升级 AgentMesh。"
    : compatibility.decision === "refused"
      ? "当前版本不能安全读取或写入这个工作区；请升级 AgentMesh 后再继续。"
      : undefined;

  return (
    <Card className="studio-subcard studio-update-card studio-version-update-card" mt="md" withBorder radius="md" p="md" data-studio-section="settings-version-update">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" gap="sm">
          <Title order={3} size="h4">版本与更新</Title>
          <UpdateRefreshButton onRefresh={onRefresh} busy={refreshBusy} />
        </Group>
        {compatibilityWarning ? <Alert color="yellow" variant="light">{compatibilityWarning}</Alert> : null}
        {reasonItems.length > 0 ? (
          <Alert color="yellow" variant="light" title="兼容性元数据">
            <Text size="sm" fw={700} mb={4}>诊断说明</Text>
            <List size="sm">
              {reasonItems.map((reason) => <List.Item key={reason}>{reason}</List.Item>)}
            </List>
          </Alert>
        ) : null}
        <CommandLineToolSection integration={commandLineTool} />
        <Divider />
        <DesktopUpdateSection
          update={state}
          updater={desktopUpdater}
          autoUpdate={desktopAutoUpdate}
        />
      </Stack>
    </Card>
  );
}

function UpdateRefreshButton({
  onRefresh,
  busy,
}: {
  onRefresh?: () => Promise<void>;
  busy: boolean;
}): ReactElement | null {
  if (!onRefresh) {
    return null;
  }
  return (
    <Button size="xs" variant="light" onClick={() => void onRefresh()} loading={busy} disabled={busy}>
      {busy ? "检查中" : "重新检查"}
    </Button>
  );
}

function CommandLineToolSection({
  integration,
}: {
  integration?: SettingsAboutPanelProps["commandLineTool"];
}): ReactElement {
  const { t } = useStudioCopy();
  const [busy, setBusy] = useState(false);
  const state = integration?.state ?? { status: "loading" as const };
  const report = state.status === "ready" ? state.report : undefined;
  async function install(): Promise<void> {
    if (!integration) return;
    setBusy(true);
    try {
      await integration.onInstall();
      showStudioSuccess("命令行工具安装成功");
    } catch (error) {
      showStudioError("命令行工具安装失败", readableError(error, "请稍后重试"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Box component="section" className="studio-version-component" data-studio-section="settings-command-line-tool">
      <Group justify="space-between" align="flex-start" gap="md" mb="sm">
        <Box>
          <Text fw={800}>AgentMesh CLI</Text>
          <Text size="xs" c="dimmed">终端中的 AgentMesh 命令行工具</Text>
        </Box>
        <Badge color={commandLineStatusColor(state)}>{commandLineStateLabel(state)}</Badge>
      </Group>
      {state.status === "loading" ? <Alert variant="light">正在检测命令行工具。</Alert> : null}
      {state.status === "error" ? <Alert color="red" variant="light">{state.message}</Alert> : null}
      {state.status === "ready" && report ? (
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            <InfoItem label={t("installedVersion")} value={report.installed_version || t("targetMissing")} />
            <InfoItem label={t("latestVersion")} value={report.latest_version || t("targetMissing")} />
            <InfoItem label={t("commandLinePath")} value={report.path ?? t("targetMissing")} />
          </SimpleGrid>
          {state.refreshError ? <Alert color="yellow" variant="light">命令行工具状态刷新失败：{state.refreshError}</Alert> : null}
          {report.diagnostics.map((diagnostic, index) => (
            <Alert key={`${diagnostic}-${index}`} color="yellow" variant="light">{diagnostic}</Alert>
          ))}
          <Group justify="flex-end">
            <Button size="xs" loading={busy} disabled={!report.supported || busy} onClick={() => void install()}>
              {commandLineActionLabel(report.status)}
            </Button>
          </Group>
        </Stack>
      ) : null}
    </Box>
  );
}

function DesktopUpdateSection({
  update,
  updater,
  autoUpdate,
}: {
  update: SettingsAboutUpdateState;
  updater?: SettingsAboutPanelProps["desktopUpdater"];
  autoUpdate?: SettingsAboutPanelProps["desktopAutoUpdate"];
}): ReactElement {
  const nativeState = updater?.state ?? { status: "unavailable" as const };
  const report = update.status === "ready" ? update.report : undefined;
  const currentVersion = nativeState.status === "update_available" ? nativeState.currentVersion : report?.current_version ?? "暂不可用";
  const latestVersion = nativeState.status === "update_available" ? nativeState.version : report?.latest_version ?? "暂不可用";
  const progress = nativeState.status === "downloading" && nativeState.totalBytes
    ? Math.min(100, Math.round((nativeState.downloadedBytes / nativeState.totalBytes) * 100))
    : undefined;
  const downloading = nativeState.status === "downloading" || nativeState.status === "restarting";
  return (
    <Box component="section" className="studio-version-component" data-studio-section="settings-desktop-app">
      <Group justify="space-between" align="flex-start" gap="md" mb="sm">
        <Box>
          <Text fw={800}>桌面应用</Text>
          <Text size="xs" c="dimmed">AgentMesh.app 与原生更新</Text>
        </Box>
        <Badge color={desktopStatusColor(nativeState, report)}>{desktopStatusLabel(nativeState, report)}</Badge>
      </Group>
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <InfoItem label="当前应用版本" value={currentVersion} />
          <InfoItem label="最新应用版本" value={latestVersion} />
        </SimpleGrid>
        {update.status === "loading" ? <Alert variant="light">正在检查发布版本。</Alert> : null}
        {update.status === "error" ? <Alert color="red" variant="light" title="发布版本暂时无法检查">{updateErrorMessage(update.message)}</Alert> : null}
        {update.status === "ready" && update.refreshError ? <Alert color="yellow" variant="light">发布版本刷新失败：{updateErrorMessage(update.refreshError)}</Alert> : null}
        {nativeState.status === "update_available" && nativeState.notes ? <Text size="sm">{nativeState.notes}</Text> : null}
        {nativeState.status === "downloading" ? (
          <Text size="sm" role="status" aria-live="polite">已下载 {formatBytes(nativeState.downloadedBytes)}{nativeState.totalBytes
            ? ` / ${formatBytes(nativeState.totalBytes)}${progress === undefined ? "" : ` (${progress}%)`}`
            : ""}</Text>
        ) : null}
        {nativeState.status === "error" ? <Alert color="red" variant="light" role="alert">{nativeState.message}</Alert> : null}
        {updater?.refreshError ? <Alert color="yellow" variant="light">桌面应用状态刷新失败：{updater.refreshError}</Alert> : null}
        {autoUpdate ? <DesktopAutoUpdateSwitch {...autoUpdate} /> : null}
        {nativeState.status === "update_available" && updater ? (
          <Group justify="flex-end">
            <Button size="xs" disabled={downloading} onClick={() => void updater.onInstall()}>安装并重启</Button>
          </Group>
        ) : null}
      </Stack>
    </Box>
  );
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function commandLineActionLabel(status: StudioIntegrationsReport["command_line_tool"]["status"]): string {
  if (status === "missing") return "安装命令行工具";
  if (status === "update_available") return "更新命令行工具";
  return "重新安装命令行工具";
}

function commandLineStateLabel(state: SettingsCommandLineToolState): string {
  if (state.status === "loading") return "检测中";
  if (state.status === "error") return "检测失败";
  switch (state.report.status) {
    case "current": return "已是最新";
    case "update_available": return "可更新";
    case "missing": return "未安装";
    case "unknown": return "状态未知";
  }
}

function commandLineStatusColor(state: SettingsCommandLineToolState): string {
  if (state.status === "error") return "red";
  if (state.status !== "ready") return "blue";
  if (state.report.status === "current") return "green";
  if (state.report.status === "update_available") return "yellow";
  return "gray";
}

function desktopStatusLabel(
  state: DesktopAppUpdaterState,
  report: StudioUpdateReport | undefined,
): string {
  if (state.status === "unavailable" && report) return updateTargetLabel(report.desktop);
  return desktopUpdaterLabel(state);
}

function desktopStatusColor(
  state: DesktopAppUpdaterState,
  report: StudioUpdateReport | undefined,
): string {
  if (state.status === "error") return "red";
  if (state.status === "current") return "green";
  if (state.status === "unavailable" && report?.desktop.status === "current") return "green";
  if (state.status === "update_available" || report?.desktop.status.includes("update_available")) return "yellow";
  return "blue";
}

function updateErrorMessage(message: string): string {
  if (/403|429|rate limit/i.test(message)) {
    return "GitHub 更新检查请求受限，请稍后重新检查；本机 AgentMesh 可以继续使用。";
  }
  return message;
}

function updateTargetLabel(target: StudioUpdateTargetReport): string {
  if (target.status === "current") {
    return "已是最新";
  }
  if (target.status === "update_available") {
    return target.asset_name ? `可更新：${target.asset_name}` : "可更新";
  }
  if (target.status === "manual_update_available") {
    return target.asset_name ? `手动安装：${target.asset_name}` : "手动安装";
  }
  return target.reason ?? "发布资产缺失";
}

function InfoItem({ label, value }: { label: string; value: string | number }): ReactElement {
  return (
    <Stack className="studio-info-item" gap={2}>
      <Text size="xs" c="dimmed" fw={800}>{label}</Text>
      <Text size="sm" fw={700} style={{ overflowWrap: "anywhere" }}>{value}</Text>
    </Stack>
  );
}

function localizeCompatibilityReason(reason: string): string {
  const missingMetadataReason = "compatibility metadata is missing; treating workspace as legacy readable until the next successful mutation backfills it";
  if (reason === missingMetadataReason) {
    return "当前按旧工作区可读写处理，下次成功写入后会自动补齐兼容性元数据。";
  }
  const schemaMatch = /^compatibility metadata schema_version (.+) is newer than supported version (.+)$/.exec(reason);
  if (schemaMatch) {
    return `兼容性元数据 schema 版本 ${schemaMatch[1]} 高于当前支持版本 ${schemaMatch[2]}。`;
  }
  const packetSchemaMatch = /^packet_schema_version (.+) is not supported by runtime (.+)$/.exec(reason);
  if (packetSchemaMatch) {
    return `Packet schema 版本 ${packetSchemaMatch[1]} 不受当前运行时 ${packetSchemaMatch[2]} 支持。`;
  }
  const minReadMatch = /^min_read_runtime_version (.+) is newer than current runtime (.+)$/.exec(reason);
  if (minReadMatch) {
    return `最低读取版本 ${minReadMatch[1]} 高于当前运行时 ${minReadMatch[2]}。`;
  }
  const minWriteMatch = /^min_write_runtime_version (.+) is newer than current runtime (.+)$/.exec(reason);
  if (minWriteMatch) {
    return `最低写入版本 ${minWriteMatch[1]} 高于当前运行时 ${minWriteMatch[2]}。`;
  }
  return `原始诊断：${reason}`;
}

function PanelHeader({
  title,
  meta,
  action,
}: {
  title: string;
  meta: string;
  action?: ReactElement | null;
}): ReactElement {
  return (
    <Group justify="space-between" align="flex-start" gap="md">
      <Title order={2} size="h3">{title}</Title>
      <Group gap="xs" justify="flex-end">
        {action}
        <Text size="sm" c="dimmed" fw={700}>{meta}</Text>
      </Group>
    </Group>
  );
}
