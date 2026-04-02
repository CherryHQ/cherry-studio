import AgentModalPopup from '@renderer/components/Popups/agent/AgentModal'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useApiServer } from '@renderer/hooks/useApiServer'
import type { AgentEntity } from '@renderer/types'
import { Button } from 'antd'
import { Bot, Plus } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import AgentStatusScreen from './AgentStatusScreen'

const AgentEmpty = () => {
  const { t } = useTranslation()
  const { apiServerRunning, startApiServer } = useApiServer()
  const { setActiveAgentId } = useActiveAgent()

  const handleAddAgent = useCallback(() => {
    void (!apiServerRunning && startApiServer())
    void AgentModalPopup.show({
      afterSubmit: (agent: AgentEntity) => {
        void setActiveAgentId(agent.id)
      }
    })
  }, [apiServerRunning, startApiServer, setActiveAgentId])

  return (
    <AgentStatusScreen
      icon={Bot}
      iconClassName="text-(--color-text-secondary)"
      title={t('agent.empty.title')}
      description={t('agent.empty.description')}
      actions={
        <Button type="default" icon={<Plus size={16} />} onClick={handleAddAgent}>
          {t('agent.add.title')}
        </Button>
      }
    />
  )
}

export default AgentEmpty
