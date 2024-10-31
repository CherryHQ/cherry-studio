import UserPopup from '@renderer/components/Popups/UserPopup'
import { APP_NAME, AppLogo, isLocalAi } from '@renderer/config/env'
import { startMinAppById } from '@renderer/config/minapps'
import { getModelLogo } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import useAvatar from '@renderer/hooks/useAvatar'
import { useSettings } from '@renderer/hooks/useSettings'
import { Assistant, Message, Model } from '@renderer/types'
import { firstLetter, removeLeadingEmoji } from '@renderer/utils'
import { Avatar } from 'antd'
import dayjs from 'dayjs'
import { FC, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  message: Message
  assistant: Assistant
  model?: Model
}

const MessageHeader: FC<Props> = ({ assistant, model, message }) => {
  const avatar = useAvatar()
  const { theme } = useTheme()
  const { userName } = useSettings()
  const { t } = useTranslation()

  const isAssistantMessage = message.role === 'assistant'

  const avatarSource = useMemo(() => {
    if (isLocalAi) return AppLogo
    return message.modelId ? getModelLogo(message.modelId) : undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.modelId, theme])

  const getUserName = useCallback(() => {
    if (isLocalAi && message.role !== 'user') return APP_NAME
    if (message.role === 'assistant') return model?.name || model?.id || ''
    return userName || t('common.you')
  }, [message.role, model?.id, model?.name, t, userName])

  const avatarName = useMemo(() => firstLetter(assistant?.name).toUpperCase(), [assistant?.name])

  const username = useMemo(() => removeLeadingEmoji(getUserName()), [getUserName])

  const showMiniApp = () => model?.provider && startMinAppById(model?.provider)

  return (
    <Container>
      <AvatarWrapper
        style={{
          flexDirection: isAssistantMessage ? 'row' : 'row-reverse',
          textAlign: isAssistantMessage ? 'left' : 'right'
        }}>
        {isAssistantMessage ? (
          <Avatar
            src={avatarSource}
            size={35}
            style={{
              borderRadius: '20%',
              cursor: 'pointer',
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
          <UserName>{username}</UserName>
          <MessageTime>{dayjs(message.createdAt).format('MM/DD HH:mm')}</MessageTime>
        </UserWrap>
      </AvatarWrapper>
    </Container>
  )
}

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

const UserName = styled.div`
  font-size: 14px;
  font-weight: 600;
`

const MessageTime = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
`

export default MessageHeader
