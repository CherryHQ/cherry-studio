import AddButton from '@renderer/components/AddButton'
import AgentModalPopup from '@renderer/components/Popups/agent/AgentModal'
import Scrollbar from '@renderer/components/Scrollbar'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import type { AgentEntity } from '@renderer/types'
import { cn } from '@renderer/utils'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentItem from './components/AgentItem'
import Sessions from './components/Sessions'

interface AgentSidePanelProps {
  onSelectItem?: () => void
}

const AgentSidePanel: FC<AgentSidePanelProps> = ({ onSelectItem }) => {
  const { t } = useTranslation()
  const { agents, deleteAgent, isLoading, error } = useAgents()
  const { apiServerRunning, startApiServer } = useApiServer()
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  const { setActiveAgentId } = useActiveAgent()
  const { isLeftNavbar } = useNavbarPosition()
  const { topicPosition } = useSettings()

  const sessionsOnRight = topicPosition === 'right'
  const [tab, setTab] = useState<'agents' | 'sessions'>('agents')

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

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        width: 'var(--assistants-width)',
        height: 'calc(100vh - var(--navbar-height))',
        borderRight: isLeftNavbar ? '0.5px solid var(--color-border)' : 'none',
        backgroundColor: isLeftNavbar ? 'var(--color-background)' : undefined
      }}>
      {/* Tabs */}
      {!sessionsOnRight && (
        <div
          className="mx-3 flex border-(--color-border) border-b bg-transparent py-1.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <TabButton active={tab === 'agents'} onClick={() => setTab('agents')}>
            {t('agent.sidebar_title')}
          </TabButton>
          <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}>
            {t('common.sessions')}
          </TabButton>
        </div>
      )}

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {(sessionsOnRight || tab === 'agents') && (
          <Scrollbar className="flex flex-col py-3">
            <div className="-mt-0.5 mb-1.5 px-2.5">
              <AddButton onClick={handleAddAgent}>{t('agent.sidebar_title')}</AddButton>
            </div>
            <div className="flex flex-col gap-0.5 px-2.5">
              {isLoading && (
                <div className="p-5 text-center text-(--color-text-secondary) text-[13px]">{t('common.loading')}</div>
              )}
              {error && <div className="p-5 text-center text-(--color-error) text-[13px]">{error.message}</div>}
              {!isLoading &&
                !error &&
                agents.map((agent) => (
                  <AgentItem
                    key={agent.id}
                    agent={agent}
                    isActive={agent.id === activeAgentId}
                    onDelete={() => deleteAgent(agent.id)}
                    onPress={() => handleAgentPress(agent.id)}
                  />
                ))}
            </div>
          </Scrollbar>
        )}
        {!sessionsOnRight && tab === 'sessions' && activeAgentId && (
          <Sessions agentId={activeAgentId} onSelectItem={onSelectItem} />
        )}
        {!sessionsOnRight && tab === 'sessions' && !activeAgentId && (
          <div className="flex flex-1 items-center justify-center p-5 text-(--color-text-secondary) text-[13px]">
            {t('chat.alerts.select_agent')}
          </div>
        )}
      </div>
    </div>
  )
}

const TabButton: FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'relative mx-0.5 flex flex-1 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-[13px]',
      'h-7.5',
      'hover:text-(--color-text)',
      'active:scale-[0.98]',
      active ? 'font-semibold text-(--color-text)' : 'font-normal text-(--color-text-secondary)',
      // Underline indicator via pseudo-element
      'after:-translate-x-1/2 after:-bottom-2 after:absolute after:left-1/2 after:h-0.75 after:rounded-sm after:transition-all after:duration-200 after:ease-in-out',
      active
        ? 'after:w-7.5 after:bg-(--color-primary)'
        : 'after:w-0 after:bg-(--color-primary) hover:after:w-4 hover:after:bg-(--color-primary-soft)'
    )}>
    {children}
  </button>
)

export default AgentSidePanel
