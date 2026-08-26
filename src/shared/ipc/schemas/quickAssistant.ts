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
  'quick_assistant.hide': defineRoute({ input: z.void(), output: z.void() }),
  'quick_assistant.close': defineRoute({ input: z.void(), output: z.void() }),
  'quick_assistant.set_pin': defineRoute({ input: z.object({ isPinned: z.boolean() }), output: z.void() }),
  /**
   * Resize the window to the height its content needs. The renderer owns measurement
   * (the composer grows with the draft) and the reduced-motion decision; main owns
   * work-area clamping and the tween. `view` tells main which height to restore when
   * the user drags the window (only the conversation panel height is remembered).
   * `quick-panel` is the transient transparent space needed by composer tool menus.
   */
  'quick_assistant.set_view': defineRoute({
    input: z.object({
      view: z.enum(['bar', 'quick-panel', 'panel']),
      contentHeight: z.number().int().positive(),
      animate: z.boolean()
    }),
    output: z.void()
  })
}

export type QuickAssistantEventSchemas = {
  /**
   * The window was summoned. A hidden-then-shown BrowserWindow keeps its DOM, so the
   * renderer gets no lifecycle callback to re-focus the composer on — without this the
   * hotkey opens a bar the user has to click before typing.
   */
  'quick_assistant.shown': void
}
