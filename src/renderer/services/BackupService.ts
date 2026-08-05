/**
 * @deprecated v2 replacement pending. Only the auto-sync scheduling below is still
 * this module's: transport, naming and rotation now belong to main's BackupService
 * (`backupDestination`). Sync status stays session-local until the scheduler moves
 * to JobManager.
 */
//TODO Data Refactor
// The code is messy, need to refactor all the backup related code

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { popup } from '@renderer/services/popup'

import { type BackupDestinationId, backupToDestination } from './backupDestination'

const logger = loggerService.withContext('BackupService')

export interface RemoteSyncState {
  lastSyncTime: number | null
  syncing: boolean
  lastSyncError: string | null
}

export interface BackupOptions {
  showMessage?: boolean
  /** A name the user typed; absent means main's generated, rotation-eligible name. */
  customFileName?: string
  /** Set by the scheduler: no toasts, and failures throw so its retry can see them. */
  autoBackupProcess?: boolean
}

// Session-local sync status, replaced (not mutated) on every write so
// `useSyncExternalStore` sees a new identity. Lives here until the scheduler
// moves to JobManager and the status becomes durable.
let backupSyncState: Record<BackupDestinationId, RemoteSyncState> = {
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

export const setBackupSyncState = (type: BackupDestinationId, patch: Partial<RemoteSyncState>) => {
  backupSyncState = { ...backupSyncState, [type]: { ...backupSyncState[type], ...patch } }
  backupSyncListeners.forEach((listener) => listener())
}

const setWebDAVSyncState = (patch: Partial<RemoteSyncState>) => setBackupSyncState('webdav', patch)
const setS3SyncState = (patch: Partial<RemoteSyncState>) => setBackupSyncState('s3', patch)
const setLocalBackupSyncState = (patch: Partial<RemoteSyncState>) => setBackupSyncState('local', patch)

/** One backup at a time, whichever destination asked for it. */
let isManualBackupRunning = false

/**
 * Back up to a cloud destination.
 *
 * The archive, its name, the upload and the pruning of old backups are all
 * main's now — see `backupDestination`. What stays here is the session-local
 * sync status the settings pages read back, which the auto-sync scheduler below
 * is the only real writer of.
 */
async function backupToRemote(
  destination: BackupDestinationId,
  setState: (patch: Partial<RemoteSyncState>) => void,
  {
    showMessage = false,
    customFileName = '',
    autoBackupProcess = false
  }: { showMessage?: boolean; customFileName?: string; autoBackupProcess?: boolean } = {}
): Promise<void> {
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }

  isManualBackupRunning = true
  setState({ syncing: true, lastSyncError: null })
  try {
    const succeeded = await backupToDestination(destination, {
      showMessage: showMessage && !autoBackupProcess,
      ...(customFileName ? { name: customFileName } : {})
    })
    if (!succeeded) {
      setState({ lastSyncError: 'Backup failed' })
      // The scheduler counts on a throw to drive its retry and backoff.
      if (autoBackupProcess) throw new Error(i18n.t('message.backup.failed'))
      return
    }
    setState({ lastSyncError: null })
  } finally {
    setState({ lastSyncTime: Date.now(), syncing: false })
    isManualBackupRunning = false
  }
}

export async function backupToWebdav(options: BackupOptions = {}) {
  return backupToRemote('webdav', setWebDAVSyncState, options)
}

export async function backupToS3(options: BackupOptions = {}) {
  return backupToRemote('s3', setS3SyncState, options)
}

// 为每种备份类型维护独立的状态
let webdavAutoSyncStarted = false
let webdavSyncTimeout: NodeJS.Timeout | null = null
let isWebdavAutoBackupRunning = false

let s3AutoSyncStarted = false
let s3SyncTimeout: NodeJS.Timeout | null = null
let isS3AutoBackupRunning = false

let localAutoSyncStarted = false
let localSyncTimeout: NodeJS.Timeout | null = null
let isLocalAutoBackupRunning = false

type BackupType = 'webdav' | 's3' | 'local'

export async function startAutoSync(immediate = false, type?: BackupType) {
  // 如果没有指定类型，启动所有配置的自动同步
  if (!type) {
    const { webdavAutoSync, webdavHost, localBackupAutoSync, localBackupDir } = await preferenceService.getMultiple({
      webdavAutoSync: 'data.backup.webdav.auto_sync',
      webdavHost: 'data.backup.webdav.host',
      localBackupAutoSync: 'data.backup.local.auto_sync',
      localBackupDir: 'data.backup.local.dir'
    })
    const s3Settings = await preferenceService.getMultiple({
      autoSync: 'data.backup.s3.auto_sync',
      endpoint: 'data.backup.s3.endpoint',
      bucket: 'data.backup.s3.bucket',
      region: 'data.backup.s3.region',
      root: 'data.backup.s3.root'
    })

    if (webdavAutoSync && webdavHost) {
      void startAutoSync(immediate, 'webdav')
    }
    if (s3Settings?.autoSync && s3Settings?.endpoint) {
      void startAutoSync(immediate, 's3')
    }
    if (localBackupAutoSync && localBackupDir) {
      void startAutoSync(immediate, 'local')
    }
    return
  }

  // 根据类型启动特定的自动同步
  if (type === 'webdav') {
    if (webdavAutoSyncStarted) {
      return
    }

    const { webdavAutoSync, webdavHost } = await preferenceService.getMultiple({
      webdavAutoSync: 'data.backup.webdav.auto_sync',
      webdavHost: 'data.backup.webdav.host'
    })

    if (!webdavAutoSync || !webdavHost) {
      logger.info('[WebdavAutoSync] Invalid sync settings, auto sync disabled')
      return
    }

    webdavAutoSyncStarted = true
    stopAutoSync('webdav')
    void scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime', 'webdav')
  } else if (type === 's3') {
    if (s3AutoSyncStarted) {
      return
    }

    const s3Settings = await preferenceService.getMultiple({
      autoSync: 'data.backup.s3.auto_sync',
      endpoint: 'data.backup.s3.endpoint'
    })

    if (!s3Settings?.autoSync || !s3Settings?.endpoint) {
      logger.verbose('Invalid sync settings, auto sync disabled')
      return
    }

    s3AutoSyncStarted = true
    stopAutoSync('s3')
    void scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime', 's3')
  } else if (type === 'local') {
    if (localAutoSyncStarted) {
      return
    }

    const { localBackupAutoSync, localBackupDir } = await preferenceService.getMultiple({
      localBackupAutoSync: 'data.backup.local.auto_sync',
      localBackupDir: 'data.backup.local.dir'
    })

    if (!localBackupAutoSync || !localBackupDir) {
      logger.verbose('Invalid sync settings, auto sync disabled')
      return
    }

    localAutoSyncStarted = true
    stopAutoSync('local')
    void scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime', 'local')
  }

  async function scheduleNextBackup(
    scheduleType: 'immediate' | 'fromLastSyncTime' | 'fromNow',
    backupType: BackupType
  ) {
    let syncInterval: number
    let lastSyncTime: number | undefined
    let logPrefix: string

    // 根据备份类型获取相应的配置和状态
    const backup = getBackupSyncState()

    if (backupType === 'webdav') {
      if (webdavSyncTimeout) {
        clearTimeout(webdavSyncTimeout)
        webdavSyncTimeout = null
      }
      syncInterval = await preferenceService.get('data.backup.webdav.sync_interval')
      lastSyncTime = backup.webdav?.lastSyncTime || undefined
      logPrefix = '[WebdavAutoSync]'
    } else if (backupType === 's3') {
      if (s3SyncTimeout) {
        clearTimeout(s3SyncTimeout)
        s3SyncTimeout = null
      }
      syncInterval = await preferenceService.get('data.backup.s3.sync_interval')
      lastSyncTime = backup.s3?.lastSyncTime || undefined
      logPrefix = '[S3AutoSync]'
    } else if (backupType === 'local') {
      if (localSyncTimeout) {
        clearTimeout(localSyncTimeout)
        localSyncTimeout = null
      }
      syncInterval = await preferenceService.get('data.backup.local.sync_interval')
      lastSyncTime = backup.local?.lastSyncTime || undefined
      logPrefix = '[LocalAutoSync]'
    } else {
      return
    }

    if (!syncInterval || syncInterval <= 0) {
      logger.verbose(`${logPrefix} Invalid sync interval, auto sync disabled`)
      stopAutoSync(backupType)
      return
    }

    const requiredInterval = syncInterval * 60 * 1000
    let timeUntilNextSync = 1000

    switch (scheduleType) {
      case 'fromLastSyncTime':
        timeUntilNextSync = Math.max(1000, (lastSyncTime || 0) + requiredInterval - Date.now())
        break
      case 'fromNow':
        timeUntilNextSync = requiredInterval
        break
    }

    const timeout = setTimeout(() => performAutoBackup(backupType), timeUntilNextSync)

    // 保存对应类型的 timeout
    if (backupType === 'webdav') {
      webdavSyncTimeout = timeout
    } else if (backupType === 's3') {
      s3SyncTimeout = timeout
    } else if (backupType === 'local') {
      localSyncTimeout = timeout
    }

    logger.verbose(
      `${logPrefix} Next sync scheduled in ${Math.floor(timeUntilNextSync / 1000 / 60)} minutes ${Math.floor(
        (timeUntilNextSync / 1000) % 60
      )} seconds`
    )
  }

  async function performAutoBackup(backupType: BackupType) {
    let isRunning: boolean
    let logPrefix: string

    if (backupType === 'webdav') {
      isRunning = isWebdavAutoBackupRunning
      logPrefix = '[WebdavAutoSync]'
    } else if (backupType === 's3') {
      isRunning = isS3AutoBackupRunning
      logPrefix = '[S3AutoSync]'
    } else if (backupType === 'local') {
      isRunning = isLocalAutoBackupRunning
      logPrefix = '[LocalAutoSync]'
    } else {
      return
    }

    if (isRunning || isManualBackupRunning) {
      logger.verbose(`${logPrefix} Backup already in progress, rescheduling`)
      void scheduleNextBackup('fromNow', backupType)
      return
    }

    // 设置运行状态
    if (backupType === 'webdav') {
      isWebdavAutoBackupRunning = true
    } else if (backupType === 's3') {
      isS3AutoBackupRunning = true
    } else if (backupType === 'local') {
      isLocalAutoBackupRunning = true
    }

    const maxRetries = 4
    let retryCount = 0

    while (retryCount < maxRetries) {
      try {
        logger.verbose(`${logPrefix} Starting auto backup... (attempt ${retryCount + 1}/${maxRetries})`)

        if (backupType === 'webdav') {
          await backupToWebdav({ autoBackupProcess: true })
          setWebDAVSyncState({
            lastSyncError: null,
            lastSyncTime: Date.now(),
            syncing: false
          })
        } else if (backupType === 's3') {
          await backupToS3({ autoBackupProcess: true })
          setS3SyncState({
            lastSyncError: null,
            lastSyncTime: Date.now(),
            syncing: false
          })
        } else if (backupType === 'local') {
          await backupToLocal({ autoBackupProcess: true })
          setLocalBackupSyncState({
            lastSyncError: null,
            lastSyncTime: Date.now(),
            syncing: false
          })
        }

        // 重置运行状态
        if (backupType === 'webdav') {
          isWebdavAutoBackupRunning = false
        } else if (backupType === 's3') {
          isS3AutoBackupRunning = false
        } else if (backupType === 'local') {
          isLocalAutoBackupRunning = false
        }

        void scheduleNextBackup('fromNow', backupType)
        break
      } catch (error: any) {
        retryCount++
        if (retryCount === maxRetries) {
          logger.error(`${logPrefix} Auto backup failed after all retries:`, error)

          if (backupType === 'webdav') {
            setWebDAVSyncState({
              lastSyncError: 'Auto backup failed',
              lastSyncTime: Date.now(),
              syncing: false
            })
          } else if (backupType === 's3') {
            setS3SyncState({
              lastSyncError: 'Auto backup failed',
              lastSyncTime: Date.now(),
              syncing: false
            })
          } else if (backupType === 'local') {
            setLocalBackupSyncState({
              lastSyncError: 'Auto backup failed',
              lastSyncTime: Date.now(),
              syncing: false
            })
          }

          await popup.error({
            title: i18n.t('message.backup.failed'),
            content: `${logPrefix} ${new Date().toLocaleString()} ` + error.message
          })

          void scheduleNextBackup('fromNow', backupType)

          // 重置运行状态
          if (backupType === 'webdav') {
            isWebdavAutoBackupRunning = false
          } else if (backupType === 's3') {
            isS3AutoBackupRunning = false
          } else if (backupType === 'local') {
            isLocalAutoBackupRunning = false
          }
        } else {
          const backoffDelay = Math.pow(2, retryCount - 1) * 10000 - 3000
          logger.warn(`${logPrefix} Failed, retry ${retryCount}/${maxRetries} after ${backoffDelay / 1000}s`)

          await new Promise((resolve) => setTimeout(resolve, backoffDelay))

          // 检查是否被用户停止
          let currentRunning: boolean
          if (backupType === 'webdav') {
            currentRunning = isWebdavAutoBackupRunning
          } else if (backupType === 's3') {
            currentRunning = isS3AutoBackupRunning
          } else {
            currentRunning = isLocalAutoBackupRunning
          }

          if (!currentRunning) {
            logger.info(`${logPrefix} retry cancelled by user, exit`)
            break
          }
        }
      }
    }
  }
}

export function stopAutoSync(type?: BackupType) {
  // 如果没有指定类型，停止所有自动同步
  if (!type) {
    stopAutoSync('webdav')
    stopAutoSync('s3')
    stopAutoSync('local')
    return
  }

  if (type === 'webdav') {
    if (webdavSyncTimeout) {
      logger.info('[WebdavAutoSync] Stopping auto sync')
      clearTimeout(webdavSyncTimeout)
      webdavSyncTimeout = null
    }
    isWebdavAutoBackupRunning = false
    webdavAutoSyncStarted = false
  } else if (type === 's3') {
    if (s3SyncTimeout) {
      logger.info('[S3AutoSync] Stopping auto sync')
      clearTimeout(s3SyncTimeout)
      s3SyncTimeout = null
    }
    isS3AutoBackupRunning = false
    s3AutoSyncStarted = false
  } else if (type === 'local') {
    if (localSyncTimeout) {
      logger.info('[LocalAutoSync] Stopping auto sync')
      clearTimeout(localSyncTimeout)
      localSyncTimeout = null
    }
    isLocalAutoBackupRunning = false
    localAutoSyncStarted = false
  }
}

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
export async function backupToLocal(options: BackupOptions = {}) {
  return backupToRemote('local', setLocalBackupSyncState, options)
}
