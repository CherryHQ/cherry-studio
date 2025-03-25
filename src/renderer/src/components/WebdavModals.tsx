import { backupToWebdav, restoreFromWebdav } from '@renderer/services/BackupService'
import { formatFileSize } from '@renderer/utils'
import { Input, Modal, Select, Spin } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface BackupFile {
  fileName: string
  modifiedTime: string
  size: number
}

interface WebdavModalProps {
  isModalVisible: boolean
  handleBackup: () => void
  handleCancel: () => void
  backuping: boolean
  customFileName: string
  setCustomFileName: (value: string) => void
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
    const timestamp = dayjs().format('YYYYMMDDHHmmss')
    const defaultFileName = `cherry-studio.${timestamp}.${deviceType}.zip`
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
  setCustomFileName
}: WebdavModalProps) {
  const { t } = useTranslation()

  return (
    <Modal
      title={t('settings.data.webdav.backup.modal.title')}
      open={isModalVisible}
      onOk={handleBackup}
      onCancel={handleCancel}
      okButtonProps={{ loading: backuping }}>
      <Input
        value={customFileName}
        onChange={(e) => setCustomFileName(e.target.value)}
        placeholder={t('settings.data.webdav.backup.modal.filename.placeholder')}
      />
    </Modal>
  )
}

interface WebdavRestoreModalProps {
  isRestoreModalVisible: boolean
  handleRestore: () => void
  handleCancel: () => void
  restoring: boolean
  selectedFile: string | null
  setSelectedFile: (value: string | null) => void
  loadingFiles: boolean
  backupFiles: BackupFile[]
}

interface UseWebdavRestoreModalProps {
  webdavHost: string | undefined
  webdavUser: string | undefined
  webdavPass: string | undefined
  webdavPath: string | undefined
  restoreMethod?: typeof restoreFromWebdav
}

export function useWebdavRestoreModal({
  webdavHost,
  webdavUser,
  webdavPass,
  webdavPath,
  restoreMethod
}: UseWebdavRestoreModalProps) {
  const { t } = useTranslation()

  const [isRestoreModalVisible, setIsRestoreModalVisible] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([])

  const showRestoreModal = useCallback(async () => {
    if (!webdavHost || !webdavUser || !webdavPass || !webdavPath) {
      window.message.error({ content: t('message.error.invalid.webdav'), key: 'webdav-error' })
      return
    }

    setIsRestoreModalVisible(true)
    setLoadingFiles(true)
    try {
      const files = await window.api.backup.listWebdavFiles({
        webdavHost,
        webdavUser,
        webdavPass,
        webdavPath
      })
      setBackupFiles(files)
    } catch (error: any) {
      window.message.error({ content: error.message, key: 'list-files-error' })
    } finally {
      setLoadingFiles(false)
    }
  }, [webdavHost, webdavUser, webdavPass, webdavPath, t])

  const handleRestore = useCallback(async () => {
    if (!selectedFile || !webdavHost || !webdavUser || !webdavPass || !webdavPath) {
      window.message.error({
        content: !selectedFile ? t('message.error.no.file.selected') : t('message.error.invalid.webdav'),
        key: 'restore-error'
      })
      return
    }

    window.modal.confirm({
      title: t('settings.data.webdav.restore.confirm.title'),
      content: t('settings.data.webdav.restore.confirm.content'),
      centered: true,
      onOk: async () => {
        setRestoring(true)
        try {
          await (restoreMethod ?? restoreFromWebdav)(selectedFile)
          setIsRestoreModalVisible(false)
        } catch (error: any) {
          window.message.error({ content: error.message, key: 'restore-error' })
        } finally {
          setRestoring(false)
        }
      }
    })
  }, [selectedFile, webdavHost, webdavUser, webdavPass, webdavPath, t, restoreMethod])

  const handleCancel = () => {
    setIsRestoreModalVisible(false)
  }

  return {
    isRestoreModalVisible,
    handleRestore,
    handleCancel,
    restoring,
    selectedFile,
    setSelectedFile,
    loadingFiles,
    backupFiles,
    showRestoreModal
  }
}

export function WebdavRestoreModal({
  isRestoreModalVisible,
  handleRestore,
  handleCancel,
  restoring,
  selectedFile,
  setSelectedFile,
  loadingFiles,
  backupFiles
}: WebdavRestoreModalProps) {
  const { t } = useTranslation()

  return (
    <Modal
      title={t('settings.data.webdav.restore.modal.title')}
      open={isRestoreModalVisible}
      onOk={handleRestore}
      onCancel={handleCancel}
      okButtonProps={{ loading: restoring }}
      width={600}>
      <div style={{ position: 'relative' }}>
        <Select
          style={{ width: '100%' }}
          placeholder={t('settings.data.webdav.restore.modal.select.placeholder')}
          value={selectedFile}
          onChange={setSelectedFile}
          options={backupFiles.map(formatFileOption)}
          loading={loadingFiles}
          showSearch
          filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
        />
        {loadingFiles && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
            <Spin />
          </div>
        )}
      </div>
    </Modal>
  )
}

function formatFileOption(file: BackupFile) {
  const date = dayjs(file.modifiedTime).format('YYYY-MM-DD HH:mm:ss')
  const size = formatFileSize(file.size)
  return {
    label: `${file.fileName} (${date}, ${size})`,
    value: file.fileName
  }
}
