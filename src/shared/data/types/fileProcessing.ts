import * as z from 'zod'

import { type FileHandle, FileHandleSchema } from '../../file/types'
import {
  FILE_PROCESSOR_FEATURES,
  FILE_PROCESSOR_IDS,
  type FileProcessorFeature,
  type FileProcessorId
} from '../preference/preferenceTypes'
import { AbsolutePathSchema } from './file'

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
    path: AbsolutePathSchema
  })
  .strict()

export const FileProcessingArtifactSchema = z.discriminatedUnion('kind', [
  FileProcessingTextArtifactSchema,
  FileProcessingFileArtifactSchema
])
export type FileProcessingArtifact = z.infer<typeof FileProcessingArtifactSchema>

export const FileProcessingOutputTargetSchema = z.object({ kind: z.literal('path'), path: AbsolutePathSchema }).strict()
export type FileProcessingOutputTarget = z.infer<typeof FileProcessingOutputTargetSchema>

export type StartFileProcessingJobInput = {
  feature: FileProcessorFeature
  file: FileHandle
  output?: FileProcessingOutputTarget
  context?: {
    dataId?: string
  }
  processorId?: FileProcessorId
}

export const StartFileProcessingJobInputSchema: z.ZodType<StartFileProcessingJobInput> = z
  .object({
    feature: z.enum(FILE_PROCESSOR_FEATURES),
    file: FileHandleSchema as z.ZodType<FileHandle>,
    output: FileProcessingOutputTargetSchema.optional(),
    context: z
      .object({
        dataId: z.string().trim().min(1).optional()
      })
      .strict()
      .optional(),
    processorId: z.enum(FILE_PROCESSOR_IDS).optional()
  })
  .strict()

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
