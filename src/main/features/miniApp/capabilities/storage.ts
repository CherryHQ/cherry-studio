/**
 * `cherry.storage` — localStorage semantics: persistent, never evicted.
 *
 * Deliberately not routed through the app's Cache subsystem, whose documented
 * contract is "temp data, can lose". A save file cannot.
 */

import * as z from 'zod'

import { application } from '@application'
import type { QuotaUsageWithLimits } from '@shared/types/miniAppQuota'

import { previewStorageUsage, readPreviewStorage, writePreviewStorage } from './previewStores'
import { WriteRateLimiter } from './quota'
import { MINI_APP_STORAGE_MAX_BYTES, readStorage, storageUsage, writeStorage } from './storageFile'

/**
 * A live preview has no installation and no data directory: its storage is the
 * preview-owned in-memory backend, dropped by the preview service on close. The
 * runtime id IS the key there, exactly as it is the directory name on disk.
 */
function isLivePreview(appId: string): boolean {
  return application.getExisting('MiniAppPreviewService')?.getPreviewByRuntimeId(appId) !== undefined
}

// Bytes, not characters: `.max(256)` on a CJK key admits 768 bytes, and the file cap is
// counted in bytes. Same reasoning as MINI_APP_MAX_INPUT_BYTES.
const KeyParams = z.object({
  key: z
    .string()
    .min(1)
    .refine((k) => Buffer.byteLength(k, 'utf8') <= 256, 'key exceeds 256 bytes')
})
// Bounded in the SCHEMA so an oversized value is refused during parse, not after being
// copied over IPC. The real ceiling is the whole-file cap `writeStorage` enforces.
const SetParams = KeyParams.extend({ value: z.string().max(MINI_APP_STORAGE_MAX_BYTES) })

const limiter = new WriteRateLimiter()

export const storageCapability = {
  get(appId: string, params: unknown) {
    const { key } = KeyParams.parse(params)
    const map = isLivePreview(appId) ? readPreviewStorage(appId) : readStorage(appId)
    return { value: map[key] ?? null }
  },

  set(appId: string, params: unknown) {
    const { key, value } = SetParams.parse(params)
    limiter.check(appId, Buffer.byteLength(value, 'utf8'))
    if (isLivePreview(appId)) {
      // `writePreviewStorage` weighs the merged whole before committing it, the same
      // refuse-before-touch contract `writeStorage` keeps on disk.
      writePreviewStorage(appId, { ...readPreviewStorage(appId), [key]: value })
      return { ok: true }
    }
    // `writeStorage` refuses before it touches the disk, so a rejected save cannot
    // leave a half-written file behind and the previous contents stay readable.
    writeStorage(appId, { ...readStorage(appId), [key]: value })
    return { ok: true }
  },

  delete(appId: string, params: unknown) {
    const { key } = KeyParams.parse(params)
    // A delete is a write. Leaving it out of the limiter leaves a delete-only loop
    // hammering the disk with nothing counting it.
    limiter.check(appId)
    if (isLivePreview(appId)) {
      const map = readPreviewStorage(appId)
      delete map[key]
      writePreviewStorage(appId, map)
      return { ok: true }
    }
    const map = readStorage(appId)
    delete map[key]
    writeStorage(appId, map)
    return { ok: true }
  },

  keys(appId: string) {
    const map = isLivePreview(appId) ? readPreviewStorage(appId) : readStorage(appId)
    return { keys: Object.keys(map).sort() }
  },

  usage(appId: string): QuotaUsageWithLimits {
    return isLivePreview(appId) ? previewStorageUsage(appId) : storageUsage(appId)
  }
}
