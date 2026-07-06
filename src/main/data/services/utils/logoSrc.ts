/**
 * Resolve an uploaded logo's `file_entry` id to a renderer-ready `file://` URL.
 *
 * The read models (`rowToRuntimeProvider` / `rowToMiniApp`) call this so a
 * provider / mini-app DTO exposes a ready `logoSrc` and the renderer never
 * reconstructs a disk path (`${filesPath}/${id}.webp`) — the file storage
 * layout stays a main-process detail, and windows that don't mount
 * `app.path.files` still render logos.
 *
 * Reaches FileManager via `application.get` (DI, not a data→services layering
 * edge — `getUrl` does a DB lookup + pure path formatting, no fs I/O).
 */

import { application } from '@application'
import { loggerService } from '@logger'
import type { FileUrlString } from '@shared/types/file'

const logger = loggerService.withContext('resolveLogoSrc')

export function resolveLogoSrc(fileId: string | null | undefined): FileUrlString | undefined {
  if (!fileId) return undefined
  try {
    return application.get('FileManager').getUrl(fileId)
  } catch (error) {
    // `logo_file_id` is a `on delete set null` FK, so a set id should always
    // resolve — a throw here is a real anomaly (missing entry / FileManager
    // unavailable). Surface it, then degrade to no logo rather than failing the
    // whole provider / mini-app list read; the renderer falls back to the key.
    logger.warn('failed to resolve uploaded logo url', { fileId, error })
    return undefined
  }
}
