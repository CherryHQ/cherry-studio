/**
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: this type need be refactored after FileSystem is designed
 * --------------------------------------------------------------------------
 */
import type OpenAI from '@cherrystudio/openai'

// FILE_TYPE, FileTypeSchema, FileType moved to @shared/file/types.ts
// Re-export here for backward compatibility (90+ consumers)
export { FILE_TYPE, type FileType, FileTypeSchema } from '@shared/file/types'

import type { FileType } from '@shared/file/types'

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
