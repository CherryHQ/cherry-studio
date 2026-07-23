import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { startRestoreMock, selectMock, confirmMock } = vi.hoisted(() => ({
  startRestoreMock: vi.fn(),
  selectMock: vi.fn(),
  confirmMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@renderer/hooks/useBackupV2', () => ({
  useBackupV2: () => ({
    startRestore: startRestoreMock,
    startBackup: vi.fn(),
    cancelBackup: vi.fn(),
    loading: false,
    error: null,
    archivePath: null,
    backupId: null,
    progress: null,
    cancelled: false
  })
}))

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

Object.defineProperty(window, 'api', {
  configurable: true,
  value: { file: { select: selectMock } }
})

import RestoreV2Popup from '../RestoreV2Popup'

describe('RestoreV2Popup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('forwards selected[0].path and enters relaunching before startRestore', async () => {
    selectMock.mockResolvedValueOnce([{ path: '/tmp/backup.cherrybackup' }])
    confirmMock.mockResolvedValueOnce(true)
    let resolveRestore!: (v: { restoreId: string }) => void
    startRestoreMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRestore = resolve
        })
    )

    await RestoreV2Popup.show()

    fireEvent.click(screen.getByRole('button', { name: 'restore.confirm.button' }))
    await waitFor(() => expect(selectMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('/tmp/backup.cherrybackup')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    await waitFor(() => {
      expect(screen.getByText('settings.data.backup.v2.restore.relaunching')).toBeInTheDocument()
    })
    expect(startRestoreMock).toHaveBeenCalledWith('/tmp/backup.cherrybackup')

    resolveRestore({ restoreId: 'rst-1' })
  })

  it('returns to ready-with-error on reject and shows the code', async () => {
    selectMock.mockResolvedValueOnce([{ path: '/tmp/backup.cherrybackup' }])
    confirmMock.mockResolvedValueOnce(true)
    const err = Object.assign(new Error('packaged restore unavailable'), {
      code: 'BACKUP_RESTORE_QUIESCE_UNAVAILABLE'
    })
    startRestoreMock.mockRejectedValueOnce(err)

    await RestoreV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'restore.confirm.button' }))
    await waitFor(() => expect(screen.getByText('/tmp/backup.cherrybackup')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => {
      expect(screen.getByText('BACKUP_RESTORE_QUIESCE_UNAVAILABLE')).toBeInTheDocument()
      expect(screen.getByText('settings.data.backup.v2.restore.failure')).toBeInTheDocument()
    })
  })

  it('maps BACKUP_MERGE_STRATEGY_UNSUPPORTED to the SKIP-only copy', async () => {
    selectMock.mockResolvedValueOnce([{ path: '/tmp/backup.cherrybackup' }])
    confirmMock.mockResolvedValueOnce(true)
    const err = Object.assign(new Error('userStrategy OVERWRITE'), {
      code: 'BACKUP_MERGE_STRATEGY_UNSUPPORTED'
    })
    startRestoreMock.mockRejectedValueOnce(err)

    await RestoreV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'restore.confirm.button' }))
    await waitFor(() => expect(screen.getByText('/tmp/backup.cherrybackup')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => {
      expect(screen.getByText('BACKUP_MERGE_STRATEGY_UNSUPPORTED')).toBeInTheDocument()
      expect(screen.getByText('settings.data.backup.v2.restore.skip_only')).toBeInTheDocument()
    })
  })

  it('shows select failure on idle when no archive was chosen yet', async () => {
    selectMock.mockRejectedValueOnce(new Error('dialog crashed'))

    await RestoreV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'restore.confirm.button' }))

    await waitFor(() => {
      expect(screen.getByText('settings.data.backup.v2.restore.failure')).toBeInTheDocument()
      expect(screen.getByText('dialog crashed')).toBeInTheDocument()
    })
    expect(selectMock.mock.calls[0][0].filters[0].name).toBe('settings.data.backup.v2.file_filter')
  })
})
