import AgentModalPopup from '@renderer/components/Popups/agent/AgentModal'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import type { AgentEntity } from '@renderer/types'
import { cn } from '@renderer/utils'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AddButton from '../home/Tabs/components/AddButton'
import AgentItem from '../home/Tabs/components/AgentItem'
import Sessions from '../home/Tabs/components/Sessions'
import { useActiveAgent } from '../home/Tabs/hooks/useActiveAgent'

const AgentSidePanel: FC = () => {
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
    },
    [setActiveAgentId]
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
          className="mx-3 flex border-[var(--color-border)] border-b bg-transparent py-1.5"
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
            <div className="-mt-[2px] mb-[6px] px-[10px]">
              <AddButton onClick={handleAddAgent}>{t('agent.sidebar_title')}</AddButton>
            </div>
            <div className="flex flex-col gap-0.5 px-[10px]">
              {isLoading && (
                <div className="p-5 text-center text-[13px] text-[var(--color-text-secondary)]">
                  {t('common.loading')}
                </div>
              )}
              {error && <div className="p-5 text-center text-[13px] text-[var(--color-error)]">{error.message}</div>}
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
        {!sessionsOnRight && tab === 'sessions' && activeAgentId && <Sessions agentId={activeAgentId} />}
        {!sessionsOnRight && tab === 'sessions' && !activeAgentId && (
          <div className="flex flex-1 items-center justify-center p-5 text-[13px] text-[var(--color-text-secondary)]">
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
      'h-[30px]',
      'hover:text-[var(--color-text)]',
      'active:scale-[0.98]',
      active ? 'font-semibold text-[var(--color-text)]' : 'font-normal text-[var(--color-text-secondary)]',
      // Underline indicator via pseudo-element
      'after:-translate-x-1/2 after:absolute after:bottom-[-8px] after:left-1/2 after:h-[3px] after:rounded-sm after:transition-all after:duration-200 after:ease-in-out',
      active
        ? 'after:w-[30px] after:bg-[var(--color-primary)]'
        : 'after:w-0 after:bg-[var(--color-primary)] hover:after:w-4 hover:after:bg-[var(--color-primary-soft)]'
    )}>
    {children}
  </button>
)

export default AgentSidePanel
