import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { startBackupMock, cancelBackupMock, selectSaveMock, hookState } = vi.hoisted(() => ({
  startBackupMock: vi.fn(),
  cancelBackupMock: vi.fn(),
  selectSaveMock: vi.fn(),
  hookState: {
    backupId: null as string | null,
    progress: null as null | {
      backupId: string
      phase: 'snapshot'
      current: number
      total: number
    },
    cancelled: false
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@renderer/hooks/useBackupV2', async () => {
  const React = await import('react')
  return {
    useBackupV2: () => {
      const [, bump] = React.useState(0)
      return {
        startBackup: async (preset: 'full' | 'lite', outputPath: string, overwrite = false) => {
          hookState.backupId = 'bk-1'
          hookState.progress = { backupId: 'bk-1', phase: 'snapshot', current: 0, total: 1 }
          bump((n) => n + 1)
          return startBackupMock(preset, outputPath, overwrite)
        },
        cancelBackup: cancelBackupMock,
        loading: false,
        error: null,
        archivePath: null,
        backupId: hookState.backupId,
        progress: hookState.progress,
        cancelled: hookState.cancelled
      }
    }
  }
})

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (channel: string, input?: unknown) => {
      if (channel === 'file.select_save') return selectSaveMock(input)
      throw new Error(`unexpected ipc channel ${channel}`)
    }
  }
}))

const confirmMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/services/popup', async () => {
  const React = await import('react')
  return {
    popup: { confirm: confirmMock },
    createPopup: (Component: React.FC<{ open: boolean; resolve: (v: unknown) => void }>) => {
      const resolve = vi.fn()
      return {
        show: () => {
          render(React.createElement(Component, { open: true, resolve }))
          return Promise.resolve({})
        },
        hide: vi.fn()
      }
    }
  }
})

import BackupExportV2Popup from '../BackupExportV2Popup'

describe('BackupExportV2Popup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    hookState.backupId = null
    hookState.progress = null
    hookState.cancelled = false
    confirmMock.mockReset()
  })

  it('starts backup with selected preset and save path', async () => {
    selectSaveMock.mockResolvedValueOnce('/tmp/out.cherrybackup')
    startBackupMock.mockResolvedValueOnce({ backupId: 'bk-1', archivePath: '/tmp/out.cherrybackup' })

    await BackupExportV2Popup.show()

    // Default preset is full; radio group mocks may not wire onValueChange in unit tests.
    expect(screen.getByText('backup.credentials_warning')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.data.backup.v2.preset.full')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.data.backup.v2.preset.lite')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'backup.confirm.button' }))

    await waitFor(() => expect(selectSaveMock).toHaveBeenCalled())
    expect(selectSaveMock.mock.calls[0][0].filters[0].name).toBe('settings.data.backup.v2.file_filter')

    await waitFor(() => expect(startBackupMock).toHaveBeenCalledWith('full', '/tmp/out.cherrybackup', false))
    await waitFor(() => {
      expect(screen.getByText('settings.data.backup.v2.export.success')).toBeInTheDocument()
      expect(screen.getByText('/tmp/out.cherrybackup')).toBeInTheDocument()
    })
  })

  it('confirms overwrite and retries with overwrite=true when path exists', async () => {
    selectSaveMock.mockResolvedValueOnce('/tmp/out.cherrybackup')
    startBackupMock
      .mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 'BACKUP_OUTPUT_PATH_EXISTS' }))
      .mockResolvedValueOnce({ backupId: 'bk-1', archivePath: '/tmp/out.cherrybackup' })
    confirmMock.mockResolvedValueOnce(true)

    await BackupExportV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'backup.confirm.button' }))

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    await waitFor(() => {
      expect(startBackupMock).toHaveBeenNthCalledWith(1, 'full', '/tmp/out.cherrybackup', false)
      expect(startBackupMock).toHaveBeenNthCalledWith(2, 'full', '/tmp/out.cherrybackup', true)
      expect(screen.getByText('settings.data.backup.v2.export.success')).toBeInTheDocument()
    })
  })

  it('returns to idle when overwrite confirm is cancelled', async () => {
    selectSaveMock.mockResolvedValueOnce('/tmp/out.cherrybackup')
    startBackupMock.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 'BACKUP_OUTPUT_PATH_EXISTS' }))
    confirmMock.mockResolvedValueOnce(false)

    await BackupExportV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'backup.confirm.button' }))

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'backup.confirm.button' })).toBeInTheDocument()
    })
    expect(startBackupMock).toHaveBeenCalledTimes(1)
    expect(startBackupMock).toHaveBeenCalledWith('full', '/tmp/out.cherrybackup', false)
  })

  it('returns to idle when save dialog is cancelled', async () => {
    selectSaveMock.mockResolvedValueOnce(null)

    await BackupExportV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'backup.confirm.button' }))

    await waitFor(() => expect(selectSaveMock).toHaveBeenCalled())
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'backup.confirm.button' })).toBeInTheDocument()
    })
    expect(startBackupMock).not.toHaveBeenCalled()
  })

  it('shows cancelled when startBackup rejects with BACKUP_CANCELLED', async () => {
    selectSaveMock.mockResolvedValueOnce('/tmp/out.cherrybackup')
    const err = Object.assign(new Error('cancelled'), { code: 'BACKUP_CANCELLED' })
    startBackupMock.mockRejectedValueOnce(err)
    hookState.cancelled = true

    await BackupExportV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'backup.confirm.button' }))

    await waitFor(() => {
      expect(screen.getByText('settings.data.backup.v2.export.cancelled')).toBeInTheDocument()
    })
  })

  it('shows failure on non-cancel reject', async () => {
    selectSaveMock.mockResolvedValueOnce('/tmp/out.cherrybackup')
    startBackupMock.mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'BACKUP_DISK_FULL' }))

    await BackupExportV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'backup.confirm.button' }))

    await waitFor(() => {
      expect(screen.getByText('settings.data.backup.v2.export.failure')).toBeInTheDocument()
      expect(screen.getByText('disk full')).toBeInTheDocument()
    })
  })

  it('disables close while selecting save target', async () => {
    let resolveSelect!: (v: string | null) => void
    selectSaveMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSelect = resolve
        })
    )

    await BackupExportV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'backup.confirm.button' }))

    await waitFor(() => {
      expect(screen.getByText('settings.data.backup.v2.export.selecting')).toBeInTheDocument()
    })
    const closeBtn = screen.getByRole('button', { name: 'common.close' })
    expect(closeBtn).toBeDisabled()

    resolveSelect(null)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'backup.confirm.button' })).toBeInTheDocument()
    })
  })

  it('cancel export waits for startBackup settle and shows cancelled', async () => {
    selectSaveMock.mockResolvedValueOnce('/tmp/out.cherrybackup')
    let rejectBackup!: (e: Error) => void
    startBackupMock.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectBackup = reject
        })
    )
    cancelBackupMock.mockResolvedValueOnce(undefined)

    await BackupExportV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'backup.confirm.button' }))

    await waitFor(() => expect(startBackupMock).toHaveBeenCalled())
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.cancel' })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    await waitFor(() => expect(cancelBackupMock).toHaveBeenCalled())

    rejectBackup(Object.assign(new Error('cancelled'), { code: 'BACKUP_CANCELLED' }))
    await waitFor(() => {
      expect(screen.getByText('settings.data.backup.v2.export.cancelled')).toBeInTheDocument()
    })
  })

  it('ignores late success after cancel timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    selectSaveMock.mockResolvedValueOnce('/tmp/out.cherrybackup')
    let resolveBackup!: (v: { backupId: string; archivePath: string }) => void
    startBackupMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBackup = resolve
        })
    )
    cancelBackupMock.mockResolvedValueOnce(undefined)

    await BackupExportV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'backup.confirm.button' }))
    await waitFor(() => expect(startBackupMock).toHaveBeenCalled())
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.cancel' })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    await waitFor(() => expect(cancelBackupMock).toHaveBeenCalled())

    await vi.advanceTimersByTimeAsync(15_000)
    await waitFor(() => {
      expect(screen.getByText('settings.data.backup.v2.export.failure')).toBeInTheDocument()
      expect(screen.getByText('settings.data.backup.v2.export.cancel_timeout')).toBeInTheDocument()
    })

    resolveBackup({ backupId: 'bk-1', archivePath: '/tmp/late.cherrybackup' })
    await waitFor(() => {
      expect(screen.queryByText('settings.data.backup.v2.export.success')).not.toBeInTheDocument()
    })
    vi.useRealTimers()
  })
})
