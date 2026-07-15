# Studio Silver Interface Design

## Goal

Refresh the AgentMesh Studio and Desktop interface with a restrained macOS-style
silver visual system while preserving every existing feature, route, API, and
workflow. The result should feel calmer, more native, and easier to scan without
turning the product into a presentation-oriented dashboard.

This visual refresh ships together with the next available patch release. Based
on the current local version, that release is expected to be `0.1.11`; the exact
version must be confirmed against npm and GitHub immediately before bumping it.

## Approved Direction

The approved direction is **A: Silver Light** with **balanced compact** density.

The reference image contributes four visual cues:

- a quiet silver squircle and soft metallic depth
- a dark graphite center that anchors the composition
- cyan orbital lines used as a precise accent
- restrained highlights instead of saturated decoration

These cues become a light desktop interface, not a globally dark application.
The current coral primary color is replaced by cyan for primary actions,
selection, focus, and progress. Green, amber, and red remain reserved for
semantic success, warning, and failure states.

## Current Facts

- Studio uses React 19 and Mantine 9 with a single light-only
  `StudioThemeProvider`.
- The application shell, navigation, panels, and responsive behavior already
  have stable semantic classes in `apps/studio-web/src/styles.css`.
- The current interface uses warm white surfaces, coral primary actions, teal
  secondary accents, repeated one-pixel borders, and nearly flat card depth.
- Existing frontend behavior, update state machines, keyboard tab navigation,
  and API clients are already covered by repository tests.
- Desktop renders the same Studio frontend inside Tauri, so the refresh must not
  fork browser and Desktop presentation logic.

## Scope and Implementation Boundary

The refresh changes the visual system and makes small layout hierarchy
improvements. It does not redesign product information architecture.

Implementation should:

- centralize color, radius, shadow, spacing, and motion tokens
- update Mantine theme defaults so stock controls share the same visual language
- restyle the shell, navigation, tabs, controls, feedback, panels, cards,
  modals, drawers, and content previews
- reduce nested-border noise by using background tone and elevation for grouping
- add only the minimum semantic class hooks needed for stable styling
- preserve existing component ownership and React state flow

Implementation must not add a second UI library, a runtime styling dependency,
or a Desktop-only frontend fork. Existing DOM order, accessible labels, keyboard
behavior, API calls, and update/install logic remain authoritative.

## Visual System

### Palette

The canonical CSS tokens are organized by role rather than by individual page:

- canvas: cool silver-gray around `#EDF0F3`
- primary surface: translucent or solid near-white around `#FFFFFF`
- secondary surface: cool grouped gray around `#E7EBEF`
- strong ink: graphite around `#1D2937`
- muted ink: cool gray around `#7B8794`
- primary cyan: around `#3EB8C8`
- primary soft: pale cyan around `#DEF6F8`
- success: around `#46B978`
- warning: warm amber around `#E4A63D`
- danger: restrained red around `#DC6666`

Final token values may be adjusted slightly during browser verification to meet
contrast requirements, but their roles and relative temperature are fixed.

### Material and Depth

The application canvas uses a subtle silver gradient. The navigation rail and
top bar use a light translucent surface with a restrained blur where supported.
Content surfaces use at most three levels:

1. grouped background with no border
2. normal surface with a faint separator or inset edge
3. interactive or selected surface with a small shadow and cyan rail/outline

Blur and gradients are decorative enhancements. Solid fallback colors must keep
the full hierarchy legible when `backdrop-filter` is unavailable.

Corners use a consistent hierarchy: larger shell surfaces, medium panels, and
smaller controls. Shadows remain cool and low-opacity. No content card should
combine a strong border, strong shadow, and tinted background at the same time.

### Typography and Density

Retain the current system-first font stack and existing type scale. Improve
hierarchy through weight, color, and spacing rather than adding a display font.
Navigation and toolbars stay compact; content panels gain enough vertical space
to separate labels, values, and actions. Long paths, IDs, and artifact content
must continue to wrap or truncate according to their existing purpose.

### Motion

Hover, focus, selection, and panel transitions use durations between 120 and
180 milliseconds. Motion is limited to color, border, shadow, and at most a
one-pixel lift. Under `prefers-reduced-motion: reduce`, non-essential transitions
and transforms are disabled.

## Application Shell

The shell keeps the current navigation/content relationship but clarifies its
hierarchy:

- the left rail becomes the primary silver material surface
- the AgentMesh brand area uses the dark-core/cyan-orbit motif at small size
- top-level workspace choices and run/call navigation have distinct grouping
- selected items use a cyan left rail plus a pale cyan-white surface
- the top bar becomes a quiet title and context surface with actions aligned to
  the right
- the workspace canvas groups content with tone and spacing instead of repeated
  framed panels

Run, Call, Settings, Definitions, and Manual view selection remains unchanged.
No action is moved to a different route or hidden behind a new menu.

## Component Language

### Actions and fields

- Primary buttons use cyan with white text and restrained depth.
- Secondary buttons use a white/silver surface; light buttons use pale cyan.
- Destructive buttons use the danger semantic palette, never the primary color.
- Inputs use cool white surfaces, subtle inset depth, and a cyan focus ring.
- Disabled controls retain their shape and label while reducing contrast.

### Navigation

Segmented controls and tabs use a grouped silver track with a white active
surface. Active text is graphite; cyan appears as focus or selection detail, not
as a large saturated fill. Existing arrow, Home, and End keyboard behavior is
preserved.

### Status and feedback

Informational, success, warning, and error states use distinct icon/label text in
addition to color. Loading and update progress use cyan. Compatibility warnings
and update failures preserve their current content and recovery actions while
moving into a consistent feedback surface.

### Cards and panels

Static information grouping uses a low-contrast background without extra
elevation. Cards receive elevation only when they are interactive or need
independent attention. Selection uses a cyan rail/outline. Dense metadata grids
remain grids but gain more reliable label/value separation.

### Overlays and content previews

Modals and drawers use the same surface, radius, and separator tokens. Code and
artifact previews remain optimized for reading: their content backgrounds stay
solid enough for contrast and do not inherit translucent shell effects.

## Data Flow and Error Handling

There is no new product data flow. Existing React state, API clients, Tauri
dynamic imports, update checks, downloads, installs, and relaunch behavior remain
unchanged.

The visual layer maps each existing state to one semantic presentation:

- idle/current/read-write: neutral or success
- checking/downloading/restarting: informational/progress
- update available/read-only: warning or primary call to action, depending on
  whether the user can act immediately
- failed/refused/unavailable: warning or danger with the existing explanation
  and retry/manual recovery path

An update or installation error must never visually imply that the installed
version was removed. The current working version remains visible alongside the
recovery action.

## Responsive Behavior

The primary acceptance viewport is `1280 x 720`, matching the current Desktop
usage. `1024 x 640` must remain fully operable without clipped primary actions.

- Wide layouts keep the navigation rail and existing run detail sidebar.
- Medium layouts reduce gaps and card columns before reducing type size.
- Narrow layouts use the existing shell collapse behavior and convert summary
  and settings grids to one column.
- Tables, code, and artifact bodies scroll within their intended containers
  instead of expanding the entire application shell.

The refresh does not introduce a new mobile-specific information architecture.

## Accessibility

- Normal text and essential controls must meet WCAG AA contrast.
- Focus-visible states must remain obvious on both white and silver surfaces.
- Status must never depend on color alone.
- Existing semantic elements, accessible names, keyboard navigation, and hidden
  panel behavior are preserved.
- Reduced-motion users do not receive decorative movement.

## Verification and Acceptance

The implementation is accepted when all of the following hold:

1. Existing unit, frontend, CLI, update, and distribution tests pass.
2. TypeScript build, Studio frontend build, Rust `cargo check`, and Desktop dev
   packaging pass.
3. Browser inspection covers Run, Call, Settings, Definitions, Manual, modal,
   drawer, empty, loading, success, warning, and error states.
4. Visual checks at `1280 x 720` and `1024 x 640` show no clipped actions,
   overlapping text, inaccessible scroll regions, or regressions in hierarchy.
5. Keyboard focus, tabs, segmented controls, and update actions remain operable.
6. Desktop smoke confirms the shared design renders correctly in Tauri and the
   app updater behavior is unchanged.
7. A final code review reports no unresolved Must Fix or Should Fix findings.

## Release and Local Upgrade

After verification and review:

1. Confirm the latest npm package and GitHub Release versions.
2. Bump every canonical version source to the next available patch version.
3. Synchronize changelog and release notes with the UI refresh and the already
   completed CLI/Desktop update features.
4. Commit in Chinese following the repository convention and push the branch.
5. Publish npm and the complete GitHub release set, including DMG, checksums,
   updater archive/signature, and `latest.json`.
6. Verify remote assets and updater metadata before local installation.
7. Upgrade the local CLI and installed Desktop app, then verify their reported
   versions and startup behavior.

Signing keys and passwords remain outside the repository and must never appear
in logs, commits, generated metadata beyond the public updater signature, or
assistant output.

## Non-Goals

- adding a dark theme or automatic light/dark theme switching
- changing product routes, feature ownership, API contracts, or state machines
- introducing a mobile redesign
- replacing Mantine or adding another component library
- changing npm/GitHub update channels or supported platforms
- changing the application icon as part of this interface refresh
