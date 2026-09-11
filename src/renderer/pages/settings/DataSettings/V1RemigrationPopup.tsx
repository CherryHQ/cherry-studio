import { SaveIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Checkbox, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'

import BackupPopup from './BackupPopup'

type Props = PopupInjectedProps<void>
type WizardStep = 0 | 1 | 2
const CONFIRM_COUNTDOWN_SECONDS = 5

const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<WizardStep>(0)
  const [acknowledged, setAcknowledged] = useState(false)
  const [deletionAcknowledged, setDeletionAcknowledged] = useState(false)
  const [retainedDataAcknowledged, setRetainedDataAcknowledged] = useState(false)
  const [backupAcknowledged, setBackupAcknowledged] = useState(false)
  const [backupPopupOpen, setBackupPopupOpen] = useState(false)
  const [confirmCountdown, setConfirmCountdown] = useState(CONFIRM_COUNTDOWN_SECONDS)
  const [submitting, setSubmitting] = useState(false)
  const allRisksAcknowledged = acknowledged && deletionAcknowledged && retainedDataAcknowledged

  useEffect(() => {
    if (step !== 2) return

    const interval = window.setInterval(() => {
      setConfirmCountdown((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(interval)
          return 0
        }
        return seconds - 1
      })
    }, 1000)

    return () => window.clearInterval(interval)
  }, [step])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !submitting) resolve()
  }

  const handleConfirm = async () => {
    if (step !== 2 || !allRisksAcknowledged || confirmCountdown > 0 || submitting) return

    setSubmitting(true)
    try {
      await ipcApi.request('app.migration_v2.rerun')
    } catch {
      setSubmitting(false)
      toast.error(t('settings.data.v1_remigration.error'))
    }
  }

  const handleBackup = async () => {
    if (backupPopupOpen) return

    setBackupPopupOpen(true)
    try {
      await BackupPopup.show({ forceFullBackup: true })
    } finally {
      setBackupPopupOpen(false)
    }
  }

  const handleNext = () => {
    if (step === 0 && allRisksAcknowledged) setStep(1)
    if (step === 1 && backupAcknowledged) {
      setConfirmCountdown(CONFIRM_COUNTDOWN_SECONDS)
      setStep(2)
    }
  }

  const handleBack = () => {
    if (step === 2) setStep(1)
    if (step === 1) setStep(0)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        size="default"
        showCloseButton={!submitting}
        closeOnOverlayClick={!submitting}
        aria-busy={submitting || undefined}>
        <DialogHeader>
          <DialogTitle>{t('settings.data.v1_remigration.dialog_title')}</DialogTitle>
        </DialogHeader>

        <div>
          {step === 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="v1-remigration-deletion-acknowledgement"
                  size="sm"
                  checked={deletionAcknowledged}
                  onCheckedChange={(checked) => setDeletionAcknowledged(checked === true)}
                />
                <label
                  htmlFor="v1-remigration-deletion-acknowledgement"
                  className="cursor-pointer text-foreground text-sm leading-relaxed">
                  {t('settings.data.v1_remigration.final_message')}
                </label>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="v1-remigration-retained-data-acknowledgement"
                  size="sm"
                  checked={retainedDataAcknowledged}
                  onCheckedChange={(checked) => setRetainedDataAcknowledged(checked === true)}
                />
                <label
                  htmlFor="v1-remigration-retained-data-acknowledgement"
                  className="cursor-pointer text-foreground text-sm leading-relaxed">
                  {t('settings.data.v1_remigration.final_retained')}
                </label>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="v1-remigration-acknowledgement"
                  size="sm"
                  checked={acknowledged}
                  onCheckedChange={(checked) => setAcknowledged(checked === true)}
                />
                <label
                  htmlFor="v1-remigration-acknowledgement"
                  className="cursor-pointer text-foreground text-sm leading-relaxed">
                  {t('settings.data.v1_remigration.acknowledgement')}
                </label>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm leading-relaxed">
                {t('settings.data.v1_remigration.backup_message')}
              </p>

              <Button
                variant="outline"
                loading={backupPopupOpen}
                disabled={backupPopupOpen}
                onClick={() => void handleBackup()}>
                <SaveIcon size={14} />
                {t('settings.data.v1_remigration.backup_button')}
              </Button>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="v1-remigration-backup-acknowledgement"
                  size="sm"
                  checked={backupAcknowledged}
                  onCheckedChange={(checked) => setBackupAcknowledged(checked === true)}
                />
                <label
                  htmlFor="v1-remigration-backup-acknowledgement"
                  className="cursor-pointer text-foreground text-sm leading-relaxed">
                  {t('settings.data.v1_remigration.backup_acknowledgement')}
                </label>
              </div>
            </div>
          )}

          {step === 2 && (
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t('settings.data.v1_remigration.final_confirmation')}
            </p>
          )}
        </div>

        <DialogFooter>
          {step > 0 && (
            <Button className="sm:mr-auto" variant="outline" disabled={submitting} onClick={handleBack}>
              {t('settings.data.v1_remigration.back')}
            </Button>
          )}
          <Button variant="outline" disabled={submitting} onClick={() => resolve()}>
            {t('common.cancel')}
          </Button>
          {step < 2 ? (
            <Button
              variant="emphasis"
              disabled={(step === 0 && !allRisksAcknowledged) || (step === 1 && !backupAcknowledged)}
              onClick={handleNext}>
              {t('settings.data.v1_remigration.next')}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={submitting || !allRisksAcknowledged || confirmCountdown > 0}
              loading={submitting}
              onClick={handleConfirm}>
              {confirmCountdown > 0
                ? t('settings.data.v1_remigration.confirm_countdown', { seconds: confirmCountdown })
                : t('settings.data.v1_remigration.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const V1RemigrationPopup = createPopup<Record<string, never>, void>(PopupContainer)

export default V1RemigrationPopup
