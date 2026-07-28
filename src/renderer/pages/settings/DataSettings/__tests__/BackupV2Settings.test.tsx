import '@testing-library/jest-dom/vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingDivider: () => <hr />,
  SettingGroup: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SettingHelpText: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SettingRow: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  SettingRowTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SettingTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>
}))

import BackupV2Settings from '../BackupV2Settings'

/**
 * The screen owns three user-visible guarantees: a restore is never armed
 * without an explicit confirmation, the durable state comes from main after
 * every action, and a refusal reaches the user as its own sentence.
 */

const preview = {
  restoreId: 'r1',
  preset: 'full' as const,
  coverage: { available: 2, missing: 1, unverifiable: 0 },
  resources: { install: 3, replace: 1 },
  degradations: [],
  migratedForward: false
}

/** Answer `backup.get_status` with `restore`, everything else per-test. */
function statusIs(restore: unknown) {
  requestMock.mockImplementation(async (route: string) =>
    route === 'backup.get_status' ? { operation: null, restore } : undefined
  )
}

async function renderSettings() {
  render(<BackupV2Settings />)
  await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.get_status'))
  requestMock.mockClear()
}

/** Both export rows share one button label, so the row is chosen by index. */
function click(name: string, index = 0) {
  fireEvent.click(screen.getAllByRole('button', { name })[index])
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(popup.confirm).mockResolvedValue(true)
  statusIs({ kind: 'none' })
})

describe('BackupV2Settings', () => {
  it('keeps the original compact surface and asks for the v2 preset only when backing up', async () => {
    await renderSettings()

    const backupButton = screen.getByRole('button', { name: 'settings.general.backup.button' })
    const restoreButton = screen.getByRole('button', { name: 'settings.general.restore.button' })
    expect(backupButton.parentElement).toBe(restoreButton.parentElement)
    expect(screen.getByText('settings.data.backup_v2.export.credentials_warning')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup_v2.export.integrations_warning')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup_v2.restore.help')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()

    click('settings.general.backup.button')
    await waitFor(() => expect(popup.confirm).toHaveBeenCalledOnce())
    const picker = render(vi.mocked(popup.confirm).mock.calls[0][0].content as React.ReactElement)
    expect(picker.getByText('settings.data.backup_v2.export.lite_help')).toBeInTheDocument()
    expect(picker.getByText('settings.data.backup_v2.export.full_help')).toBeInTheDocument()
  })

  it('exports the preset selected in the backup dialog and re-reads the status', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.export'
        ? {
            status: 'exported',
            archivePath: '/tmp/a.cherrybackup',
            preset: 'lite',
            resourceCount: 0,
            degradations: []
          }
        : { operation: null, restore: { kind: 'none' } }
    )
    let resolveConfirm: (confirmed: boolean) => void = () => {}
    vi.mocked(popup.confirm).mockImplementationOnce(
      async () => new Promise<boolean>((resolve) => (resolveConfirm = resolve))
    )
    await renderSettings()

    click('settings.general.backup.button')
    await waitFor(() => expect(popup.confirm).toHaveBeenCalledOnce())
    const picker = render(vi.mocked(popup.confirm).mock.calls[0][0].content as React.ReactElement)
    fireEvent.click(picker.getByText('settings.data.backup_v2.export.full_title'))
    await act(async () => resolveConfirm(true))

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith('backup.export', {
        preset: 'full'
      })
    )
    expect(toast.success).toHaveBeenCalledWith('settings.data.backup_v2.export.done')
    expect(requestMock).toHaveBeenCalledWith('backup.get_status')
  })

  it('says nothing when the user dismisses the export dialog', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.export' ? { status: 'canceled' } : { operation: null, restore: { kind: 'none' } }
    )
    await renderSettings()

    click('settings.general.backup.button')

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith('backup.export', {
        preset: 'lite'
      })
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows what a prepared restore would do to this device before offering to run it', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.prepare_restore'
        ? { status: 'prepared', preview }
        : {
            operation: null,
            restore: { kind: 'journal', state: 'prepared', restoreId: 'r1' }
          }
    )
    await renderSettings()

    click('settings.general.restore.button')

    await waitFor(() => expect(screen.getByText('settings.data.backup_v2.preview.destructive')).toBeInTheDocument())
    expect(screen.getByText('settings.data.backup_v2.preview.coverage_counts')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup_v2.preview.resources_counts')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'settings.data.backup_v2.restore.arm_button'
      })
    ).toBeInTheDocument()
  })

  it('never arms a restore that the user did not confirm', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.prepare_restore'
        ? { status: 'prepared', preview }
        : { operation: null, restore: { kind: 'journal', state: 'prepared', restoreId: 'r1' } }
    )
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    await renderSettings()
    click('settings.general.restore.button')
    await waitFor(() => expect(screen.getByRole('button', { name: 'settings.data.backup_v2.restore.arm_button' })))

    click('settings.data.backup_v2.restore.arm_button')

    await waitFor(() => expect(popup.confirm).toHaveBeenCalledOnce())
    expect(requestMock).not.toHaveBeenCalledWith('backup.arm_restore', expect.anything())
  })

  it('arms exactly the restore preview whose confirmation was accepted', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.prepare_restore'
        ? { status: 'prepared', preview }
        : { operation: null, restore: { kind: 'journal', state: 'prepared', restoreId: 'r1' } }
    )
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    await renderSettings()
    click('settings.general.restore.button')
    await waitFor(() => expect(screen.getByRole('button', { name: 'settings.data.backup_v2.restore.arm_button' })))

    click('settings.data.backup_v2.restore.arm_button')

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.arm_restore', { restoreId: 'r1' }))
  })

  it('does not offer to arm a durable preparation without its matching in-memory preview', async () => {
    statusIs({ kind: 'journal', state: 'prepared', restoreId: 'r1' })
    await renderSettings()

    expect(screen.queryByRole('button', { name: 'settings.data.backup_v2.restore.arm_button' })).not.toBeInTheDocument()
    expect(screen.getByText('settings.data.backup_v2.restore.pending_elsewhere')).toBeInTheDocument()
  })

  it('discards a preparation without a relaunch', async () => {
    statusIs({ kind: 'journal', state: 'prepared', restoreId: 'r1' })
    await renderSettings()

    click('settings.data.backup_v2.restore.discard_button')

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.cancel_restore'))
    expect(requestMock).not.toHaveBeenCalledWith('backup.arm_restore')
  })

  it('reports the completed outcome main still holds, with the rollback material it owns', async () => {
    statusIs({ kind: 'journal', state: 'completed', restoreId: 'r1' })
    await renderSettings()

    await waitFor(() => expect(screen.getByText('settings.data.backup_v2.outcome.state.completed')).toBeInTheDocument())
    expect(screen.getByText('settings.data.backup_v2.outcome.completed_help')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup_v2.outcome.reconfirm_integrations')).toBeInTheDocument()

    click('settings.data.backup_v2.outcome.acknowledge_button')

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.acknowledge_restore'))
  })

  it('never rolls back a completed restore without a second explicit confirmation', async () => {
    statusIs({ kind: 'journal', state: 'completed', restoreId: 'r1' })
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    await renderSettings()

    click('settings.data.backup_v2.rollback.button')

    await waitFor(() => expect(popup.confirm).toHaveBeenCalledOnce())
    expect(requestMock).not.toHaveBeenCalledWith('backup.rollback_restore')
  })

  it('arms rollback and relaunches after the user confirms losing post-restore changes', async () => {
    statusIs({ kind: 'journal', state: 'completed', restoreId: 'r1' })
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    await renderSettings()

    click('settings.data.backup_v2.rollback.button')

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.rollback_restore'))
  })

  it('reports a completed rollback and lets the user release displaced restored data', async () => {
    statusIs({ kind: 'journal', state: 'rolled-back', restoreId: 'r1' })
    await renderSettings()

    await waitFor(() =>
      expect(screen.getByText('settings.data.backup_v2.outcome.state.rolled_back')).toBeInTheDocument()
    )
    expect(screen.getByText('settings.data.backup_v2.outcome.rolled_back_help')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'settings.data.backup_v2.rollback.button'
      })
    ).not.toBeInTheDocument()

    click('settings.data.backup_v2.outcome.keep_previous_button')
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.acknowledge_restore'))
  })

  it('names what a completed restore brought back in a reduced form', async () => {
    statusIs({
      kind: 'journal',
      state: 'completed',
      restoreId: 'r1',
      degradations: [{ kind: 'restore-db:note', reason: 'path-unportable (2 rows)' }]
    })
    await renderSettings()

    await waitFor(() => expect(screen.getByText('settings.data.backup_v2.outcome.degradations')).toBeInTheDocument())
    expect(screen.getByText(/restore-db:note/)).toBeInTheDocument()
  })

  it('withholds acknowledgement while a completed restore still owes a file', async () => {
    statusIs({
      kind: 'journal',
      state: 'completed',
      restoreId: 'r1',
      resourcesIncomplete: true
    })
    await renderSettings()

    await waitFor(() =>
      expect(screen.getByText('settings.data.backup_v2.outcome.resources_incomplete')).toBeInTheDocument()
    )
    // The staging tree and the aside are that unit's only two copies, and this
    // button deletes both.
    expect(
      screen.queryByRole('button', {
        name: 'settings.data.backup_v2.outcome.acknowledge_button'
      })
    ).not.toBeInTheDocument()
  })

  it('does not offer to acknowledge a restore that is still running', async () => {
    statusIs({ kind: 'journal', state: 'promoting', restoreId: 'r1' })
    await renderSettings()

    await waitFor(() => expect(screen.getByText('settings.data.backup_v2.outcome.state.promoting')).toBeInTheDocument())
    expect(
      screen.queryByRole('button', {
        name: 'settings.data.backup_v2.outcome.acknowledge_button'
      })
    ).not.toBeInTheDocument()
  })

  it('withholds acknowledgement while a rollback is still incomplete', async () => {
    statusIs({
      kind: 'journal',
      state: 'failed',
      restoreId: 'r1',
      recoveryIncomplete: true
    })
    await renderSettings()

    await waitFor(() =>
      expect(screen.getByText('settings.data.backup_v2.outcome.recovery_incomplete')).toBeInTheDocument()
    )
    // Acknowledging would delete exactly what the pending repair needs, so the
    // button is not offered until a boot has finished the rollback.
    expect(
      screen.queryByRole('button', {
        name: 'settings.data.backup_v2.outcome.acknowledge_button'
      })
    ).not.toBeInTheDocument()
  })

  it('surfaces an unreadable journal instead of pretending there is no restore', async () => {
    statusIs({ kind: 'unreadable' })
    await renderSettings()

    await waitFor(() => expect(screen.getByText('settings.data.backup_v2.outcome.unreadable')).toBeInTheDocument())
  })

  it.each([
    [backupErrorCodes.BUSY, 'settings.data.backup_v2.error.busy'],
    [backupErrorCodes.ARCHIVE_REJECTED, 'settings.data.backup_v2.error.archive_rejected'],
    [backupErrorCodes.JOURNAL_UNREADABLE, 'settings.data.backup_v2.error.journal_unreadable'],
    [backupErrorCodes.ROLLBACK_UNAVAILABLE, 'settings.data.backup_v2.error.rollback_unavailable']
  ])('turns %s into its own sentence', async (code, message) => {
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'backup.prepare_restore') throw new IpcError(code, 'refused')
      return { operation: null, restore: { kind: 'none' } }
    })
    await renderSettings()

    click('settings.general.restore.button')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
  })

  it('does not guess at a code it does not know', async () => {
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'backup.prepare_restore') throw new Error('EPERM')
      return { operation: null, restore: { kind: 'none' } }
    })
    await renderSettings()

    click('settings.general.restore.button')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('settings.data.backup_v2.error.unexpected'))
  })

  describe('cancelling work in flight', () => {
    const EXPORT_BUTTON = 'settings.general.backup.button'

    /** Hold one route open so the component stays in its running state. */
    function stall(route: string): { finish: (outcome: unknown) => void } {
      let finish: (outcome: unknown) => void = () => {}
      requestMock.mockImplementation(async (called: string) => {
        if (called === route) return new Promise((resolve) => (finish = resolve))
        if (called === 'backup.get_status') return { operation: null, restore: { kind: 'none' } }
        return undefined
      })
      return { finish: (outcome) => finish(outcome) }
    }

    it('turns the running row into its own cancel button and disables the rest', async () => {
      const stalled = stall('backup.export')
      await renderSettings()

      click(EXPORT_BUTTON)

      await waitFor(() => expect(screen.getByRole('button', { name: 'common.cancel' })).toBeInTheDocument())
      // The compact export action becomes cancel in place; restore is disabled
      // while the service owns the one-operation lock.
      expect(screen.queryByRole('button', { name: EXPORT_BUTTON })).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: 'settings.general.restore.button'
        })
      ).toBeDisabled()

      stalled.finish({ status: 'canceled' })
      await waitFor(() => expect(screen.getByRole('button', { name: EXPORT_BUTTON })).toBeEnabled())
    })

    it('asks main to abort while the service is busy — the busy guard must not block it', async () => {
      const stalled = stall('backup.export')
      await renderSettings()
      click(EXPORT_BUTTON)
      await waitFor(() => expect(screen.getByRole('button', { name: 'common.cancel' })).toBeInTheDocument())

      click('common.cancel')

      await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.cancel_operation'))

      stalled.finish({ status: 'canceled' })
      await waitFor(() => expect(screen.getByRole('button', { name: EXPORT_BUTTON })).toBeEnabled())
    })

    it('reports a cancelled operation with silence, not a success or a failure', async () => {
      const stalled = stall('backup.export')
      await renderSettings()
      click(EXPORT_BUTTON)
      await waitFor(() => expect(screen.getByRole('button', { name: 'common.cancel' })).toBeInTheDocument())
      click('common.cancel')

      stalled.finish({ status: 'canceled' })

      await waitFor(() => expect(screen.getByRole('button', { name: EXPORT_BUTTON })).toBeEnabled())
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('offers the same cancel on the row that admits an archive', async () => {
      const stalled = stall('backup.prepare_restore')
      await renderSettings()

      click('settings.general.restore.button')

      await waitFor(() => expect(screen.getByRole('button', { name: 'common.cancel' })).toBeInTheDocument())
      click('common.cancel')
      expect(requestMock).toHaveBeenCalledWith('backup.cancel_operation')

      stalled.finish({ status: 'canceled' })
      await waitFor(() =>
        expect(
          screen.getByRole('button', {
            name: 'settings.general.restore.button'
          })
        ).toBeEnabled()
      )
    })
  })
})
