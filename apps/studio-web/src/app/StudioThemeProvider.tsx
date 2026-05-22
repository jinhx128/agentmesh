import {
  MantineProvider,
  MultiSelect,
  Select,
  createTheme,
  type MantineColorsTuple,
} from "@mantine/core";
import type { ReactElement, ReactNode } from "react";

const agentmeshBlue: MantineColorsTuple = [
  "#eef5ff",
  "#dce8ff",
  "#b8d0ff",
  "#8fb4ff",
  "#6b9cff",
  "#4b85f0",
  "#2f6bd8",
  "#2556b0",
  "#20498e",
  "#1f3f76",
];

const studioFontFamily =
  "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif";

export const studioTheme = createTheme({
  colors: {
    agentmesh: agentmeshBlue,
  },
  components: {
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
  defaultRadius: "sm",
  focusRing: "auto",
  fontFamily: studioFontFamily,
  headings: {
    fontFamily: studioFontFamily,
    fontWeight: "700",
  },
  primaryColor: "agentmesh",
  primaryShade: {
    light: 6,
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
