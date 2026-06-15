import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, toggleDevToolsMock, windowIsDestroyedMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  toggleDevToolsMock: vi.fn(),
  windowIsDestroyedMock: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { devtoolsHandlers } from '../devtools'

const windowManager = {
  getWindow: vi.fn(() => ({
    isDestroyed: windowIsDestroyedMock,
    webContents: { toggleDevTools: toggleDevToolsMock }
  }))
}

const ctx = (senderId: string | null) => ({ senderId })

beforeEach(() => {
  vi.clearAllMocks()
  windowIsDestroyedMock.mockReturnValue(false)
  appGetMock.mockImplementation((name: string) => {
    if (name === 'WindowManager') return windowManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('devtoolsHandlers', () => {
  it('toggle is a no-op when senderId is null', async () => {
    await devtoolsHandlers['devtools.toggle'](undefined, ctx(null))
    expect(windowManager.getWindow).not.toHaveBeenCalled()
    expect(toggleDevToolsMock).not.toHaveBeenCalled()
  })

  it('toggle toggles only the caller window', async () => {
    await devtoolsHandlers['devtools.toggle'](undefined, ctx('settings-window'))
    expect(windowManager.getWindow).toHaveBeenCalledWith('settings-window')
    expect(toggleDevToolsMock).toHaveBeenCalledOnce()
  })

  it('toggle skips destroyed caller windows', async () => {
    windowIsDestroyedMock.mockReturnValue(true)

    await devtoolsHandlers['devtools.toggle'](undefined, ctx('settings-window'))
    expect(toggleDevToolsMock).not.toHaveBeenCalled()
  })
})
