import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  List,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { ReactElement } from "react";
import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import { formatLocalDateTime } from "../../app/time.js";
import type { StudioCompatibilityDiagnostics } from "../../api/compatibility.js";
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
  | { status: "ready"; report: StudioUpdateReport };

export interface SettingsAboutPanelProps {
  state: SettingsAboutState;
  onRefreshUpdate?: () => void;
}

export function SettingsAboutPanel({ state, onRefreshUpdate }: SettingsAboutPanelProps): ReactElement {
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
  const metadata = compatibility.metadata;
  const decisionLabel = compatibilityDecisionLabel(compatibility.decision, t);
  const decisionDescription = compatibilityDecisionDescription(compatibility);
  const reasonItems = compatibility.reasons.map(localizeCompatibilityReason);
  return (
    <Paper component="section" className="studio-panel" data-studio-section="settings-about" withBorder radius="md" p="lg">
      <PanelHeader title={t("about")} meta={t("versionInfo")} />
      <Card mt="md" withBorder radius="md" p="md">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start" gap="sm">
            <Badge color={compatibility.decision === "read_write" ? "green" : "yellow"}>{decisionLabel}</Badge>
            <Text size="sm" c="dimmed">{decisionDescription}</Text>
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
            <InfoItem label={t("runtimeVersion")} value={compatibility.current_runtime_version} />
            <InfoItem label={t("currentEntrypoint")} value={entrypointLabel(compatibility.current_entrypoint)} />
            <InfoItem label={t("compatibilityFile")} value={compatibility.compatibility_path} />
            <InfoItem label={t("metadataState")} value={metadataStateLabel(compatibility.metadata_state)} />
            <InfoItem label={t("packetSchemaVersion")} value={metadata?.packet_schema_version ?? missingMetadataValue(compatibility)} />
            <InfoItem label={t("minReadRuntimeVersion")} value={metadata?.min_read_runtime_version ?? missingMetadataValue(compatibility)} />
            <InfoItem label={t("minWriteRuntimeVersion")} value={metadata?.min_write_runtime_version ?? missingMetadataValue(compatibility)} />
            <InfoItem label={t("lastWriter")} value={metadata
              ? `${entrypointLabel(metadata.last_writer_entrypoint)} · 运行时 ${metadata.last_writer_runtime_version}`
              : "尚未生成兼容性元数据"} />
            <InfoItem label={t("lastUpdatedAt")} value={metadata ? formatLocalDateTime(metadata.updated_at) : missingMetadataValue(compatibility)} />
          </SimpleGrid>
          {compatibility.decision !== "read_write" ? (
            <Text size="sm" c="yellow.8">{compatibility.decision === "read_only"
              ? t("upgradeBeforeMutating")
              : t("upgradeBeforeReading")}</Text>
          ) : null}
        </Stack>
      </Card>
      <UpdateCard state={state.update ?? { status: "loading" }} onRefresh={onRefreshUpdate} />
      {reasonItems.length > 0 ? (
        <Stack mt="md" gap="xs">
          <Text fw={800} mb="xs">{t("compatibilityDiagnostics")}</Text>
          <List size="sm">
            {reasonItems.map((reason) => <List.Item key={reason}>{reason}</List.Item>)}
          </List>
        </Stack>
      ) : null}
    </Paper>
  );
}

function UpdateCard({
  state,
  onRefresh,
}: {
  state: SettingsAboutUpdateState;
  onRefresh?: () => void;
}): ReactElement {
  if (state.status === "loading") {
    return (
      <Card mt="md" withBorder radius="md" p="md" data-studio-section="settings-update">
        <PanelHeader
          title="版本更新"
          meta="检查中"
          action={<UpdateRefreshButton onRefresh={onRefresh} disabled />}
        />
        <Alert mt="md" variant="light">正在检查 AgentMesh 最新版本。</Alert>
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <Card mt="md" withBorder radius="md" p="md" data-studio-section="settings-update">
        <PanelHeader
          title="版本更新"
          meta="暂时无法检查"
          action={<UpdateRefreshButton onRefresh={onRefresh} />}
        />
        <Alert mt="md" color="yellow" variant="light">{updateErrorMessage(state.message)}</Alert>
      </Card>
    );
  }
  const report = state.report;
  return (
    <Card mt="md" withBorder radius="md" p="md" data-studio-section="settings-update">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" gap="sm">
          <PanelHeader
            title="版本更新"
            meta={report.update_available ? "发现新版本" : "已是最新"}
            action={<UpdateRefreshButton onRefresh={onRefresh} />}
          />
          <Badge color={report.update_available ? "blue" : "green"}>{report.update_available ? "可更新" : "当前版本"}</Badge>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
          <InfoItem label="当前版本" value={report.current_version} />
          <InfoItem label="最新版本" value={report.latest_version} />
          <InfoItem label="CLI 更新" value={updateTargetLabel(report.cli)} />
          <InfoItem label="桌面端更新" value={updateTargetLabel(report.desktop)} />
        </SimpleGrid>
        {report.cli.install_command ? (
          <InfoItem label="CLI 更新命令" value={report.cli.install_command.join(" ")} />
        ) : null}
        {report.desktop.asset_name && report.desktop.asset_url ? (
          <InfoItem label="桌面端下载" value={`${report.desktop.asset_name} · ${report.desktop.asset_url}`} />
        ) : null}
      </Stack>
    </Card>
  );
}

function UpdateRefreshButton({
  onRefresh,
  disabled = false,
}: {
  onRefresh?: () => void;
  disabled?: boolean;
}): ReactElement | null {
  if (!onRefresh) {
    return null;
  }
  return (
    <Button size="xs" variant="light" onClick={onRefresh} disabled={disabled}>
      重新检查
    </Button>
  );
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

function missingMetadataValue(compatibility: StudioCompatibilityDiagnostics): string {
  if (compatibility.metadata_state === "missing_legacy") {
    return "尚未生成（旧工作区首次成功写入后补齐）";
  }
  return "未记录（兼容性元数据不可用）";
}

function InfoItem({ label, value }: { label: string; value: string | number }): ReactElement {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" fw={800}>{label}</Text>
      <Text size="sm" fw={700} style={{ overflowWrap: "anywhere" }}>{value}</Text>
    </Stack>
  );
}

function compatibilityDecisionLabel(
  decision: StudioCompatibilityDiagnostics["decision"],
  t: (key: StudioCopyKey) => string,
): string {
  return {
    read_write: t("readWrite"),
    read_only: t("readOnly"),
    refused: t("refused"),
  }[decision];
}

function compatibilityDecisionDescription(
  compatibility: StudioCompatibilityDiagnostics,
): string {
  if (compatibility.decision === "read_only") {
    return "当前版本可以读取这个工作区；写入前需要升级 AgentMesh。";
  }
  if (compatibility.decision === "refused") {
    return "当前版本不能安全读取或写入这个工作区；请升级 AgentMesh 后再继续。";
  }
  if (compatibility.metadata_state === "missing_legacy") {
    return "当前按旧工作区兼容处理，可以读取和写入；下次成功写入会自动补齐元数据。";
  }
  return "当前版本可以读取和写入这个工作区。";
}

function entrypointLabel(entrypoint: string): string {
  const labels: Record<string, string> = {
    cli: "命令行",
    codex: "Codex",
    cursor: "Cursor",
    desktop: "桌面端",
    studio: "Web 端",
    "studio-desktop": "桌面端",
  };
  const label = labels[entrypoint] ?? entrypoint;
  return label === entrypoint ? entrypoint : `${label}（${entrypoint}）`;
}

function metadataStateLabel(state: StudioCompatibilityDiagnostics["metadata_state"]): string {
  return {
    ok: "已记录",
    missing_legacy: "旧工作区：缺少兼容性元数据",
    newer_schema: "新版本 Schema：当前版本只能只读",
    invalid: "无效：无法解析兼容性元数据",
  }[state];
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
