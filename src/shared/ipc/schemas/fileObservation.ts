import * as z from 'zod'

import { FileHandleSchema } from '@shared/data/types/file'

import { defineRoute } from '../define'

const subscriptionId = z.string().uuid()
const revision = z.int().nonnegative()
const coverage = z.enum(['live', 'stale', 'unavailable'])
const resource = z.strictObject({ subscriptionId, revision, coverage })

export type FileObservationResource = z.infer<typeof resource>
export type FileObservationCoverage = z.infer<typeof coverage>
export type FileObservationEventSchemas = { 'file.observe.changed': FileObservationResource }

export const fileObservationRequestSchemas = {
  'file.observe.open': defineRoute({ input: z.strictObject({ handle: FileHandleSchema }), output: resource }),
  'file.observe.activate': defineRoute({ input: z.strictObject({ subscriptionId, revision }), output: z.boolean() }),
  'file.observe.close': defineRoute({ input: z.strictObject({ subscriptionId }), output: z.void() })
}
