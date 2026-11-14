import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { AppErrorDetailRequest } from '@renderer/services/AppErrorDetailService'
import { setBackupSyncState } from '@renderer/services/BackupService'
import { toast } from '@renderer/services/toast'

const detailMocks = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('@renderer/services/appErrorDetailOpen', () => ({
  openLoadedErrorDetail: (request: unknown) => detailMocks.open(request),
  showDetailOpenFailed: vi.fn()
}))

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

function lastDetailRequest(): AppErrorDetailRequest {
  const [request] = detailMocks.open.mock.lastCall ?? []
  return request
}

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
    setBackupSyncState('local', { lastSyncError: null, lastSyncTime: null, syncing: false })
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

  it('keeps the sync failure reason beside the translated caption', async () => {
    MockUsePreferenceUtils.setPreferenceValue('data.backup.local.sync_interval', 5)
    setBackupSyncState('local', { lastSyncError: 'disk full' })
    const { rerender } = render(<LocalBackupSettings />)

    expect(screen.getByTestId('warn-tooltip')).toHaveTextContent(
      `${i18n.t('settings.data.local.syncError')}: disk full`
    )
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.detail') }))
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalled())
    const first = lastDetailRequest()
    expect(first.localizedErrorMessage).toBe(i18n.t('settings.data.local.syncError'))
    expect(first.context.message).toBe('disk full')
    expect(first.context.stack).toBeUndefined()
    expect(first.context.source).toBe('settings.data.local')
    expect(first.context.operation).toBe('backup.sync')

    detailMocks.open.mockClear()
    rerender(<LocalBackupSettings />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.detail') }))
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalled())
    expect(lastDetailRequest().context.id).toBe(first.context.id)

    setBackupSyncState('local', { lastSyncError: 'permission denied' })
    rerender(<LocalBackupSettings />)
    detailMocks.open.mockClear()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.detail') }))
    await waitFor(() => expect(lastDetailRequest()?.context.message).toBe('permission denied'))
    expect(lastDetailRequest().context.id).not.toBe(first.context.id)
  })
})
