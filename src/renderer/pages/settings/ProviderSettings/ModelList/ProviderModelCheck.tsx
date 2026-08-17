import { Tooltip } from '@cherrystudio/ui'
import { Activity, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { fieldClasses } from '../primitives/ProviderSettingsPrimitives'
import ModelCheckDialog from './ModelCheckDialog'
import { useModelListHealthRun } from './modelListHealthContext'

export default function ProviderModelCheck() {
  const { t } = useTranslation()
  const health = useModelListHealthRun()
  const label = t(health.isModelChecking ? 'settings.models.check.checking' : 'settings.models.check.button_caption')

  return (
    <>
      <Tooltip content={label}>
        <span className="inline-flex shrink-0">
          <button
            type="button"
            className={fieldClasses.inputActionButton}
            aria-label={label}
            disabled={health.models.length === 0 || health.isModelChecking}
            onClick={health.openModelCheck}>
            {health.isModelChecking ? (
              <Loader2 size={14} className="motion-safe:animate-spin" />
            ) : (
              <Activity size={14} />
            )}
          </button>
        </span>
      </Tooltip>
      <ModelCheckDialog />
    </>
  )
}
