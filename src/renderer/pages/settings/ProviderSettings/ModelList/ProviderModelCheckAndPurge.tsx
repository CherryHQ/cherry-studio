import { CircleSlash } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useModelMutations } from '@renderer/hooks/useModel'
import { toast } from '@renderer/services/toast'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import { useModelListHealthRun } from './modelListHealthContext'

const logger = loggerService.withContext('ProviderSettings:CheckAndPurge')

interface ProviderModelCheckAndPurgeProps {
  disabled?: boolean
}

export default function ProviderModelCheckAndPurge({ disabled }: ProviderModelCheckAndPurgeProps) {
  const { t } = useTranslation()
  const health = useModelListHealthRun()
  const { updateModels } = useModelMutations()
  const [awaitingPurge, setAwaitingPurge] = useState(false)
  const awaitingRef = useRef(false)

  useEffect(() => {
    if (!awaitingRef.current || health.isHealthChecking || !health.lastCheckResults) return

    awaitingRef.current = false
    setAwaitingPurge(false)

    const failedModels = health.lastCheckResults.filter((r) => r.kind === 'failed').map((r) => r.model)

    if (failedModels.length === 0) {
      toast.success(t('settings.models.check.purge_all_passed'))
      return
    }

    // Disable rather than delete — the selector keeps disabled models visible but demoted, so this
    // stays reversible without re-adding each model by hand.
    void (async () => {
      try {
        await updateModels(failedModels.map((m) => ({ uniqueModelId: m.id, patch: { isEnabled: false } })))
        toast.success(t('settings.models.check.disable_failed_success', { count: failedModels.length }))
      } catch (error) {
        logger.error('Failed to disable failed models after purge check', { count: failedModels.length, error })
        toast.error(t('settings.models.manage.operation_failed'))
      }
    })()
  }, [health.isHealthChecking, health.lastCheckResults, updateModels, t])

  const handleClick = async () => {
    if (health.isModelChecking || awaitingPurge) return

    awaitingRef.current = true
    setAwaitingPurge(true)

    const started = await health.startHealthCheck({
      keySelection: { mode: 'all' },
      isConcurrent: true,
      timeout: 15000
    })

    if (!started) {
      awaitingRef.current = false
      setAwaitingPurge(false)
    }
  }

  const isRunning = awaitingPurge && health.isHealthChecking

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={modelListClasses.fetchActionButton}
      disabled={disabled || health.isModelChecking || awaitingPurge}
      loading={isRunning}
      onClick={() => void handleClick()}>
      {isRunning ? null : <CircleSlash className={modelListClasses.toolbarDesignIcon} />}
      <span>{isRunning ? t('settings.models.check.purge_checking') : t('settings.models.check.purge_button')}</span>
    </Button>
  )
}
