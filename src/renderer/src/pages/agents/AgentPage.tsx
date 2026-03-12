import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { useEffect } from 'react'

import Sessions from '../home/Tabs/components/Sessions'
import { useActiveAgent } from '../home/Tabs/hooks/useActiveAgent'
import AgentChat from './AgentChat'
import AgentNavbar from './AgentNavbar'
import AgentSidePanel from './AgentSidePanel'

const AgentPage: FC = () => {
  const { isLeftNavbar, isTopNavbar } = useNavbarPosition()
  const { showAssistants } = useShowAssistants()
  const { showTopics } = useShowTopics()
  const { topicPosition } = useSettings()
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  const { agents } = useAgents()
  const { setActiveAgentId } = useActiveAgent()

  // Auto-select first agent when none is active
  useEffect(() => {
    if (!activeAgentId && agents.length > 0) {
      setActiveAgentId(agents[0].id)
    }
  }, [activeAgentId, agents, setActiveAgentId])

  useEffect(() => {
    const canMinimize = topicPosition === 'left' ? !showAssistants : !showAssistants && !showTopics
    window.api.window.setMinimumSize(canMinimize ? SECOND_MIN_WINDOW_WIDTH : MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    return () => {
      window.api.window.resetMinimumSize()
    }
  }, [showAssistants, showTopics, topicPosition])

  const showRightSessions = topicPosition === 'right' && showTopics && !!activeAgentId

  return (
    <div
      id="agent-page"
      className="flex flex-1 flex-col"
      style={{ maxWidth: isLeftNavbar ? 'calc(100vw - var(--sidebar-width))' : '100vw' }}>
      {isLeftNavbar && <AgentNavbar />}
      <div
        id={isLeftNavbar ? 'content-container' : undefined}
        className="flex flex-1 flex-row overflow-hidden"
        style={{ maxWidth: isTopNavbar ? 'calc(100vw - 12px)' : undefined }}>
        <AnimatePresence initial={false}>
          {showAssistants && (
            <ErrorBoundary>
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'var(--assistants-width)', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}>
                <AgentSidePanel />
              </motion.div>
            </ErrorBoundary>
          )}
        </AnimatePresence>
        <ErrorBoundary>
          <AgentChat />
        </ErrorBoundary>
        <AnimatePresence initial={false}>
          {showRightSessions && (
            <motion.div
              key="right-sessions"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'var(--assistants-width)', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}>
              <div
                className="flex flex-col overflow-hidden"
                style={{
                  width: 'var(--assistants-width)',
                  height: 'calc(100vh - var(--navbar-height))',
                  borderLeft: '0.5px solid var(--color-border)'
                }}>
                <Sessions agentId={activeAgentId!} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default AgentPage
