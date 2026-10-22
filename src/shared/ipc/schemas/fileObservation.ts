import * as z from 'zod'

import { AbsoluteFilePathSchema } from '@shared/types/file'

import { defineRoute } from '../define'

const observationId = z.string().uuid()
export const fileObservationOptionsSchema = z.strictObject({
  recursive: z.boolean().optional(),
  maxDepth: z.int().nonnegative().optional()
})
const leaseSchema = z.strictObject({ observationId, generation: z.string().uuid(), sequence: z.int().nonnegative() })
export type FileObservationOptions = z.infer<typeof fileObservationOptionsSchema>
export type FileObservationLease = z.infer<typeof leaseSchema>
export type FileObservationEvent = FileObservationLease &
  (
    | { kind: 'invalidate'; paths: string[]; subtree: boolean }
    | { kind: 'resync-required'; reason: 'overflow' | 'watcher-error' }
  )

export const fileObservationRequestSchemas = {
  'file.observe.create': defineRoute({
    input: z.strictObject({ rootPath: AbsoluteFilePathSchema, options: fileObservationOptionsSchema.optional() }),
    output: leaseSchema
  }),
  'file.observe.activate': defineRoute({ input: leaseSchema, output: z.boolean() }),
  'file.observe.dispose': defineRoute({ input: z.strictObject({ observationId }), output: z.void() })
}
