import type { ReactElement } from "react";

const agentMeshIconUrl = new URL(
  "../../../studio-desktop/src-tauri/icons/agentmesh.svg?no-inline",
  import.meta.url,
).href;

export function StudioBrandMark(): ReactElement {
  return (
    <img
      className="studio-brand-mark"
      src={agentMeshIconUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
