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
        <div
          className={classNames(
            'menu flex min-h-5 min-w-5 flex-row items-center justify-center text-(--color-text-3) opacity-0 group-hover:opacity-100 [&_.anticon]:text-xs',
            isActive && 'opacity-100 hover:text-(--color-text-2)'
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
            <DeleteIcon size={14} color="var(--color-error)" style={{ pointerEvents: 'none' }} />
          ) : (
            <XIcon size={14} color="var(--color-text-3)" style={{ pointerEvents: 'none' }} />
          )}
        </div>
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
        <div
          className={classNames(
            'group relative flex w-[calc(var(--assistants-width)-20px)] flex-col justify-between px-3 py-[7px] text-[13px] transition-colors duration-100',
            singlealone
              ? isActive
                ? 'bg-(--color-background-mute)'
                : 'hover:bg-(--color-background-soft)'
              : isActive
                ? 'bg-(--color-list-item) shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                : 'hover:bg-(--color-list-item-hover)'
          )}
          onClick={isEditing ? undefined : onPress}
          onDoubleClick={() => startEdit(session.name ?? '')}
          title={session.name ?? session.id}
          style={{
            borderRadius: 'var(--list-item-border-radius)',
            cursor: isEditing ? 'default' : 'pointer'
          }}>
          {isPending && !isActive && <PendingIndicator />}
          {isFulfilled && !isActive && <FulfilledIndicator />}
          <div className="flex h-5 flex-row items-center justify-between gap-1">
            {isEditing ? (
              <input
                {...inputProps}
                className="w-full border-none bg-(--color-background) p-0 font-[inherit] text-(--color-text-1) text-[13px] outline-none"
                style={{ opacity: isSaving ? 0.5 : 1 }}
              />
            ) : (
              <>
                <div className="relative flex min-w-0 items-center gap-1 overflow-hidden text-[13px]">
                  {channelIcon && (
                    <img className="size-3.5 shrink-0 rounded-[2px] object-contain" src={channelIcon} alt="" />
                  )}
                  <MarqueeText className="flex min-w-0 flex-1">
                    <SessionLabel
                      session={session}
                      className={isRenaming ? 'animation-shimmer' : isNewlyRenamed ? 'animation-reveal' : ''}
                    />
                  </MarqueeText>
                </div>
                <DeleteButton />
              </>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ActionMenu actions={menuActions} onAction={handleMenuAction} />
    </ContextMenu>
  )
}

const streamIndicatorClass = 'animation-pulse absolute top-[15px] left-[3px] size-[5px] rounded-full [--pulse-size:5px]'

const PendingIndicator = () => <div className={`${streamIndicatorClass} bg-(--color-status-warning)`} />

const FulfilledIndicator = () => <div className={`${streamIndicatorClass} bg-(--color-status-success)`} />

export default memo(SessionItem)
