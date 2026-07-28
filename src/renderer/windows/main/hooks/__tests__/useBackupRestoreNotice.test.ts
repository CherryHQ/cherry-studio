import { toast } from '@renderer/services/toast'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), error: vi.fn() }) } }))
vi.mock('i18next', () => ({ t: (key: string) => key }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))

import { useBackupRestoreNotice } from '../useBackupRestoreNotice'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  requestMock.mockResolvedValue({ operation: null, restore: { kind: 'none' } })
})

describe('useBackupRestoreNotice', () => {
  it.each([
    ['completed', 'settings.data.backup_v2.notice.completed_title'],
    ['rolled-back', 'settings.data.backup_v2.notice.rolled_back_title'],
    ['failed', 'settings.data.backup_v2.notice.failed_title'],
    ['expired', 'settings.data.backup_v2.notice.expired_title']
  ])('keeps a persistent Lite notice for %s', async (state, title) => {
    requestMock.mockResolvedValue({ operation: null, restore: { kind: 'journal', state, restoreId: 'r1' } })
    renderHook(() => useBackupRestoreNotice())
    await flush()
    expect(toast.warning).toHaveBeenCalledWith(expect.objectContaining({ title, timeout: 0 }))
  })

  it('does not report active or unreadable states as a completed outcome', async () => {
    requestMock.mockResolvedValue({ operation: null, restore: { kind: 'journal', state: 'prepared', restoreId: 'r1' } })
    renderHook(() => useBackupRestoreNotice())
    await flush()
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
