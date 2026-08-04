/**
 * @deprecated v2 replacement pending. The retained v1 engine currently creates real compatibility
 * archives containing Data, IndexedDB, Local Storage, and cache.json.
 */
//TODO Data Refactor
// The code is messy, need to refactor all the backup related code

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { getLocalizedBackupErrorMessage } from '@renderer/utils/backup'
import { uuid } from '@renderer/utils/uuid'
import type { AutoBackupType } from '@shared/types/backup'
import dayjs from 'dayjs'

import { notificationService } from './notification'

const logger = loggerService.withContext('BackupService')

export interface RemoteSyncState {
  lastSyncTime: number | null
  syncing: boolean
  lastSyncError: string | null
}

let backupSyncState: Record<AutoBackupType, RemoteSyncState> = {
  webdav: { lastSyncTime: null, syncing: false, lastSyncError: null },
  s3: { lastSyncTime: null, syncing: false, lastSyncError: null },
  local: { lastSyncTime: null, syncing: false, lastSyncError: null },
  nutstore: { lastSyncTime: null, syncing: false, lastSyncError: null }
}
const backupSyncListeners = new Set<() => void>()

export const getBackupSyncState = () => backupSyncState
export const subscribeBackupSyncState = (listener: () => void) => {
  backupSyncListeners.add(listener)
  return () => backupSyncListeners.delete(listener)
}

export const setBackupSyncState = (type: AutoBackupType, patch: Partial<RemoteSyncState>) => {
  backupSyncState = { ...backupSyncState, [type]: { ...backupSyncState[type], ...patch } }
  backupSyncListeners.forEach((listener) => listener())
}

const setWebDAVSyncState = (patch: Partial<RemoteSyncState>) => setBackupSyncState('webdav', patch)
const setS3SyncState = (patch: Partial<RemoteSyncState>) => setBackupSyncState('s3', patch)
const setLocalBackupSyncState = (patch: Partial<RemoteSyncState>) => setBackupSyncState('local', patch)

export async function backup(skipBackupFile = false) {
  const filename = `cherry-studio.${dayjs().format('YYYYMMDDHHmm')}.zip`
  const selectFolder = await window.api.file.selectFolder()
  if (selectFolder) {
    // Use the direct compatibility archive with the selected full or slim resource set.
    await window.api.backup.backup(filename, selectFolder, skipBackupFile)
    toast.success(i18n.t('message.backup.success'))
  }
}

export async function restore() {
  // notificationService is imported as a module-level singleton
  const file = await window.api.file.open({ filters: [{ name: '备份文件', extensions: ['zip'] }] })

  if (file) {
    try {
      await window.api.backup.restore(file.filePath)

      void notificationService.send({
        id: uuid(),
        type: 'success',
        title: i18n.t('common.success'),
        message: i18n.t('message.restore.success'),
        silent: false,
        timestamp: Date.now(),
        source: 'backup'
      })
      // The main process has committed the restore journal and will relaunch.
      return
    } catch (error) {
      logger.error('restore: Error restoring backup file:', error as Error)
      void popup.error({
        title: i18n.t('error.backup.file_format'),
        content: getLocalizedBackupErrorMessage(error, 'error.backup.file_format'),
        centered: true
      })
    }
  }
}

// 备份到 webdav
/**
 * @param showMessage
 * @param customFileName
 * @param autoBackupProcess
 * if call in auto backup process, not show any message, any error will be thrown
 */
export async function backupToWebdav({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  // notificationService is imported as a module-level singleton
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }
  // force set showMessage to false when auto backup process
  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  setWebDAVSyncState({ syncing: true, lastSyncError: null })

  const {
    webdavHost,
    webdavUser,
    webdavPass,
    webdavPath,
    webdavMaxBackups,
    webdavSkipBackupFile,
    webdavDisableStream
  } = await preferenceService.getMultiple({
    webdavHost: 'data.backup.webdav.host',
    webdavUser: 'data.backup.webdav.user',
    webdavPass: 'data.backup.webdav.pass',
    webdavPath: 'data.backup.webdav.path',
    webdavMaxBackups: 'data.backup.webdav.max_backups',
    webdavSkipBackupFile: 'data.backup.webdav.skip_backup_file',
    webdavDisableStream: 'data.backup.webdav.disable_stream'
  })

  const finalFileName = customFileName
    ? customFileName.endsWith('.zip')
      ? customFileName
      : `${customFileName}.zip`
    : undefined

  // 上传文件 - Use direct backup method (copy IndexedDB/LocalStorage directories)
  try {
    const { result: success, cleanupFailed } = await window.api.backup.backupToWebdav({
      webdavHost,
      webdavUser,
      webdavPass,
      webdavPath,
      fileName: finalFileName,
      maxBackups: webdavMaxBackups,
      skipBackupFile: webdavSkipBackupFile,
      disableStream: webdavDisableStream
    })
    if (success) {
      if (cleanupFailed) {
        const message = i18n.t('message.backup.cleanup_failed')
        setWebDAVSyncState({ lastSyncError: message })
        showMessage && toast.warning(message)
      } else {
        setWebDAVSyncState({ lastSyncError: null })
        void notificationService.send({
          id: uuid(),
          type: 'success',
          title: i18n.t('common.success'),
          message: i18n.t('message.backup.success'),
          silent: false,
          timestamp: Date.now(),
          source: 'backup'
        })
        showMessage && toast.success(i18n.t('message.backup.success'))
      }
    } else {
      const message = i18n.t('message.backup.failed')
      // if auto backup process, throw error
      if (autoBackupProcess) {
        throw new Error(message)
      }

      setWebDAVSyncState({ lastSyncError: message })
      showMessage && toast.error(message)
    }
  } catch (error: any) {
    // if auto backup process, throw error
    if (autoBackupProcess) {
      throw error
    }
    const message = getLocalizedBackupErrorMessage(error)
    void notificationService.send({
      id: uuid(),
      type: 'error',
      title: i18n.t('message.backup.failed'),
      message,
      silent: false,
      timestamp: Date.now(),
      source: 'backup'
    })
    setWebDAVSyncState({ lastSyncError: message })
    showMessage && toast.error(message)
    logger.error('[Backup] backupToWebdav: Error uploading file to WebDAV:', error)
  } finally {
    if (!autoBackupProcess) {
      setWebDAVSyncState({
        lastSyncTime: Date.now(),
        syncing: false
      })
    }
    isManualBackupRunning = false
  }
}

// 从 webdav 恢复
export async function restoreFromWebdav(fileName?: string) {
  const { webdavHost, webdavUser, webdavPass, webdavPath } = await preferenceService.getMultiple({
    webdavHost: 'data.backup.webdav.host',
    webdavUser: 'data.backup.webdav.user',
    webdavPass: 'data.backup.webdav.pass',
    webdavPath: 'data.backup.webdav.path'
  })
  try {
    await window.api.backup.restoreFromWebdav({ webdavHost, webdavUser, webdavPass, webdavPath, fileName })
    logger.info('[WebDAVBackup] Backup restore staged, app will restart')
  } catch (error) {
    logger.error('[Backup] restoreFromWebdav: Error downloading file from WebDAV:', error as Error)
    throw error
  }
}

export async function backupToS3({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  // notificationService is imported as a module-level singleton
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }

  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  setS3SyncState({ syncing: true, lastSyncError: null })

  const s3Config = await preferenceService.getMultiple({
    autoSync: 'data.backup.s3.auto_sync',
    accessKeyId: 'data.backup.s3.access_key_id',
    secretAccessKey: 'data.backup.s3.secret_access_key',
    endpoint: 'data.backup.s3.endpoint',
    bucket: 'data.backup.s3.bucket',
    region: 'data.backup.s3.region',
    root: 'data.backup.s3.root',
    maxBackups: 'data.backup.s3.max_backups',
    skipBackupFile: 'data.backup.s3.skip_backup_file',
    syncInterval: 'data.backup.s3.sync_interval'
  })
  const finalFileName = customFileName
    ? customFileName.endsWith('.zip')
      ? customFileName
      : `${customFileName}.zip`
    : undefined

  try {
    // Use the direct backup method with the configured full or slim resource set.
    const { result: success, cleanupFailed } = await window.api.backup.backupToS3({
      ...s3Config,
      fileName: finalFileName
    })

    if (success) {
      if (cleanupFailed) {
        const message = i18n.t('message.backup.cleanup_failed')
        setS3SyncState({ lastSyncError: message })
        showMessage && toast.warning(message)
      } else {
        setS3SyncState({ lastSyncError: null })
        void notificationService.send({
          id: uuid(),
          type: 'success',
          title: i18n.t('common.success'),
          message: i18n.t('message.backup.success'),
          silent: false,
          timestamp: Date.now(),
          source: 'backup'
        })
        showMessage && toast.success(i18n.t('message.backup.success'))
      }
    } else {
      const message = i18n.t('message.backup.failed')
      if (autoBackupProcess) {
        throw new Error(message)
      }

      setS3SyncState({ lastSyncError: message })
      showMessage && toast.error(message)
    }
  } catch (error: any) {
    if (autoBackupProcess) {
      throw error
    }
    const message = getLocalizedBackupErrorMessage(error)
    void notificationService.send({
      id: uuid(),
      type: 'error',
      title: i18n.t('message.backup.failed'),
      message,
      silent: false,
      timestamp: Date.now(),
      source: 'backup'
    })
    setS3SyncState({ lastSyncError: message })
    logger.error('backupToS3: Error uploading file to S3:', error)
    showMessage && toast.error(message)
  } finally {
    if (!autoBackupProcess) {
      setS3SyncState({
        lastSyncTime: Date.now(),
        syncing: false
      })
    }
    isManualBackupRunning = false
  }
}

// 从 S3 恢复
export async function restoreFromS3(fileName?: string) {
  const s3Config = await preferenceService.getMultiple({
    autoSync: 'data.backup.s3.auto_sync',
    accessKeyId: 'data.backup.s3.access_key_id',
    secretAccessKey: 'data.backup.s3.secret_access_key',
    endpoint: 'data.backup.s3.endpoint',
    bucket: 'data.backup.s3.bucket',
    region: 'data.backup.s3.region',
    root: 'data.backup.s3.root',
    maxBackups: 'data.backup.s3.max_backups',
    syncInterval: 'data.backup.s3.sync_interval'
  })

  if (!fileName) {
    const files = await window.api.backup.listS3Files(s3Config)
    if (files.length > 0) {
      fileName = files[0].fileName
    }
  }

  if (fileName) {
    await window.api.backup.restoreFromS3({
      ...s3Config,
      fileName
    })
    logger.info('[S3Backup] Backup restore staged, app will restart')
  }
}

let isManualBackupRunning = false

export const isBackupRunning = () => isManualBackupRunning

// Data producer for the export-to-phone file flow, consumed by main's
// LegacyBackupManager.createLanTransferBackup. The feature's UI is offline until
// the mobile side ships; kept with the rest of the dormant lan-transfer plumbing.
export async function getBackupData() {
  return JSON.stringify({
    time: new Date().getTime(),
    version: 5,
    localStorage
  })
}

/**
 * Backup to local directory
 */
export async function backupToLocal({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  // notificationService is imported as a module-level singleton
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }
  // force set showMessage to false when auto backup process
  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  setLocalBackupSyncState({ syncing: true, lastSyncError: null })

  const { localBackupDirSetting, localBackupMaxBackups, localBackupSkipBackupFile } =
    await preferenceService.getMultiple({
      localBackupDirSetting: 'data.backup.local.dir',
      localBackupMaxBackups: 'data.backup.local.max_backups',
      localBackupSkipBackupFile: 'data.backup.local.skip_backup_file'
    })
  const localBackupDir = await window.api.resolvePath(localBackupDirSetting)
  const finalFileName = customFileName
    ? customFileName.endsWith('.zip')
      ? customFileName
      : `${customFileName}.zip`
    : undefined

  try {
    // Use direct backup method (copy IndexedDB/LocalStorage directories)
    const { result, cleanupFailed } = await window.api.backup.backupToLocalDir(finalFileName, {
      localBackupDir,
      maxBackups: localBackupMaxBackups,
      skipBackupFile: localBackupSkipBackupFile
    })

    if (result) {
      if (cleanupFailed) {
        const message = i18n.t('message.backup.cleanup_failed')
        setLocalBackupSyncState({ lastSyncError: message })
        showMessage && toast.warning(message)
      } else {
        setLocalBackupSyncState({ lastSyncError: null })
      }

      if (showMessage && !cleanupFailed) {
        void notificationService.send({
          id: uuid(),
          type: 'success',
          title: i18n.t('common.success'),
          message: i18n.t('message.backup.success'),
          silent: false,
          timestamp: Date.now(),
          source: 'backup'
        })
      }
    } else {
      const message = i18n.t('message.backup.failed')
      if (autoBackupProcess) {
        throw new Error(message)
      }

      setLocalBackupSyncState({
        lastSyncError: message
      })

      if (showMessage) {
        void popup.error({
          title: message,
          content: message
        })
      }
    }

    return result
  } catch (error: any) {
    if (autoBackupProcess) {
      throw error
    }

    logger.error('[LocalBackup] Backup failed:', error)
    const message = getLocalizedBackupErrorMessage(error)

    setLocalBackupSyncState({
      lastSyncError: message
    })

    if (showMessage) {
      void popup.error({
        title: i18n.t('message.backup.failed'),
        content: message
      })
    }

    throw error
  } finally {
    if (!autoBackupProcess) {
      setLocalBackupSyncState({
        lastSyncTime: Date.now(),
        syncing: false
      })
    }
    isManualBackupRunning = false
  }
}

export async function restoreFromLocal(fileName: string) {
  try {
    const localBackupDirSetting = await preferenceService.get('data.backup.local.dir')
    const localBackupDir = await window.api.resolvePath(localBackupDirSetting)
    await window.api.backup.restoreFromLocalBackup(fileName, localBackupDir)
    logger.info('[LocalBackup] Backup restore staged, app will restart')

    return true
  } catch (error) {
    logger.error('[LocalBackup] Restore failed:', error as Error)
    throw error
  }
}
