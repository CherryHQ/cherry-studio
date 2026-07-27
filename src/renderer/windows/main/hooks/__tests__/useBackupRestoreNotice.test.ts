import { toast } from '@renderer/services/toast'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))
vi.mock('i18next', () => ({ t: (key: string) => key }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))

import { useBackupRestoreNotice } from '../useBackupRestoreNotice'

/**
 * The notice exists so the storage a completed restore holds — and the file
 * cleanup it pauses — cannot be forgotten about. These tests pin which states
 * speak up and that a remount cannot stack duplicates.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function statusIs(restore: unknown) {
  requestMock.mockResolvedValue({ operation: null, restore })
}

beforeEach(() => {
  vi.clearAllMocks()
  statusIs({ kind: 'none' })
})

describe('useBackupRestoreNotice', () => {
  it('tells the user a completed restore is still holding disk space', async () => {
    statusIs({ kind: 'journal', state: 'completed', restoreId: 'r1', preset: 'full' })

    renderHook(() => useBackupRestoreNotice())
    await flush()

    expect(toast.warning).toHaveBeenCalledWith({
      key: 'backup-restore-notice',
      timeout: 0,
      title: 'settings.data.backup_v2.notice.completed_title',
      description: 'settings.data.backup_v2.notice.completed_description'
    })
  })

  it.each([
    ['failed', 'settings.data.backup_v2.notice.failed_title'],
    ['expired', 'settings.data.backup_v2.notice.expired_title']
  ])('reports that a %s restore did not happen', async (state, title) => {
    statusIs({ kind: 'journal', state, restoreId: 'r1', preset: 'lite' })

    renderHook(() => useBackupRestoreNotice())
    await flush()

    expect(toast.warning).toHaveBeenCalledWith(expect.objectContaining({ title, timeout: 0 }))
  })

  it.each(['none', 'unreadable'])('says nothing when the journal reports %s', async (kind) => {
    statusIs(kind === 'none' ? { kind } : { kind, error: 'bad json' })

    renderHook(() => useBackupRestoreNotice())
    await flush()

    expect(toast.warning).not.toHaveBeenCalled()
  })

  it.each(['prepared', 'armed', 'promoting'])('stays quiet during the in-flight state %s', async (state) => {
    statusIs({ kind: 'journal', state, restoreId: 'r1', preset: 'lite' })

    renderHook(() => useBackupRestoreNotice())
    await flush()

    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('drops a status that arrives after unmount', async () => {
    statusIs({ kind: 'journal', state: 'completed', restoreId: 'r1', preset: 'full' })

    const { unmount } = renderHook(() => useBackupRestoreNotice())
    unmount()
    await flush()

    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('survives a status read that fails, without a toast', async () => {
    requestMock.mockRejectedValue(new Error('main is not listening'))

    renderHook(() => useBackupRestoreNotice())
    await flush()

    expect(toast.warning).not.toHaveBeenCalled()
  })
})
