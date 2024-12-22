import { FolderOpenOutlined, SaveOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
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
import { Button, Input, Select, Switch } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingRow, SettingRowTitle, SettingTitle } from '..'

const WebDavSettings: FC = () => {
  const {
    webdavHost: webDAVHost,
    webdavUser: webDAVUser,
    webdavPass: webDAVPass,
    webdavPath: webDAVPath,
    webdavAutoSync: webDAVAutoSync,
    webdavSyncInterval: webDAVSyncInterval
  } = useSettings()

  const [webdavHost, setWebdavHost] = useState<string | undefined>(webDAVHost)
  const [webdavUser, setWebdavUser] = useState<string | undefined>(webDAVUser)
  const [webdavPass, setWebdavPass] = useState<string | undefined>(webDAVPass)
  const [webdavPath, setWebdavPath] = useState<string | undefined>(webDAVPath)

  const [autoSync, setAutoSync] = useState<boolean>(webDAVAutoSync)
  const [syncInterval, setSyncInterval] = useState<number>(webDAVSyncInterval)

  const [backuping, setBackuping] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const dispatch = useAppDispatch()

  const { t } = useTranslation()

  // 把之前备份的文件定时上传到 webdav，首先先配置 webdav 的 host, port, user, pass, path

  const onBackup = async () => {
    if (!webdavHost) {
      window.message.error({ content: t('message.error.invalid.webdav'), key: 'webdav-error' })
      return
    }
    setBackuping(true)
    await backupToWebdav()
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
  const onToggleAutoSync = (checked: boolean) => {
    dispatch(setWebdavAutoSync(checked))

    if (checked) {
      startAutoSync()
    } else {
      stopAutoSync()
    }
  }
  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    dispatch(_setWebdavSyncInterval(value))
  }

  return (
    <>
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
        <SettingRowTitle>{t('settings.data.webdav.autoSync')}</SettingRowTitle>
        <HStack gap="10px" alignItems="center">
          <Switch
            checked={autoSync}
            onChange={(checked) => {
              setAutoSync(checked)
              onToggleAutoSync(checked)
            }}
            disabled={!webdavHost}
          />
          <Select
            value={syncInterval}
            onChange={onSyncIntervalChange}
            disabled={!webdavHost || !autoSync}
            style={{ width: 120 }}>
            <Select.Option value={1}>1 {t('settings.data.webdav.minutes')}</Select.Option>
            <Select.Option value={5}>5 {t('settings.data.webdav.minutes')}</Select.Option>
            <Select.Option value={15}>15 {t('settings.data.webdav.minutes')}</Select.Option>
            <Select.Option value={30}>30 {t('settings.data.webdav.minutes')}</Select.Option>
            <Select.Option value={60}>60 {t('settings.data.webdav.minutes')}</Select.Option>
            <Select.Option value={120}>120 {t('settings.data.webdav.minutes')}</Select.Option>
          </Select>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
        <HStack gap="5px" justifyContent="space-between">
          {/* 添加 在线备份 在线还原 按钮 */}
          <Button onClick={onBackup} icon={<SaveOutlined />} loading={backuping}>
            {t('settings.data.webdav.backup.button')}
          </Button>
          <Button onClick={onRestore} icon={<FolderOpenOutlined />} loading={restoring}>
            {t('settings.data.webdav.restore.button')}
          </Button>
        </HStack>
      </SettingRow>
    </>
  )
}

export default WebDavSettings
