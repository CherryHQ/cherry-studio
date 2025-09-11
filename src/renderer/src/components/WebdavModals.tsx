import { backupToWebdav } from '@renderer/services/BackupService'
import { Input, Modal } from 'antd'
import dayjs from 'dayjs'
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
      await (backupMethod ?? backupToWebdav)({ showMessage: true, customFileName })
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
    const deviceType = await window.api.system.getDeviceType()
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
    <Modal
      title={customLabels?.modalTitle || t('settings.data.webdav.backup.modal.title')}
      open={isModalVisible}
      onOk={handleBackup}
      onCancel={handleCancel}
      okButtonProps={{ loading: backuping }}
      transitionName="animation-move-down"
      centered>
      <Input
        value={customFileName}
        onChange={(e) => setCustomFileName(e.target.value)}
        placeholder={customLabels?.filenamePlaceholder || t('settings.data.webdav.backup.modal.filename.placeholder')}
      />
    </Modal>
  )
}
