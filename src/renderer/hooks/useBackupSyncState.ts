import { useCallback, useSyncExternalStore } from 'react'

import { getBackupSyncState, subscribeBackupSyncState } from '@renderer/services/BackupService'
import type { AutoBackupType } from '@shared/types/backup'

export function useBackupSyncState(type: AutoBackupType) {
  return useSyncExternalStore(
    subscribeBackupSyncState,
    useCallback(() => getBackupSyncState()[type], [type])
  )
}
