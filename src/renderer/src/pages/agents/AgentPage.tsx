import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { Alert, Button } from 'antd'
import { ServerCrash, Settings } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import AgentChat from './AgentChat'
import AgentEmpty from './AgentEmpty'
import AgentNavbar from './AgentNavbar'
import AgentSidePanel from './AgentSidePanel'

const AgentPage = () => {
  const { t } = useTranslation()
  const { isLeftNavbar, isTopNavbar } = useNavbarPosition()
  const { showAssistants } = useShowAssistants()
  const { showTopics } = useShowTopics()
  const { topicPosition } = useSettings()
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  const { agents } = useAgents()
  const { setActiveAgentId } = useActiveAgent()
  const { apiServerConfig, apiServerRunning, apiServerLoading, startApiServer } = useApiServer()
  const navigate = useNavigate()

  const handleGoToSettings = useCallback(() => {
    navigate('/settings/api-server')
  }, [navigate])

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
      <div id="agent-page" className="flex flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center">
          <Alert type="warning" message={t('agent.warning.enable_server')} style={{ margin: '5px 16px' }} />
        </div>
      </div>
    )
  }

  if (!apiServerLoading && !apiServerRunning) {
    return (
      <div id="agent-page" className="flex flex-1 flex-col bg-background">
        <motion.div
          className="flex h-full w-full flex-col items-center justify-center gap-4"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}>
          <ServerCrash size={56} strokeWidth={1.2} className="text-(--color-error)" />
          <div className="flex flex-col items-center gap-2">
            <h3 className="m-0 font-medium text-(--color-text) text-base">{t('agent.warning.server_not_running')}</h3>
            <p className="m-0 max-w-xs text-center text-(--color-text-secondary) text-sm">
              {t('agent.warning.server_not_running_description')}
            </p>
          </div>
          <div className="flex gap-3">
            <Button type="primary" onClick={startApiServer}>
              {t('apiServer.actions.start')}
            </Button>
            <Button type="default" icon={<Settings size={16} />} onClick={handleGoToSettings}>
              {t('common.go_to_settings')}
            </Button>
          </div>
        </motion.div>
      </div>
    )
  }

  if (agents && agents.length === 0) {
    return (
      <div id="agent-page" className="flex flex-1 flex-col bg-background">
        <AgentEmpty />
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
