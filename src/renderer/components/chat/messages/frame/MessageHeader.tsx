import { Checkbox, Tooltip } from '@cherrystudio/ui'
import { getModelLogo } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { Model } from '@renderer/types'
import { firstLetter, removeLeadingEmoji } from '@renderer/utils'
import dayjs from 'dayjs'
import { Sparkle } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useMessageListActions,
  useMessageListMeta,
  useMessageListSelection,
  useMessageRenderConfig
} from '../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem } from '../types'
import { getMessageListItemModel, getMessageListItemModelName } from '../utils/messageListItem'
import MessageAvatar, { MESSAGE_MODEL_AVATAR_ICON_CLASS, MessageAvatarFrame } from './MessageAvatar'
import MessageTokens from './MessageTokens'

interface Props {
  message: MessageListItem
  model?: Model
  isGroupContextMessage?: boolean
  actionsSlot?: ReactNode
  contentSlot?: ReactNode
  footerSlot?: ReactNode
}

const MessageHeader: FC<Props> = memo(
  ({ model, message, isGroupContextMessage, actionsSlot, contentSlot, footerSlot }) => {
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
    const ModelIcon = useMemo(() => getModelLogo(displayModel), [displayModel])

    const getUserName = useCallback(() => {
      if (message.role === 'assistant' && assistantProfile?.name) {
        return assistantProfile.name
      }

      if (message.role === 'assistant') {
        return getMessageListItemModelName(message) || model?.name || model?.id || ''
      }

      return userName || t('common.you')
    }, [assistantProfile?.name, message, model, t, userName])

    const isAssistantMessage = message.role === 'assistant'
    const hiddenContentHoverClass = isAssistantMessage
      ? 'group-hover/header:opacity-100'
      : 'group-hover/message:opacity-100'
    const hiddenActionsHoverClass = isAssistantMessage
      ? 'group-hover/header:pointer-events-auto group-hover/header:opacity-100'
      : 'group-hover/message:pointer-events-auto group-hover/message:opacity-100'

    const username = useMemo(() => removeLeadingEmoji(getUserName()), [getUserName])
    const avatarName = useMemo(
      () => firstLetter(assistantProfile?.name ?? username ?? '').toUpperCase(),
      [assistantProfile?.name, username]
    )

    const openUserProfile = useCallback(() => {
      void actions.openUserProfile?.()
    }, [actions])

    const canOpenUserProfile = !!actions.openUserProfile
    const hasBodySlot = !!contentSlot || !!footerSlot

    return (
      <div
        className={`message-header group/header relative flex gap-2.5 ${hasBodySlot ? 'mb-0 items-start' : 'mb-2 items-center'}`}>
        {isAssistantMessage ? (
          assistantProfile?.avatar ? (
            <MessageAvatar avatar={assistantProfile.avatar} fallback={avatarName} />
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
                color: isBubbleStyle && theme === 'dark' ? 'white' : 'var(--color-foreground)'
              }}>
              {username}
            </span>
            {isGroupContextMessage && (
              <Tooltip content={t('chat.message.useful.tip')}>
                <Sparkle className="shrink-0" fill="var(--color-primary)" strokeWidth={0} size={16} />
              </Tooltip>
            )}
            <div
              className={`message-header-info-wrap flex shrink-0 items-center gap-1 text-[10px] text-foreground-muted leading-none opacity-0 transition-opacity duration-150 focus-within:opacity-100 ${hiddenContentHoverClass}`}>
              <span>{dayjs(message?.updatedAt ?? message.createdAt).format('MM/DD HH:mm')}</span>
              {isBubbleStyle && !isAssistantMessage && message.stats !== undefined && (
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
