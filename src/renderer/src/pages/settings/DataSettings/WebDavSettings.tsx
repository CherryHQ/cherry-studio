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
import { Button, Input, Select } from 'antd'
import dayjs from 'dayjs'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

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

  const dispatch = useAppDispatch()
  const { theme } = useTheme()

  const { t } = useTranslation()

  const { webdavSync } = useRuntime()

  // 把之前备份的文件定时上传到 webdav，首先先配置 webdav 的 host, port, user, pass, path

  const onBackup = async () => {
    if (!webdavHost) {
      window.message.error({ content: t('message.error.invalid.webdav'), key: 'webdav-error' })
      return
    }
    setBackuping(true)
    await backupToWebdav({ showMessage: true })
    setBackuping(false)
  }

  const onRestore = async () => {
    if (!webdavHost) {
      window.message.error({ content: t('message.error.invalid.webdav'), key: 'webdav-error' })
      return
    }
    setRestoring(true)
    await restoreFromWebdav()
    setRestoring(false)
  }

  const onPressRestore = () => {
    window.modal.confirm({
      title: t('settings.data.webdav.restore.title'),
      content: t('settings.data.webdav.restore.content'),
      centered: true,
      onOk: onRestore
    })
  }

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
          <Button onClick={onBackup} icon={<SaveOutlined />} loading={backuping}>
            {t('settings.data.webdav.backup.button')}
          </Button>
          <Button onClick={onPressRestore} icon={<FolderOpenOutlined />} loading={restoring}>
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
    </SettingGroup>
  )
}

export default WebDavSettings
