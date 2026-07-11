import * as z from 'zod'

import { defineRoute } from '../define'

export const printableDocumentPayloadSchema = z.strictObject({
  title: z.string(),
  markdown: z.string(),
  sourcePath: z.string().optional()
})

export type PrintableDocumentPayload = z.infer<typeof printableDocumentPayloadSchema>

export const printRequestSchemas = {
  'print.export_pdf': defineRoute({ input: printableDocumentPayloadSchema, output: z.boolean() }),
  'print.print': defineRoute({ input: printableDocumentPayloadSchema, output: z.void() })
}
