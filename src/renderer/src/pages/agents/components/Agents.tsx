import AddButton from '@renderer/components/AddButton'
import DraggableVirtualList from '@renderer/components/DraggableList/virtual-list'
import AgentModalPopup from '@renderer/components/Popups/agent/AgentModal'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { useRuntime } from '@renderer/hooks/useRuntime'
import type { AgentEntity } from '@renderer/types'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import AgentItem from './AgentItem'

interface AgentsProps {
  onSelectItem?: () => void
}

const Agents = ({ onSelectItem }: AgentsProps) => {
  const { t } = useTranslation()
  const { agents, deleteAgent, isLoading, error, reorderAgents } = useAgents()
  const { apiServerRunning, startApiServer } = useApiServer()
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  const { setActiveAgentId } = useActiveAgent()

  const handleAgentPress = useCallback(
    (agentId: string) => {
      setActiveAgentId(agentId)
      onSelectItem?.()
    },
    [setActiveAgentId, onSelectItem]
  )

  const handleAddAgent = useCallback(() => {
    !apiServerRunning && startApiServer()
    AgentModalPopup.show({
      afterSubmit: (agent: AgentEntity) => {
        setActiveAgentId(agent.id)
      }
    })
  }, [apiServerRunning, startApiServer, setActiveAgentId])

  if (isLoading) {
    return <div className="p-5 text-center text-(--color-text-secondary) text-[13px]">{t('common.loading')}</div>
  }

  if (error) {
    return <div className="p-5 text-center text-(--color-error) text-[13px]">{error.message}</div>
  }

  return (
    <div className="flex h-full flex-col">
      <DraggableVirtualList
        className="agents-tab flex min-h-0 flex-1 flex-col"
        itemStyle={{ marginBottom: 8 }}
        list={agents ?? []}
        estimateSize={() => 9 * 4}
        scrollerStyle={{ overflowX: 'hidden', padding: '12px 10px' }}
        onUpdate={reorderAgents}
        itemKey={(index) => (agents ?? [])[index]?.id ?? index}
        header={
          <div className="-mt-0.5 mb-1.5">
            <AddButton onClick={handleAddAgent}>{t('agent.sidebar_title')}</AddButton>
          </div>
        }>
        {(agent) => (
          <AgentItem
            agent={agent}
            isActive={agent.id === activeAgentId}
            onDelete={() => deleteAgent(agent.id)}
            onPress={() => handleAgentPress(agent.id)}
          />
        )}
      </DraggableVirtualList>
    </div>
  )
}

export default memo(Agents)
