import { Alert, Button, RadioGroup, RadioGroupItem, RowFlex } from '@cherrystudio/ui'
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
import { FolderOpen, SaveIcon } from 'lucide-react'
import type { FC, ReactNode } from 'react'
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

const PRESET_EXPORT_TITLE_KEYS: Record<Preset, string> = {
  lite: 'settings.data.backup_v2.export.lite_title',
  full: 'settings.data.backup_v2.export.full_title'
}

const PRESET_EXPORT_HELP_KEYS: Record<Preset, string> = {
  lite: 'settings.data.backup_v2.export.lite_help',
  full: 'settings.data.backup_v2.export.full_help'
}

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
        case backupErrorCodes.ROLLBACK_UNAVAILABLE:
          return toast.error(t('settings.data.backup_v2.error.rollback_unavailable'))
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
          ? t('settings.data.backup_v2.export.done_degraded', {
              count: result.degradations.length
            })
          : t('settings.data.backup_v2.export.done')
      )
    })

  const handleChooseExport = async () => {
    let selectedPreset: Preset = 'lite'
    const confirmed = await popup.confirm({
      title: t('settings.data.backup_v2.export.title'),
      content: (
        <BackupPresetPicker
          defaultValue={selectedPreset}
          onValueChange={(preset) => {
            selectedPreset = preset
          }}
        />
      ),
      okText: t('settings.data.backup_v2.export.button'),
      cancelText: t('common.cancel'),
      centered: true
    })
    if (!confirmed) return
    await handleExport(selectedPreset)
  }

  const handlePrepare = () =>
    run({ kind: 'prepare' }, async () => {
      const result = await ipcApi.request('backup.prepare_restore')
      if (result.status === 'canceled') return
      setPreview(result.preview)
    })

  const handleArm = () =>
    run({ kind: 'other' }, async () => {
      if (!preview) return
      const confirmed = await popup.confirm({
        title: t('settings.data.backup_v2.restore.confirm_title'),
        content: t('settings.data.backup_v2.restore.confirm_content'),
        okText: t('settings.data.backup_v2.restore.confirm_ok'),
        cancelText: t('common.cancel'),
        centered: true,
        okButtonProps: { danger: true }
      })
      if (!confirmed) return
      // Main atomically rejects the request if another window replaced this
      // preparation while the confirmation dialog was open.
      await ipcApi.request('backup.arm_restore', { restoreId: preview.restoreId })
    })

  const handleDiscard = () =>
    run({ kind: 'other' }, async () => {
      await ipcApi.request('backup.cancel_restore')
      setPreview(null)
      toast.success(t('settings.data.backup_v2.restore.discarded'))
    })

  const handleRollback = () =>
    run({ kind: 'other' }, async () => {
      const confirmed = await popup.confirm({
        title: t('settings.data.backup_v2.rollback.confirm_title'),
        content: t('settings.data.backup_v2.rollback.confirm_content'),
        okText: t('settings.data.backup_v2.rollback.confirm_ok'),
        cancelText: t('common.cancel'),
        centered: true,
        okButtonProps: { danger: true }
      })
      if (!confirmed) return
      // The app relaunches into the zero-connection rollback gate.
      await ipcApi.request('backup.rollback_restore')
    })

  const handleAcknowledge = () =>
    run({ kind: 'other' }, async () => {
      await ipcApi.request('backup.acknowledge_restore')
      toast.success(t('settings.data.backup_v2.outcome.acknowledged'))
    })

  const restore = status?.restore
  const journal = restore?.kind === 'journal' ? restore : null
  const hasPreparation = journal?.state === 'prepared'
  const hasMatchingPreview = hasPreparation && preview?.restoreId === journal.restoreId

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.title')}</SettingTitle>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
        <RowFlex className="shrink-0 justify-between gap-1.25">
          <AbortableAction
            label={
              <>
                <SaveIcon size={14} />
                {t('settings.general.backup.button')}
              </>
            }
            active={running?.kind === 'export'}
            busy={busy}
            onStart={() => void handleChooseExport()}
            onCancel={handleCancelOperation}
          />
          <AbortableAction
            label={
              <>
                <FolderOpen size={14} />
                {t('settings.general.restore.button')}
              </>
            }
            active={running?.kind === 'prepare'}
            busy={busy}
            onStart={handlePrepare}
            onCancel={handleCancelOperation}
          />
        </RowFlex>
      </SettingRow>
      <SettingHelpText>{t('settings.data.backup_v2.export.credentials_warning')}</SettingHelpText>
      <SettingHelpText>{t('settings.data.backup_v2.export.integrations_warning')}</SettingHelpText>
      <SettingHelpText>{t('settings.data.backup_v2.restore.help')}</SettingHelpText>

      {hasMatchingPreview && <RestorePreviewCard preview={preview} />}

      {hasPreparation && (
        <>
          <SettingDivider />
          <RowFlex className="justify-end gap-2">
            <Button disabled={busy} onClick={handleDiscard}>
              {t('settings.data.backup_v2.restore.discard_button')}
            </Button>
            {hasMatchingPreview && (
              <Button variant="destructive" disabled={busy} onClick={handleArm}>
                {t('settings.data.backup_v2.restore.arm_button')}
              </Button>
            )}
          </RowFlex>
          {!hasMatchingPreview && (
            <SettingHelpText>{t('settings.data.backup_v2.restore.pending_elsewhere')}</SettingHelpText>
          )}
        </>
      )}

      {restore && restore.kind !== 'none' && !hasPreparation && (
        <>
          <SettingDivider />
          <SettingRowTitle>{t('settings.data.backup_v2.outcome.title')}</SettingRowTitle>
          <RestoreOutcome restore={restore} busy={busy} onRollback={handleRollback} onAcknowledge={handleAcknowledge} />
        </>
      )}
    </SettingGroup>
  )
}

const BackupPresetPicker: FC<{
  defaultValue: Preset
  onValueChange: (preset: Preset) => void
}> = ({ defaultValue, onValueChange }) => {
  const { t } = useTranslation()

  return (
    <RadioGroup
      defaultValue={defaultValue}
      onValueChange={(value) => onValueChange(value as Preset)}
      aria-label={t('settings.data.backup_v2.export.title')}>
      {(['lite', 'full'] as const).map((preset) => (
        <label
          key={preset}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-accent">
          <RadioGroupItem value={preset} className="mt-0.5" />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-foreground text-sm">{t(PRESET_EXPORT_TITLE_KEYS[preset])}</span>
            <span className="text-muted-foreground text-xs leading-5">{t(PRESET_EXPORT_HELP_KEYS[preset])}</span>
          </span>
        </label>
      ))}
    </RadioGroup>
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
  label: ReactNode
  /** This row's operation is the one in flight. */
  active: boolean
  /** Some operation is in flight (this row's or another's). */
  busy: boolean
  onStart: () => void
  onCancel: () => void
}> = ({ label, active, busy, onStart, onCancel }) => {
  const { t } = useTranslation()

  if (active) {
    return (
      <Button variant="outline" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    )
  }
  return (
    <Button variant="outline" disabled={busy} onClick={onStart}>
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
              replaceCount: preview.resources.replace
            })}
          </span>
        </SettingRow>
      )}
      {preview.migratedForward && (
        <SettingHelpText>{t('settings.data.backup_v2.preview.migrated_forward')}</SettingHelpText>
      )}
      {preview.degradations.length > 0 && (
        <SettingHelpText>
          {t('settings.data.backup_v2.preview.degradations', {
            count: preview.degradations.length
          })}
        </SettingHelpText>
      )}
      <Alert type="warning" showIcon message={t('settings.data.backup_v2.preview.destructive')} />
    </div>
  )
}

/**
 * The durable outcome of the last restore. `completed` offers the explicit
 * choice while both sides still exist: keep the restored state or move the
 * retained previous state back. Either terminal remains protected until its
 * displaced side is acknowledged and released.
 */
const RestoreOutcome: FC<{
  restore: NonNullable<BackupStatus['restore']>
  busy: boolean
  onRollback: () => void
  onAcknowledge: () => void
}> = ({ restore, busy, onRollback, onAcknowledge }) => {
  const { t } = useTranslation()

  if (restore.kind === 'unreadable') {
    return <Alert type="error" showIcon message={t('settings.data.backup_v2.outcome.unreadable')} />
  }
  if (restore.kind !== 'journal') return null

  // A repair that could not finish — in either direction — still owns the only
  // copy of what it moved, so the button that releases it is withheld rather
  // than shown and refused.
  const acknowledgeable =
    (restore.state === 'completed' ||
      restore.state === 'rolled-back' ||
      restore.state === 'failed' ||
      restore.state === 'expired') &&
    !restore.recoveryIncomplete &&
    !restore.resourcesIncomplete
  const rollbackable = restore.state === 'completed' && !restore.resourcesIncomplete

  return (
    <>
      <SettingRow>
        <SettingRowTitle>{t(RESTORE_STATE_KEYS[restore.state])}</SettingRowTitle>
        {(rollbackable || acknowledgeable) && (
          <RowFlex className="gap-2">
            {rollbackable && (
              <Button variant="destructive" disabled={busy} onClick={onRollback}>
                {t('settings.data.backup_v2.rollback.button')}
              </Button>
            )}
            {acknowledgeable && (
              <Button disabled={busy} onClick={onAcknowledge}>
                {t(
                  restore.state === 'rolled-back'
                    ? 'settings.data.backup_v2.outcome.keep_previous_button'
                    : 'settings.data.backup_v2.outcome.acknowledge_button'
                )}
              </Button>
            )}
          </RowFlex>
        )}
      </SettingRow>
      {restore.state === 'completed' && (
        <SettingHelpText>{t('settings.data.backup_v2.outcome.completed_help')}</SettingHelpText>
      )}
      {restore.state === 'rolled-back' && (
        <SettingHelpText>{t('settings.data.backup_v2.outcome.rolled_back_help')}</SettingHelpText>
      )}
      {restore.state === 'completed' && (
        <SettingHelpText>{t('settings.data.backup_v2.outcome.reconfirm_integrations')}</SettingHelpText>
      )}
      {restore.recoveryIncomplete && (
        <Alert type="warning" showIcon message={t('settings.data.backup_v2.outcome.recovery_incomplete')} />
      )}
      {restore.resourcesIncomplete && (
        <Alert type="warning" showIcon message={t('settings.data.backup_v2.outcome.resources_incomplete')} />
      )}
      {/*
        Completed only, and with the lines shown rather than just counted: this is
        the one moment the user can still act on what came back reduced, and only
        a completed restore actually put that data in front of them.
      */}
      {restore.state === 'completed' && restore.degradations && restore.degradations.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('settings.data.backup_v2.outcome.degradations', {
            count: restore.degradations.length
          })}
          description={
            <ul>
              {restore.degradations.map((degradation) => (
                <li key={`${degradation.kind}-${degradation.reason}`}>
                  {degradation.kind}: {degradation.reason}
                </li>
              ))}
            </ul>
          }
        />
      )}
    </>
  )
}

export default BackupV2Settings
