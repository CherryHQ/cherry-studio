/**
 * Preview-owned temporary backends for `cherry.storage` and `cherry.file`.
 *
 * A live preview has no `mini_app` row and no installation, so neither persistent
 * backend can serve it: the file ref table's `source_id` foreign-keys to that row
 * (an insert under a preview runtime id is rejected), and a storage file under
 * `MiniApps/data/<runtimeId>` would outlive the preview tree it describes — the
 * close path removes only the extracted tree, and the startup sweep visits only the
 * previews root. What a preview needs is scratch state for exactly the preview's
 * life, so these backends are in memory, keyed by runtime id, and
 * `MiniAppPreviewService.closePreview` drops the entry. Both cleanup contracts hold
 * structurally: a closed preview's state is deleted here, and a restarted process
 * has no state at all — nothing ever reaches disk, so there is nothing to sweep.
 *
 * The caps are the SAME quotas the persistent backends enforce: a preview is a
 * full-fidelity run of the app (AC3), not a sandbox with different rules.
 */

import type { QuotaUsage } from '@shared/types/miniAppQuota'

import { assertWithinQuota, QuotaExceededError } from './quota'
import { MINI_APP_STORAGE_MAX_BYTES, MINI_APP_STORAGE_MAX_KEYS } from './storageFile'

const storageByRuntime = new Map<string, Record<string, string>>()
const filesByRuntime = new Map<string, Map<string, Buffer>>()

export function readPreviewStorage(runtimeId: string): Record<string, string> {
  return storageByRuntime.get(runtimeId) ?? {}
}

/**
 * The same pre-write weighing `writeStorage` does: the cap is checked against the
 * serialized whole, so a rejected set leaves the previous state untouched.
 */
export function writePreviewStorage(runtimeId: string, map: Record<string, string>): void {
  const bytes = Buffer.byteLength(JSON.stringify(map), 'utf8')
  if (bytes > MINI_APP_STORAGE_MAX_BYTES) {
    throw new QuotaExceededError(`Save file would be ${bytes} bytes (limit ${MINI_APP_STORAGE_MAX_BYTES})`)
  }
  if (Object.keys(map).length > MINI_APP_STORAGE_MAX_KEYS) {
    throw new QuotaExceededError(`Save file would hold ${Object.keys(map).length} keys`)
  }
  storageByRuntime.set(runtimeId, map)
}

export function previewStorageUsage(runtimeId: string) {
  const map = readPreviewStorage(runtimeId)
  return {
    bytes: Buffer.byteLength(JSON.stringify(map), 'utf8'),
    count: Object.keys(map).length,
    bytesLimit: MINI_APP_STORAGE_MAX_BYTES,
    countLimit: MINI_APP_STORAGE_MAX_KEYS
  }
}

function previewFiles(runtimeId: string): Map<string, Buffer> {
  let files = filesByRuntime.get(runtimeId)
  if (!files) {
    files = new Map()
    filesByRuntime.set(runtimeId, files)
  }
  return files
}

export function previewFileUsage(runtimeId: string): QuotaUsage {
  let bytes = 0
  const files = filesByRuntime.get(runtimeId)
  if (files) for (const buf of files.values()) bytes += buf.byteLength
  return { bytes, count: files?.size ?? 0 }
}

/**
 * A replace counts as a swap, not an add — same accounting the DB backend does with
 * `previousSize`, so an autosaving preview converges on its real footprint instead
 * of tripping the budget on the 200th save of one name.
 */
export function previewFileSave(runtimeId: string, name: string, bytes: Buffer): void {
  const files = previewFiles(runtimeId)
  const previous = files.get(name)
  const usage = previewFileUsage(runtimeId)
  assertWithinQuota(
    'file',
    { bytes: usage.bytes - (previous?.byteLength ?? 0), count: usage.count - (previous ? 1 : 0) },
    { bytes: bytes.byteLength, count: 1 }
  )
  files.set(name, bytes)
}

export function previewFileLoad(runtimeId: string, name: string): Buffer | null {
  return filesByRuntime.get(runtimeId)?.get(name) ?? null
}

export function previewFileList(runtimeId: string): string[] {
  return [...(filesByRuntime.get(runtimeId)?.keys() ?? [])].sort()
}

export function previewFileDelete(runtimeId: string, name: string): void {
  filesByRuntime.get(runtimeId)?.delete(name)
}

/**
 * The preview service's close hook. Missing entries are fine: a preview that never
 * touched either backend has nothing to drop, and close is idempotent by contract.
 */
export function clearPreviewStores(runtimeId: string): void {
  storageByRuntime.delete(runtimeId)
  filesByRuntime.delete(runtimeId)
}
