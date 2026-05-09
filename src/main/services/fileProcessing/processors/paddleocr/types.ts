import type { FileMetadata } from '@types'
import * as z from 'zod'

export const PaddleApiResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    traceId: z.string().optional(),
    code: z.number(),
    msg: z.string().optional(),
    data: data.optional()
  })

export const PaddleCreateJobDataSchema = z.object({
  jobId: z.string().min(1)
})

export const PaddleTaskStateSchema = z.enum(['pending', 'running', 'done', 'failed'])

export const PaddleResultUrlSchema = z.object({
  jsonUrl: z.string().min(1).optional(),
  markdownUrl: z.string().min(1).optional()
})

export const PaddleJsonlLayoutParsingResultSchema = z.looseObject({
  markdown: z
    .looseObject({
      text: z.string().optional()
    })
    .optional()
})

export const PaddleJsonlOcrResultSchema = z.looseObject({
  prunedResult: z
    .looseObject({
      rec_texts: z.array(z.string()).optional()
    })
    .optional()
})

export const PaddleJsonlLineSchema = z.looseObject({
  result: z
    .looseObject({
      layoutParsingResults: z.array(PaddleJsonlLayoutParsingResultSchema).optional(),
      ocrResults: z.array(PaddleJsonlOcrResultSchema).optional()
    })
    .optional()
})

export const PaddleExtractProgressSchema = z.object({
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  totalPages: z.coerce.number().int().nonnegative().optional(),
  extractedPages: z.coerce.number().int().nonnegative().optional()
})

export const PaddleJobResultDataSchema = z.object({
  jobId: z.string().min(1),
  state: PaddleTaskStateSchema,
  errorMsg: z.string().optional(),
  resultUrl: PaddleResultUrlSchema.optional(),
  extractProgress: PaddleExtractProgressSchema.optional()
})

export const PaddleCreateJobResponseSchema = PaddleApiResponseSchema(PaddleCreateJobDataSchema)
export const PaddleJobResultResponseSchema = PaddleApiResponseSchema(PaddleJobResultDataSchema)

export type PreparedPaddleContext = {
  apiHost: string
  apiKey: string
  signal?: AbortSignal
}

export type PreparedPaddleStartContext = PreparedPaddleContext & {
  feature: 'document_to_markdown' | 'image_to_text'
  file: FileMetadata
  model?: string
}

export type PreparedPaddleQueryContext = PreparedPaddleContext
export type PaddleTaskContext = Omit<PreparedPaddleQueryContext, 'signal'> & {
  fileId: string
}

export type PaddleCreateJobData = z.infer<typeof PaddleCreateJobDataSchema>
export type PaddleJobResultData = z.infer<typeof PaddleJobResultDataSchema>
export type PaddleJsonlLine = z.infer<typeof PaddleJsonlLineSchema>
