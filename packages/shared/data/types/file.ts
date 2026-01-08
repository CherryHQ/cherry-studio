// copy from src/renderer/src/types/file.ts

import type OpenAI from '@cherrystudio/openai'

// ============================================================================
// File Types
// ============================================================================

/**
 * Supported file type categories
 */
export enum FileTypes {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  TEXT = 'text',
  DOCUMENT = 'document',
  OTHER = 'other'
}

// ============================================================================
// File Metadata
// ============================================================================

/**
 * File metadata interface
 */
export interface FileMetadata {
  /** Unique file identifier */
  id: string
  /** File name (stored name) */
  name: string
  /** Original file name (display name) */
  origin_name: string
  /** File path */
  path: string
  /** File size in bytes */
  size: number
  /** File extension (including dot) */
  ext: string
  /** File type category */
  type: FileTypes
  /** File creation timestamp (ISO string) */
  created_at: string
  /** File reference count */
  count: number
  /** Estimated token count (optional) */
  tokens?: number
  /** File purpose for API usage */
  purpose?: OpenAI.FilePurpose
}
