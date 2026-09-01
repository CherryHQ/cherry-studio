/** Channel names and event names shared by the guest preload and main. */

import { MINI_APP_MAX_INPUT_BYTES, MINI_APP_MAX_MESSAGES } from '@shared/types/miniAppQuota'

export const MINI_APP_BRIDGE_CHANNEL = 'mini_app.bridge'
export const MINI_APP_STREAM_CHANNEL = 'mini_app.bridge:stream'
export const MINI_APP_EVENT_CHANNEL = 'mini_app.bridge:event'

export const MINI_APP_EVENTS = ['app.localeChange', 'app.visibilityChange'] as const

export type MiniAppEvent = (typeof MINI_APP_EVENTS)[number]

/**
 * The wire shape of every bridge reply, and the reason it is a VALUE rather than a thrown
 * error: `ipcMain.handle` serializes a rejection down to its `message` and drops `name`
 * (`electron.d.ts:8877`), so the seven frozen names of design §6.0 cannot survive as
 * exceptions. Declared in `@shared` because main writes it and preload reads it, and two
 * copies of a wire format is how they drift.
 */
export type CherryErrorName =
  | 'PermissionDenied'
  | 'QuotaExceeded'
  | 'RateLimited'
  | 'Unavailable'
  | 'InvalidArgument'
  | 'Cancelled'
  | 'Internal'

export interface CherryPublicError {
  name: CherryErrorName
  message: string
}

export type BridgeResult = { ok: true; value: unknown } | { ok: false; error: CherryPublicError }

/**
 * Cheap length caps the guest checks before sending. NOT the enforcement point —
 * main re-validates every one of them — but rejecting in the guest keeps an
 * oversized payload from being copied into the main process just to be refused
 * there. Derived from the same quotas main uses, so the two cannot drift.
 */
export const MINI_APP_GUEST_LIMITS = {
  /** `storage.*` key — the same 256 the quota charges for (design §3.4). */
  storageKeyChars: 256,
  /** `cherry.storage.set(value)` — plain string, so characters ≈ the byte quota. */
  storageValueChars: 1024 * 1024,
  /** `file.*` logical name (design §3.5). */
  fileNameChars: 128,
  /** `cherry.file.save(data)` — base64, so 4 characters per 3 bytes plus padding. */
  fileDataChars: Math.ceil((10 * 1024 * 1024) / 3) * 4 + 4,
  /** `cherry.network.fetch({ body })` — base64 of the 1 MB request body (design §9). */
  fetchBodyChars: Math.ceil((1024 * 1024) / 3) * 4 + 4,
  /** The other variable-length `network.fetch` inputs (design §9) — each stopped before structured clone. */
  fetchUrlChars: 2048,
  fetchHeaderCount: 32,
  fetchHeaderNameChars: 128,
  fetchHeaderValueChars: 4096,
  chatMessages: MINI_APP_MAX_MESSAGES,
  /**
   * Characters, while main counts BYTES — deliberately generous so this gate can never
   * reject something main would accept. Its job is stopping an 80 MB string from being
   * structured-cloned into the main process, not being exact.
   */
  chatContentChars: MINI_APP_MAX_INPUT_BYTES,
  callIdChars: 64,
  notificationTitleChars: 64,
  notificationBodyChars: 256,
  /** `cherry.clipboard.write({ text })` — plain text, the same 1 MB a storage value gets. */
  clipboardTextChars: 1024 * 1024
} as const

/**
 * EVERY variable-length public input is in the table above — design §6.0 froze the list.
 * Earlier versions covered the two obvious payloads and left `key`, `name`, `callId` and
 * the notification strings wide open, which is the same hole with a smaller headline.
 * Adding a public string or array without adding it here is not a complete change.
 */
