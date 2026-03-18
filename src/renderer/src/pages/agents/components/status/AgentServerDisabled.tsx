import { useApiServer } from '@renderer/hooks/useApiServer'
import { useNavigate } from '@tanstack/react-router'
import { Button } from 'antd'
import { ServerOff, Settings } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import AgentStatusScreen from './AgentStatusScreen'

const AgentServerDisabled = () => {
  const { t } = useTranslation()
  const { startApiServer } = useApiServer()
  const navigate = useNavigate()

  const handleGoToSettings = useCallback(() => {
    navigate({ to: '/settings/api-server' })
  }, [navigate])

  return (
    <AgentStatusScreen
      icon={ServerOff}
      iconClassName="text-(--color-status-warning)"
      title={t('agent.warning.enable_server')}
      description={t('agent.warning.enable_server_description')}
      actions={
        <>
          <Button type="primary" onClick={startApiServer}>
            {t('agent.warning.enable_and_start')}
          </Button>
          <Button type="default" icon={<Settings size={16} />} onClick={handleGoToSettings}>
            {t('common.go_to_settings')}
          </Button>
        </>
      }
    />
  )
}

export default AgentServerDisabled
