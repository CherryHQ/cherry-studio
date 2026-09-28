import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useModelMutations } from '@renderer/hooks/useModel'
import { toast } from '@renderer/services/toast'

import { useModelListHealthRun } from './modelListHealthContext'

const logger = loggerService.withContext('ProviderSettings:RemoveFailed')

interface ProviderModelRemoveFailedProps {
  disabled?: boolean
}

export default function ProviderModelRemoveFailed({ disabled }: ProviderModelRemoveFailedProps) {
  const { t } = useTranslation()
  const health = useModelListHealthRun()
  const { updateModels } = useModelMutations()

  const failedModels =
    health.lastCheckResults?.filter((result) => result.kind === 'failed').map((result) => result.model) ?? []

  if (failedModels.length === 0) return null

  // Disable rather than delete: the model selector keeps showing disabled models, demoted and
  // badged, so a model that fails today can be picked again without re-adding it by hand.
  const handleDisableFailed = async () => {
    try {
      await updateModels(failedModels.map((m) => ({ uniqueModelId: m.id, patch: { isEnabled: false } })))
      toast.success(t('settings.models.check.disable_failed_success', { count: failedModels.length }))
    } catch (error) {
      logger.error('Failed to disable failed models', { count: failedModels.length, error })
      toast.error(t('settings.models.manage.operation_failed'))
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 rounded-lg border-border-subtle bg-background px-2.5 py-0 text-foreground text-sm leading-5 shadow-none hover:bg-accent/40 hover:text-foreground"
      disabled={disabled || health.isModelChecking}
      onClick={() => void handleDisableFailed()}>
      {t('settings.models.check.disable_failed_button', { count: failedModels.length })}
    </Button>
  )
}
