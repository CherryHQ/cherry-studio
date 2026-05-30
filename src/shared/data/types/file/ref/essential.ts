import * as z from 'zod'

import { TimestampSchema } from '../essential'
import { FileEntryIdSchema } from '../fileEntry'

export const refCommonFields = Object.freeze({
  /** Reference ID (UUID v4) */
  id: z.uuidv4(),
  /** Referenced file entry ID (UUID v7) */
  fileEntryId: FileEntryIdSchema,
  /** Creation timestamp (ms epoch) */
  createdAt: TimestampSchema,
  /** Last update timestamp (ms epoch) */
  updatedAt: TimestampSchema
})

/**
 * Shape constraint for business-specific ref fields passed to `createRefSchema`.
 *
 * `sourceId` uses `z.ZodType<string>` rather than `z.ZodUUID | z.ZodString`
 * so each variant can pick the strictest subtype (e.g. `z.uuidv7()` for
 * first-class domain objects, `z.string().min(1)` for opaque session IDs) —
 * the base shape stays honest about the variance instead of type-eroding
 * down to `z.ZodString`.
 */
export type BusinessRefShape = {
  /** Which business domain owns this reference (e.g. 'chat', 'knowledge', 'painting') */
  sourceType: z.ZodLiteral<string>
  /** The owning business entity's ID (e.g. a message ID, a knowledge item ID) */
  sourceId: z.ZodType<string>
  /** How the file is used within that domain (e.g. 'attachment', 'source', 'asset') */
  role: z.ZodEnum
}

/**
 * Factory: creates a typed FileRef schema by merging common fields
 * (`id`, `fileEntryId`, `createdAt`, `updatedAt`) with business-specific fields
 * (`sourceType`, `sourceId`, `role`).
 *
 * Each sourceType variant should call this once. See `./tempSession.ts` for
 * a minimal working example.
 */
export const createRefSchema = <T extends BusinessRefShape>(shape: T): z.ZodObject<typeof refCommonFields & T> =>
  z.object({
    ...refCommonFields,
    ...shape
  })
