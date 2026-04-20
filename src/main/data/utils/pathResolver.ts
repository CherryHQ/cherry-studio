import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import type { FileEntryOrigin } from '@shared/data/types/file'

const logger = loggerService.withContext('pathResolver')

/**
 * Minimal entry shape needed for path resolution.
 */
export interface PathResolvableEntry {
  id: string
  origin: FileEntryOrigin
  ext: string | null
  externalPath: string | null
}

/**
 * Get the file extension suffix (with dot) or empty string if null.
 */
export function getExtSuffix(ext: string | null): string {
  return ext ? `.${ext}` : ''
}

/**
 * Resolve the physical filesystem path for a FileEntry.
 *
 * - `origin='internal'` → `{userData}/files/{id}{.ext}` (flat UUID-based storage)
 * - `origin='external'` → `externalPath` directly (user-provided absolute path)
 *
 * @throws If null bytes are detected (potential path-truncation attack) or
 *   if `origin='external'` but `externalPath` is null (schema invariant violated).
 *   Security-sensitive rejections are logged at `error` level — these paths
 *   should never reach the resolver if upstream Zod validation runs; arriving
 *   here indicates either a parse-bypass or a data integrity problem worth
 *   investigating.
 */
export function resolvePhysicalPath(entry: PathResolvableEntry): string {
  // Reject null bytes in any user-controlled path segments (path-truncation guard).
  if (entry.id.includes('\0') || (entry.ext && entry.ext.includes('\0'))) {
    logger.error('Null byte detected in entry id/ext', { entryId: entry.id, origin: entry.origin })
    throw new Error('Entry id or extension contains null bytes')
  }

  if (entry.origin === 'internal') {
    return application.getPath('feature.files.data', `${entry.id}${getExtSuffix(entry.ext)}`)
  }

  // external
  if (!entry.externalPath) {
    logger.error('External entry has null externalPath (schema invariant violated)', { entryId: entry.id })
    throw new Error(`external entry ${entry.id} has null externalPath (schema invariant violated)`)
  }
  if (entry.externalPath.includes('\0')) {
    logger.error('Null byte detected in externalPath', { entryId: entry.id })
    throw new Error(`external entry ${entry.id} externalPath contains null bytes`)
  }
  return path.resolve(entry.externalPath)
}
