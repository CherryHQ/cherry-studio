import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getI18n } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type * as BackupUtilsModule from '@renderer/utils/backup'
import { getLocalizedBackupErrorMessage } from '@renderer/utils/backup'
import { BACKUP_OPERATION_BUSY_ERROR_CODE } from '@shared/types/backup'

import { S3RestoreModal, useS3RestoreModal } from '../S3Modals'

vi.unmock('@cherrystudio/ui')

vi.mock('@renderer/utils/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof BackupUtilsModule>()
  return {
    ...actual,
    getLocalizedBackupErrorMessage: vi.fn(actual.getLocalizedBackupErrorMessage)
  }
})

function S3RestoreModalHarness() {
  const modal = useS3RestoreModal({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'backups',
    accessKeyId: 'key',
    secretAccessKey: 'secret'
  })

  return (
    <>
      <button type="button" onClick={() => void modal.showRestoreModal()}>
        Open S3 Restore
      </button>
      <S3RestoreModal {...modal} />
    </>
  )
}

describe('S3RestoreModal', () => {
  const originalBackupApi = (window.api as { backup?: unknown }).backup

  beforeEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  afterEach(async () => {
    vi.mocked(getLocalizedBackupErrorMessage).mockClear()
    ;(window.api as { backup?: unknown }).backup = originalBackupApi
    await getI18n().changeLanguage('en-us')
  })

  it('shows a translated empty message when no backup files are listed', async () => {
    await getI18n().changeLanguage('zh-cn')
    render(
      <S3RestoreModal
        isRestoreModalVisible
        handleRestore={vi.fn()}
        handleCancel={vi.fn()}
        restoring={false}
        selectedFile={null}
        setSelectedFile={vi.fn()}
        loadingFiles={false}
        backupFiles={[]}
        showRestoreModal={vi.fn()}
      />
    )

    await userEvent.setup().click(screen.getByRole('button', { name: '请选择要恢复的备份文件' }))

    expect(await screen.findByText('无结果')).toBeInTheDocument()
    expect(screen.queryByText('No results found.')).toBeNull()
  })

  it('shows a persistent error dialog instead of a toast and clears loading when restore fails', async () => {
    const error = new Error(BACKUP_OPERATION_BUSY_ERROR_CODE)
    const listS3Files = vi.fn().mockResolvedValue([
      {
        fileName: 'backup-2026.zip',
        modifiedTime: '2026-01-01T00:00:00.000Z',
        size: 1024
      }
    ])
    const restoreFromS3 = vi.fn().mockRejectedValue(error)
    ;(window.api as { backup?: unknown }).backup = { listS3Files, restoreFromS3 }
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    vi.mocked(popup.error).mockReturnValueOnce(new Promise(() => {}))

    const user = userEvent.setup()
    render(<S3RestoreModalHarness />)

    await user.click(screen.getByRole('button', { name: 'Open S3 Restore' }))
    await user.click(await screen.findByRole('button', { name: 'Please select backup file to restore' }))
    await user.click(await screen.findByText(/backup-2026\.zip/))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(popup.error).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
    })

    expect(getLocalizedBackupErrorMessage).toHaveBeenCalledWith(error, 'message.restore.failed')
    expect(popup.error).toHaveBeenCalledWith({
      title: getI18n().t('message.restore.failed'),
      content: getI18n().t('backup.error.operation_busy'),
      centered: true,
      maskClosable: false
    })
    expect(toast.error).not.toHaveBeenCalled()
  })
})
