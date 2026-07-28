import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useBackupV2 } from '@renderer/hooks/useBackupV2'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { createPopup, popup, type PopupInjectedProps } from '@renderer/services/popup'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type {
  RestoreDegradationKind,
  RestoreResultSummary,
  RestoreSkipReasonCode,
  RestoreStatus
} from '@shared/types/backup'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('RestoreV2Popup')

const restoreSkipReasonI18nKeys = {
  local_record_exists: 'settings.data.backup.v2.restore.summary.skip_reason.local_record_exists',
  target_exists: 'settings.data.backup.v2.restore.summary.skip_reason.target_exists',
  notes_root_unavailable: 'settings.data.backup.v2.restore.summary.skip_reason.notes_root_unavailable',
  outside_user_data: 'settings.data.backup.v2.restore.summary.skip_reason.outside_user_data'
} as const satisfies Record<RestoreSkipReasonCode, string>

const restoreDegradationI18nKeys = {
  ref_cleared: 'settings.data.backup.v2.restore.summary.degraded_kind.ref_cleared',
  row_pruned: 'settings.data.backup.v2.restore.summary.degraded_kind.row_pruned',
  rows_skipped: 'settings.data.backup.v2.restore.summary.degraded_kind.rows_skipped',
  association_dropped: 'settings.data.backup.v2.restore.summary.degraded_kind.association_dropped',
  field_conflict: 'settings.data.backup.v2.restore.summary.degraded_kind.field_conflict',
  attachment_unavailable: 'settings.data.backup.v2.restore.summary.degraded_kind.attachment_unavailable',
  resource_content_missing: 'settings.data.backup.v2.restore.summary.degraded_kind.resource_content_missing'
} as const satisfies Record<RestoreDegradationKind, string>

/**
 * Disclosed lossy outcomes of a restore. Rendered both before relaunch (staged journal) and
 * after it (completed journal) — the same list, because promotion carries the summary across
 * the relaunch and a user who never saw the first dialog must still see it.
 */
const RestoreDegradationList: React.FC<{ degradations: RestoreResultSummary['degradations'] }> = ({ degradations }) => {
  const { t } = useTranslation()
  if (degradations.length === 0) return null
  return (
    <div data-testid="v2-restore-degradations">
      <div className="font-medium">{t('settings.data.backup.v2.restore.summary.degraded')}</div>
      <ul className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto">
        {degradations.map((item) => (
          <li key={`${item.kind}:${item.scope}:${item.detail ?? ''}`} className="break-all">
            <span className="text-foreground-secondary">[{item.scope}]</span> {item.count}
            <div className="text-foreground-secondary text-xs">{t(restoreDegradationI18nKeys[item.kind])}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

type Props = PopupInjectedProps<Record<string, never>>

type RestorePhase =
  | 'idle'
  | 'selecting-archive'
  | 'ready'
  | 'confirming'
  | 'relaunching'
  | 'ready-with-error'
  | 'outcome'

type RestoreOutcome = Extract<RestoreStatus, { readonly state: 'completed' | 'failed' | 'expired' }>

/**
 * V2 restore popup. A sealed restore waits here for user-confirmed relaunch;
 * backup.restore_status recovers pending or terminal state after reconstruction.
 */
const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const { t } = useTranslation()
  const { startRestore } = useBackupV2()
  const [phase, setPhase] = useState<RestorePhase>('idle')
  const [archivePath, setArchivePath] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [summary, setSummary] = useState<RestoreResultSummary | null>(null)
  const [summaryUnavailable, setSummaryUnavailable] = useState(false)
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null)
  const [relaunchError, setRelaunchError] = useState(false)

  const busy = phase === 'selecting-archive' || phase === 'confirming' || phase === 'relaunching'
  const canClose = phase !== 'relaunching'
  const hasRelaunchDisclosure = summary !== null || summaryUnavailable

  useIpcOn('backup.restore_summary', (nextSummary) => {
    setSummary(nextSummary)
    setSummaryUnavailable(false)
  })

  useEffect(() => {
    if (!open) return
    setPhase('idle')
    setArchivePath(null)
    setErrorMessage(null)
    setErrorCode(null)
    setSummary(null)
    setSummaryUnavailable(false)
    setOutcome(null)
    setRelaunchError(false)
    void (async () => {
      try {
        const status = await ipcApi.request('backup.restore_status')
        if (status.state === 'pending') {
          setSummary(status.summary ?? null)
          setSummaryUnavailable(status.summary === undefined)
          setPhase('relaunching')
        } else if (status.state !== 'none') {
          setOutcome(status)
          setPhase('outcome')
        }
      } catch (error) {
        logger.warn('backup.restore_status query failed', error as Error)
      }
    })()
  }, [open])

  const onClose = () => {
    if (!canClose) return
    resolve({})
  }

  const onSelectArchive = async () => {
    if (phase !== 'idle' && phase !== 'ready' && phase !== 'ready-with-error') return
    setPhase('selecting-archive')
    setErrorMessage(null)
    setErrorCode(null)
    try {
      const selected = await window.api.file.select({
        properties: ['openFile'],
        filters: [{ name: t('settings.data.backup.v2.file_filter'), extensions: ['cherrybackup'] }]
      })
      const path = selected?.[0]?.path
      if (!path) {
        setPhase(archivePath ? 'ready' : 'idle')
        return
      }
      setArchivePath(path)
      setPhase('ready')
    } catch (error) {
      logger.error('file.select failed', error as Error)
      setErrorMessage(error instanceof Error ? error.message : String(error))
      // Keep error visible on idle (no archive yet) as well as ready-with-error.
      setPhase(archivePath ? 'ready-with-error' : 'idle')
    }
  }

  const onConfirmRestore = async () => {
    if (!archivePath || (phase !== 'ready' && phase !== 'ready-with-error')) return
    setPhase('confirming')
    const confirmed = await popup.confirm({
      title: t('restore.confirm.label'),
      content: t('settings.data.backup.v2.restore.confirm_content'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true,
      okButtonProps: { danger: true }
    })
    if (!confirmed) {
      setPhase('ready')
      return
    }

    setPhase('relaunching')
    setErrorMessage(null)
    setErrorCode(null)
    setSummary(null)
    setSummaryUnavailable(false)
    try {
      await startRestore(archivePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = error instanceof IpcError ? error.code : null
      logger.warn('v2 restore failed', error as Error)
      // The default restore path (backfill + SKIP-on-conflict) never raises a strategy
      // error; an explicit OVERWRITE/RENAME/FIELD_MERGE strategy (no UI sends one yet)
      // surfaces as BACKUP_MERGE_STRATEGY_UNSUPPORTED (or the raw
      // MergeStrategyNotImplementedError name). Kept as a defensive branch.
      const skipOnly =
        code === backupErrorCodes.MERGE_STRATEGY_UNSUPPORTED ||
        (error as { name?: string }).name === 'MergeStrategyNotImplementedError'
      setErrorMessage(skipOnly ? t('settings.data.backup.v2.restore.skip_only') : message)
      setErrorCode(code)
      setPhase('ready-with-error')
      return
    }

    // Pull the journal in case the live summary broadcast was missed.
    try {
      const status = await ipcApi.request('backup.restore_status')
      if (status.state === 'pending') {
        if (status.summary) {
          setSummary(status.summary)
          setSummaryUnavailable(false)
        } else {
          setSummaryUnavailable(true)
        }
      } else {
        logger.warn(`backup.restore_status returned '${status.state}' after sealing`)
        setSummaryUnavailable(true)
      }
    } catch (error) {
      // Keep the sealed restore restartable without inventing an empty summary.
      logger.warn('backup.restore_status post-seal query failed', error as Error)
      setSummaryUnavailable(true)
    }
  }

  const onAcknowledge = async () => {
    try {
      await ipcApi.request('backup.restore_acknowledge')
    } catch (error) {
      // Non-fatal: the journal stays and the outcome reports again on next open.
      logger.warn('backup.restore_acknowledge failed', error as Error)
    }
    setOutcome(null)
    setPhase('idle')
  }

  const onRestart = async () => {
    setRelaunchError(false)
    try {
      await ipcApi.request('backup.restore_relaunch')
    } catch (error) {
      // backup.restore_relaunch should not throw in normal operation; if it does, surface the
      // failure so the user is not stuck in `relaunching` (canClose=false) with no
      // recourse — the Restart button stays available for retry.
      logger.error('backup.restore_relaunch failed', error as Error)
      setRelaunchError(true)
    }
  }

  const showPickError = (phase === 'idle' || phase === 'selecting-archive') && Boolean(errorMessage)

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        closeOnOverlayClick={false}
        showCloseButton={canClose}
        className="sm:max-w-[520px]"
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (!canClose) event.preventDefault()
        }}>
        <DialogHeader>
          <DialogTitle>{t('restore.title')}</DialogTitle>
        </DialogHeader>

        {(phase === 'idle' || phase === 'selecting-archive') && (
          <div className="flex flex-col gap-3 text-sm">
            <div>{t('settings.data.backup.v2.restore.pick_prompt')}</div>
            <Button variant="outline" disabled={busy} onClick={() => void onSelectArchive()}>
              {t('restore.confirm.button')}
            </Button>
            {showPickError ? (
              <div className="mt-1 text-destructive">
                {t('settings.data.backup.v2.restore.failure')}
                {errorMessage ? <div className="mt-1 break-all">{errorMessage}</div> : null}
              </div>
            ) : null}
          </div>
        )}

        {(phase === 'ready' || phase === 'confirming' || phase === 'ready-with-error') && archivePath && (
          <div className="flex flex-col gap-2 text-sm">
            <div>{t('settings.data.backup.v2.restore.selected')}</div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onSelectArchive()}
              className="cursor-pointer break-all rounded border border-border bg-background-subtle px-3 py-2 text-left transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-60">
              {archivePath}
            </button>
          </div>
        )}

        {phase === 'relaunching' && !hasRelaunchDisclosure && (
          <div className="py-4 text-center text-sm">{t('settings.data.backup.v2.restore.relaunching')}</div>
        )}

        {phase === 'relaunching' && hasRelaunchDisclosure && (
          <div className="flex flex-col gap-3 text-sm" data-testid="v2-restore-summary">
            {/* Future tense is mandatory: promotion runs at next boot and preboot may
                still expire the whole batch (RestoreResultSummary contract). */}
            <div>{t('settings.data.backup.v2.restore.summary.pending_hint')}</div>
            {summary ? (
              <>
                <div>
                  <div className="font-medium">{t('settings.data.backup.v2.restore.summary.will_restore')}</div>
                  {summary.toRestore.length === 0 ? (
                    <div className="mt-1 text-foreground-secondary">
                      {t('settings.data.backup.v2.restore.summary.none')}
                    </div>
                  ) : (
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {summary.toRestore.map((item) => (
                        <li key={item.kind} className="flex justify-between">
                          <span>{t(`settings.data.backup.v2.restore.summary.kind.${item.kind}`)}</span>
                          <span>{item.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {summary.toSkip.length > 0 && (
                  <div>
                    <div className="font-medium">{t('settings.data.backup.v2.restore.summary.will_skip')}</div>
                    <ul className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto">
                      {summary.toSkip.map((item) => (
                        <li key={`${item.kind}:${item.id}`} className="break-all">
                          <span className="text-foreground-secondary">
                            [{t(`settings.data.backup.v2.restore.summary.kind.${item.kind}`)}]
                          </span>{' '}
                          {item.id}
                          <div className="text-foreground-secondary text-xs">
                            {t(restoreSkipReasonI18nKeys[item.reasonCode])}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <RestoreDegradationList degradations={summary.degradations} />
              </>
            ) : (
              <div className="text-foreground-secondary">
                {t('settings.data.backup.v2.restore.summary.unavailable')}
              </div>
            )}
            {relaunchError && (
              <div className="text-destructive">{t('settings.data.backup.v2.restore.summary.relaunch_failed')}</div>
            )}
          </div>
        )}

        {phase === 'outcome' && outcome && (
          <div className="flex flex-col gap-2 text-sm" data-testid="v2-restore-outcome">
            <div className={outcome.state === 'completed' ? undefined : 'text-destructive'}>
              {t(`settings.data.backup.v2.restore.outcome.${outcome.state}`)}
            </div>
            {outcome.state !== 'completed' && outcome.reason ? (
              <div className="break-all text-foreground-secondary text-xs">{outcome.reason}</div>
            ) : null}
            {/* A completed restore can still have lost data — disclose it BEFORE the
                acknowledgement clears the journal, or the loss is never reported at all. */}
            {outcome.state === 'completed' && outcome.summary ? (
              <RestoreDegradationList degradations={outcome.summary.degradations} />
            ) : null}
          </div>
        )}

        {phase === 'ready-with-error' && (
          <div className="mt-3 text-destructive text-sm">
            {t('settings.data.backup.v2.restore.failure')}
            {errorCode ? <div className="mt-1 font-mono text-xs">{errorCode}</div> : null}
            {errorMessage ? <div className="mt-1 break-all">{errorMessage}</div> : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={!canClose || busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {(phase === 'ready' || phase === 'ready-with-error' || phase === 'confirming') && (
            <Button disabled={busy || !archivePath} onClick={() => void onConfirmRestore()}>
              {t('common.confirm')}
            </Button>
          )}
          {phase === 'relaunching' && hasRelaunchDisclosure && (
            <Button data-testid="v2-restore-restart-button" onClick={() => void onRestart()}>
              {t('settings.data.backup.v2.restore.summary.restart_button')}
            </Button>
          )}
          {phase === 'outcome' && (
            <Button data-testid="v2-restore-acknowledge-button" onClick={() => void onAcknowledge()}>
              {t('settings.data.backup.v2.restore.outcome.acknowledge_button')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const RestoreV2Popup = createPopup<Record<string, never>, Record<string, never>>(PopupContainer, {
  dismissResult: {}
})

export default RestoreV2Popup
