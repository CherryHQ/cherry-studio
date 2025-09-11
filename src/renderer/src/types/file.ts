import type { File } from '@google/genai'
import type { FileSchema } from '@mistralai/mistralai/models/components'
import type OpenAI from 'openai'

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

/**
 * @interface
 * @description 文件元数据接口
 */
export interface FileMetadata {
  /**
   * 文件的唯一标识符
   */
  id: string
  /**
   * 文件名
   */
  name: string
  /**
   * 文件的原始名称（展示名称）
   */
  origin_name: string
  /**
   * 文件路径
   */
  path: string
  /**
   * 文件大小，单位为字节
   */
  size: number
  /**
   * 文件扩展名（包含.）
   */
  ext: string
  /**
   * 文件类型
   */
  type: FileTypes
  /**
   * 文件创建时间的ISO字符串
   */
  created_at: string
  /**
   * 文件计数
   */
  count: number
  /**
   * 该文件预计的token大小 (可选)
   */
  tokens?: number
  /**
   * 该文件的用途
   */
  purpose?: OpenAI.FilePurpose
}

export interface FileType extends FileMetadata {}

export enum FileTypes {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  TEXT = 'text',
  DOCUMENT = 'document',
  OTHER = 'other'
}

export type ImageFileMetadata = FileMetadata & {
  type: FileTypes.IMAGE
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
  return file.type === FileTypes.IMAGE
}
