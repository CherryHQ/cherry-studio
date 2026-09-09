import { cacheService } from '@data/CacheService'
import { toast } from '@renderer/services/toast'
import type { StorageHealth } from '@shared/types/storageMonitor'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@data/hooks/useCache', async (importOriginal) => importOriginal())
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn() }) } }))
vi.mock('i18next', () => ({ t: (key: string) => key }))

const { useStorageMonitorNotification } = await import('../useStorageMonitorNotification')

const health = (level: StorageHealth['level']): StorageHealth => ({
  level,
  freeBytes: level === 'low' ? 512 * 1024 ** 2 : 20 * 1024 ** 3,
  totalBytes: 500 * 1024 ** 3,
  checkedAt: Date.now()
})

describe('useStorageMonitorNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheService.deleteShared('storage.health')
  })

  it('warns from a low snapshot that existed before mount', () => {
    cacheService.setShared('storage.health', health('low'))

    renderHook(() => useStorageMonitorNotification())

    expect(toast.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'settings.data.limit.appDataDiskQuotaDescription',
        timeout: 0,
        title: 'settings.data.limit.appDataDiskQuota'
      })
    )
  })

  it('dedupes repeated low snapshots', () => {
    const { result } = renderHook(() => useStorageMonitorNotification())

    act(() => cacheService.setShared('storage.health', health('low')))
    act(() => cacheService.setShared('storage.health', health('low')))

    expect(result.current).toBeUndefined()
    expect(toast.warning).toHaveBeenCalledOnce()
  })

  it('dismisses the warning when the shared snapshot recovers', () => {
    const { result } = renderHook(() => useStorageMonitorNotification())

    act(() => cacheService.setShared('storage.health', health('low')))
    act(() => cacheService.setShared('storage.health', health('ok')))

    expect(result.current).toBeUndefined()
    expect(toast.closeToast).toHaveBeenCalledOnce()
  })
})
