import type { Tab } from '@shared/data/cache/cacheValueTypes'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Tab (detached sub-window) IPC schemas. The legacy `tab:attach` string served both an
 * R→M invoke and an M→R broadcast; it is split into `tab.attach` (request; the caller only
 * fires it, so it is void) and `tab.attached` (event, the Tab to re-attach into the main
 * window). `tab.detach` / `tab.drag_end` were fire-and-forget `ipcOn`s → void requests.
 * Tab_MoveWindow stays on legacy native IPC (per-frame R→M escape hatch, see docs).
 */
export const tabRequestSchemas = {
  'tab.attach': defineRoute({ input: z.custom<Tab>(), output: z.void() }),
  'tab.detach': defineRoute({
    // Mirrors SubWindowService.createWindow's payload (a Tab plus a resolved url and an
    // optional drag drop position); extra Tab fields are stripped by the object schema.
    input: z.object({
      id: z.string(),
      url: z.string(),
      title: z.string().optional(),
      icon: z.string().optional(),
      type: z.string().optional(),
      isPinned: z.boolean().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      x: z.number().optional(),
      y: z.number().optional()
    }),
    output: z.void()
  }),
  'tab.drag_end': defineRoute({ input: z.void(), output: z.void() })
}

export type TabEventSchemas = {
  'tab.attached': Tab
}
