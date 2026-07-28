import { Alert, Button, RowFlex } from '@cherrystudio/ui'
import {
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { BACKUP_RESTORE_NOTICE_KEY } from '@renderer/utils/backupRestoreNotice'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'
import { FolderOpen, SaveIcon } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type BackupStatus = OutputFor<'backup.get_status'>
type RestorePreview = Extract<OutputFor<'backup.prepare_restore'>, { status: 'prepared' }>['preview']
type JournalRestore = Extract<BackupStatus['restore'], { kind: 'journal' }>
type Running = 'export' | 'prepare-restore' | 'other'

const RESTORE_STATE_KEYS: Record<JournalRestore['state'], string> = {
  prepared: 'settings.data.backup_v2.outcome.state.prepared',
  armed: 'settings.data.backup_v2.outcome.state.armed',
  promoting: 'settings.data.backup_v2.outcome.state.promoting',
  reverting: 'settings.data.backup_v2.outcome.state.reverting',
  completed: 'settings.data.backup_v2.outcome.state.completed',
  'rollback-armed': 'settings.data.backup_v2.outcome.state.rollback_armed',
  'rolled-back': 'settings.data.backup_v2.outcome.state.rolled_back',
  failed: 'settings.data.backup_v2.outcome.state.failed',
  expired: 'settings.data.backup_v2.outcome.state.expired'
}

const BackupV2Settings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [running, setRunning] = useState<Running | null>(null)
  const activeOperation = running === 'export' || running === 'prepare-restore' ? running : status?.operation
  const busy = running !== null || activeOperation != null

  const refresh = useCallback(async () => {
    setStatus(await ipcApi.request('backup.get_status'))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!status?.operation) return
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => window.clearInterval(timer)
  }, [refresh, status?.operation])

  const reportFailure = useCallback(
    (error: unknown): void => {
      if (!(error instanceof IpcError)) {
        toast.error(t('settings.data.backup_v2.error.unexpected'))
        return
      }
      const key =
        error.code === backupErrorCodes.BUSY
          ? 'settings.data.backup_v2.error.busy'
          : error.code === backupErrorCodes.RESTORE_INCOMPATIBLE
            ? 'settings.data.backup_v2.error.incompatible'
            : error.code === backupErrorCodes.ARCHIVE_REJECTED
              ? 'settings.data.backup_v2.error.archive_rejected'
              : error.code === backupErrorCodes.STORAGE_UNAVAILABLE
                ? 'settings.data.backup_v2.error.storage_unavailable'
                : error.code === backupErrorCodes.EXPORT_DESTINATION
                  ? 'settings.data.backup_v2.error.export_destination'
                  : 'settings.data.backup_v2.error.restore_state'
      toast.error(t(key))
    },
    [t]
  )

  const run = useCallback(
    async (kind: Running, work: () => Promise<void>) => {
      if (busy) return
      setRunning(kind)
      try {
        await work()
      } catch (error) {
        reportFailure(error)
      } finally {
        setRunning(null)
        await refresh()
      }
    },
    [busy, refresh, reportFailure]
  )

  const cancelOperation = useCallback(async () => {
    try {
      await ipcApi.request('backup.cancel_operation')
      await refresh()
    } catch (error) {
      reportFailure(error)
    }
  }, [refresh, reportFailure])

  const exportLite = () =>
    run('export', async () => {
      const result = await ipcApi.request('backup.export')
      if (result.status === 'exported') toast.success(t('settings.data.backup_v2.export.done'))
    })

  const prepare = () =>
    run('prepare-restore', async () => {
      const result = await ipcApi.request('backup.prepare_restore')
      if (result.status === 'prepared') setPreview(result.preview)
    })

  const arm = () =>
    run('other', async () => {
      if (!preview) return
      const confirmed = await popup.confirm({
        title: t('settings.data.backup_v2.restore.confirm_title'),
        content: t('settings.data.backup_v2.restore.confirm_content'),
        okText: t('settings.data.backup_v2.restore.confirm_ok'),
        cancelText: t('common.cancel'),
        centered: true,
        okButtonProps: { danger: true }
      })
      if (confirmed) await ipcApi.request('backup.arm_restore', { restoreId: preview.restoreId })
    })

  const discard = () =>
    run('other', async () => {
      await ipcApi.request('backup.cancel_restore')
      setPreview(null)
      toast.success(t('settings.data.backup_v2.restore.discarded'))
    })

  const rollback = () =>
    run('other', async () => {
      const confirmed = await popup.confirm({
        title: t('settings.data.backup_v2.rollback.confirm_title'),
        content: t('settings.data.backup_v2.rollback.confirm_content'),
        okText: t('settings.data.backup_v2.rollback.confirm_ok'),
        cancelText: t('common.cancel'),
        centered: true,
        okButtonProps: { danger: true }
      })
      if (confirmed) await ipcApi.request('backup.rollback_restore')
    })

  const acknowledge = () =>
    run('other', async () => {
      const result = await ipcApi.request('backup.acknowledge_restore')
      if (result.acknowledged) {
        toast.closeToast(BACKUP_RESTORE_NOTICE_KEY)
        toast.success(t('settings.data.backup_v2.outcome.acknowledged'))
      }
    })

  const journal = status?.restore.kind === 'journal' ? status.restore : null
  const hasPreparation = journal?.state === 'prepared'
  const hasMatchingPreview = hasPreparation && preview?.restoreId === journal.restoreId

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.backup_v2.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
        <RowFlex className="shrink-0 gap-1.25">
          <AbortableAction
            active={activeOperation === 'export'}
            busy={busy}
            onCancel={cancelOperation}
            onStart={exportLite}
            label={
              <>
                <SaveIcon size={14} />
                {t('settings.data.backup_v2.export.button')}
              </>
            }
          />
          <AbortableAction
            active={activeOperation === 'prepare-restore'}
            busy={busy}
            onCancel={cancelOperation}
            onStart={prepare}
            label={
              <>
                <FolderOpen size={14} />
                {t('settings.general.restore.button')}
              </>
            }
          />
        </RowFlex>
      </SettingRow>
      <SettingHelpText>{t('settings.data.backup_v2.export.lite_help')}</SettingHelpText>
      <SettingHelpText>{t('settings.data.backup_v2.export.credentials_warning')}</SettingHelpText>
      <SettingHelpText>{t('settings.data.backup_v2.export.integrations_warning')}</SettingHelpText>
      <SettingHelpText>{t('settings.data.backup_v2.restore.help')}</SettingHelpText>

      {hasMatchingPreview && <RestorePreview preview={preview} />}
      {hasPreparation && (
        <>
          <SettingDivider />
          <RowFlex className="justify-end gap-2">
            <Button disabled={busy} onClick={discard}>
              {t('settings.data.backup_v2.restore.discard_button')}
            </Button>
            {hasMatchingPreview && (
              <Button variant="destructive" disabled={busy} onClick={arm}>
                {t('settings.data.backup_v2.restore.arm_button')}
              </Button>
            )}
          </RowFlex>
          {!hasMatchingPreview && (
            <SettingHelpText>{t('settings.data.backup_v2.restore.pending_elsewhere')}</SettingHelpText>
          )}
        </>
      )}
      {status?.restore.kind === 'unreadable' && (
        <Alert type="error" showIcon message={t('settings.data.backup_v2.outcome.unreadable')} />
      )}
      {journal && !hasPreparation && (
        <RestoreOutcome restore={journal} busy={busy} rollback={rollback} acknowledge={acknowledge} />
      )}
    </SettingGroup>
  )
}

const AbortableAction: FC<{
  active: boolean
  busy: boolean
  onStart: () => void
  onCancel: () => void
  label: ReactNode
}> = ({ active, busy, onStart, onCancel, label }) => {
  const { t } = useTranslation()
  return active ? (
    <Button variant="outline" onClick={onCancel}>
      {t('common.cancel')}
    </Button>
  ) : (
    <Button variant="outline" disabled={busy} onClick={onStart}>
      {label}
    </Button>
  )
}

const RestorePreview: FC<{ preview: RestorePreview }> = ({ preview }) => {
  const { t } = useTranslation()
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border p-3">
      {preview.migratedForward && (
        <SettingHelpText>{t('settings.data.backup_v2.preview.migrated_forward')}</SettingHelpText>
      )}
      {preview.degradations.length > 0 && (
        <SettingHelpText>
          {t('settings.data.backup_v2.outcome.degradations', {
            count: preview.degradations.reduce((sum, entry) => sum + entry.count, 0)
          })}
        </SettingHelpText>
      )}
      <Alert type="warning" showIcon message={t('settings.data.backup_v2.preview.destructive')} />
    </div>
  )
}

const RestoreOutcome: FC<{ restore: JournalRestore; busy: boolean; rollback: () => void; acknowledge: () => void }> = ({
  restore,
  busy,
  rollback,
  acknowledge
}) => {
  const { t } = useTranslation()
  const acknowledgeable = ['completed', 'rolled-back', 'failed', 'expired'].includes(restore.state)
  return (
    <>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t(RESTORE_STATE_KEYS[restore.state])}</SettingRowTitle>
        <RowFlex className="gap-2">
          {restore.state === 'completed' && (
            <Button variant="destructive" disabled={busy} onClick={rollback}>
              {t('settings.data.backup_v2.rollback.button')}
            </Button>
          )}
          {acknowledgeable && (
            <Button disabled={busy} onClick={acknowledge}>
              {t(
                restore.state === 'rolled-back'
                  ? 'settings.data.backup_v2.outcome.keep_previous_button'
                  : 'settings.data.backup_v2.outcome.acknowledge_button'
              )}
            </Button>
          )}
        </RowFlex>
      </SettingRow>
      {restore.state === 'completed' && (
        <SettingHelpText>{t('settings.data.backup_v2.outcome.completed_help')}</SettingHelpText>
      )}
      {restore.state === 'rolled-back' && (
        <SettingHelpText>{t('settings.data.backup_v2.outcome.rolled_back_help')}</SettingHelpText>
      )}
      {restore.degradations?.length ? (
        <Alert
          type="warning"
          showIcon
          message={t('settings.data.backup_v2.outcome.degradations', {
            count: restore.degradations.reduce((sum, entry) => sum + entry.count, 0)
          })}
        />
      ) : null}
    </>
  )
}

export default BackupV2Settings
