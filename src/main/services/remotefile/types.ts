import type OpenAI from '@cherrystudio/openai'
import type { File } from '@google/genai'
import type { FileSchema } from '@mistralai/mistralai/models/components'

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
