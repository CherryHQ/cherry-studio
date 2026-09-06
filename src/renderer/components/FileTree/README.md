# FileTree

App-level wrapper around [`@pierre/trees`](https://trees.software) — the shared file tree for the agent
artifact pane (`components/chat/panes/ArtifactPane.tsx`) and the notes sidebar (`pages/notes/NotesSidebar.tsx`).

It lives in the renderer rather than `@cherrystudio/ui` because it depends on renderer-only pieces:
`CommandContextMenu`, `getFileIconName`, and i18n.

## Why not a headless tree

The tree renders its rows **inside a shadow root**, so Tailwind classes and DESIGN.md tokens do not
cascade in. This is a deliberate, documented exception to the "build with Tailwind + `@cherrystudio/ui`"
rule: we get virtualization, path-first incremental mutation, search, DnD, rename, and sticky folders
from the library instead of maintaining them. The host element still takes normal `className` / `style`.

## Pinned facts (verified against `1.0.0-beta.6`)

The dependency is **beta with no stable release**. It is pinned to an exact version on purpose — do not
add a caret. Re-verify everything below when bumping.

### Registration is a required side effect

`<FileTree>` renders a `<file-tree-container>` custom element, but `customElements.define()` only runs in
the `@pierre/trees/web-components` entry, and its `connectedCallback` is what attaches the shadow root and
adopts the core stylesheet. **`import '@pierre/trees/web-components'` once** or the tree renders nothing.

### Model lifetime is ours, not React's

- `useFileTree()` calls `model.cleanUp()` from an effect cleanup (behind a 1ms `setTimeout` that only
  absorbs StrictMode's double invoke). `<Activity mode="hidden">` runs effect cleanups, so a hook-owned
  model is destroyed and rebuilt on every right-pane toggle / tab switch — the exact churn this component
  exists to avoid.
- `<FileTree model>` calls **`model.unmount()`** on unmount, which tears down the mounted runtime and
  **keeps the model alive**.

So: **construct `new FileTree(options)` yourself, above the `<Activity>` boundary, and pass it in.**
Call `cleanUp()` only when the underlying workspace/notes root really goes away.

### Options are read once

Constructor options are not reactive — "later option changes do not reconfigure the model". After
construction, everything goes through model methods:

- write — `add` / `remove` / `move` / `batch` / `resetPaths` / `startRenaming` / item handles
- reconfigure — `setIcons` / `setComposition` / `setGitStatus`
- read — `getItem` / `getSelectedPaths` / `getFocusedPath` / `getVisibleRows` / `getVisibleCount`
- subscribe — `subscribe(listener)`, `onMutation(type, handler)` where `type` is an operation name or `'*'`

React reads go through `useFileTreeSelector` / `useFileTreeSelection` / `useFileTreeSearch` from
`@pierre/trees/react`.

### A trailing slash marks a directory

`'src/index.ts'` is a file; `'empty/'` is a directory with no known children. That is how a directory that
is empty — or not lazily loaded yet — stays expandable. Canonical paths for directories keep the trailing
slash, so `data-item-path` and every id↔path mapping must expect it.

### Lazy directories are polled, not pushed

The path store already implements a real lazy-load protocol (`markDirectoryUnloaded`, `beginChildLoad`,
`applyChildPatch`, `completeChildLoad`, and a `mark-directory-unloaded` mutation event), but none of it is
reachable from the public `FileTree` class in `1.0.0-beta.6`, and there is no expansion callback.

So the Artifact tree keeps a bounded set of *unloaded* directory paths — the boundary layer of the current
scan — and on each `subscribe()` notification checks only those with `getItem(path)?.isExpanded()`. That is
O(unloaded dirs) with O(1) lookups, not O(tree). Counting visible rows cannot substitute: expanding an
unloaded directory adds no rows, so the count does not change. Revisit when the library exposes the
protocol.

### No expanded-paths getter

There is `initialExpandedPaths` and per-item `expand()` / `collapse()` / `isExpanded()`, but no
`getExpandedPaths()`. To persist expansion, derive it from
`getVisibleRows(0, getVisibleCount())` filtering `isExpanded` — bounded by visible rows, not tree size.

`remapExpandedPathsForFolderRename` exists in the package but is **not** exported from any public entry
point; folder renames must remap persisted expansion ourselves.

### Sticky folders are native

`FileTreeRenderOptions.stickyFolders?: boolean` — no `unsafeCSS` needed, unlike what the migration plan
assumed.

## Icons

`FileTreeIconConfig`:

```ts
{ set?: 'minimal' | 'standard' | 'complete' | 'none'
  colored?: boolean
  spriteSheet?: string                        // SVG string of <symbol> defs, injected into the shadow DOM
  remap?: Record<string, RemappedIcon>        // built-in slots: file, chevron, dot, lock
  byFileName?: Record<string, RemappedIcon>   // exact basename
  byFileExtension?: Record<string, RemappedIcon>   // NO leading dot; 'spec.ts' beats 'ts'
  byFileNameContains?: Record<string, RemappedIcon> }

type RemappedIcon = string | { name: string; width?: number; height?: number; viewBox?: string }
```

Resolution order: `byFileName` → `byFileNameContains` → `byFileExtension` (more specific suffix wins) →
built-in set → generic file slot.

We use `set: 'none'` plus a generated `spriteSheet` so the material-icon-theme look is preserved — see
`iconSprite.generated.ts` and `scripts/generate-file-tree-icon-sprite.ts`. Regenerate with
`pnpm gen:file-tree-icons`; CI regenerates and fails on drift.

Two pre-existing quirks the generator surfaced, both left as-is so the tree stays pixel-identical:

- `csv`, `shell`, `wasm`, `windows`, `visualbasic` are not real material-icon-theme names, so those file
  types render a blank icon today. They are skipped rather than mapped.
- Directory rows render **only a chevron** (`FileTreeView.js` picks `file-tree-icon-chevron` for
  `kind === 'directory'`) and there is no folder icon slot. That matches today: `folder` / `folder-open`
  are not real names either, so the old tree drew nothing there. The real names are
  `folder-base` / `folder-base-open` if we ever want folder glyphs.

## Theming

196 `--trees-*` custom properties. Precedence is `--trees-<name>-override` > `--trees-theme-*` (produced by
`themeToTreeStyles(theme)` from a VS Code / Shiki shaped `{ type, bg, fg, colors }`) > library defaults.

`treeTheme.ts` owns the mapping from our design tokens. The families we set:

| family | keys |
| --- | --- |
| panel | `--trees-bg-override`, `--trees-fg-override`, `--trees-fg-muted-override`, `--trees-bg-muted-override`, `--trees-accent-override`, `--trees-border-color-override`, `--trees-border-radius-override` |
| selection / focus | `--trees-selected-bg-override`, `--trees-selected-fg-override`, `--trees-selected-focused-border-color-override`, `--trees-focus-ring-{color,width,offset}-override` |
| type | `--trees-font-family-override`, `--trees-font-size-override`, `--trees-font-weight-{regular,semibold}-override` |
| metrics | `--trees-density-override`, `--trees-level-gap-override`, `--trees-item-{padding-x,margin-x,row-gap}-override`, `--trees-padding-inline-override`, `--trees-icon-{width,nudge}-override`, `--trees-indent-guide-bg-override` |
| search | `--trees-search-{bg,fg,font-weight}-override`, `--trees-input-bg-override` |
| scrollbar | `--trees-scrollbar-{thumb,gutter}-override` |

Git-status and per-file-type icon-color variables exist but are unused — we do not surface git status.

`<FileTree>` injects `--trees-item-height` and `--trees-density-override` itself and spreads
`style` **after** them, so our overrides win.

`unsafeCSS` is an escape hatch. Anything using it must say so in a comment.

## Context menu

The library's own context menu is left disabled and `renderContextMenu` is **not** used. Instead the host
listens for `contextmenu`, walks `event.composedPath()` through the shadow root to the
`button[data-type='item']` row, and drives `CommandContextMenu`.

Reason: `CommandMenus.tsx`'s `resolveMenuPresentationMode` supports a **native** Electron popup menu that
renders no DOM at all. `renderContextMenu` returns a ReactNode into a shadow slot, which would pin us to
the Radix ("cherry") presentation and drop native menus.
