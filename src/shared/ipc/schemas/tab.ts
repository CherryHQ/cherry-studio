import * as z from 'zod'

import type { Tab } from '@shared/data/cache/cacheValueTypes'

import { defineRoute } from '../define'

// Source tabs close only after the destination acknowledges its committed tab.
export type TabTransfer = Tab & { transferId?: string }

export const tabRequestSchemas = {
  'tab.received': defineRoute({ input: z.object({ transferId: z.string(), tabId: z.string() }), output: z.boolean() }),
  'tab.sync_owners': defineRoute({ input: z.array(z.string()), output: z.void() }),
  'tab.attach': defineRoute({ input: z.custom<Tab>(), output: z.void() }),
  'tab.detach': defineRoute({
    // Mirrors SubWindowService.createWindow's tab identity, URL, presentation, and optional
    // drag-drop position; extra Tab fields are stripped by the object schema.
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
  'tab.attached': TabTransfer
}
