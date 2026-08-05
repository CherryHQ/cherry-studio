import { ipcApi } from '@renderer/ipc'
import type { BackupDestinationId } from '@shared/ipc/schemas/backup'
import type { OutputFor } from '@shared/ipc/types'
import { useCallback, useEffect, useState } from 'react'

type AutoSyncStatus = OutputFor<'backup.get_auto_sync_status'>[number]

/**
 * When this destination last backed up on its own, and when it will next.
 *
 * Read from main's durable schedule rather than kept here: the module variable
 * this replaces was reset by every reload, so the settings page claimed the
 * destination had never synced no matter how many backups had run.
 *
 * `refresh` exists because the settings pages change the schedule themselves —
 * a toggle or an interval edit invalidates what was just read.
 */
export function useAutoSyncStatus(destination: BackupDestinationId) {
  const [status, setStatus] = useState<AutoSyncStatus | null>(null)

  const refresh = useCallback(async () => {
    const all = await ipcApi.request('backup.get_auto_sync_status')
    setStatus(all.find((entry) => entry.destination === destination) ?? null)
  }, [destination])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { status, refresh }
}
