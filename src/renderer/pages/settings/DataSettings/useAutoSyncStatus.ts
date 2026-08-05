import { useCallback, useEffect, useState } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { BackupDestinationId } from '@shared/ipc/schemas/backup'
import type { OutputFor } from '@shared/ipc/types'

const logger = loggerService.withContext('useAutoSyncStatus')

type AutoSyncStatus = OutputFor<'backup.get_auto_sync_status'>[number]

/** Scheduled runs finish in main without telling the page, so it re-reads this often. */
const REFRESH_INTERVAL_MS = 30_000

/** Why the latest scheduled run wrote nothing, as the sentence the status tooltip shows. */
export const AUTO_SYNC_PROBLEM_KEYS: Record<NonNullable<AutoSyncStatus['problem']>, string> = {
  failed: 'settings.data.backup.error.unexpected',
  'not-configured': 'settings.data.backup.error.destination_not_configured'
}

/**
 * When this destination last backed up on its own, and whether its latest
 * scheduled run failed.
 *
 * Read from main's durable run history rather than kept here: the module
 * variable this replaces was reset by every reload, so the settings page claimed
 * the destination had never synced no matter how many backups had run.
 *
 * `status` stays null until the first read lands, so a page can tell "not read
 * yet" from "never synced". `refresh` exists because the settings pages change
 * the schedule themselves.
 */
export function useAutoSyncStatus(destination: BackupDestinationId) {
  const [status, setStatus] = useState<AutoSyncStatus | null>(null)

  const refresh = useCallback(async () => {
    try {
      const all = await ipcApi.request('backup.get_auto_sync_status')
      setStatus(all.find((entry) => entry.destination === destination) ?? null)
    } catch (error) {
      // Keep whatever is on screen; blanking it would read as "never synced".
      logger.warn('Could not read scheduled backup status', error as Error)
    }
  }, [destination])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return { status, refresh }
}
