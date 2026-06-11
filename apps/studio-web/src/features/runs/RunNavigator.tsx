import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useState, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import type { StudioRunSummary } from "../../api/runs.js";
import { useStudioCopy } from "../../app/copy.js";
import { formatLocalDate, formatLocalTime } from "../../app/time.js";
import {
  AutoRefreshSelect,
  type AutoRefreshSeconds,
} from "../navigation/AutoRefreshSelect.js";
import { studioRunKey } from "../../api/runs.js";

export type RunNavigatorState =
  | { status: "loading" }
  | { status: "ready"; runs: StudioRunSummary[] }
  | { status: "error"; message: string };

export interface RunNavigatorProps {
  state: RunNavigatorState;
  selectedRunKey?: string;
  query: string;
  toolbar?: ReactNode;
  autoRefreshSeconds: AutoRefreshSeconds;
  onQueryChange: (query: string) => void;
  onAutoRefreshSecondsChange: (seconds: AutoRefreshSeconds) => void;
  onRefresh: () => void;
  onSelectRun: (runKey: string) => void;
}

interface RunGroup {
  date: string;
  runs: StudioRunSummary[];
}

export function RunNavigator({
  state,
  selectedRunKey,
  query,
  toolbar,
  autoRefreshSeconds,
  onQueryChange,
  onAutoRefreshSecondsChange,
  onRefresh,
  onSelectRun,
}: RunNavigatorProps): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Paper
      component="section"
      id="runs-nav-panel"
      className="studio-data-navigator"
      aria-label={t("runs")}
      data-studio-section="react-run-navigator"
      withBorder
      radius="md"
      p="sm"
    >
      <Stack gap="sm" h="100%">
        {toolbar}
        <Group gap="xs" align="flex-start" wrap="nowrap">
          <TextInput
            className="studio-nav-search"
            type="search"
            size="xs"
            autoComplete="off"
            aria-label={t("searchRuns")}
            placeholder={t("searchRunsPlaceholder")}
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onQueryChange(event.target.value)}
          />
          <ActionIcon
            variant="light"
            size={30}
            title={t("refreshRuns")}
            aria-label={t("refreshRuns")}
            onClick={onRefresh}
          >
            ↻
          </ActionIcon>
          <AutoRefreshSelect
            ariaLabel={t("autoRefresh")}
            value={autoRefreshSeconds}
            onChange={onAutoRefreshSecondsChange}
          />
        </Group>
        <ScrollArea className="studio-nav-scroll" aria-label={t("runs")}>
          <RunListContent
            state={state}
            selectedRunKey={selectedRunKey}
            query={query}
            onSelectRun={onSelectRun}
          />
        </ScrollArea>
      </Stack>
    </Paper>
  );
}

function RunListContent({
  state,
  selectedRunKey,
  query,
  onSelectRun,
}: {
  state: RunNavigatorState;
  selectedRunKey: string | undefined;
  query: string;
  onSelectRun: (runKey: string) => void;
}): ReactElement {
  const { t } = useStudioCopy();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  if (state.status === "loading") {
    return <NavEmpty label={t("loadingRuns")} />;
  }
  if (state.status === "error") {
    return <NavEmpty label={t("runListFailed")} detail={state.message} tone="red" />;
  }
  if (state.runs.length === 0) {
    return <NavEmpty label={t("noRuns")} />;
  }
  const runs = filterRunSummaries(state.runs, query);
  if (runs.length === 0) {
    return <NavEmpty label={t("noMatchingRuns")} />;
  }
  function toggleGroup(date: string): void {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  }
  return (
    <Stack gap="xs">
      {groupRunsByDate(runs).map((group) => {
        const collapsed = collapsedGroups.has(group.date);
        return (
          <Stack gap={collapsed ? 0 : 6} key={group.date}>
            <NavGroupToggle
              label={group.date}
              count={group.runs.length}
              collapsed={collapsed}
              onToggle={() => toggleGroup(group.date)}
            />
            {collapsed ? null : group.runs.map((run) => (
              <RunButton
                key={studioRunKey(run)}
                run={run}
                selected={studioRunKey(run) === selectedRunKey}
                onSelectRun={onSelectRun}
              />
            ))}
          </Stack>
        );
      })}
    </Stack>
  );
}

function NavGroupToggle({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <Button
      className="studio-nav-group-toggle"
      variant="subtle"
      color="gray"
      fullWidth
      h={30}
      px={4}
      justify="space-between"
      type="button"
      aria-expanded={!collapsed}
      data-nav-group={label}
      onClick={onToggle}
    >
      <Group justify="space-between" gap="xs" wrap="nowrap" w="100%">
        <Group gap={4} wrap="nowrap" miw={0}>
          <Text component="span" size="xs" c="dimmed" fw={800} aria-hidden="true">
            {collapsed ? "▸" : "▾"}
          </Text>
          <Text component="span" size="xs" c="dimmed" fw={800} truncate="end">{label}</Text>
        </Group>
        <Badge size="xs" variant="light">{count}</Badge>
      </Group>
    </Button>
  );
}

function RunButton({
  run,
  selected,
  onSelectRun,
}: {
  run: StudioRunSummary;
  selected: boolean;
  onSelectRun: (runKey: string) => void;
}): ReactElement {
  const { t } = useStudioCopy();
  const updatedAt = runListTimestamp(run);
  const meta = [
    run.workspace.label,
    run.workflow ?? "unknown",
    run.status,
    run.latest_event ?? t("latestEventFallback"),
  ].join(" · ");
  return (
    <Button
      className="studio-nav-item"
      variant={selected ? "light" : "subtle"}
      color={selected ? "agentmesh" : "gray"}
      justify="flex-start"
      fullWidth
      h="auto"
      py={8}
      px="sm"
      data-run={run.run_id}
      data-workspace={run.workspace.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelectRun(studioRunKey(run))}
    >
      <Stack gap={2} align="stretch" w="100%">
        <Text className="studio-nav-item-title" size="sm" fw={800} ta="left" truncate="end">{run.run_id}</Text>
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed" truncate="end">{meta}</Text>
          <Text component="time" dateTime={updatedAt} size="xs" c="dimmed">{formatRunListTime(updatedAt)}</Text>
        </Group>
      </Stack>
    </Button>
  );
}

function NavEmpty({
  label,
  detail,
  tone = "gray",
}: {
  label: string;
  detail?: string;
  tone?: "gray" | "red";
}): ReactElement {
  return (
    <Paper p="sm" radius="md" bg={tone === "red" ? "red.0" : "gray.0"}>
      <Stack gap={2}>
        <Text size="sm" fw={800} c={tone === "red" ? "red.8" : "dimmed"}>{label}</Text>
        {detail ? <Text size="xs" c={tone === "red" ? "red.7" : "dimmed"}>{detail}</Text> : null}
      </Stack>
    </Paper>
  );
}

function filterRunSummaries(runs: StudioRunSummary[], query: string): StudioRunSummary[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return runs;
  }
  return runs.filter((run) => [
    run.run_id,
    run.workflow,
    run.status,
    run.latest_event,
    run.workspace.label,
    run.workspace.path,
  ].some((value) => String(value ?? "").toLocaleLowerCase().includes(normalized)));
}

function groupRunsByDate(runs: StudioRunSummary[]): RunGroup[] {
  const groups: RunGroup[] = [];
  const groupsByDate = new Map<string, RunGroup>();
  for (const run of runs) {
    const date = formatRunListDate(runListTimestamp(run));
    const existing = groupsByDate.get(date);
    if (existing) {
      existing.runs.push(run);
      continue;
    }
    const group = { date, runs: [run] };
    groupsByDate.set(date, group);
    groups.push(group);
  }
  return groups;
}

function runListTimestamp(run: StudioRunSummary): string | undefined {
  return run.updated_at ?? run.latest_event_timestamp ?? run.created_at;
}

function formatRunListDate(value: string | undefined): string {
  return formatLocalDate(value);
}

function formatRunListTime(value: string | undefined): string {
  return formatLocalTime(value);
}
