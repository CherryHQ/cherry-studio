import { beforeEach, describe, expect, it, vi } from 'vitest'

const { toggleDevToolsMock, windowIsDestroyedMock, windowManager } = vi.hoisted(() => {
  const toggleDevToolsMock = vi.fn()
  const windowIsDestroyedMock = vi.fn()
  const windowManager = {
    getWindow: vi.fn(() => ({
      isDestroyed: windowIsDestroyedMock,
      webContents: { toggleDevTools: toggleDevToolsMock }
    }))
  }

  return { toggleDevToolsMock, windowIsDestroyedMock, windowManager }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ WindowManager: windowManager })
})

import { devtoolsHandlers } from '../devtools'

const ctx = (senderId: string | null) => ({ senderId })

beforeEach(() => {
  vi.clearAllMocks()
  windowIsDestroyedMock.mockReturnValue(false)
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
