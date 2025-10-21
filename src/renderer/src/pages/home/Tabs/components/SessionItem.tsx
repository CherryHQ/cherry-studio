import { cn } from '@heroui/react'
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
import { AgentSessionEntity } from '@renderer/types'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@renderer/ui/context-menu'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { Tooltip } from 'antd'
import { MenuIcon, XIcon } from 'lucide-react'
import React, { FC, memo, startTransition, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ListItem, ListItemEditInput, ListItemName, ListItemNameContainer, MenuButton, StatusIndicator } from './shared'

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
          <ListItem
            className={cn(
              isActive ? 'active' : undefined,
              singlealone ? 'singlealone' : undefined,
              isEditing ? 'cursor-default' : 'cursor-pointer',
              'rounded-[var(--list-item-border-radius)]'
            )}
            onClick={isEditing ? undefined : onPress}
            onDoubleClick={() => startEdit(session.name ?? '')}
            title={session.name ?? session.id}>
            {isPending && !isActive && <StatusIndicator variant="pending" />}
            {isFulfilled && !isActive && <StatusIndicator variant="fulfilled" />}
            <ListItemNameContainer>
              {isEditing ? (
                <ListItemEditInput
                  ref={inputRef}
                  value={editValue}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleValueChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  style={{ opacity: isSaving ? 0.5 : 1 }}
                />
              ) : (
                <>
                  <ListItemName>
                    <SessionLabel session={session} />
                  </ListItemName>
                  <DeleteButton />
                </>
              )}
            </ListItemNameContainer>
          </ListItem>
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

export default memo(SessionItem)
