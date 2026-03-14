import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { cn } from '@renderer/utils'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { AnimatePresence, motion } from 'motion/react'
import type { PropsWithChildren } from 'react'
import { useEffect } from 'react'

import AgentChat from './AgentChat'
import AgentNavbar from './AgentNavbar'
import AgentSidePanel from './AgentSidePanel'
import { AgentEmpty, AgentServerDisabled, AgentServerStopped } from './components/status'

const AgentPage = () => {
  const { isLeftNavbar, isTopNavbar } = useNavbarPosition()
  const { showAssistants } = useShowAssistants()
  const { showTopics } = useShowTopics()
  const { topicPosition } = useSettings()
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  const { agents } = useAgents()
  const { setActiveAgentId } = useActiveAgent()
  const { apiServerConfig, apiServerRunning, apiServerLoading } = useApiServer()

  // Auto-select first agent when none is active
  useEffect(() => {
    if (!activeAgentId && agents && agents.length > 0) {
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

  if (!apiServerConfig.enabled) {
    return (
      <Container className="bg-background">
        <AgentServerDisabled />
      </Container>
    )
  }

  if (!apiServerLoading && !apiServerRunning) {
    return (
      <Container className="bg-background">
        <AgentServerStopped />
      </Container>
    )
  }

  if (agents && agents.length === 0) {
    return (
      <Container className="bg-background">
        <AgentEmpty />
      </Container>
    )
  }

  return (
    <Container>
      {isLeftNavbar && <AgentNavbar />}
      <div id={isLeftNavbar ? 'content-container' : undefined} className="flex flex-1 flex-row overflow-hidden">
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
    </Container>
  )
}

const Container = ({ children, className }: PropsWithChildren<{ className?: string }>) => {
  return (
    <div id="agent-page" className={cn('flex flex-1 flex-col', className)}>
      {children}
    </div>
  )
}

export default AgentPage
