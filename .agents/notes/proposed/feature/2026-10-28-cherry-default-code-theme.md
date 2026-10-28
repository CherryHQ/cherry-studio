# Agent Note: Cherry default code theme

Status: proposed

English | [中文](2026-10-28-cherry-default-code-theme.zh.md)

## Problem

The code theme preferences default to `auto`, which resolves to third-party themes: `one-light` / `material-theme-darker` for code viewing and `materialLight` / `dark` for CodeMirror. Each paints its own solid editor background, so code areas never match the surface that hosts them. The mismatch is most visible in dark mode, where the application background is translucent over macOS window vibrancy and no solid color can match it.

Swapping only the background of a third-party theme would break the contrast its syntax colors were designed for, so the default needs its own palette.

[Pierre code surfaces](../architecture/2026-10-24-pierre-code-surfaces.md) and [message code block surfaces](../architecture/2026-10-26-message-code-block-surfaces.md) own which preferences select a theme and preserve the `auto` defaults. This note decides what `auto` resolves to.

## Proposal

### One theme, colors from CSS

Add one Highlights theme, `cherry`, in the Zed format with a CSS-variable palette (`cssVariables: { prefix: '--cherry-code-', defaults }`). Highlights emits `color: var(--cherry-code-<role>, <default>)` for each token, so a single theme name serves both appearances. Switching the application between light and dark changes the colors without re-tokenizing or reconfiguring any surface. `defaults` hold the light values so exported HTML stays colored without application CSS.

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

Variables and properties stay uncolored so that color marks only syntax. Dark-mode roles share one lightness band (OKLCH L 0.81–0.86), so no hue dominates. Every role meets WCAG AA (≥ 4.5:1) against white and against the translucent dark host.

### Surfaces

- **Theme catalog and settings:** register `cherry` in the shared code-highlight catalog. `auto` resolves to `cherry` in both appearances, and the settings label for `auto` names it as the Cherry default.
- **Message viewer, Tiptap, and CodeMirror syntax:** `getCodeBlockPalette` maps a CSS-variable theme to `var(--cherry-code-*)` references instead of literal colors.
- **Pierre files and diffs:** register `cherry` once on the main thread with `registerCustomTheme(..., 'zed')`; the worker pool resolves themes there and sends them to its workers.
- **Dark-mode detection:** for `cherry`, `isCodeThemeDark` follows the application appearance instead of a fixed `appearance` field.
- **Gutters:** line-number gutters are transparent and scroll horizontally with the code, as message viewer line numbers already do. Pierre (through `unsafeCSS`) and CodeMirror (`gutters({ fixed: false })`) no longer pin the gutter, so code never passes beneath it.
- **CodeMirror chrome:** with `chat.code.editor.theme_*` set to `auto`, CodeMirror editors use a Cherry chrome theme instead of `materialLight` / `dark`. This theme uses a transparent background and takes text, caret, selection, gutter, and active-line colors from application tokens. Syntax colors come from the same palette.

Explicitly selected third-party themes keep their full colors and background. Stored preference values are not rewritten, and no migration is needed.

## Alternatives considered

- **Override only the background of third-party themes:** rejected, because their syntax colors assume their own background, and on light hosts or the translucent dark host contrast is no longer guaranteed.
- **Two named themes (`cherry-light` / `cherry-dark`) with literal colors:** rejected. A mode switch would rebuild tokenizers, and a user could pair the light palette with the dark application.
- **A sticky gutter:** rejected. A transparent sticky gutter lets code show through during horizontal scrolling. An opaque one cannot match the translucent dark host: `var(--background)` is itself translucent, and a solid color showed as a distinct stripe (rejected by the user on 2026-10-28).
- **Keep CodeMirror chrome on `materialLight` / `dark`:** rejected by the user on 2026-10-28. Editors would keep a solid background beside immersive viewers.

## Acceptance criteria

- AC1 — With default preferences, message code blocks, file preview and editing, agent diffs, Tiptap code blocks, and CodeMirror editors show no code-theme background in light and dark mode, including the translucent macOS dark window. (verification: Electron; owner: appearance implementer)
- AC2 — Every colored Cherry role meets WCAG AA 4.5:1 against the light background and the dark translucent host; variables and properties render in the foreground color. (verification: unit; owner: palette author)
- AC3 — Switching the application between light and dark recolors code without re-tokenizing and preserves editor selection and undo history. (verification: renderer and Electron; owner: appearance implementer)
- AC4 — An explicitly selected third-party viewer or CodeMirror theme renders with its own colors and background, and stored preference values remain unchanged. (verification: renderer; owner: appearance implementer)
- AC5 — With line numbers shown and lines overflowing, horizontal scrolling never shows code text beneath Pierre or CodeMirror gutters. (verification: Electron; owner: appearance implementer)
- AC6 — Code highlighted for HTML or Markdown export keeps its syntax colors when rendered without application CSS. (verification: unit; owner: export implementer)
- AC7 — The theme selectors present `auto` as the Cherry default in every locale. (verification: renderer and i18n check; owner: appearance implementer)

## Risks

- Pierre derives diff, separator, and decoration colors with `color-mix` against `--diffs-bg`. A transparent background can make these tints too faint; verify diffs in both modes before release.
- With the line-number gutter scrolled away, a horizontally scrolled long line no longer shows its line number.
- Users who relied on `auto` getting One Light or Material Darker will see a different default; they can still select those themes explicitly.
