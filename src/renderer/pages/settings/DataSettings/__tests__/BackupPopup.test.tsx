import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PopupHost } from '@renderer/components/PopupHost'
import english from '@renderer/i18n/locales/en-us.json'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { IpcChannel } from '@shared/IpcChannel'

const mocks = vi.hoisted(() => ({ request: vi.fn(), backup: vi.fn(), selectFolder: vi.fn() }))

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())
vi.mock('@renderer/services/BackupService', () => ({ backup: mocks.backup }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: keyof typeof english) => english[key] }) }))
vi.mock('@renderer/i18n/resolver', () => ({ default: { t: (key: keyof typeof english) => english[key] } }))

import BackupPopup from '../BackupPopup'

beforeEach(() => {
  vi.clearAllMocks()
  MockUsePreferenceUtils.resetMocks()
  Object.assign(window.api.file, { selectFolder: mocks.selectFolder })
  mocks.selectFolder.mockResolvedValue('/chosen/folder')
  mocks.request.mockResolvedValue({ filePath: '/chosen/folder/configuration.zip' })
  mocks.backup.mockResolvedValue(undefined)
  vi.mocked(window.electron.ipcRenderer.on).mockReturnValue(vi.fn())
})

afterEach(() => {
  cleanup()
  vi.useFakeTimers()
  for (const entry of [...popupService.getSnapshot()]) popupService.settle(entry.instanceId, undefined)
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
})

function show(props?: Parameters<typeof BackupPopup.show>[0]) {
  render(<PopupHost />)
  act(() => {
    void BackupPopup.show(props)
  })
}

describe('configuration export popup', () => {
  it('shows the complete exclusions and exports to the chosen folder through the configuration route', async () => {
    const user = userEvent.setup()
    show({ scope: 'configuration' })
    expect(await screen.findByText(english['backup.configuration.content'])).toBeInTheDocument()
    expect(screen.getByText(/excludes conversations and history/)).toHaveTextContent('MCP setup and selections')
    expect(screen.getByText(/excludes conversations and history/)).toHaveTextContent('not encrypted')
    await user.click(screen.getByRole('button', { name: 'Export configuration' }))
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('backup.export_configuration', { destinationPath: '/chosen/folder' })
    )
    expect(mocks.backup).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('does not export when the user cancels the popup', async () => {
    const user = userEvent.setup()
    show({ scope: 'configuration' })
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(mocks.selectFolder).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('does not export when the folder picker is cancelled and lets the user retry', async () => {
    const user = userEvent.setup()
    mocks.selectFolder.mockResolvedValueOnce(undefined)
    show({ scope: 'configuration' })
    await user.click(await screen.findByRole('button', { name: 'Export configuration' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export configuration' })).toBeEnabled())
    expect(mocks.request).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Export configuration' }))
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('backup.export_configuration', { destinationPath: '/chosen/folder' })
    )
  })

  it('shows live progress and disables duplicate actions until the export finishes', async () => {
    const user = userEvent.setup()
    let finish!: () => void
    mocks.request.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    show({ scope: 'configuration' })
    await user.click(await screen.findByRole('button', { name: 'Export configuration' }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalled())
    const listener = vi
      .mocked(window.electron.ipcRenderer.on)
      .mock.calls.findLast(([channel]) => channel === IpcChannel.BackupProgress)?.[1]
    act(() => {
      listener?.({} as Electron.IpcRendererEvent, { stage: 'compressing', progress: 80, total: 100 })
    })
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export configuration' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await act(async () => {
      finish()
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('reports a localized failure and keeps export available for retry', async () => {
    const user = userEvent.setup()
    mocks.request.mockRejectedValueOnce(new Error('BACKUP_CONFIGURATION_INVALID: oversized'))
    show({ scope: 'configuration' })
    await user.click(await screen.findByRole('button', { name: 'Export configuration' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(english['backup.error.configuration_invalid']))
    expect(screen.getByRole('button', { name: 'Export configuration' })).toBeEnabled()
    expect(screen.getByText(english['backup.configuration.content'])).toBeInTheDocument()
  })

  it.each([
    [false, false],
    [true, false],
    [true, true]
  ] as const)('keeps the existing backup path for skip=%s, forcedFull=%s', async (skip, forcedFull) => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('data.backup.general.skip_backup_file', skip)
    show({ forceFullBackup: forcedFull })
    await user.click(await screen.findByRole('button', { name: english['backup.confirm.button'] }))
    await waitFor(() => expect(mocks.backup).toHaveBeenCalledWith(forcedFull ? false : skip))
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
