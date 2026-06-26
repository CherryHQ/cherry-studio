import type { StorageHealth } from '@shared/types/storageMonitor'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useStorageMonitorNotification } from '../useStorageMonitorNotification'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))
vi.mock('i18next', () => ({ t: (key: string) => key }))

type Level = StorageHealth['level']
const health = (level: Level, freeBytes = 0): StorageHealth => ({
  level,
  freeBytes,
  totalBytes: 500 * 1024 ** 3,
  checkedAt: 0
})

let healthCallback: ((h: StorageHealth) => void) | null
let unsubscribeMock: ReturnType<typeof vi.fn>
let getHealthMock: ReturnType<typeof vi.fn>
let onHealthChangeMock: ReturnType<typeof vi.fn>

function setupWindowApi(initial: StorageHealth) {
  healthCallback = null
  unsubscribeMock = vi.fn()
  onHealthChangeMock = vi.fn((cb: (h: StorageHealth) => void) => {
    healthCallback = cb
    return unsubscribeMock
  })
  getHealthMock = vi.fn(() => Promise.resolve(initial))
  ;(window as unknown as { api: unknown }).api = {
    storageMonitor: { onHealthChange: onHealthChangeMock, getHealth: getHealthMock }
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  window.toast = {
    closeAll: vi.fn(),
    closeToast: vi.fn(),
    error: vi.fn(),
    getToastQueue: vi.fn(() => ({ toasts: [] })),
    info: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  } as unknown as typeof window.toast
  setupWindowApi(health('ok'))
})

describe('useStorageMonitorNotification', () => {
  it('subscribes and pulls the initial health on mount', () => {
    renderHook(() => useStorageMonitorNotification())
    expect(onHealthChangeMock).toHaveBeenCalledTimes(1)
    expect(getHealthMock).toHaveBeenCalledTimes(1)
  })

  it('shows a persistent warning when health goes low', () => {
    renderHook(() => useStorageMonitorNotification())
    healthCallback!(health('low', 0.5 * 1024 ** 3))

    expect(window.toast.warning).toHaveBeenCalledTimes(1)
    expect(window.toast.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'settings.data.limit.appDataDiskQuotaDescription',
        timeout: 0,
        title: 'settings.data.limit.appDataDiskQuota'
      })
    )
  })

  it('dedupes repeated low health into a single warning', () => {
    renderHook(() => useStorageMonitorNotification())
    healthCallback!(health('low'))
    healthCallback!(health('low'))

    expect(window.toast.warning).toHaveBeenCalledTimes(1)
  })

  it('dismisses the warning when health recovers to ok', () => {
    renderHook(() => useStorageMonitorNotification())
    healthCallback!(health('low'))
    healthCallback!(health('ok'))

    expect(window.toast.closeToast).toHaveBeenCalledTimes(1)
  })

  it('does not dismiss when no warning is currently shown', () => {
    renderHook(() => useStorageMonitorNotification())
    healthCallback!(health('ok'))

    expect(window.toast.closeToast).not.toHaveBeenCalled()
  })

  it('warns when the initial pulled health is already low', async () => {
    setupWindowApi(health('low', 0.5 * 1024 ** 3))
    renderHook(() => useStorageMonitorNotification())
    await flush()

    expect(window.toast.warning).toHaveBeenCalledTimes(1)
  })

  it('ignores the initial pull that resolves after unmount', async () => {
    setupWindowApi(health('low', 0.5 * 1024 ** 3))
    const { unmount } = renderHook(() => useStorageMonitorNotification())
    unmount() // tear down before the async getHealth() pull resolves
    await flush()

    expect(window.toast.warning).not.toHaveBeenCalled()
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useStorageMonitorNotification())
    unmount()
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
  })
})
