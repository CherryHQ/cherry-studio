import * as z from 'zod'

import { FILE_PROCESSOR_IDS } from '../preference/preferenceTypes'

export const FileProcessingTaskPhaseSchema = z.enum(['pending', 'processing', 'completed', 'failed'])
export type FileProcessingTaskPhase = z.infer<typeof FileProcessingTaskPhaseSchema>

export const FileProcessingTextExtractionResultSchema = z
  .object({
    text: z.string()
  })
  .strict()
export type FileProcessingTextExtractionResult = z.infer<typeof FileProcessingTextExtractionResultSchema>

export const FileProcessingMarkdownTaskStartResultSchema = z
  .object({
    providerTaskId: z.string().min(1),
    status: z.enum(['pending', 'processing']),
    progress: z.number().min(0).max(100),
    processorId: z.enum(FILE_PROCESSOR_IDS)
  })
  .strict()
export type FileProcessingMarkdownTaskStartResult = z.infer<typeof FileProcessingMarkdownTaskStartResultSchema>

const FileProcessingMarkdownTaskBaseSchema = z
  .object({
    progress: z.number().min(0).max(100),
    processorId: z.enum(FILE_PROCESSOR_IDS)
  })
  .strict()

export const FileProcessingMarkdownTaskPendingResultSchema = FileProcessingMarkdownTaskBaseSchema.extend({
  status: z.literal('pending')
}).strict()

export const FileProcessingMarkdownTaskProcessingResultSchema = FileProcessingMarkdownTaskBaseSchema.extend({
  status: z.literal('processing')
}).strict()

export const FileProcessingMarkdownTaskFailedResultSchema = FileProcessingMarkdownTaskBaseSchema.extend({
  status: z.literal('failed'),
  error: z.string().min(1)
}).strict()

export const FileProcessingMarkdownTaskCompletedResultSchema = FileProcessingMarkdownTaskBaseSchema.extend({
  status: z.literal('completed'),
  progress: z.literal(100),
  markdownPath: z.string().min(1)
}).strict()

export const FileProcessingMarkdownTaskResultSchema = z.discriminatedUnion('status', [
  FileProcessingMarkdownTaskPendingResultSchema,
  FileProcessingMarkdownTaskProcessingResultSchema,
  FileProcessingMarkdownTaskFailedResultSchema,
  FileProcessingMarkdownTaskCompletedResultSchema
])
export type FileProcessingMarkdownTaskResult = z.infer<typeof FileProcessingMarkdownTaskResultSchema>
