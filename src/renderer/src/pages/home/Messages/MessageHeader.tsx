import UserPopup from '@renderer/components/Popups/UserPopup'
import { APP_NAME, AppLogo, isLocalAi } from '@renderer/config/env'
import { startMinAppById } from '@renderer/config/minapps'
import { getModelLogo } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import useAvatar from '@renderer/hooks/useAvatar'
import { useMessageStyle, useSettings } from '@renderer/hooks/useSettings'
import { getMessageModelId } from '@renderer/services/MessagesService'
import { getModelName } from '@renderer/services/ModelService'
import { Assistant, Message, Model } from '@renderer/types'
import { firstLetter, removeLeadingEmoji } from '@renderer/utils'
import { Avatar } from 'antd'
import dayjs from 'dayjs'
import { CSSProperties, FC, memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  message: Message
  assistant: Assistant
  model?: Model
}

const getAvatarSource = (isLocalAi: boolean, modelId: string | undefined) => {
  if (isLocalAi) return AppLogo
  return modelId ? getModelLogo(modelId) : undefined
}

const MessageHeader: FC<Props> = memo(({ assistant, model, message }) => {
  const avatar = useAvatar()
  const { theme } = useTheme()
  const { userName, sidebarIcons } = useSettings()
  const { t } = useTranslation()
  const { isBubbleStyle } = useMessageStyle()

  const avatarSource = useMemo(() => getAvatarSource(isLocalAi, getMessageModelId(message)), [message])

  const getUserName = useCallback(() => {
    if (isLocalAi && message.role !== 'user') {
      return APP_NAME
    }

    if (message.role === 'assistant') {
      return getModelName(model) || getMessageModelId(message) || ''
    }

    return userName || t('common.you')
  }, [message, model, t, userName])

  const isAssistantMessage = message.role === 'assistant'
  const showMinappIcon = sidebarIcons.visible.includes('minapp')

  const avatarName = useMemo(() => firstLetter(assistant?.name).toUpperCase(), [assistant?.name])
  const username = useMemo(() => removeLeadingEmoji(getUserName()), [getUserName])

  const showMiniApp = useCallback(() => {
    showMinappIcon && model?.provider && startMinAppById(model.provider)
  }, [model?.provider, showMinappIcon])

  const avatarStyle: CSSProperties | undefined = isBubbleStyle
    ? {
        flexDirection: isAssistantMessage ? 'row' : 'row-reverse',
        textAlign: isAssistantMessage ? 'left' : 'right'
      }
    : undefined

  return (
    <Container className="message-header">
      <AvatarWrapper style={avatarStyle}>
        {isAssistantMessage ? (
          <Avatar
            src={avatarSource}
            size={35}
            style={{
              borderRadius: '20%',
              cursor: showMinappIcon ? 'pointer' : 'default',
              border: isLocalAi ? '1px solid var(--color-border-soft)' : 'none',
              filter: theme === 'dark' ? 'invert(0.05)' : undefined
            }}
            onClick={showMiniApp}>
            {avatarName}
          </Avatar>
        ) : (
          <Avatar
            src={avatar}
            size={35}
            style={{ borderRadius: '20%', cursor: 'pointer' }}
            onClick={() => UserPopup.show()}
          />
        )}
        <UserWrap>
          <UserName isBubbleStyle={isBubbleStyle} theme={theme}>
            {username}
          </UserName>
          <MessageTime>{dayjs(message.createdAt).format('MM/DD HH:mm')}</MessageTime>
        </UserWrap>
      </AvatarWrapper>
    </Container>
  )
})

MessageHeader.displayName = 'MessageHeader'

const Container = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-bottom: 4px;
`

const AvatarWrapper = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
`

const UserWrap = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
`

const UserName = styled.div<{ isBubbleStyle?: boolean; theme?: string }>`
  font-size: 14px;
  font-weight: 600;
  color: ${(props) => (props.isBubbleStyle && props.theme === 'dark' ? 'white' : 'var(--color-text)')};
`

const MessageTime = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
`

export default MessageHeader
