import { Settings } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { ConversationNavigationPane } from '@renderer/components/chat/shell/ConversationNavigationPane'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { HelpMenu } from '@renderer/components/layout/HelpMenu'
import { UserAvatar } from '@renderer/components/Sidebar'
import UserPopup from '@renderer/components/UserPopup'
import type { AgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import useAvatar from '@renderer/hooks/useAvatar'
import { useMinimalMode } from '@renderer/hooks/useMinimalMode'
import { useNativeFullscreen } from '@renderer/hooks/useNativeFullscreen'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'

import Sessions from './components/Sessions'
import type { CreateAgentSessionDefaults } from './types'

const FeedbackDialog = lazy(() => import('@renderer/components/feedback/FeedbackDialog'))

interface AgentSidePanelProps {
  onSidebarToggle?: () => void
  activeSessionId: string | null
  dataEnabled?: boolean
  historyRecordsActive?: boolean
  manageAgentsActive?: boolean
  agentSessionsSource: AgentSessionsSource
  onActiveAgentDeleted?: (agentId: string) => void | Promise<void>
  onAddAgent?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onManageAgents?: () => void | Promise<void>
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onCreateSession?: (
    defaults: CreateAgentSessionDefaults
  ) => AgentSessionEntity | null | void | Promise<AgentSessionEntity | null | void>
  onShowMissingAgentSelection?: () => void | Promise<void>
  panePosition?: TopicTabPosition
  revealRequest?: ResourceListRevealRequest
  setActiveSessionId: (id: string | null, session?: AgentSessionEntity | null) => void
}

const AgentSidePanel = ({
  onSidebarToggle,
  activeSessionId,
  dataEnabled,
  historyRecordsActive,
  manageAgentsActive,
  agentSessionsSource,
  onActiveAgentDeleted,
  onAddAgent,
  onOpenHistoryRecords,
  onManageAgents,
  onSetPanePosition,
  onCreateSession,
  onShowMissingAgentSelection,
  panePosition,
  revealRequest,
  setActiveSessionId
}: AgentSidePanelProps) => {
  const [feedbackDialogMounted, setFeedbackDialogMounted] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const minimalContext = useMinimalMode()
  const minimalMode = minimalContext?.enabled && minimalContext.isHome ? minimalContext : null
  const { t } = useTranslation()
  const fullscreen = useNativeFullscreen()
  const avatar = useAvatar()
  const [userName] = usePreference('app.user.name')
  const name = userName || t('chat.user')
  return (
    <ConversationNavigationPane className={minimalMode?.enabled ? 'border-r-[0.5px] border-border' : undefined}>
      {minimalMode?.enabled && (
        <div
          className={cn(
            'flex h-11 shrink-0 items-center px-2 [-webkit-app-region:drag]',
            isMac && !fullscreen && 'h-9.5 items-start pt-2 pl-[max(80px,env(titlebar-area-x))]'
          )}>
          <div className="[-webkit-app-region:no-drag]">
            <ConversationSidebarToggleButton sidebarOpen onSidebarToggle={onSidebarToggle} tooltipPlacement="bottom" />
          </div>
          <div className="flex-1" />
          <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
            {minimalMode.sidebarToolbarActions}
          </div>
        </div>
      )}
      <Sessions
        className={minimalMode?.enabled ? 'border-r-0 bg-transparent pt-1' : undefined}
        agentSessionsSource={agentSessionsSource}
        activeSessionId={activeSessionId}
        dataEnabled={dataEnabled}
        historyRecordsActive={historyRecordsActive}
        manageAgentsActive={manageAgentsActive}
        setActiveSessionId={setActiveSessionId}
        onActiveAgentDeleted={onActiveAgentDeleted}
        onAddAgent={onAddAgent}
        onOpenHistoryRecords={onOpenHistoryRecords}
        onManageAgents={onManageAgents}
        onSetPanePosition={onSetPanePosition}
        panePosition={panePosition}
        revealRequest={revealRequest}
        onCreateSession={onCreateSession}
        onShowMissingAgentSelection={onShowMissingAgentSelection}
      />
      {minimalMode?.enabled && (
        <div className="flex shrink-0 items-center gap-1 border-t-[0.5px] border-border px-2 py-1">
          <Tooltip content={name}>
            <Button variant="ghost" size="icon" aria-label={name} onClick={() => UserPopup.show()}>
              <UserAvatar user={{ name, avatar }} className="size-6" ring={false} />
            </Button>
          </Tooltip>
          <Button
            variant="ghost"
            className="group flex-1 justify-start"
            onClick={() => minimalMode.openFeature('/settings/labs')}>
            <Settings className="size-4 text-muted-foreground! group-hover:text-foreground!" />
            {t('settings.title')}
          </Button>
          <HelpMenu
            layout="icon"
            onFeedbackClick={() => {
              setFeedbackDialogMounted(true)
              setFeedbackOpen(true)
            }}
          />
        </div>
      )}
      {feedbackDialogMounted && (
        <Suspense fallback={null}>
          <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
        </Suspense>
      )}
    </ConversationNavigationPane>
  )
}

export default AgentSidePanel
