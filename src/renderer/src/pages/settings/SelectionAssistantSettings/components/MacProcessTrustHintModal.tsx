import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import type { FC } from 'react'
import { Trans, useTranslation } from 'react-i18next'

interface MacProcessTrustHintModalProps {
  open: boolean
  onClose: () => void
}

const MacProcessTrustHintModal: FC<MacProcessTrustHintModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation()

  const handleOpenAccessibility = () => {
    void window.api.shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    onClose()
  }

  const handleConfirm = async () => {
    void window.api.mac.requestProcessTrust()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('selection.settings.enable.mac_process_trust_hint.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-4 text-foreground text-sm">
          <p className="m-0">
            <Trans i18nKey="selection.settings.enable.mac_process_trust_hint.description.0" />
          </p>
          <p className="m-0">
            <Trans i18nKey="selection.settings.enable.mac_process_trust_hint.description.1" />
          </p>
          <p className="m-0">
            <Trans i18nKey="selection.settings.enable.mac_process_trust_hint.description.2" />
          </p>
        </div>
        <div className="flex w-full items-center justify-between">
          <Button
            variant="ghost"
            className="text-[var(--color-foreground-muted)] text-xs"
            onClick={handleOpenAccessibility}>
            {t('selection.settings.enable.mac_process_trust_hint.button.open_accessibility_settings')}
          </Button>
          <Button onClick={handleConfirm}>
            {t('selection.settings.enable.mac_process_trust_hint.button.go_to_settings')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default MacProcessTrustHintModal
