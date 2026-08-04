/**
 * @deprecated v2 replacement pending. Like BackupService, this currently uses the retained v1
 * compatibility engine for real archives.
 */
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { getLocalizedBackupErrorMessage } from '@renderer/utils/backup'
import type { WebDavConfig } from '@shared/types/backup'
import { NUTSTORE_HOST } from '@shared/utils/nutstore'
import { type CreateDirectoryOptions } from 'webdav'

import { type RemoteSyncState, setBackupSyncState } from './BackupService'

const logger = loggerService.withContext('NutstoreService')

const setNutstoreSyncState = (patch: Partial<RemoteSyncState>) => {
  setBackupSyncState('nutstore', patch)
}

async function getNutstoreToken(showMessage = true) {
  const nutstoreToken = await preferenceService.get('data.backup.nutstore.token')

  if (!nutstoreToken) {
    showMessage && toast.error(i18n.t('message.error.invalid.nutstore_token'))
    return null
  }
  return nutstoreToken
}

async function createNutstoreConfig(nutstoreToken: string): Promise<WebDavConfig | null> {
  const result = await window.api.nutstore.decryptToken(nutstoreToken)
  if (!result) {
    logger.warn('Invalid nutstore token')
    return null
  }

  const nutstorePath = await preferenceService.get('data.backup.nutstore.path')

  const { username, access_token } = result
  return {
    webdavHost: NUTSTORE_HOST,
    webdavUser: username,
    webdavPass: access_token,
    webdavPath: nutstorePath
  }
}

export async function checkConnection() {
  const nutstoreToken = await getNutstoreToken()
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

let isManualBackupRunning = false

export const isNutstoreBackupRunning = () => isManualBackupRunning

export async function backupToNutstore({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  const nutstoreToken = await getNutstoreToken(showMessage)
  if (!nutstoreToken) {
    if (autoBackupProcess) {
      throw new Error(i18n.t('message.error.invalid.nutstore_token'))
    }
    return
  }

  if (isManualBackupRunning) {
    logger.verbose('[backupToNutstore] Backup already in progress')
    return
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    if (autoBackupProcess) {
      throw new Error(i18n.t('message.backup.failed'))
    }
    showMessage && toast.error(i18n.t('message.backup.failed'))
    return
  }

  const finalFileName = customFileName
    ? customFileName.endsWith('.zip')
      ? customFileName
      : `${customFileName}.zip`
    : undefined

  isManualBackupRunning = true

  setNutstoreSyncState({ syncing: true, lastSyncError: null })

  const skipBackupFile = await preferenceService.get('data.backup.nutstore.skip_backup_file')
  const maxBackups = await preferenceService.get('data.backup.nutstore.max_backups')

  try {
    const { result: isSuccess, cleanupFailed } = await window.api.backup.backupToWebdav({
      ...config,
      fileName: finalFileName,
      maxBackups,
      skipBackupFile
    })

    if (isSuccess) {
      if (cleanupFailed) {
        const message = i18n.t('message.backup.cleanup_failed')
        setNutstoreSyncState({ lastSyncError: message })
        showMessage && toast.warning(message)
      } else {
        setNutstoreSyncState({ lastSyncError: null })
        showMessage && toast.success(i18n.t('message.backup.success'))
      }
    } else {
      throw new Error(i18n.t('message.backup.failed'))
    }
  } catch (error) {
    logger.error('[Nutstore] Backup failed:', error as Error)
    if (autoBackupProcess) {
      throw error
    }
    const message = getLocalizedBackupErrorMessage(error)
    setNutstoreSyncState({ lastSyncError: message })
    showMessage && toast.error(message)
  } finally {
    if (!autoBackupProcess) {
      setNutstoreSyncState({ lastSyncTime: Date.now(), syncing: false })
    }
    isManualBackupRunning = false
  }
}

export async function restoreFromNutstore(fileName?: string) {
  const nutstoreToken = await getNutstoreToken(false)
  if (!nutstoreToken) {
    throw new Error('Nutstore credentials are unavailable')
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    throw new Error('Nutstore credentials are unavailable')
  }

  try {
    await window.api.backup.restoreFromWebdav({ ...config, fileName })
    logger.info('[Nutstore] Backup restore staged, app will restart')
  } catch (error) {
    logger.error('[backup] restoreFromWebdav: Error downloading file from WebDAV:', error as Error)
    throw error
  }
}

export async function createDirectory(path: string, options?: CreateDirectoryOptions) {
  const nutstoreToken = await getNutstoreToken()
  if (!nutstoreToken) {
    return
  }
  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    return
  }

  await window.api.backup.createDirectory(config, path, options)
}
