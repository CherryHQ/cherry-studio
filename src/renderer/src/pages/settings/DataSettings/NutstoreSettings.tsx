import { CheckOutlined, FolderOutlined, LoadingOutlined, SyncOutlined } from '@ant-design/icons'
import { Button, RowFlex, Switch, WarnTooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import NutstorePathPopup from '@renderer/components/Popups/NutsorePathPopup'
import Selector from '@renderer/components/Selector'
import { WebdavBackupManager } from '@renderer/components/WebdavBackupManager'
import { useWebdavBackupModal, WebdavBackupModal } from '@renderer/components/WebdavModals'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useNutstoreSSO } from '@renderer/hooks/useNutstoreSSO'
import { useTimer } from '@renderer/hooks/useTimer'
import {
  backupToNutstore,
  checkConnection,
  createDirectory,
  restoreFromNutstore,
  startNutstoreAutoSync,
  stopNutstoreAutoSync
} from '@renderer/services/NutstoreService'
import { useAppSelector } from '@renderer/store'
import { modalConfirm } from '@renderer/utils'
import { NUTSTORE_HOST } from '@shared/config/nutstore'
import { Input, Typography } from 'antd'
import dayjs from 'dayjs'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type FileStat } from 'webdav'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const NutstoreSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { nutstoreSyncState } = useAppSelector((state) => state.nutstore)

  const [nutstoreAutoSync, setNutstoreAutoSync] = usePreference('data.backup.nutstore.auto_sync')
  const [nutstoreMaxBackups, setNutstoreMaxBackups] = usePreference('data.backup.nutstore.max_backups')
  const [nutstorePath, setNutstorePath] = usePreference('data.backup.nutstore.path')
  const [nutstoreSkipBackupFile, setNutstoreSkipBackupFile] = usePreference('data.backup.nutstore.skip_backup_file')
  const [nutstoreSyncInterval, setNutstoreSyncInterval] = usePreference('data.backup.nutstore.sync_interval')
  const [nutstoreToken, setNutstoreToken] = usePreference('data.backup.nutstore.token')

  const [nutstoreUsername, setNutstoreUsername] = useState<string | undefined>(undefined)
  const [nutstorePass, setNutstorePass] = useState<string | undefined>(undefined)
  // const [storagePath, setStoragePath] = useState<string | undefined>(nutstorePath)
  const [checkConnectionLoading, setCheckConnectionLoading] = useState(false)
  const [nsConnected, setNsConnected] = useState<boolean>(false)

  // const [syncInterval, setSyncInterval] = useState<number>(nutstoreSyncInterval)
  // const [nutSkipBackupFile, setNutSkipBackupFile] = useState<boolean>(nutstoreSkipBackupFile)

  const [backupManagerVisible, setBackupManagerVisible] = useState(false)

  const nutstoreSSOHandler = useNutstoreSSO()
  const { setTimeoutTimer } = useTimer()

  const handleClickNutstoreSSO = useCallback(async () => {
    const ssoUrl = await window.api.nutstore.getSSOUrl()
    window.open(ssoUrl, '_blank')
    const nutstoreToken = await nutstoreSSOHandler()

    setNutstoreToken(nutstoreToken)
  }, [nutstoreSSOHandler, setNutstoreToken])

  useEffect(() => {
    async function decryptTokenEffect() {
      if (nutstoreToken) {
        const decrypted = await window.api.nutstore.decryptToken(nutstoreToken)

        if (decrypted) {
          setNutstoreUsername(decrypted.username)
          setNutstorePass(decrypted.access_token)
          if (!nutstorePath) {
            setNutstorePath('/cherry-studio')
            // setStoragePath('/cherry-studio')
          }
        }
      }
    }
    decryptTokenEffect()
  }, [nutstoreToken, setNutstorePath, nutstorePath])

  const handleLayout = useCallback(async () => {
    const confirmedLogout = await modalConfirm({
      title: t('settings.data.nutstore.logout.title'),
      content: t('settings.data.nutstore.logout.content')
    })
    if (confirmedLogout) {
      setNutstoreToken('')
      setNutstorePath('')
      setNutstoreAutoSync(false)
      setNutstoreUsername('')
    }
  }, [setNutstorePath, setNutstoreToken, setNutstoreAutoSync, t])

  const handleCheckConnection = async () => {
    if (!nutstoreToken) return
    setCheckConnectionLoading(true)
    const isConnectedToNutstore = await checkConnection()

    window.toast[isConnectedToNutstore ? 'success' : 'error']({
      timeout: 2000,
      title: isConnectedToNutstore
        ? t('settings.data.nutstore.checkConnection.success')
        : t('settings.data.nutstore.checkConnection.fail')
    })

    setNsConnected(isConnectedToNutstore)
    setCheckConnectionLoading(false)

    setTimeoutTimer('handleCheckConnection', () => setNsConnected(false), 3000)
  }

  const { isModalVisible, handleBackup, handleCancel, backuping, customFileName, setCustomFileName, showBackupModal } =
    useWebdavBackupModal({
      backupMethod: backupToNutstore
    })

  const onSyncIntervalChange = async (value: number) => {
    await setNutstoreSyncInterval(value)
    if (value === 0) {
      await setNutstoreAutoSync(false)
      stopNutstoreAutoSync()
    } else {
      await setNutstoreAutoSync(true)
      startNutstoreAutoSync()
    }
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    setNutstoreSkipBackupFile(value)
  }

  const onMaxBackupsChange = (value: number) => {
    setNutstoreMaxBackups(value)
  }

  const handleClickPathChange = async () => {
    if (!nutstoreToken) {
      return
    }

    const result = await window.api.nutstore.decryptToken(nutstoreToken)

    if (!result) {
      return
    }

    const targetPath = await NutstorePathPopup.show({
      ls: async (target: string) => {
        const { username, access_token } = result
        const token = window.btoa(`${username}:${access_token}`)
        const items = await window.api.nutstore.getDirectoryContents(token, target)
        return items.map(fileStatToStatModel)
      },
      mkdirs: async (path) => {
        await createDirectory(path)
      }
    })

    if (!targetPath) {
      return
    }

    setNutstorePath(targetPath)
  }

  const renderSyncStatus = () => {
    if (!nutstoreToken) return null

    if (!nutstoreSyncState.lastSyncTime && !nutstoreSyncState.syncing && !nutstoreSyncState.lastSyncError) {
      return <span style={{ color: 'var(--text-secondary)' }}>{t('settings.data.webdav.noSync')}</span>
    }

    return (
      <RowFlex className="items-center gap-[5px]">
        {nutstoreSyncState.syncing && <SyncOutlined spin />}
        {!nutstoreSyncState.syncing && nutstoreSyncState.lastSyncError && (
          <WarnTooltip
            title={`${t('settings.data.webdav.syncError')}: ${nutstoreSyncState.lastSyncError}`}
            iconColor="red"
          />
        )}
        {nutstoreSyncState.lastSyncTime && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('settings.data.webdav.lastSync')}: {dayjs(nutstoreSyncState.lastSyncTime).format('HH:mm:ss')}
          </span>
        )}
      </RowFlex>
    )
  }

  const isLogin = nutstoreToken && nutstoreUsername

  const showBackupManager = () => {
    setBackupManagerVisible(true)
  }

  const closeBackupManager = () => {
    setBackupManagerVisible(false)
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.nutstore.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>
          {isLogin ? t('settings.data.nutstore.isLogin') : t('settings.data.nutstore.notLogin')}
        </SettingRowTitle>
        {isLogin ? (
          <RowFlex className="items-center justify-between gap-[5px]">
            <Button
              variant={nsConnected ? 'ghost' : 'solid'}
              color={nsConnected ? 'primary' : 'default'}
              onPress={handleCheckConnection}
              isLoading={checkConnectionLoading}>
              {checkConnectionLoading ? (
                <LoadingOutlined spin />
              ) : nsConnected ? (
                <CheckOutlined />
              ) : (
                t('settings.data.nutstore.checkConnection.name')
              )}
            </Button>
            <Button variant="solid" color="danger" onPress={handleLayout}>
              {t('settings.data.nutstore.logout.button')}
            </Button>
          </RowFlex>
        ) : (
          <Button onPress={handleClickNutstoreSSO}>{t('settings.data.nutstore.login.button')}</Button>
        )}
      </SettingRow>
      <SettingDivider />
      {isLogin && (
        <>
          <SettingRow>
            <SettingRowTitle>{t('settings.data.nutstore.username')}</SettingRowTitle>
            <Typography.Text style={{ color: 'var(--color-text-3)' }}>{nutstoreUsername}</Typography.Text>
          </SettingRow>

          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.nutstore.path.label')}</SettingRowTitle>
            <RowFlex className="justify-between gap-1">
              <Input
                placeholder={t('settings.data.nutstore.path.placeholder')}
                style={{ width: 250 }}
                value={nutstorePath}
                onChange={(e) => {
                  setNutstorePath(e.target.value)
                }}
              />
              <Button variant="solid" onPress={handleClickPathChange} startContent={<FolderOutlined />} isIconOnly />
            </RowFlex>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
            <RowFlex className="justify-between gap-[5px]">
              <Button onPress={showBackupModal} isLoading={backuping}>
                {t('settings.data.nutstore.backup.button')}
              </Button>
              <Button onPress={showBackupManager} isDisabled={!nutstoreToken}>
                {t('settings.data.nutstore.restore.button')}
              </Button>
            </RowFlex>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.webdav.autoSync.label')}</SettingRowTitle>
            <Selector
              size={14}
              value={nutstoreSyncInterval}
              onChange={onSyncIntervalChange}
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
          {nutstoreAutoSync && nutstoreSyncInterval > 0 && (
            <>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>{t('settings.data.webdav.syncStatus')}</SettingRowTitle>
                {renderSyncStatus()}
              </SettingRow>
            </>
          )}
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.webdav.maxBackups')}</SettingRowTitle>
            <Selector
              size={14}
              value={nutstoreMaxBackups}
              onChange={onMaxBackupsChange}
              disabled={!nutstoreToken}
              options={[
                { label: t('settings.data.local.maxBackups.unlimited'), value: 0 },
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
            <Switch isSelected={nutstoreSkipBackupFile} onValueChange={onSkipBackupFilesChange} />
          </SettingRow>
          <SettingRow>
            <SettingHelpText>{t('settings.data.backup.skip_file_data_help')}</SettingHelpText>
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
          customLabels={{
            modalTitle: t('settings.data.nutstore.backup.modal.title'),
            filenamePlaceholder: t('settings.data.nutstore.backup.modal.filename.placeholder')
          }}
        />

        <WebdavBackupManager
          visible={backupManagerVisible}
          onClose={closeBackupManager}
          webdavConfig={{
            webdavHost: NUTSTORE_HOST,
            webdavUser: nutstoreUsername,
            webdavPass: nutstorePass,
            webdavPath: nutstorePath
          }}
          restoreMethod={restoreFromNutstore}
          customLabels={{
            restoreConfirmTitle: t('settings.data.nutstore.restore.confirm.title'),
            restoreConfirmContent: t('settings.data.nutstore.restore.confirm.content'),
            invalidConfigMessage: t('message.error.invalid.nutstore')
          }}
        />
      </>
    </SettingGroup>
  )
}

export interface StatModel {
  path: string
  basename: string
  isDir: boolean
  isDeleted: boolean
  mtime: number
  size: number
}

function fileStatToStatModel(from: FileStat): StatModel {
  return {
    path: from.filename,
    basename: from.basename,
    isDir: from.type === 'directory',
    isDeleted: false,
    mtime: new Date(from.lastmod).valueOf(),
    size: from.size
  }
}

export default NutstoreSettings
