import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getI18n } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type * as BackupUtilsModule from '@renderer/utils/backup'
import { getLocalizedBackupErrorMessage } from '@renderer/utils/backup'
import { BACKUP_NEWER_VERSION_ERROR_CODE } from '@shared/types/backup'

import { LocalBackupManager } from '../LocalBackupManager'
import { S3BackupManager } from '../S3BackupManager'
import { WebdavBackupManager } from '../WebdavBackupManager'

vi.unmock('@cherrystudio/ui')

vi.mock('@renderer/utils/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof BackupUtilsModule>()
  return {
    ...actual,
    getLocalizedBackupErrorMessage: vi.fn(actual.getLocalizedBackupErrorMessage)
  }
})

const sampleFiles = [
  {
    fileName: 'cherry-studio.20260101.zip',
    modifiedTime: '2026-01-01T00:00:00.000Z',
    size: 2048
  }
]

describe('Backup manager restore error dialogs', () => {
  const originalBackupApi = (window.api as { backup?: unknown }).backup

  beforeEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  afterEach(() => {
    vi.mocked(getLocalizedBackupErrorMessage).mockClear()
    ;(window.api as { backup?: unknown }).backup = originalBackupApi
  })

  it('S3BackupManager shows persistent popup.error without toast and clears loading on restore failure', async () => {
    const error = new Error(BACKUP_NEWER_VERSION_ERROR_CODE)
    ;(window.api as { backup?: unknown }).backup = {
      listS3Files: vi.fn().mockResolvedValue(sampleFiles)
    }
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    vi.mocked(popup.error).mockReturnValueOnce(new Promise(() => {}))

    const user = userEvent.setup()
    render(
      <S3BackupManager
        visible
        onClose={vi.fn()}
        s3Config={{
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          bucket: 'backups',
          accessKeyId: 'key',
          secretAccessKey: 'secret'
        }}
        restoreMethod={vi.fn().mockRejectedValue(error)}
      />
    )

    const restoreButton = await screen.findByRole('button', { name: 'Restore' })
    await user.click(restoreButton)

    await waitFor(() => {
      expect(popup.error).toHaveBeenCalledTimes(1)
    })

    expect(getLocalizedBackupErrorMessage).toHaveBeenCalledWith(error, 'message.restore.failed')
    expect(popup.error).toHaveBeenCalledWith({
      title: getI18n().t('message.restore.failed'),
      content: getI18n().t('backup.error.newer_version'),
      centered: true,
      maskClosable: false
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(restoreButton).toBeEnabled()
  })

  it('LocalBackupManager shows persistent popup.error with local fallback key and clears loading on restore failure', async () => {
    const error = new Error('unexpected restore failure')
    ;(window.api as { backup?: unknown }).backup = {
      listLocalBackupFiles: vi.fn().mockResolvedValue(sampleFiles)
    }
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    vi.mocked(popup.error).mockReturnValueOnce(new Promise(() => {}))

    const user = userEvent.setup()
    render(
      <LocalBackupManager
        visible
        onClose={vi.fn()}
        localBackupDir="/tmp/cherry-backups"
        restoreMethod={vi.fn().mockRejectedValue(error)}
      />
    )

    const restoreButton = await screen.findByRole('button', { name: 'Restore' })
    await user.click(restoreButton)

    await waitFor(() => {
      expect(popup.error).toHaveBeenCalledTimes(1)
    })

    expect(getLocalizedBackupErrorMessage).toHaveBeenCalledWith(
      error,
      'settings.data.local.backup.manager.restore.error'
    )
    expect(popup.error).toHaveBeenCalledWith({
      title: getI18n().t('settings.data.local.backup.manager.restore.error'),
      content: getI18n().t('settings.data.local.backup.manager.restore.error'),
      centered: true,
      maskClosable: false
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(restoreButton).toBeEnabled()
  })

  it('WebdavBackupManager shows persistent popup.error with TLS certificate hint and clears loading on restore failure', async () => {
    const error = new Error('DEPTH_ZERO_SELF_SIGNED_CERT: self-signed certificate')
    ;(window.api as { backup?: unknown }).backup = {
      listWebdavFiles: vi.fn().mockResolvedValue(sampleFiles)
    }
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    vi.mocked(popup.error).mockReturnValueOnce(new Promise(() => {}))

    const user = userEvent.setup()
    render(
      <WebdavBackupManager
        visible
        onClose={vi.fn()}
        tlsCertificateHint
        webdavConfig={{ webdavHost: 'https://dav.example.com' }}
        restoreMethod={vi.fn().mockRejectedValue(error)}
      />
    )

    const restoreButton = await screen.findByRole('button', { name: 'Restore' })
    await user.click(restoreButton)

    await waitFor(() => {
      expect(popup.error).toHaveBeenCalledTimes(1)
    })

    expect(getLocalizedBackupErrorMessage).toHaveBeenCalledWith(
      error,
      'settings.data.webdav.backup.manager.restore.error',
      { tlsCertificateHint: true }
    )
    expect(popup.error).toHaveBeenCalledWith({
      title: getI18n().t('settings.data.webdav.backup.manager.restore.error'),
      content: getI18n().t('backup.error.webdav_tls_certificate'),
      centered: true,
      maskClosable: false
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(restoreButton).toBeEnabled()
  })

  it('WebdavBackupManager without tlsCertificateHint (Nutstore reuse) uses WebDAV restore fallback key', async () => {
    const error = new Error('DEPTH_ZERO_SELF_SIGNED_CERT: self-signed certificate')
    ;(window.api as { backup?: unknown }).backup = {
      listWebdavFiles: vi.fn().mockResolvedValue(sampleFiles)
    }
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    vi.mocked(popup.error).mockReturnValueOnce(new Promise(() => {}))

    const user = userEvent.setup()
    render(
      <WebdavBackupManager
        visible
        onClose={vi.fn()}
        webdavConfig={{ webdavHost: 'https://dav.jianguoyun.com/dav/' }}
        restoreMethod={vi.fn().mockRejectedValue(error)}
      />
    )

    const restoreButton = await screen.findByRole('button', { name: 'Restore' })
    await user.click(restoreButton)

    await waitFor(() => {
      expect(popup.error).toHaveBeenCalledTimes(1)
    })

    expect(getLocalizedBackupErrorMessage).toHaveBeenCalledWith(
      error,
      'settings.data.webdav.backup.manager.restore.error',
      { tlsCertificateHint: false }
    )
    expect(popup.error).toHaveBeenCalledWith({
      title: getI18n().t('settings.data.webdav.backup.manager.restore.error'),
      content: getI18n().t('settings.data.webdav.backup.manager.restore.error'),
      centered: true,
      maskClosable: false
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(restoreButton).toBeEnabled()
  })
})
