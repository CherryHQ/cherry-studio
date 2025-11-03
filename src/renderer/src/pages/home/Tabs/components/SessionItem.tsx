import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { isMac } from '@renderer/config/constant'
import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { useInPlaceEdit } from '@renderer/hooks/useInPlaceEdit'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTimer } from '@renderer/hooks/useTimer'
import { SessionSettingsPopup } from '@renderer/pages/settings/AgentSettings'
import { SessionLabel } from '@renderer/pages/settings/AgentSettings/shared'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { AgentSessionEntity } from '@renderer/types'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@renderer/ui/context-menu'
import { classNames } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { Tooltip } from 'antd'
import { MenuIcon, XIcon } from 'lucide-react'
import type { FC } from 'react'
import React, { memo, startTransition, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

// const logger = loggerService.withContext('AgentItem')

interface SessionItemProps {
  session: AgentSessionEntity
  // use external agentId as SSOT, instead of session.agent_id
  agentId: string
  onDelete: () => void
  onPress: () => void
}

const SessionItem: FC<SessionItemProps> = ({ session, agentId, onDelete, onPress }) => {
  const { t } = useTranslation()
  const { chat } = useRuntime()
  const { updateSession } = useUpdateSession(agentId)
  const activeSessionId = chat.activeSessionIdMap[agentId]
  const [isConfirmingDeletion, setIsConfirmingDeletion] = useState(false)
  const { setTimeoutTimer } = useTimer()
  const dispatch = useAppDispatch()

  const { isEditing, isSaving, editValue, inputRef, startEdit, handleKeyDown, handleValueChange } = useInPlaceEdit({
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
        mouseEnterDelay={0.7}
        mouseLeaveDelay={0}
        title={
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
  const topicLoadingQuery = useAppSelector((state) => state.messages.loadingByTopic)
  const topicFulfilledQuery = useAppSelector((state) => state.messages.fulfilledByTopic)
  const sessionTopicId = buildAgentSessionTopicId(session.id)
  const isPending = useMemo(() => topicLoadingQuery[sessionTopicId], [sessionTopicId, topicLoadingQuery])
  const isFulfilled = useMemo(() => topicFulfilledQuery[sessionTopicId], [sessionTopicId, topicFulfilledQuery])

  useEffect(() => {
    if (isFulfilled && activeSessionId === session.id) {
      dispatch(newMessagesActions.setTopicFulfilled({ topicId: sessionTopicId, fulfilled: false }))
    }
  }, [activeSessionId, dispatch, isFulfilled, session.id, sessionTopicId])

  const { topicPosition, setTopicPosition } = useSettings()
  const singlealone = topicPosition === 'right'

  return (
    <>
      <ContextMenu modal={false}>
        <ContextMenuTrigger>
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
                <SessionEditInput
                  ref={inputRef}
                  value={editValue}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleValueChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  style={{ opacity: isSaving ? 0.5 : 1 }}
                />
              ) : (
                <>
                  <SessionName>
                    <SessionLabel session={session} />
                  </SessionName>
                  <DeleteButton />
                </>
              )}
            </SessionNameContainer>
          </SessionListItem>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            key="edit"
            onClick={() => {
              SessionSettingsPopup.show({
                agentId,
                sessionId: session.id
              })
            }}>
            <EditIcon size={14} />
            {t('common.edit')}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger className="gap-2">
              <MenuIcon size={14} />
              {t('settings.topic.position.label')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem key="left" onClick={() => setTopicPosition('left')}>
                {t('settings.topic.position.left')}
              </ContextMenuItem>
              <ContextMenuItem key="right" onClick={() => setTopicPosition('right')}>
                {t('settings.topic.position.right')}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem
            key="delete"
            className="text-danger"
            onClick={() => {
              onDelete()
            }}>
            <DeleteIcon size={14} className="lucide-custom text-danger" />
            <span className="text-danger">{t('common.delete')}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
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
  margin-bottom: 8px;

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
    border-radius: 0 !important;
    &:hover {
      background-color: var(--color-background-soft);
    }
    &.active {
      border-left: 2px solid var(--color-primary);
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
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  position: relative;
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
