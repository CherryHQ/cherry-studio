import { Button, Tooltip } from '@cherrystudio/ui'
import { Activity } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import HealthCheckDrawer from './HealthCheckDrawer'
import { useModelListHealth } from './modelListHealthContext'

interface ProviderModelHealthCheckProps {
  disabled: boolean
  hasVisibleModels: boolean
  renderTrigger?: boolean
  renderDrawer?: boolean
}

const ProviderModelHealthCheck: React.FC<ProviderModelHealthCheckProps> = ({
  disabled,
  hasVisibleModels,
  renderTrigger = true,
  renderDrawer = true
}) => {
  const { t } = useTranslation()
  const health = useModelListHealth()

  return (
    <>
      {renderTrigger ? (
        <Tooltip content={t('settings.models.check.button_caption')}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.models.check.button_caption')}
            className={modelListClasses.subsectionIconButton}
            disabled={!hasVisibleModels || disabled}
            onClick={health.openHealthCheck}>
            <Activity className={modelListClasses.subsectionIcon} />
          </Button>
        </Tooltip>
      ) : null}
      {renderDrawer ? (
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
      ) : null}
    </>
  )
}

export default ProviderModelHealthCheck
