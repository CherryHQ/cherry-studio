import { type RefObject, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { ResourceList } from '@renderer/components/chat/resourceList/base'
import {
  type AgentSessionDisplayMode,
  isSystemWorkspaceSession,
  type SessionListItem
} from '@renderer/utils/chat/sessionListHelpers'
import { formatErrorMessage } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'

import SessionItem, { type SessionItemMenuActions } from './SessionItem'

interface SessionListBodyProps {
  activeSessionId: string | null
  channelTypeMap: Record<string, string>
  displayMode: AgentSessionDisplayMode
  error?: unknown
  isDraggable: boolean
  isValidating: boolean
  listRef: RefObject<HTMLDivElement | null>
  onDeleteSession: (id: string) => Promise<void>
  onDeletePermanently: (id: string) => Promise<void>
  permanentDeleteShortcut: string
  deletingSessionId: string | null
  onOpenInNewTab?: (session: AgentSessionEntity) => void
  onOpenInNewWindow?: (session: AgentSessionEntity) => void
  onOpenRenameDialog: (session: AgentSessionEntity) => void
  onRetry: () => Promise<unknown>
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onTogglePin: (id: string) => void | Promise<unknown>
  onToggleSidebar: (session: AgentSessionEntity) => void
  panePosition?: TopicTabPosition
  sidebarSessionFavoriteIdSet: ReadonlySet<string>
  sessionMenuActions: SessionItemMenuActions
  setActiveSessionId: (id: string | null) => void
}

export function SessionListBody({
  activeSessionId,
  channelTypeMap,
  displayMode,
  error,
  isDraggable,
  isValidating,
  listRef,
  onDeleteSession,
  onDeletePermanently,
  permanentDeleteShortcut,
  deletingSessionId,
  onOpenInNewTab,
  onOpenInNewWindow,
  onOpenRenameDialog,
  onRetry,
  onSetPanePosition,
  onTogglePin,
  onToggleSidebar,
  panePosition,
  sidebarSessionFavoriteIdSet,
  sessionMenuActions,
  setActiveSessionId
}: SessionListBodyProps) {
  const { t } = useTranslation()

  const renderItem = useCallback(
    (session: SessionListItem) => (
      <SessionItem
        key={session.id}
        session={session}
        active={session.id === activeSessionId}
        channelType={channelTypeMap[session.id]}
        pinned={session.pinned}
        reserveLeadingIconSlot={
          (displayMode === 'agent' && !session.pinned) ||
          (displayMode === 'workdir' && !session.pinned && !isSystemWorkspaceSession(session))
        }
        onTogglePin={onTogglePin}
        onToggleSidebar={onToggleSidebar}
        onDelete={onDeleteSession}
        onDeletePermanently={onDeletePermanently}
        permanentDeleteShortcut={permanentDeleteShortcut}
        isDeleting={deletingSessionId === session.id}
        onOpenInNewTab={onOpenInNewTab}
        onOpenInNewWindow={onOpenInNewWindow}
        onOpenRenameDialog={onOpenRenameDialog}
        onSetPanePosition={onSetPanePosition}
        panePosition={panePosition}
        sidebarPinned={sidebarSessionFavoriteIdSet.has(session.id)}
        onPress={setActiveSessionId}
        sessionMenuActions={sessionMenuActions}
      />
    ),
    [
      activeSessionId,
      channelTypeMap,
      deletingSessionId,
      displayMode,
      onDeletePermanently,
      onDeleteSession,
      permanentDeleteShortcut,
      onOpenInNewTab,
      onOpenInNewWindow,
      onOpenRenameDialog,
      onSetPanePosition,
      onTogglePin,
      onToggleSidebar,
      panePosition,
      sidebarSessionFavoriteIdSet,
      sessionMenuActions,
      setActiveSessionId
    ]
  )

  return (
    <ResourceList.Body<SessionListItem>
      listRef={listRef}
      draggable={isDraggable}
      errorFallback={
        <ResourceList.ErrorState>
          <div className="flex flex-col gap-2">
            <div className="font-medium text-destructive">{t('agent.session.get.error.failed')}</div>
            <div className="text-muted-foreground">{formatErrorMessage(error)}</div>
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => void onRetry()}
              disabled={isValidating}>
              {t('common.retry')}
            </Button>
          </div>
        </ResourceList.ErrorState>
      }
      emptyFallback={
        <div className="text-muted-foreground mx-auto flex h-full w-full max-w-sm items-center justify-center px-5 py-10 text-center text-xs break-words">
          {t('agent.session.empty.title')}
        </div>
      }
      renderItem={renderItem}
    />
  )
}
