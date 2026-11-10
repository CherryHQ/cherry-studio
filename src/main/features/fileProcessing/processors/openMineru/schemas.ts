import * as z from 'zod'

export const V1HealthSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  features: z.object({
    sources: z.array(z.string()).refine((sources) => sources.includes('file_id')),
    output_formats: z.array(z.string()).refine((formats) => formats.includes('markdown'))
  })
})

export const LegacyHealthSchema = z.object({
  status: z.literal('healthy'),
  version: z.string().min(1)
})

const fileSchema = z.object({ id: z.string().min(1) })

export const V1CompletedUploadSchema = z.object({
  id: z.string().min(1),
  status: z.literal('completed'),
  file: fileSchema
})

export const V1UploadSchema = z.discriminatedUnion('status', [
  V1CompletedUploadSchema,
  z.object({
    id: z.string().min(1),
    status: z.literal('pending'),
    upload_url: z.string().min(1),
    upload_method: z.literal('PUT'),
    upload_headers: z.record(z.string(), z.string()).nullish()
  })
])

export const V1JobSchema = z.object({
  job_id: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'partial', 'failed', 'canceled']),
  files: z
    .array(
      z.object({
        status: z.enum(['queued', 'running', 'completed', 'failed']),
        output_files: z.object({ markdown: z.object({ file_id: z.string().min(1) }).nullish() }).nullish()
      })
    )
    .length(1)
})

export const OpenMineruRemoteStateSchema = z
  .object({
    protocol: z.literal('v1'),
    apiHost: z.string().min(1),
    providerTaskId: z.string().min(1)
  })
  .strict()
