import { Avatar, AvatarFallback, AvatarImage, Checkbox, EmojiAvatar, RowFlex, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import UserPopup from '@renderer/components/Popups/UserPopup'
import { getModelLogo } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAgent } from '@renderer/hooks/agents/useAgentDataApi'
import { useActiveSession } from '@renderer/hooks/agents/useSessionDataApi'
import useAvatar from '@renderer/hooks/useAvatar'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useMessageStyle } from '@renderer/hooks/useSettings'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import { getMessageModelId } from '@renderer/services/MessagesService'
import type { Assistant, Model, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { firstLetter, isEmoji, removeLeadingEmoji } from '@renderer/utils'
import dayjs from 'dayjs'
import { Sparkle } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import MessageTokens from './MessageTokens'

interface Props {
  message: Message
  assistant?: Assistant
  model?: Model
  topic: Topic
  isGroupContextMessage?: boolean
}

const MessageHeader: FC<Props> = memo(({ assistant, model, message, topic, isGroupContextMessage }) => {
  const avatar = useAvatar()
  const { theme } = useTheme()
  const [userName] = usePreference('app.user.name')
  const showMiniAppIcon = useSidebarIconShow('mini_app')
  const { session: activeSession } = useActiveSession()
  const { agent } = useAgent(activeSession?.agentId ?? null)
  const isAgentView = window.location.hash.startsWith('#/agents')
  const { t } = useTranslation()
  const { isBubbleStyle } = useMessageStyle()
  const { openMiniAppById } = useMiniAppPopup()

  const { isMultiSelectMode, selectedMessageIds, handleSelectMessage } = useChatContext(topic)

  const isSelected = selectedMessageIds?.includes(message.id)

  const ModelIcon = useMemo(() => getModelLogo(message.model ?? model), [message.model, model])

  const getUserName = useCallback(() => {
    if (isAgentView && message.role === 'assistant') {
      return agent?.name ?? t('common.unknown')
    }

    if (message.role === 'assistant') {
      return model?.name || model?.id || getMessageModelId(message) || ''
    }

    return userName || t('common.you')
  }, [agent?.name, isAgentView, message, model, t, userName])

  const isAssistantMessage = message.role === 'assistant'
  const isUserMessage = message.role === 'user'

  const avatarName = useMemo(() => firstLetter(assistant?.name ?? '').toUpperCase(), [assistant?.name])
  const username = useMemo(() => removeLeadingEmoji(getUserName()), [getUserName])

  const showMiniApp = useCallback(() => {
    showMiniAppIcon && model?.provider && openMiniAppById(model.provider)
    // because don't need openMiniAppById to be a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.provider, showMiniAppIcon])

  const userNameJustifyContent = useMemo(() => {
    if (!isBubbleStyle) return 'flex-start'
    if (isUserMessage && !isMultiSelectMode) return 'flex-end'
    return 'flex-start'
  }, [isBubbleStyle, isUserMessage, isMultiSelectMode])

  return (
    <div className="message-header relative mb-2.5 flex items-center gap-2.5">
      {isAssistantMessage ? (
        ModelIcon ? (
          <div onClick={showMiniApp} className="cursor-pointer">
            <ModelIcon.Avatar size={35} className="rounded-[25%]" />
          </div>
        ) : (
          <Avatar
            className="h-[35px] w-[35px] cursor-pointer rounded-[25%]"
            style={{
              cursor: showMiniAppIcon ? 'pointer' : 'default',
              border: 'none',
              filter: theme === 'dark' ? 'invert(0.05)' : undefined
            }}
            onClick={showMiniApp}>
            <AvatarFallback className="rounded-[25%]">{avatarName}</AvatarFallback>
          </Avatar>
        )
      ) : (
        <>
          {isEmoji(avatar) ? (
            <EmojiAvatar onClick={() => UserPopup.show()} size={35} fontSize={20}>
              {avatar}
            </EmojiAvatar>
          ) : (
            <Avatar className="h-[35px] w-[35px] cursor-pointer rounded-[25%]" onClick={() => UserPopup.show()}>
              <AvatarImage src={avatar} />
            </Avatar>
          )}
        </>
      )}
      <div className="flex flex-1 flex-col justify-between">
        <RowFlex className="items-center" style={{ justifyContent: userNameJustifyContent }}>
          <span
            className="font-semibold text-sm"
            style={{
              color: isBubbleStyle && theme === 'dark' ? 'white' : 'var(--color-text)'
            }}>
            {username}
          </span>
          {isGroupContextMessage && (
            <Tooltip content={t('chat.message.useful.tip')}>
              <Sparkle fill="var(--color-primary)" strokeWidth={0} size={18} />
            </Tooltip>
          )}
        </RowFlex>
        <div className="message-header-info-wrap flex items-center gap-1 text-(--color-text-3) text-[10px]">
          <div>{dayjs(message?.updatedAt ?? message.createdAt).format('MM/DD HH:mm')}</div>
          {isBubbleStyle && message.usage !== undefined && (
            <>
              |
              <MessageTokens message={message} />
            </>
          )}
        </div>
      </div>
      {isMultiSelectMode && (
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => handleSelectMessage(message.id, checked === true)}
          className="absolute top-0 right-0"
        />
      )}
    </div>
  )
})

MessageHeader.displayName = 'MessageHeader'

export default MessageHeader
