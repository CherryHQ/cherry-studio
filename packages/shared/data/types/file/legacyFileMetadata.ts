/**
 * Legacy v1 `FileMetadata` shape.
 *
 * Carries the snake_case columns (`origin_name`, `created_at`) and OpenAI
 * `purpose` field of the pre-v2 Dexie-backed `files` table. Used exclusively
 * by the v1 → v2 migration path (KnowledgeMigrator and its mappings); v2
 * code MUST use `FileEntry` from `./fileEntry.ts` instead.
 *
 * This module is intentionally NOT re-exported from `./index.ts` — keeping
 * the v1 shape out of the canonical `@shared/data/types/file` namespace
 * prevents downstream v2 consumers from accidentally typing values against
 * the legacy projection. Migrators that need it import from this path
 * directly.
 *
 * Will be removed once the last v1 store is migrated and its KnowledgeMigrator
 * input shape is no longer reachable.
 */
import type OpenAI from '@cherrystudio/openai'
import type { FileType } from '@shared/file/types'

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
