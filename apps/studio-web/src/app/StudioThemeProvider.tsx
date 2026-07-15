import {
  Drawer,
  MantineProvider,
  Modal,
  MultiSelect,
  Select,
  createTheme,
  type MantineColorsTuple,
} from "@mantine/core";
import type { ReactElement, ReactNode } from "react";

const agentmeshCyan: MantineColorsTuple = [
  "#e9fbfc",
  "#d7f6f8",
  "#adebf0",
  "#7ddde5",
  "#58cad6",
  "#3eb8c8",
  "#2699a8",
  "#207b88",
  "#1f6570",
  "#1d535c",
];

const studioFontFamily =
  "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif";

export const studioTheme = createTheme({
  autoContrast: true,
  colors: {
    agentmesh: agentmeshCyan,
  },
  components: {
    Modal: Modal.extend({
      defaultProps: {
        closeButtonProps: { "aria-label": "关闭" },
      },
    }),
    Drawer: Drawer.extend({
      defaultProps: {
        closeButtonProps: { "aria-label": "关闭" },
      },
    }),
    Select: Select.extend({
      defaultProps: {
        searchable: true,
      },
    }),
    MultiSelect: MultiSelect.extend({
      defaultProps: {
        checkIconPosition: "left",
        hidePickedOptions: false,
        searchable: true,
        withCheckIcon: true,
      },
    }),
  },
  defaultRadius: "md",
  focusRing: "auto",
  fontFamily: studioFontFamily,
  headings: {
    fontFamily: studioFontFamily,
    fontWeight: "700",
  },
  primaryColor: "agentmesh",
  primaryShade: {
    light: 5,
    dark: 4,
  },
});

export function StudioThemeProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <MantineProvider defaultColorScheme="light" theme={studioTheme}>
      {children}
    </MantineProvider>
  );
}
