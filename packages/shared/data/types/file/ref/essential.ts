import * as z from 'zod'

import { TimestampSchema } from '../essential'
import { NodeIdSchema } from '../node'

export const refCommonFields = Object.freeze({
  /** Reference ID (UUID v4) */
  id: z.uuidv4(),
  /** Referenced file node ID (UUID v7 or system node ID) */
  nodeId: NodeIdSchema,
  /** Creation timestamp (ms epoch) */
  createdAt: TimestampSchema,
  /** Last update timestamp (ms epoch) */
  updatedAt: TimestampSchema
})

/** Shape constraint for business-specific ref fields passed to `createRefSchema`. */
export type BusinessRefShape = {
  /** Which business domain owns this reference (e.g. 'chat', 'knowledge', 'painting') */
  sourceType: z.ZodLiteral<string>
  /** The owning business entity's ID (e.g. a message ID, a knowledge item ID) */
  sourceId: z.ZodUUID | z.ZodString
  /** How the file is used within that domain (e.g. 'attachment', 'source', 'asset') */
  role: z.ZodEnum
}

/**
 * Factory: creates a typed FileRef schema by merging common fields
 * (`id`, `nodeId`, `createdAt`, `updatedAt`) with business-specific fields
 * (`sourceType`, `sourceId`, `role`).
 *
 * Each sourceType variant should call this once. See `ref/example.ts` for usage.
 */
export const createRefSchema = <T extends BusinessRefShape>(shape: T): z.ZodObject<typeof refCommonFields & T> =>
  z.object({
    ...refCommonFields,
    ...shape
  })
