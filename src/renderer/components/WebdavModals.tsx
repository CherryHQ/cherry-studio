import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from '@cherrystudio/ui'
import { backupToWebdav } from '@renderer/services/BackupService'
import { createDefaultBackupFileName } from '@renderer/utils/backupFileName'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface WebdavModalProps {
  isModalVisible: boolean
  handleBackup: () => void
  handleCancel: () => void
  backuping: boolean
  customFileName: string
  setCustomFileName: (value: string) => void
  customLabels?: {
    modalTitle?: string
    filenamePlaceholder?: string
  }
}

export function useWebdavBackupModal({ backupMethod }: { backupMethod?: typeof backupToWebdav } = {}) {
  const [customFileName, setCustomFileName] = useState('')
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [backuping, setBackuping] = useState(false)

  const handleBackup = async () => {
    setBackuping(true)
    try {
      await (backupMethod ?? backupToWebdav)({ customFileName })
    } finally {
      setBackuping(false)
      setIsModalVisible(false)
    }
  }

  const handleCancel = () => {
    setIsModalVisible(false)
  }

  const showBackupModal = useCallback(async () => {
    setCustomFileName(await createDefaultBackupFileName())
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

export function WebdavBackupModal({
  isModalVisible,
  handleBackup,
  handleCancel,
  backuping,
  customFileName,
  setCustomFileName,
  customLabels
}: WebdavModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={isModalVisible} onOpenChange={(nextOpen) => !nextOpen && handleCancel()}>
      <DialogContent closeOnOverlayClick={false} className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{customLabels?.modalTitle || t('settings.data.webdav.backup.modal.title')}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={customFileName}
          onChange={(e) => setCustomFileName(e.target.value)}
          placeholder={customLabels?.filenamePlaceholder || t('settings.data.webdav.backup.modal.filename.placeholder')}
        />
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
          <Button loading={backuping} onClick={handleBackup}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
