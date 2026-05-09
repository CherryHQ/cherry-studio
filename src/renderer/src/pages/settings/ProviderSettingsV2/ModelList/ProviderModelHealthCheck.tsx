import { Button, Tooltip } from '@cherrystudio/ui'
import { HeartPulse } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../shared/primitives/ProviderSettingsPrimitives'
import HealthCheckDrawer from './HealthCheckDrawer'
import { useModelListHealth } from './modelListHealthContext'

interface ProviderModelHealthCheckProps {
  disabled: boolean
  hasVisibleModels: boolean
}

const ProviderModelHealthCheck: React.FC<ProviderModelHealthCheckProps> = ({ disabled, hasVisibleModels }) => {
  const { t } = useTranslation()
  const health = useModelListHealth()

  return (
    <>
      <Tooltip content={t('settings.models.check.button_caption')}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('settings.models.check.button_caption')}
          className={modelListClasses.toolbarDesignIconTrigger}
          disabled={!hasVisibleModels || disabled}
          onClick={health.openHealthCheck}>
          <HeartPulse className={modelListClasses.toolbarDesignIcon} />
        </Button>
      </Tooltip>
      <HealthCheckDrawer
        open={health.healthCheckOpen}
        title={t('settings.models.check.title')}
        apiKeys={health.availableApiKeys}
        isChecking={health.isHealthChecking}
        modelStatuses={health.modelStatuses}
        onClose={health.closeHealthCheck}
        onResetRun={health.resetHealthCheckRun}
        onStart={health.startHealthCheck}
      />
    </>
  )
}

export default ProviderModelHealthCheck
