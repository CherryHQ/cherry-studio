import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { OutputFor } from '@shared/ipc/types'
import { t } from 'i18next'
import { useEffect } from 'react'

const logger = loggerService.withContext('useBackupRestoreNotice')

/**
 * Say out loud what the last boot's restore left behind
 * (docs/references/backup/README.md §6.5).
 *
 * The restore journal outlives the relaunch that performed the promotion, and
 * its terminal states all mean something the user must not have to go looking
 * for. `completed` is the expensive one: until it is acknowledged the previous
 * database and every replaced file are still on disk AND orphan file cleanup
 * stands aside, so a user who never revisits the settings page pays double
 * storage and a disabled sweep indefinitely.
 *
 * Deliberately a REMINDER, not an expiry. Auto-acknowledging after some interval
 * would delete the only rollback material a bad restore has, unprompted; the
 * frozen contract keeps it until the user says so, and this makes sure they are
 * asked. `failed` / `expired` hold no storage, but they mean the restore the user
 * asked for did not happen — silence there reads as success.
 *
 * Read once on mount, not subscribed: the journal is written by the preboot gate
 * before any window exists, and nothing in this process can change it except the
 * settings screen the notice points at (which re-reads the status itself).
 * Main-only and mounted once from `MainWindowRuntime` — a per-window copy would
 * stack duplicate toasts for one journal.
 */

type RestoreState = Extract<OutputFor<'backup.get_status'>['restore'], { kind: 'journal' }>['state']

/**
 * The terminal states worth interrupting for, and what each one has to say.
 * Partial on purpose: the in-flight states (`prepared`, `armed`, `promoting`)
 * belong to a flow the user is already inside.
 */
const NOTICE_TEXT: Partial<Record<RestoreState, { readonly title: string; readonly description: string }>> = {
  completed: {
    title: 'settings.data.backup_v2.notice.completed_title',
    description: 'settings.data.backup_v2.notice.completed_description'
  },
  'rolled-back': {
    title: 'settings.data.backup_v2.notice.rolled_back_title',
    description: 'settings.data.backup_v2.notice.rolled_back_description'
  },
  failed: {
    title: 'settings.data.backup_v2.notice.failed_title',
    description: 'settings.data.backup_v2.notice.failed_description'
  },
  expired: {
    title: 'settings.data.backup_v2.notice.expired_title',
    description: 'settings.data.backup_v2.notice.expired_description'
  }
}

/** A fixed key, so a remount cannot stack a second copy of the same notice. */
const NOTICE_KEY = 'backup-restore-notice'

export function useBackupRestoreNotice(): void {
  useEffect(() => {
    // Drop a status that resolves after teardown (StrictMode's mount/unmount/mount).
    let active = true

    void ipcApi
      .request('backup.get_status')
      .then(({ restore }) => {
        if (!active || restore.kind !== 'journal') return
        const text = NOTICE_TEXT[restore.state]
        if (!text) return

        // Persistent: the completed one is a task the user still has to do, and
        // the other two are the only report that their restore did not happen.
        toast.warning({
          key: NOTICE_KEY,
          timeout: 0,
          title: t(text.title),
          description: t(text.description)
        })
        logger.info('Surfaced a restore outcome notice', {
          state: restore.state
        })
      })
      .catch((error) => logger.error('Failed to read the backup status', error as Error))

    return () => {
      active = false
    }
  }, [])
}
