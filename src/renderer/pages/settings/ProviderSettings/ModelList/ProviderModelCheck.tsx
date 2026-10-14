import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'

import ModelCheckDialog from './ModelCheckDialog'
import { useModelListHealthRun } from './modelListHealthContext'

interface ProviderModelCheckProps {
  onAddModels?: () => void
}

export default function ProviderModelCheck({ onAddModels }: ProviderModelCheckProps) {
  const { t } = useTranslation()
  const health = useModelListHealthRun()
  const hasModels = health.models.length > 0
  const isAddModelsAction = !hasModels && !!onAddModels
  const label = t(health.isModelChecking ? 'settings.models.check.checking' : 'settings.models.check.button_caption')

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 rounded-lg border-border-subtle bg-background px-2.5 py-0 text-foreground text-sm leading-5 shadow-none hover:bg-accent/40 hover:text-foreground"
        aria-label={label}
        disabled={(!hasModels && !onAddModels) || health.isModelChecking}
        onClick={() => {
          if (isAddModelsAction) {
            onAddModels?.()
            return
          }
          health.openModelCheck()
        }}>
        {health.isModelChecking ? <Loader2 className="motion-safe:animate-spin" /> : null}
        <span>{label}</span>
      </Button>
      <ModelCheckDialog />
    </>
  )
}
