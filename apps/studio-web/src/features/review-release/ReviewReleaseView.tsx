import {
  Badge,
  Card,
  Code,
  Group,
  List,
  Paper,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useState, type ReactElement } from "react";
import { useStudioCopy } from "../../app/copy.js";
import type {
  StudioMarkdownSectionView,
  StudioRawReviewView,
  StudioReviewReleaseView,
} from "../../api/runs.js";

export interface ReviewReleaseViewProps {
  view: StudioReviewReleaseView;
}

export function ReviewReleaseView({ view }: ReviewReleaseViewProps): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Paper component="section" className="studio-panel" data-studio-section="react-review-release" withBorder radius="md" p="lg">
      <Group justify="space-between" align="flex-start" gap="md">
        <Title order={2} size="h3">{t("reviewRelease")}</Title>
        <VerdictBadge view={view} />
      </Group>
      <SimpleGrid mt="md" cols={{ base: 1, lg: 2 }} spacing="md">
        <Card withBorder radius="md" p="md" aria-label={t("releaseVerdict")}>
          <Title order={3} size="h4" mb="sm">{t("releaseVerdict")}</Title>
          {view.release_verdict ? (
            <Stack gap="xs">
              <Badge color={verdictColor(view.release_verdict.value)}>{view.release_verdict.value ?? "invalid"}</Badge>
              {view.release_verdict.diagnostic ? <p>{view.release_verdict.diagnostic}</p> : null}
            </Stack>
          ) : <Text c="dimmed">{t("noVerdict")}</Text>}
        </Card>
        <FindingsSection view={view} />
        <ReleaseSummarySection view={view} />
        <EvidenceList title={t("skippedChecks")} items={view.skipped_checks} />
        <EvidenceList title={t("residualRisk")} items={view.residual_risk} />
      </SimpleGrid>
      <RawReviews rawReviews={view.raw_reviews} />
    </Paper>
  );
}

function VerdictBadge({ view }: { view: StudioReviewReleaseView }): ReactElement {
  const { t } = useStudioCopy();
  const verdict = view.release_verdict?.value;
  return <Badge color={verdictColor(verdict)} size="lg">{verdict ?? t("noVerdict")}</Badge>;
}

function FindingsSection({ view }: { view: StudioReviewReleaseView }): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Card withBorder radius="md" p="md" aria-label={t("findings")}>
      <Title order={3} size="h4" mb="sm">{t("findings")}</Title>
      {!view.findings.present ? <Text c="dimmed">findings.md not present</Text> : null}
      <Stack gap="sm">
        <FindingGroup title={t("accepted")} items={view.findings.accepted} />
        <FindingGroup title={t("rejected")} items={view.findings.rejected} />
        <FindingGroup title={t("needsDecision")} items={view.findings.needs_decision} />
      </Stack>
    </Card>
  );
}

function FindingGroup({ title, items }: { title: string; items: string[] }): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Stack gap={4}>
      <Text fw={800}>{title} · {items.length}</Text>
      <ItemList items={items} emptyLabel={t("noRelatedItems")} />
    </Stack>
  );
}

function ReleaseSummarySection({ view }: { view: StudioReviewReleaseView }): ReactElement {
  const { t } = useStudioCopy();
  const summary = view.release_summary;
  return (
    <Card withBorder radius="md" p="md" aria-label={t("releaseSummary")}>
      <Title order={3} size="h4" mb="sm">{t("releaseSummary")}</Title>
      {summary.present ? (
        <>
          <Text size="xs" c="dimmed">
            {summary.path}
            {summary.truncated ? <span> · {t("truncated")}</span> : null}
          </Text>
          {summary.sections.length > 0 ? (
            <Stack mt="sm" gap="sm">
              {summary.sections.map((section, index) => (
                <MarkdownSectionView section={section} key={`${section.heading}:${index}`} />
              ))}
            </Stack>
          ) : <Text c="dimmed">{t("noRelatedItems")}</Text>}
        </>
      ) : <Text c="dimmed">{t("noRelatedItems")}</Text>}
    </Card>
  );
}

function MarkdownSectionView({ section }: { section: StudioMarkdownSectionView }): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Stack gap={4}>
      <Text fw={800}>{section.heading || "Section"}</Text>
      {section.content ? <Text size="sm">{section.content}</Text> : null}
      <ItemList items={section.items} emptyLabel={t("noRelatedItems")} />
    </Stack>
  );
}

function EvidenceList({ title, items }: { title: string; items: string[] }): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Card withBorder radius="md" p="md" aria-label={title}>
      <Title order={3} size="h4" mb="sm">{title}</Title>
      <ItemList items={items} emptyLabel={t("noRelatedItems")} />
    </Card>
  );
}

function RawReviews({ rawReviews }: { rawReviews: StudioRawReviewView[] }): ReactElement {
  const { t } = useStudioCopy();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedReview = rawReviews[Math.min(selectedIndex, Math.max(0, rawReviews.length - 1))];
  return (
    <Card mt="md" withBorder radius="md" p="md" aria-label={t("rawReviews")}>
      <Title order={3} size="h4" mb="sm">{t("rawReviews")}</Title>
      {rawReviews.length > 0 ? (
        <Tabs value={String(selectedIndex)} onChange={(value) => setSelectedIndex(Number(value ?? 0))}>
          <Tabs.List aria-label={t("rawReviews")}>
            {rawReviews.map((review, index) => (
              <Tabs.Tab
                value={String(index)}
                key={`${review.reviewer}:${review.path}:${index}`}
              >
                {review.reviewer || "reviewer"}{review.truncated ? ` · ${t("truncated")}` : ""}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {selectedReview ? (
            <Tabs.Panel value={String(selectedIndex)} pt="md">
              <Text size="xs" c="dimmed" mb="xs">{selectedReview.path}</Text>
              <Code block className="studio-code-block raw-review-content">{selectedReview.content}</Code>
            </Tabs.Panel>
          ) : null}
        </Tabs>
      ) : <Text c="dimmed">{t("noRawReviews")}</Text>}
    </Card>
  );
}

function ItemList({ items, emptyLabel }: { items: string[]; emptyLabel: string }): ReactElement {
  if (items.length === 0) {
    return <Text size="sm" c="dimmed">{emptyLabel}</Text>;
  }
  return (
    <List size="sm">
      {items.map((item, index) => <List.Item key={`${item}:${index}`}>{item}</List.Item>)}
    </List>
  );
}

function verdictColor(verdict: string | null | undefined): string {
  if (verdict === "ready") {
    return "green";
  }
  if (verdict === "not_ready") {
    return "red";
  }
  if (verdict === "needs_decision") {
    return "yellow";
  }
  return "gray";
}
