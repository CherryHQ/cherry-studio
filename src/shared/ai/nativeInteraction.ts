import * as z from 'zod'

export const NativeInteractionInputSchema = z.object({ responseMode: z.literal('native-request') })

export const InterviewActionSchema = z.enum(['discuss', 'skip-interview'])
export type InterviewAction = z.infer<typeof InterviewActionSchema>

export const NativeQuestionReplySchema = z.union([
  z.object({
    action: InterviewActionSchema,
    selections: z.array(z.object({ selected: z.array(z.string()), freeform: z.literal(true).optional() }))
  }),
  z.object({
    action: z.literal('submit').default('submit'),
    selections: z.array(z.object({ selected: z.array(z.string()), notes: z.string().optional() }))
  })
])
export type NativeQuestionReply = z.infer<typeof NativeQuestionReplySchema>
