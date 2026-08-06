import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { SaveIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import BackupPopup from './BackupPopup'

type Props = PopupInjectedProps<void>
type WizardStep = 0 | 1 | 2

const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<WizardStep>(0)
  const [acknowledged, setAcknowledged] = useState(false)
  const [backupPopupOpen, setBackupPopupOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const steps = [
    t('settings.data.v1_remigration.steps.risk'),
    t('settings.data.v1_remigration.steps.backup'),
    t('settings.data.v1_remigration.steps.confirm')
  ]

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !submitting) resolve()
  }

  const handleConfirm = async () => {
    if (step !== 2 || !acknowledged || submitting) return

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
    if (step === 0 && acknowledged) setStep(1)
    if (step === 1) setStep(2)
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
          <DialogDescription>
            {t('settings.data.v1_remigration.step_label', {
              current: step + 1,
              total: steps.length,
              name: steps[step]
            })}
          </DialogDescription>
        </DialogHeader>

        <div>
          {step === 0 && (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm leading-relaxed">
                {t('settings.data.v1_remigration.risk_message')}
              </p>

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
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <Alert type="error" showIcon>
                <span className="text-sm leading-relaxed">{t('settings.data.v1_remigration.final_message')}</span>
              </Alert>

              <p className="text-muted-foreground text-sm leading-relaxed">
                {t('settings.data.v1_remigration.final_retained')}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => resolve()}>
            {t('common.cancel')}
          </Button>
          {step > 0 && (
            <Button variant="outline" disabled={submitting} onClick={handleBack}>
              {t('settings.data.v1_remigration.back')}
            </Button>
          )}
          {step < 2 ? (
            <Button variant="emphasis" disabled={step === 0 && !acknowledged} onClick={handleNext}>
              {t('settings.data.v1_remigration.next')}
            </Button>
          ) : (
            <Button variant="destructive" disabled={submitting} loading={submitting} onClick={handleConfirm}>
              {t('settings.data.v1_remigration.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const V1RemigrationPopup = createPopup<Record<string, never>, void>(PopupContainer)

export default V1RemigrationPopup
