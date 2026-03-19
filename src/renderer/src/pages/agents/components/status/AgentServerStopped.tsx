import { useApiServer } from '@renderer/hooks/useApiServer'
import { useNavigate } from '@tanstack/react-router'
import { Button } from 'antd'
import { ServerCrash, Settings } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import AgentStatusScreen from './AgentStatusScreen'

const AgentServerStopped = () => {
  const { t } = useTranslation()
  const { startApiServer } = useApiServer()
  const navigate = useNavigate()

  const handleGoToSettings = useCallback(() => {
    navigate({ to: '/settings/api-server' })
  }, [navigate])

  return (
    <AgentStatusScreen
      icon={ServerCrash}
      iconClassName="text-(--color-error)"
      title={t('agent.warning.server_not_running')}
      description={t('agent.warning.server_not_running_description')}
      actions={
        <>
          <Button type="primary" onClick={startApiServer}>
            {t('apiServer.actions.start')}
          </Button>
          <Button type="default" icon={<Settings size={16} />} onClick={handleGoToSettings}>
            {t('common.go_to_settings')}
          </Button>
        </>
      }
    />
  )
}

export default AgentServerStopped
