import { CheckOutlined, FolderOutlined, LoadingOutlined, SyncOutlined, WarningOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import NutstorePathPopup from '@renderer/components/Popups/NutsorePathPopup'
import Selector from '@renderer/components/Selector'
import { WebdavBackupManager } from '@renderer/components/WebdavBackupManager'
import { useWebdavBackupModal, WebdavBackupModal } from '@renderer/components/WebdavModals'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useNutstoreSSO } from '@renderer/hooks/useNutstoreSSO'
import {
  backupToNutstore,
  checkConnection,
  createDirectory,
  restoreFromNutstore,
  startNutstoreAutoSync,
  stopNutstoreAutoSync
} from '@renderer/services/NutstoreService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setNutstoreAutoSync,
  setNutstorePath,
  setNutstoreSkipBackupFile,
  setNutstoreSyncInterval,
  setNutstoreToken
} from '@renderer/store/nutstore'
import { modalConfirm } from '@renderer/utils'
import { NUTSTORE_HOST } from '@shared/config/nutstore'
import { Button, Input, Switch, Tooltip, Typography } from 'antd'
import dayjs from 'dayjs'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type FileStat } from 'webdav'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const NutstoreSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const {
    nutstoreToken,
    nutstorePath,
    nutstoreSyncInterval,
    nutstoreAutoSync,
    nutstoreSyncState,
    nutstoreSkipBackupFile
  } = useAppSelector((state) => state.nutstore)

  const dispatch = useAppDispatch()

  const [nutstoreUsername, setNutstoreUsername] = useState<string | undefined>(undefined)
  const [nutstorePass, setNutstorePass] = useState<string | undefined>(undefined)
  const [storagePath, setStoragePath] = useState<string | undefined>(nutstorePath)

  const [checkConnectionLoading, setCheckConnectionLoading] = useState(false)
  const [nsConnected, setNsConnected] = useState<boolean>(false)

  const [syncInterval, setSyncInterval] = useState<number>(nutstoreSyncInterval)

  const [nutSkipBackupFile, setNutSkipBackupFile] = useState<boolean>(nutstoreSkipBackupFile)

  const nutstoreSSOHandler = useNutstoreSSO()

  const [backupManagerVisible, setBackupManagerVisible] = useState(false)

  const handleClickNutstoreSSO = useCallback(async () => {
    const ssoUrl = await window.api.nutstore.getSSOUrl()
    window.open(ssoUrl, '_blank')
    const nutstoreToken = await nutstoreSSOHandler()

    dispatch(setNutstoreToken(nutstoreToken))
  }, [dispatch, nutstoreSSOHandler])

  useEffect(() => {
    async function decryptTokenEffect() {
      if (nutstoreToken) {
        const decrypted = await window.api.nutstore.decryptToken(nutstoreToken)

        if (decrypted) {
          setNutstoreUsername(decrypted.username)
          setNutstorePass(decrypted.access_token)
          if (!nutstorePath) {
            dispatch(setNutstorePath('/cherry-studio'))
            setStoragePath('/cherry-studio')
          }
        }
      }
    }
    decryptTokenEffect()
  }, [nutstoreToken, dispatch, nutstorePath])

  const handleLayout = useCallback(async () => {
    const confirmedLogout = await modalConfirm({
      title: t('settings.data.nutstore.logout.title'),
      content: t('settings.data.nutstore.logout.content')
    })
    if (confirmedLogout) {
      dispatch(setNutstoreToken(''))
      dispatch(setNutstorePath(''))
      dispatch(setNutstoreAutoSync(false))
      setNutstoreUsername('')
      setStoragePath(undefined)
    }
  }, [dispatch, t])

  const handleCheckConnection = async () => {
    if (!nutstoreToken) return
    setCheckConnectionLoading(true)
    const isConnectedToNutstore = await checkConnection()

    window.message[isConnectedToNutstore ? 'success' : 'error']({
      key: 'api-check',
      style: { marginTop: '3vh' },
      duration: 2,
      content: isConnectedToNutstore
        ? t('settings.data.nutstore.checkConnection.success')
        : t('settings.data.nutstore.checkConnection.fail')
    })

    setNsConnected(isConnectedToNutstore)
    setCheckConnectionLoading(false)

    setTimeout(() => setNsConnected(false), 3000)
  }

  const { isModalVisible, handleBackup, handleCancel, backuping, customFileName, setCustomFileName, showBackupModal } =
    useWebdavBackupModal({
      backupMethod: backupToNutstore
    })

  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    dispatch(setNutstoreSyncInterval(value))
    if (value === 0) {
      dispatch(setNutstoreAutoSync(false))
      stopNutstoreAutoSync()
    } else {
      dispatch(setNutstoreAutoSync(true))
      startNutstoreAutoSync()
    }
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    setNutSkipBackupFile(value)
    dispatch(setNutstoreSkipBackupFile(value))
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

    setStoragePath(targetPath)
    dispatch(setNutstorePath(targetPath))
  }

  const renderSyncStatus = () => {
    if (!nutstoreToken) return null

    if (!nutstoreSyncState.lastSyncTime && !nutstoreSyncState.syncing && !nutstoreSyncState.lastSyncError) {
      return <span style={{ color: 'var(--text-secondary)' }}>{t('settings.data.webdav.noSync')}</span>
    }

    return (
      <HStack gap="5px" alignItems="center">
        {nutstoreSyncState.syncing && <SyncOutlined spin />}
        {!nutstoreSyncState.syncing && nutstoreSyncState.lastSyncError && (
          <Tooltip title={`${t('settings.data.webdav.syncError')}: ${nutstoreSyncState.lastSyncError}`}>
            <WarningOutlined style={{ color: 'red' }} />
          </Tooltip>
        )}
        {nutstoreSyncState.lastSyncTime && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('settings.data.webdav.lastSync')}: {dayjs(nutstoreSyncState.lastSyncTime).format('HH:mm:ss')}
          </span>
        )}
      </HStack>
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
          <HStack gap="5px" justifyContent="space-between" alignItems="center">
            <Button
              type={nsConnected ? 'primary' : 'default'}
              ghost={nsConnected}
              onClick={handleCheckConnection}
              loading={checkConnectionLoading}>
              {checkConnectionLoading ? (
                <LoadingOutlined spin />
              ) : nsConnected ? (
                <CheckOutlined />
              ) : (
                t('settings.data.nutstore.checkConnection.name')
              )}
            </Button>
            <Button type="primary" danger onClick={handleLayout}>
              {t('settings.data.nutstore.logout.button')}
            </Button>
          </HStack>
        ) : (
          <Button onClick={handleClickNutstoreSSO}>{t('settings.data.nutstore.login.button')}</Button>
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
            <HStack gap="4px" justifyContent="space-between">
              <Input
                placeholder={t('settings.data.nutstore.path.placeholder')}
                style={{ width: 250 }}
                value={nutstorePath}
                onChange={(e) => {
                  setStoragePath(e.target.value)
                  dispatch(setNutstorePath(e.target.value))
                }}
              />
              <Button type="default" onClick={handleClickPathChange}>
                <FolderOutlined />
              </Button>
            </HStack>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
            <HStack gap="5px" justifyContent="space-between">
              <Button onClick={showBackupModal} loading={backuping}>
                {t('settings.data.nutstore.backup.button')}
              </Button>
              <Button onClick={showBackupManager} disabled={!nutstoreToken}>
                {t('settings.data.nutstore.restore.button')}
              </Button>
            </HStack>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.webdav.autoSync.label')}</SettingRowTitle>
            <Selector
              size={14}
              value={syncInterval}
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
          {nutstoreAutoSync && syncInterval > 0 && (
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
            <SettingRowTitle>{t('settings.data.backup.skip_file_data_title')}</SettingRowTitle>
            <Switch checked={nutSkipBackupFile} onChange={onSkipBackupFilesChange} />
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
        />

        <WebdavBackupManager
          visible={backupManagerVisible}
          onClose={closeBackupManager}
          webdavConfig={{
            webdavHost: NUTSTORE_HOST,
            webdavUser: nutstoreUsername,
            webdavPass: nutstorePass,
            webdavPath: storagePath
          }}
          restoreMethod={restoreFromNutstore}
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
