import type OpenAI from '@cherrystudio/openai'
import { objectValues } from '@types'
import * as z from 'zod'

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
  type: FileType
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
  /**
   * Association identity that links a composer file token to its file metadata.
   * It is not a file path, display name, or file storage identity.
   */
  fileTokenSourceId?: string
}

export type PdfFileMetadata = FileMetadata & {
  ext: '.pdf'
}

export type { ImageFileMetadata } from '@shared/data/types/file/legacyFileMetadata'
export { isImageFileMetadata } from '@shared/data/types/file/legacyFileMetadata'
