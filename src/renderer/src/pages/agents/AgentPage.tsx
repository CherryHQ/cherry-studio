import { usePreference } from '@data/hooks/usePreference'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import { useCache } from '@renderer/data/hooks/useCache'
import { useAgents } from '@renderer/hooks/agents/useAgentDataApi'
import { useAgentSessionInitializer } from '@renderer/hooks/agents/useAgentSessionInitializer'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import HistoryRecordsPage from '@renderer/pages/history/HistoryRecordsPage'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { cn } from '@renderer/utils'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChat from './AgentChat'
import AgentNavbar from './AgentNavbar'
import AgentSidePanel from './AgentSidePanel'
import { AgentEmpty } from './components/status'

const AgentPage = () => {
  const { isLeftNavbar } = useNavbarPosition()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyOrigin, setHistoryOrigin] = useState<DOMRectReadOnly>()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)
  const { topicPosition } = useSettings()
  const { agents } = useAgents()
  const [activeSessionId, setActiveSessionId] = useCache('agent.active_session_id')
  const [sessionRevealRequest, setSessionRevealRequest] = useState<ResourceListRevealRequest>()
  const sessionRevealRequestIdRef = useRef(0)
  const { t } = useTranslation()

  // Seed `agent.active_session_id` to the most-recent session when nothing is set.
  useAgentSessionInitializer()

  useShortcut('general.toggle_sidebar', () => {
    if (topicPosition === 'left') {
      toggleShowSidebar()
      return
    }

    void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
  })

  useShortcut('topic.toggle_show_topics', () => {
    if (topicPosition === 'right') {
      toggleShowSidebar()
    } else {
      void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
    }
  })

  useEffect(() => {
    void window.api.window.setMinimumSize(showSidebar ? MIN_WINDOW_WIDTH : SECOND_MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    return () => {
      void window.api.window.resetMinimumSize()
    }
  }, [showSidebar])

  const openHistory = useCallback((origin?: DOMRectReadOnly) => {
    setHistoryOrigin(origin)
    setHistoryOpen(true)
  }, [])
  const closeHistory = useCallback(() => setHistoryOpen(false), [])
  const handleHistorySessionSelect = useCallback(
    (sessionId: string | null) => {
      void setShowSidebar(true)
      setActiveSessionId(sessionId)

      if (!sessionId) return

      sessionRevealRequestIdRef.current += 1
      setSessionRevealRequest({
        clearFilters: true,
        clearQuery: true,
        itemId: sessionId,
        requestId: sessionRevealRequestIdRef.current
      })
    },
    [setActiveSessionId, setShowSidebar]
  )
  const historyOverlay = (
    <HistoryRecordsPage
      mode="agent"
      open={historyOpen}
      activeRecordId={activeSessionId}
      origin={historyOrigin}
      onClose={closeHistory}
      onRecordSelect={handleHistorySessionSelect}
    />
  )

  if (agents && agents.length === 0) {
    return (
      <Container>
        <Navbar>
          <NavbarCenter style={{ borderRight: 'none' }}>{t('common.agent_one')}</NavbarCenter>
        </Navbar>
        <AgentEmpty />
        {historyOverlay}
      </Container>
    )
  }

  const panePosition = topicPosition === 'right' ? 'right' : 'left'

  return (
    <Container>
      <AgentNavbar />
      <div
        id={isLeftNavbar ? 'content-container' : undefined}
        className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        <AgentChat
          pane={
            <AgentSidePanel position={panePosition} onOpenHistory={openHistory} revealRequest={sessionRevealRequest} />
          }
          paneOpen={showSidebar}
          panePosition={panePosition}
        />
      </div>
      {historyOverlay}
    </Container>
  )
}

const Container = ({ children, className }: PropsWithChildren<{ className?: string }>) => {
  return (
    <div id="agent-page" className={cn('relative flex flex-1 flex-col overflow-hidden', className)}>
      {children}
    </div>
  )
}

export default AgentPage
