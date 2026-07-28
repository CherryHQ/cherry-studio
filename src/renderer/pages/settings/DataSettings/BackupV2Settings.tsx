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
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Backup v2 — export and restore (docs/references/backup/README.md).
 *
 * The screen is built around the one fact a user must not miss: a restore
 * REPLACES the database, whole. Both presets say so, the confirmation says so
 * again, and nothing here offers a merge, because none exists.
 *
 * State lives in main. This component holds only what the current visit
 * produced (the preview it just prepared) and re-reads `backup.get_status`
 * after every action, so a reopened window shows the same truth as a relaunched
 * app — the journal, not this component, is what survives.
 */

type BackupStatus = OutputFor<'backup.get_status'>
type RestorePreview = Extract<OutputFor<'backup.prepare_restore'>, { status: 'prepared' }>['preview']
type Preset = 'lite' | 'full'
type JournalRestore = Extract<NonNullable<BackupStatus['restore']>, { kind: 'journal' }>

/**
 * What is running, identified down to the row that started it — the abortable
 * ones need it so the cancel affordance appears where the user last clicked.
 * `other` covers the instant actions (discard, arm, acknowledge), which only
 * need to hold the busy lock.
 */
type Running =
  | { readonly kind: 'export'; readonly preset: Preset }
  | { readonly kind: 'prepare' }
  | { readonly kind: 'other' }

/** Written out rather than interpolated, so the keys stay greppable. */
const PRESET_LABEL_KEYS: Record<Preset, string> = {
  lite: 'settings.data.backup_v2.preset.lite',
  full: 'settings.data.backup_v2.preset.full'
}

const RESTORE_STATE_KEYS: Record<JournalRestore['state'], string> = {
  prepared: 'settings.data.backup_v2.outcome.state.prepared',
  armed: 'settings.data.backup_v2.outcome.state.armed',
  promoting: 'settings.data.backup_v2.outcome.state.promoting',
  completed: 'settings.data.backup_v2.outcome.state.completed',
  failed: 'settings.data.backup_v2.outcome.state.failed',
  expired: 'settings.data.backup_v2.outcome.state.expired'
}

const BackupV2Settings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [running, setRunning] = useState<Running | null>(null)
  const busy = running !== null

  const refresh = useCallback(async () => {
    setStatus(await ipcApi.request('backup.get_status'))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Turn the closed IPC code set into the one sentence the user can act on. */
  const reportFailure = useCallback(
    (error: unknown) => {
      if (!(error instanceof IpcError)) {
        toast.error(t('settings.data.backup_v2.error.unexpected'))
        return
      }
      switch (error.code) {
        case backupErrorCodes.BUSY:
          return toast.error(t('settings.data.backup_v2.error.busy'))
        case backupErrorCodes.ARCHIVE_REJECTED:
          return toast.error(t('settings.data.backup_v2.error.archive_rejected'))
        case backupErrorCodes.RESTORE_STATE:
          return toast.error(t('settings.data.backup_v2.error.restore_state'))
        case backupErrorCodes.JOURNAL_UNREADABLE:
          return toast.error(t('settings.data.backup_v2.error.journal_unreadable'))
        case backupErrorCodes.ARM_FAILED:
          return toast.error(t('settings.data.backup_v2.error.arm_failed'))
        case backupErrorCodes.RECOVERY_INCOMPLETE:
          return toast.error(t('settings.data.backup_v2.error.recovery_incomplete'))
        case backupErrorCodes.EXPORT_DESTINATION:
          return toast.error(t('settings.data.backup_v2.error.export_destination'))
        default:
          return toast.error(t('settings.data.backup_v2.error.unexpected'))
      }
    },
    [t]
  )

  /** One operation at a time, and the status is re-read whatever the outcome. */
  const run = useCallback(
    async (started: Running, work: () => Promise<void>) => {
      if (busy) return
      setRunning(started)
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

  /**
   * Ask main to abort the operation in flight. Deliberately NOT routed through
   * {@link run}: it exists to interrupt a busy service, so the busy guard that
   * protects every other action would block the only action that can end it.
   *
   * No confirmation toast — the abort is cooperative, so the row's button
   * returning to its idle label is the only honest signal that it actually
   * stopped, and that arrives on its own when the operation unwinds.
   */
  const handleCancelOperation = useCallback(async () => {
    try {
      await ipcApi.request('backup.cancel_operation')
    } catch (error) {
      reportFailure(error)
    }
  }, [reportFailure])

  const handleExport = (preset: Preset) =>
    run({ kind: 'export', preset }, async () => {
      const result = await ipcApi.request('backup.export', { preset })
      if (result.status === 'canceled') return
      toast.success(
        result.degradations.length > 0
          ? t('settings.data.backup_v2.export.done_degraded', { count: result.degradations.length })
          : t('settings.data.backup_v2.export.done')
      )
    })

  const handlePrepare = () =>
    run({ kind: 'prepare' }, async () => {
      const result = await ipcApi.request('backup.prepare_restore')
      if (result.status === 'canceled') return
      setPreview(result.preview)
    })

  const handleArm = () =>
    run({ kind: 'other' }, async () => {
      const confirmed = await popup.confirm({
        title: t('settings.data.backup_v2.restore.confirm_title'),
        content: t('settings.data.backup_v2.restore.confirm_content'),
        okText: t('settings.data.backup_v2.restore.confirm_ok'),
        cancelText: t('common.cancel'),
        centered: true,
        okButtonProps: { danger: true }
      })
      if (!confirmed) return
      // The app relaunches into the promotion; nothing after this runs.
      await ipcApi.request('backup.arm_restore')
    })

  const handleDiscard = () =>
    run({ kind: 'other' }, async () => {
      await ipcApi.request('backup.cancel_restore')
      setPreview(null)
      toast.success(t('settings.data.backup_v2.restore.discarded'))
    })

  const handleAcknowledge = () =>
    run({ kind: 'other' }, async () => {
      await ipcApi.request('backup.acknowledge_restore')
      toast.success(t('settings.data.backup_v2.outcome.acknowledged'))
    })

  const restore = status?.restore
  const journal = restore?.kind === 'journal' ? restore : null
  const hasPreparation = journal?.state === 'prepared'

  return (
    <>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.data.backup_v2.export.title')}</SettingTitle>
        <SettingHelpText>{t('settings.data.backup_v2.export.credentials_warning')}</SettingHelpText>
        <SettingHelpText>{t('settings.data.backup_v2.export.integrations_warning')}</SettingHelpText>
        <SettingDivider />

        <SettingRow>
          <div className="flex flex-col gap-1 pr-4">
            <SettingRowTitle>{t('settings.data.backup_v2.export.lite_title')}</SettingRowTitle>
            <SettingHelpText>{t('settings.data.backup_v2.export.lite_help')}</SettingHelpText>
          </div>
          <AbortableAction
            label={t('settings.data.backup_v2.export.button')}
            active={running?.kind === 'export' && running.preset === 'lite'}
            busy={busy}
            onStart={() => handleExport('lite')}
            onCancel={handleCancelOperation}
          />
        </SettingRow>
        <SettingDivider />

        <SettingRow>
          <div className="flex flex-col gap-1 pr-4">
            <SettingRowTitle>{t('settings.data.backup_v2.export.full_title')}</SettingRowTitle>
            <SettingHelpText>{t('settings.data.backup_v2.export.full_help')}</SettingHelpText>
          </div>
          <AbortableAction
            label={t('settings.data.backup_v2.export.button')}
            active={running?.kind === 'export' && running.preset === 'full'}
            busy={busy}
            onStart={() => handleExport('full')}
            onCancel={handleCancelOperation}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.data.backup_v2.restore.title')}</SettingTitle>
        <SettingHelpText>{t('settings.data.backup_v2.restore.help')}</SettingHelpText>
        <SettingDivider />

        <SettingRow>
          <SettingRowTitle>{t('settings.data.backup_v2.restore.choose_title')}</SettingRowTitle>
          <AbortableAction
            label={t('settings.data.backup_v2.restore.choose_button')}
            active={running?.kind === 'prepare'}
            busy={busy}
            onStart={handlePrepare}
            onCancel={handleCancelOperation}
          />
        </SettingRow>

        {preview && <RestorePreviewCard preview={preview} />}

        {(preview || hasPreparation) && (
          <>
            <SettingDivider />
            <RowFlex className="justify-end gap-2">
              <Button disabled={busy} onClick={handleDiscard}>
                {t('settings.data.backup_v2.restore.discard_button')}
              </Button>
              <Button variant="destructive" disabled={busy} onClick={handleArm}>
                {t('settings.data.backup_v2.restore.arm_button')}
              </Button>
            </RowFlex>
            {!preview && hasPreparation && (
              <SettingHelpText>{t('settings.data.backup_v2.restore.pending_elsewhere')}</SettingHelpText>
            )}
          </>
        )}
      </SettingGroup>

      {restore && restore.kind !== 'none' && !hasPreparation && (
        <SettingGroup theme={theme}>
          <SettingTitle>{t('settings.data.backup_v2.outcome.title')}</SettingTitle>
          <SettingDivider />
          <RestoreOutcome restore={restore} busy={busy} onAcknowledge={handleAcknowledge} />
        </SettingGroup>
      )}
    </>
  )
}

/**
 * A row's action button, which becomes that row's cancel button while its own
 * work is running.
 *
 * One control rather than two: an export or an archive admission can take
 * minutes, and the place the user looks for a way out is the button they just
 * pressed. Rows whose work is not running stay disabled, because the service
 * takes one operation at a time.
 */
const AbortableAction: FC<{
  label: string
  /** This row's operation is the one in flight. */
  active: boolean
  /** Some operation is in flight (this row's or another's). */
  busy: boolean
  onStart: () => void
  onCancel: () => void
}> = ({ label, active, busy, onStart, onCancel }) => {
  const { t } = useTranslation()

  if (active) {
    return <Button onClick={onCancel}>{t('common.cancel')}</Button>
  }
  return (
    <Button disabled={busy} onClick={onStart}>
      {label}
    </Button>
  )
}

/**
 * What this device would do with the archive — counted at preparation time, on
 * purpose stated as an estimate: a file can still appear or vanish before the
 * restart that performs the restore, and the preboot state machine owns the
 * final answer.
 */
const RestorePreviewCard: FC<{ preview: RestorePreview }> = ({ preview }) => {
  const { t } = useTranslation()
  const { coverage } = preview

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border p-3">
      <SettingRow>
        <SettingRowTitle>{t('settings.data.backup_v2.preview.preset')}</SettingRowTitle>
        <span>{t(PRESET_LABEL_KEYS[preview.preset])}</span>
      </SettingRow>
      <SettingRow>
        <SettingRowTitle>{t('settings.data.backup_v2.preview.coverage')}</SettingRowTitle>
        <span>
          {t('settings.data.backup_v2.preview.coverage_counts', {
            available: coverage.available,
            missing: coverage.missing,
            unverifiable: coverage.unverifiable
          })}
        </span>
      </SettingRow>
      {preview.preset === 'full' && (
        <SettingRow>
          <SettingRowTitle>{t('settings.data.backup_v2.preview.resources')}</SettingRowTitle>
          <span>
            {t('settings.data.backup_v2.preview.resources_counts', {
              install: preview.resources.install,
              replace: preview.resources.replace
            })}
          </span>
        </SettingRow>
      )}
      {preview.migratedForward && (
        <SettingHelpText>{t('settings.data.backup_v2.preview.migrated_forward')}</SettingHelpText>
      )}
      {preview.degradations.length > 0 && (
        <SettingHelpText>
          {t('settings.data.backup_v2.preview.degradations', { count: preview.degradations.length })}
        </SettingHelpText>
      )}
      <Alert type="warning" showIcon message={t('settings.data.backup_v2.preview.destructive')} />
    </div>
  )
}

/**
 * The durable outcome of the last restore. `completed` is the only state that
 * still owns rollback material — until it is acknowledged the previous database
 * and every replaced file are still on disk, which is also why the button says
 * what it releases.
 */
const RestoreOutcome: FC<{
  restore: NonNullable<BackupStatus['restore']>
  busy: boolean
  onAcknowledge: () => void
}> = ({ restore, busy, onAcknowledge }) => {
  const { t } = useTranslation()

  if (restore.kind === 'unreadable') {
    return <Alert type="error" showIcon message={t('settings.data.backup_v2.outcome.unreadable')} />
  }
  if (restore.kind !== 'journal') return null

  // A rollback that could not finish still owns the only copy of what it moved,
  // so the button that releases it is withheld rather than shown and refused.
  const acknowledgeable =
    (restore.state === 'completed' || restore.state === 'failed' || restore.state === 'expired') &&
    !restore.recoveryIncomplete

  return (
    <>
      <SettingRow>
        <SettingRowTitle>{t(RESTORE_STATE_KEYS[restore.state])}</SettingRowTitle>
        {acknowledgeable && (
          <Button disabled={busy} onClick={onAcknowledge}>
            {t('settings.data.backup_v2.outcome.acknowledge_button')}
          </Button>
        )}
      </SettingRow>
      {restore.state === 'completed' && (
        <SettingHelpText>{t('settings.data.backup_v2.outcome.completed_help')}</SettingHelpText>
      )}
      {restore.state === 'completed' && (
        <SettingHelpText>{t('settings.data.backup_v2.outcome.reconfirm_integrations')}</SettingHelpText>
      )}
      {restore.recoveryIncomplete && (
        <Alert type="warning" showIcon message={t('settings.data.backup_v2.outcome.recovery_incomplete')} />
      )}
    </>
  )
}

export default BackupV2Settings
