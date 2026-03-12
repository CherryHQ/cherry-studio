import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShowTopics } from '@renderer/hooks/useStore'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { Alert, Spin } from 'antd'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { PinnedTodoPanel } from '../home/Inputbar/components/PinnedTodoPanel'
import ChatNavigation from '../home/Messages/ChatNavigation'
import NarrowLayout from '../home/Messages/NarrowLayout'
import AgentChatNavbar from './components/AgentChatNavbar'
import AgentSessionInputbar from './components/AgentSessionInputbar'
import AgentSessionMessages from './components/AgentSessionMessages'
import Sessions from './components/Sessions'

const AgentChat: FC = () => {
  const { t } = useTranslation()
  const { messageNavigation, topicPosition } = useSettings()
  const { isTopNavbar } = useNavbarPosition()
  const { showTopics } = useShowTopics()
  const { chat } = useRuntime()
  const { activeAgentId, activeSessionIdMap } = chat
  const activeSessionId = activeAgentId ? activeSessionIdMap[activeAgentId] : null
  // undefined = session not yet initialized, null = initialized but no sessions
  const isSessionInitialized = !activeAgentId || activeAgentId in activeSessionIdMap
  const { agent: activeAgent, isLoading: isAgentLoading } = useActiveAgent()
  const { isLoading: isAgentsLoading, agents } = useAgents()
  const { apiServerRunning } = useApiServer()

  // Don't show select/create alerts while data is still loading
  // !apiServerRunning: server enabled (guaranteed by AgentPage) but not yet started, SWR key is null
  const isInitializing =
    !apiServerRunning ||
    isAgentsLoading ||
    isAgentLoading ||
    !isSessionInitialized ||
    (!activeAgentId && agents.length > 0)

  const showRightSessions = topicPosition === 'right' && showTopics && !!activeAgentId

  return (
    <div
      className={cn(
        'flex flex-1 overflow-hidden',
        isTopNavbar && 'rounded-tl-2xl rounded-bl-2xl bg-(--color-background)'
      )}>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="translate-z-0 relative flex w-full flex-1 flex-col justify-between">
          <QuickPanelProvider>
            {activeAgent && <AgentChatNavbar activeAgent={activeAgent} />}
            <div className="flex flex-1 flex-col justify-between">
              {isInitializing && (
                <div className="flex h-full w-full items-center justify-center">
                  <Spin />
                </div>
              )}
              {!isInitializing && !activeAgentId && (
                <div className="flex h-full w-full items-center justify-center">
                  <Alert type="info" message={t('chat.alerts.select_agent')} style={{ margin: '5px 16px' }} />
                </div>
              )}
              {!isInitializing && activeAgentId && !activeSessionId && (
                <div className="flex h-full w-full items-center justify-center">
                  <Alert type="warning" message={t('chat.alerts.create_session')} style={{ margin: '5px 16px' }} />
                </div>
              )}
              {!isInitializing && activeAgentId && activeSessionId && (
                <>
                  <AgentSessionMessages agentId={activeAgentId} sessionId={activeSessionId} />
                  <div className="mt-auto px-4.5 pb-2">
                    <NarrowLayout>
                      <PinnedTodoPanel topicId={buildAgentSessionTopicId(activeSessionId)} />
                    </NarrowLayout>
                  </div>
                  {messageNavigation === 'buttons' && <ChatNavigation containerId="messages" />}
                  <AgentSessionInputbar agentId={activeAgentId} sessionId={activeSessionId} />
                </>
              )}
            </div>
          </QuickPanelProvider>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {showRightSessions && (
          <motion.div
            key="right-sessions"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'var(--assistants-width)', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden">
            <div className="flex h-full w-(--assistants-width) flex-col overflow-hidden border-(--color-border) border-l-[0.5px]">
              <Sessions agentId={activeAgentId!} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default AgentChat
