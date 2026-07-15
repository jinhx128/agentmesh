import type { ReactElement } from "react";

export function StudioBrandMark(): ReactElement {
  return (
    <span className="studio-brand-mark" aria-hidden="true">
      <span className="studio-brand-track studio-brand-track-a" />
      <span className="studio-brand-track studio-brand-track-b" />
      <span className="studio-brand-core" />
    </span>
  );
}
