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

  describe('startBackup', () => {
    it('sets loading then resolves with archivePath on success', async () => {
      ipcMocks.request.mockResolvedValue({ backupId: 'bk-1', archivePath: '/out/full.cbu' })
      const { result } = renderHook(() => useBackupV2())

      let resolved: { backupId: string; archivePath: string } | undefined
      await act(async () => {
        resolved = await result.current.startBackup('full', '/out/full.cbu')
      })

      expect(ipcMocks.request).toHaveBeenCalledWith('backup.start_backup', { preset: 'full', outputPath: '/out/full.cbu' })
      expect(resolved).toEqual({ backupId: 'bk-1', archivePath: '/out/full.cbu' })
      expect(result.current.loading).toBe(false)
      expect(result.current.archivePath).toBe('/out/full.cbu')
      expect(result.current.error).toBeNull()
    })

    it('subscribes to backup.progress and updates state from ticks', async () => {
      let progressCb: ((update: unknown) => void) | undefined
      ipcMocks.on.mockImplementation((_event: string, cb: (update: unknown) => void) => {
        progressCb = cb
        return vi.fn()
      })

      let resolveRequest!: (v: unknown) => void
      ipcMocks.request.mockReturnValue(new Promise((r) => (resolveRequest = r)))

      const { result } = renderHook(() => useBackupV2())

      let pending!: Promise<unknown>
      act(() => {
        pending = result.current.startBackup('lite', '/out/lite.cbu')
      })

      expect(result.current.loading).toBe(true)
      expect(ipcMocks.on).toHaveBeenCalledWith('backup.progress', expect.any(Function))

      act(() => {
        progressCb!({ backupId: 'bk-2', phase: 'staging', percent: 40 })
      })

      expect(result.current.backupId).toBe('bk-2')
      expect(result.current.progress).toEqual({ backupId: 'bk-2', phase: 'staging', percent: 40 })

      await act(async () => {
        resolveRequest({ backupId: 'bk-2', archivePath: '/out/lite.cbu' })
        await pending
      })

      expect(result.current.loading).toBe(false)
      expect(result.current.archivePath).toBe('/out/lite.cbu')
    })

    it('unsubscribes from progress after completion', async () => {
      const unsubscribe = vi.fn()
      ipcMocks.on.mockReturnValue(unsubscribe)
      ipcMocks.request.mockResolvedValue({ backupId: 'bk-3', archivePath: '/out/a.cbu' })

      const { result } = renderHook(() => useBackupV2())

      await act(async () => {
        await result.current.startBackup('full', '/out/a.cbu')
      })

      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('sets cancelled=true when error code is BACKUP_CANCELLED', async () => {
      const cancelError = Object.assign(new Error('export cancelled'), { code: 'BACKUP_CANCELLED' })
      ipcMocks.request.mockRejectedValue(cancelError)

      const { result } = renderHook(() => useBackupV2())

      await act(async () => {
        await result.current.startBackup('full', '/out/x.cbu').catch(() => {})
      })

      expect(result.current.cancelled).toBe(true)
      expect(result.current.error).toBe('export cancelled')
      expect(result.current.loading).toBe(false)
    })

    it('sets cancelled=false for non-cancel failures', async () => {
      const diskError = Object.assign(new Error('insufficient disk'), { code: 'BACKUP_INSUFFICIENT_DISK' })
      ipcMocks.request.mockRejectedValue(diskError)

      const { result } = renderHook(() => useBackupV2())

      await act(async () => {
        await result.current.startBackup('full', '/out/x.cbu').catch(() => {})
      })

      expect(result.current.cancelled).toBe(false)
      expect(result.current.error).toBe('insufficient disk')
    })
  })

  describe('cancelBackup', () => {
    it('sends backup.cancel with the active backupId', async () => {
      let progressCb: ((update: unknown) => void) | undefined
      ipcMocks.on.mockImplementation((_event: string, cb: (update: unknown) => void) => {
        progressCb = cb
        return vi.fn()
      })

      let resolveRequest!: (v: unknown) => void
      ipcMocks.request.mockImplementation((route: string) => {
        if (route === 'backup.start_backup') return new Promise((r) => (resolveRequest = r))
        return Promise.resolve()
      })

      const { result } = renderHook(() => useBackupV2())

      act(() => {
        result.current.startBackup('full', '/out/x.cbu').catch(() => {})
      })

      act(() => {
        progressCb!({ backupId: 'bk-9', phase: 'archiving', percent: 70 })
      })

      await act(async () => {
        await result.current.cancelBackup()
      })

      expect(ipcMocks.request).toHaveBeenCalledWith('backup.cancel', { backupId: 'bk-9' })

      const cancelError = Object.assign(new Error('cancelled'), { code: 'BACKUP_CANCELLED' })
      await act(async () => {
        resolveRequest(Promise.reject(cancelError))
      })
    })

    it('is a no-op when no active export', async () => {
      ipcMocks.request.mockResolvedValue(undefined)
      const { result } = renderHook(() => useBackupV2())

      await act(async () => {
        await result.current.cancelBackup()
      })

      expect(ipcMocks.request).not.toHaveBeenCalled()
    })
  })

  describe('startRestore', () => {
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
})
