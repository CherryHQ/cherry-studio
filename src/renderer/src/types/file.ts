import type { File } from '@google/genai'
import type { FileSchema } from '@mistralai/mistralai/models/components'

interface BaseFileSource {
  id: string
  name: string
  type: FileTypes
  size: number
  ext: string
  source: 'local' | 'remote'
}

export interface RemoteFileSource extends BaseFileSource {
  source: 'remote'
  url: string
  status: 'pending' | 'downloading' | 'downloaded' | 'error'
  downloadProgress?: number
  localPath?: string // 下载后的本地路径
}

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

export interface FileUploadResponse {
  fileId: string
  displayName: string
  status: 'success' | 'processing' | 'failed' | 'unknown'
  originalFile?: RemoteFile // 保留原始响应，以备需要
}

export interface FileListResponse {
  files: Array<{
    id: string
    displayName: string
    size?: number
    status: 'success' | 'processing' | 'failed' | 'unknown'
    originalFile: RemoteFile // 保留原始文件对象
  }>
}

export interface LocalFileSource extends BaseFileSource {
  origin_name: string
  path: string
  created_at: string
  count: number
  tokens?: number
  source: 'local'
}

// 联合类型，表示一个文件可以是本地的或远程的
export type FileSource = LocalFileSource | RemoteFileSource

// 为了保持向后兼容
export type FileType = LocalFileSource

// 类型保护函数，用于区分文件类型
export const isLocalFile = (file: FileSource): file is LocalFileSource & { source: 'local' } => {
  return file.source === 'local'
}

export const isRemoteFile = (file: FileSource): file is RemoteFileSource & { source: 'remote' } => {
  return file.source === 'remote'
}

export enum FileTypes {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  TEXT = 'text',
  DOCUMENT = 'document',
  OTHER = 'other'
}
