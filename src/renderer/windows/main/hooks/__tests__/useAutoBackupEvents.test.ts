import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { AutoBackupEvent } from '@shared/types/backup'

import { useAutoBackupEvents } from '../useAutoBackupEvents'

const request = vi.fn()
let emitStateChanged: ((event: AutoBackupEvent) => void) | undefined

beforeEach(() => {
  MockCacheUtils.resetMocks()
  emitStateChanged = undefined
  request.mockReset()
  request.mockImplementation((route: string) =>
    Promise.resolve(route === 'backup.get_auto_sync_state' ? { pendingNotifications: [] } : undefined)
  )
  const on = vi.fn((event: string, handler: (event: AutoBackupEvent) => void) => {
    if (event === 'backup.auto_sync_state_changed') emitStateChanged = handler
    return () => {}
  })
  ;(window as unknown as { api: unknown }).api = { ipcApi: { request, on } }
})

describe('useAutoBackupEvents', () => {
  it('toasts a failed automatic backup pushed over IPC once and acknowledges it', () => {
    renderHook(() => useAutoBackupEvents())
    const failed: AutoBackupEvent = { id: 7, type: 's3', status: 'failed', timestamp: 1, errorMessage: 'boom' }

    act(() => {
      emitStateChanged?.(failed)
      emitStateChanged?.(failed)
    })

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('backup.acknowledge_auto_sync_notification', { type: 's3', id: 7 })
  })
})
