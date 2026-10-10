/**
 * Host → guest events. Both are fire-and-forget.
 *
 * There is deliberately no awaited event and no ack channel. A mini app can be
 * destroyed at any moment with no notice (design §2.1), so an event whose value
 * depends on the guest getting time to respond is an event the host cannot honour —
 * and shipping it anyway teaches authors to rely on it.
 */

import { webContents } from 'electron'

import { application } from '@application'
import { MINI_APP_EVENT_CHANNEL, type MiniAppEvent } from '@shared/ipc/schemas/miniAppBridge'

/** @returns how many live guests received it — 0 is normal, not an error. */
export function emitToApp(appId: string, event: MiniAppEvent, payload?: unknown): number {
  let delivered = 0
  for (const id of application.get('MiniAppRuntimeService').guestsOf(appId)) {
    if (emitToGuest(id, event, payload)) delivered += 1
  }
  return delivered
}

/** ONE instance, for what is a property of a pane rather than of the app — visibility. */
export function emitToGuest(webContentsId: number, event: MiniAppEvent, payload?: unknown): boolean {
  // `fromId` returns undefined for a webContents that died since registration.
  // Under this execution model that is the common case, not an anomaly.
  const contents = webContents.fromId(webContentsId)
  if (!contents) return false
  contents.send(MINI_APP_EVENT_CHANNEL, { event, payload })
  return true
}
