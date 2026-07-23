import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useBackupV2 } from '@renderer/hooks/useBackupV2'
import { ipcApi } from '@renderer/ipc'
import { createPopup, popup, type PopupInjectedProps } from '@renderer/services/popup'
import type { BackupProgressUpdate } from '@shared/types/backup'
import dayjs from 'dayjs'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('BackupExportV2Popup')

/** If cancel never settles the startBackup promise, unlock the dialog. */
const CANCEL_TIMEOUT_MS = 15_000

type Props = PopupInjectedProps<Record<string, never>>

type ExportPhase =
  | 'idle'
  | 'selecting-target'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'success'
  | 'cancelled'
  | 'failure'

type Preset = 'full' | 'lite'

const PROGRESS_PHASE_KEYS: Record<BackupProgressUpdate['phase'], string> = {
  preflight: 'settings.data.backup.v2.export.phase.preflight',
  collect: 'settings.data.backup.v2.export.phase.collect',
  snapshot: 'settings.data.backup.v2.export.phase.snapshot',
  archive: 'settings.data.backup.v2.export.phase.archive',
  quiesce: 'settings.data.backup.v2.export.phase.quiesce',
  merge: 'settings.data.backup.v2.export.phase.merge',
  verify: 'settings.data.backup.v2.export.phase.verify',
  journal: 'settings.data.backup.v2.export.phase.journal',
  relaunch: 'settings.data.backup.v2.export.phase.relaunch'
}

/**
 * V2 export popup. Terminal states are driven by the startBackup promise, never
 * by progress current/total (which only describe the active phase).
 *
 * idle → selecting-target → starting → running → success | cancelled | failure
 *                       └──────────────────────────────→ idle (dialog cancel)
 * running → cancelling → cancelled | failure
 */
const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const { t } = useTranslation()
  const { startBackup, cancelBackup, backupId, progress, cancelled } = useBackupV2()
  const [phase, setPhase] = useState<ExportPhase>('idle')
  const [preset, setPreset] = useState<Preset>('full')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [archivePath, setArchivePath] = useState<string | null>(null)
  // Keep the latest cancelBackup/backupId without re-subscribing effects.
  const cancelRef = useRef({ cancelBackup, backupId })
  cancelRef.current = { cancelBackup, backupId }
  /** Bumped to ignore stale startBackup settle after timeout / remount. */
  const runIdRef = useRef(0)
  const cancelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const busy = phase === 'selecting-target' || phase === 'starting' || phase === 'running' || phase === 'cancelling'
  const canClose = !busy
  const canCancelExport = phase === 'running' && Boolean(backupId)

  const clearCancelTimeout = () => {
    if (cancelTimeoutRef.current !== null) {
      clearTimeout(cancelTimeoutRef.current)
      cancelTimeoutRef.current = null
    }
  }

  useEffect(() => {
    return () => clearCancelTimeout()
  }, [])

  useEffect(() => {
    if (!open) return
    runIdRef.current += 1
    clearCancelTimeout()
    setPhase('idle')
    setPreset('full')
    setErrorMessage(null)
    setArchivePath(null)
  }, [open])

  // Progress ticks move starting → running once backupId is known.
  useEffect(() => {
    if (phase === 'starting' && backupId) {
      setPhase('running')
    }
  }, [phase, backupId])

  const onClose = () => {
    if (!canClose) return
    resolve({})
  }

  const onStart = async () => {
    if (phase !== 'idle') return
    const runId = ++runIdRef.current
    setPhase('selecting-target')
    setErrorMessage(null)
    try {
      const defaultName = `${dayjs().format('YYYYMMDDHHmmss')}.cherrybackup`
      const outputPath = await ipcApi.request('file.select_save', {
        defaultPath: defaultName,
        filters: [{ name: t('settings.data.backup.v2.file_filter'), extensions: ['cherrybackup'] }],
        title: t('settings.data.backup.v2.export.save_dialog_title')
      })
      if (runId !== runIdRef.current) return
      if (!outputPath) {
        // Dialog cancel: no write, no request — back to idle.
        setPhase('idle')
        return
      }

      setPhase('starting')
      try {
        // Default no-clobber. If the save dialog target already exists, main refuses
        // with BACKUP_OUTPUT_PATH_EXISTS — confirm overwrite then retry with
        // overwrite=true (main keeps path/TOCTOU guards).
        let result: Awaited<ReturnType<typeof startBackup>>
        try {
          result = await startBackup(preset, outputPath, false)
        } catch (firstError) {
          const code = (firstError as { code?: string }).code
          if (code !== 'BACKUP_OUTPUT_PATH_EXISTS') throw firstError
          if (runId !== runIdRef.current) return
          const confirmed = await popup.confirm({
            title: t('settings.data.backup.v2.export.overwrite_confirm_title'),
            content: t('settings.data.backup.v2.export.overwrite_confirm_content'),
            okText: t('common.confirm'),
            cancelText: t('common.cancel')
          })
          if (runId !== runIdRef.current) return
          if (!confirmed) {
            setPhase('idle')
            return
          }
          result = await startBackup(preset, outputPath, true)
        }
        if (runId !== runIdRef.current) return
        clearCancelTimeout()
        setArchivePath(result.archivePath)
        setPhase('success')
      } catch (error) {
        if (runId !== runIdRef.current) return
        clearCancelTimeout()
        const message = error instanceof Error ? error.message : String(error)
        const code = (error as { code?: string }).code
        const wasCancelled = code === 'BACKUP_CANCELLED' || cancelled || /cancelled/i.test(message)
        logger.warn('v2 export failed', error as Error)
        setErrorMessage(message)
        setPhase(wasCancelled ? 'cancelled' : 'failure')
      }
    } catch (error) {
      if (runId !== runIdRef.current) return
      logger.error('file.select_save failed', error as Error)
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setPhase('failure')
    }
  }

  const onCancelExport = async () => {
    if (!canCancelExport) return
    setPhase('cancelling')
    clearCancelTimeout()
    // If startBackup never settles after cancel, unlock so the user is not stuck.
    cancelTimeoutRef.current = setTimeout(() => {
      runIdRef.current += 1
      setErrorMessage(t('settings.data.backup.v2.export.cancel_timeout'))
      setPhase('failure')
      cancelTimeoutRef.current = null
    }, CANCEL_TIMEOUT_MS)
    try {
      await cancelRef.current.cancelBackup()
      // Stay in cancelling until startBackup rejects/resolves — do not force failure here.
    } catch (error) {
      // Cancel IPC failed but export may still be running; wait for startBackup settle.
      logger.warn('cancelBackup failed', error as Error)
    }
  }

  const progressPercent =
    progress && progress.total > 0 ? Math.min(100, Math.floor((progress.current / progress.total) * 100)) : 0

  const progressLabel =
    progress != null
      ? `${t(PROGRESS_PHASE_KEYS[progress.phase])} ${progress.current}/${progress.total}`
      : t('settings.data.backup.v2.export.running')

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
          <DialogTitle>{t('backup.title')}</DialogTitle>
        </DialogHeader>

        {phase === 'idle' && (
          <div className="flex flex-col gap-4">
            <div>{t('backup.content')}</div>
            <Alert type="warning" showIcon message={t('backup.credentials_warning')} />
            <RadioGroup
              value={preset}
              onValueChange={(value) => setPreset(value as Preset)}
              className="flex flex-col gap-2">
              <label htmlFor="backup-preset-full" className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="full" id="backup-preset-full" />
                {t('settings.data.backup.v2.preset.full')}
              </label>
              <label htmlFor="backup-preset-lite" className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="lite" id="backup-preset-lite" />
                {t('settings.data.backup.v2.preset.lite')}
              </label>
            </RadioGroup>
          </div>
        )}

        {(phase === 'selecting-target' || phase === 'starting' || phase === 'running' || phase === 'cancelling') && (
          <div className="flex flex-col items-center gap-4 py-5 text-center" aria-live="polite">
            <CircularProgress
              value={progressPercent}
              size={72}
              strokeWidth={6}
              showLabel
              renderLabel={(value) => `${value}%`}
            />
            <div className="text-sm">
              {phase === 'selecting-target' && t('settings.data.backup.v2.export.selecting')}
              {phase === 'starting' && t('settings.data.backup.v2.export.starting')}
              {(phase === 'running' || phase === 'cancelling') && progressLabel}
            </div>
          </div>
        )}

        {phase === 'success' && (
          <div className="text-sm" role="status" aria-live="polite">
            {t('settings.data.backup.v2.export.success')}
            {archivePath ? <div className="mt-2 break-all text-foreground-muted">{archivePath}</div> : null}
          </div>
        )}

        {phase === 'cancelled' && (
          <div className="text-sm" role="status" aria-live="polite">
            {t('settings.data.backup.v2.export.cancelled')}
          </div>
        )}

        {phase === 'failure' && (
          <div className="text-destructive text-sm" role="alert">
            {t('settings.data.backup.v2.export.failure')}
            {errorMessage ? <div className="mt-2 break-all">{errorMessage}</div> : null}
          </div>
        )}

        <DialogFooter>
          {(phase === 'running' || phase === 'cancelling') && (
            <Button variant="outline" disabled={!canCancelExport} onClick={() => void onCancelExport()}>
              {t('common.cancel')}
            </Button>
          )}
          {(phase === 'idle' || phase === 'selecting-target' || phase === 'starting') && (
            <Button variant="outline" disabled={!canClose} onClick={onClose}>
              {t('common.close')}
            </Button>
          )}
          {phase === 'idle' && <Button onClick={() => void onStart()}>{t('backup.confirm.button')}</Button>}
          {(phase === 'success' || phase === 'cancelled' || phase === 'failure') && (
            <Button onClick={onClose}>{t('common.close')}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const BackupExportV2Popup = createPopup<Record<string, never>, Record<string, never>>(PopupContainer, {
  dismissResult: {}
})

export default BackupExportV2Popup
