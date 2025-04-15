import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { setWebDAVSyncState } from '@renderer/store/backup'
import dayjs from 'dayjs'
import Logger from 'electron-log'

export async function backup() {
  const filename = `cherry-studio.${dayjs().format('YYYYMMDDHHmm')}.zip`
  const fileContnet = await getBackupData()
  const selectFolder = await window.api.file.selectFolder()
  if (selectFolder) {
    await window.api.backup.backup(filename, fileContnet, selectFolder)
    window.message.success({ content: i18n.t('message.backup.success'), key: 'backup' })
  }
}

export async function restore() {
  const file = await window.api.file.open({ filters: [{ name: '备份文件', extensions: ['bak', 'zip'] }] })

  if (file) {
    try {
      let data: Record<string, any> = {}

      // zip backup file
      if (file?.fileName.endsWith('.zip')) {
        const restoreData = await window.api.backup.restore(file.filePath)
        data = JSON.parse(restoreData)
      } else {
        data = JSON.parse(await window.api.zip.decompress(file.content))
      }

      await handleData(data)
    } catch (error) {
      console.error(error)
      window.message.error({ content: i18n.t('error.backup.file_format'), key: 'restore' })
    }
  }
}

export async function reset() {
  window.modal.confirm({
    title: i18n.t('common.warning'),
    content: i18n.t('message.reset.confirm.content'),
    centered: true,
    onOk: async () => {
      window.modal.confirm({
        title: i18n.t('message.reset.double.confirm.title'),
        content: i18n.t('message.reset.double.confirm.content'),
        centered: true,
        onOk: async () => {
          await localStorage.clear()
          await clearDatabase()
          await window.api.file.clear()
          window.api.reload()
        }
      })
    }
  })
}

// 备份到 webdav
/**
 * @param autoBackupProcess
 * if call in auto backup process, not show any message, any error will be thrown
 */
export async function backupToWebdav({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: { showMessage?: boolean; customFileName?: string; autoBackupProcess?: boolean } = {}) {
  if (isManualBackupRunning) {
    Logger.log('[Backup] Manual backup already in progress')
    return
  }
  // force set showMessage to false when auto backup process
  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  store.dispatch(setWebDAVSyncState({ syncing: true, lastSyncError: null }))

  const { webdavHost, webdavUser, webdavPass, webdavPath } = store.getState().settings
  let deviceType = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
  } catch (error) {
    Logger.error('[Backup] Failed to get device type:', error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`
  const backupData = await getBackupData()

  // 上传文件
  try {
    const success = await window.api.backup.backupToWebdav(backupData, {
      webdavHost,
      webdavUser,
      webdavPass,
      webdavPath,
      fileName: finalFileName
    })
    if (success) {
      store.dispatch(
        setWebDAVSyncState({
          lastSyncError: null
        })
      )
      if (showMessage && !autoBackupProcess) {
        window.message.success({ content: i18n.t('message.backup.success'), key: 'backup' })
      }
    } else {
      // if auto backup process, throw error
      if (autoBackupProcess) {
        throw new Error(i18n.t('message.backup.failed'))
      }

      store.dispatch(setWebDAVSyncState({ lastSyncError: 'Backup failed' }))
      showMessage && window.message.error({ content: i18n.t('message.backup.failed'), key: 'backup' })
    }
  } catch (error: any) {
    // if auto backup process, throw error
    if (autoBackupProcess) {
      throw error
    }

    store.dispatch(setWebDAVSyncState({ lastSyncError: error.message }))
    console.error('[Backup] backupToWebdav: Error uploading file to WebDAV:', error)
    showMessage &&
      window.modal.error({
        title: i18n.t('message.backup.failed'),
        content: error.message
      })
    throw error
  } finally {
    if (!autoBackupProcess) {
      store.dispatch(
        setWebDAVSyncState({
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
    }
    isManualBackupRunning = false
  }
}

// 从 webdav 恢复
export async function restoreFromWebdav(fileName?: string) {
  const { webdavHost, webdavUser, webdavPass, webdavPath } = store.getState().settings
  let data = ''

  try {
    data = await window.api.backup.restoreFromWebdav({ webdavHost, webdavUser, webdavPass, webdavPath, fileName })
  } catch (error: any) {
    console.error('[Backup] restoreFromWebdav: Error downloading file from WebDAV:', error)
    window.modal.error({
      title: i18n.t('message.restore.failed'),
      content: error.message
    })
  }

  try {
    await handleData(JSON.parse(data))
  } catch (error) {
    console.error('[Backup] Error downloading file from WebDAV:', error)
    window.message.error({ content: i18n.t('error.backup.file_format'), key: 'restore' })
  }
}

let autoSyncStarted = false
let syncTimeout: NodeJS.Timeout | null = null
let isAutoBackupRunning = false
let isManualBackupRunning = false

export function startAutoSync(immediate = false) {
  if (autoSyncStarted) {
    return
  }

  const { webdavAutoSync, webdavHost } = store.getState().settings

  if (!webdavAutoSync || !webdavHost) {
    console.log('[AutoSync] Invalid sync settings, auto sync disabled')
    return
  }

  autoSyncStarted = true

  stopAutoSync()

  scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime')

  /**
   * @param type 'immediate' | 'fromLastSyncTime' | 'fromNow'
   *  'immediate', first backup right now
   *  'fromLastSyncTime', schedule next backup from last sync time
   *  'fromNow', schedule next backup from now
   */
  function scheduleNextBackup(type: 'immediate' | 'fromLastSyncTime' | 'fromNow' = 'fromLastSyncTime') {
    if (syncTimeout) {
      clearTimeout(syncTimeout)
      syncTimeout = null
    }

    const { webdavSyncInterval } = store.getState().settings
    const { webdavSync } = store.getState().backup

    if (webdavSyncInterval <= 0) {
      console.log('[AutoSync] Invalid sync interval, auto sync disabled')
      stopAutoSync()
      return
    }

    // 用户指定的自动备份时间间隔（毫秒）
    const requiredInterval = webdavSyncInterval * 60 * 1000

    let timeUntilNextSync = 1000 //also immediate
    switch (type) {
      case 'fromLastSyncTime': // 如果存在最后一次同步WebDAV的时间，以它为参考计算下一次同步的时间
        timeUntilNextSync = Math.max(1000, (webdavSync?.lastSyncTime || 0) + requiredInterval - Date.now())
        break
      case 'fromNow':
        timeUntilNextSync = requiredInterval
        break
    }

    syncTimeout = setTimeout(performAutoBackup, timeUntilNextSync)

    console.log(
      `[AutoSync] Next sync scheduled in ${Math.floor(timeUntilNextSync / 1000 / 60)} minutes ${Math.floor(
        (timeUntilNextSync / 1000) % 60
      )} seconds`
    )
  }

  async function performAutoBackup() {
    if (isAutoBackupRunning || isManualBackupRunning) {
      console.log('[AutoSync] Backup already in progress, rescheduling')
      scheduleNextBackup()
      return
    }

    isAutoBackupRunning = true
    const maxRetries = 4
    let retryCount = 0

    while (retryCount < maxRetries) {
      try {
        console.log(`[AutoSync] Starting auto backup... (attempt ${retryCount + 1}/${maxRetries})`)

        await backupToWebdav({ autoBackupProcess: true })

        store.dispatch(
          setWebDAVSyncState({
            lastSyncError: null,
            lastSyncTime: Date.now(),
            syncing: false
          })
        )

        isAutoBackupRunning = false
        scheduleNextBackup()

        break
      } catch (error: any) {
        retryCount++
        if (retryCount === maxRetries) {
          console.error('[AutoSync] Auto backup failed after all retries:', error)

          store.dispatch(
            setWebDAVSyncState({
              lastSyncError: 'Auto backup failed',
              lastSyncTime: Date.now(),
              syncing: false
            })
          )

          //only show 1 time error modal, and autoback stopped until user click ok
          await window.modal.error({
            title: i18n.t('message.backup.failed'),
            content: `[WebDAV Auto Backup] ${new Date().toLocaleString()} ` + error.message
          })

          scheduleNextBackup('fromNow')
          isAutoBackupRunning = false
        } else {
          //Exponential Backoff with Base 2： 7s、17s、37s
          const backoffDelay = Math.pow(2, retryCount - 1) * 10000 - 3000
          console.log(`[AutoSync] Failed, retry ${retryCount}/${maxRetries} after ${backoffDelay / 1000}s`)

          await new Promise((resolve) => setTimeout(resolve, backoffDelay))

          //in case auto backup is stopped by user
          if (!isAutoBackupRunning) {
            console.log('[AutoSync] retry cancelled by user, exit')
            break
          }
        }
      }
    }
  }
}

export function stopAutoSync() {
  if (syncTimeout) {
    console.log('[AutoSync] Stopping auto sync')
    clearTimeout(syncTimeout)
    syncTimeout = null
  }
  isAutoBackupRunning = false
  autoSyncStarted = false
}

export async function getBackupData() {
  return JSON.stringify({
    time: new Date().getTime(),
    version: 3,
    localStorage,
    indexedDB: await backupDatabase()
  })
}

/************************************* Backup Utils ************************************** */
export async function handleData(data: Record<string, any>) {
  if (data.version === 1) {
    await clearDatabase()

    for (const { key, value } of data.indexedDB) {
      if (key.startsWith('topic:')) {
        await db.table('topics').add({ id: value.id, messages: value.messages })
      }
      if (key === 'image://avatar') {
        await db.table('settings').add({ id: key, value })
      }
    }

    await localStorage.setItem('persist:cherry-studio', data.localStorage['persist:cherry-studio'])
    window.message.success({ content: i18n.t('message.restore.success'), key: 'restore' })
    setTimeout(() => window.api.reload(), 1000)
    return
  }

  if (data.version >= 2) {
    localStorage.setItem('persist:cherry-studio', data.localStorage['persist:cherry-studio'])
    await restoreDatabase(data.indexedDB)
    window.message.success({ content: i18n.t('message.restore.success'), key: 'restore' })
    setTimeout(() => window.api.reload(), 1000)
    return
  }

  window.message.error({ content: i18n.t('error.backup.file_format'), key: 'restore' })
}

async function backupDatabase() {
  const tables = db.tables
  const backup = {}

  for (const table of tables) {
    backup[table.name] = await table.toArray()
  }

  return backup
}

async function restoreDatabase(backup: Record<string, any>) {
  await db.transaction('rw', db.tables, async () => {
    for (const tableName in backup) {
      await db.table(tableName).clear()
      await db.table(tableName).bulkAdd(backup[tableName])
    }
  })
}

async function clearDatabase() {
  const storeNames = await db.tables.map((table) => table.name)

  await db.transaction('rw', db.tables, async () => {
    for (const storeName of storeNames) {
      await db[storeName].clear()
    }
  })
}
