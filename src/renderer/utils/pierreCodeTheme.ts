import { registerCustomTheme } from '@pierre/diffs'

import { CHERRY_CODE_THEME, cherryCodeTheme } from '@cherrystudio/ui/code-highlight'

// The worker pool resolves themes on the main thread, so one registration covers workers too.
registerCustomTheme(CHERRY_CODE_THEME, () => Promise.resolve(cherryCodeTheme), 'zed')

/**
 * Line numbers scroll with the code: a sticky gutter would need an opaque fill that cannot match the host.
 * Floating widgets such as search derive their fill from `--diffs-bg`, so give them the popover surface.
 */
export const CHERRY_EDITOR_CSS = '[data-gutter]{position:relative}[data-editor-widget]{--diffs-bg:var(--popover)}'
