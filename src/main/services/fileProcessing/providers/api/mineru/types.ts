import type { FileMetadata } from '@types'
import * as z from 'zod'

export const MineruApiResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    code: z.number(),
    data,
    msg: z.string().optional(),
    trace_id: z.string().optional()
  })

export const MineruBatchUploadDataSchema = z.object({
  batch_id: z.string().min(1),
  file_urls: z.array(z.string().min(1)).min(1),
  headers: z.array(z.record(z.string(), z.string())).optional()
})

export const MineruTaskStateSchema = z.enum(['done', 'waiting-file', 'pending', 'running', 'failed', 'converting'])

export const MineruExtractProgressSchema = z.object({
  extracted_pages: z.number(),
  total_pages: z.number(),
  start_time: z.string()
})

export const MineruExtractFileResultSchema = z.object({
  file_name: z.string().optional(),
  state: MineruTaskStateSchema,
  err_msg: z.string().optional(),
  full_zip_url: z.string().optional(),
  data_id: z.string().optional(),
  extract_progress: MineruExtractProgressSchema.optional()
})

export const MineruExtractResultsDataSchema = z.object({
  batch_id: z.string().min(1),
  extract_result: z.array(MineruExtractFileResultSchema).default([])
})

export type PreparedMineruContext = {
  apiHost: string
  apiKey: string
  signal?: AbortSignal
}

export type PreparedMineruStartContext = PreparedMineruContext & {
  file: FileMetadata
  modelVersion?: string
}

export type PreparedMineruQueryContext = PreparedMineruContext
export type MineruTaskContext = Omit<PreparedMineruQueryContext, 'signal'> & {
  fileId: string
}

export type MineruExtractFileResult = z.infer<typeof MineruExtractFileResultSchema>
export type MineruExtractResultsData = z.infer<typeof MineruExtractResultsDataSchema>
