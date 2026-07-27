import '@testing-library/jest-dom/vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))

vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingDivider: () => <hr />,
  SettingGroup: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SettingHelpText: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SettingRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  statusIs({ kind: 'none' })
})

describe('BackupV2Settings', () => {
  it('offers both presets and says a restore replaces the database', async () => {
    await renderSettings()

    expect(screen.getByText('settings.data.backup_v2.export.lite_help')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup_v2.export.full_help')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup_v2.export.credentials_warning')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup_v2.export.integrations_warning')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup_v2.restore.help')).toBeInTheDocument()
  })

  it('exports the preset whose button was pressed and re-reads the status', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.export'
        ? { status: 'exported', archivePath: '/tmp/a.cherrybackup', preset: 'lite', resourceCount: 0, degradations: [] }
        : { operation: null, restore: { kind: 'none' } }
    )
    await renderSettings()

    click('settings.data.backup_v2.export.button')

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.export', { preset: 'lite' }))
    expect(toast.success).toHaveBeenCalledWith('settings.data.backup_v2.export.done')
    expect(requestMock).toHaveBeenCalledWith('backup.get_status')

    click('settings.data.backup_v2.export.button', 1)

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.export', { preset: 'full' }))
  })

  it('says nothing when the user dismisses the export dialog', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.export' ? { status: 'canceled' } : { operation: null, restore: { kind: 'none' } }
    )
    await renderSettings()

    click('settings.data.backup_v2.export.button')

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.export', { preset: 'lite' }))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows what a prepared restore would do to this device before offering to run it', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.prepare_restore'
        ? { status: 'prepared', preview }
        : { operation: null, restore: { kind: 'journal', state: 'prepared', restoreId: 'r1' } }
    )
    await renderSettings()

    click('settings.data.backup_v2.restore.choose_button')

    await waitFor(() => expect(screen.getByText('settings.data.backup_v2.preview.destructive')).toBeInTheDocument())
    expect(screen.getByText('settings.data.backup_v2.preview.coverage_counts')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup_v2.preview.resources_counts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.data.backup_v2.restore.arm_button' })).toBeInTheDocument()
  })

  it('never arms a restore that the user did not confirm', async () => {
    statusIs({ kind: 'journal', state: 'prepared', restoreId: 'r1' })
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    await renderSettings()

    click('settings.data.backup_v2.restore.arm_button')

    await waitFor(() => expect(popup.confirm).toHaveBeenCalledOnce())
    expect(requestMock).not.toHaveBeenCalledWith('backup.arm_restore')
  })

  it('arms the restore once the confirmation is accepted', async () => {
    statusIs({ kind: 'journal', state: 'prepared', restoreId: 'r1' })
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    await renderSettings()

    click('settings.data.backup_v2.restore.arm_button')

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.arm_restore'))
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

  it('does not offer to acknowledge a restore that is still running', async () => {
    statusIs({ kind: 'journal', state: 'promoting', restoreId: 'r1' })
    await renderSettings()

    await waitFor(() => expect(screen.getByText('settings.data.backup_v2.outcome.state.promoting')).toBeInTheDocument())
    expect(
      screen.queryByRole('button', { name: 'settings.data.backup_v2.outcome.acknowledge_button' })
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
    [backupErrorCodes.JOURNAL_UNREADABLE, 'settings.data.backup_v2.error.journal_unreadable']
  ])('turns %s into its own sentence', async (code, message) => {
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'backup.prepare_restore') throw new IpcError(code, 'refused')
      return { operation: null, restore: { kind: 'none' } }
    })
    await renderSettings()

    click('settings.data.backup_v2.restore.choose_button')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
  })

  it('does not guess at a code it does not know', async () => {
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'backup.prepare_restore') throw new Error('EPERM')
      return { operation: null, restore: { kind: 'none' } }
    })
    await renderSettings()

    click('settings.data.backup_v2.restore.choose_button')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('settings.data.backup_v2.error.unexpected'))
  })
})
