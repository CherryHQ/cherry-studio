import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcMocks = vi.hoisted(() => ({ request: vi.fn(), on: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: ipcMocks.request,
    on: ipcMocks.on
  }
}))

import { useBackupV2 } from '../useBackupV2'

describe('useBackupV2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcMocks.on.mockReturnValue(vi.fn())
  })

  it('starts a restore through the dedicated IPC route without changing export state', async () => {
    ipcMocks.request.mockResolvedValue({ restoreId: 'rst-123' })
    const { result } = renderHook(() => useBackupV2())

    let restoreId: string | undefined
    await act(async () => {
      const restore = await result.current.startRestore('/backups/full.cbu')
      restoreId = restore.restoreId
    })

    expect(ipcMocks.request).toHaveBeenCalledWith('backup.start_restore', { archivePath: '/backups/full.cbu' })
    expect(restoreId).toBe('rst-123')
    expect(result.current.loading).toBe(false)
    expect(result.current.progress).toBeNull()
  })
})
