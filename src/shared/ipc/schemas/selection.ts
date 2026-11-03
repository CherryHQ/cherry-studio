import type { TextSelectionData } from 'selection-hook'
import * as z from 'zod'

import { SelectionActionSchema } from '@shared/types/selection'

import { defineRoute } from '../define'

/**
 * Selection-feature IPC schemas — the first domain migrated onto IpcApi.
 *
 * Two blocks per the framework's two-axis model (see ipc-overview.md):
 *   - Request schemas are zod *values* (renderer→main, untrusted → always parsed).
 *   - Event schemas are pure *types* (main→renderer, main is the TCB → not parsed).
 *
 * `z.infer` of the request input/output schemas is the single source of truth for
 * the handler signatures and the renderer facade; the handler bodies calling the
 * matching `SelectionService` methods make schema↔type drift a compile error.
 */

/** The cached Linux environment probe returned by `SelectionService.getLinuxEnvInfo()`. */
const linuxEnvInfoSchema = z.object({
  isLinuxWaylandDisplay: z.boolean(),
  isLinuxXWaylandMode: z.boolean(),
  hasLinuxInputDeviceAccess: z.boolean(),
  isLinuxCompositorCompatible: z.boolean()
})

// ── Request: renderer→main calls (zod values, always parsed) ──
export const selectionRequestSchemas = {
  'selection.hide_toolbar': defineRoute({ input: z.void(), output: z.void() }),
  'selection.write_to_clipboard': defineRoute({ input: z.string(), output: z.boolean() }),
  'selection.determine_toolbar_size': defineRoute({
    input: z.object({ width: z.number(), height: z.number() }),
    output: z.void()
  }),
  'selection.process_action': defineRoute({
    // isFullScreen is macOS-only; default false so non-macOS callers may omit it.
    input: z.object({ actionItem: SelectionActionSchema, isFullScreen: z.boolean().default(false) }),
    output: z.void()
  }),
  'selection.pin_action_window': defineRoute({ input: z.boolean(), output: z.void() }),
  'selection.get_linux_env_info': defineRoute({ input: z.void(), output: linuxEnvInfoSchema })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type SelectionEventSchemas = {
  'selection.action_dismissed': { sessionId: string }
  'selection.text_selected': TextSelectionData
  'selection.toolbar_visibility_change': boolean
}
