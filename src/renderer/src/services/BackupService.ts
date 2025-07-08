import Logger from '@renderer/config/logger'
import db from '@renderer/databases'
import { upgradeToV7, upgradeToV8 } from '@renderer/databases/upgrades'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { setLocalBackupSyncState, setS3SyncState, setWebDAVSyncState } from '@renderer/store/backup'
import { S3Config, WebDavConfig } from '@renderer/types'
import { uuid } from '@renderer/utils'
import dayjs from 'dayjs'

import { NotificationService } from './NotificationService'

// 重试删除S3文件的辅助函数
async function deleteS3FileWithRetry(fileName: string, s3Config: S3Config, maxRetries = 3) {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await window.api.backup.deleteS3File(fileName, s3Config)
      Logger.log(`[Backup] Successfully deleted old backup file: ${fileName} (attempt ${attempt})`)
      return true
    } catch (error: any) {
      lastError = error
      Logger.warn(`[Backup] Delete attempt ${attempt}/${maxRetries} failed for ${fileName}:`, error.message)

      // 如果不是最后一次尝试，等待一段时间再重试
      if (attempt < maxRetries) {
        const delay = attempt * 1000 + Math.random() * 1000 // 1-2秒的随机延迟
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  Logger.error(`[Backup] Failed to delete old backup file after ${maxRetries} attempts: ${fileName}`, lastError)
  return false
}

// 重试删除WebDAV文件的辅助函数
async function deleteWebdavFileWithRetry(fileName: string, webdavConfig: WebDavConfig, maxRetries = 3) {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await window.api.backup.deleteWebdavFile(fileName, webdavConfig)
      Logger.log(`[Backup] Successfully deleted old backup file: ${fileName} (attempt ${attempt})`)
      return true
    } catch (error: any) {
      lastError = error
      Logger.warn(`[Backup] Delete attempt ${attempt}/${maxRetries} failed for ${fileName}:`, error.message)

      // 如果不是最后一次尝试，等待一段时间再重试
      if (attempt < maxRetries) {
        const delay = attempt * 1000 + Math.random() * 1000 // 1-2秒的随机延迟
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  Logger.error(`[Backup] Failed to delete old backup file after ${maxRetries} attempts: ${fileName}`, lastError)
  return false
}

export async function backup(skipBackupFile: boolean) {
  const filename = `cherry-studio.${dayjs().format('YYYYMMDDHHmm')}.zip`
  const fileContnet = await getBackupData()
  const selectFolder = await window.api.file.selectFolder()
  if (selectFolder) {
    await window.api.backup.backup(filename, fileContnet, selectFolder, skipBackupFile)
    window.message.success({ content: i18n.t('message.backup.success'), key: 'backup' })
  }
}

export async function restore() {
  const notificationService = NotificationService.getInstance()
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
      notificationService.send({
        id: uuid(),
        type: 'success',
        title: i18n.t('common.success'),
        message: i18n.t('message.restore.success'),
        silent: false,
        timestamp: Date.now(),
        source: 'backup'
      })
    } catch (error) {
      Logger.error('[Backup] restore: Error restoring backup file:', error)
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
  const notificationService = NotificationService.getInstance()
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

  const { webdavHost, webdavUser, webdavPass, webdavPath, webdavMaxBackups, webdavSkipBackupFile } =
    store.getState().settings
  let deviceType = 'unknown'
  let hostname = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
    hostname = (await window.api.system.getHostname()) || 'unknown'
  } catch (error) {
    Logger.error('[Backup] Failed to get device type or hostname:', error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${hostname}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`
  const backupData = await getBackupData()

  // 上传文件
  try {
    const success = await window.api.backup.backupToWebdav(backupData, {
      webdavHost,
      webdavUser,
      webdavPass,
      webdavPath,
      fileName: finalFileName,
      skipBackupFile: webdavSkipBackupFile
    })
    if (success) {
      store.dispatch(
        setWebDAVSyncState({
          lastSyncError: null
        })
      )
      notificationService.send({
        id: uuid(),
        type: 'success',
        title: i18n.t('common.success'),
        message: i18n.t('message.backup.success'),
        silent: false,
        timestamp: Date.now(),
        source: 'backup'
      })
      showMessage && window.message.success({ content: i18n.t('message.backup.success'), key: 'backup' })

      // 清理旧备份文件
      if (webdavMaxBackups > 0) {
        try {
          // 获取所有备份文件
          const files = await window.api.backup.listWebdavFiles({
            webdavHost,
            webdavUser,
            webdavPass,
            webdavPath
          })

          // 筛选当前设备的备份文件
          const currentDeviceFiles = files.filter((file) => {
            // 检查文件名是否包含当前设备的标识信息
            return file.fileName.includes(deviceType) && file.fileName.includes(hostname)
          })

          // 如果当前设备的备份文件数量超过最大保留数量，删除最旧的文件
          if (currentDeviceFiles.length > webdavMaxBackups) {
            // 文件已按修改时间降序排序，所以最旧的文件在末尾
            const filesToDelete = currentDeviceFiles.slice(webdavMaxBackups)

            Logger.log(`[Backup] Cleaning up ${filesToDelete.length} old backup files`)

            // 串行删除文件，避免并发请求导致的问题
            for (let i = 0; i < filesToDelete.length; i++) {
              const file = filesToDelete[i]
              await deleteWebdavFileWithRetry(file.fileName, {
                webdavHost,
                webdavUser,
                webdavPass,
                webdavPath
              })

              // 在删除操作之间添加短暂延迟，避免请求过于频繁
              if (i < filesToDelete.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500))
              }
            }
          }
        } catch (error) {
          Logger.error('[Backup] Failed to clean up old backup files:', error)
        }
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
    notificationService.send({
      id: uuid(),
      type: 'error',
      title: i18n.t('message.backup.failed'),
      message: error.message,
      silent: false,
      timestamp: Date.now(),
      source: 'backup'
    })
    store.dispatch(setWebDAVSyncState({ lastSyncError: error.message }))
    showMessage && window.message.error({ content: i18n.t('message.backup.failed'), key: 'backup' })
    console.error('[Backup] backupToWebdav: Error uploading file to WebDAV:', error)
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

export async function backupToS3({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: { showMessage?: boolean; customFileName?: string; autoBackupProcess?: boolean } = {}) {
  const notificationService = NotificationService.getInstance()
  if (isManualBackupRunning) {
    Logger.log('[Backup] Manual backup already in progress')
    return
  }

  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  store.dispatch(setS3SyncState({ syncing: true, lastSyncError: null }))

  const s3Config = store.getState().settings.s3
  let deviceType = 'unknown'
  let hostname = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
    hostname = (await window.api.system.getHostname()) || 'unknown'
  } catch (error) {
    Logger.error('[Backup] Failed to get device type or hostname:', error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${hostname}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`
  const backupData = await getBackupData()

  try {
    const success = await window.api.backup.backupToS3(backupData, {
      ...s3Config,
      fileName: finalFileName
    })

    if (success) {
      store.dispatch(
        setS3SyncState({
          lastSyncError: null,
          syncing: false,
          lastSyncTime: Date.now()
        })
      )
      notificationService.send({
        id: uuid(),
        type: 'success',
        title: i18n.t('common.success'),
        message: i18n.t('message.backup.success'),
        silent: false,
        timestamp: Date.now(),
        source: 'backup'
      })
      showMessage && window.message.success({ content: i18n.t('message.backup.success'), key: 'backup' })

      // 清理旧备份文件
      if (s3Config.maxBackups > 0) {
        try {
          // 获取所有备份文件
          const files = await window.api.backup.listS3Files(s3Config)

          // 筛选当前设备的备份文件
          const currentDeviceFiles = files.filter((file) => {
            return file.fileName.includes(deviceType) && file.fileName.includes(hostname)
          })

          // 如果当前设备的备份文件数量超过最大保留数量，删除最旧的文件
          if (currentDeviceFiles.length > s3Config.maxBackups) {
            const filesToDelete = currentDeviceFiles.slice(s3Config.maxBackups)

            Logger.log(`[Backup] Cleaning up ${filesToDelete.length} old backup files`)

            for (let i = 0; i < filesToDelete.length; i++) {
              const file = filesToDelete[i]
              await deleteS3FileWithRetry(file.fileName, s3Config)

              if (i < filesToDelete.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500))
              }
            }
          }
        } catch (error) {
          Logger.error('[Backup] Failed to clean up old backup files:', error)
        }
      }
    } else {
      if (autoBackupProcess) {
        throw new Error(i18n.t('message.backup.failed'))
      }

      store.dispatch(setS3SyncState({ lastSyncError: 'Backup failed' }))
      showMessage && window.message.error({ content: i18n.t('message.backup.failed'), key: 'backup' })
    }
  } catch (error: any) {
    if (autoBackupProcess) {
      throw error
    }
    notificationService.send({
      id: uuid(),
      type: 'error',
      title: i18n.t('message.backup.failed'),
      message: error.message,
      silent: false,
      timestamp: Date.now(),
      source: 'backup'
    })
    store.dispatch(setS3SyncState({ lastSyncError: error.message }))
    console.error('[Backup] backupToS3: Error uploading file to S3:', error)
    showMessage && window.message.error({ content: i18n.t('message.backup.failed'), key: 'backup' })
    throw error
  } finally {
    if (!autoBackupProcess) {
      store.dispatch(
        setS3SyncState({
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
    }
    isManualBackupRunning = false
  }
}

// 从 S3 恢复
export async function restoreFromS3(fileName?: string) {
  const s3Config = store.getState().settings.s3

  if (!fileName) {
    const files = await window.api.backup.listS3Files(s3Config)
    if (files.length > 0) {
      fileName = files[0].fileName
    }
  }

  if (fileName) {
    const restoreData = await window.api.backup.restoreFromS3({
      ...s3Config,
      fileName
    })
    const data = JSON.parse(restoreData)
    await handleData(data)
    store.dispatch(
      setS3SyncState({
        lastSyncTime: Date.now(),
        syncing: false,
        lastSyncError: null
      })
    )
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

  const settings = store.getState().settings
  const { webdavAutoSync, webdavHost } = settings
  const s3Settings = settings.s3

  const s3AutoSync = s3Settings?.autoSync
  const s3Endpoint = s3Settings?.endpoint

  const localBackupAutoSync = settings.localBackupAutoSync
  const localBackupDir = settings.localBackupDir

  // 检查WebDAV或S3自动同步配置
  const hasWebdavConfig = webdavAutoSync && webdavHost
  const hasS3Config = s3AutoSync && s3Endpoint
  const hasLocalConfig = localBackupAutoSync && localBackupDir

  if (!hasWebdavConfig && !hasS3Config && !hasLocalConfig) {
    Logger.log('[AutoSync] Invalid sync settings, auto sync disabled')
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

    const settings = store.getState().settings
    const _webdavSyncInterval = settings.webdavSyncInterval
    const _s3SyncInterval = settings.s3?.syncInterval
    const { webdavSync, s3Sync } = store.getState().backup

    // 使用当前激活的同步配置
    const syncInterval = hasWebdavConfig ? _webdavSyncInterval : _s3SyncInterval
    const lastSyncTime = hasWebdavConfig ? webdavSync?.lastSyncTime : s3Sync?.lastSyncTime

    if (!syncInterval || syncInterval <= 0) {
      Logger.log('[AutoSync] Invalid sync interval, auto sync disabled')
      stopAutoSync()
      return
    }

    // 用户指定的自动备份时间间隔（毫秒）
    const requiredInterval = syncInterval * 60 * 1000

    let timeUntilNextSync = 1000 //also immediate
    switch (type) {
      case 'fromLastSyncTime': // 如果存在最后一次同步的时间，以它为参考计算下一次同步的时间
        timeUntilNextSync = Math.max(1000, (lastSyncTime || 0) + requiredInterval - Date.now())
        break
      case 'fromNow':
        timeUntilNextSync = requiredInterval
        break
    }

    syncTimeout = setTimeout(performAutoBackup, timeUntilNextSync)

    const backupType = hasWebdavConfig ? 'WebDAV' : 'S3'
    Logger.log(
      `[AutoSync] Next ${backupType} sync scheduled in ${Math.floor(timeUntilNextSync / 1000 / 60)} minutes ${Math.floor(
        (timeUntilNextSync / 1000) % 60
      )} seconds`
    )
  }

  async function performAutoBackup() {
    if (isAutoBackupRunning || isManualBackupRunning) {
      Logger.log('[AutoSync] Backup already in progress, rescheduling')
      scheduleNextBackup()
      return
    }

    isAutoBackupRunning = true
    const maxRetries = 4
    let retryCount = 0

    while (retryCount < maxRetries) {
      try {
        const backupType = hasWebdavConfig ? 'WebDAV' : 'S3'
        Logger.log(`[AutoSync] Starting auto ${backupType} backup... (attempt ${retryCount + 1}/${maxRetries})`)

        if (hasWebdavConfig) {
          await backupToWebdav({ autoBackupProcess: true })
          store.dispatch(
            setWebDAVSyncState({
              lastSyncError: null,
              lastSyncTime: Date.now(),
              syncing: false
            })
          )
        } else if (hasS3Config) {
          await backupToS3({ autoBackupProcess: true })
          store.dispatch(
            setS3SyncState({
              lastSyncError: null,
              lastSyncTime: Date.now(),
              syncing: false
            })
          )
        }

        isAutoBackupRunning = false
        scheduleNextBackup()

        break
      } catch (error: any) {
        retryCount++
        if (retryCount === maxRetries) {
          const backupType = hasWebdavConfig ? 'WebDAV' : 'S3'
          Logger.error(`[AutoSync] Auto ${backupType} backup failed after all retries:`, error)

          if (hasWebdavConfig) {
            store.dispatch(
              setWebDAVSyncState({
                lastSyncError: 'Auto backup failed',
                lastSyncTime: Date.now(),
                syncing: false
              })
            )
          } else if (hasS3Config) {
            store.dispatch(
              setS3SyncState({
                lastSyncError: 'Auto backup failed',
                lastSyncTime: Date.now(),
                syncing: false
              })
            )
          }

          //only show 1 time error modal, and autoback stopped until user click ok
          await window.modal.error({
            title: i18n.t('message.backup.failed'),
            content: `[${backupType} Auto Backup] ${new Date().toLocaleString()} ` + error.message
          })

          scheduleNextBackup('fromNow')
          isAutoBackupRunning = false
        } else {
          //Exponential Backoff with Base 2： 7s、17s、37s
          const backoffDelay = Math.pow(2, retryCount - 1) * 10000 - 3000
          Logger.log(`[AutoSync] Failed, retry ${retryCount}/${maxRetries} after ${backoffDelay / 1000}s`)

          await new Promise((resolve) => setTimeout(resolve, backoffDelay))

          //in case auto backup is stopped by user
          if (!isAutoBackupRunning) {
            Logger.log('[AutoSync] retry cancelled by user, exit')
            break
          }
        }
      }
    }
  }
}

export function stopAutoSync() {
  if (syncTimeout) {
    Logger.log('[AutoSync] Stopping auto sync')
    clearTimeout(syncTimeout)
    syncTimeout = null
  }
  isAutoBackupRunning = false
  autoSyncStarted = false
}

export async function getBackupData() {
  return JSON.stringify({
    time: new Date().getTime(),
    version: 5,
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

    if (data.version === 3) {
      await db.transaction('rw', db.tables, async (tx) => {
        await db.table('message_blocks').clear()
        await upgradeToV7(tx)
      })
    }

    if (data.version === 4) {
      await db.transaction('rw', db.tables, async (tx) => {
        await upgradeToV8(tx)
      })
    }

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

/**
 * Backup to local directory
 */
export async function backupToLocalDir({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: { showMessage?: boolean; customFileName?: string; autoBackupProcess?: boolean } = {}) {
  const notificationService = NotificationService.getInstance()
  if (isManualBackupRunning) {
    Logger.log('[Backup] Manual backup already in progress')
    return
  }
  // force set showMessage to false when auto backup process
  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  store.dispatch(setLocalBackupSyncState({ syncing: true, lastSyncError: null }))

  const { localBackupDir, localBackupMaxBackups, localBackupSkipBackupFile } = store.getState().settings
  let deviceType = 'unknown'
  let hostname = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
    hostname = (await window.api.system.getHostname()) || 'unknown'
  } catch (error) {
    Logger.error('[Backup] Failed to get device type or hostname:', error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${hostname}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`
  const backupData = await getBackupData()

  try {
    const result = await window.api.backup.backupToLocalDir(backupData, finalFileName, {
      localBackupDir,
      skipBackupFile: localBackupSkipBackupFile
    })

    if (result) {
      store.dispatch(
        setLocalBackupSyncState({
          lastSyncError: null
        })
      )

      if (showMessage) {
        notificationService.send({
          id: uuid(),
          type: 'success',
          title: i18n.t('common.success'),
          message: i18n.t('message.backup.success'),
          silent: false,
          timestamp: Date.now(),
          source: 'backup'
        })
      }

      // Clean up old backups if maxBackups is set
      if (localBackupMaxBackups > 0) {
        try {
          // Get all backup files
          const files = await window.api.backup.listLocalBackupFiles(localBackupDir)

          // Filter backups for current device
          const currentDeviceFiles = files.filter((file) => {
            return file.fileName.includes(deviceType) && file.fileName.includes(hostname)
          })

          if (currentDeviceFiles.length > localBackupMaxBackups) {
            // Sort by modified time (oldest first)
            const filesToDelete = currentDeviceFiles
              .sort((a, b) => new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime())
              .slice(0, currentDeviceFiles.length - localBackupMaxBackups)

            // Delete older backups
            for (const file of filesToDelete) {
              Logger.log(`[LocalBackup] Deleting old backup: ${file.fileName}`)
              await window.api.backup.deleteLocalBackupFile(file.fileName, localBackupDir)
            }
          }
        } catch (error) {
          Logger.error('[LocalBackup] Failed to clean up old backups:', error)
        }
      }
    }

    return result
  } catch (error: any) {
    Logger.error('[LocalBackup] Backup failed:', error)

    store.dispatch(
      setLocalBackupSyncState({
        lastSyncError: error.message || 'Unknown error'
      })
    )

    if (showMessage) {
      window.modal.error({
        title: i18n.t('message.backup.failed'),
        content: error.message || 'Unknown error'
      })
    }

    throw error
  } finally {
    if (!autoBackupProcess) {
      store.dispatch(
        setLocalBackupSyncState({
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
    }
    isManualBackupRunning = false
  }
}

export async function restoreFromLocalBackup(fileName: string) {
  try {
    const { localBackupDir } = store.getState().settings
    await window.api.backup.restoreFromLocalBackup(fileName, localBackupDir)
    return true
  } catch (error) {
    Logger.error('[LocalBackup] Restore failed:', error)
    throw error
  }
}

// Local backup auto sync
let localBackupAutoSyncStarted = false
let localBackupSyncTimeout: NodeJS.Timeout | null = null
let isLocalBackupAutoRunning = false

export function startLocalBackupAutoSync(immediate = false) {
  if (localBackupAutoSyncStarted) {
    return
  }

  const { localBackupAutoSync, localBackupDir } = store.getState().settings

  if (!localBackupAutoSync || !localBackupDir) {
    Logger.log('[LocalBackupAutoSync] Invalid sync settings, auto sync disabled')
    return
  }

  localBackupAutoSyncStarted = true

  stopLocalBackupAutoSync()

  scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime')

  /**
   * @param type 'immediate' | 'fromLastSyncTime' | 'fromNow'
   *  'immediate', first backup right now
   *  'fromLastSyncTime', schedule next backup from last sync time
   *  'fromNow', schedule next backup from now
   */
  function scheduleNextBackup(type: 'immediate' | 'fromLastSyncTime' | 'fromNow' = 'fromLastSyncTime') {
    if (localBackupSyncTimeout) {
      clearTimeout(localBackupSyncTimeout)
      localBackupSyncTimeout = null
    }

    const { localBackupSyncInterval } = store.getState().settings
    const { localBackupSync } = store.getState().backup

    if (localBackupSyncInterval <= 0) {
      Logger.log('[LocalBackupAutoSync] Invalid sync interval, auto sync disabled')
      stopLocalBackupAutoSync()
      return
    }

    // User specified auto backup interval (milliseconds)
    const requiredInterval = localBackupSyncInterval * 60 * 1000

    let timeUntilNextSync = 1000 // immediate by default
    switch (type) {
      case 'fromLastSyncTime': // If last sync time exists, use it as reference
        timeUntilNextSync = Math.max(1000, (localBackupSync?.lastSyncTime || 0) + requiredInterval - Date.now())
        break
      case 'fromNow':
        timeUntilNextSync = requiredInterval
        break
    }

    localBackupSyncTimeout = setTimeout(performAutoBackup, timeUntilNextSync)

    Logger.log(
      `[LocalBackupAutoSync] Next sync scheduled in ${Math.floor(timeUntilNextSync / 1000 / 60)} minutes ${Math.floor(
        (timeUntilNextSync / 1000) % 60
      )} seconds`
    )
  }

  async function performAutoBackup() {
    if (isLocalBackupAutoRunning || isManualBackupRunning) {
      Logger.log('[LocalBackupAutoSync] Backup already in progress, rescheduling')
      scheduleNextBackup()
      return
    }

    isLocalBackupAutoRunning = true
    const maxRetries = 4
    let retryCount = 0

    while (retryCount < maxRetries) {
      try {
        Logger.log(`[LocalBackupAutoSync] Starting auto backup... (attempt ${retryCount + 1}/${maxRetries})`)

        await backupToLocalDir({ autoBackupProcess: true })

        store.dispatch(
          setLocalBackupSyncState({
            lastSyncError: null,
            lastSyncTime: Date.now(),
            syncing: false
          })
        )

        isLocalBackupAutoRunning = false
        scheduleNextBackup()

        break
      } catch (error: any) {
        retryCount++
        if (retryCount === maxRetries) {
          Logger.error('[LocalBackupAutoSync] Auto backup failed after all retries:', error)

          store.dispatch(
            setLocalBackupSyncState({
              lastSyncError: 'Auto backup failed',
              lastSyncTime: Date.now(),
              syncing: false
            })
          )

          // Only show error modal once and wait for user acknowledgment
          await window.modal.error({
            title: i18n.t('message.backup.failed'),
            content: `[Local Backup Auto Backup] ${new Date().toLocaleString()} ` + error.message
          })

          scheduleNextBackup('fromNow')
          isLocalBackupAutoRunning = false
        } else {
          // Exponential Backoff with Base 2: 7s, 17s, 37s
          const backoffDelay = Math.pow(2, retryCount - 1) * 10000 - 3000
          Logger.log(`[LocalBackupAutoSync] Failed, retry ${retryCount}/${maxRetries} after ${backoffDelay / 1000}s`)

          await new Promise((resolve) => setTimeout(resolve, backoffDelay))

          // Check if auto backup was stopped by user
          if (!isLocalBackupAutoRunning) {
            Logger.log('[LocalBackupAutoSync] retry cancelled by user, exit')
            break
          }
        }
      }
    }
  }
}

export function stopLocalBackupAutoSync() {
  if (localBackupSyncTimeout) {
    Logger.log('[LocalBackupAutoSync] Stopping auto sync')
    clearTimeout(localBackupSyncTimeout)
    localBackupSyncTimeout = null
  }
  isLocalBackupAutoRunning = false
  localBackupAutoSyncStarted = false
}
