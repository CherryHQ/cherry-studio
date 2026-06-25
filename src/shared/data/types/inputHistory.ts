import * as z from 'zod'

export const InputHistoryIdSchema = z.uuidv7()

export const InputHistorySchema = z.strictObject({
  id: InputHistoryIdSchema,
  content: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export type InputHistory = z.infer<typeof InputHistorySchema>
