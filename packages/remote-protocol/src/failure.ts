import * as z from 'zod'

export const aiFailureReasonSchema = z.enum([
  'auth',
  'permission',
  'region',
  'model_not_found',
  'quota',
  'rate_limit',
  'context_length',
  'payload_too_large',
  'network',
  'proxy_tls',
  'stream_interrupted',
  'content_filter',
  'provider_unavailable',
  'timeout',
  'invalid_input',
  'tool_limit',
  'tool_failed',
  'mcp',
  'parse',
  'internal',
  'unknown'
])
export type AiFailureReason = z.infer<typeof aiFailureReasonSchema>

export const aiFailureSnapshotSchema = z.strictObject({
  version: z.literal(1),
  reasonCode: aiFailureReasonSchema,
  source: z.strictObject({
    layer: z.enum(['provider', 'runtime', 'host', 'tool']),
    name: z.string().max(256).optional(),
    code: z.string().max(128).optional()
  }),
  context: z
    .strictObject({
      statusCode: z.number().int().min(100).max(599).optional(),
      providerId: z.string().max(256).optional(),
      modelId: z.string().max(256).optional(),
      finishReason: z.string().max(256).optional(),
      responseBody: z.string().max(4000).optional()
    })
    .optional()
})
export type AiFailureSnapshot = z.infer<typeof aiFailureSnapshotSchema>

export const executionFailureSchema = z
  .strictObject({
    message: z.string().max(1024),
    retryable: z.boolean(),
    failure: aiFailureSnapshotSchema
  })
  .refine((value) => new TextEncoder().encode(JSON.stringify(value)).length <= 4096, 'Failure exceeds byte budget')
export type ExecutionFailure = z.infer<typeof executionFailureSchema>
