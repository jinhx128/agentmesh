# AgentMesh Converge Icon Design

## Goal

Replace the current dark list-like AgentMesh app icon with a distinctive,
small-size-safe mark that communicates multiple agents converging on one
orchestration core.

The approved direction is **B: Converge**.

## Visual Language

The icon uses one bold central symbol on a quiet macOS-style squircle:

- four broad colored paths represent independent agents
- the paths converge behind one graphite hub, representing AgentMesh orchestration
- a small light center represents the shared execution context
- the off-white background removes the visual weight of the current black tile

The icon contains no text, gradients, shadows, outlines, or fine decorative
details. Its silhouette and color blocks must remain recognizable at 16px and
32px.

## Canonical Geometry

`apps/studio-desktop/src-tauri/icons/agentmesh.svg` remains the only editable
source. It uses a `1024 x 1024` view box.

- background: rounded rectangle at `(32, 32)`, size `960 x 960`, radius `232`
- teal path: `(512, 488)` to `(272, 272)`
- amber path: `(536, 496)` to `(752, 280)`
- coral path: `(528, 536)` to `(752, 752)`
- blue path: `(488, 536)` to `(272, 752)`
- path width: `112`, round caps
- graphite hub: center `(512, 512)`, radius `144`
- light center: center `(512, 512)`, radius `56`

The four paths render below the hub so the center masks their joins. The mark
keeps generous outer padding and does not rely on subpixel alignment.

## Palette

- background: `#F4F5F2`
- graphite hub: `#222925`
- light center: `#F7F8F4`
- teal: `#4AB7A6`
- amber: `#FFB23E`
- coral: `#F07258`
- blue: `#5A84D6`

All colors are flat fills. The palette intentionally uses warm and cool accents
so the icon does not read as a one-hue AI product.

## Generated Assets

The SVG source generates the existing Tauri asset set:

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.png`
- `icon.icns`
- `icon.ico`

Generation must use the repository's installed Tauri tooling. No asset is
hand-edited after generation, and no new runtime dependency is introduced.

## Compatibility

The filenames and Tauri configuration remain unchanged. The redesign therefore
does not change bundle identifiers, update channels, executable names, package
layout, or application behavior.

The macOS DMG remains Apple Silicon and unsigned under the current distribution
policy.

## Verification

The implementation is accepted when all of the following hold:

1. The canonical SVG matches the geometry and palette above.
2. Every generated asset exists, is non-empty, and reports its expected format
   and dimensions.
3. Rendered previews at 16px, 32px, 64px, and 128px preserve four distinct arms,
   a solid hub, and a visible light center without muddy seams.
4. `studio-desktop` distribution tests and package smoke pass.
5. A fresh macOS DMG builds successfully.
6. The rebuilt app is installed locally and verified in Finder, the Dock, and
   the running application switcher.

## Out Of Scope

- changing the AgentMesh product name or wordmark
- adding animation or alternate theme variants
- changing Studio UI colors to match the icon
- enabling signing, notarization, or automatic desktop updates
