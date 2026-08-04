import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { uuid } from '@renderer/utils/uuid'
import type { BackupDestinationId } from '@shared/ipc/schemas/backup'

import { notificationService } from './notification'

const logger = loggerService.withContext('backupDestination')

export type { BackupDestinationId }

/**
 * The renderer's whole share of cloud backup: name a destination and say when.
 *
 * Everything that used to live here — building a config from settings, picking a
 * filename, uploading, pruning old archives — is main's, because it has to work
 * without a window open. What is left is the part that genuinely belongs to a
 * window: asking, and telling the user how it went.
 *
 * NO PRESET CHOICE. Backup v2 has exactly one, Full
 * (docs/references/backup/README.md §1), so `data.backup.*.skip_backup_file`
 * has no reader. The switches that wrote it are gone; the keys stay because
 * they are generated from the data-classification source, and a stale `true`
 * in an upgraded profile now means nothing rather than a quietly smaller backup.
 */

/**
 * Back up to `destination`, resolving to false when it did not happen.
 *
 * `name` is what the user typed in the backup dialog; leaving it out gets the
 * generated name, which is the only one rotation will ever prune.
 */
export async function backupToDestination(
  destination: BackupDestinationId,
  { showMessage = false, name }: { showMessage?: boolean; name?: string } = {}
): Promise<boolean> {
  try {
    const result = await ipcApi.request('backup.export_to_destination', { destination, ...(name ? { name } : {}) })
    if (result.status === 'canceled') return false

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
    return true
  } catch (error) {
    logger.error(`Backup to ${destination} failed`, error as Error)
    showMessage && toast.error(i18n.t('message.backup.failed'))
    return false
  }
}

/**
 * Stage a restore from an archive already at `destination`.
 *
 * Returns the preview for the caller to confirm; nothing is replaced until
 * `backup.arm_restore` runs, which is the same two-step the local file flow uses.
 */
export async function prepareRestoreFromDestination(destination: BackupDestinationId, name: string) {
  return ipcApi.request('backup.prepare_restore_from_destination', { destination, name })
}

/** Archives this device wrote to `destination`, newest first. */
export async function listDestinationBackups(destination: BackupDestinationId) {
  return ipcApi.request('backup.list_destination_backups', { destination })
}

export async function deleteDestinationBackup(destination: BackupDestinationId, name: string): Promise<void> {
  await ipcApi.request('backup.delete_destination_backup', { destination, name })
}

/** Are the saved settings usable? False covers wrong credentials and no settings at all. */
export async function checkDestination(destination: BackupDestinationId): Promise<boolean> {
  try {
    const { reachable } = await ipcApi.request('backup.check_destination', { destination })
    return reachable
  } catch (error) {
    logger.warn(`Destination ${destination} check failed`, error as Error)
    return false
  }
}
