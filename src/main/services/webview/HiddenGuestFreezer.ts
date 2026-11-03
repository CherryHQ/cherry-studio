import type { WebContents } from 'electron'

import { loggerService } from '@logger'

const logger = loggerService.withContext('HiddenGuestFreezer')

export const HIDDEN_FREEZE_DELAY_MS = 5 * 60_000

interface HiddenGuest {
  timer?: ReturnType<typeof setTimeout>
  frozen: boolean
  forget: () => void
}

/**
 * A `<webview>` whose host tab is hidden still reports itself visible to Chromium, so its
 * timers are never throttled. Once a guest has stayed hidden for {@link HIDDEN_FREEZE_DELAY_MS}
 * it is frozen with `Page.setWebLifecycleState` (Chrome's background-tab freezing) and resumed
 * when shown again. The debugger stays attached while frozen so a resume is ordered after it.
 */
export class HiddenGuestFreezer {
  private readonly hidden = new Map<WebContents, HiddenGuest>()

  /** @param isRemotelyDebugged - true while a `--remote-debugging-port` client drives the guest */
  constructor(private readonly isRemotelyDebugged: (guest: WebContents) => boolean) {}

  setVisible(guest: WebContents, visible: boolean): void {
    let entry = this.hidden.get(guest)
    if (visible) {
      if (!entry) return
      this.forget(guest, entry)
      if (entry.frozen) this.resume(guest)
      return
    }
    if (!entry) {
      const onDestroyed = () => this.forget(guest, entry!)
      guest.once('destroyed', onDestroyed)
      entry = { frozen: false, forget: () => guest.removeListener('destroyed', onDestroyed) }
      this.hidden.set(guest, entry)
    }
    if (entry.frozen) return
    clearTimeout(entry.timer)
    const pending = entry
    entry.timer = setTimeout(() => this.freeze(guest, pending), HIDDEN_FREEZE_DELAY_MS)
  }

  dispose(): void {
    for (const [guest, entry] of this.hidden) {
      this.forget(guest, entry)
      if (entry.frozen) this.resume(guest)
    }
  }

  private forget(guest: WebContents, entry: HiddenGuest): void {
    clearTimeout(entry.timer)
    entry.forget()
    this.hidden.delete(guest)
  }

  private freeze(guest: WebContents, entry: HiddenGuest): void {
    entry.timer = undefined
    // ponytail: a guest skipped here stays awake until its next hide; no re-check timer.
    if (
      guest.isDestroyed() ||
      guest.isCurrentlyAudible() ||
      guest.isDevToolsOpened() ||
      guest.debugger.isAttached() ||
      this.isRemotelyDebugged(guest)
    ) {
      return
    }
    try {
      guest.debugger.attach()
    } catch (error) {
      logger.debug('Cannot attach to hidden webview', { error })
      return
    }
    entry.frozen = true
    guest.debugger
      .sendCommand('Page.setWebLifecycleState', { state: 'frozen' })
      .catch((error) => logger.debug('Failed to freeze hidden webview', { error }))
  }

  private resume(guest: WebContents): void {
    // A detach while frozen means the renderer went away; its replacement is not frozen.
    if (guest.isDestroyed() || !guest.debugger.isAttached()) return
    guest.debugger
      .sendCommand('Page.setWebLifecycleState', { state: 'active' })
      .catch((error) => logger.debug('Failed to resume webview', { error }))
      .finally(() => {
        if (!guest.isDestroyed() && guest.debugger.isAttached()) guest.debugger.detach()
      })
  }
}
