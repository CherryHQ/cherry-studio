// Match a `background` / `background-color` / `background-image` declaration:
//   - a required boundary before the property ($1: start, whitespace, `;`, or `{`) —
//     so `my-background:` is never matched, minified `{background:` and
//     `;background-color:` are, and a larger property like `background-position` is not
//     (it fails the `\s*:` right after the optional `-color|-image`);
//   - `\s*` after the boundary absorbs padding so replacing with `$1` leaves no double
//     space (a whitespace boundary is captured but the padding is consumed);
//   - the value up to the next `;` or `}` (so a final declaration without a trailing
//     semicolon is still matched), then the trailing `;` if present.
// Replaced with the captured boundary so structural `{` / `;` are preserved.
const BACKGROUND_DECLARATION = /(^|[\s;{])\s*background(?:-color|-image)?\s*:[^;}]*;?/gi

/**
 * Strip `background` / `background-image` / `background-color` declarations from
 * user custom CSS. The selection toolbar is a chromeless floating window whose own
 * transparency must win, so it filters out background overrides before injecting the
 * user's CSS — the toolbar-specific variance of custom-CSS handling, expressed as a
 * pure function rather than a config flag on the shared injection hook.
 */
export function stripBackgroundCss(css: string | undefined): string | undefined {
  if (!css) return css
  return css.replace(BACKGROUND_DECLARATION, '$1')
}
