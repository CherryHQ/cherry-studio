import { registerCustomTheme } from '@pierre/diffs'

import { CHERRY_CODE_THEME, cherryCodeTheme } from '@cherrystudio/ui/code-highlight'

// The worker pool resolves themes on the main thread, so one registration covers workers too.
registerCustomTheme(CHERRY_CODE_THEME, () => Promise.resolve(cherryCodeTheme), 'zed')

/** Lets line numbers scroll with the code; a sticky gutter would need an opaque fill that cannot match the host. */
export const CHERRY_GUTTER_CSS = '[data-gutter]{position:relative}'
