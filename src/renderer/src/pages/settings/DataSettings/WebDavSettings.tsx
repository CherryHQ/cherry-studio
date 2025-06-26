import { FolderOpenOutlined, SaveOutlined, SyncOutlined, WarningOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import Selector from '@renderer/components/Selector'
import { WebdavBackupManager } from '@renderer/components/WebdavBackupManager'
import { useWebdavBackupModal, WebdavBackupModal } from '@renderer/components/WebdavModals'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { startAutoSync, stopAutoSync } from '@renderer/services/BackupService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setWebdavAutoSync,
  setWebdavHost as _setWebdavHost,
  setWebdavMaxBackups as _setWebdavMaxBackups,
  setWebdavPass as _setWebdavPass,
  setWebdavPath as _setWebdavPath,
  setWebdavSkipBackupFile as _setWebdavSkipBackupFile,
  setWebdavSyncInterval as _setWebdavSyncInterval,
  setWebdavUser as _setWebdavUser
} from '@renderer/store/settings'
import { Button, Input, Switch, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const WebDavSettings: FC = () => {
  const {
    webdavHost: webDAVHost,
    webdavUser: webDAVUser,
    webdavPass: webDAVPass,
    webdavPath: webDAVPath,
    webdavSyncInterval: webDAVSyncInterval,
    webdavMaxBackups: webDAVMaxBackups,
    webdavSkipBackupFile: webdDAVSkipBackupFile
  } = useSettings()

  const [webdavHost, setWebdavHost] = useState<string | undefined>(webDAVHost)
  const [webdavUser, setWebdavUser] = useState<string | undefined>(webDAVUser)
  const [webdavPass, setWebdavPass] = useState<string | undefined>(webDAVPass)
  const [webdavPath, setWebdavPath] = useState<string | undefined>(webDAVPath)
  const [webdavSkipBackupFile, setWebdavSkipBackupFile] = useState<boolean>(webdDAVSkipBackupFile)
  const [backupManagerVisible, setBackupManagerVisible] = useState(false)

  const [syncInterval, setSyncInterval] = useState<number>(webDAVSyncInterval)
  const [maxBackups, setMaxBackups] = useState<number>(webDAVMaxBackups)

  const dispatch = useAppDispatch()
  const { theme } = useTheme()

  const { t } = useTranslation()

  const { webdavSync } = useAppSelector((state) => state.backup)

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

  const onMaxBackupsChange = (value: number) => {
    setMaxBackups(value)
    dispatch(_setWebdavMaxBackups(value))
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    setWebdavSkipBackupFile(value)
    dispatch(_setWebdavSkipBackupFile(value))
  }

  const renderSyncStatus = () => {
    if (!webdavHost) return null

    if (!webdavSync.lastSyncTime && !webdavSync.syncing && !webdavSync.lastSyncError) {
      return <span style={{ color: 'var(--text-secondary)' }}>{t('settings.data.webdav.noSync')}</span>
    }

    return (
      <HStack gap="5px" alignItems="center">
        {webdavSync.syncing && <SyncOutlined spin />}
        {!webdavSync.syncing && webdavSync.lastSyncError && (
          <Tooltip title={`${t('settings.data.webdav.syncError')}: ${webdavSync.lastSyncError}`}>
            <WarningOutlined style={{ color: 'red' }} />
          </Tooltip>
        )}
        {webdavSync.lastSyncTime && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('settings.data.webdav.lastSync')}: {dayjs(webdavSync.lastSyncTime).format('HH:mm:ss')}
          </span>
        )}
      </HStack>
    )
  }

  const { isModalVisible, handleBackup, handleCancel, backuping, customFileName, setCustomFileName, showBackupModal } =
    useWebdavBackupModal()

  const showBackupManager = () => {
    setBackupManagerVisible(true)
  }

  const closeBackupManager = () => {
    setBackupManagerVisible(false)
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
          <Button onClick={showBackupManager} icon={<FolderOpenOutlined />} disabled={!webdavHost}>
            {t('settings.data.webdav.restore.button')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.webdav.autoSync')}</SettingRowTitle>
        <Selector
          size={14}
          value={syncInterval}
          onChange={onSyncIntervalChange}
          disabled={!webdavHost}
          options={[
            { label: t('settings.data.webdav.autoSync.off'), value: 0 },
            { label: t('settings.data.webdav.minute_interval', { count: 1 }), value: 1 },
            { label: t('settings.data.webdav.minute_interval', { count: 5 }), value: 5 },
            { label: t('settings.data.webdav.minute_interval', { count: 15 }), value: 15 },
            { label: t('settings.data.webdav.minute_interval', { count: 30 }), value: 30 },
            { label: t('settings.data.webdav.hour_interval', { count: 1 }), value: 60 },
            { label: t('settings.data.webdav.hour_interval', { count: 2 }), value: 120 },
            { label: t('settings.data.webdav.hour_interval', { count: 6 }), value: 360 },
            { label: t('settings.data.webdav.hour_interval', { count: 12 }), value: 720 },
            { label: t('settings.data.webdav.hour_interval', { count: 24 }), value: 1440 }
          ]}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.webdav.maxBackups')}</SettingRowTitle>
        <Selector
          size={14}
          value={maxBackups}
          onChange={onMaxBackupsChange}
          disabled={!webdavHost}
          options={[
            { label: t('settings.data.webdav.maxBackups.unlimited'), value: 0 },
            { label: '1', value: 1 },
            { label: '3', value: 3 },
            { label: '5', value: 5 },
            { label: '10', value: 10 },
            { label: '20', value: 20 },
            { label: '50', value: 50 }
          ]}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.backup.skip_file_data_title')}</SettingRowTitle>
        <Switch checked={webdavSkipBackupFile} onChange={onSkipBackupFilesChange} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.backup.skip_file_data_help')}</SettingHelpText>
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
        <WebdavBackupModal
          isModalVisible={isModalVisible}
          handleBackup={handleBackup}
          handleCancel={handleCancel}
          backuping={backuping}
          customFileName={customFileName}
          setCustomFileName={setCustomFileName}
        />

        <WebdavBackupManager
          visible={backupManagerVisible}
          onClose={closeBackupManager}
          webdavConfig={{
            webdavHost,
            webdavUser,
            webdavPass,
            webdavPath
          }}
        />
      </>
    </SettingGroup>
  )
}

export default WebDavSettings
