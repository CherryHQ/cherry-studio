import { Alert, Button, Spinner } from '@heroui/react'
import { AgentModal } from '@renderer/components/Popups/agent/AgentModal'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useAgentSessionInitializer } from '@renderer/hooks/agents/useAgentSessionInitializer'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useAppDispatch } from '@renderer/store'
import { setActiveAgentId as setActiveAgentIdAction } from '@renderer/store/runtime'
import { Plus } from 'lucide-react'
import { type FC, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import AgentItem from './AgentItem'

interface AssistantsTabProps {}

export const Agents: FC<AssistantsTabProps> = () => {
  const { agents, deleteAgent, isLoading, error } = useAgents()
  const { t } = useTranslation()
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  const { initializeAgentSession } = useAgentSessionInitializer()

  const dispatch = useAppDispatch()

  const setActiveAgentId = useCallback(
    async (id: string) => {
      dispatch(setActiveAgentIdAction(id))
      // Initialize the session for this agent
      await initializeAgentSession(id)
    },
    [dispatch, initializeAgentSession]
  )

  useEffect(() => {
    if (!isLoading && agents.length > 0 && !activeAgentId) {
      setActiveAgentId(agents[0].id)
    }
  }, [isLoading, agents, activeAgentId, setActiveAgentId])

  return (
    <>
      {isLoading && <Spinner />}
      {error && <Alert color="danger" title={t('agent.list.error.failed')} />}
      {!isLoading &&
        !error &&
        agents.map((agent) => (
          <AgentItem
            key={agent.id}
            agent={agent}
            isActive={agent.id === activeAgentId}
            onDelete={() => deleteAgent(agent.id)}
            onPress={() => {
              setActiveAgentId(agent.id)
            }}
          />
        ))}
      <AgentModal
        trigger={{
          content: (
            <Button
              onPress={(e) => e.continuePropagation()}
              startContent={<Plus size={16} className="mr-1 shrink-0 translate-x-[-2px]" />}
              className="w-full justify-start bg-transparent text-foreground-500 hover:bg-[var(--color-list-item)]">
              {t('agent.add.title')}
            </Button>
          )
        }}
      />
    </>
  )
}
