import * as z from 'zod'

import type { Tab } from '@shared/data/cache/cacheValueTypes'

import { defineRoute } from '../define'

export const tabRequestSchemas = {
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
  'tab.attached': Tab
}
