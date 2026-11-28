# Agent Note: Empty-state UI-slice illustrations

Status: proposed

English | [中文](2026-11-16-empty-state-ui-slices.zh.md)

## Problem

The shared [`EmptyState`](../../../../packages/ui/src/components/composites/empty-state/empty-state.tsx) draws one of two small line illustrations, `inbox` or `book`, for every empty surface; its `preset` prop is a documented no-op. An inventory of the renderer found 183 empty-state call sites in three unrelated styles: 42 with the line illustration, 18 with a bare icon, and 90 with muted text only. The illustrations do not show what will fill the surface or where the next step is, and they read as a generic placeholder rather than as Cherry Studio.

A local design study redrew all 47 distinct empty-state scenes and was reviewed with the product owner over nine rounds. Literal objects (bookshelf, pencil, plug), tinted or soft-3D bodies, per-scene palettes, and icon-only hubs were each tried and rejected. The accepted direction is a slice of the real product UI. It needs color and depth that [DESIGN.md](../../../../DESIGN.md) currently forbids for ordinary UI, so it needs an explicit, scoped exception instead of an unreviewed local palette.

## Proposal

### Visual contract

- A scene is a cropped slice of the surface the empty state lives in: real layout (rows, inputs, menus, tables, grids) with real localized words, drawn on neutral semantic surfaces with 1px top-lit borders and a soft shadow. It fades into its container through a radial edge mask instead of a frame.
- One accent per scene marks only the next step: the add slot, the focused input, the hovered row, or the primary control. Three pixel sprites, small cell patterns in the family of the profile Outputs empty state ([#24562](https://github.com/CherryHQ/cherry-studio/pull/24562)), sit on the slice edge in two further palette colors.
- No literal clip-art objects, no tinted or gradient surfaces, and never more than one accent in a scene.
- Motion is limited to a slow sprite float, a slow drift of one floating element (a popover or dragged card), and a blinking caret. All of it stops under `prefers-reduced-motion: reduce`.
- The scene is decorative: it is `aria-hidden` and not focusable. The title, description, and actions remain the accessible content.

### Ownership

- `@cherrystudio/ui` owns app-agnostic primitives next to `EmptyState` in `composites/empty-state/`: an `EmptyStateScene` frame (size `page | panel | sidebar`, accent and sprite palette indices, edge fade, sprites) and slice building blocks (surface, header, row, input, button, chip, dashed slot, toggle, caret, cursor, divider, placeholder bar). They are built from DOM elements, Tailwind semantic utilities, and lucide icons, and receive every word as a prop. They import nothing from `@renderer`.
- `EmptyState` gains a `scene?: ReactNode` prop rendered in place of the line illustration. Without it, `EmptyState` renders exactly as today, so unmigrated call sites keep `inbox` and `book`.
- `@cherrystudio/ui` also owns the compact templates described below: `EmptyStateMark`, a small top-lit tile carrying an icon, plus the components built on it.
- Each concrete scene composition is a renderer component co-located with its single owner, following routing rule 0 of the [renderer architecture](../../../../docs/dev/references/architecture/renderer.md). It translates its words with `t()`, reusing an existing key when the meaning is identical and adding owner-namespaced keys otherwise.

### Illustration palette

- Add the product semantic variables `--illustration-1` through `--illustration-8`. The domain is `illustration` and the roles are numbered like `chart-*`, without palette names. Their providers are the primitive sky, orange, emerald, pink, amber, violet, teal, and rose 500 steps in both modes.
- Register them in the product allowlist and the Tailwind color export, and extend the theme contract tests, the [variable catalog](../../../../packages/ui/docs/variable-catalog.md), and the [design token system](../../../../packages/ui/docs/design-token-system.md).
- The only consumer is `EmptyStateScene`. A scene chooses its accent and sprite colors by index explicitly; there is no automatic rotation.
- DESIGN.md gains a scoped rule: decorative empty-state scenes may use the `illustration-*` roles, the edge fade, and slice shadows. The palette is not used anywhere else, and a scene's accent still marks only its next step.

### First scenes

Six representative scenes land first. Copy stays unchanged except where a surface has none today.

| Scene | Owner | Change |
| --- | --- | --- |
| No knowledge bases | `KnowledgePageEmptyStateSection` | Knowledge panel with an accent drop zone and a file being dragged in |
| No conversation selected | `ConversationCenterState` (home and agent chat) | Today the empty branch renders a blank panel. It gains a chat-list slice with a hovered row, a title, and a description. Home chat adds a New conversation action through its existing new-topic handler; agent chat has no such handler and shows no action. |
| No note open | `NotesEditor` | Untitled page with an accent caret and a slash-command menu |
| No files / no match | `FilesPage` | Files table with an accent drop row |
| No mini apps / search miss | `MiniAppsPage` | Launcher grid with an accent add tile and an add-URL popover |
| No notifications | `NotificationCenter` | Notification panel with read items and an accent all-read chip |

### Remaining scenes

The other 41 scenes from the inventory follow the same contract and copy rule. Each owner switches its empty state to an `EmptyState` with a scene; text-only or blank surfaces keep their existing words as the title.

| Area | Scenes (owners) |
| --- | --- |
| Chat and agent panes | topic list, task list, assistant/agent rail, message flow canvas, trace, artifact ready, artifact open-a-file (also the skill file browser), subagent flow, browser tabs |
| Search, history, library, marketplace | global search, history records (chat and agent), resource grid (also prompt settings and painting prompt presets), assistant library, skill marketplace, skill import, marketplace search |
| Knowledge, notes, files | data sources, chunks, recall test, note import, notes tree, file preview with its folder, invalid, unavailable and empty variants |
| Apps and tools | code tool selection, code providers, translation history, PDF translation, scheduled tasks, painting artboard |
| Settings | settings search, browser history, MCP servers/prompts/resources, models, API keys, usage, archive, missing skill, channels, devices, backups, diagnostics, onboarding without models |

### Compact templates

Small empty states that should not carry a scene use six shared templates. They are applied where they help, not mechanically: a template replaces a standalone empty message, while a phrase inside other content, a toast, or a select placeholder stays as it is.

| Template | Component | Applies to |
| --- | --- | --- |
| T1 sidebar list | dashed empty row | an empty group or section inside a sidebar list |
| T2 dropdown "No results" | default empty rendering of `Combobox`, `TreeSelect` and `CommandEmpty` | every searchable picker and command list, through the library; caller text still wins |
| T3 table empty row | default empty row of `DataTable` | every data table, through the library |
| T4 dashed inline placeholder | `EmptyPlaceholder` with mark, title, description and optional action | an empty slot inside a form or card that can be filled in place |
| T5 quick-panel row | disabled quick-panel row with a muted icon | empty mention and slash-command lists in the composer |
| T6 helper note | `EmptyNote` with an icon in a subtle box | a standalone read-only note inside a dialog, tool result or settings row |

### Delivery

The Spec PR is followed by stacked implementation layers:

1. The palette, the DESIGN.md rule, the `@cherrystudio/ui` scene primitives, and the `scene` prop, with stories and tests.
2. The six first scenes.
3. Chat and agent panes.
4. Search, history, library, and marketplace.
5. Knowledge, notes, and files.
6. Apps and tools.
7. Settings.
8. `EmptyStateMark`, T2, and T3 in `@cherrystudio/ui`.
9. T1, T4, T5, and T6 at their call sites.

Each template layer's PR lists every inventory site it leaves unchanged and why. The hard-coded English defaults in `@cherrystudio/ui` and the dead `preset` prop are separate work.

## Alternatives considered

- **Keep or extend the line illustrations.** More variants of `inbox` and `book` still show a generic object and never the next step. The review rejected literal objects across several rounds.
- **SVG artwork per scene, as in the design study.** SVG text does not follow app font metrics or wrapping, so translated words have to be measured by estimate, and inline palette values bypass semantic tokens. DOM primitives keep real fonts, theme switching, and tokens.
- **Text-free slices with gray bars.** These need no i18n keys, but the owner chose real words because they are what makes a slice read as current product UI.
- **`primary` accent and `chart-*` sprites without changing DESIGN.md.** This brings back the green theme accent the owner rejected, and it repurposes data-category roles as decoration.
- **Neutral only.** This complies with the current rules but was judged too plain.
- **Tinted bodies, soft 3D, per-scene three-color palettes, glass icon tiles, hairline icon hubs.** Each was prototyped and rejected in review as dated, noisy, or blurred.
- **All 47 scenes in one PR.** The diff would be too large to review, and every scene would depend on primitives not yet reviewed.
- **Applying every compact template mechanically.** Many inventory sites are a phrase inside other content, a toast, or a select placeholder; boxing them would make the UI heavier without clarifying anything.

## Acceptance criteria

- AC1 — `EmptyState` with a `scene` renders that scene instead of the line illustration, the scene is `aria-hidden`, and the title, description, and actions stay accessible and operable (verification: unit)
- AC2 — `EmptyState` without a `scene` renders as before, including `illustration="book"` and icon overrides (verification: unit)
- AC3 — `--illustration-1` through `--illustration-8` resolve in light and dark modes, are registered in the product allowlist and Tailwind colors, and `pnpm --filter @cherrystudio/ui theme:check` passes (verification: unit)
- AC4 — DESIGN.md, the variable catalog, and the design token system document the illustration palette and its single permitted use (verification: docs gate)
- AC5 — Scene sprites, drift, and caret animate normally and are static under `prefers-reduced-motion: reduce` (verification: Electron)
- AC6 — The knowledge, notes editor, files (no files and no match), mini apps (no apps and search miss), and notification center empty states show their scenes with unchanged titles, descriptions, and actions in light and dark themes (verification: Electron)
- AC7 — Home chat without a topic shows the conversation-center scene, title, description, and a New conversation action that creates a topic through the existing handler; agent chat without a session shows the scene, title, and description without that action (verification: renderer)
- AC8 — Every word drawn inside the six scenes comes from i18n keys, `i18n:check` passes with no placeholders in any locale, and the Chinese UI shows no English UI words inside the scenes (verification: renderer)
- AC9 — The six scenes fit their containers without clipping or overflow at the sizes they render in, in English and Chinese (verification: Electron)
- AC10 — The 41 remaining scenes render at their owners with existing copy unchanged unless the surface had none, in light and dark themes (verification: Electron)
- AC11 — Every word drawn inside any of the 47 scenes comes from i18n keys, and the Chinese UI shows no English UI words inside them (verification: renderer)
- AC12 — `Combobox`, `TreeSelect`, `CommandEmpty`, and `DataTable` render their empty message with `EmptyStateMark`, and caller-provided empty text still wins (verification: unit)
- AC13 — The T1, T4, T5, and T6 call sites chosen in their layer render through the shared templates, and each unchanged inventory site is listed with its reason in that layer's PR (verification: renderer)
- AC14 — All scenes and compact templates fit their containers without clipping or overflow in English and Chinese (verification: Electron)

## Risks

- **Visual weight.** A scene carries more pixels than a line drawing. The one-accent rule, neutral surfaces, and reduced-motion handling keep it secondary to the title and action.
- **Palette leakage.** `illustration-*` utilities are available to any component. The DESIGN.md rule and review restrict them to `EmptyStateScene`.
- **Translation cost.** Each scene adds a few keys in every locale. Reusing existing keys limits the count, and `i18n:check` prevents placeholders.
- **Drift from real UI.** A slice imitates its surface and can fall out of date when that surface changes. Scenes are illustrative and need not match pixel for pixel; they are updated when they become misleading.
- **Overlap with independent fixes.** #24683 (removes `preset`) and #24684 (text fallbacks for empty rails and the notes tree) touch the same call sites as layers 2, 3, and 5. Whichever merges second rebases; the scenes replace the text fallbacks.
- **Overlap with #24562.** The open Outputs empty state draws its own pixel sprites. It can adopt the shared sprite primitive after both land; neither blocks the other.
