import { FilePathSchema } from '@shared/types/file'
import * as z from 'zod'

import { FILE_PROCESSOR_IDS } from '../preference/preferenceTypes'

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
    path: FilePathSchema
  })
  .strict()

export const FileProcessingArtifactSchema = z.discriminatedUnion('kind', [
  FileProcessingTextArtifactSchema,
  FileProcessingFileArtifactSchema
])
export type FileProcessingArtifact = z.infer<typeof FileProcessingArtifactSchema>

export const FileProcessingOutputTargetSchema = z.object({ kind: z.literal('path'), path: FilePathSchema }).strict()
export type FileProcessingOutputTarget = z.infer<typeof FileProcessingOutputTargetSchema>

export const FileProcessingJobOutputSchema = z
  .object({
    artifact: FileProcessingArtifactSchema
  })
  .strict()
export type FileProcessingJobOutput = z.infer<typeof FileProcessingJobOutputSchema>

export const ListAvailableFileProcessorsResultSchema = z
  .object({
    processorIds: z.array(z.enum(FILE_PROCESSOR_IDS))
  })
  .strict()
export type ListAvailableFileProcessorsResult = z.infer<typeof ListAvailableFileProcessorsResultSchema>
