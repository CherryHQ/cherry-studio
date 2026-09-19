import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

const emitToGuest = vi.fn()
vi.mock('../events', () => ({ emitToApp: vi.fn(), emitToGuest }))

/** `webContentsId` → the guest Electron would hand back, with the host window it hangs off. */
const guests = new Map<number, { hostWebContents?: { id: number } }>()
vi.mock('electron', () => ({
  app: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: (id: number) => guests.get(id) }
}))

import { mockMiniAppApplication } from '../../__tests__/applicationMock'

vi.mock('@application', () => mockMiniAppApplication({ IpcApiService: { broadcast: vi.fn() } }))

const { MiniAppRuntimeService } = await import('../MiniAppRuntimeService')

const A = 'com.example.a'
const MAIN_WINDOW = 10
const DETACHED_WINDOW = 20

beforeEach(() => {
  BaseService.resetInstances()
  guests.clear()
  emitToGuest.mockClear()
})

describe('pane visibility', () => {
  it('reaches the guests of the reporting window, and only those', () => {
    // The same app can be open in a detached window with its own pane; hiding it here
    // says nothing about there.
    guests.set(1, { hostWebContents: { id: MAIN_WINDOW } })
    guests.set(2, { hostWebContents: { id: DETACHED_WINDOW } })
    const svc = new MiniAppRuntimeService()
    svc.registerGuest(A, 1)
    svc.registerGuest(A, 2)

    svc.setPaneVisible(MAIN_WINDOW, A, false)

    expect(emitToGuest).toHaveBeenCalledTimes(1)
    expect(emitToGuest).toHaveBeenCalledWith(1, 'app.visibilityChange', { visible: false })
    expect(svc.isGuestVisible(1)).toBe(false)
    expect(svc.isGuestVisible(2)).toBe(true)
  })

  it('emits on a change, never on a repeat', () => {
    guests.set(1, { hostWebContents: { id: MAIN_WINDOW } })
    const svc = new MiniAppRuntimeService()
    svc.registerGuest(A, 1)

    svc.setPaneVisible(MAIN_WINDOW, A, false)
    svc.setPaneVisible(MAIN_WINDOW, A, false)
    svc.setPaneVisible(MAIN_WINDOW, A, true)

    expect(emitToGuest.mock.calls.map((c) => c[2])).toEqual([{ visible: false }, { visible: true }])
  })

  it('a guest attaching into a pane already reported hidden starts hidden, with no event', () => {
    // The pool reports before the webview attaches; the report must not be lost.
    const svc = new MiniAppRuntimeService()
    svc.setPaneVisible(MAIN_WINDOW, A, false)
    guests.set(1, { hostWebContents: { id: MAIN_WINDOW } })

    svc.registerGuest(A, 1)

    expect(svc.isGuestVisible(1)).toBe(false)
    expect(emitToGuest).not.toHaveBeenCalled()
  })

  it('a guest nobody reported on counts as shown; one nobody registered counts as hidden', () => {
    guests.set(1, { hostWebContents: { id: MAIN_WINDOW } })
    const svc = new MiniAppRuntimeService()
    svc.registerGuest(A, 1)

    expect(svc.isGuestVisible(1)).toBe(true)
    expect(svc.isGuestVisible(99)).toBe(false)
  })

  it('forgets a guest it unregistered', () => {
    guests.set(1, { hostWebContents: { id: MAIN_WINDOW } })
    const svc = new MiniAppRuntimeService()
    svc.registerGuest(A, 1)

    svc.unregisterGuest(1)

    expect(svc.isGuestVisible(1)).toBe(false)
  })
})
