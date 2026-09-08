import * as z from 'zod'

import { defineRoute } from '../define'
import { BrowserImportOptionsSchema, BrowserImportResultSchema, BrowserImportSourceSchema } from './browserImport'

export const browserRequestSchemas = {
  'browser.import.sources': defineRoute({ input: z.void(), output: z.array(BrowserImportSourceSchema) }),
  'browser.import.run': defineRoute({ input: BrowserImportOptionsSchema, output: BrowserImportResultSchema }),
  'browser.data.clear': defineRoute({
    input: z.strictObject({ kind: z.enum(['site_data', 'cache']) }),
    output: z.void()
  }),
  'browser.pane.attach': defineRoute({
    input: z.strictObject({ sessionId: z.uuid(), webviewId: z.number().int().positive() }),
    output: z.strictObject({ tabId: z.uuid() })
  }),
  'browser.pane.detach': defineRoute({
    input: z.strictObject({ sessionId: z.uuid(), tabId: z.uuid() }),
    output: z.void()
  })
}

export type BrowserEventSchemas = {
  'browser.pane.open_requested': { sessionId: string; url?: string }
}
