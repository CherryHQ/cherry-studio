import * as z from 'zod'

export const unicodeText = z.string().regex(/^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/)
export const opaqueId = unicodeText.min(1).max(256)
export const decimal = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(40)
export const digest = z.string().regex(/^[0-9a-f]{64}$/)
export const timestamp = z.iso.datetime({ offset: false })
export const pageParams = { cursor: opaqueId.optional(), limit: z.number().int().min(1).max(100).optional() }
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.looseObject({ items: z.array(item).max(100), nextCursor: opaqueId.nullable() })

export type IntegrityPrimitives = { sha256(bytes: Uint8Array): string }
