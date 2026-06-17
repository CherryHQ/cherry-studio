import type { FileHandle } from '@shared/file/types'
import { FileHandleSchema } from '@shared/file/types'
import * as z from 'zod'

import { FILE_PROCESSOR_IDS } from '../preference/preferenceTypes'
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

export const FileProcessingJobOutputSchema = z
  .object({
    artifact: FileProcessingArtifactSchema
  })
  .strict()
export type FileProcessingJobOutput = z.infer<typeof FileProcessingJobOutputSchema>

export const FileProcessingImageToTextInputSchema = z
  .object({
    file: FileHandleSchema,
    requestId: z.string().trim().min(1).optional()
  })
  .strict()
export type FileProcessingImageToTextInput = {
  file: FileHandle
  requestId?: string
}

export const FileProcessingImageToTextResultSchema = z
  .object({
    text: z.string()
  })
  .strict()
export type FileProcessingImageToTextResult = z.infer<typeof FileProcessingImageToTextResultSchema>

export const FileProcessingImageToTextErrorCodeSchema = z.enum([
  'default_not_configured',
  'default_unavailable',
  'failed'
])
export type FileProcessingImageToTextErrorCode = z.infer<typeof FileProcessingImageToTextErrorCodeSchema>

export class FileProcessingImageToTextError extends Error {
  constructor(
    public readonly code: FileProcessingImageToTextErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'FileProcessingImageToTextError'
  }
}

export const FileProcessingImageToTextIpcResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      text: z.string()
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: FileProcessingImageToTextErrorCodeSchema,
      message: z.string()
    })
    .strict()
])
export type FileProcessingImageToTextIpcResult = z.infer<typeof FileProcessingImageToTextIpcResultSchema>

export function isFileProcessingImageToTextErrorCode(value: unknown): value is FileProcessingImageToTextErrorCode {
  return FileProcessingImageToTextErrorCodeSchema.safeParse(value).success
}

export function getFileProcessingImageToTextErrorCode(error: unknown): FileProcessingImageToTextErrorCode {
  const message = error instanceof Error ? error.message : String(error ?? '')

  if (message.includes('Default file processor for image_to_text is not configured')) {
    return 'default_not_configured'
  }

  if (message.includes('does not support image_to_text') || message.includes('is not available on this platform')) {
    return 'default_unavailable'
  }

  return 'failed'
}

export const ListAvailableFileProcessorsResultSchema = z
  .object({
    processorIds: z.array(z.enum(FILE_PROCESSOR_IDS))
  })
  .strict()
export type ListAvailableFileProcessorsResult = z.infer<typeof ListAvailableFileProcessorsResultSchema>
