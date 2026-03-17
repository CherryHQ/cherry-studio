import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { cn } from '@renderer/utils'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import Agents from './components/Agents'
import Sessions from './components/Sessions'

interface AgentSidePanelProps {
  onSelectItem?: () => void
}

const AgentSidePanel = ({ onSelectItem }: AgentSidePanelProps) => {
  const { t } = useTranslation()
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  const { isLeftNavbar, isTopNavbar } = useNavbarPosition()
  const { topicPosition } = useSettings()

  const sessionsOnRight = topicPosition === 'right'
  const [tab, setTab] = useState<'agents' | 'sessions'>('agents')

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
          className={cn('mx-3 flex border-(--color-border) border-b bg-transparent py-1.5', isTopNavbar && 'pt-0.5')}
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
        {(sessionsOnRight || tab === 'agents') && <Agents onSelectItem={onSelectItem} />}
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
