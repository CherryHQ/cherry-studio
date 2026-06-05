import * as z from 'zod'

export const OcrAsyncTaskLifecycleStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed'])
export type OcrAsyncTaskLifecycleStatus = z.infer<typeof OcrAsyncTaskLifecycleStatusSchema>

export const OcrAsyncPageSchema = z.strictObject({
  text: z.string()
})
export type OcrAsyncPage = z.infer<typeof OcrAsyncPageSchema>

export const OcrAsyncTaskStartResultSchema = z.strictObject({
  taskId: z.string().min(1),
  providerTaskId: z.string().min(1),
  status: z.enum(['pending', 'processing'])
})
export type OcrAsyncTaskStartResult = z.infer<typeof OcrAsyncTaskStartResultSchema>

export const OcrAsyncTaskStatusSchema = z.strictObject({
  taskId: z.string().min(1),
  providerTaskId: z.string().min(1),
  status: OcrAsyncTaskLifecycleStatusSchema,
  progress: z.number().min(0).max(100)
})
export type OcrAsyncTaskStatus = z.infer<typeof OcrAsyncTaskStatusSchema>

export const OcrAsyncTaskResultPayloadSchema = z.strictObject({
  text: z.string(),
  pages: z.array(OcrAsyncPageSchema)
})
export type OcrAsyncTaskResultPayload = z.infer<typeof OcrAsyncTaskResultPayloadSchema>

export const OcrAsyncTaskResultSchema = z.strictObject({
  taskId: z.string().min(1),
  providerTaskId: z.string().min(1),
  status: z.literal('completed'),
  progress: z.literal(100),
  result: OcrAsyncTaskResultPayloadSchema
})
export type OcrAsyncTaskResult = z.infer<typeof OcrAsyncTaskResultSchema>
