import * as z from 'zod'

import { defineRoute } from '../define'

export const printableDocumentPayloadSchema = z.strictObject({
  title: z.string(),
  markdown: z.string(),
  sourcePath: z.string().optional()
})

export type PrintableDocumentPayload = z.infer<typeof printableDocumentPayloadSchema>

export interface DocumentPrintPayload {
  title: string
  markdown: string
  images: Record<string, string>
}

export const printRequestSchemas = {
  'print.document.ready': defineRoute({ input: z.object({ error: z.string().optional() }), output: z.void() }),
  'print.export_pdf': defineRoute({ input: printableDocumentPayloadSchema, output: z.boolean() }),
  'print.print': defineRoute({ input: printableDocumentPayloadSchema, output: z.void() })
}
