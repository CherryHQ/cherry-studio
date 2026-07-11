import * as z from 'zod'

/**
 * Zod mirror of OperationResult (@shared/types/codeTools): failure always
 * carries a message, success carries nothing. Shared by route modules — not a
 * route module itself, so it is never spread into ipcRequestSchemas.
 */
export const operationResultSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true) }),
  z.object({ success: z.literal(false), message: z.string() })
])
