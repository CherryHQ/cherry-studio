import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useBackupV2 } from '@renderer/hooks/useBackupV2'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { createPopup, popup, type PopupInjectedProps } from '@renderer/services/popup'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { RestoreResultSummary, RestoreStatus } from '@shared/types/backup'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('RestoreV2Popup')

type Props = PopupInjectedProps<Record<string, never>>

type RestorePhase =
  | 'idle'
  | 'selecting-archive'
  | 'ready'
  | 'confirming'
  | 'relaunching'
  | 'ready-with-error'
  | 'outcome'

/**
 * V2 restore popup. No restore progress stream. Success must not toast /
 * finally-reset; only reject returns to a usable error state.
 *
 * idle → selecting-archive → ready → confirming → relaunching
 *                                      └────────→ ready (confirm cancel)
 * relaunching → ready-with-error
 *
 * In `relaunching`, the `backup.restore_summary` event (broadcast by main after
 * seal — full-restore-plan §10.5) switches the body to the disclosure summary
 * (future-tense: will restore / will skip) plus a restart button. Main never
 * relaunches on its own: this dialog owns the restart via `app.relaunch`, and a
 * resolved startRestore falls back to an empty summary so the button always
 * appears once the journal is staged.
 *
 * On open, `backup.restore_status` recovers state this dialog otherwise loses at
 * the relaunch boundary: `pending` (a sealed restore awaits relaunch — possibly
 * sealed from another window) re-enters `relaunching` with the empty-summary
 * fallback; a terminal state enters `outcome`, disclosing what the preboot
 * promotion actually did, and the acknowledge button clears the journal.
 */
const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const { t } = useTranslation()
  const { startRestore } = useBackupV2()
  const [phase, setPhase] = useState<RestorePhase>('idle')
  const [archivePath, setArchivePath] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [summary, setSummary] = useState<RestoreResultSummary | null>(null)
  const [outcome, setOutcome] = useState<RestoreStatus | null>(null)
  const [relaunchError, setRelaunchError] = useState(false)

  const busy = phase === 'selecting-archive' || phase === 'confirming' || phase === 'relaunching'
  const canClose = phase !== 'relaunching'

  // Disclosure summary (full-restore-plan §10.5): main broadcasts it from startRestore
  // after seal, before any relaunch — so it lands while we sit in `relaunching`.
  useIpcOn('backup.restore_summary', setSummary)

  useEffect(() => {
    if (!open) return
    setPhase('idle')
    setArchivePath(null)
    setErrorMessage(null)
    setErrorCode(null)
    setSummary(null)
    setOutcome(null)
    setRelaunchError(false)
    // Recover journal state across the relaunch boundary (and across windows).
    // Failure degrades to the plain idle view — the journal stays and reports again.
    void (async () => {
      try {
        const status = await ipcApi.request('backup.restore_status')
        if (status.state === 'pending') {
          setSummary((current) => current ?? { toRestore: [], toSkip: [] })
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

    // Enter relaunching before the request; the summary event lands during it.
    setPhase('relaunching')
    setErrorMessage(null)
    setErrorCode(null)
    setSummary(null)
    try {
      await startRestore(archivePath)
      // Journal staged; main now waits for our app.relaunch (it never relaunches on
      // its own). Belt: if the backup.restore_summary broadcast was missed, fall back
      // to an empty summary so the confirm-restart view always renders. Do not toast,
      // resolve, or reset.
      setSummary((current) => current ?? { toRestore: [], toSkip: [] })
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
      await ipcApi.request('app.relaunch')
    } catch (error) {
      // app.relaunch should not throw in normal operation; if it does, surface the
      // failure so the user is not stuck in `relaunching` (canClose=false) with no
      // recourse — the Restart button stays available for retry.
      logger.error('app.relaunch failed', error as Error)
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

        {phase === 'relaunching' && !summary && (
          <div className="py-4 text-center text-sm">{t('settings.data.backup.v2.restore.relaunching')}</div>
        )}

        {phase === 'relaunching' && summary && (
          <div className="flex flex-col gap-3 text-sm" data-testid="v2-restore-summary">
            {/* Future tense is mandatory: promotion runs at next boot and preboot may
                still expire the whole batch (RestoreResultSummary contract). */}
            <div>{t('settings.data.backup.v2.restore.summary.pending_hint')}</div>
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
                      <div className="text-foreground-secondary text-xs">{item.reason}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {relaunchError && (
              <div className="text-destructive">
                {t('settings.data.backup.v2.restore.summary.relaunch_failed')}
              </div>
            )}
          </div>
        )}

        {phase === 'outcome' && outcome && (
          <div className="flex flex-col gap-2 text-sm" data-testid="v2-restore-outcome">
            <div className={outcome.state === 'completed' ? undefined : 'text-destructive'}>
              {t(`settings.data.backup.v2.restore.outcome.${outcome.state}`)}
            </div>
            {outcome.reason ? (
              <div className="break-all text-foreground-secondary text-xs">{outcome.reason}</div>
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
          {phase === 'relaunching' && summary && (
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
