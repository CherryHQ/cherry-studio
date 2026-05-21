import { Button } from '@cherrystudio/ui'
import OnboardingPage from '@renderer/pages/onboarding/OnboardingPage'
import { X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

const ComponentLabOnboardingSettings: FC = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleClose = useCallback(() => setOpen(false), [])

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-foreground-secondary text-sm">{t('settings.componentLab.onboarding.description')}</p>
      <div>
        <Button variant="default" onClick={() => setOpen(true)}>
          {t('settings.componentLab.onboarding.openPreview')}
        </Button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 bg-background">
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-4 right-4 z-10 flex items-center gap-1 rounded-md bg-secondary px-3 py-2 text-secondary-foreground text-sm shadow-sm hover:bg-secondary-hover">
            <X size={14} />
            {t('settings.componentLab.onboarding.closePreview')}
          </button>
          <OnboardingPage previewMode onComplete={handleClose} />
        </div>
      )}
    </div>
  )
}

export default ComponentLabOnboardingSettings
