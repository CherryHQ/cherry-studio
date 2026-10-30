# Agent Note: Cherry default code theme

Status: implemented

English | [中文](2026-10-28-cherry-default-code-theme.zh.md)

## Problem

The code theme preferences default to `auto`, which used to resolve to third-party themes: `one-light` / `material-theme-darker` for code viewing and `materialLight` / `dark` for CodeMirror. Each painted its own solid editor background, so code areas never matched the surface that hosts them. The mismatch was most visible in dark mode, where the application background is translucent over macOS window vibrancy and no solid color can match it.

Swapping only the background of a third-party theme would break the contrast its syntax colors were designed for, so the default needs its own palette.

[Pierre code surfaces](../../proposed/architecture/2026-10-24-pierre-code-surfaces.md) and [message code block surfaces](../../proposed/architecture/2026-10-26-message-code-block-surfaces.md) own which preferences select a theme and preserve the `auto` defaults. This note decides what `auto` resolves to.

## Decision

### One theme, colors from CSS

`cherryCodeTheme` (`packages/ui/src/lib/code-highlight/theme.ts`) is a Zed-format Highlights theme named `cherry` with a CSS-variable palette (`cssVariables: { prefix: '--cherry-code-', defaults }`). Highlights and `getCodeBlockPalette` emit `var(--cherry-code-<role>, <default>)` instead of literal colors, so one theme name serves both appearances. A light/dark switch recolors code through CSS without re-tokenizing or reconfiguring any surface. `defaults` repeat the light values so exported HTML stays colored without application CSS.

The palette lives in the rich-text-and-code domain of `packages/ui/src/styles/product.css`: light values on `:root`, dark values on `.dark`, built only from existing `--cs-*` primitives and semantic roles.

### Palette

| Role | Light | Dark |
|---|---|---|
| Background | `transparent` | `transparent` |
| Foreground, variable, property, operator | `foreground` | `foreground` |
| Comment (italic), punctuation | `muted-foreground` | `muted-foreground` |
| Keyword, preprocessor, `this`/`self` | violet-700 | violet-300 |
| String | emerald-700 | emerald-300 |
| Number, boolean, constant, attribute | amber-700 | orange-300 |
| Type, class, namespace | cyan-700 | cyan-300 |
| Function | blue-600 | blue-300 |
| Markup tag | rose-700 | rose-300 |
| Link | `link` | `link` |
| Diff inserted / deleted | green-700 / red-600 | green-400 / red-400 |
| Invalid | red-600 | red-400 |

Variables and properties stay uncolored so that color marks only syntax. Dark-mode roles share one lightness band (OKLCH L 0.81–0.86), so no hue dominates. Every role meets WCAG AA (≥ 4.5:1) against white and against the translucent dark host. Diff text does not use `success` / `error`, because light `success` (green-500) measures 2.3:1 on white.

### Surfaces

- **Theme catalog and settings:** `resolveCodeTheme` accepts `cherry`, and `CodeStyleProvider` resolves `auto` to it in both appearances. Both theme selectors label `auto` as the Cherry default (`chat.settings.code_theme.cherry_default`).
- **Message viewer, Tiptap, and CodeMirror syntax:** `getCodeBlockPalette` maps a CSS-variable theme to `var(--cherry-code-*)` references.
- **Pierre files and diffs:** `src/renderer/utils/pierreCodeTheme.ts` registers `cherry` once on the main thread with `registerCustomTheme(..., 'zed')`; the worker pool resolves themes there and sends them to its workers.
- **Dark-mode detection:** for `cherry`, `isCodeThemeDark` follows the application appearance instead of a fixed `appearance` field.
- **Gutters:** line-number gutters are transparent and scroll horizontally with the code, as message viewer line numbers already do. Pierre (`unsafeCSS`) and CodeMirror (`gutters({ fixed: false })`) no longer pin the gutter, so code never passes beneath it. Pierre's floating editor widgets, such as search, derive their fill from `--diffs-bg`, so they use the opaque `popover` surface.
- **CodeMirror chrome:** with `chat.code.editor.theme_*` set to `auto`, `getCherryCmTheme` loads a Cherry chrome theme on demand instead of `materialLight` / `dark`. It uses a transparent background and takes text, caret, selection, gutter, and active-line colors from application tokens; syntax colors come from the same palette.

Explicitly selected third-party themes keep their full colors and background. Stored preference values are not rewritten, and no migration is needed.

## Alternatives considered

- **Override only the background of third-party themes:** rejected, because their syntax colors assume their own background, and on light hosts or the translucent dark host contrast is no longer guaranteed.
- **Two named themes (`cherry-light` / `cherry-dark`) with literal colors:** rejected. A mode switch would rebuild tokenizers, and a user could pair the light palette with the dark application.
- **A sticky gutter:** rejected. A transparent sticky gutter lets code show through during horizontal scrolling. An opaque one cannot match the translucent dark host: `var(--background)` is itself translucent, and a solid color showed as a distinct stripe (rejected by the user on 2026-10-28).
- **Keep CodeMirror chrome on `materialLight` / `dark`:** rejected by the user on 2026-10-28. Editors would keep a solid background beside immersive viewers.

## Consequences

- Users on `auto` see the Cherry theme instead of One Light / Material Darker; those themes remain selectable.
- When a long line is scrolled horizontally, its line number scrolls out of view.
- Message edit mode (shared syntax CodeEditor) also stops pinning its gutter, for every theme, so read and edit modes behave the same.
- The light colors appear twice: as CSS in `product.css` and as export `defaults` in `cherryCodeTheme`. `cherry-theme.test.ts` fails if they drift apart.
- Pierre still mixes diff and decoration tints with the transparent `--diffs-bg`; in Electron the inserted and deleted rows stayed readable in both modes.

## Verification

- AC1 — Local Electron run (2026-10-28, uncommitted harness mounting the real components): message code block, FileEditor, agent diff, Tiptap code block, and CodeMirror report transparent code backgrounds in light and dark on the vibrancy window.
- AC2 — `pnpm test:pkg:ui packages/ui/src/lib/code-highlight/__tests__/cherry-theme.test.ts`: resolves every `--cherry-code-*` role from the real CSS and fails if contrast drops below 4.5:1 on white or the translucent dark host.
- AC3 — `pnpm test:renderer src/renderer/components/__tests__/CodeStyleProvider.test.tsx src/renderer/components/__tests__/LazyCodeEditor.theme.test.tsx` plus the local Electron run: the theme stays `cherry` across a mode switch, the message keyword node survives while its color changes, and CodeMirror keeps its edit, selection, and undo.
- AC4 — `pnpm test:renderer src/renderer/components/__tests__/CodeStyleProvider.test.tsx src/renderer/components/__tests__/LazyCodeEditor.theme.test.tsx`: an explicit `nord` viewer theme and `dracula` CodeMirror theme keep their own palettes.
- AC5 — Local Electron run: after a 300px horizontal scroll, the Pierre and CodeMirror gutters are transparent, not sticky, and move with the code.
- AC6 — `pnpm test:pkg:ui packages/ui/src/lib/code-highlight/__tests__/cherry-theme.test.ts`: exported HTML carries `var(--cherry-code-*, <light color>)`, and the light defaults equal the CSS values.
- AC7 — `pnpm test:renderer src/renderer/components/chat/settings/__tests__/ChatPreferenceSections.test.tsx` and `pnpm i18n:check`: both selectors label `auto` as the Cherry default while storing `auto`, and every locale has a translation.
