import {
  Tabs,
} from "@mantine/core";
import { useState, type KeyboardEvent, type ReactElement } from "react";
import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import {
  CatalogView,
  type CatalogViewProps,
} from "../catalog/CatalogView.js";
import {
  AgentIntegrationsPanel,
  type AgentIntegrationsPanelProps,
} from "./AgentIntegrationsPanel.js";
import {
  SettingsAboutPanel,
  type SettingsAboutPanelProps,
} from "./SettingsAboutPanel.js";
import {
  AdvancedSettingsPanel,
  type AdvancedSettingsPanelProps,
} from "./AdvancedSettingsPanel.js";

export type SettingsTabId = "resources" | "advanced" | "environment" | "about";

export interface SettingsViewProps {
  resources: CatalogViewProps;
  advanced: AdvancedSettingsPanelProps;
  environment: AgentIntegrationsPanelProps;
  about: SettingsAboutPanelProps;
  initialTab?: SettingsTabId;
}

const SETTINGS_TABS: Array<{
  id: SettingsTabId;
  labelKey: StudioCopyKey;
}> = [
  { id: "resources", labelKey: "resources" },
  { id: "advanced", labelKey: "advanced" },
  { id: "environment", labelKey: "environment" },
  { id: "about", labelKey: "about" },
];

export function SettingsView({
  resources,
  advanced,
  environment,
  about,
  initialTab = "resources",
}: SettingsViewProps): ReactElement {
  const { t } = useStudioCopy();
  const [selectedTab, setSelectedTab] = useState<SettingsTabId>(initialTab);

  return (
    <Tabs
      data-studio-section="studio-settings-view"
      value={selectedTab}
      onChange={(value) => setSelectedTab(isSettingsTab(value) ? value : "resources")}
      keepMounted={false}
    >
      <Tabs.List aria-label={t("settingsView")} grow>
        {SETTINGS_TABS.map((tab) => (
          <Tabs.Tab
            value={tab.id}
            key={tab.id}
            onKeyDown={(event) => selectRelativeSettingsTab(event, tab.id, setSelectedTab)}
          >
            {t(tab.labelKey)}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <Tabs.Panel value="resources" pt="md" data-studio-section="settings-resource-workspace">
        <CatalogView {...resources} />
      </Tabs.Panel>
      <Tabs.Panel value="advanced" pt="md" data-studio-section="settings-advanced-workspace">
        <AdvancedSettingsPanel {...advanced} />
      </Tabs.Panel>
      <Tabs.Panel value="environment" pt="md" data-studio-section="settings-environment-workspace">
        <AgentIntegrationsPanel {...environment} />
      </Tabs.Panel>
      <Tabs.Panel value="about" pt="md" data-studio-section="settings-about-workspace">
        <SettingsAboutPanel {...about} />
      </Tabs.Panel>
    </Tabs>
  );
}

function isSettingsTab(value: string | null): value is SettingsTabId {
  return SETTINGS_TABS.some((tab) => tab.id === value);
}

function selectRelativeSettingsTab(
  event: KeyboardEvent<HTMLButtonElement>,
  currentTab: SettingsTabId,
  onSelect: (tab: SettingsTabId) => void,
): void {
  const currentIndex = SETTINGS_TABS.findIndex((tab) => tab.id === currentTab);
  if (currentIndex < 0) {
    return;
  }
  const nextIndex = relativeSettingsTabIndex(event.key, currentIndex, SETTINGS_TABS.length);
  if (nextIndex === undefined) {
    return;
  }
  event.preventDefault();
  onSelect(SETTINGS_TABS[nextIndex].id);
}

function relativeSettingsTabIndex(
  key: string,
  currentIndex: number,
  length: number,
): number | undefined {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (currentIndex + 1) % length;
    case "ArrowLeft":
    case "ArrowUp":
      return (currentIndex - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return undefined;
  }
}
