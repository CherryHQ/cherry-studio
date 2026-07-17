import {
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
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import dayjs from 'dayjs'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('BackupExportV2Popup')

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

  const busy = phase === 'selecting-target' || phase === 'starting' || phase === 'running' || phase === 'cancelling'
  const canClose = !busy
  const canCancelExport = phase === 'running' && Boolean(backupId)

  useEffect(() => {
    if (!open) return
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
    setPhase('selecting-target')
    setErrorMessage(null)
    try {
      const defaultName = `cherry-studio-backup-${dayjs().format('YYYYMMDDHHmmss')}.cbu`
      const outputPath = await ipcApi.request('file.select_save', {
        defaultPath: defaultName,
        filters: [{ name: 'Cherry Backup', extensions: ['cbu'] }],
        title: t('backup.confirm.button')
      })
      if (!outputPath) {
        // Dialog cancel: no write, no request — back to idle.
        setPhase('idle')
        return
      }

      setPhase('starting')
      try {
        const result = await startBackup(preset, outputPath)
        setArchivePath(result.archivePath)
        setPhase('success')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = (error as { code?: string }).code
        const wasCancelled = code === 'BACKUP_CANCELLED' || cancelled || /cancelled/i.test(message)
        logger.warn('v2 export failed', error as Error)
        setErrorMessage(message)
        setPhase(wasCancelled ? 'cancelled' : 'failure')
      }
    } catch (error) {
      logger.error('file.select_save failed', error as Error)
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setPhase('failure')
    }
  }

  const onCancelExport = async () => {
    if (!canCancelExport) return
    setPhase('cancelling')
    try {
      await cancelRef.current.cancelBackup()
    } catch (error) {
      logger.warn('cancelBackup failed', error as Error)
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setPhase('failure')
    }
  }

  const progressPercent =
    progress && progress.total > 0 ? Math.min(100, Math.floor((progress.current / progress.total) * 100)) : 0

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
            <RadioGroup
              value={preset}
              onValueChange={(value) => setPreset(value as Preset)}
              className="flex flex-col gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="full" id="backup-preset-full" />
                {t('settings.data.backup.v2.preset.full')}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="lite" id="backup-preset-lite" />
                {t('settings.data.backup.v2.preset.lite')}
              </label>
            </RadioGroup>
          </div>
        )}

        {(phase === 'selecting-target' || phase === 'starting' || phase === 'running' || phase === 'cancelling') && (
          <div className="flex flex-col items-center gap-4 py-5 text-center">
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
              {(phase === 'running' || phase === 'cancelling') &&
                (progress
                  ? `${progress.phase} ${progress.current}/${progress.total}${progress.message ? ` — ${progress.message}` : ''}`
                  : t('settings.data.backup.v2.export.running'))}
            </div>
          </div>
        )}

        {phase === 'success' && (
          <div className="text-sm">
            {t('settings.data.backup.v2.export.success')}
            {archivePath ? <div className="mt-2 break-all text-foreground-muted">{archivePath}</div> : null}
          </div>
        )}

        {phase === 'cancelled' && <div className="text-sm">{t('settings.data.backup.v2.export.cancelled')}</div>}

        {phase === 'failure' && (
          <div className="text-destructive text-sm">
            {t('settings.data.backup.v2.export.failure')}
            {errorMessage ? <div className="mt-2 break-all">{errorMessage}</div> : null}
          </div>
        )}

        <DialogFooter>
          {canCancelExport || phase === 'cancelling' ? (
            <Button variant="outline" disabled={!canCancelExport} onClick={() => void onCancelExport()}>
              {t('common.cancel')}
            </Button>
          ) : (
            <Button variant="outline" disabled={!canClose} onClick={onClose}>
              {canClose ? t('common.close') : t('common.cancel')}
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
