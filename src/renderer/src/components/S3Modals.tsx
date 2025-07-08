import { backupToS3 } from '@renderer/services/BackupService'
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

export function useS3BackupModal() {
  const [customFileName, setCustomFileName] = useState('')
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [backuping, setBackuping] = useState(false)

  const handleBackup = async () => {
    setBackuping(true)
    try {
      await backupToS3({ customFileName, showMessage: true })
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
    <Modal
      title={t('settings.data.s3.backup.modal.title')}
      open={isModalVisible}
      onOk={handleBackup}
      onCancel={handleCancel}
      okButtonProps={{ loading: backuping }}
      transitionName="animation-move-down"
      centered>
      <Input
        value={customFileName}
        onChange={(e) => setCustomFileName(e.target.value)}
        placeholder={t('settings.data.s3.backup.modal.filename.placeholder')}
      />
    </Modal>
  )
}

interface UseS3RestoreModalProps {
  endpoint: string | undefined
  region: string | undefined
  bucket: string | undefined
  accessKeyId: string | undefined
  secretAccessKey: string | undefined
  root?: string | undefined
}

export function useS3RestoreModal({
  endpoint,
  region,
  bucket,
  accessKeyId,
  secretAccessKey,
  root
}: UseS3RestoreModalProps) {
  const [isRestoreModalVisible, setIsRestoreModalVisible] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([])
  const { t } = useTranslation()

  const showRestoreModal = useCallback(async () => {
    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      window.message.error({ content: t('settings.data.s3.manager.config.incomplete'), key: 's3-error' })
      return
    }

    setIsRestoreModalVisible(true)
    setLoadingFiles(true)
    try {
      const files = await window.api.backup.listS3Files({
        endpoint,
        region,
        bucket,
        accessKeyId,
        secretAccessKey,
        root,
        autoSync: false,
        syncInterval: 0,
        maxBackups: 0,
        skipBackupFile: false
      })
      setBackupFiles(files)
    } catch (error: any) {
      window.message.error({
        content: t('settings.data.s3.manager.files.fetch.error', { message: error.message }),
        key: 'list-files-error'
      })
    } finally {
      setLoadingFiles(false)
    }
  }, [endpoint, region, bucket, accessKeyId, secretAccessKey, root, t])

  const handleRestore = useCallback(async () => {
    if (!selectedFile || !endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      window.message.error({
        content: !selectedFile
          ? t('settings.data.s3.restore.file.required')
          : t('settings.data.s3.restore.config.incomplete'),
        key: 'restore-error'
      })
      return
    }

    window.modal.confirm({
      title: t('settings.data.s3.restore.confirm.title'),
      content: t('settings.data.s3.restore.confirm.content', { fileName: selectedFile }),
      okText: t('settings.data.s3.restore.confirm.ok'),
      cancelText: t('settings.data.s3.restore.confirm.cancel'),
      centered: true,
      onOk: async () => {
        setRestoring(true)
        try {
          await window.api.backup.restoreFromS3({
            endpoint,
            region,
            bucket,
            accessKeyId,
            secretAccessKey,
            root,
            fileName: selectedFile,
            autoSync: false,
            syncInterval: 0,
            maxBackups: 0,
            skipBackupFile: false
          })
          window.message.success({ content: t('message.restore.success'), key: 's3-restore' })
          setIsRestoreModalVisible(false)
        } catch (error: any) {
          window.message.error({
            content: t('settings.data.s3.restore.error', { message: error.message }),
            key: 'restore-error'
          })
        } finally {
          setRestoring(false)
        }
      }
    })
  }, [selectedFile, endpoint, region, bucket, accessKeyId, secretAccessKey, root, t])

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

type S3RestoreModalProps = ReturnType<typeof useS3RestoreModal>

export function S3RestoreModal({
  isRestoreModalVisible,
  handleRestore,
  handleCancel,
  restoring,
  selectedFile,
  setSelectedFile,
  loadingFiles,
  backupFiles
}: S3RestoreModalProps) {
  const { t } = useTranslation()

  return (
    <Modal
      title={t('settings.data.s3.restore.modal.title')}
      open={isRestoreModalVisible}
      onOk={handleRestore}
      onCancel={handleCancel}
      okButtonProps={{ loading: restoring }}
      width={600}
      transitionName="animation-move-down"
      centered>
      <div style={{ position: 'relative' }}>
        <Select
          style={{ width: '100%' }}
          placeholder={t('settings.data.s3.restore.modal.select.placeholder')}
          value={selectedFile}
          onChange={setSelectedFile}
          options={backupFiles.map(formatFileOption)}
          loading={loadingFiles}
          showSearch
          filterOption={(input, option) =>
            typeof option?.label === 'string' ? option.label.toLowerCase().includes(input.toLowerCase()) : false
          }
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
