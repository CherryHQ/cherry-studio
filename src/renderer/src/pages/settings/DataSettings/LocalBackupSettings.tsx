import { DeleteOutlined, FolderOpenOutlined, SaveOutlined, SyncOutlined, WarningOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { LocalBackupManager } from '@renderer/components/LocalBackupManager'
import { LocalBackupModal, useLocalBackupModal } from '@renderer/components/LocalBackupModals'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { startLocalBackupAutoSync, stopLocalBackupAutoSync } from '@renderer/services/BackupService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setLocalBackupAutoSync,
  setLocalBackupDir as _setLocalBackupDir,
  setLocalBackupMaxBackups as _setLocalBackupMaxBackups,
  setLocalBackupSkipBackupFile as _setLocalBackupSkipBackupFile,
  setLocalBackupSyncInterval as _setLocalBackupSyncInterval
} from '@renderer/store/settings'
import { AppInfo } from '@renderer/types'
import { Button, Input, Select, Switch, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const LocalBackupSettings: FC = () => {
  const {
    localBackupDir: localBackupDirSetting,
    localBackupSyncInterval: localBackupSyncIntervalSetting,
    localBackupMaxBackups: localBackupMaxBackupsSetting,
    localBackupSkipBackupFile: localBackupSkipBackupFileSetting
  } = useSettings()

  const [localBackupDir, setLocalBackupDir] = useState<string | undefined>(localBackupDirSetting)
  const [localBackupSkipBackupFile, setLocalBackupSkipBackupFile] = useState<boolean>(localBackupSkipBackupFileSetting)
  const [backupManagerVisible, setBackupManagerVisible] = useState(false)

  const [syncInterval, setSyncInterval] = useState<number>(localBackupSyncIntervalSetting)
  const [maxBackups, setMaxBackups] = useState<number>(localBackupMaxBackupsSetting)

  const [appInfo, setAppInfo] = useState<AppInfo>()

  useEffect(() => {
    window.api.getAppInfo().then(setAppInfo)
  }, [])

  const dispatch = useAppDispatch()
  const { theme } = useTheme()

  const { t } = useTranslation()

  const { localBackupSync } = useAppSelector((state) => state.backup)

  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    dispatch(_setLocalBackupSyncInterval(value))
    if (value === 0) {
      dispatch(setLocalBackupAutoSync(false))
      stopLocalBackupAutoSync()
    } else {
      dispatch(setLocalBackupAutoSync(true))
      startLocalBackupAutoSync()
    }
  }

  const checkLocalBackupDirValid = async (dir: string) => {
    if (dir === '') {
      return false
    }

    // check new local backup dir is not in app data path
    // if is in app data path, show error
    if (dir.startsWith(appInfo!.appDataPath)) {
      window.message.error(t('settings.data.local.directory.select_error_app_data_path'))
      return false
    }

    // check new local backup dir is not in app install path
    // if is in app install path, show error
    if (dir.startsWith(appInfo!.installPath)) {
      window.message.error(t('settings.data.local.directory.select_error_in_app_install_path'))
      return false
    }

    // check new app data path has write permission
    const hasWritePermission = await window.api.hasWritePermission(dir)
    if (!hasWritePermission) {
      window.message.error(t('settings.data.local.directory.select_error_write_permission'))
      return false
    }

    return true
  }

  const handleLocalBackupDirChange = async (value: string) => {
    if (await checkLocalBackupDirValid(value)) {
      setLocalBackupDir(value)
      dispatch(_setLocalBackupDir(value))
      // Create directory if it doesn't exist and set it in the backend
      await window.api.backup.setLocalBackupDir(value)

      dispatch(setLocalBackupAutoSync(true))
      startLocalBackupAutoSync(true)
      return
    }

    setLocalBackupDir('')
    dispatch(_setLocalBackupDir(''))
    dispatch(setLocalBackupAutoSync(false))
    stopLocalBackupAutoSync()
  }

  const onMaxBackupsChange = (value: number) => {
    setMaxBackups(value)
    dispatch(_setLocalBackupMaxBackups(value))
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    setLocalBackupSkipBackupFile(value)
    dispatch(_setLocalBackupSkipBackupFile(value))
  }

  const handleBrowseDirectory = async () => {
    try {
      const newLocalBackupDir = await window.api.select({
        properties: ['openDirectory', 'createDirectory'],
        title: t('settings.data.local.directory.select_title')
      })

      if (!newLocalBackupDir) {
        return
      }

      handleLocalBackupDirChange(newLocalBackupDir)
    } catch (error) {
      console.error('Failed to select directory:', error)
    }
  }

  const handleClearDirectory = () => {
    setLocalBackupDir('')
    dispatch(_setLocalBackupDir(''))
    dispatch(setLocalBackupAutoSync(false))
    stopLocalBackupAutoSync()
  }

  const renderSyncStatus = () => {
    if (!localBackupDir) return null

    if (!localBackupSync.lastSyncTime && !localBackupSync.syncing && !localBackupSync.lastSyncError) {
      return <span style={{ color: 'var(--text-secondary)' }}>{t('settings.data.local.noSync')}</span>
    }

    return (
      <HStack gap="5px" alignItems="center">
        {localBackupSync.syncing && <SyncOutlined spin />}
        {!localBackupSync.syncing && localBackupSync.lastSyncError && (
          <Tooltip title={`${t('settings.data.local.syncError')}: ${localBackupSync.lastSyncError}`}>
            <WarningOutlined style={{ color: 'red' }} />
          </Tooltip>
        )}
        {localBackupSync.lastSyncTime && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('settings.data.local.lastSync')}: {dayjs(localBackupSync.lastSyncTime).format('HH:mm:ss')}
          </span>
        )}
      </HStack>
    )
  }

  const { isModalVisible, handleBackup, handleCancel, backuping, customFileName, setCustomFileName, showBackupModal } =
    useLocalBackupModal(localBackupDir)

  const showBackupManager = () => {
    setBackupManagerVisible(true)
  }

  const closeBackupManager = () => {
    setBackupManagerVisible(false)
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.local.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.local.directory')}</SettingRowTitle>
        <HStack gap="5px">
          <Input
            value={localBackupDir}
            readOnly
            placeholder={t('settings.data.local.directory.placeholder')}
            style={{ minWidth: 200, maxWidth: 400, flex: 1 }}
          />
          <Button icon={<FolderOpenOutlined />} onClick={handleBrowseDirectory}>
            {t('common.browse')}
          </Button>
          <Button icon={<DeleteOutlined />} onClick={handleClearDirectory} disabled={!localBackupDir} danger>
            {t('common.clear')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          <Button onClick={showBackupModal} icon={<SaveOutlined />} loading={backuping} disabled={!localBackupDir}>
            {t('settings.data.local.backup.button')}
          </Button>
          <Button onClick={showBackupManager} icon={<FolderOpenOutlined />} disabled={!localBackupDir}>
            {t('settings.data.local.restore.button')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.local.autoSync')}</SettingRowTitle>
        <Select
          value={syncInterval}
          onChange={(value) => onSyncIntervalChange(value as number)}
          disabled={!localBackupDir}
          style={{ minWidth: 120 }}>
          <Select.Option value={0}>{t('settings.data.local.autoSync.off')}</Select.Option>
          <Select.Option value={1}>{t('settings.data.local.minute_interval', { count: 1 })}</Select.Option>
          <Select.Option value={5}>{t('settings.data.local.minute_interval', { count: 5 })}</Select.Option>
          <Select.Option value={15}>{t('settings.data.local.minute_interval', { count: 15 })}</Select.Option>
          <Select.Option value={30}>{t('settings.data.local.minute_interval', { count: 30 })}</Select.Option>
          <Select.Option value={60}>{t('settings.data.local.hour_interval', { count: 1 })}</Select.Option>
          <Select.Option value={120}>{t('settings.data.local.hour_interval', { count: 2 })}</Select.Option>
          <Select.Option value={360}>{t('settings.data.local.hour_interval', { count: 6 })}</Select.Option>
          <Select.Option value={720}>{t('settings.data.local.hour_interval', { count: 12 })}</Select.Option>
          <Select.Option value={1440}>{t('settings.data.local.hour_interval', { count: 24 })}</Select.Option>
        </Select>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.local.maxBackups')}</SettingRowTitle>
        <Select
          value={maxBackups}
          onChange={(value) => onMaxBackupsChange(value as number)}
          disabled={!localBackupDir}
          style={{ minWidth: 120 }}>
          <Select.Option value={0}>{t('settings.data.local.maxBackups.unlimited')}</Select.Option>
          <Select.Option value={1}>1</Select.Option>
          <Select.Option value={3}>3</Select.Option>
          <Select.Option value={5}>5</Select.Option>
          <Select.Option value={10}>10</Select.Option>
          <Select.Option value={20}>20</Select.Option>
          <Select.Option value={50}>50</Select.Option>
        </Select>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.backup.skip_file_data_title')}</SettingRowTitle>
        <Switch checked={localBackupSkipBackupFile} onChange={onSkipBackupFilesChange} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.backup.skip_file_data_help')}</SettingHelpText>
      </SettingRow>
      {localBackupSync && syncInterval > 0 && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.local.syncStatus')}</SettingRowTitle>
            {renderSyncStatus()}
          </SettingRow>
        </>
      )}
      <>
        <LocalBackupModal
          isModalVisible={isModalVisible}
          handleBackup={handleBackup}
          handleCancel={handleCancel}
          backuping={backuping}
          customFileName={customFileName}
          setCustomFileName={setCustomFileName}
        />

        <LocalBackupManager
          visible={backupManagerVisible}
          onClose={closeBackupManager}
          localBackupDir={localBackupDir}
        />
      </>
    </SettingGroup>
  )
}

export default LocalBackupSettings
