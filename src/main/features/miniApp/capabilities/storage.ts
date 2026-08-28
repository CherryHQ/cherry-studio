/**
 * `cherry.storage` — localStorage semantics: persistent, never evicted.
 *
 * Deliberately not routed through the app's Cache subsystem, whose documented
 * contract is "temp data, can lose". A save file cannot.
 */

import type { QuotaUsageWithLimits } from '@shared/types/miniAppQuota'
import * as z from 'zod'

import { WriteRateLimiter } from './quota'
import { MINI_APP_STORAGE_MAX_BYTES, readStorage, storageUsage, writeStorage } from './storageFile'

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
    return { value: readStorage(appId)[key] ?? null }
  },

  set(appId: string, params: unknown) {
    const { key, value } = SetParams.parse(params)
    limiter.check(appId, Buffer.byteLength(value, 'utf8'))
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
    const map = readStorage(appId)
    delete map[key]
    writeStorage(appId, map)
    return { ok: true }
  },

  keys(appId: string) {
    return { keys: Object.keys(readStorage(appId)).sort() }
  },

  usage(appId: string): QuotaUsageWithLimits {
    return storageUsage(appId)
  }
}
