import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ActionMenu, ContextMenu, ContextMenuTrigger } from '@renderer/components/chat'
import { DeleteIcon } from '@renderer/components/Icons'
import MarqueeText from '@renderer/components/MarqueeText'
import { isMac } from '@renderer/config/constant'
import { useCache } from '@renderer/data/hooks/useCache'
import { useUpdateSession } from '@renderer/hooks/agents/useSessionDataApi'
import { useInPlaceEdit } from '@renderer/hooks/useInPlaceEdit'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { SessionLabel } from '@renderer/pages/agents/AgentSettings/shared'
import { classNames } from '@renderer/utils'
import { getChannelTypeIcon } from '@renderer/utils/agentSession'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import { XIcon } from 'lucide-react'
import React, { memo, startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { executeSessionMenuAction, resolveSessionMenuActions, type SessionActionContext } from './sessionItemActions'

// const logger = loggerService.withContext('AgentItem')

interface SessionItemProps {
  session: AgentSessionEntity
  channelType?: string
  pinned?: boolean
  onTogglePin?: () => void
  onDelete: () => void
  onPress: () => void
}

const SessionItem = ({ session, channelType, pinned, onTogglePin, onDelete, onPress }: SessionItemProps) => {
  const { t } = useTranslation()
  const [activeSessionId] = useCache('agent.active_session_id')
  const { updateSession } = useUpdateSession(session.agentId)
  const [isConfirmingDeletion, setIsConfirmingDeletion] = useState(false)
  const { setTimeoutTimer } = useTimer()

  const { isEditing, isSaving, startEdit, inputProps } = useInPlaceEdit({
    onSave: async (value) => {
      if (value !== session.name) {
        await updateSession({ id: session.id, name: value })
      }
    }
  })

  const DeleteButton = () => {
    return (
      <Tooltip
        placement="bottom"
        delay={700}
        content={
          <div style={{ fontSize: '12px', opacity: 0.8, fontStyle: 'italic' }}>
            {t('chat.topics.delete.shortcut', { key: isMac ? '⌘' : 'Ctrl' })}
          </div>
        }>
        <MenuButton
          className="menu"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            if (isConfirmingDeletion || e.ctrlKey || e.metaKey) {
              onDelete()
            } else {
              startTransition(() => {
                setIsConfirmingDeletion(true)
                setTimeoutTimer(
                  'confirmDeletion',
                  () => {
                    setIsConfirmingDeletion(false)
                  },
                  3000
                )
              })
            }
          }}>
          {isConfirmingDeletion ? (
            <DeleteIcon size={14} color="var(--color-error)" style={{ pointerEvents: 'none' }} />
          ) : (
            <XIcon size={14} color="var(--color-text-3)" style={{ pointerEvents: 'none' }} />
          )}
        </MenuButton>
      </Tooltip>
    )
  }

  const isActive = activeSessionId === session.id
  const sessionTopicId = buildAgentSessionTopicId(session.id)
  // `pending` (request sent, waiting for provider) and `streaming` (chunks
  // flowing) both mean "busy" from the sidebar's perspective. If a future
  // design wants to distinguish them (spinner vs pulse), split here.
  const { isPending, isFulfilled, markSeen } = useTopicStreamStatus(sessionTopicId)
  const [renamingTopics] = useCache('topic.renaming')
  const [newlyRenamedTopics] = useCache('topic.newly_renamed')
  const isRenaming = renamingTopics.includes(sessionTopicId)
  const isNewlyRenamed = newlyRenamedTopics.includes(sessionTopicId)

  useEffect(() => {
    // Mark the fulfilled badge as consumed when the user opens the
    // session — the shared stream status stays `done` globally, but each
    // window tracks its own "already seen" flag.
    if (isFulfilled && activeSessionId === session.id) {
      markSeen()
    }
  }, [activeSessionId, isFulfilled, markSeen, session.id])

  const channelIcon = getChannelTypeIcon(channelType)

  const [topicPosition, setTopicPosition] = usePreference('topic.position')
  const singlealone = topicPosition === 'right'

  const actionContext = useMemo<SessionActionContext>(
    () => ({
      onDelete,
      onTogglePin,
      pinned,
      sessionName: session.name ?? '',
      setTopicPosition,
      startEdit,
      t
    }),
    [onDelete, onTogglePin, pinned, session.name, setTopicPosition, startEdit, t]
  )

  const menuActions = useMemo(() => resolveSessionMenuActions(actionContext), [actionContext])

  const handleMenuAction = useCallback(
    async (action: (typeof menuActions)[number]) => {
      await executeSessionMenuAction(action, actionContext)
    },
    [actionContext]
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <SessionListItem
          className={classNames(isActive ? 'active' : '', singlealone ? 'singlealone' : '')}
          onClick={isEditing ? undefined : onPress}
          onDoubleClick={() => startEdit(session.name ?? '')}
          title={session.name ?? session.id}
          style={{
            borderRadius: 'var(--list-item-border-radius)',
            cursor: isEditing ? 'default' : 'pointer'
          }}>
          {isPending && !isActive && <PendingIndicator />}
          {isFulfilled && !isActive && <FulfilledIndicator />}
          <SessionNameContainer>
            {isEditing ? (
              <SessionEditInput {...inputProps} style={{ opacity: isSaving ? 0.5 : 1 }} />
            ) : (
              <>
                <SessionName>
                  {channelIcon && <ChannelIconImg src={channelIcon} />}
                  <MarqueeText className="flex min-w-0 flex-1">
                    <SessionLabel
                      session={session}
                      className={isRenaming ? 'animation-shimmer' : isNewlyRenamed ? 'animation-reveal' : ''}
                    />
                  </MarqueeText>
                </SessionName>
                <DeleteButton />
              </>
            )}
          </SessionNameContainer>
        </SessionListItem>
      </ContextMenuTrigger>
      <ActionMenu actions={menuActions} onAction={handleMenuAction} />
    </ContextMenu>
  )
}

const SessionListItem = styled.div`
  padding: 7px 12px;
  border-radius: var(--list-item-border-radius);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
  width: calc(var(--assistants-width) - 20px);

  .menu {
    opacity: 0;
    color: var(--color-text-3);
  }

  &:hover {
    background-color: var(--color-list-item-hover);
    transition: background-color 0.1s;

    .menu {
      opacity: 1;
    }
  }

  &.active {
    background-color: var(--color-list-item);
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    .menu {
      opacity: 1;

      &:hover {
        color: var(--color-text-2);
      }
    }
  }

  &.singlealone {
    &:hover {
      background-color: var(--color-background-soft);
    }
    &.active {
      background-color: var(--color-background-mute);
      box-shadow: none;
    }
  }
`

const SessionNameContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  height: 20px;
  justify-content: space-between;
`

const SessionName = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  font-size: 13px;
  position: relative;
  min-width: 0;
`

const ChannelIconImg = styled.img`
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border-radius: 2px;
  object-fit: contain;
`

const SessionEditInput = styled.input`
  background: var(--color-background);
  border: none;
  color: var(--color-text-1);
  font-size: 13px;
  font-family: inherit;
  padding: 2px 6px;
  width: 100%;
  outline: none;
  padding: 0;
`

const MenuButton = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  min-width: 20px;
  min-height: 20px;
  .anticon {
    font-size: 12px;
  }
`

const PendingIndicator = styled.div.attrs({
  className: 'animation-pulse'
})`
  --pulse-size: 5px;
  width: 5px;
  height: 5px;
  position: absolute;
  left: 3px;
  top: 15px;
  border-radius: 50%;
  background-color: var(--color-status-warning);
`

const FulfilledIndicator = styled.div.attrs({
  className: 'animation-pulse'
})`
  --pulse-size: 5px;
  width: 5px;
  height: 5px;
  position: absolute;
  left: 3px;
  top: 15px;
  border-radius: 50%;
  background-color: var(--color-status-success);
`

export default memo(SessionItem)
