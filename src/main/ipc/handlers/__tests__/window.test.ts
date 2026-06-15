import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { windowHandlers } from '../window'

const windowManager = {
  close: vi.fn(() => true),
  minimize: vi.fn(() => true),
  maximize: vi.fn(() => true),
  unmaximize: vi.fn(() => true),
  setFullScreen: vi.fn(() => true),
  isMaximized: vi.fn(() => true),
  isFullScreen: vi.fn(() => false),
  getInitData: vi.fn(() => ({ path: '/settings/provider' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'WindowManager') return windowManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = (senderId: string | null) => ({ senderId })

describe('windowHandlers', () => {
  it('close/minimize/maximize/unmaximize act on the caller window by its senderId', async () => {
    await windowHandlers['window.close'](undefined, ctx('w1'))
    await windowHandlers['window.minimize'](undefined, ctx('w2'))
    await windowHandlers['window.maximize'](undefined, ctx('w3'))
    await windowHandlers['window.unmaximize'](undefined, ctx('w4'))
    expect(windowManager.close).toHaveBeenCalledWith('w1')
    expect(windowManager.minimize).toHaveBeenCalledWith('w2')
    expect(windowManager.maximize).toHaveBeenCalledWith('w3')
    expect(windowManager.unmaximize).toHaveBeenCalledWith('w4')
  })

  it('set_full_screen forwards the value and the caller senderId', async () => {
    await windowHandlers['window.set_full_screen'](true, ctx('w1'))
    expect(windowManager.setFullScreen).toHaveBeenCalledWith('w1', true)
  })

  it('is_maximized / is_full_screen return the queried boolean for the caller window', async () => {
    expect(await windowHandlers['window.is_maximized'](undefined, ctx('w1'))).toBe(true)
    expect(await windowHandlers['window.is_full_screen'](undefined, ctx('w1'))).toBe(false)
    expect(windowManager.isMaximized).toHaveBeenCalledWith('w1')
    expect(windowManager.isFullScreen).toHaveBeenCalledWith('w1')
  })

  it('get_init_data returns the stored init data for the caller window', async () => {
    const result = await windowHandlers['window.get_init_data'](undefined, ctx('w1'))
    expect(windowManager.getInitData).toHaveBeenCalledWith('w1')
    expect(result).toEqual({ path: '/settings/provider' })
  })

  it('void controls are a no-op when the caller is not a tracked window (senderId null)', async () => {
    await windowHandlers['window.close'](undefined, ctx(null))
    await windowHandlers['window.minimize'](undefined, ctx(null))
    await windowHandlers['window.set_full_screen'](true, ctx(null))
    expect(windowManager.close).not.toHaveBeenCalled()
    expect(windowManager.minimize).not.toHaveBeenCalled()
    expect(windowManager.setFullScreen).not.toHaveBeenCalled()
  })

  it('queries fall back to the legacy "no window" defaults when senderId is null', async () => {
    expect(await windowHandlers['window.is_maximized'](undefined, ctx(null))).toBe(false)
    expect(await windowHandlers['window.is_full_screen'](undefined, ctx(null))).toBe(false)
    expect(await windowHandlers['window.get_init_data'](undefined, ctx(null))).toBeNull()
    expect(windowManager.isMaximized).not.toHaveBeenCalled()
    expect(windowManager.getInitData).not.toHaveBeenCalled()
  })
})
