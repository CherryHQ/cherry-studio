import { application } from '@application'
import { loggerService } from '@logger'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

const logger = loggerService.withContext('pathResolver')

/**
 * Minimal entry shape needed for path resolution. Mirrors the
 * discriminated-union shape of `FileEntry` so the same `origin`-driven
 * narrowing the BO exposes is preserved here — internal variant has no
 * `externalPath`, external variant has it as a non-null string.
 */
export type PathResolvableEntry =
  | { id: string; origin: 'internal'; ext: string | null }
  | { id: string; origin: 'external'; ext: string | null; externalPath: AbsoluteFilePath }

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
 * - `origin='external'` → `externalPath` directly (user-provided absolute path)
 *
 * Returns a branded `AbsoluteFilePath` so callers can pass the result straight to
 * `@main/utils/file/fs` without a manual `as AbsoluteFilePath` cast.
 *
 * @throws If null bytes are detected (potential path-truncation attack) in
 *   entry id / ext. Security-sensitive rejections are logged at `error`
 *   level — these inputs should never reach the resolver if upstream Zod
 *   validation runs; arriving here indicates either a parse-bypass or a data
 *   integrity problem worth investigating. The external branch cannot throw
 *   this way: `entry.externalPath` is already an `AbsoluteFilePath`, proven canonical
 *   (including null-byte rejection) by `AbsoluteFilePathSchema` at parse time.
 */
export function resolvePhysicalPath(entry: PathResolvableEntry): AbsoluteFilePath {
  // Reject null bytes in any user-controlled path segments (path-truncation guard).
  if (entry.id.includes('\0') || (entry.ext && entry.ext.includes('\0'))) {
    logger.error('Null byte detected in entry id/ext', { entryId: entry.id, origin: entry.origin })
    throw new Error('Entry id or extension contains null bytes')
  }

  if (entry.origin === 'internal') {
    return AbsoluteFilePathSchema.parse(
      application.getPath('feature.files.data', `${entry.id}${getExtSuffix(entry.ext)}`)
    )
  }

  // entry.origin === 'external' — externalPath is already a canonical
  // AbsoluteFilePath (branded at parse time by AbsoluteFilePathSchema), so no further
  // normalization or null-byte check is needed here.
  return entry.externalPath
}
