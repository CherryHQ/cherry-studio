import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useBackupV2 } from '@renderer/hooks/useBackupV2'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { createPopup, popup, type PopupInjectedProps } from '@renderer/services/popup'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { RestoreResultSummary } from '@shared/types/backup'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('RestoreV2Popup')

type Props = PopupInjectedProps<Record<string, never>>

type RestorePhase = 'idle' | 'selecting-archive' | 'ready' | 'confirming' | 'relaunching' | 'ready-with-error'

/**
 * V2 restore popup. No restore progress stream — after confirm we enter
 * `relaunching` BEFORE startRestore (main may exit via app.exit before the
 * IPC response returns). Success must not toast / finally-reset; only reject
 * returns to a usable error state.
 *
 * idle → selecting-archive → ready → confirming → relaunching
 *                                      └────────→ ready (confirm cancel)
 * relaunching → ready-with-error
 *
 * In `relaunching`, a `backup.restore_summary` event (broadcast by main after
 * seal, before relaunch — full-restore-plan §10.5) switches the body to the
 * disclosure summary (future-tense: will restore / will skip) plus a restart
 * button (`app.relaunch`). Without the event the plain relaunching text shows,
 * which also covers the pre-wiring spine that relaunches unconditionally.
 */
const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const { t } = useTranslation()
  const { startRestore } = useBackupV2()
  const [phase, setPhase] = useState<RestorePhase>('idle')
  const [archivePath, setArchivePath] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [summary, setSummary] = useState<RestoreResultSummary | null>(null)

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

    // Enter relaunching BEFORE the request — main may exit first.
    setPhase('relaunching')
    setErrorMessage(null)
    setErrorCode(null)
    setSummary(null)
    try {
      await startRestore(archivePath)
      // Success path: process is relaunching. Do not toast, resolve, or reset.
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
            <Button data-testid="v2-restore-restart-button" onClick={() => void ipcApi.request('app.relaunch')}>
              {t('settings.data.backup.v2.restore.summary.restart_button')}
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
