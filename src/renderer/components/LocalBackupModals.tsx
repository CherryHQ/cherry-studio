import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { backupToLocal } from '@renderer/services/BackupService'
import { createDefaultBackupFileName } from '@renderer/utils/backupFileName'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface LocalBackupModalProps {
  isModalVisible: boolean
  handleBackup: () => void
  handleCancel: () => void
  backuping: boolean
  customFileName: string
  setCustomFileName: (value: string) => void
}

const logger = loggerService.withContext('LocalBackupModal')

export function LocalBackupModal({
  isModalVisible,
  handleBackup,
  handleCancel,
  backuping,
  customFileName,
  setCustomFileName
}: LocalBackupModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={isModalVisible} onOpenChange={(nextOpen) => !nextOpen && handleCancel()}>
      <DialogContent closeOnOverlayClick={false} className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('settings.data.local.backup.modal.title')}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={customFileName}
          onChange={(e) => setCustomFileName(e.target.value)}
          placeholder={t('settings.data.local.backup.modal.filename.placeholder')}
        />
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={backuping} onClick={handleBackup}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Hook for backup modal
export function useLocalBackupModal(localBackupDir: string | undefined) {
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [backuping, setBackuping] = useState(false)
  const [customFileName, setCustomFileName] = useState('')

  const handleCancel = () => {
    setIsModalVisible(false)
  }

  const showBackupModal = useCallback(async () => {
    setCustomFileName(await createDefaultBackupFileName())
    setIsModalVisible(true)
  }, [])

  const handleBackup = async () => {
    if (!localBackupDir) {
      setIsModalVisible(false)
      return
    }

    setBackuping(true)
    try {
      await backupToLocal({ customFileName })
      setIsModalVisible(false)
    } catch (error) {
      logger.error('Backup failed:', error as Error)
    } finally {
      setBackuping(false)
    }
  }

  return {
    isModalVisible,
    handleBackup,
    handleCancel,
    backuping,
    customFileName,
    setCustomFileName,
    showBackupModal
  }
}
