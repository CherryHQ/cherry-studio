import { backupToLocalDir } from '@renderer/services/BackupService'
import { Button, Input, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface LocalBackupModalProps {
  isModalVisible: boolean
  handleBackup: () => void
  handleCancel: () => void
  backuping: boolean
  customFileName: string
  setCustomFileName: (value: string) => void
}

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
    <Modal
      title={t('settings.data.local.backup.modal.title')}
      open={isModalVisible}
      onOk={handleBackup}
      onCancel={handleCancel}
      footer={[
        <Button key="back" onClick={handleCancel}>
          {t('common.cancel')}
        </Button>,
        <Button key="submit" type="primary" loading={backuping} onClick={handleBackup}>
          {t('common.confirm')}
        </Button>
      ]}>
      <Input
        value={customFileName}
        onChange={(e) => setCustomFileName(e.target.value)}
        placeholder={t('settings.data.local.backup.modal.filename.placeholder')}
      />
    </Modal>
  )
}

// Hook for backup modal
export function useLocalBackupModal(localBackupDir: string | undefined) {
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [backuping, setBackuping] = useState(false)
  const [customFileName, setCustomFileName] = useState('')
  const { t } = useTranslation()

  const showBackupModal = () => {
    const today = new Date()
    const defaultFileName = `cherry-studio.backup.${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(today.getDate()).padStart(2, '0')}.${String(today.getHours()).padStart(2, '0')}${String(
      today.getMinutes()
    ).padStart(2, '0')}.zip`

    setCustomFileName(defaultFileName)
    setIsModalVisible(true)
  }

  const handleCancel = () => {
    setIsModalVisible(false)
  }

  const handleBackup = async () => {
    if (!localBackupDir) {
      window.message.error({ content: t('message.error.invalid.localBackupDir'), key: 'localBackup' })
      setIsModalVisible(false)
      return
    }

    setBackuping(true)
    try {
      await backupToLocalDir({
        showMessage: true,
        customFileName
      })
      setIsModalVisible(false)
    } catch (error) {
      console.error('[LocalBackupModal] Backup failed:', error)
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
