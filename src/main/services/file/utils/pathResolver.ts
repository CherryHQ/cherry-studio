import { application } from '@application'
import { loggerService } from '@logger'
import type { FilePath } from '@shared/file/types'

const logger = loggerService.withContext('pathResolver')

/**
 * Minimal entry shape needed for path resolution. Mirrors the
 * discriminated-union shape of `FileEntry` so the same `origin`-driven
 * narrowing the BO exposes is preserved here — internal variant has no
 * `externalPath`, external variant has it as a non-null string.
 */
export type PathResolvableEntry =
  | { id: string; origin: 'internal'; ext: string | null }
  | { id: string; origin: 'external'; ext: string | null; externalPath: FilePath }

/**
 * Get the file extension suffix (with dot) or empty string if null.
 */
export function getExtSuffix(ext: string | null): string {
  return ext ? `.${ext}` : ''
}

/**
 * Resolve the physical filesystem path for a FileEntry.
 *
 * - `origin='internal'` → `{userData}/Data/Files/{id}{.ext}` (flat UUID-based storage)
 * - `origin='external'` → `entry.externalPath` directly (already `FilePath` after
 *   `FileEntrySchema.parse`)
 *
 * Returns a branded `FilePath` so callers can pass the result straight to
 * `@main/utils/file/fs` without a manual `as FilePath` cast — the brand
 * is sanctioned here because:
 * - Internal branch: `application.getPath` returns canonical paths by
 *   construction (the path namespace registry guarantees absolute, no `\0`,
 *   no trailing separator).
 * - External branch: `entry.externalPath` is already `FilePath`, branded by
 *   `FilePathSchema` at the BO parse boundary.
 *
 * @throws If null bytes are detected (potential path-truncation attack) in
 *   entry id / ext. Security-sensitive rejections are logged at `error` level;
 *   these inputs should never reach the resolver if upstream Zod validation
 *   runs.
 */
export function resolvePhysicalPath(entry: PathResolvableEntry): FilePath {
  // Reject null bytes in any user-controlled path segments (path-truncation guard).
  if (entry.id.includes('\0') || (entry.ext && entry.ext.includes('\0'))) {
    logger.error('Null byte detected in entry id/ext', { entryId: entry.id, origin: entry.origin })
    throw new Error('Entry id or extension contains null bytes')
  }

  if (entry.origin === 'internal') {
    return application.getPath('feature.files.data', `${entry.id}${getExtSuffix(entry.ext)}`) as FilePath
  }

  // entry.origin === 'external' — schema discriminator guarantees externalPath
  // is present and already canonical (FilePathSchema transforms on BO parse),
  // so we return it directly. The null-byte guard the old `path.resolve` call
  // shadowed is enforced upstream by FilePathSchema's refine.
  return entry.externalPath
}
