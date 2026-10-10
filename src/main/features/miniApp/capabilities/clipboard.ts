/**
 * `cherry.clipboard` — plain text, both directions, and only while the guest is
 * visible AND has keyboard focus.
 *
 * Focus is the one signal the user gives without a dialog. Without it, a hidden or
 * background app could read what they copied elsewhere, or swap what they are about
 * to paste — the clipboard's two classic abuses. Visibility is checked explicitly
 * rather than inferred from focus: both are the host's own state, so the rule does not
 * rest on Chromium never focusing a `display: none` guest.
 */

import { clipboard, webContents } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import { MINI_APP_GUEST_LIMITS } from '@shared/ipc/schemas/miniAppBridge'

import { PermissionDeniedError } from '../grants'
import { ConcurrentRateLimiter } from './quota'

const WriteParams = z.object({ text: z.string().max(MINI_APP_GUEST_LIMITS.clipboardTextChars) })

/**
 * Enough for a paste button and a copy button, not for polling: a read is one user action,
 * a copy-happy app may write a few times a minute. `1` in flight because the clipboard is
 * one shared resource — the slot is held across the await, as in `file` and `network`.
 */
const readLimiter = new ConcurrentRateLimiter('clipboard.read', 10, 1)
const writeLimiter = new ConcurrentRateLimiter('clipboard.write', 30, 1)

function assertInFront(appId: string, senderId: number, permission: 'clipboard.read' | 'clipboard.write'): void {
  const inFront =
    application.get('MiniAppRuntimeService').isGuestVisible(senderId) && webContents.fromId(senderId)?.isFocused()
  if (!inFront) {
    throw new PermissionDeniedError(
      appId,
      permission,
      'the clipboard is available only while the app is visible and has keyboard focus'
    )
  }
}

export const clipboardCapability = {
  async read(appId: string, senderId: number) {
    assertInFront(appId, senderId, 'clipboard.read')
    const release = readLimiter.acquire(appId)
    try {
      // Clipped, never refused: the app cannot make the user's clipboard smaller.
      return { text: (await clipboard.readText()).slice(0, MINI_APP_GUEST_LIMITS.clipboardTextChars) }
    } finally {
      release()
    }
  },

  async write(appId: string, params: unknown, senderId: number) {
    const { text } = WriteParams.parse(params)
    assertInFront(appId, senderId, 'clipboard.write')
    const release = writeLimiter.acquire(appId)
    try {
      await clipboard.writeText(text)
      return { ok: true }
    } finally {
      release()
    }
  }
}
