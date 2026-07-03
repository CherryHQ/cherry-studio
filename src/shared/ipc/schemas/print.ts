import * as z from 'zod'

import { defineRoute } from '../define'

const printableDocumentPayloadSchema = z.strictObject({
  title: z.string(),
  source: z.strictObject({
    type: z.literal('markdown'),
    markdown: z.string()
  }),
  sourcePath: z.string().optional()
})

export const printRequestSchemas = {
  'print.export_pdf': defineRoute({ input: printableDocumentPayloadSchema, output: z.boolean() }),
  'print.print': defineRoute({ input: printableDocumentPayloadSchema, output: z.void() })
}
