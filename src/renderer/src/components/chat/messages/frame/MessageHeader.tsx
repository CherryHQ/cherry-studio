import { Avatar, AvatarFallback, AvatarImage, Checkbox, EmojiAvatar, Tooltip } from '@cherrystudio/ui'
import { getModelLogo } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { Model } from '@renderer/types'
import { firstLetter, isEmoji, removeLeadingEmoji } from '@renderer/utils'
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
import MessageTokens from './MessageTokens'

const MESSAGE_AVATAR_SIZE = 30
const MESSAGE_EMOJI_AVATAR_FONT_SIZE = 17
const MESSAGE_AVATAR_CLASS = 'h-[30px] w-[30px] rounded-full'

interface Props {
  message: MessageListItem
  model?: Model
  isGroupContextMessage?: boolean
  actionsSlot?: ReactNode
}

const MessageHeader: FC<Props> = memo(({ model, message, isGroupContextMessage, actionsSlot }) => {
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

  const showMiniApp = useCallback(() => {
    if (displayModel?.provider) {
      void actions.openProviderApp?.(displayModel.provider)
    }
  }, [actions, displayModel?.provider])

  const openUserProfile = useCallback(() => {
    void actions.openUserProfile?.()
  }, [actions])

  const canOpenProviderApp = !!actions.openProviderApp && !!displayModel?.provider
  const canOpenUserProfile = !!actions.openUserProfile

  return (
    <div className="message-header group/header relative mb-2 flex items-center gap-2.5">
      {isAssistantMessage ? (
        assistantProfile?.avatar ? (
          isEmoji(assistantProfile.avatar) ? (
            <EmojiAvatar className="rounded-full" size={MESSAGE_AVATAR_SIZE} fontSize={MESSAGE_EMOJI_AVATAR_FONT_SIZE}>
              {assistantProfile.avatar}
            </EmojiAvatar>
          ) : (
            <Avatar className={MESSAGE_AVATAR_CLASS}>
              <AvatarImage src={assistantProfile.avatar} />
              <AvatarFallback className="rounded-full">{avatarName}</AvatarFallback>
            </Avatar>
          )
        ) : ModelIcon ? (
          <div
            onClick={canOpenProviderApp ? showMiniApp : undefined}
            className={canOpenProviderApp ? 'cursor-pointer' : undefined}>
            <ModelIcon.Avatar size={MESSAGE_AVATAR_SIZE} shape="circle" className="rounded-full" />
          </div>
        ) : (
          <Avatar
            className={`${MESSAGE_AVATAR_CLASS} ${canOpenProviderApp ? 'cursor-pointer' : ''}`}
            style={{
              cursor: canOpenProviderApp ? 'pointer' : 'default',
              border: 'none',
              filter: theme === 'dark' ? 'invert(0.05)' : undefined
            }}
            onClick={canOpenProviderApp ? showMiniApp : undefined}>
            <AvatarFallback className="rounded-full">{avatarName}</AvatarFallback>
          </Avatar>
        )
      ) : (
        <>
          {isEmoji(userAvatar) ? (
            <EmojiAvatar
              className={`rounded-full ${canOpenUserProfile ? 'cursor-pointer' : ''}`}
              onClick={canOpenUserProfile ? openUserProfile : undefined}
              size={MESSAGE_AVATAR_SIZE}
              fontSize={MESSAGE_EMOJI_AVATAR_FONT_SIZE}>
              {userAvatar}
            </EmojiAvatar>
          ) : (
            <Avatar
              className={`${MESSAGE_AVATAR_CLASS} ${canOpenUserProfile ? 'cursor-pointer' : ''}`}
              onClick={canOpenUserProfile ? openUserProfile : undefined}>
              <AvatarImage src={userAvatar} />
            </Avatar>
          )}
        </>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
          {isBubbleStyle && message.stats !== undefined && (
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
      {isMultiSelectMode && (
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => actions.selectMessage?.(message.id, checked === true)}
          className="absolute top-0 right-0"
        />
      )}
    </div>
  )
})

MessageHeader.displayName = 'MessageHeader'

export default MessageHeader
