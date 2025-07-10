import Logger from '@renderer/config/logger'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { setNutstoreSyncState } from '@renderer/store/nutstore'
import { WebDavConfig } from '@renderer/types'
import { NUTSTORE_HOST } from '@shared/config/nutstore'
import dayjs from 'dayjs'
import { type CreateDirectoryOptions } from 'webdav'

import { getBackupData, handleData } from './BackupService'

function getNutstoreToken() {
  const nutstoreToken = store.getState().nutstore.nutstoreToken

  if (!nutstoreToken) {
    window.message.error({ content: i18n.t('message.error.invalid.nutstore_token'), key: 'nutstore' })
    return null
  }
  return nutstoreToken
}

async function createNutstoreConfig(nutstoreToken: string): Promise<WebDavConfig | null> {
  const result = await window.api.nutstore.decryptToken(nutstoreToken)
  if (!result) {
    Logger.log('[createNutstoreConfig] Invalid nutstore token')
    return null
  }

  const nutstorePath = store.getState().nutstore.nutstorePath

  const { username, access_token } = result
  return {
    webdavHost: NUTSTORE_HOST,
    webdavUser: username,
    webdavPass: access_token,
    webdavPath: nutstorePath
  }
}

export async function checkConnection() {
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    return false
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return false
  }

  const isSuccess = await window.api.backup.checkWebdavConnection({
    ...config,
    webdavPath: '/'
  })

  return isSuccess
}

let autoSyncStarted = false
let syncTimeout: NodeJS.Timeout | null = null
let isAutoBackupRunning = false
let isManualBackupRunning = false

export async function backupToNutstore({
  showMessage = false,
  customFileName = ''
}: {
  showMessage?: boolean
  customFileName?: string
} = {}) {
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    return
  }

  if (isManualBackupRunning) {
    Logger.log('[backupToNutstore] Backup already in progress')
    return
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  let deviceType = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
  } catch (error) {
    Logger.error('[backupToNutstore] Failed to get device type:', error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`

  isManualBackupRunning = true

  store.dispatch(setNutstoreSyncState({ syncing: true, lastSyncError: null }))

  const backupData = await getBackupData()
  const skipBackupFile = store.getState().nutstore.nutstoreSkipBackupFile
  try {
    const isSuccess = await window.api.backup.backupToWebdav(backupData, {
      ...config,
      fileName: finalFileName,
      skipBackupFile: skipBackupFile
    })

    if (isSuccess) {
      store.dispatch(
        setNutstoreSyncState({
          lastSyncError: null
        })
      )
      showMessage && window.message.success({ content: i18n.t('message.backup.success'), key: 'backup' })
    } else {
      store.dispatch(setNutstoreSyncState({ lastSyncError: 'Backup failed' }))
      window.message.error({ content: i18n.t('message.backup.failed'), key: 'backup' })
    }
  } catch (error) {
    store.dispatch(setNutstoreSyncState({ lastSyncError: 'Backup failed' }))
    console.error('[Nutstore] Backup failed:', error)
    window.message.error({ content: i18n.t('message.backup.failed'), key: 'backup' })
  } finally {
    store.dispatch(setNutstoreSyncState({ lastSyncTime: Date.now(), syncing: false }))
    isManualBackupRunning = false
  }
}

export async function restoreFromNutstore(fileName?: string) {
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    return
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  let data = ''

  try {
    data = await window.api.backup.restoreFromWebdav({ ...config, fileName })
  } catch (error: any) {
    console.error('[backup] restoreFromWebdav: Error downloading file from WebDAV:', error)
    window.modal.error({
      title: i18n.t('message.restore.failed'),
      content: error.message
    })
  }

  try {
    await handleData(JSON.parse(data))
  } catch (error) {
    console.error('[backup] Error downloading file from WebDAV:', error)
    window.message.error({ content: i18n.t('error.backup.file_format'), key: 'restore' })
  }
}

export async function startNutstoreAutoSync() {
  if (autoSyncStarted) {
    return
  }

  const nutstoreToken = getNutstoreToken()

  if (!nutstoreToken) {
    Logger.log('[startNutstoreAutoSync] Invalid nutstore token, nutstore auto sync disabled')
    return
  }

  autoSyncStarted = true

  stopNutstoreAutoSync()

  scheduleNextBackup()

  function scheduleNextBackup() {
    if (syncTimeout) {
      clearTimeout(syncTimeout)
      syncTimeout = null
    }

    const { nutstoreSyncInterval, nutstoreSyncState } = store.getState().nutstore

    if (nutstoreSyncInterval <= 0) {
      Logger.log('[Nutstore AutoSync] Invalid sync interval, nutstore auto sync disabled')
      stopNutstoreAutoSync()
      return
    }

    // 用户指定的自动备份时间间隔（毫秒）
    const requiredInterval = nutstoreSyncInterval * 60 * 1000

    // 如果存在最后一次同步WebDAV的时间，以它为参考计算下一次同步的时间
    const timeUntilNextSync = nutstoreSyncState?.lastSyncTime
      ? Math.max(1000, nutstoreSyncState.lastSyncTime + requiredInterval - Date.now())
      : requiredInterval

    syncTimeout = setTimeout(performAutoBackup, timeUntilNextSync)

    Logger.log(
      `[Nutstore AutoSync] Next sync scheduled in ${Math.floor(timeUntilNextSync / 1000 / 60)} minutes ${Math.floor(
        (timeUntilNextSync / 1000) % 60
      )} seconds`
    )
  }

  async function performAutoBackup() {
    if (isAutoBackupRunning || isManualBackupRunning) {
      Logger.log('[Nutstore AutoSync] Backup already in progress, rescheduling')
      scheduleNextBackup()
      return
    }

    isAutoBackupRunning = true
    try {
      Logger.log('[Nutstore AutoSync] Starting auto backup...')
      await backupToNutstore({ showMessage: false })
    } catch (error) {
      Logger.error('[Nutstore AutoSync] Auto backup failed:', error)
    } finally {
      isAutoBackupRunning = false
      scheduleNextBackup()
    }
  }
}

export function stopNutstoreAutoSync() {
  if (syncTimeout) {
    Logger.log('[Nutstore AutoSync] Stopping nutstore auto sync')
    clearTimeout(syncTimeout)
    syncTimeout = null
  }
  isAutoBackupRunning = false
  autoSyncStarted = false
}

export async function createDirectory(path: string, options?: CreateDirectoryOptions) {
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    return
  }
  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  await window.api.backup.createDirectory(config, path, options)
}
