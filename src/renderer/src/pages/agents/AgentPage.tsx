import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { Alert } from 'antd'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChat from './AgentChat'
import AgentNavbar from './AgentNavbar'
import AgentSidePanel from './AgentSidePanel'

const AgentPage = () => {
  const { t } = useTranslation()
  const { isLeftNavbar, isTopNavbar } = useNavbarPosition()
  const { showAssistants } = useShowAssistants()
  const { showTopics } = useShowTopics()
  const { topicPosition, apiServer } = useSettings()
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

  if (!apiServer.enabled) {
    return (
      <div
        id="agent-page"
        className="flex flex-1 flex-col"
        style={{ maxWidth: isLeftNavbar ? 'calc(100vw - var(--sidebar-width))' : '100vw' }}>
        <div className="flex flex-1 items-center justify-center">
          <Alert type="warning" message={t('agent.warning.enable_server')} style={{ margin: '5px 16px' }} />
        </div>
      </div>
    )
  }

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
      </div>
    </div>
  )
}

export default AgentPage
