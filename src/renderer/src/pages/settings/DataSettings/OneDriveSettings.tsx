import { FolderOpenOutlined, SaveOutlined, SyncOutlined, WarningOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setOneDriveAccessToken as _setOneDriveAccessToken,
  setOneDriveRefreshToken as _setOneDriveRefreshToken,
  setOneDriveExpiresAt as _setOneDriveExpiresAt,
  setOneDriveFolderId as _setOneDriveFolderId,
  setOneDriveAutoSync,
  setOneDriveSyncInterval as _setOneDriveSyncInterval
} from '@renderer/store/settings'
import { Button, Input, Modal, Select, Spin, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
import { formatFileSize } from '@renderer/utils'
import { oauthWithOneDrive } from '@renderer/utils/oauth'
import { backupToOneDrive, listOneDriveFiles, restoreFromOneDrive } from '@renderer/services/BackupService'

interface BackupFile {
  fileName: string
  modifiedTime: string
  size: number
}

const OneDriveSettings: FC = () => {
  const {
    oneDriveAccessToken,
    oneDriveRefreshToken,
    oneDriveExpiresAt,
    oneDriveFolderId,
    oneDriveSyncInterval
  } = useSettings()

  const [accessToken, setAccessToken] = useState<string | undefined>(oneDriveAccessToken)
  const [refreshToken, setRefreshToken] = useState<string | undefined>(oneDriveRefreshToken)
  const [expiresAt, setExpiresAt] = useState<number | undefined>(oneDriveExpiresAt)
  const [folderId, setFolderId] = useState<string | undefined>(oneDriveFolderId)
  const [syncInterval, setSyncInterval] = useState<number>(oneDriveSyncInterval)

  const [backuping, setBackuping] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [customFileName, setCustomFileName] = useState('')
  const [isRestoreModalVisible, setIsRestoreModalVisible] = useState(false)
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string>('')
  const [loadingFiles, setLoadingFiles] = useState(false)

  const dispatch = useAppDispatch()
  const { theme } = useTheme()
  const { t } = useTranslation()

  const { oneDriveSync } = useAppSelector((state) => state.backup)

  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    dispatch(_setOneDriveSyncInterval(value))
    if (value === 0) {
      dispatch(setOneDriveAutoSync(false))
      // stopAutoSync() // 需要实现OneDrive的自动同步功能
    } else {
      dispatch(setOneDriveAutoSync(true))
      // startAutoSync() // 需要实现OneDrive的自动同步功能
    }
  }

  const renderSyncStatus = () => {
    if (!accessToken) return null

    if (!oneDriveSync.lastSyncTime && !oneDriveSync.syncing && !oneDriveSync.lastSyncError) {
      return <span style={{ color: 'var(--text-secondary)' }}>{t('settings.data.onedrive.noSync')}</span>
    }

    return (
      <HStack gap="5px" alignItems="center">
        {oneDriveSync.syncing && <SyncOutlined spin />}
        {!oneDriveSync.syncing && oneDriveSync.lastSyncError && (
          <Tooltip title={`${t('settings.data.onedrive.syncError')}: ${oneDriveSync.lastSyncError}`}>
            <WarningOutlined style={{ color: 'red' }} />
          </Tooltip>
        )}
        {oneDriveSync.lastSyncTime && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('settings.data.onedrive.lastSync')}: {dayjs(oneDriveSync.lastSyncTime).format('HH:mm:ss')}
          </span>
        )}
      </HStack>
    )
  }

  // 授权登录OneDrive的函数
  const handleAuth = async () => {
    try {
      oauthWithOneDrive((accessToken, refreshToken, expiresAt) => {
        setAccessToken(accessToken)
        setRefreshToken(refreshToken)
        setExpiresAt(expiresAt)

        dispatch(_setOneDriveAccessToken(accessToken))
        dispatch(_setOneDriveRefreshToken(refreshToken))
        dispatch(_setOneDriveExpiresAt(expiresAt))

        window.message.success({ content: t('settings.data.onedrive.auth.success'), key: 'onedrive-auth-success' })
      })
    } catch (error) {
      console.error('[handleAuth] error', error)
      window.message.error({ content: t('settings.data.onedrive.auth.error'), key: 'onedrive-auth-error' })
    }
  }

  const showBackupModal = async () => {
    if (!accessToken) {
      window.message.error({ content: t('message.error.not.authenticated.onedrive'), key: 'onedrive-error' })
      return
    }

    // 获取默认文件名
    const deviceType = await window.api.system.getDeviceType()
    const timestamp = dayjs().format('YYYYMMDDHHmmss')
    const defaultFileName = `cherry-studio.${timestamp}.${deviceType}.zip`
    setCustomFileName(defaultFileName)
    setIsModalVisible(true)
  }

  const handleBackup = async () => {
    setBackuping(true)
    try {
      // 实现OneDrive备份功能
      await backupToOneDrive({ showMessage: true, customFileName })
    } finally {
      setBackuping(false)
      setIsModalVisible(false)
    }
  }

  const handleCancel = () => {
    setIsModalVisible(false)
  }

  const showRestoreModal = async () => {
    if (!accessToken) {
      window.message.error({ content: t('message.error.not.authenticated.onedrive'), key: 'onedrive-error' })
      return
    }

    setIsRestoreModalVisible(true)
    setLoadingFiles(true)
    try {
      // 获取OneDrive备份文件列表
      const files = await listOneDriveFiles()
      setBackupFiles(files)
      if (files.length === 0) {
        window.message.info(t('settings.data.onedrive.no_backups'))
      }
    } catch (error: any) {
      window.message.error({ content: error.message, key: 'list-files-error' })
    } finally {
      setLoadingFiles(false)
    }
  }

  const handleRestore = async () => {
    if (!selectedFile || !accessToken) {
      window.message.error({
        content: !selectedFile ? t('message.error.no.file.selected') : t('message.error.not.authenticated.onedrive'),
        key: 'restore-error'
      })
      return
    }

    window.modal.confirm({
      title: t('settings.data.onedrive.restore.confirm.title'),
      content: t('settings.data.onedrive.restore.confirm.content'),
      centered: true,
      onOk: async () => {
        setRestoring(true)
        try {
          // 从OneDrive恢复
          await restoreFromOneDrive(selectedFile)
          setIsRestoreModalVisible(false)
        } catch (error: any) {
          window.message.error({ content: error.message, key: 'restore-error' })
        } finally {
          setRestoring(false)
        }
      }
    })
  }

  const formatFileOption = (file: BackupFile) => {
    const date = dayjs(file.modifiedTime).format('YYYY-MM-DD HH:mm:ss')
    const size = formatFileSize(file.size)
    return {
      label: `${file.fileName} (${date}, ${size})`,
      value: file.fileName
    }
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.onedrive.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.onedrive.auth')}</SettingRowTitle>
        <Button onClick={handleAuth} type="primary">
          {accessToken ? t('settings.data.onedrive.reauth') : t('settings.data.onedrive.auth')}
        </Button>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.onedrive.folder')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.onedrive.folder.placeholder')}
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          style={{ width: 250 }}
          disabled={!accessToken}
          onBlur={() => dispatch(_setOneDriveFolderId(folderId || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          <Button onClick={showBackupModal} icon={<SaveOutlined />} loading={backuping} disabled={!accessToken}>
            {t('settings.data.onedrive.backup.button')}
          </Button>
          <Button onClick={showRestoreModal} icon={<FolderOpenOutlined />} loading={restoring} disabled={!accessToken}>
            {t('settings.data.onedrive.restore.button')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.onedrive.autoSync')}</SettingRowTitle>
        <Select
          value={syncInterval}
          onChange={onSyncIntervalChange}
          disabled={!accessToken}
          style={{ width: 120 }}
        >
          <Select.Option value={0}>{t('settings.data.onedrive.autoSync.off')}</Select.Option>
          <Select.Option value={1}>{t('settings.data.onedrive.minute_interval', { count: 1 })}</Select.Option>
          <Select.Option value={5}>{t('settings.data.onedrive.minute_interval', { count: 5 })}</Select.Option>
          <Select.Option value={15}>{t('settings.data.onedrive.minute_interval', { count: 15 })}</Select.Option>
          <Select.Option value={30}>{t('settings.data.onedrive.minute_interval', { count: 30 })}</Select.Option>
          <Select.Option value={60}>{t('settings.data.onedrive.hour_interval', { count: 1 })}</Select.Option>
        </Select>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.onedrive.syncStatus')}</SettingRowTitle>
        {renderSyncStatus()}
      </SettingRow>

      {/* 备份对话框 */}
      <Modal
        title={t('settings.data.onedrive.backup.title')}
        open={isModalVisible}
        onOk={handleBackup}
        onCancel={handleCancel}
        okButtonProps={{ loading: backuping }}
        centered
      >
        <Input
          placeholder={t('settings.data.onedrive.filename.placeholder')}
          value={customFileName}
          onChange={(e) => setCustomFileName(e.target.value)}
          style={{ width: '100%' }}
        />
      </Modal>

      {/* 恢复对话框 */}
      <Modal
        title={t('settings.data.onedrive.restore.title')}
        open={isRestoreModalVisible}
        onOk={handleRestore}
        onCancel={() => setIsRestoreModalVisible(false)}
        okButtonProps={{ loading: restoring }}
        centered
      >
        {loadingFiles ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <Spin />
            <div style={{ marginTop: '10px' }}>{t('settings.data.onedrive.loading')}</div>
          </div>
        ) : (
          <Select
            placeholder={t('settings.data.onedrive.select.file')}
            style={{ width: '100%' }}
            onChange={(value) => setSelectedFile(value)}
            options={backupFiles.map(formatFileOption)}
          />
        )}
      </Modal>
    </SettingGroup>
  )
}

export default OneDriveSettings