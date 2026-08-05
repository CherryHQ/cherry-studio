import '@testing-library/jest-dom/vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { BackupFormatCompatibilityDiagnostic } from '@shared/ipc/schemas/backup'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkForUpdatesMock, requestMock, tMock, writeTextMock } = vi.hoisted(() => ({
  checkForUpdatesMock: vi.fn(),
  requestMock: vi.fn(),
  tMock: vi.fn(),
  writeTextMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tMock })
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/hooks/useManualUpdateCheck', () => ({
  useManualUpdateCheck: () => ({ checkForUpdates: checkForUpdatesMock })
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
  coverage: { available: 2, missing: 1, unverifiable: 0 },
  resources: { install: 3, replace: 1 },
  knowledge: { ready: 0, rebuild: 0 },
  degradations: [],
  migratedForward: false
}

/** Answer `backup.get_status` with `restore`, everything else per-test. */
function statusIs(restore: unknown) {
  requestMock.mockImplementation(async (route: string) => {
    if (route === 'backup.get_status') return { operation: null, restore }
    if (route === 'backup.acknowledge_restore') return { acknowledged: true, restoreId: 'r1', removed: 1 }
    return undefined
  })
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
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writeTextMock }
  })
  writeTextMock.mockResolvedValue(undefined)
  tMock.mockImplementation((key: string) => key)
  vi.mocked(popup.confirm).mockResolvedValue(true)
  vi.mocked(popup.info).mockResolvedValue(true)
  statusIs({ kind: 'none' })
})

describe('BackupV2Settings', () => {
  it('keeps the original compact surface', async () => {
    await renderSettings()

    const backupButton = screen.getByRole('button', { name: 'settings.general.backup.button' })
    const restoreButton = screen.getByRole('button', { name: 'settings.general.restore.button' })
    expect(backupButton.parentElement).toBe(restoreButton.parentElement)
    // The credentials warning survives the copy cull: it changes how the user
    // must handle the file they are about to create.
    expect(screen.getByText('settings.data.backup_v2.export.credentials_warning')).toBeInTheDocument()
    expect(screen.queryByText('settings.data.backup_v2.export.integrations_warning')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.data.backup_v2.restore.help')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('exports without asking anything and re-reads the status', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.export'
        ? {
            status: 'exported',
            archivePath: '/tmp/a.cherrybackup',
            resourceCount: 0,
            degradations: []
          }
        : { operation: null, restore: { kind: 'none' } }
    )
    await renderSettings()

    click('settings.general.backup.button')

    // The only dialog is main's own save dialog — the renderer asks nothing first.
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.export'))
    expect(popup.confirm).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('settings.data.backup_v2.export.done')
    expect(requestMock).toHaveBeenCalledWith('backup.get_status')
  })

  it('shows degraded export details instead of an ordinary success toast', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.export'
        ? {
            status: 'exported',
            archivePath: '/tmp/a.cherrybackup',
            resourceCount: 1,
            degradations: [{ code: 'external-reference', count: 2, paths: ['Data/Notes/a', 'Data/Notes/b'] }]
          }
        : { operation: null, restore: { kind: 'none' } }
    )
    await renderSettings()

    click('settings.general.backup.button')

    await waitFor(() => expect(popup.info).toHaveBeenCalledOnce())
    const details = render(vi.mocked(popup.info).mock.calls[0][0].content as React.ReactElement)
    expect(details.getByText('settings.data.backup_v2.export.done_degraded')).toBeInTheDocument()
    expect(details.getByText('settings.data.backup_v2.outcome.degradation.external_reference')).toBeInTheDocument()
    expect(details.getByText('Data/Notes/a')).toBeInTheDocument()
    expect(details.getByText('Data/Notes/b')).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('says nothing when the user dismisses the export dialog', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.export' ? { status: 'canceled' } : { operation: null, restore: { kind: 'none' } }
    )
    await renderSettings()

    click('settings.general.backup.button')

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('backup.export'))
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
    // The coverage buckets are the pipeline's taxonomy, not a decision the user
    // makes here, so the preview must not surface them.
    expect(screen.queryByText('settings.data.backup_v2.preview.coverage_counts')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.data.backup_v2.preview.resources_counts')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'settings.data.backup_v2.restore.arm_button'
      })
    ).toBeInTheDocument()
  })

  it('shows omitted resource paths in the restore preview', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.prepare_restore'
        ? {
            status: 'prepared',
            preview: {
              ...preview,
              degradations: [
                { code: 'resource-unavailable', count: 2, paths: ['Data/Files/a.pdf', 'Data/Files/b.pdf'] }
              ]
            }
          }
        : { operation: null, restore: { kind: 'journal', state: 'prepared', restoreId: 'r1' } }
    )
    await renderSettings()

    click('settings.general.restore.button')

    await waitFor(() => expect(screen.getByText('Data/Files/a.pdf')).toBeInTheDocument())
    expect(screen.getByText('Data/Files/b.pdf')).toBeInTheDocument()
    expect(screen.getByText('settings.data.backup_v2.outcome.degradation.resource_unavailable')).toBeInTheDocument()
  })

  it('warns about embedding quota both before and during confirmation', async () => {
    requestMock.mockImplementation(async (route: string) =>
      route === 'backup.prepare_restore'
        ? { status: 'prepared', preview: { ...preview, knowledge: { ready: 0, rebuild: 2 } } }
        : { operation: null, restore: { kind: 'journal', state: 'prepared', restoreId: 'r1' } }
    )
    await renderSettings()

    click('settings.general.restore.button')
    await waitFor(() =>
      expect(screen.getByText('settings.data.backup_v2.preview.knowledge_rebuild_cost')).toBeInTheDocument()
    )

    click('settings.data.backup_v2.restore.arm_button')
    await waitFor(() => expect(popup.confirm).toHaveBeenCalledOnce())
    render(vi.mocked(popup.confirm).mock.calls[0][0].content as React.ReactElement)
    expect(screen.getAllByText('settings.data.backup_v2.preview.knowledge_rebuild_cost')).toHaveLength(2)
    expect(tMock).toHaveBeenCalledWith('settings.data.backup_v2.preview.knowledge_rebuild_cost', { count: 2 })
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

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith('backup.acknowledge_restore', {
        knowledgeRebuild: 'require-complete'
      })
    )
    expect(toast.closeToast).toHaveBeenCalledWith('backup-restore-notice')
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
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith('backup.acknowledge_restore', {
        knowledgeRebuild: 'require-complete'
      })
    )
  })

  it('names what a completed restore brought back in a reduced form', async () => {
    statusIs({
      kind: 'journal',
      state: 'completed',
      restoreId: 'r1',
      degradations: [
        { code: 'path-unportable', count: 2, paths: ['Data/Notes/a', 'Data/Notes/b'] },
        { code: 'external-file-dropped', count: 1 }
      ]
    })
    await renderSettings()

    await waitFor(() => expect(screen.getByText('settings.data.backup_v2.outcome.degradations')).toBeInTheDocument())
    expect(screen.getByText('settings.data.backup_v2.outcome.degradation.path_unportable')).toBeInTheDocument()
    expect(tMock).toHaveBeenCalledWith('settings.data.backup_v2.outcome.degradation.path_unportable', { count: 2 })
    expect(tMock).toHaveBeenCalledWith('settings.data.backup_v2.outcome.degradation.external_file_dropped', {
      count: 1
    })
    expect(screen.getByText('Data/Notes/a')).toBeInTheDocument()
    expect(screen.getByText('Data/Notes/b')).toBeInTheDocument()
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

  it('offers rollback or an explicit indexed-rebuild give-up while Knowledge rebuilds', async () => {
    statusIs({
      kind: 'journal',
      state: 'completed',
      restoreId: 'r1',
      knowledgeRebuildPending: true
    })
    await renderSettings()

    await waitFor(() =>
      expect(screen.getByText('settings.data.backup_v2.outcome.knowledge_rebuild_pending')).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'settings.data.backup_v2.rollback.button' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'settings.data.backup_v2.outcome.acknowledge_button'
      })
    ).not.toBeInTheDocument()

    // The button already states that it stops the rebuild and keeps the result,
    // so giving up goes straight through instead of asking again.
    click('settings.data.backup_v2.outcome.abandon_rebuild_button')
    expect(popup.confirm).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith('backup.acknowledge_restore', { knowledgeRebuild: 'abandon' })
    )
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

  it('explains an ahead packaged backup, copies bounded diagnostics, and reuses the updater action', async () => {
    const diagnostic = {
      kind: 'source-ahead',
      archiveAppVersion: '2.1.0',
      archiveBuildType: 'packaged',
      currentAppVersion: '2.0.0',
      currentBuildType: 'packaged',
      sourceMigrationCount: 28,
      targetMigrationCount: 26,
      sourceTip: { folderMillis: 1785221482684, hashPrefix: 'ab77963210ca' },
      targetTip: { folderMillis: 1785000000000, hashPrefix: 'f1cecc21626c' },
      missingMigrationCount: 2,
      firstExtraIndex: 27
    }
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'backup.prepare_restore') {
        throw new IpcError(backupErrorCodes.RESTORE_REQUIRES_NEWER_APP, 'raw /Users/private', diagnostic)
      }
      return { operation: null, restore: { kind: 'none' } }
    })
    await renderSettings()

    click('settings.general.restore.button')

    await waitFor(() => expect(popup.confirm).toHaveBeenCalledOnce())
    expect(popup.info).not.toHaveBeenCalled()
    const popupProps = vi.mocked(popup.confirm).mock.calls[0][0]
    expect(popupProps).toMatchObject({
      title: 'settings.data.backup_v2.compatibility.ahead_title',
      okText: 'settings.data.backup_v2.compatibility.check_updates'
    })
    expect(tMock).toHaveBeenCalledWith('settings.data.backup_v2.compatibility.ahead_update', { count: 2 })

    const details = render(popupProps.content as React.ReactElement)
    fireEvent.click(details.getByRole('button', { name: 'settings.data.backup_v2.compatibility.copy' }))
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledOnce())
    const copied = writeTextMock.mock.calls[0][0] as string
    expect(copied).toContain('missingMigrationCount: 2')
    expect(copied).toContain('sourceTip: 1785221482684/ab77963210ca')
    expect(copied).not.toContain('/Users/private')
    await waitFor(() => expect(checkForUpdatesMock).toHaveBeenCalledOnce())
  })

  it('sends development and forked backups to their producing lineage without offering an update', async () => {
    const diagnostic = {
      kind: 'lineage-fork',
      archiveAppVersion: '2.0.0-beta.3',
      archiveBuildType: 'development',
      currentAppVersion: '2.0.0-beta.3',
      currentBuildType: 'packaged',
      sourceMigrationCount: 28,
      targetMigrationCount: 26,
      sourceTip: { folderMillis: 1785221482684, hashPrefix: 'ab77963210ca' },
      targetTip: { folderMillis: 1785000000000, hashPrefix: 'f1cecc21626c' },
      firstDivergentIndex: 20
    }
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'backup.prepare_restore') {
        throw new IpcError(backupErrorCodes.RESTORE_LINEAGE_INCOMPATIBLE, 'fork', diagnostic)
      }
      return { operation: null, restore: { kind: 'none' } }
    })
    await renderSettings()

    click('settings.general.restore.button')

    await waitFor(() => expect(popup.info).toHaveBeenCalledOnce())
    expect(popup.confirm).not.toHaveBeenCalled()
    expect(checkForUpdatesMock).not.toHaveBeenCalled()
    expect(vi.mocked(popup.info).mock.calls[0][0]).toMatchObject({
      title: 'settings.data.backup_v2.compatibility.fork_title'
    })
  })

  it('guides a newer backup format to the updater but keeps a legacy format on the compatible-build path', async () => {
    const common = {
      archiveAppVersion: '2.1.0',
      archiveBuildType: 'packaged' as const,
      currentAppVersion: '2.0.0',
      currentBuildType: 'packaged' as const,
      currentFormatVersion: 2
    }
    let diagnostic: BackupFormatCompatibilityDiagnostic = {
      ...common,
      kind: 'archive-newer',
      archiveFormatVersion: 3
    }
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'backup.prepare_restore') {
        throw new IpcError(backupErrorCodes.FORMAT_UNSUPPORTED, 'format', diagnostic)
      }
      return { operation: null, restore: { kind: 'none' } }
    })
    await renderSettings()

    click('settings.general.restore.button')
    await waitFor(() => expect(popup.confirm).toHaveBeenCalledOnce())
    await waitFor(() => expect(checkForUpdatesMock).toHaveBeenCalledOnce())

    vi.clearAllMocks()
    vi.mocked(popup.info).mockResolvedValue(true)
    diagnostic = { ...common, kind: 'archive-legacy' as const, archiveFormatVersion: 1 }
    click('settings.general.restore.button')
    await waitFor(() => expect(popup.info).toHaveBeenCalledOnce())
    expect(checkForUpdatesMock).not.toHaveBeenCalled()
  })

  it('treats forged compatibility data as unexpected instead of rendering it', async () => {
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'backup.prepare_restore') {
        throw new IpcError(backupErrorCodes.RESTORE_REQUIRES_NEWER_APP, 'ahead', {
          kind: 'source-ahead',
          archiveAppVersion: '/Users/private'
        })
      }
      return { operation: null, restore: { kind: 'none' } }
    })
    await renderSettings()

    click('settings.general.restore.button')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('settings.data.backup_v2.error.unexpected'))
    expect(popup.confirm).not.toHaveBeenCalled()
    expect(popup.info).not.toHaveBeenCalled()
  })

  it.each([
    [
      { kind: 'source-changed', path: 'Data/Notes' },
      'settings.data.backup_v2.error.export_source_changed_path',
      { path: 'Data/Notes' }
    ],
    [{ kind: 'source-changed' }, 'settings.data.backup_v2.error.export_source_changed', undefined],
    [
      { kind: 'non-regular', path: 'Data/Notes/link' },
      'settings.data.backup_v2.error.export_source_non_regular_path',
      { path: 'Data/Notes/link' }
    ],
    [{ kind: 'non-regular' }, 'settings.data.backup_v2.error.export_source_non_regular', undefined],
    [
      { kind: 'unportable-path', reason: 'invalid-path', path: 'Data/Notes/CON' },
      'settings.data.backup_v2.error.export_source_unportable_path',
      { path: 'Data/Notes/CON' }
    ],
    [
      { kind: 'unportable-path', reason: 'invalid-path' },
      'settings.data.backup_v2.error.export_source_unportable',
      undefined
    ],
    [
      { kind: 'unportable-path', reason: 'name-collision', path: 'Data/Notes/Readme' },
      'settings.data.backup_v2.error.export_source_collision_path',
      { path: 'Data/Notes/Readme' }
    ],
    [
      { kind: 'unportable-path', reason: 'name-collision' },
      'settings.data.backup_v2.error.export_source_collision',
      undefined
    ],
    [
      { kind: 'limit-exceeded', limit: 'entry-count' },
      'settings.data.backup_v2.error.export_source_limit_count',
      undefined
    ],
    [
      { kind: 'limit-exceeded', limit: 'resource-entries' },
      'settings.data.backup_v2.error.export_source_limit_count',
      undefined
    ],
    [
      { kind: 'limit-exceeded', limit: 'entry-bytes' },
      'settings.data.backup_v2.error.export_source_limit_entry',
      undefined
    ],
    [
      { kind: 'limit-exceeded', limit: 'total-bytes' },
      'settings.data.backup_v2.error.export_source_limit_total',
      undefined
    ],
    [
      { kind: 'limit-exceeded', limit: 'manifest-bytes' },
      'settings.data.backup_v2.error.export_source_limit_manifest',
      undefined
    ],
    [{ kind: 'limit-exceeded', limit: 'unknown' }, 'settings.data.backup_v2.error.export_source_limit', undefined]
  ])('turns an export-source diagnostic into specific guidance', async (diagnostic, message, interpolation) => {
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'backup.export') {
        throw new IpcError(backupErrorCodes.EXPORT_SOURCE, 'refused', diagnostic)
      }
      return { operation: null, restore: { kind: 'none' } }
    })
    await renderSettings()

    click('settings.general.backup.button')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
    if (interpolation) {
      expect(tMock).toHaveBeenCalledWith(message, interpolation)
    }
  })

  it('does not render a forged absolute diagnostic path', async () => {
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'backup.export') {
        throw new IpcError(backupErrorCodes.EXPORT_SOURCE, 'refused', {
          kind: 'source-changed',
          path: '/Users/private/notes'
        })
      }
      return { operation: null, restore: { kind: 'none' } }
    })
    await renderSettings()

    click('settings.general.backup.button')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('settings.data.backup_v2.error.export_source'))
    expect(tMock).not.toHaveBeenCalledWith(expect.anything(), { path: '/Users/private/notes' })
  })

  it.each([
    [backupErrorCodes.BUSY, 'settings.data.backup_v2.error.busy'],
    [backupErrorCodes.ARCHIVE_REJECTED, 'settings.data.backup_v2.error.archive_rejected'],
    [backupErrorCodes.JOURNAL_UNREADABLE, 'settings.data.backup_v2.error.journal_unreadable'],
    [backupErrorCodes.ROLLBACK_UNAVAILABLE, 'settings.data.backup_v2.error.rollback_unavailable'],
    [backupErrorCodes.STORAGE_UNAVAILABLE, 'settings.data.backup_v2.error.storage_unavailable'],
    [backupErrorCodes.EXPORT_SOURCE, 'settings.data.backup_v2.error.export_source'],
    [backupErrorCodes.RESTORE_RESOURCES, 'settings.data.backup_v2.error.restore_resources']
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

      await waitFor(() => expect(screen.getByRole('button', { name: 'common.cancel' })).toHaveAttribute('aria-busy'))
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

    it('restores the cancel control from the main-owned status after the page remounts', async () => {
      requestMock.mockImplementation(async (route: string) => {
        if (route === 'backup.get_status') return { operation: 'export', restore: { kind: 'none' } }
        if (route === 'backup.cancel_operation') return { cancelled: true }
        return undefined
      })

      await renderSettings()

      expect(screen.queryByRole('button', { name: EXPORT_BUTTON })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'settings.general.restore.button' })).toBeDisabled()
      await act(async () => click('common.cancel'))
      expect(requestMock).toHaveBeenCalledWith('backup.cancel_operation')
    })

    it.each(['arm-restore', 'rollback-restore'] as const)(
      'keeps %s non-cancellable when restoring main-owned status',
      async (operation) => {
        requestMock.mockImplementation(async (route: string) => {
          if (route === 'backup.get_status') return { operation, restore: { kind: 'none' } }
          return undefined
        })

        await renderSettings()

        expect(screen.queryByRole('button', { name: 'common.cancel' })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: EXPORT_BUTTON })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'settings.general.restore.button' })).toBeDisabled()
      }
    )

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
