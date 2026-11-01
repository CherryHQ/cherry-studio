import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { tabHandlers } from '../tab'

const windowManager = { getWindow: vi.fn() }
const subWindowService = { detachTab: vi.fn(), attachTab: vi.fn() }

const ctx = (senderId: string | null) => ({ senderId })

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'WindowManager') return windowManager
    if (name === 'SubWindowService') return subWindowService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('tabHandlers', () => {
  it('drag_end restores the caller window opacity when below 1', async () => {
    const setOpacity = vi.fn()
    windowManager.getWindow.mockReturnValue({ isDestroyed: () => false, getOpacity: () => 0.85, setOpacity })
    await tabHandlers['tab.drag_end'](undefined, ctx('w1'))
    expect(setOpacity).toHaveBeenCalledWith(1)
  })

  it('drag_end is a no-op when there is no caller id', async () => {
    await tabHandlers['tab.drag_end'](undefined, ctx(null))
    expect(windowManager.getWindow).not.toHaveBeenCalled()
  })
})
