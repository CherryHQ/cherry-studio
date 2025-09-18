import { Button } from '@heroui/react'
import { AgentModal } from '@renderer/components/Popups/AgentModal'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useRemoveAgent } from '@renderer/hooks/agents/useRemoveAgent'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useAppDispatch } from '@renderer/store'
import { setActiveAgentId as setActiveAgentIdAction } from '@renderer/store/runtime'
import { Plus } from 'lucide-react'
import { FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import AgentItem from './components/AgentItem'

interface AssistantsTabProps {}

export const AgentsTab: FC<AssistantsTabProps> = () => {
  const { agents } = useAgents()
  const { removeAgent } = useRemoveAgent()
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

  return (
    <div className="agents-tab h-full w-full p-2">
      {agents.map((agent) => (
        <AgentItem
          key={agent.id}
          agent={agent}
          isActive={agent.id === activeAgentId}
          onDelete={removeAgent}
          onPress={() => setActiveAgentId(agent.id)}
        />
      ))}
      <AgentModal
        trigger={{
          content: (
            <Button
              onPress={(e) => e.continuePropagation()}
              className="w-full justify-start bg-transparent text-foreground-500 hover:bg-accent">
              <Plus size={16} className="mr-1 shrink-0" />
              {t('agent.add.title')}
            </Button>
          )
        }}
      />
    </div>
  )
}
