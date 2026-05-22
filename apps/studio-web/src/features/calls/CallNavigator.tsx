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
import type { StudioCallSummary } from "../../api/calls.js";
import { useStudioCopy } from "../../app/copy.js";
import { formatLocalDate, formatLocalTime } from "../../app/time.js";
import {
  AutoRefreshSelect,
  type AutoRefreshSeconds,
} from "../navigation/AutoRefreshSelect.js";

export type CallNavigatorState =
  | { status: "loading" }
  | { status: "ready"; calls: StudioCallSummary[] }
  | { status: "error"; message: string };

export interface CallNavigatorProps {
  state: CallNavigatorState;
  selectedCallId?: string;
  query: string;
  toolbar?: ReactNode;
  autoRefreshSeconds: AutoRefreshSeconds;
  onQueryChange: (query: string) => void;
  onAutoRefreshSecondsChange: (seconds: AutoRefreshSeconds) => void;
  onRefresh: () => void;
  onSelectCall: (callId: string) => void;
}

interface CallGroup {
  date: string;
  calls: StudioCallSummary[];
}

export function CallNavigator({
  state,
  selectedCallId,
  query,
  toolbar,
  autoRefreshSeconds,
  onQueryChange,
  onAutoRefreshSecondsChange,
  onRefresh,
  onSelectCall,
}: CallNavigatorProps): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Paper
      component="section"
      id="calls-nav-panel"
      className="studio-data-navigator"
      aria-label={t("calls")}
      data-studio-section="react-call-navigator"
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
            aria-label={t("searchCalls")}
            placeholder={t("searchCallsPlaceholder")}
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onQueryChange(event.target.value)}
          />
          <ActionIcon
            variant="light"
            size={30}
            title={t("refreshCalls")}
            aria-label={t("refreshCalls")}
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
        <ScrollArea className="studio-nav-scroll" aria-label={t("calls")}>
          <CallListContent
            state={state}
            selectedCallId={selectedCallId}
            query={query}
            onSelectCall={onSelectCall}
          />
        </ScrollArea>
      </Stack>
    </Paper>
  );
}

function CallListContent({
  state,
  selectedCallId,
  query,
  onSelectCall,
}: {
  state: CallNavigatorState;
  selectedCallId: string | undefined;
  query: string;
  onSelectCall: (callId: string) => void;
}): ReactElement {
  const { t } = useStudioCopy();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  if (state.status === "loading") {
    return <NavEmpty label={t("loadingCalls")} />;
  }
  if (state.status === "error") {
    return <NavEmpty label={t("callListFailed")} detail={state.message} tone="red" />;
  }
  if (state.calls.length === 0) {
    return <NavEmpty label={t("noCalls")} />;
  }
  const calls = filterCallSummaries(state.calls, query);
  if (calls.length === 0) {
    return <NavEmpty label={t("noMatchingCalls")} />;
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
      {groupCallsByDate(calls).map((group) => {
        const collapsed = collapsedGroups.has(group.date);
        return (
          <Stack gap={collapsed ? 0 : 6} key={group.date}>
            <NavGroupToggle
              label={group.date}
              count={group.calls.length}
              collapsed={collapsed}
              onToggle={() => toggleGroup(group.date)}
            />
            {collapsed ? null : group.calls.map((call) => (
              <CallButton
                key={call.id}
                call={call}
                selected={call.id === selectedCallId}
                onSelectCall={onSelectCall}
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

function CallButton({
  call,
  selected,
  onSelectCall,
}: {
  call: StudioCallSummary;
  selected: boolean;
  onSelectCall: (callId: string) => void;
}): ReactElement {
  const { t } = useStudioCopy();
  const meta = [
    call.agent_id ?? t("unknown"),
    call.adapter,
    call.status,
    call.adoption_status,
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
      data-call={call.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelectCall(call.id)}
    >
      <Stack gap={4} align="stretch" w="100%">
        <Text size="sm" fw={800} truncate="end">{call.id}</Text>
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed" truncate="end">{meta}</Text>
          <Text component="time" dateTime={call.created_at} size="xs" c="dimmed">{formatCallListTime(call.created_at)}</Text>
        </Group>
        <Group gap={4}>
          {call.unsupported_schema ? <Badge size="xs" color="orange">{t("unsupportedSchema")}</Badge> : null}
          {call.warnings.some((warning) => warning.code === "dangling_output_path") ? <Badge size="xs" color="yellow">{t("danglingOutput")}</Badge> : null}
          {call.status === "stale" ? <Badge size="xs" color="gray">stale</Badge> : null}
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

function filterCallSummaries(calls: StudioCallSummary[], query: string): StudioCallSummary[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return calls;
  }
  return calls.filter((call) => [
    call.id,
    call.agent_id,
    call.adapter,
    call.model,
    call.purpose,
    call.status,
    call.adoption_status,
    call.output_path,
    ...call.related_files,
    ...call.related_run_ids,
    ...call.related_call_ids,
  ].some((value) => String(value ?? "").toLocaleLowerCase().includes(normalized)));
}

function groupCallsByDate(calls: StudioCallSummary[]): CallGroup[] {
  const groups: CallGroup[] = [];
  const groupsByDate = new Map<string, CallGroup>();
  for (const call of calls) {
    const date = formatCallListDate(call.created_at);
    const existing = groupsByDate.get(date);
    if (existing) {
      existing.calls.push(call);
      continue;
    }
    const group = { date, calls: [call] };
    groupsByDate.set(date, group);
    groups.push(group);
  }
  return groups;
}

function formatCallListDate(value: string | undefined): string {
  return formatLocalDate(value);
}

function formatCallListTime(value: string | undefined): string {
  return formatLocalTime(value);
}
