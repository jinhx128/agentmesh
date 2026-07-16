import {
  ActionIcon,
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useState, type ChangeEvent, type ReactElement } from "react";

import { studioCallKey, type StudioCallSummary } from "../../api/calls.js";
import { studioRunKey, type StudioRunSummary } from "../../api/runs.js";
import { formatLocalDate, formatLocalTime } from "../../app/time.js";
import {
  AutoRefreshSelect,
  type AutoRefreshSeconds,
} from "./AutoRefreshSelect.js";

export type ActivityRunsState =
  | { status: "loading" }
  | { status: "ready"; runs: StudioRunSummary[] }
  | { status: "error"; message: string };

export type ActivityCallsState =
  | { status: "loading" }
  | { status: "ready"; calls: StudioCallSummary[] }
  | { status: "error"; message: string };

export type StudioActivityItem =
  | {
      kind: "run";
      key: string;
      title: string;
      timestamp?: string;
      timestampMs: number | null;
      date: string;
      searchValues: string[];
      run: StudioRunSummary;
    }
  | {
      kind: "call";
      key: string;
      title: string;
      timestamp: string;
      timestampMs: number | null;
      date: string;
      searchValues: string[];
      call: StudioCallSummary;
    };

export interface StudioActivityGroup {
  date: string;
  items: StudioActivityItem[];
}

export interface ActivityNavigatorProps {
  runsState: ActivityRunsState;
  callsState: ActivityCallsState;
  selectedKind?: StudioActivityItem["kind"];
  selectedRunKey?: string;
  selectedCallKey?: string;
  query: string;
  autoRefreshSeconds: AutoRefreshSeconds;
  onQueryChange: (query: string) => void;
  onAutoRefreshSecondsChange: (seconds: AutoRefreshSeconds) => void;
  onRefresh: () => void;
  onSelectRun: (runKey: string) => void;
  onSelectCall: (callKey: string) => void;
}

export const ACTIVITY_GROUP_PREVIEW_LIMIT = 5;

export function activityItems(
  runs: StudioRunSummary[],
  calls: StudioCallSummary[],
): StudioActivityItem[] {
  const projected: StudioActivityItem[] = [
    ...runs.map(projectRunActivity),
    ...calls.map(projectCallActivity),
  ];
  return projected.sort((left, right) => {
    if (left.timestampMs === null) {
      if (right.timestampMs !== null) {
        return 1;
      }
    } else if (right.timestampMs === null) {
      return -1;
    } else {
      const timeOrder = right.timestampMs - left.timestampMs;
      if (timeOrder !== 0) {
        return timeOrder;
      }
    }
    return compareActivityKeys(left, right);
  });
}

export function filterActivityItems(
  items: StudioActivityItem[],
  query: string,
): StudioActivityItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return items;
  }
  return items.filter((item) => item.searchValues.some(
    (value) => value.toLocaleLowerCase().includes(normalized),
  ));
}

export function groupActivityItems(items: StudioActivityItem[]): StudioActivityGroup[] {
  const groups: StudioActivityGroup[] = [];
  const groupsByDate = new Map<string, StudioActivityGroup>();
  for (const item of items) {
    const existing = groupsByDate.get(item.date);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    const group = { date: item.date, items: [item] };
    groupsByDate.set(item.date, group);
    groups.push(group);
  }
  return groups;
}

export function visibleActivityGroupItems(
  items: StudioActivityItem[],
  expanded: boolean,
  query: string,
): StudioActivityItem[] {
  if (expanded || query.trim().length > 0) {
    return items;
  }
  return items.slice(0, ACTIVITY_GROUP_PREVIEW_LIMIT);
}

export function ActivityNavigator({
  runsState,
  callsState,
  selectedKind,
  selectedRunKey,
  selectedCallKey,
  query,
  autoRefreshSeconds,
  onQueryChange,
  onAutoRefreshSecondsChange,
  onRefresh,
  onSelectRun,
  onSelectCall,
}: ActivityNavigatorProps): ReactElement {
  return (
    <Paper
      component="section"
      id="activities-nav-panel"
      className="studio-data-navigator"
      aria-label="活动"
      data-studio-section="react-activity-navigator"
      withBorder
      radius="md"
      p="sm"
    >
      <Stack gap="sm" h="100%">
        <Group gap="xs" align="flex-start" wrap="nowrap">
          <TextInput
            className="studio-nav-search"
            type="search"
            size="xs"
            autoComplete="off"
            aria-label="搜索活动"
            placeholder="搜索运行与调用"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onQueryChange(event.target.value)}
          />
          <ActionIcon
            variant="light"
            size={30}
            title="刷新活动"
            aria-label="刷新活动"
            onClick={onRefresh}
          >
            ↻
          </ActionIcon>
          <AutoRefreshSelect
            ariaLabel="自动刷新"
            value={autoRefreshSeconds}
            onChange={onAutoRefreshSecondsChange}
          />
        </Group>
        <ScrollArea className="studio-nav-scroll" aria-label="活动列表">
          <ActivityListContent
            runsState={runsState}
            callsState={callsState}
            selectedKind={selectedKind}
            selectedRunKey={selectedRunKey}
            selectedCallKey={selectedCallKey}
            query={query}
            onSelectRun={onSelectRun}
            onSelectCall={onSelectCall}
          />
        </ScrollArea>
      </Stack>
    </Paper>
  );
}

function ActivityListContent({
  runsState,
  callsState,
  selectedKind,
  selectedRunKey,
  selectedCallKey,
  query,
  onSelectRun,
  onSelectCall,
}: Pick<
  ActivityNavigatorProps,
  | "runsState"
  | "callsState"
  | "selectedKind"
  | "selectedRunKey"
  | "selectedCallKey"
  | "query"
  | "onSelectRun"
  | "onSelectCall"
>): ReactElement {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [expandedItemGroups, setExpandedItemGroups] = useState<Set<string>>(() => new Set());
  const runs = runsState.status === "ready" ? runsState.runs : [];
  const calls = callsState.status === "ready" ? callsState.calls : [];
  const allItems = activityItems(runs, calls);
  const items = filterActivityItems(allItems, query);
  const issues = [
    ...(runsState.status === "error"
      ? [{ kind: "run" as const, label: "运行加载失败", detail: runsState.message }]
      : []),
    ...(callsState.status === "error"
      ? [{ kind: "call" as const, label: "调用加载失败", detail: callsState.message }]
      : []),
  ];

  function toggleGroup(date: string): void {
    setCollapsedGroups((current) => toggledSet(current, date));
  }

  function toggleGroupItems(date: string): void {
    setExpandedItemGroups((current) => toggledSet(current, date));
  }

  const loading = runsState.status === "loading" || callsState.status === "loading";
  const noSourceItems = runs.length === 0 && calls.length === 0;
  return (
    <Stack gap="xs">
      {issues.map((issue) => (
        <NavEmpty
          key={issue.kind}
          label={issue.label}
          detail={issue.detail}
          tone="red"
        />
      ))}
      {items.length === 0 && issues.length > 0 && !loading ? null : items.length === 0 ? (
        <NavEmpty label={emptyActivityLabel({ allItems, loading, noSourceItems, query })} />
      ) : groupActivityItems(items).map((group) => {
        const collapsed = query.trim().length === 0
          && collapsedGroups.has(group.date);
        const expanded = expandedItemGroups.has(group.date);
        const visibleItems = visibleActivityGroupItems(group.items, expanded, query);
        const showMoreControl = query.trim().length === 0
          && group.items.length > ACTIVITY_GROUP_PREVIEW_LIMIT;
        return (
          <Stack gap={collapsed ? 0 : 6} key={group.date}>
            <NavGroupToggle
              label={group.date}
              count={group.items.length}
              collapsed={collapsed}
              onToggle={() => toggleGroup(group.date)}
            />
            {collapsed ? null : (
              <>
                {visibleItems.map((item) => (
                  <ActivityButton
                    key={`${item.kind}:${item.key}`}
                    item={item}
                    selected={isSelectedActivity(
                      item,
                      selectedKind,
                      selectedRunKey,
                      selectedCallKey,
                    )}
                    onSelectRun={onSelectRun}
                    onSelectCall={onSelectCall}
                  />
                ))}
                {showMoreControl ? (
                  <NavGroupMoreButton
                    expanded={expanded}
                    hiddenCount={group.items.length - ACTIVITY_GROUP_PREVIEW_LIMIT}
                    onToggle={() => toggleGroupItems(group.date)}
                  />
                ) : null}
              </>
            )}
          </Stack>
        );
      })}
    </Stack>
  );
}

function ActivityButton({
  item,
  selected,
  onSelectRun,
  onSelectCall,
}: {
  item: StudioActivityItem;
  selected: boolean;
  onSelectRun: (runKey: string) => void;
  onSelectCall: (callKey: string) => void;
}): ReactElement {
  const typeLabel = item.kind === "run" ? "[运行]" : "[调用]";
  return (
    <Button
      className="studio-nav-item studio-activity-item"
      variant={selected ? "light" : "subtle"}
      color={selected ? "agentmesh" : "gray"}
      justify="flex-start"
      fullWidth
      h="auto"
      py={8}
      px="sm"
      data-activity-kind={item.kind}
      data-activity-key={item.key}
      data-workspace={item.kind === "run" ? item.run.workspace.id : item.call.workspace.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => {
        if (item.kind === "run") {
          onSelectRun(item.key);
        } else {
          onSelectCall(item.key);
        }
      }}
    >
      <Stack gap={4} align="stretch" w="100%">
        <Text className="studio-nav-item-title" size="sm" fw={700} ta="left" truncate="end">
          {item.title}
        </Text>
        <Group className="studio-activity-item-meta" justify="space-between" gap="xs" wrap="nowrap">
          <Text className="studio-activity-kind" component="span" size="xs">
            {typeLabel}
          </Text>
          {item.timestampMs === null ? (
            <Text component="span" size="xs" c="dimmed" aria-label="时间未知">—</Text>
          ) : (
            <Text component="time" dateTime={item.timestamp} size="xs" c="dimmed">
              {formatLocalTime(item.timestamp)}
            </Text>
          )}
        </Group>
      </Stack>
    </Button>
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
      className="studio-nav-group-header studio-nav-group-toggle"
      variant="subtle"
      color="gray"
      fullWidth
      h={36}
      px={6}
      justify="space-between"
      type="button"
      aria-expanded={!collapsed}
      data-nav-group={label}
      onClick={onToggle}
    >
      <Group justify="space-between" gap="xs" wrap="nowrap" w="100%">
        <Group gap={6} wrap="nowrap" miw={0}>
          <svg
            className="studio-nav-group-chevron"
            viewBox="0 0 18 18"
            fill="none"
            aria-hidden="true"
          >
            <path
              d={collapsed ? "M7 5.5 10.5 9 7 12.5" : "M5.5 7 9 10.5 12.5 7"}
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <svg
            className="studio-nav-group-calendar"
            viewBox="0 0 18 18"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M5.25 3.25v2M12.75 3.25v2M3.5 7h11M5 4.25h8A1.5 1.5 0 0 1 14.5 5.75v7A1.5 1.5 0 0 1 13 14.25H5a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 5 4.25Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <Text className="studio-nav-group-label" component="span" truncate="end">
            {label}
          </Text>
        </Group>
        <span className="studio-nav-group-count">{count}</span>
      </Group>
    </Button>
  );
}

function NavGroupMoreButton({
  expanded,
  hiddenCount,
  onToggle,
}: {
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
}): ReactElement {
  return (
    <Button
      className="studio-nav-group-more"
      variant="subtle"
      color="gray"
      fullWidth
      size="xs"
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <svg
        className="studio-nav-group-more-icon"
        viewBox="0 0 18 18"
        fill="none"
        aria-hidden="true"
      >
        <path
          d={expanded ? "M5.5 10.5 9 7l3.5 3.5" : "M5.5 7.5 9 11l3.5-3.5"}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {expanded
        ? `收起到 ${ACTIVITY_GROUP_PREVIEW_LIMIT} 条`
        : `展开其余 ${hiddenCount} 条`}
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

function projectRunActivity(run: StudioRunSummary): StudioActivityItem {
  const timestamp = run.updated_at ?? run.latest_event_timestamp ?? run.created_at;
  const timestampMs = parsedTimestamp(timestamp);
  const title = displayTitle(run.title, run.run_id);
  return {
    kind: "run",
    key: studioRunKey(run),
    title,
    timestamp,
    timestampMs,
    date: timestampMs === null ? "unknown" : formatLocalDate(timestamp),
    searchValues: presentStrings([
      title,
      run.run_id,
      run.workspace.label,
      run.workspace.path,
      run.workflow,
      run.status,
      run.latest_event,
    ]),
    run,
  };
}

function projectCallActivity(call: StudioCallSummary): StudioActivityItem {
  const timestampMs = parsedTimestamp(call.created_at);
  const title = displayTitle(call.title, call.id);
  return {
    kind: "call",
    key: studioCallKey(call),
    title,
    timestamp: call.created_at,
    timestampMs,
    date: timestampMs === null ? "unknown" : formatLocalDate(call.created_at),
    searchValues: presentStrings([
      title,
      call.id,
      call.workspace.label,
      call.workspace.path,
      call.purpose,
      call.agent_id,
      call.adapter,
      call.model,
      call.status,
    ]),
    call,
  };
}

function displayTitle(title: string | undefined, fallback: string): string {
  return title?.trim() || fallback;
}

function parsedTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function compareActivityKeys(left: StudioActivityItem, right: StudioActivityItem): number {
  const leftKey = `${left.kind}:${left.key}`;
  const rightKey = `${right.kind}:${right.key}`;
  if (leftKey === rightKey) {
    return 0;
  }
  return leftKey < rightKey ? -1 : 1;
}

function presentStrings(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function toggledSet(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function isSelectedActivity(
  item: StudioActivityItem,
  selectedKind: StudioActivityItem["kind"] | undefined,
  selectedRunKey: string | undefined,
  selectedCallKey: string | undefined,
): boolean {
  if (item.kind !== selectedKind) {
    return false;
  }
  return item.kind === "run"
    ? item.key === selectedRunKey
    : item.key === selectedCallKey;
}

function emptyActivityLabel({
  allItems,
  loading,
  noSourceItems,
  query,
}: {
  allItems: StudioActivityItem[];
  loading: boolean;
  noSourceItems: boolean;
  query: string;
}): string {
  if (allItems.length > 0 && query.trim()) {
    return "没有匹配的活动。";
  }
  if (loading && noSourceItems) {
    return "正在加载活动…";
  }
  return "暂无活动。";
}
