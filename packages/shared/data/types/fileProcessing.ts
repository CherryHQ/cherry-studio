import * as z from 'zod'

import {
  FILE_PROCESSOR_FEATURES,
  FILE_PROCESSOR_IDS,
  type FileProcessorFeature,
  type FileProcessorId
} from '../preference/preferenceTypes'

export const FileProcessingTaskStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled'])
export type FileProcessingTaskStatus = z.infer<typeof FileProcessingTaskStatusSchema>

export const FileProcessingTextArtifactSchema = z
  .object({
    kind: z.literal('text'),
    format: z.literal('plain'),
    text: z.string()
  })
  .strict()

export const FileProcessingFileArtifactSchema = z
  .object({
    kind: z.literal('file'),
    format: z.literal('markdown'),
    path: z.string().min(1)
  })
  .strict()

export const FileProcessingArtifactSchema = z.discriminatedUnion('kind', [
  FileProcessingTextArtifactSchema,
  FileProcessingFileArtifactSchema
])
export type FileProcessingArtifact = z.infer<typeof FileProcessingArtifactSchema>

export const FileProcessingTaskStartResultSchema = z
  .object({
    taskId: z.string().min(1),
    feature: z.enum(FILE_PROCESSOR_FEATURES),
    status: z.enum(['pending', 'processing']),
    progress: z.number().int().min(0).max(100),
    processorId: z.enum(FILE_PROCESSOR_IDS)
  })
  .strict()
export type FileProcessingTaskStartResult = z.infer<typeof FileProcessingTaskStartResultSchema>

const FileProcessingTaskBaseSchema = z
  .object({
    taskId: z.string().min(1),
    feature: z.enum(FILE_PROCESSOR_FEATURES),
    processorId: z.enum(FILE_PROCESSOR_IDS),
    progress: z.number().int().min(0).max(100)
  })
  .strict()

export const FileProcessingTaskPendingResultSchema = FileProcessingTaskBaseSchema.extend({
  status: z.literal('pending')
}).strict()

export const FileProcessingTaskProcessingResultSchema = FileProcessingTaskBaseSchema.extend({
  status: z.literal('processing')
}).strict()

export const FileProcessingTaskCompletedResultSchema = FileProcessingTaskBaseSchema.extend({
  status: z.literal('completed'),
  progress: z.literal(100),
  artifacts: z.array(FileProcessingArtifactSchema).min(1)
}).strict()

export const FileProcessingTaskFailedResultSchema = FileProcessingTaskBaseSchema.extend({
  status: z.literal('failed'),
  error: z.string().min(1)
}).strict()

export const FileProcessingTaskCancelledResultSchema = FileProcessingTaskBaseSchema.extend({
  status: z.literal('cancelled'),
  reason: z.string().min(1).optional()
}).strict()

export const FileProcessingTaskResultSchema = z.discriminatedUnion('status', [
  FileProcessingTaskPendingResultSchema,
  FileProcessingTaskProcessingResultSchema,
  FileProcessingTaskCompletedResultSchema,
  FileProcessingTaskFailedResultSchema,
  FileProcessingTaskCancelledResultSchema
])
export type FileProcessingTaskResult = z.infer<typeof FileProcessingTaskResultSchema>

export type FileProcessingTaskBase = {
  taskId: string
  feature: FileProcessorFeature
  processorId: FileProcessorId
  status: FileProcessingTaskStatus
  progress: number
}
