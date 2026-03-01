import type OpenAI from '@cherrystudio/openai'
import type { File } from '@google/genai'
import type { FileSchema } from '@mistralai/mistralai/models/components'
import * as z from 'zod'

import { objectValues } from './typeUtils'

export type RemoteFile =
  | {
      type: 'gemini'
      file: File
    }
  | {
      type: 'mistral'
      file: FileSchema
    }
  | {
      type: 'openai'
      file: OpenAI.Files.FileObject
    }

/**
 * Type guard to check if a RemoteFile is a Gemini file
 * @param file - The RemoteFile to check
 * @returns True if the file is a Gemini file (file property is of type File)
 */
export const isGeminiFile = (file: RemoteFile): file is { type: 'gemini'; file: File } => {
  return file.type === 'gemini'
}

/**
 * Type guard to check if a RemoteFile is a Mistral file
 * @param file - The RemoteFile to check
 * @returns True if the file is a Mistral file (file property is of type FileSchema)
 */
export const isMistralFile = (file: RemoteFile): file is { type: 'mistral'; file: FileSchema } => {
  return file.type === 'mistral'
}

/** Type guard to check if a RemoteFile is an OpenAI file
 * @param file - The RemoteFile to check
 * @returns True if the file is an OpenAI file (file property is of type OpenAI.Files.FileObject)
 */
export const isOpenAIFile = (file: RemoteFile): file is { type: 'openai'; file: OpenAI.Files.FileObject } => {
  return file.type === 'openai'
}

export type FileStatus = 'success' | 'processing' | 'failed' | 'unknown'

export interface FileUploadResponse {
  fileId: string
  displayName: string
  status: FileStatus
  originalFile?: RemoteFile
}

export interface FileListResponse {
  files: Array<{
    id: string
    displayName: string
    size?: number
    status: FileStatus
    originalFile: RemoteFile
  }>
}

export const FILE_TYPE = {
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  TEXT: 'text',
  DOCUMENT: 'document',
  OTHER: 'other'
} as const

const FileTypeSchema = z.enum(objectValues(FILE_TYPE))

export type FileType = z.infer<typeof FileTypeSchema>

export const FileMetadataSchema = z.object({
  /**
   * Unique identifier of the file
   */
  id: z.string(),
  /**
   * File name
   */
  name: z.string(),
  /**
   * Original name of the file (display name)
   */
  origin_name: z.string(),
  /**
   * File path
   */
  path: z.string(),
  /**
   * File size in bytes
   */
  size: z.number(),
  /**
   * File extension (including the dot)
   */
  ext: z.string(),
  /**
   * File type
   */
  type: FileTypeSchema,
  /**
   * ISO string of file creation time
   */
  created_at: z.string(),
  /**
   * File count
   */
  count: z.number(),
  /**
   * Estimated token size of the file (optional)
   */
  tokens: z.number().optional(),
  /**
   * Purpose of the file
   *
   * TODO: decouple with OpenAI.FilePurpose
   */
  purpose: z
    .custom<OpenAI.FilePurpose>((value) => {
      const validValues = ['assistants', 'batch', 'fine-tune', 'vision', 'user_data', 'evals']
      return typeof value === 'string' && validValues.includes(value)
    })
    .optional()
})

export type FileMetadata = z.infer<typeof FileMetadataSchema>

export type ImageFileMetadata = FileMetadata & {
  type: typeof FILE_TYPE.IMAGE
}

export type PdfFileMetadata = FileMetadata & {
  ext: '.pdf'
}

/**
 * 类型守卫函数，用于检查一个 FileMetadata 是否为图片文件元数据
 * @param file - 要检查的文件元数据
 * @returns 如果文件是图片类型则返回 true
 */
export const isImageFileMetadata = (file: FileMetadata): file is ImageFileMetadata => {
  return file.type === FILE_TYPE.IMAGE
}
