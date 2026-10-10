import * as z from 'zod'

import type { BrowserCursorState } from '../../types/browserCursor'
import { defineRoute } from '../define'
import { BrowserImportOptionsSchema, BrowserImportResultSchema, BrowserImportSourceSchema } from './browserImport'

export const browserRequestSchemas = {
  'browser.import.sources': defineRoute({ input: z.void(), output: z.array(BrowserImportSourceSchema) }),
  'browser.import.run': defineRoute({ input: BrowserImportOptionsSchema, output: BrowserImportResultSchema }),
  'browser.data.clear': defineRoute({
    input: z.strictObject({ kind: z.enum(['site_data', 'cache', 'history']) }),
    output: z.void()
  }),
  'browser.pane.attach': defineRoute({
    input: z.strictObject({
      sessionId: z.uuid(),
      scope: z.enum(['agent', 'topic']).optional(),
      webviewId: z.number().int().positive()
    }),
    output: z.strictObject({ tabId: z.uuid() })
  }),
  'browser.cursor.present': defineRoute({
    input: z.strictObject({
      sessionId: z.uuid(),
      scope: z.enum(['agent', 'topic']).optional(),
      tabId: z.uuid(),
      presented: z.boolean()
    }),
    output: z.void()
  }),
  'browser.cursor.arrive': defineRoute({
    input: z.strictObject({
      sessionId: z.uuid(),
      scope: z.enum(['agent', 'topic']).optional(),
      tabId: z.uuid(),
      documentId: z.string().min(1),
      sequence: z.number().int().positive()
    }),
    output: z.void()
  }),
  'browser.pane.detach': defineRoute({
    input: z.strictObject({ sessionId: z.uuid(), scope: z.enum(['agent', 'topic']).optional(), tabId: z.uuid() }),
    output: z.void()
  })
}

export type BrowserEventSchemas = {
  'browser.cursor.state': BrowserCursorState
  'browser.guest.ensure_requested': { sessionId: string; scope?: 'agent' | 'topic'; url?: string }
  'browser.pane.open_requested': { sessionId: string; scope?: 'agent' | 'topic'; url?: string }
}
