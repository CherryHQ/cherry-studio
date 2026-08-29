/**
 * `cherry.notification` — its own namespace, not under `app`, because `app.*` is
 * read-only environment while this interrupts the user.
 *
 * Attribution is mandatory: without it a mini app could impersonate a Cherry
 * system notification, which is a phishing primitive.
 */

import { application } from '@application'
import * as z from 'zod'

import { RateLimitedError } from './quota'

/** Frozen in design §6.5. Wordy-but-sane input is TRUNCATED below, never rejected;
 *  the schema's far-higher `max()` bounds are a sanity gate on abuse, not the contract. */
const NOTIFICATION_LIMITS = { name: 32, title: 64, body: 256 } as const

const ShowParams = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(500).optional()
})

const clip = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 5
const windows = new Map<string, { start: number; used: number }>()

/** Test seam only. */
export function resetNotificationRateForTest(): void {
  windows.clear()
}

export const notificationCapability = {
  async show(appId: string, params: unknown) {
    // Non-strict on purpose: a forged `sourceAppId` is dropped rather than rejected,
    // and attribution comes from the authenticated caller below.
    const { title, body } = ShowParams.parse(params)

    const now = Date.now()
    const win = windows.get(appId)
    if (!win || now - win.start >= WINDOW_MS) {
      windows.set(appId, { start: now, used: 1 })
    } else if (win.used >= MAX_PER_WINDOW) {
      throw new RateLimitedError(`notification rate exceeded: more than ${MAX_PER_WINDOW} per minute`)
    } else {
      win.used += 1
    }

    // `sendNotification` shows unconditionally, so the category gate belongs here, as
    // in `deliverConversationNotification`. AFTER the rate limit, or off = free burns.
    if (!application.get('PreferenceService').get('app.notification.mini_app.enabled')) {
      return { ok: true }
    }

    // appId FIRST: system notifications truncate from the END, so a manifest-owned name
    // in front is exactly the half that survives — and any update can rename it.
    const name = clip(application.get('MiniAppRuntimeService').displayNameOf(appId), NOTIFICATION_LIMITS.name)
    await application.get('NotificationService').sendNotification({
      id: `miniapp:${appId}:${Date.now()}`,
      type: 'info',
      title: `${appId} · ${name} — ${clip(title, NOTIFICATION_LIMITS.title)}`,
      message: clip(body ?? '', NOTIFICATION_LIMITS.body),
      timestamp: Date.now(),
      source: 'mini-app'
    })
    return { ok: true }
  }
}
