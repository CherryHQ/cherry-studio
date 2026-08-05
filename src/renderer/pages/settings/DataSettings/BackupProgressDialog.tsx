import { Button, CircularProgress, Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { useIpcOn } from '@renderer/ipc'
import type { BackupProgressStage } from '@shared/ipc/schemas/backup'
import type { EventPayload } from '@shared/ipc/types'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type BackupProgress = EventPayload<'backup.progress'>
type RunningOperation = BackupProgress['operation']

/**
 * The stage order each operation walks, which is what turns a stage name into a
 * position. Kept here rather than in the contract because it is a presentation
 * concern: main reports where it *is*, and only the dialog needs to know how far
 * along that is.
 */
const EXPORT_STAGES: readonly BackupProgressStage[] = [
  'preparing',
  'snapshotting-db',
  'materializing-db',
  'capturing-resources',
  'verifying',
  // Destination exports only; a local one simply never reports it and finishes
  // at `verifying`, which the bar reads as the last position it was told about.
  'uploading'
]

const RESTORE_STAGES: readonly BackupProgressStage[] = ['admitting', 'materializing-db', 'planning', 'staging']

/**
 * Stage → translation key, spelled out so the i18n tooling can see every key
 * that ships. A template literal would hide them from extraction and from the
 * unused-key check.
 */
const STAGE_LABEL_KEYS: Record<BackupProgressStage, string> = {
  preparing: 'settings.data.backup.progress.stage.preparing',
  'snapshotting-db': 'settings.data.backup.progress.stage.snapshotting-db',
  'materializing-db': 'settings.data.backup.progress.stage.materializing-db',
  'capturing-resources': 'settings.data.backup.progress.stage.capturing-resources',
  verifying: 'settings.data.backup.progress.stage.verifying',
  uploading: 'settings.data.backup.progress.stage.uploading',
  admitting: 'settings.data.backup.progress.stage.admitting',
  planning: 'settings.data.backup.progress.stage.planning',
  staging: 'settings.data.backup.progress.stage.staging'
}

function stagesFor(operation: RunningOperation): readonly BackupProgressStage[] {
  return operation === 'export' ? EXPORT_STAGES : RESTORE_STAGES
}

/**
 * Fraction complete, blending the stage the operation is in with how far it has
 * walked the resource units inside it.
 *
 * The resource stage is most of an export's wall clock on a real profile, so
 * without the inner fraction the bar would sit still through the longest part.
 */
function completionOf(progress: BackupProgress): number {
  const stages = stagesFor(progress.operation)
  const index = stages.indexOf(progress.stage)
  if (index < 0) return 0

  const stageSpan = 1 / stages.length
  const within =
    progress.resources && progress.resources.total > 0 ? progress.resources.done / progress.resources.total : 0
  return Math.min(1, (index + within) * stageSpan)
}

/**
 * Live progress for an export or a restore preparation.
 *
 * Driven by events, not by a timer: `open` is owned by the caller that issued
 * the request, so the dialog closes when that request settles — a dropped
 * progress event costs a label, never a stuck dialog.
 */
const BackupProgressDialog: FC<{
  open: boolean
  operation: RunningOperation | null
  onCancel?: () => void
  cancelling?: boolean
}> = ({ open, operation, onCancel, cancelling = false }) => {
  const { t } = useTranslation()
  const [progress, setProgress] = useState<BackupProgress | null>(null)

  useIpcOn('backup.progress', (payload) => {
    if (payload.operation !== operation) return
    setProgress(payload)
  })

  // A new run starts from zero rather than from where the last one stopped.
  useEffect(() => {
    if (!open) setProgress(null)
  }, [open])

  const percent = progress ? Math.round(completionOf(progress) * 100) : 0
  const resources = progress?.resources

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-md"
        // The operation owns its own lifetime — a stray click or Escape must not
        // leave it running with nothing reporting it.
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {t(
              operation === 'export'
                ? 'settings.data.backup.progress.exporting'
                : 'settings.data.backup.progress.preparing'
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-5 py-2">
          <CircularProgress value={percent} size={96} />

          {/* Split and staggered: the stage label leads, the unit detail follows. */}
          <div className="flex min-h-[3.25rem] w-full flex-col items-center gap-1.5 text-center">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={progress?.stage ?? 'idle'}
                className="font-medium text-foreground text-sm"
                initial={{ opacity: 0, filter: 'blur(4px)' }}
                animate={{ opacity: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ type: 'spring', duration: 0.3, bounce: 0 }}>
                {progress ? t(STAGE_LABEL_KEYS[progress.stage]) : t('settings.data.backup.progress.starting')}
              </motion.p>
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {resources ? (
                <motion.p
                  className="max-w-full truncate text-foreground-tertiary text-xs"
                  initial={{ opacity: 0, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ type: 'spring', duration: 0.3, bounce: 0, delay: 0.1 }}>
                  {/* Tabular figures so the counter does not jitter as it climbs. */}
                  <span className="tabular-nums">
                    {resources.done} / {resources.total}
                  </span>
                  {' · '}
                  <span dir="ltr">{resources.livePath}</span>
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>

          {onCancel ? (
            <Button
              variant="outline"
              disabled={cancelling}
              onClick={onCancel}
              className="transition-transform active:scale-[0.96]">
              {t(cancelling ? 'settings.data.backup.progress.cancelling' : 'settings.data.backup.progress.stop')}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default BackupProgressDialog
