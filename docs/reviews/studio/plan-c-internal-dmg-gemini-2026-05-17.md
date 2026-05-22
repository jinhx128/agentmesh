Here is the read-only architecture/implementation-plan review for `plan-c.md`, focusing on the latest decisions:

### Must Fix
None. The plan is robust, accurately incorporates the latest decisions (Tauri 2, React/Vite, App Server boundary, lifecycle ownership, unsigned DMG), and establishes clear safety gates (e.g., P3.0 spike for Tauri).

### Should Fix
*   **Section 3 (Runtime Boundary) - Agent lifecycle ownership:** The text states, *"Create/delete agent is a long-term Studio capability."* However, Section 6 schedules this implementation as **P2.7 Add agent lifecycle controls**, placing it firmly in the near-term phase before desktop packaging (P3). You should clarify or remove the phrase "long-term" in Section 3 to align with the P2 timeline.

### Nit
*   **Section 5 (Frontend Application Shape) - Suggested source layout:** The proposed layout groups code into `apps/studio/src/server/` and `apps/studio/src/frontend/`. Given that the current workspace already has a flat `apps/studio/src/` containing files like `server.ts` and `main.ts`, a brief note could be added to explicitly state that an initial refactor will be required to move the existing Node code into the `server/` directory.
*   **Section 2 (Distribution target) & Section 6 (P3.4 Produce internal unsigned DMG):** The plan correctly notes that *"internal users may need documented Gatekeeper first-open steps"*. It might be worth briefly noting that since the DMG is unsigned, downloading it via Slack or Chrome will attach the `com.apple.quarantine` extended attribute. If macOS denies the standard "Right-click -> Open" bypass, the documentation should include the `xattr -d com.apple.quarantine <path>` command.

### Verdict
**ready**
