/**
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: this type need be refactored after FileSystem is designed
 * --------------------------------------------------------------------------
 */
import type OpenAI from '@cherrystudio/openai'
import * as z from 'zod'

export const FILE_TYPE = {
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  TEXT: 'text',
  DOCUMENT: 'document',
  OTHER: 'other'
} as const

export const FileTypeSchema = z.enum([
  FILE_TYPE.IMAGE,
  FILE_TYPE.VIDEO,
  FILE_TYPE.AUDIO,
  FILE_TYPE.TEXT,
  FILE_TYPE.DOCUMENT,
  FILE_TYPE.OTHER
])

export type FileType = z.infer<typeof FileTypeSchema>

/**
 * File metadata stored by the app.
 */
export interface FileMetadata {
  id: string
  name: string
  origin_name: string
  path: string
  size: number
  ext: string
  type: FileType
  created_at: string
  count: number
  tokens?: number
  purpose?: OpenAI.FilePurpose
}
