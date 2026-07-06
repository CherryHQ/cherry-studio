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
 * edge — `getUrl` does a DB lookup + pure path formatting, no fs I/O). No guard
 * on `getUrl`: `logo_file_id` is an `on delete set null` FK so a set id always
 * resolves, and provider/mini-app reads only run renderer-driven (FileManager,
 * a WhenReady service, is always up) — a throw would be a real invariant break
 * worth surfacing, not swallowing.
 */

import { application } from '@application'
import type { FileUrlString } from '@shared/types/file'

export function resolveLogoSrc(fileId: string | null | undefined): FileUrlString | undefined {
  return fileId ? application.get('FileManager').getUrl(fileId) : undefined
}
