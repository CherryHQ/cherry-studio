import * as z from 'zod'

import { FILE_PROCESSOR_IDS } from '../preference/preferenceTypes'
import { FileEntryIdSchema } from './file'

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
    fileEntryId: FileEntryIdSchema
  })
  .strict()

export const FileProcessingArtifactSchema = z.discriminatedUnion('kind', [
  FileProcessingTextArtifactSchema,
  FileProcessingFileArtifactSchema
])
export type FileProcessingArtifact = z.infer<typeof FileProcessingArtifactSchema>

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
