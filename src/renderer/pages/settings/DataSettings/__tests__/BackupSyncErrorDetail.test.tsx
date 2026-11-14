import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { AppErrorDetailRequest } from '@renderer/services/AppErrorDetailService'
import { setBackupSyncState } from '@renderer/services/BackupService'

const detailMocks = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('@renderer/services/appErrorDetailOpen', () => ({
  openLoadedErrorDetail: (request: unknown) => detailMocks.open(request),
  showDetailOpenFailed: vi.fn()
}))
vi.mock('@renderer/components/WebdavBackupManager', () => ({ WebdavBackupManager: () => null }))
vi.mock('@renderer/components/WebdavModals', () => ({
  WebdavBackupModal: () => null,
  useWebdavBackupModal: () => ({
    isModalVisible: false,
    handleBackup: vi.fn(),
    handleCancel: vi.fn(),
    backuping: false,
    customFileName: '',
    setCustomFileName: vi.fn(),
    showBackupModal: vi.fn()
  })
}))
vi.mock('@renderer/components/S3BackupManager', () => ({ S3BackupManager: () => null }))
vi.mock('@renderer/components/S3Modals', () => ({
  S3BackupModal: () => null,
  useS3BackupModal: () => ({
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
vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: vi.fn() })
}))
vi.mock('@renderer/hooks/useNutstoreSso', () => ({
  useNutstoreSso: () => vi.fn()
}))
vi.mock('@renderer/services/NutstoreService', () => ({
  backupToNutstore: vi.fn(),
  checkConnection: vi.fn(),
  createDirectory: vi.fn(),
  restoreFromNutstore: vi.fn()
}))

import NutstoreSettings from '../NutstoreSettings'
import S3Settings from '../S3Settings'
import WebDavSettings from '../WebDavSettings'

async function openRequest(): Promise<AppErrorDetailRequest> {
  fireEvent.click(screen.getByRole('button', { name: i18n.t('common.detail') }))
  await waitFor(() => expect(detailMocks.open).toHaveBeenCalled())
  return detailMocks.open.mock.calls.at(-1)?.[0]
}

// A stored sync reason has no stack; a renderer-side Error wrapper would fabricate one.
async function openDetail() {
  const request = await openRequest()
  return {
    localized: request.localizedErrorMessage,
    cause: request.context.message,
    stack: request.context.stack,
    source: request.context.source,
    operation: request.context.operation,
    recordId: request.context.recordId
  }
}

describe('backup sync error details', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    detailMocks.open.mockReset()
    vi.stubGlobal('api', {
      nutstore: { decryptToken: vi.fn(async () => ({ username: 'nut', access_token: 'secret' })) }
    })
  })

  afterEach(async () => {
    cleanup()
    await Promise.resolve()
    setBackupSyncState('webdav', { lastSyncError: null, lastSyncTime: null, syncing: false })
    setBackupSyncState('nutstore', { lastSyncError: null, lastSyncTime: null, syncing: false })
    setBackupSyncState('s3', { lastSyncError: null, lastSyncTime: null, syncing: false })
    vi.unstubAllGlobals()
  })

  it('keeps the WebDAV reason separate from the translated caption', async () => {
    MockUsePreferenceUtils.setPreferenceValue('data.backup.webdav.host', 'https://dav.example')
    MockUsePreferenceUtils.setPreferenceValue('data.backup.webdav.sync_interval', 5)
    setBackupSyncState('webdav', { lastSyncError: 'unauthorized' })
    const { rerender } = render(<WebDavSettings />)

    expect(screen.getByTestId('warn-tooltip')).toHaveTextContent(
      `${i18n.t('settings.data.webdav.syncError')}: unauthorized`
    )
    expect(await openDetail()).toEqual({
      localized: i18n.t('settings.data.webdav.syncError'),
      cause: 'unauthorized',
      stack: undefined,
      source: 'settings.data.webdav',
      operation: 'backup.sync',
      recordId: undefined
    })
    const first = detailMocks.open.mock.calls.at(-1)?.[0] as AppErrorDetailRequest
    detailMocks.open.mockClear()
    rerender(<WebDavSettings />)
    expect((await openRequest()).context.id).toBe(first.context.id)
  })

  it('uses the WebDAV caption for Nutstore and isolates its cause', async () => {
    MockUsePreferenceUtils.setPreferenceValue('data.backup.nutstore.token', 'token')
    MockUsePreferenceUtils.setPreferenceValue('data.backup.nutstore.auto_sync', true)
    MockUsePreferenceUtils.setPreferenceValue('data.backup.nutstore.sync_interval', 5)
    setBackupSyncState('nutstore', { lastSyncError: 'quota' })
    render(<NutstoreSettings />)

    expect(await screen.findByTestId('warn-tooltip')).toHaveTextContent(
      `${i18n.t('settings.data.webdav.syncError')}: quota`
    )
    expect(await openDetail()).toEqual({
      localized: i18n.t('settings.data.webdav.syncError'),
      cause: 'quota',
      stack: undefined,
      source: 'settings.data.nutstore',
      operation: 'backup.sync',
      recordId: undefined
    })
  })

  it('reuses the interpolated S3 caption and keeps the raw reason on the error', async () => {
    MockUsePreferenceUtils.setPreferenceValue('data.backup.s3.endpoint', 'https://s3.example')
    MockUsePreferenceUtils.setPreferenceValue('data.backup.s3.sync_interval', 5)
    setBackupSyncState('s3', { lastSyncError: 'bucket missing' })
    render(<S3Settings />)

    const caption = i18n.t('settings.data.s3.syncStatus.error', { message: 'bucket missing' })
    expect(screen.getByTestId('warn-tooltip')).toHaveTextContent(caption)
    expect(await openDetail()).toEqual({
      localized: caption,
      cause: 'bucket missing',
      stack: undefined,
      source: 'settings.data.s3',
      operation: 'backup.sync',
      recordId: undefined
    })

    setBackupSyncState('s3', { lastSyncError: null })
    await waitFor(() => expect(screen.queryByRole('button', { name: i18n.t('common.detail') })).not.toBeInTheDocument())
  })
})
