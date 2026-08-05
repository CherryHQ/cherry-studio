import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { backupToDestination } from '@renderer/services/backupDestination'
import dayjs from 'dayjs'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function useS3BackupModal() {
  const [customFileName, setCustomFileName] = useState('')
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [backuping, setBackuping] = useState(false)

  const handleBackup = async () => {
    setBackuping(true)
    try {
      await backupToDestination('s3', { showMessage: true, name: customFileName })
    } finally {
      setBackuping(false)
      setIsModalVisible(false)
    }
  }

  const handleCancel = () => {
    setIsModalVisible(false)
  }

  const showBackupModal = useCallback(async () => {
    // 获取默认文件名
    const deviceType = await ipcApi.request('system.get_device_type')
    const hostname = await window.api.system.getHostname()
    const timestamp = dayjs().format('YYYYMMDDHHmmss')
    const defaultFileName = `cherry-studio.${timestamp}.${hostname}.${deviceType}.zip`
    setCustomFileName(defaultFileName)
    setIsModalVisible(true)
  }, [])

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

type S3BackupModalProps = {
  isModalVisible: boolean
  handleBackup: () => Promise<void>
  handleCancel: () => void
  backuping: boolean
  customFileName: string
  setCustomFileName: (value: string) => void
}

export function S3BackupModal({
  isModalVisible,
  handleBackup,
  handleCancel,
  backuping,
  customFileName,
  setCustomFileName
}: S3BackupModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={isModalVisible}
      onOpenChange={(open) => {
        if (!open) {
          handleCancel()
        }
      }}>
      <DialogContent closeOnOverlayClick={false} className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('settings.data.s3.backup.modal.title')}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={customFileName}
          onChange={(e) => setCustomFileName(e.target.value)}
          placeholder={t('settings.data.s3.backup.modal.filename.placeholder')}
        />
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleBackup} loading={backuping}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
