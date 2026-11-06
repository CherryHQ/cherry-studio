import { registerCustomTheme } from '@pierre/diffs'

import { CHERRY_CODE_THEME, cherryCodeTheme } from '@cherrystudio/ui/code-highlight'

// The worker pool resolves themes on the main thread, so one registration covers workers too.
registerCustomTheme(CHERRY_CODE_THEME, () => Promise.resolve(cherryCodeTheme), 'zed')

/**
 * Line numbers scroll with the code: a sticky gutter would need an opaque fill that cannot match the host.
 * Floating widgets such as search derive their fill from `--diffs-bg`, so give them the popover surface.
 * The active line gets a neutral fill and a foreground line number instead of Pierre's outline and diff blue.
 */
export const CHERRY_EDITOR_CSS =
  '[data-gutter]{position:relative}[data-editor-widget]{--diffs-bg:var(--popover)}' +
  ':is([data-line],[data-column-number])[data-editor-active-line]{--diffs-computed-editor-active-line-bg:var(--accent)}' +
  // The editor's outline rule is unlayered and beats this layer, so clear the border colour it reads instead.
  '[data-line]{--diffs-editor-line-highlight-border:transparent}' +
  '[data-column-number][data-editor-active-line]{color:var(--foreground)}'
