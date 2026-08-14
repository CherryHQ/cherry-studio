import { Button, ButtonGroupItem } from '@cherrystudio/ui'
import { Activity, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import ModelCheckDialog from './ModelCheckDialog'
import { useModelListHealthRun } from './modelListHealthContext'

export default function ProviderModelCheck() {
  const { t } = useTranslation()
  const health = useModelListHealthRun()

  return (
    <>
      <ButtonGroupItem>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={modelListClasses.fetchActionButton}
          disabled={health.models.length === 0 || health.isModelChecking}
          onClick={health.openModelCheck}>
          {health.isModelChecking ? (
            <Loader2 className={`${modelListClasses.toolbarDesignIcon} animate-spin`} />
          ) : (
            <Activity className={modelListClasses.toolbarDesignIcon} />
          )}
          <span>
            {t(health.isModelChecking ? 'settings.models.check.checking' : 'settings.models.check.button_caption')}
          </span>
        </Button>
      </ButtonGroupItem>
      <ModelCheckDialog />
    </>
  )
}
