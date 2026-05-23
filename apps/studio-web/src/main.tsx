import React from "react";
import { createRoot } from "react-dom/client";
import "@mantine/core/styles.layer.css";
import { App } from "./app/App";
import { StudioThemeProvider } from "./app/StudioThemeProvider";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("AgentMesh root element was not found");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <StudioThemeProvider>
      <App />
    </StudioThemeProvider>
  </React.StrictMode>,
);
