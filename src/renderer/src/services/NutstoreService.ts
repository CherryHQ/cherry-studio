import i18n from '@renderer/i18n'
import { decryptToken, NUTSTORE_HOST } from '@renderer/integration/nutstore'
import store from '@renderer/store'
import { setNutstoreSyncRuntime } from '@renderer/store/settings'
import { WebDavConfig } from '@renderer/types'
import { type CreateDirectoryOptions } from 'webdav'

import { getBackupData, handleData } from './BackupService'

function getNutstoreToken() {
  const nutstoreToken = store.getState().settings.nutstoreToken

  if (!nutstoreToken) {
    window.message.error({ content: i18n.t('error.invalid.nutstore_token'), key: 'nutstore' })
    return null
  }
  return nutstoreToken
}

async function createNutstoreConfig(nutstoreToken: string): Promise<WebDavConfig | null> {
  const result = await decryptToken(nutstoreToken)
  if (!result) {
    console.log('Invalid nutstore token')
    return null
  }

  const nutstorePath = store.getState().settings.nutstorePath

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

  const isSuccess = await window.api.backup.checkConnection({
    ...config,
    webdavPath: '/'
  })

  return isSuccess
}

let autoSyncStarted = false
let syncTimeout: NodeJS.Timeout | null = null
let isAutoBackupRunning = false
let isManualBackupRunning = false

export async function backupToNutstore(options: { showMessage?: boolean } = {}) {
  const nutstoreToken = getNutstoreToken()
  if (!nutstoreToken) {
    return
  }

  const { showMessage = false } = options
  if (isManualBackupRunning) {
    console.log('Backup already in progress')
    return
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  isManualBackupRunning = true

  store.dispatch(setNutstoreSyncRuntime({ syncing: true, lastSyncError: null }))

  const backupData = await getBackupData()

  try {
    const isSuccess = await window.api.backup.backupToWebdav(backupData, config)

    if (isSuccess) {
      store.dispatch(
        setNutstoreSyncRuntime({
          lastSyncTime: Date.now(),
          lastSyncError: null
        })
      )
      showMessage && window.message.success({ content: i18n.t('message.backup.success'), key: 'backup' })
    } else {
      store.dispatch(setNutstoreSyncRuntime({ lastSyncError: 'Backup failed' }))
      showMessage && window.message.error({ content: i18n.t('message.backup.failed'), key: 'backup' })
    }
  } catch (error) {
    console.error('Backup failed:', error)
    store.dispatch(setNutstoreSyncRuntime({ lastSyncError: 'Backup failed' }))
    showMessage && window.message.error({ content: i18n.t('message.backup.failed'), key: 'backup' })
  } finally {
    store.dispatch(setNutstoreSyncRuntime({ syncing: false }))
    isManualBackupRunning = false
  }
}

export async function restoreFromNutstore() {
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
    data = await window.api.backup.restoreFromWebdav(config)
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
    window.message.error({ content: i18n.t('error.invalid.nutstore_token'), key: 'nutstore' })
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

    const { nutstoreSyncInterval } = store.getState().settings

    if (nutstoreSyncInterval <= 0) {
      console.log('[Nutstore AutoSync] Invalid sync interval, nutstore auto sync disabled')
      stopNutstoreAutoSync()
      return
    }

    syncTimeout = setTimeout(performAutoBackup, nutstoreSyncInterval * 60 * 1000)

    console.log(`[Nutstore AutoSync] Next sync scheduled in ${nutstoreSyncInterval} minutes`)
  }

  async function performAutoBackup() {
    if (isAutoBackupRunning || isManualBackupRunning) {
      console.log('[Nutstore AutoSync] Backup already in progress, rescheduling')
      scheduleNextBackup()
      return
    }

    isAutoBackupRunning = true
    try {
      console.log('[Nutstore AutoSync] Performing auto backup...')
      await backupToNutstore({ showMessage: false })
    } catch (error) {
      console.error('[Nutstore AutoSync] Auto backup failed:', error)
    } finally {
      isAutoBackupRunning = false
      scheduleNextBackup()
    }
  }
}

export function stopNutstoreAutoSync() {
  if (syncTimeout) {
    console.log('[Nutstore AutoSync] Stopping nutstore auto sync')
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
