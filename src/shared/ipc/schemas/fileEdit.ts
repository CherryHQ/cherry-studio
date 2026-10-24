import * as z from 'zod'

import { ContentHashSchema, FileHandleSchema } from '@shared/data/types/file'
import { FileVersionSchema } from '@shared/types/file'

import { defineRoute } from '../define'
import { uint8ArraySchema } from './common'

export { FILE_EDIT_MAX_SIZE_BYTES } from '@shared/types/file'
const editIdSchema = z.string().uuid()
const sequenceSchema = z.int().positive().max(Number.MAX_SAFE_INTEGER)
export const fileEditBaselineSchema = z.strictObject({ version: FileVersionSchema, contentHash: ContentHashSchema })
const resourceSchema = z.strictObject({ editId: editIdSchema })
const readSchema = z.strictObject({ data: uint8ArraySchema, baseline: fileEditBaselineSchema })
const writeSchema = z.strictObject({
  editId: editIdSchema,
  sequence: sequenceSchema,
  expected: fileEditBaselineSchema,
  data: uint8ArraySchema
})
const outcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('committed'),
    sequence: sequenceSchema,
    baseline: fileEditBaselineSchema,
    metadataRecoveryPending: z.boolean()
  }),
  z.strictObject({ kind: z.literal('not-committed'), sequence: sequenceSchema, code: z.string() }),
  z.strictObject({ kind: z.literal('not-started'), sequence: sequenceSchema })
])

export type FileEditBaseline = z.infer<typeof fileEditBaselineSchema>
export type FileEditResource = z.infer<typeof resourceSchema>
export type FileEditRead = z.infer<typeof readSchema>
export type FileEditWrite = z.infer<typeof writeSchema>
export type FileWriteOutcome = z.infer<typeof outcomeSchema>

export const fileEditRequestSchemas = {
  'file.edit.open': defineRoute({ input: z.strictObject({ handle: FileHandleSchema }), output: resourceSchema }),
  'file.edit.read': defineRoute({ input: z.strictObject({ editId: editIdSchema }), output: readSchema }),
  'file.edit.write': defineRoute({ input: writeSchema, output: outcomeSchema }),
  'file.edit.settle_write': defineRoute({
    input: z.strictObject({ editId: editIdSchema, sequence: sequenceSchema }),
    output: outcomeSchema
  }),
  'file.edit.close': defineRoute({ input: z.strictObject({ editId: editIdSchema }), output: z.void() })
}
