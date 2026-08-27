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

import { recordManualBackupCompletion, type RemoteSyncState, setBackupSyncState } from './BackupService'

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

  // Probe the configured backup path, not the server root: a green result
  // must mean the backup target itself is reachable (issue #10512).
  return window.api.backup.checkWebdavConnection(config)
}

export async function backupToNutstore({ customFileName = '' }: { customFileName?: string } = {}) {
  const nutstoreToken = await getNutstoreToken()
  if (!nutstoreToken) {
    return
  }

  const config = await createNutstoreConfig(nutstoreToken)
  if (!config) {
    toast.error(i18n.t('message.backup.failed'))
    return
  }

  const finalFileName = customFileName
    ? customFileName.endsWith('.zip')
      ? customFileName
      : `${customFileName}.zip`
    : undefined

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
      await recordManualBackupCompletion('nutstore')
      if (cleanupFailed) {
        const message = i18n.t('message.backup.cleanup_failed')
        setNutstoreSyncState({ lastSyncError: message })
        toast.warning(message)
      } else {
        setNutstoreSyncState({ lastSyncError: null })
        toast.success(i18n.t('message.backup.success'))
      }
    } else {
      throw new Error(i18n.t('message.backup.failed'))
    }
  } catch (error) {
    logger.error('[Nutstore] Backup failed:', error as Error)
    const message = getLocalizedBackupErrorMessage(error)
    setNutstoreSyncState({ lastSyncError: message })
    toast.error(message)
  } finally {
    setNutstoreSyncState({ lastSyncTime: Date.now(), syncing: false })
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

  await window.api.backup.restoreFromWebdav({ ...config, fileName })
  logger.info('[Nutstore] Backup restore staged, app will restart')
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
