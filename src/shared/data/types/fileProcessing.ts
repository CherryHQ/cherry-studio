import * as z from 'zod'

import { AbsoluteFilePathSchema } from '@shared/types/file'

import { FILE_PROCESSOR_FEATURES, FILE_PROCESSOR_IDS } from '../preference/preferenceTypes'

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
    path: AbsoluteFilePathSchema
  })
  .strict()

export const FileProcessingArtifactSchema = z.discriminatedUnion('kind', [
  FileProcessingTextArtifactSchema,
  FileProcessingFileArtifactSchema
])
export type FileProcessingArtifact = z.infer<typeof FileProcessingArtifactSchema>

export const FileProcessingOutputTargetSchema = z
  .object({ kind: z.literal('path'), path: AbsoluteFilePathSchema })
  .strict()
export type FileProcessingOutputTarget = z.infer<typeof FileProcessingOutputTargetSchema>

export const FileProcessingTaskIdSchema = z.string().min(1).brand<'FileProcessingTaskId'>()
export type FileProcessingTaskId = z.infer<typeof FileProcessingTaskIdSchema>

const fileProcessingTaskFields = {
  id: FileProcessingTaskIdSchema,
  feature: z.enum(FILE_PROCESSOR_FEATURES),
  processorId: z.enum(FILE_PROCESSOR_IDS)
}

/**
 * One file conversion. `completed`, `failed`, and `cancelled` are final: a task
 * never leaves them, and a retry is a new task. `error` says why a task failed
 * or was cancelled.
 */
export const FileProcessingTaskSchema = z.discriminatedUnion('status', [
  z.object({ ...fileProcessingTaskFields, status: z.literal('queued') }).strict(),
  z
    .object({ ...fileProcessingTaskFields, status: z.literal('processing'), progress: z.number().min(0).max(100) })
    .strict(),
  z
    .object({ ...fileProcessingTaskFields, status: z.literal('completed'), artifact: FileProcessingArtifactSchema })
    .strict(),
  z.object({ ...fileProcessingTaskFields, status: z.literal('failed'), error: z.string() }).strict(),
  z.object({ ...fileProcessingTaskFields, status: z.literal('cancelled'), error: z.string() }).strict()
])
export type FileProcessingTask = z.infer<typeof FileProcessingTaskSchema>

export const ListAvailableFileProcessorsResultSchema = z
  .object({
    processorIds: z.array(z.enum(FILE_PROCESSOR_IDS))
  })
  .strict()
export type ListAvailableFileProcessorsResult = z.infer<typeof ListAvailableFileProcessorsResultSchema>
