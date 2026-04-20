import path from 'node:path'

import { application } from '@application'
import type { FileEntryOrigin } from '@shared/data/types/file'

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
 * @throws If `origin='external'` but `externalPath` is null (schema invariant violated).
 */
export function resolvePhysicalPath(entry: PathResolvableEntry): string {
  // Reject null bytes in any user-controlled path segments
  if (entry.id.includes('\0') || (entry.ext && entry.ext.includes('\0'))) {
    throw new Error('Entry id or extension contains null bytes')
  }

  if (entry.origin === 'internal') {
    return application.getPath('files', `${entry.id}${getExtSuffix(entry.ext)}`)
  }

  // external
  if (!entry.externalPath) {
    throw new Error(`external entry ${entry.id} has null externalPath (schema invariant violated)`)
  }
  if (entry.externalPath.includes('\0')) {
    throw new Error(`external entry ${entry.id} externalPath contains null bytes`)
  }
  return path.resolve(entry.externalPath)
}
