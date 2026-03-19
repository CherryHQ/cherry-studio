/**
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: this type need be refactored after FileSystem is designed
 * --------------------------------------------------------------------------
 */
import type OpenAI from '@cherrystudio/openai'

/**
 * Supported file type categories.
 */
export enum FileTypes {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  TEXT = 'text',
  DOCUMENT = 'document',
  OTHER = 'other'
}

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
  type: FileTypes
  created_at: string
  count: number
  tokens?: number
  purpose?: OpenAI.FilePurpose
}
