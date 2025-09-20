import { Button, Spinner } from '@heroui/react'
import { AgentModal } from '@renderer/components/Popups/agent/AgentModal'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useAppDispatch } from '@renderer/store'
import { setActiveAgentId as setActiveAgentIdAction } from '@renderer/store/runtime'
import { Plus } from 'lucide-react'
import { FC, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import AgentItem from './components/AgentItem'
import { SectionName } from './components/SectionName'

interface AssistantsTabProps {}

export const Agents: FC<AssistantsTabProps> = () => {
  const { agents, deleteAgent, isLoading } = useAgents()
  const { t } = useTranslation()
  const { chat } = useRuntime()
  const { activeAgentId } = chat

  const dispatch = useAppDispatch()

  const setActiveAgentId = useCallback(
    (id: string) => {
      dispatch(setActiveAgentIdAction(id))
    },
    [dispatch]
  )

  useEffect(() => {
    if (!isLoading && agents.length > 0 && !activeAgentId) {
      setActiveAgentId(agents[0].id)
    }
  }, [isLoading, agents, activeAgentId, setActiveAgentId])

  return (
    <div className="agents-tab h-full w-full">
      <SectionName name={t('common.agent_other')} />
      {isLoading && <Spinner />}
      {!isLoading &&
        agents.map((agent) => (
          <AgentItem
            key={agent.id}
            agent={agent}
            isActive={agent.id === activeAgentId}
            onDelete={() => deleteAgent(agent.id)}
            onPress={() => setActiveAgentId(agent.id)}
          />
        ))}
      <AgentModal
        trigger={{
          content: (
            <Button
              onPress={(e) => e.continuePropagation()}
              startContent={<Plus size={16} className="mr-1 shrink-0 translate-x-[-2px]" />}
              className="w-full justify-start bg-transparent text-foreground-500 hover:bg-accent">
              {t('agent.add.title')}
            </Button>
          )
        }}
      />
    </div>
  )
}
