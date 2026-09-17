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
  const { deleteModels } = useModelMutations()

  const failedModels =
    health.lastCheckResults?.filter((result) => result.kind === 'failed').map((result) => result.model) ?? []

  if (failedModels.length === 0) return null

  const handleRemoveFailed = async () => {
    try {
      await deleteModels(failedModels.map((m) => m.id))
      toast.success(t('settings.models.check.remove_failed_success', { count: failedModels.length }))
    } catch (error) {
      logger.error('Failed to remove failed models', { count: failedModels.length, error })
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
      onClick={() => void handleRemoveFailed()}>
      {t('settings.models.check.remove_failed_button', { count: failedModels.length })}
    </Button>
  )
}
