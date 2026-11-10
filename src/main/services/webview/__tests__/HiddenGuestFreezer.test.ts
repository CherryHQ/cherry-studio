import { EventEmitter } from 'node:events'

import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HIDDEN_FREEZE_DELAY_MS, HiddenGuestFreezer } from '../HiddenGuestFreezer'

interface GuestOptions {
  audible?: boolean
  devTools?: boolean
  foreignDebugger?: boolean
  remoteClient?: boolean
}

/** A guest whose page lifecycle follows the CDP commands it receives, like Chromium's. */
function createGuest(options: GuestOptions = {}) {
  let attached = options.foreignDebugger ?? false
  let destroyed = false
  const guest = Object.assign(new EventEmitter(), {
    lifecycle: 'active',
    remoteClient: options.remoteClient,
    isDestroyed: () => destroyed,
    isCurrentlyAudible: () => options.audible ?? false,
    isDevToolsOpened: () => options.devTools ?? false,
    destroy() {
      destroyed = true
      attached = false
      guest.emit('destroyed')
    },
    debugger: {
      isAttached: () => attached,
      attach() {
        if (attached) throw new Error('Another debugger is already attached')
        attached = true
      },
      detach() {
        attached = false
      },
      sendCommand: async (method: string, params: { state: 'active' | 'frozen' }) => {
        if (!attached) throw new Error('Debugger is not attached')
        if (method === 'Page.setWebLifecycleState') guest.lifecycle = params.state
      }
    }
  })
  return guest
}

const asContents = (guest: ReturnType<typeof createGuest>) => guest as unknown as WebContents

describe('HiddenGuestFreezer', () => {
  let freezer: HiddenGuestFreezer

  beforeEach(() => {
    vi.useFakeTimers()
    freezer = new HiddenGuestFreezer((guest) => (guest as unknown as { remoteClient?: boolean }).remoteClient ?? false)
  })

  afterEach(() => {
    freezer.dispose()
    vi.useRealTimers()
  })

  it('freezes a guest only after it has stayed hidden for the full delay', async () => {
    const guest = createGuest()
    freezer.setVisible(asContents(guest), false)

    await vi.advanceTimersByTimeAsync(HIDDEN_FREEZE_DELAY_MS - 1)
    expect(guest.lifecycle).toBe('active')

    await vi.advanceTimersByTimeAsync(1)
    expect(guest.lifecycle).toBe('frozen')
  })

  it('never freezes a guest shown again before the delay, and restarts the delay on the next hide', async () => {
    const guest = createGuest()
    freezer.setVisible(asContents(guest), false)
    await vi.advanceTimersByTimeAsync(HIDDEN_FREEZE_DELAY_MS - 1)
    freezer.setVisible(asContents(guest), true)
    freezer.setVisible(asContents(guest), false)

    await vi.advanceTimersByTimeAsync(HIDDEN_FREEZE_DELAY_MS - 1)
    expect(guest.lifecycle).toBe('active')
    expect(guest.debugger.isAttached()).toBe(false)
  })

  it('resumes a frozen guest when shown and releases the debugger', async () => {
    const guest = createGuest()
    freezer.setVisible(asContents(guest), false)
    await vi.advanceTimersByTimeAsync(HIDDEN_FREEZE_DELAY_MS)

    freezer.setVisible(asContents(guest), true)
    await vi.advanceTimersByTimeAsync(0)

    expect(guest.lifecycle).toBe('active')
    expect(guest.debugger.isAttached()).toBe(false)
  })

  it.each<[string, GuestOptions]>([
    ['playing audio', { audible: true }],
    ['open in DevTools', { devTools: true }],
    ['driven by another debugger client', { foreignDebugger: true }],
    ['driven by a remote-debugging-port client', { remoteClient: true }]
  ])('leaves a hidden guest running while it is %s', async (_label, options) => {
    const guest = createGuest(options)
    freezer.setVisible(asContents(guest), false)
    await vi.advanceTimersByTimeAsync(HIDDEN_FREEZE_DELAY_MS)

    expect(guest.lifecycle).toBe('active')
    expect(guest.debugger.isAttached()).toBe(options.foreignDebugger ?? false)
  })

  it('drops the pending freeze of a guest destroyed while hidden', async () => {
    const guest = createGuest()
    freezer.setVisible(asContents(guest), false)
    guest.destroy()

    await vi.advanceTimersByTimeAsync(HIDDEN_FREEZE_DELAY_MS)
    expect(guest.lifecycle).toBe('active')
    expect(guest.listenerCount('destroyed')).toBe(0)
  })

  it('resumes every frozen guest on dispose so a restart cannot strand a page frozen', async () => {
    const frozen = createGuest()
    const pending = createGuest()
    freezer.setVisible(asContents(frozen), false)
    await vi.advanceTimersByTimeAsync(HIDDEN_FREEZE_DELAY_MS)
    freezer.setVisible(asContents(pending), false)

    freezer.dispose()
    await vi.advanceTimersByTimeAsync(HIDDEN_FREEZE_DELAY_MS)

    expect(frozen.lifecycle).toBe('active')
    expect(frozen.debugger.isAttached()).toBe(false)
    expect(pending.lifecycle).toBe('active')
  })
})
