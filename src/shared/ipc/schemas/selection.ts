import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import type { TextSelectionData } from 'selection-hook'
import * as z from 'zod'

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

/**
 * Runtime form of the {@link SelectionActionItem} preference type. The
 * `z.ZodType<SelectionActionItem>` annotation binds the two structurally, so a drift
 * in either is a compile error here at the definition (repo convention — see
 * uiParts.ts / legacyFileMetadata.ts).
 */
const selectionActionItemSchema: z.ZodType<SelectionActionItem> = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  isBuiltIn: z.boolean(),
  icon: z.string().optional(),
  prompt: z.string().optional(),
  assistantId: z.string().optional(),
  selectedText: z.string().optional(),
  searchEngine: z.string().optional()
})

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
    input: z.object({ actionItem: selectionActionItemSchema, isFullScreen: z.boolean().default(false) }),
    output: z.void()
  }),
  'selection.pin_action_window': defineRoute({ input: z.boolean(), output: z.void() }),
  'selection.get_linux_env_info': defineRoute({ input: z.void(), output: linuxEnvInfoSchema })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type SelectionEventSchemas = {
  'selection.text_selected': TextSelectionData
  'selection.toolbar_visibility_change': boolean
}
