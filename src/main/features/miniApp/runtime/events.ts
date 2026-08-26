/**
 * Host → guest events. Both are fire-and-forget.
 *
 * There is deliberately no awaited event and no ack channel. A mini app can be
 * destroyed at any moment with no notice (design §2.1), so an event whose value
 * depends on the guest getting time to respond is an event the host cannot honour —
 * and shipping it anyway teaches authors to rely on it.
 */

import { application } from '@application'
import { MINI_APP_EVENT_CHANNEL, type MiniAppEvent } from '@shared/ipc/schemas/miniAppBridge'
import { webContents } from 'electron'

/** @returns how many live guests received it — 0 is normal, not an error. */
export function emitToApp(appId: string, event: MiniAppEvent, payload?: unknown): number {
  const guests = application.get('MiniAppRuntimeService').guestsOf(appId)
  let delivered = 0
  for (const id of guests) {
    // `fromId` returns undefined for a webContents that died since registration.
    // Under this execution model that is the common case, not an anomaly.
    const contents = webContents.fromId(id)
    if (!contents) continue
    contents.send(MINI_APP_EVENT_CHANNEL, { event, payload })
    delivered += 1
  }
  return delivered
}
