import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { startRestoreMock, selectMock, confirmMock, requestMock, ipcListeners } = vi.hoisted(() => ({
  startRestoreMock: vi.fn(),
  selectMock: vi.fn(),
  confirmMock: vi.fn(),
  requestMock: vi.fn(),
  ipcListeners: new Map<string, (payload: unknown) => void>()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: requestMock, on: vi.fn(() => () => {}) },
  // Test double: record the latest handler per event so tests can dispatch
  // backup.restore_summary synchronously (no effect/unsubscribe semantics needed).
  useIpcOn: (event: string, handler: (payload: unknown) => void) => {
    ipcListeners.set(event, handler)
  }
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
    // Match createPopup(Component, opts?) — extra args ignored; keep show() settling
    // immediately so await RestoreV2Popup.show() can drive the dialog without dismiss.
    createPopup: (Component: React.FC<{ open: boolean; resolve: (v: unknown) => void }>) => {
      let inFlight: Promise<unknown> | null = null
      return {
        show: () => {
          if (inFlight) return inFlight
          inFlight = new Promise((resolve) => {
            render(React.createElement(Component, { open: true, resolve }))
            queueMicrotask(() => {
              inFlight = null
              resolve({})
            })
          })
          return inFlight
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
    startRestoreMock.mockReset()
    selectMock.mockReset()
    confirmMock.mockReset()
    requestMock.mockReset()
    // Every open queries backup.restore_status; default to the no-journal answer.
    requestMock.mockResolvedValue({ state: 'none' })
    ipcListeners.clear()
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
    startRestoreMock.mockRejectedValueOnce(
      new IpcError('BACKUP_RESTORE_QUIESCE_UNAVAILABLE', 'packaged restore unavailable')
    )

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
    startRestoreMock.mockRejectedValueOnce(
      new IpcError(backupErrorCodes.MERGE_STRATEGY_UNSUPPORTED, 'mergeStrategy OVERWRITE')
    )

    await RestoreV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'restore.confirm.button' }))
    await waitFor(() => expect(screen.getByText('/tmp/backup.cherrybackup')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => {
      expect(screen.getByText('BACKUP_MERGE_STRATEGY_UNSUPPORTED')).toBeInTheDocument()
      expect(screen.getByText('settings.data.backup.v2.restore.skip_only')).toBeInTheDocument()
    })
  })

  it('renders the disclosure summary and restart button when backup.restore_summary arrives', async () => {
    selectMock.mockResolvedValueOnce([{ path: '/tmp/backup.cherrybackup' }])
    confirmMock.mockResolvedValueOnce(true)
    // Spine keeps the request pending (relaunch-gated) — the summary event drives the UI.
    startRestoreMock.mockImplementationOnce(() => new Promise(() => {}))

    await RestoreV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'restore.confirm.button' }))
    await waitFor(() => expect(screen.getByText('/tmp/backup.cherrybackup')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    await waitFor(() => {
      expect(screen.getByText('settings.data.backup.v2.restore.relaunching')).toBeInTheDocument()
    })

    act(() => {
      ipcListeners.get('backup.restore_summary')!({
        toRestore: [
          { kind: 'file', count: 3 },
          { kind: 'knowledge', count: 1 }
        ],
        toSkip: [{ id: 'kb-local', kind: 'knowledge', reason: 'exists — skip' }]
      })
    })

    expect(screen.queryByText('settings.data.backup.v2.restore.relaunching')).not.toBeInTheDocument()
    expect(screen.getByText('settings.data.backup.v2.restore.summary.pending_hint')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup.v2.restore.summary.will_restore')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup.v2.restore.summary.kind.file')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup.v2.restore.summary.will_skip')).toBeInTheDocument()
    expect(screen.getByText('kb-local')).toBeInTheDocument()
    expect(screen.getByText('exists — skip')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('v2-restore-restart-button'))
    expect(requestMock).toHaveBeenCalledWith('app.relaunch')
  })

  it('falls back to an empty summary with restart button when the broadcast is missed', async () => {
    selectMock.mockResolvedValueOnce([{ path: '/tmp/backup.cherrybackup' }])
    confirmMock.mockResolvedValueOnce(true)
    // Main seals + resolves but the backup.restore_summary event never arrives.
    startRestoreMock.mockResolvedValueOnce({ restoreId: 'rst-1' })

    await RestoreV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'restore.confirm.button' }))
    await waitFor(() => expect(screen.getByText('/tmp/backup.cherrybackup')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => expect(screen.getByTestId('v2-restore-restart-button')).toBeInTheDocument())
    expect(screen.getByText('settings.data.backup.v2.restore.summary.none')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('v2-restore-restart-button'))
    expect(requestMock).toHaveBeenCalledWith('app.relaunch')
  })

  it('shows the none copy and hides the skip section for an empty summary', async () => {
    selectMock.mockResolvedValueOnce([{ path: '/tmp/backup.cherrybackup' }])
    confirmMock.mockResolvedValueOnce(true)
    startRestoreMock.mockImplementationOnce(() => new Promise(() => {}))

    await RestoreV2Popup.show()
    fireEvent.click(screen.getByRole('button', { name: 'restore.confirm.button' }))
    await waitFor(() => expect(screen.getByText('/tmp/backup.cherrybackup')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    await waitFor(() => {
      expect(screen.getByText('settings.data.backup.v2.restore.relaunching')).toBeInTheDocument()
    })

    act(() => {
      ipcListeners.get('backup.restore_summary')!({ toRestore: [], toSkip: [] })
    })

    expect(screen.getByText('settings.data.backup.v2.restore.summary.none')).toBeInTheDocument()
    expect(screen.queryByText('settings.data.backup.v2.restore.summary.will_skip')).not.toBeInTheDocument()
  })

  it('recovers the sealed-wait view when restore_status reports pending', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.restore_status' ? { state: 'pending' } : undefined
    )

    await RestoreV2Popup.show()

    await waitFor(() => expect(screen.getByTestId('v2-restore-restart-button')).toBeInTheDocument())
    // Empty-summary fallback: the original disclosure is lost across windows/relaunch.
    expect(screen.getByText('settings.data.backup.v2.restore.summary.pending_hint')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup.v2.restore.summary.none')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('v2-restore-restart-button'))
    expect(requestMock).toHaveBeenCalledWith('app.relaunch')
  })

  it('shows a completed outcome and returns to idle after acknowledge', async () => {
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'backup.restore_status') return { state: 'completed' }
      if (route === 'backup.restore_acknowledge') return { cleared: true }
      return undefined
    })

    await RestoreV2Popup.show()

    await waitFor(() => expect(screen.getByTestId('v2-restore-outcome')).toBeInTheDocument())
    expect(screen.getByText('settings.data.backup.v2.restore.outcome.completed')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('v2-restore-acknowledge-button'))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.restore_acknowledge'))
    await waitFor(() => expect(screen.getByText('settings.data.backup.v2.restore.pick_prompt')).toBeInTheDocument())
    expect(screen.queryByTestId('v2-restore-outcome')).not.toBeInTheDocument()
  })

  it('shows a failed outcome with the journal reason', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.restore_status'
        ? { state: 'failed', reason: "step 'work-promoted' failed: disk full" }
        : { cleared: true }
    )

    await RestoreV2Popup.show()

    await waitFor(() => expect(screen.getByText('settings.data.backup.v2.restore.outcome.failed')).toBeInTheDocument())
    expect(screen.getByText("step 'work-promoted' failed: disk full")).toBeInTheDocument()
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
