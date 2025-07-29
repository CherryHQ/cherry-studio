import type { File } from '@google/genai'
import type { FileSchema } from '@mistralai/mistralai/models/components'

export interface RemoteFile {
  type: 'gemini' | 'mistral'
  file: File | FileSchema
}

/**
 * Type guard to check if a RemoteFile is a Gemini file
 * @param file - The RemoteFile to check
 * @returns True if the file is a Gemini file (file property is of type File)
 */
export const isGeminiFile = (file: RemoteFile): file is RemoteFile & { type: 'gemini'; file: File } => {
  return file.type === 'gemini'
}

/**
 * Type guard to check if a RemoteFile is a Mistral file
 * @param file - The RemoteFile to check
 * @returns True if the file is a Mistral file (file property is of type FileSchema)
 */
export const isMistralFile = (file: RemoteFile): file is RemoteFile & { type: 'mistral'; file: FileSchema } => {
  return file.type === 'mistral'
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
