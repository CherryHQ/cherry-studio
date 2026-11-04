import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Quick Assistant IPC schemas — kept an independent domain (NOT down-sunk into
 * WindowManager) because hide/close/set_pin are platform-compensation business flows,
 * not window primitives: `hide` runs OS-specific anti-flicker / focus-return branches,
 * `close` deliberately hides (never destroys) to avoid a next-show blank flash, and
 * `set_pin` drives a macOS NSPanel post-unpin focus-poll state machine. The handlers
 * delegate to QuickAssistantService, where that logic lives.
 */
export const quickAssistantRequestSchemas = {
  'quick_assistant.show': defineRoute({ input: z.void(), output: z.void() }),
  'quick_assistant.restore_main': defineRoute({ input: z.void(), output: z.void() }),
  'quick_assistant.hide': defineRoute({ input: z.void(), output: z.void() }),
  'quick_assistant.close': defineRoute({ input: z.void(), output: z.void() }),
  'quick_assistant.set_pin': defineRoute({ input: z.object({ isPinned: z.boolean() }), output: z.void() })
}

// Directed (per-window) event: fired on every quick-window 'show', empty payload.
export type QuickAssistantEventSchemas = {
  'quick_assistant.shown': void
}
