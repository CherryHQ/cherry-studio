import { Avatar, AvatarFallback, AvatarImage, Checkbox, EmojiAvatar, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import UserPopup from '@renderer/components/Popups/UserPopup'
import { getModelLogo } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import useAvatar from '@renderer/hooks/useAvatar'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import { getMessageModelId } from '@renderer/services/MessagesService'
import type { Assistant, Model } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { firstLetter, isEmoji, removeLeadingEmoji } from '@renderer/utils'
import dayjs from 'dayjs'
import { Sparkle } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useMessageList } from '../MessageListProvider'
import MessageTokens from './MessageTokens'

const MESSAGE_AVATAR_SIZE = 30
const MESSAGE_EMOJI_AVATAR_FONT_SIZE = 17
const MESSAGE_AVATAR_CLASS = 'h-[30px] w-[30px] rounded-full'

interface Props {
  message: Message
  assistant?: Assistant
  model?: Model
  isGroupContextMessage?: boolean
  actionsSlot?: ReactNode
}

const MessageHeader: FC<Props> = memo(({ assistant, model, message, isGroupContextMessage, actionsSlot }) => {
  const avatar = useAvatar()
  const { theme } = useTheme()
  const [userName] = usePreference('app.user.name')
  const showMiniAppIcon = useSidebarIconShow('mini_app')
  const { state, actions, meta } = useMessageList()
  const assistantProfile = meta.assistantProfile
  const { t } = useTranslation()
  const [messageStyle] = usePreference('chat.message.style')
  const isBubbleStyle = messageStyle === 'bubble'
  const { openMiniAppById } = useMiniAppPopup()

  const isMultiSelectMode = state.selection?.isMultiSelectMode ?? false
  const selectedMessageIds = state.selection?.selectedMessageIds

  const isSelected = selectedMessageIds?.includes(message.id)

  const ModelIcon = useMemo(() => getModelLogo(message.model ?? model), [message.model, model])

  const getUserName = useCallback(() => {
    if (message.role === 'assistant' && assistantProfile?.name) {
      return assistantProfile.name
    }

    if (message.role === 'assistant') {
      return model?.name || model?.id || getMessageModelId(message) || ''
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

  const avatarName = useMemo(
    () => firstLetter(assistantProfile?.name ?? assistant?.name ?? '').toUpperCase(),
    [assistant?.name, assistantProfile?.name]
  )
  const username = useMemo(() => removeLeadingEmoji(getUserName()), [getUserName])

  const showMiniApp = useCallback(() => {
    showMiniAppIcon && model?.provider && openMiniAppById(model.provider)
    // because don't need openMiniAppById to be a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.provider, showMiniAppIcon])

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
          <div onClick={showMiniApp} className="cursor-pointer">
            <ModelIcon.Avatar size={MESSAGE_AVATAR_SIZE} shape="circle" className="rounded-full" />
          </div>
        ) : (
          <Avatar
            className={`${MESSAGE_AVATAR_CLASS} cursor-pointer`}
            style={{
              cursor: showMiniAppIcon ? 'pointer' : 'default',
              border: 'none',
              filter: theme === 'dark' ? 'invert(0.05)' : undefined
            }}
            onClick={showMiniApp}>
            <AvatarFallback className="rounded-full">{avatarName}</AvatarFallback>
          </Avatar>
        )
      ) : (
        <>
          {isEmoji(avatar) ? (
            <EmojiAvatar
              className="rounded-full"
              onClick={() => UserPopup.show()}
              size={MESSAGE_AVATAR_SIZE}
              fontSize={MESSAGE_EMOJI_AVATAR_FONT_SIZE}>
              {avatar}
            </EmojiAvatar>
          ) : (
            <Avatar className={`${MESSAGE_AVATAR_CLASS} cursor-pointer`} onClick={() => UserPopup.show()}>
              <AvatarImage src={avatar} />
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
          {isBubbleStyle && message.usage !== undefined && (
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
