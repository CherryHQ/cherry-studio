import { Button, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { useAgents } from '@renderer/hooks/agents/useAgentDataApi'
import { useAgentSessionInitializer } from '@renderer/hooks/agents/useAgentSessionInitializer'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import HistoryPageV2 from '@renderer/pages/history/HistoryPageV2'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { cn } from '@renderer/utils'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { History } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChat from './AgentChat'
import AgentNavbar from './AgentNavbar'
import AgentSidePanel from './AgentSidePanel'
import { AgentEmpty } from './components/status'

const AgentPage = () => {
  const { isLeftNavbar } = useNavbarPosition()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)
  const { topicPosition } = useSettings()
  const { agents } = useAgents()
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

  const historyEntry = (
    <>
      <div className="absolute top-14 right-4 z-20">
        <Tooltip title={t('history.v2.testOpenAgent', '测试智能体历史记录')} delay={800}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 rounded-md border border-border-muted bg-popover/95 px-2.5 text-xs shadow-sm backdrop-blur hover:bg-accent"
            onClick={() => setHistoryOpen(true)}>
            <History size={14} />
            {t('history.v2.testButton', '历史')}
          </Button>
        </Tooltip>
      </div>
      <HistoryPageV2 mode="agent" open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  )

  if (agents && agents.length === 0) {
    return (
      <Container>
        <Navbar>
          <NavbarCenter style={{ borderRight: 'none' }}>{t('common.agent_one')}</NavbarCenter>
        </Navbar>
        <AgentEmpty />
        {historyEntry}
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
          pane={<AgentSidePanel position={panePosition} />}
          paneOpen={showSidebar}
          panePosition={panePosition}
        />
      </div>
      {historyEntry}
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
