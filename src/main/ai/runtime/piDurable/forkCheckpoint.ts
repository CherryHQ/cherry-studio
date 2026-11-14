import * as z from 'zod'

const nativeId = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine((value) => Number.isSafeInteger(Number(value)))
export const DurableForkCheckpointSchema = z.strictObject({
  runtime: z.literal('pi-durable'),
  backendId: z.uuid(),
  conversationId: nativeId,
  entryId: nativeId
})
