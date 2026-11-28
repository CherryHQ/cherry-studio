import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setBackupSyncState } from '@renderer/services/BackupService'
import { toast } from '@renderer/services/toast'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
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
        request: vi.fn(async (route: string) => ({ ok: true, data: route === 'app.get_info' ? appInfo : undefined })),
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

  it('keeps the stored, already translated failure reason in the status tooltip', async () => {
    MockUsePreferenceUtils.setPreferenceValue('data.backup.local.sync_interval', 60)
    await i18next.changeLanguage('de-DE')
    const reason = i18next.t('backup.error.disk_full')
    try {
      act(() => setBackupSyncState('local', { lastSyncError: reason, lastSyncTime: Date.now() }))
      render(<LocalBackupSettings />)

      // The warning icon's accessible label is its tooltip text.
      expect(screen.getByLabelText(new RegExp(reason))).toBeInTheDocument()
    } finally {
      act(() => setBackupSyncState('local', { lastSyncError: null, lastSyncTime: null }))
      await i18next.changeLanguage('en-US')
    }
  })
})
