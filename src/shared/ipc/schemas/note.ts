import * as z from 'zod'

import { defineRoute } from '../define'

const printedNotePayloadSchema = z.strictObject({
  title: z.string(),
  markdown: z.string(),
  sourcePath: z.string().optional()
})

export const noteRequestSchemas = {
  'note.export_pdf': defineRoute({ input: printedNotePayloadSchema, output: z.boolean() }),
  'note.print': defineRoute({ input: printedNotePayloadSchema, output: z.void() })
}
