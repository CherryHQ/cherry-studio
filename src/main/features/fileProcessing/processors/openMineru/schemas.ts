import * as z from 'zod'

export const V1HealthSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  features: z.object({
    sources: z.array(z.string()).refine((sources) => sources.includes('file_id')),
    output_formats: z.array(z.string()).refine((formats) => formats.includes('markdown'))
  })
})

export const TasksHealthSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  features: z.object({
    sources: z.array(z.string()).refine((sources) => sources.includes('upload')),
    task_output_formats: z.array(z.string()).refine((formats) => formats.includes('default'))
  })
})

const taskStatus = z.enum(['waiting-file', 'pending', 'running', 'completed', 'partial', 'failed', 'canceled'])
const taskFileStatus = z.enum(['waiting-file', 'pending', 'running', 'completed', 'failed', 'canceled'])
const taskError = z.object({ code: z.string().min(1), message: z.string().min(1), param: z.string().nullish() })

export const TasksCreateResponseSchema = z.object({
  task_id: z.string().min(1),
  status: taskStatus,
  files: z
    .array(
      z.object({
        file_id: z.string().min(1),
        status: taskFileStatus,
        upload: z.object({ url: z.string().min(1), headers: z.record(z.string(), z.string()).optional() }).optional()
      })
    )
    .length(1)
})

export const TasksTaskDetailSchema = z.object({
  task_id: z.string().min(1),
  status: taskStatus,
  error: taskError.optional(),
  files: z
    .array(
      z.object({
        file_id: z.string().min(1),
        status: taskFileStatus,
        result_url: z.string().min(1).optional(),
        error: taskError.optional()
      })
    )
    .length(1)
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

export const OpenMineruRemoteStateSchema = z.discriminatedUnion('protocol', [
  z.object({ protocol: z.literal('v1'), apiHost: z.string().min(1), providerTaskId: z.string().min(1) }).strict(),
  z
    .object({
      protocol: z.literal('tasks'),
      apiHost: z.string().min(1),
      providerTaskId: z.string().min(1),
      providerFileId: z.string().min(1)
    })
    .strict()
])
