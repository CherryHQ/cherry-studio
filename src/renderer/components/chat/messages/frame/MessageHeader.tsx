import { Badge, Checkbox, Tooltip } from '@cherrystudio/ui'
import { useIcon } from '@cherrystudio/ui/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useTheme } from '@renderer/hooks/useTheme'
import type { Model } from '@renderer/types/model'
import { getModelLogoRef } from '@renderer/utils/model'
import { firstLetter, removeLeadingEmoji } from '@renderer/utils/naming'
import dayjs from 'dayjs'
import { ArrowUpRight, Sparkle } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useMessageListActions,
  useMessageListMeta,
  useMessageListSelection,
  useMessageRenderConfig,
  useOptionalMessageListActions
} from '../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem } from '../types'
import { getMessageListItemModel } from '../utils/messageListItem'
import MessageAvatar, { MESSAGE_MODEL_AVATAR_ICON_CLASS, MessageAvatarFrame } from './MessageAvatar'
import MessageTokens from './MessageTokens'

interface Props {
  message: MessageListItem
  model?: Model
  isGroupContextMessage?: boolean
  showModelIdentity?: boolean
  actionsSlot?: ReactNode
  contentSlot?: ReactNode
  footerSlot?: ReactNode
}

const DELIVERY_STATUS_LABEL_KEYS = {
  accepted: 'agent.session_delivery.status.accepted',
  consumed: 'agent.session_delivery.status.consumed',
  delivering: 'agent.session_delivery.status.delivering',
  failed: 'agent.session_delivery.status.failed',
  queued: 'agent.session_delivery.status.queued'
} as const

export const AgentSessionDeliveryBadge: FC<{
  delivery: NonNullable<MessageListItem['delivery']>
}> = ({ delivery }) => {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const senderSessionLabel = delivery.senderSnapshot?.sessionName.trim() || delivery.sender.sessionId
  const senderAgentLabel = delivery.senderSnapshot?.agentName.trim() || delivery.sender.agentId
  const content = (
    <>
      <span className="truncate">
        {t('agent.session_delivery.from', {
          agent: senderAgentLabel,
          session: senderSessionLabel
        })}
      </span>
      <span aria-hidden="true">·</span>
      <span className="shrink-0">{t(DELIVERY_STATUS_LABEL_KEYS[delivery.status])}</span>
    </>
  )

  const openSenderSession = () => {
    if (!actions?.navigateToRoute) return
    void actions.navigateToRoute({ path: '/app/agents', query: { sessionId: delivery.sender.sessionId } })
  }

  return (
    <Tooltip
      content={`${delivery.sender.agentId}/${delivery.sender.sessionId} → ${delivery.receiver.agentId}/${delivery.receiver.sessionId}`}>
      {actions?.navigateToRoute ? (
        <Badge
          asChild
          variant="outline"
          className="h-5 max-w-[min(28rem,50vw)] cursor-pointer gap-1 border-info-border bg-info-subtle px-1.5 py-0 font-normal text-info-subtle-foreground text-xs hover:bg-accent hover:text-accent-foreground">
          <button type="button" onClick={openSenderSession}>
            {content}
            <ArrowUpRight aria-hidden="true" />
          </button>
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="h-5 max-w-[min(28rem,50vw)] gap-1 border-info-border bg-info-subtle px-1.5 py-0 font-normal text-info-subtle-foreground text-xs">
          {content}
        </Badge>
      )}
    </Tooltip>
  )
}

const MessageHeader: FC<Props> = memo(
  ({ model, message, isGroupContextMessage, showModelIdentity = false, actionsSlot, contentSlot, footerSlot }) => {
    const { theme } = useTheme()
    const actions = useMessageListActions()
    const meta = useMessageListMeta()
    const renderConfig = useMessageRenderConfig() ?? defaultMessageRenderConfig
    const selection = useMessageListSelection()
    const userName = renderConfig.userName
    const assistantProfile = meta.assistantProfile
    const { t } = useTranslation()
    const messageStyle = renderConfig.messageStyle
    const isBubbleStyle = messageStyle === 'bubble'
    const userAvatar = meta.userProfile?.avatar ?? ''

    const isMultiSelectMode = selection?.isMultiSelectMode ?? false
    const selectedMessageIds = selection?.selectedMessageIds

    const isSelected = selectedMessageIds?.includes(message.id)

    const messageModel = useMemo(() => getMessageListItemModel(message), [message])
    const displayModel = messageModel ?? model
    const displayModelName = displayModel?.name || displayModel?.id
    const ModelIcon = useIcon(useMemo(() => getModelLogoRef(displayModel), [displayModel]))

    // Producing author (assistant/agent) snapshotted at creation — shown first; the model is secondary.
    // Once a snapshot exists the header is frozen: consult the live profile only when it's entirely absent,
    // so editing/deleting the live entity never changes a past message's name or avatar.
    const authorSnapshot = message.messageSnapshot
    const authorName = authorSnapshot ? authorSnapshot.name : assistantProfile?.name
    const authorAvatar = authorSnapshot ? authorSnapshot.emoji : assistantProfile?.avatar
    const getUserName = useCallback(() => {
      if (message.role === 'assistant') {
        return authorName || displayModel?.name || displayModel?.id || ''
      }

      return userName || t('common.you')
    }, [authorName, displayModel, message.role, t, userName])

    const isAssistantMessage = message.role === 'assistant'
    const delivery = message.delivery
    const hiddenContentHoverClass = isAssistantMessage
      ? 'group-hover/header:opacity-100'
      : 'group-hover/message:opacity-100'
    const hiddenActionsHoverClass = isAssistantMessage
      ? 'group-hover/header:pointer-events-auto group-hover/header:opacity-100'
      : 'group-hover/message:pointer-events-auto group-hover/message:opacity-100'

    const username = useMemo(() => removeLeadingEmoji(getUserName()), [getUserName])
    const avatarName = useMemo(() => firstLetter(authorName ?? username ?? '').toUpperCase(), [authorName, username])

    const openUserProfile = useCallback(() => {
      void actions.openUserProfile?.()
    }, [actions])

    const canOpenUserProfile = !!actions.openUserProfile
    const hasBodySlot = !!contentSlot || !!footerSlot

    return (
      <div
        className={`message-header group/header relative flex gap-2.5 ${hasBodySlot ? 'mb-0 items-start' : 'mb-2 items-center'}`}>
        {isAssistantMessage ? (
          authorAvatar ? (
            <MessageAvatar avatar={authorAvatar} fallback={avatarName} />
          ) : ModelIcon ? (
            <MessageAvatarFrame className="bg-background">
              <ModelIcon className={MESSAGE_MODEL_AVATAR_ICON_CLASS} aria-hidden="true" />
            </MessageAvatarFrame>
          ) : (
            <MessageAvatar
              fallback={avatarName}
              fallbackAvatarStyle={{
                border: 'none',
                filter: theme === 'dark' ? 'invert(0.05)' : undefined
              }}
            />
          )
        ) : (
          <MessageAvatar avatar={userAvatar} onClick={canOpenUserProfile ? openUserProfile : undefined} />
        )}
        <div
          className={hasBodySlot ? 'message-body-column flex min-h-0 min-w-0 flex-1 flex-col' : 'flex min-w-0 flex-1'}>
          <div className="flex w-full min-w-0 items-center gap-1.5">
            <span
              className="truncate font-semibold text-sm leading-5"
              style={{
                color: isBubbleStyle && theme === 'dark' ? 'white' : 'var(--foreground)'
              }}>
              {username}
            </span>
            {!isAssistantMessage && delivery && <AgentSessionDeliveryBadge delivery={delivery} />}
            {isAssistantMessage && showModelIdentity && displayModelName && (
              <span className="flex min-w-0 shrink items-center gap-1 text-foreground-tertiary text-xs leading-5">
                <span aria-hidden="true" className="shrink-0">
                  <ModelAvatar className="rounded-full" model={displayModel} size={16} />
                </span>
                <span className="truncate">{displayModelName}</span>
              </span>
            )}
            {isGroupContextMessage && (
              <Tooltip content={t('chat.message.useful.tip')}>
                <Sparkle className="shrink-0" fill="var(--primary)" strokeWidth={0} size={16} />
              </Tooltip>
            )}
            <div
              className={`message-header-info-wrap flex shrink-0 items-center gap-1 text-[10px] text-foreground-tertiary leading-none opacity-0 transition-opacity duration-150 focus-within:opacity-100 ${hiddenContentHoverClass}`}>
              <span>{dayjs(message?.updatedAt ?? message.createdAt).format('MM/DD HH:mm')}</span>
              {renderConfig.showEstimatedTokens &&
                isBubbleStyle &&
                !isAssistantMessage &&
                message.stats !== undefined && (
                  <>
                    |
                    <MessageTokens message={message} />
                  </>
                )}
            </div>
            {actionsSlot && (
              <div
                className={`message-header-actions pointer-events-none ml-auto flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 ${hiddenActionsHoverClass}`}>
                {actionsSlot}
              </div>
            )}
          </div>
          {contentSlot && (
            <div className="message-body-content mt-2 min-h-0 min-w-0 max-w-full flex-1">{contentSlot}</div>
          )}
          {footerSlot && <div className="message-footer-slot mt-auto min-w-0 shrink-0">{footerSlot}</div>}
        </div>
        {isMultiSelectMode && (
          <Checkbox
            data-message-select-checkbox
            checked={isSelected}
            onCheckedChange={(checked) => actions.selectMessage?.(message.id, checked === true)}
            className="absolute top-0 right-0"
          />
        )}
      </div>
    )
  }
)

MessageHeader.displayName = 'MessageHeader'

export default MessageHeader
