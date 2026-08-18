import '@testing-library/jest-dom/vitest'

import { toast } from '@renderer/services/toast'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/LocalBackupManager', () => ({ LocalBackupManager: () => null }))
vi.mock('@renderer/components/LocalBackupModals', () => ({
  LocalBackupModal: () => null,
  useLocalBackupModal: () => ({
    isModalVisible: false,
    handleBackup: vi.fn(),
    handleCancel: vi.fn(),
    backuping: false,
    customFileName: '',
    setCustomFileName: vi.fn(),
    showBackupModal: vi.fn()
  })
}))
vi.mock('@renderer/components/Selector', () => ({ default: () => null }))

import LocalBackupSettings from '../LocalBackupSettings'

const appInfo = {
  version: 'test',
  isPackaged: true,
  appPath: '/mock/app',
  homePath: '/mock/home',
  notesPath: '/mock/notes',
  configPath: '/mock/config',
  appDataPath: '/mock/userData',
  resourcesPath: '/mock/resources',
  logsPath: '/mock/logs',
  arch: 'arm64',
  isPortable: false,
  installPath: '/mock/install'
}

describe('LocalBackupSettings', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('data.backup.local.dir', '/saved-backups')
    vi.stubGlobal('api', {
      ipcApi: {
        request: vi.fn(async (route: string) => {
          // The page also reads its scheduled-backup status on mount; these cases
          // are about the directory field, so answer with an empty set.
          if (route === 'app.get_info') return { ok: true, data: appInfo }
          if (route === 'backup.get_auto_sync_status') return { ok: true, data: [] }
          return { ok: true, data: undefined }
        }),
        on: vi.fn(() => () => {})
      },
      resolvePath: vi.fn(async (value: string) => value),
      isPathInside: vi.fn(async (child: string, parent: string) => child.startsWith(parent)),
      hasWritePermission: vi.fn(async () => true)
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('does not persist an unsafe directory while the user is editing it', async () => {
    const user = userEvent.setup()
    render(<LocalBackupSettings />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '/mock/userData/partial-path')

    expect(MockUsePreferenceUtils.getPreferenceValue('data.backup.local.dir')).toBe('/saved-backups')

    await user.tab()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledOnce()
    })
    expect(MockUsePreferenceUtils.getPreferenceValue('data.backup.local.dir')).toBe('/saved-backups')
    expect(input).toHaveValue('/saved-backups')
  })

  // The page fetches app info on mount, but nothing stops the user reaching the
  // field first. A validator that reads it unconditionally throws here, and the
  // blur handler is not awaited — so the directory is neither saved nor reverted
  // and the user is told nothing.
  it('still validates when app info has not arrived yet', async () => {
    // Only the mount fetch is held: the state never arrives, while the
    // validator's own request still answers — "not loaded yet", not "offline".
    let releaseMountFetch!: () => void
    const mountFetchHeld = new Promise<void>((resolve) => {
      releaseMountFetch = resolve
    })
    let appInfoRequests = 0
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (route: string) => {
      if (route === 'app.get_info') {
        if (++appInfoRequests === 1) await mountFetchHeld
        return { ok: true, data: appInfo }
      }
      if (route === 'backup.get_auto_sync_status') return { ok: true, data: [] }
      return { ok: true, data: undefined }
    })

    const user = userEvent.setup()
    render(<LocalBackupSettings />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '/mock/userData/partial-path')
    await user.tab()

    // The rejected directory is refused out loud and the field returns to what
    // was saved, exactly as when app info is already present.
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledOnce()
    })
    expect(MockUsePreferenceUtils.getPreferenceValue('data.backup.local.dir')).toBe('/saved-backups')

    releaseMountFetch()
  })
})
