import { FolderOpenOutlined, SaveOutlined, SyncOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { backupToWebdav, restoreFromWebdav, startAutoSync, stopAutoSync } from '@renderer/services/BackupService'
import { useAppDispatch } from '@renderer/store'
import {
  setWebdavAutoSync,
  setWebdavHost as _setWebdavHost,
  setWebdavPass as _setWebdavPass,
  setWebdavPath as _setWebdavPath,
  setWebdavSyncInterval as _setWebdavSyncInterval,
  setWebdavUser as _setWebdavUser
} from '@renderer/store/settings'
import { Button, Input, Modal, Select, Spin } from 'antd'
import dayjs from 'dayjs'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

interface BackupFile {
  fileName: string
  modifiedTime: string
  size: number
}

const WebDavSettings: FC = () => {
  const {
    webdavHost: webDAVHost,
    webdavUser: webDAVUser,
    webdavPass: webDAVPass,
    webdavPath: webDAVPath,
    webdavSyncInterval: webDAVSyncInterval
  } = useSettings()

  const [webdavHost, setWebdavHost] = useState<string | undefined>(webDAVHost)
  const [webdavUser, setWebdavUser] = useState<string | undefined>(webDAVUser)
  const [webdavPass, setWebdavPass] = useState<string | undefined>(webDAVPass)
  const [webdavPath, setWebdavPath] = useState<string | undefined>(webDAVPath)

  const [syncInterval, setSyncInterval] = useState<number>(webDAVSyncInterval)

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

  const { webdavSync } = useRuntime()

  // 把之前备份的文件定时上传到 webdav，首先先配置 webdav 的 host, port, user, pass, path

  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    dispatch(_setWebdavSyncInterval(value))
    if (value === 0) {
      dispatch(setWebdavAutoSync(false))
      stopAutoSync()
    } else {
      dispatch(setWebdavAutoSync(true))
      startAutoSync()
    }
  }

  const renderSyncStatus = () => {
    if (!webdavHost) return null

    if (!webdavSync.lastSyncTime && !webdavSync.syncing && !webdavSync.lastSyncError) {
      return <span style={{ color: 'var(--text-secondary)' }}>{t('settings.data.webdav.noSync')}</span>
    }

    return (
      <HStack gap="5px" alignItems="center">
        {webdavSync.syncing && <SyncOutlined spin />}
        {webdavSync.lastSyncTime && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('settings.data.webdav.lastSync')}: {dayjs(webdavSync.lastSyncTime).format('HH:mm:ss')}
          </span>
        )}
        {webdavSync.lastSyncError && (
          <span style={{ color: 'var(--error-color)' }}>
            {t('settings.data.webdav.syncError')}: {webdavSync.lastSyncError}
          </span>
        )}
      </HStack>
    )
  }

  const showBackupModal = async () => {
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
      await backupToWebdav({ showMessage: true, customFileName })
    } finally {
      setBackuping(false)
      setIsModalVisible(false)
    }
  }

  const handleCancel = () => {
    setIsModalVisible(false)
  }

  const showRestoreModal = async () => {
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
  }

  const handleRestore = async () => {
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
          await restoreFromWebdav(selectedFile)
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
    const size = `${(file.size / 1024).toFixed(2)} KB`
    return {
      label: `${file.fileName} (${date}, ${size})`,
      value: file.fileName
    }
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.webdav.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.webdav.host')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.webdav.host.placeholder')}
          value={webdavHost}
          onChange={(e) => setWebdavHost(e.target.value)}
          style={{ width: 250 }}
          type="url"
          onBlur={() => dispatch(_setWebdavHost(webdavHost || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.webdav.user')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.webdav.user')}
          value={webdavUser}
          onChange={(e) => setWebdavUser(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(_setWebdavUser(webdavUser || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.webdav.password')}</SettingRowTitle>
        <Input.Password
          placeholder={t('settings.data.webdav.password')}
          value={webdavPass}
          onChange={(e) => setWebdavPass(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(_setWebdavPass(webdavPass || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.webdav.path')}</SettingRowTitle>
        <Input
          placeholder={t('settings.data.webdav.path.placeholder')}
          value={webdavPath}
          onChange={(e) => setWebdavPath(e.target.value)}
          style={{ width: 250 }}
          onBlur={() => dispatch(_setWebdavPath(webdavPath || ''))}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          <Button onClick={showBackupModal} icon={<SaveOutlined />} loading={backuping}>
            {t('settings.data.webdav.backup.button')}
          </Button>
          <Button onClick={showRestoreModal} icon={<FolderOpenOutlined />} loading={restoring}>
            {t('settings.data.webdav.restore.button')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.webdav.autoSync')}</SettingRowTitle>
        <Select value={syncInterval} onChange={onSyncIntervalChange} disabled={!webdavHost} style={{ width: 120 }}>
          <Select.Option value={0}>{t('settings.data.webdav.autoSync.off')}</Select.Option>
          <Select.Option value={1}>{t('settings.data.webdav.minute_interval', { count: 1 })}</Select.Option>
          <Select.Option value={5}>{t('settings.data.webdav.minute_interval', { count: 5 })}</Select.Option>
          <Select.Option value={15}>{t('settings.data.webdav.minute_interval', { count: 15 })}</Select.Option>
          <Select.Option value={30}>{t('settings.data.webdav.minute_interval', { count: 30 })}</Select.Option>
          <Select.Option value={60}>{t('settings.data.webdav.hour_interval', { count: 1 })}</Select.Option>
          <Select.Option value={120}>{t('settings.data.webdav.hour_interval', { count: 2 })}</Select.Option>
          <Select.Option value={360}>{t('settings.data.webdav.hour_interval', { count: 6 })}</Select.Option>
          <Select.Option value={720}>{t('settings.data.webdav.hour_interval', { count: 12 })}</Select.Option>
          <Select.Option value={1440}>{t('settings.data.webdav.hour_interval', { count: 24 })}</Select.Option>
        </Select>
      </SettingRow>
      {webdavSync && syncInterval > 0 && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.webdav.syncStatus')}</SettingRowTitle>
            {renderSyncStatus()}
          </SettingRow>
        </>
      )}
  <>
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

      <Modal
        title={t('settings.data.webdav.restore.modal.title')}
        open={isRestoreModalVisible}
        onOk={handleRestore}
        onCancel={() => setIsRestoreModalVisible(false)}
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
    </>
    </SettingGroup>
  )
}

export default WebDavSettings
