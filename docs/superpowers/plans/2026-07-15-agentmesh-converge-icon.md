# AgentMesh Converge Icon Implementation Plan

> 状态（2026-07-16）：历史已完成。实现提交为 `2d10272`，后续品牌收敛提交为 `9ed581d`；下方未勾选项不再作为执行状态。当前唯一事实源为 `2026-07-16-studio-activity-and-v012-release.md`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current AgentMesh desktop icon with the approved Converge mark and verify the generated app assets on a real macOS installation.

**Architecture:** Keep `agentmesh.svg` as the single editable source, lock its approved geometry and palette with a Node regression test, and use the installed Tauri icon generator for every raster/container format. Preserve all existing filenames and bundle configuration so this remains an asset-only product change.

**Tech Stack:** SVG, Tauri CLI, Node.js `node:test`, macOS `sips`/`hdiutil`, ICNS, ICO, PNG

## Global Constraints

- Use a `1024 x 1024` SVG source with the exact geometry and flat colors from the approved design spec.
- Keep the existing Tauri icon filenames and configuration unchanged.
- Do not add runtime or build dependencies.
- Do not add gradients, shadows, text, animation, or alternate theme variants.
- Preserve legibility at 16px and 32px.
- Do not bump the package version, publish npm, or update GitHub Release assets in this task.
- The macOS app remains Apple Silicon and unsigned under the current distribution policy.

## File Map

- Modify `apps/studio-desktop/src-tauri/icons/agentmesh.svg`: canonical Converge vector source.
- Regenerate `apps/studio-desktop/src-tauri/icons/32x32.png`: smallest configured Tauri PNG.
- Regenerate `apps/studio-desktop/src-tauri/icons/128x128.png`: standard desktop PNG.
- Regenerate `apps/studio-desktop/src-tauri/icons/128x128@2x.png`: 256px Retina PNG.
- Regenerate `apps/studio-desktop/src-tauri/icons/icon.png`: 512px general PNG.
- Regenerate `apps/studio-desktop/src-tauri/icons/icon.icns`: macOS icon container.
- Regenerate `apps/studio-desktop/src-tauri/icons/icon.ico`: Windows icon container.
- Modify `tests-node/studio-desktop-distribution.test.ts`: approved icon-source contract.
- Do not modify `apps/studio-desktop/src-tauri/tauri.conf.json` or distribution metadata.

---

### Task 1: Replace The Canonical Icon And Regenerate Assets

**Files:**
- Modify: `tests-node/studio-desktop-distribution.test.ts`
- Modify: `apps/studio-desktop/src-tauri/icons/agentmesh.svg`
- Regenerate: `apps/studio-desktop/src-tauri/icons/32x32.png`
- Regenerate: `apps/studio-desktop/src-tauri/icons/128x128.png`
- Regenerate: `apps/studio-desktop/src-tauri/icons/128x128@2x.png`
- Regenerate: `apps/studio-desktop/src-tauri/icons/icon.png`
- Regenerate: `apps/studio-desktop/src-tauri/icons/icon.icns`
- Regenerate: `apps/studio-desktop/src-tauri/icons/icon.ico`

**Interfaces:**
- Consumes: the geometry and palette in `docs/superpowers/specs/2026-07-15-agentmesh-converge-icon-design.md`.
- Produces: the unchanged Tauri icon asset paths consumed by `tauri.conf.json` and `distribution/macos.json`.

- [ ] **Step 1: Add the failing Converge source contract**

Add this test after `const root = process.cwd();` in `tests-node/studio-desktop-distribution.test.ts`:

```ts
test("canonical AgentMesh icon uses the approved Converge design", () => {
  const svg = readFileSync(
    path.join(root, "apps", "studio-desktop", "src-tauri", "icons", "agentmesh.svg"),
    "utf-8",
  );

  for (const fragment of [
    '<rect x="32" y="32" width="960" height="960" rx="232" fill="#F4F5F2"',
    'd="M512 488L272 272" stroke="#4AB7A6" stroke-width="112"',
    'd="M536 496L752 280" stroke="#FFB23E" stroke-width="112"',
    'd="M528 536L752 752" stroke="#F07258" stroke-width="112"',
    'd="M488 536L272 752" stroke="#5A84D6" stroke-width="112"',
    '<circle cx="512" cy="512" r="144" fill="#222925"',
    '<circle cx="512" cy="512" r="56" fill="#F7F8F4"',
  ]) {
    assert.ok(svg.includes(fragment), `missing approved icon fragment: ${fragment}`);
  }
  assert.doesNotMatch(svg, /#141414|<linearGradient|<filter|<text/);
});
```

- [ ] **Step 2: Run the contract and confirm RED**

Run:

```bash
npm run build:node
node --test --test-name-pattern "canonical AgentMesh icon" \
  dist-node/tests-node/studio-desktop-distribution.test.js
```

Expected: FAIL because the current SVG does not contain the `#F4F5F2` Converge background fragment.

- [ ] **Step 3: Replace the SVG with the approved source**

Use this complete `agentmesh.svg` content:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="AgentMesh">
  <rect x="32" y="32" width="960" height="960" rx="232" fill="#F4F5F2"/>
  <path d="M512 488L272 272" fill="none" stroke="#4AB7A6" stroke-width="112" stroke-linecap="round"/>
  <path d="M536 496L752 280" fill="none" stroke="#FFB23E" stroke-width="112" stroke-linecap="round"/>
  <path d="M528 536L752 752" fill="none" stroke="#F07258" stroke-width="112" stroke-linecap="round"/>
  <path d="M488 536L272 752" fill="none" stroke="#5A84D6" stroke-width="112" stroke-linecap="round"/>
  <circle cx="512" cy="512" r="144" fill="#222925"/>
  <circle cx="512" cy="512" r="56" fill="#F7F8F4"/>
</svg>
```

- [ ] **Step 4: Generate only the repository-owned icon outputs**

Run Tauri generation in a temporary directory, then copy only the six existing outputs:

```bash
tmp_dir="$(mktemp -d)"
trap 'rm -rf -- "${tmp_dir}"' EXIT
cargo tauri icon \
  apps/studio-desktop/src-tauri/icons/agentmesh.svg \
  --output "${tmp_dir}"
for asset in \
  32x32.png \
  128x128.png \
  128x128@2x.png \
  icon.png \
  icon.icns \
  icon.ico
do
  cp -- "${tmp_dir}/${asset}" "apps/studio-desktop/src-tauri/icons/${asset}"
done
```

Expected: Tauri reports generated platform icons; the repository gains no Android, iOS, or Windows Store asset directories.

- [ ] **Step 5: Verify dimensions, formats, and visual downscales**

Run:

```bash
for asset in \
  apps/studio-desktop/src-tauri/icons/32x32.png \
  apps/studio-desktop/src-tauri/icons/128x128.png \
  apps/studio-desktop/src-tauri/icons/128x128@2x.png \
  apps/studio-desktop/src-tauri/icons/icon.png
do
  sips -g pixelWidth -g pixelHeight "${asset}"
done
file \
  apps/studio-desktop/src-tauri/icons/icon.icns \
  apps/studio-desktop/src-tauri/icons/icon.ico
sips -z 16 16 apps/studio-desktop/src-tauri/icons/icon.png \
  --out /tmp/agentmesh-converge-16.png
sips -z 64 64 apps/studio-desktop/src-tauri/icons/icon.png \
  --out /tmp/agentmesh-converge-64.png
```

Expected dimensions: `32x32`, `128x128`, `256x256`, and `512x512`. Inspect the 16px, 32px, 64px, and 128px files with the image viewer; all four arms, the graphite hub, and the light center must remain distinguishable.

- [ ] **Step 6: Run the focused regression tests and confirm GREEN**

Run:

```bash
npm run build:node
node --test --test-name-pattern \
  "canonical AgentMesh icon|studio desktop distribution wires" \
  dist-node/tests-node/studio-desktop-distribution.test.js
git diff --check
```

Expected: both selected tests pass and `git diff --check` prints no errors.

- [ ] **Step 7: Commit the canonical source, generated assets, and test**

```bash
git add \
  apps/studio-desktop/src-tauri/icons/agentmesh.svg \
  apps/studio-desktop/src-tauri/icons/32x32.png \
  apps/studio-desktop/src-tauri/icons/128x128.png \
  apps/studio-desktop/src-tauri/icons/128x128@2x.png \
  apps/studio-desktop/src-tauri/icons/icon.png \
  apps/studio-desktop/src-tauri/icons/icon.icns \
  apps/studio-desktop/src-tauri/icons/icon.ico \
  tests-node/studio-desktop-distribution.test.ts
git commit -m "重新设计 AgentMesh Converge 图标"
```

Expected: one asset-focused commit with no version, package, or distribution metadata changes.

---

### Task 2: Build And Verify The Icon On The Local Desktop App

**Files:**
- Verify only: `apps/studio-desktop/src-tauri/target/debug/bundle/dmg/AgentMesh_0.1.10_aarch64.dmg`
- Install locally: `/Applications/AgentMesh.app`

**Interfaces:**
- Consumes: the six generated icon assets from Task 1.
- Produces: a locally installed AgentMesh app that displays the Converge icon while retaining runtime version `0.1.10`.

- [ ] **Step 1: Run desktop package smoke**

```bash
npm run studio-desktop:package:dev
```

Expected: sidecar verification and `mode: "dev"` distribution smoke return `ok: true` with no issues or warnings.

- [ ] **Step 2: Build a fresh DMG**

```bash
cargo tauri build \
  --config apps/studio-desktop/src-tauri/tauri.conf.json \
  --bundles dmg \
  --debug
hdiutil verify \
  apps/studio-desktop/src-tauri/target/debug/bundle/dmg/AgentMesh_0.1.10_aarch64.dmg
```

Expected: Tauri creates the Apple Silicon DMG and `hdiutil` reports a valid checksum.

- [ ] **Step 3: Replace the local app from the built DMG**

```bash
osascript -e 'tell application "AgentMesh" to quit' || true
mount_dir="$(mktemp -d)"
trap 'hdiutil detach "${mount_dir}" >/dev/null 2>&1 || true; rmdir "${mount_dir}" >/dev/null 2>&1 || true' EXIT
hdiutil attach -nobrowse -readonly \
  -mountpoint "${mount_dir}" \
  apps/studio-desktop/src-tauri/target/debug/bundle/dmg/AgentMesh_0.1.10_aarch64.dmg
rm -rf -- /Applications/AgentMesh.app
ditto --rsrc --extattr "${mount_dir}/AgentMesh.app" /Applications/AgentMesh.app
open /Applications/AgentMesh.app --args \
  --workspace /Users/zz/Documents/WebStorm/agentmesh
```

Expected: `/Applications/AgentMesh.app` is replaced and starts successfully against the project workspace.

- [ ] **Step 4: Verify installed version, process, and visual result**

```bash
defaults read /Applications/AgentMesh.app/Contents/Info CFBundleShortVersionString
node -e "const p=require('/Applications/AgentMesh.app/Contents/Resources/package.json'); console.log(p.version)"
pgrep -fl 'agentmesh-studio-desktop|AgentMesh.app/Contents/Resources/dist-node/apps/studio-desktop/sidecar/node'
git status --short
```

Expected: both version reads print `0.1.10`, the desktop and sidecar processes are running, and the only repository state outside committed work is the ignored or removable `.superpowers/` visual-companion session. Inspect Finder, Dock, and the running application switcher: the Converge icon must match the approved white-background, four-arm design at normal system size.

- [ ] **Step 5: Record completion evidence**

Report:

```text
- focused icon tests: pass
- desktop package smoke: pass
- DMG checksum: valid
- installed app version: 0.1.10
- Dock/Finder/app switcher visual check: pass
- npm/GitHub publishing: not performed
```

No additional source commit is expected from Task 2 because its outputs are ignored build artifacts and a local application installation.
