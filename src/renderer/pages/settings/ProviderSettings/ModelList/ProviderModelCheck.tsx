import { Button } from '@cherrystudio/ui'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import ModelCheckDialog from './ModelCheckDialog'
import { useModelListHealthRun } from './modelListHealthContext'

export default function ProviderModelCheck() {
  const { t } = useTranslation()
  const health = useModelListHealthRun()
  const label = t(health.isModelChecking ? 'settings.models.check.checking' : 'settings.models.check.button_caption')

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={modelListClasses.fetchActionButton}
        aria-label={label}
        disabled={health.models.length === 0 || health.isModelChecking}
        onClick={health.openModelCheck}>
        {health.isModelChecking ? <Loader2 className="motion-safe:animate-spin" /> : null}
        <span>{label}</span>
      </Button>
      <ModelCheckDialog />
    </>
  )
}
