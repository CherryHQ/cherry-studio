import { Button, cn, Input, Tooltip } from '@heroui/react'
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
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@renderer/ui/context-menu'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { XIcon } from 'lucide-react'
import React, { type FC, memo, startTransition, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

// const logger = loggerService.withContext('AgentItem')

interface SessionItemProps {
  session: AgentSessionEntity
  // use external agentId as SSOT, instead of session.agent_id
  agentId: string
  isDisabled?: boolean
  isLoading?: boolean
  onDelete: () => void
  onPress: () => void
}

const SessionItem: FC<SessionItemProps> = ({ session, agentId, isDisabled, isLoading, onDelete, onPress }) => {
  const { t } = useTranslation()
  const { chat } = useRuntime()
  const updateSession = useUpdateSession(agentId)
  const activeSessionId = chat.activeSessionId[agentId]
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
        content={t('chat.topics.delete.shortcut', { key: isMac ? '⌘' : 'Ctrl' })}
        classNames={{ content: 'text-xs' }}
        delay={500}
        closeDelay={0}>
        <div
          role="button"
          className={cn(
            'mr-2 flex aspect-square h-6 w-6 items-center justify-center rounded-2xl',
            isConfirmingDeletion ? 'hover:bg-danger-100' : 'hover:bg-foreground-300'
          )}
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
            <DeleteIcon
              size={14}
              className="opacity-0 transition-colors-opacity group-hover:text-danger group-hover:opacity-100"
            />
          ) : (
            <XIcon
              size={14}
              className={cn(isActive ? 'opacity-100' : 'opacity-0', 'group-hover:opacity-100', 'transition-opacity')}
            />
          )}
        </div>
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

  return (
    <>
      <ContextMenu modal={false}>
        <ContextMenuTrigger>
          <ButtonContainer
            isDisabled={isDisabled}
            isLoading={isLoading}
            onPress={onPress}
            isActive={isActive}
            onDoubleClick={() => startEdit(session.name ?? '')}
            className="group">
            <SessionLabelContainer className="name h-full w-full pl-1" title={session.name ?? session.id}>
              {isPending && !isActive && <PendingIndicator />}
              {isFulfilled && !isActive && <FulfilledIndicator />}
              {isEditing && (
                <Input
                  ref={inputRef}
                  variant="bordered"
                  value={editValue}
                  onValueChange={handleValueChange}
                  onKeyDown={handleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  classNames={{
                    base: 'h-full',
                    mainWrapper: 'h-full',
                    inputWrapper: 'h-full min-h-0 px-1.5',
                    input: isSaving ? 'brightness-50' : undefined
                  }}
                />
              )}
              {!isEditing && (
                <div className="flex w-full items-center justify-between">
                  <SessionLabel session={session} />
                  <DeleteButton />
                </div>
              )}
            </SessionLabelContainer>
          </ButtonContainer>
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

const ButtonContainer: React.FC<React.ComponentProps<typeof Button> & { isActive?: boolean }> = ({
  isActive,
  className,
  children,
  ...props
}) => {
  const { topicPosition } = useSettings()
  const activeBg = topicPosition === 'left' ? 'bg-[var(--color-list-item)]' : 'bg-foreground-100'
  return (
    <Button
      {...props}
      variant="light"
      className={cn(
        'relative mb-2 flex h-9 flex-row justify-between p-0',
        'rounded-[var(--list-item-border-radius)]',
        'border-[0.5px] border-transparent',
        'w-[calc(var(--assistants-width)_-_20px)]',
        'cursor-pointer',
        isActive ? cn(activeBg, 'shadow-sm') : undefined,
        className
      )}>
      {children}
    </Button>
  )
}

const SessionLabelContainer: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    {...props}
    className={cn('text-[13px] text-[var(--color-text)]', 'flex flex-row items-center gap-2', className)}
  />
)

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
