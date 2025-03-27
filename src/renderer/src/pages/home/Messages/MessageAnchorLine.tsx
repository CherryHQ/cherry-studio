import { APP_NAME, AppLogo, isLocalAi } from '@renderer/config/env'
import { getModelLogo } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import useAvatar from '@renderer/hooks/useAvatar'
import { useSettings } from '@renderer/hooks/useSettings'
import { getMessageModelId } from '@renderer/services/MessagesService'
import { getModelName } from '@renderer/services/ModelService'
import { useAppDispatch } from '@renderer/store'
import { updateMessageThunk } from '@renderer/store/messages'
import type { Message } from '@renderer/types'
import { isEmoji, removeLeadingEmoji } from '@renderer/utils'
import { Avatar } from 'antd'
import { type FC, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
interface MessageLineProps {
  messages: Message[]
}

const getAvatarSource = (isLocalAi: boolean, modelId: string | undefined) => {
  if (isLocalAi) return AppLogo
  return modelId ? getModelLogo(modelId) : undefined
}

const MessageAnchorLine: FC<MessageLineProps> = ({ messages }) => {
  const { t } = useTranslation()
  const avatar = useAvatar()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const { userName } = useSettings()
  const messagesListRef = useRef<HTMLDivElement>(null)
  const messageItemsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)
  const [mouseY, setMouseY] = useState<number | null>(null)
  const { topicPosition, showTopics } = useSettings()
  const showRightTopics = topicPosition === 'right' && showTopics
  const right = showRightTopics ? 'calc(var(--topic-list-width) + 15px)' : '15px'

  const [listOffsetY, setListOffsetY] = useState(0)
  const [containerHeight, setContainerHeight] = useState<number | null>(null)

  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const parentElement = containerRef.current.parentElement
        if (parentElement) {
          setContainerHeight(parentElement.clientHeight)
        }
      }
    }

    updateHeight()
    window.addEventListener('resize', updateHeight)

    return () => {
      window.removeEventListener('resize', updateHeight)
    }
  }, [messages])

  // 函数用于计算根据距离的变化值
  const calculateValueByDistance = useCallback(
    (itemId: string, maxValue: number) => {
      if (mouseY === null) return 0

      const element = messageItemsRef.current.get(itemId)
      if (!element) return 0

      const rect = element.getBoundingClientRect()
      const centerY = rect.top + rect.height / 2
      const distance = Math.abs(centerY - (messagesListRef.current?.getBoundingClientRect().top || 0) - mouseY)
      const maxDistance = 100

      return Math.max(0, maxValue * (1 - distance / maxDistance))
    },
    [mouseY]
  )

  const getUserName = useCallback(
    (message: Message) => {
      if (isLocalAi && message.role !== 'user') {
        return APP_NAME
      }

      if (message.role === 'assistant') {
        if (message.model) {
          return getModelName(message.model) || message.model.name || message.modelId || ''
        }

        const modelId = getMessageModelId(message)
        return modelId || ''
      }

      return userName || t('common.you')
    },
    [userName, t]
  )

  const setSelectedMessage = useCallback(
    (message: Message) => {
      const groupMessages = messages.filter((m) => m.askId === message.askId)
      if (groupMessages.length > 1) {
        for (const m of groupMessages) {
          dispatch(updateMessageThunk(m.topicId, m.id, { foldSelected: m.id === message.id }))
        }

        setTimeout(() => {
          const messageElement = document.getElementById(`message-${message.id}`)
          if (messageElement) {
            messageElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          }
        }, 100)
      }
    },
    [dispatch, messages]
  )

  const scrollToMessage = useCallback(
    (message: Message) => {
      const messageElement = document.getElementById(`message-${message.id}`)

      if (!messageElement) return

      const display = messageElement ? window.getComputedStyle(messageElement).display : null
      if (display === 'none') {
        setSelectedMessage(message)
        return
      }

      messageElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    [setSelectedMessage]
  )

  if (messages.length === 0) return null

  const handleMouseMove = (e: React.MouseEvent) => {
    if (messagesListRef.current) {
      const containerRect = e.currentTarget.getBoundingClientRect()
      const listRect = messagesListRef.current.getBoundingClientRect()
      setMouseY(e.clientY - listRect.top)

      if (listRect.height > containerRect.height) {
        const mousePositionRatio = (e.clientY - containerRect.top) / containerRect.height
        const maxOffset = (containerRect.height - listRect.height) / 2 - 20
        setListOffsetY(-maxOffset + mousePositionRatio * (maxOffset * 2))
      } else {
        setListOffsetY(0)
      }
    }
  }

  const handleMouseLeave = () => {
    setMouseY(null)
    setListOffsetY(0)
  }

  return (
    <MessageLineContainer
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      $right={right}
      $height={containerHeight}>
      <MessagesList ref={messagesListRef} style={{ transform: `translateY(${listOffsetY}px)` }}>
        {messages.map((message, index) => {
          const opacity = 0.5 + calculateValueByDistance(message.id, 1)
          const scale = 1 + calculateValueByDistance(message.id, 1)
          const size = 10 + calculateValueByDistance(message.id, 20)
          const avatarSource = getAvatarSource(isLocalAi, getMessageModelId(message))
          const username = removeLeadingEmoji(getUserName(message))

          return (
            <MessageItem
              key={message.id}
              ref={(el) => {
                if (el) messageItemsRef.current.set(message.id, el)
                else messageItemsRef.current.delete(message.id)
              }}
              style={{
                opacity: mouseY ? opacity : Math.max(0, 0.6 - (0.3 * Math.abs(index - messages.length / 2)) / 5)
              }}
              onClick={() => scrollToMessage(message)}>
              <MessageItemContainer style={{ transform: ` scale(${scale})` }}>
                <MessageItemTitle>{username}</MessageItemTitle>
                <MessageItemContent>{message.content.substring(0, 50)}</MessageItemContent>
              </MessageItemContainer>

              {message.role === 'assistant' ? (
                <Avatar
                  src={avatarSource}
                  size={size}
                  style={{
                    border: isLocalAi ? '1px solid var(--color-border-soft)' : 'none',
                    filter: theme === 'dark' ? 'invert(0.05)' : undefined
                  }}>
                  A
                </Avatar>
              ) : (
                <>
                  {isEmoji(avatar) ? (
                    <EmojiAvatar size={size}>{avatar}</EmojiAvatar>
                  ) : (
                    <Avatar src={avatar} size={size} />
                  )}
                </>
              )}
            </MessageItem>
          )
        })}
      </MessagesList>
    </MessageLineContainer>
  )
}

const MessageItemContainer = styled.div`
  line-height: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  text-align: right;
  gap: 4px;
  text-shadow: 0 0 2px rgba(255, 255, 255, 0.5);
  opacity: 0;
  transform-origin: right center;
`

const MessageLineContainer = styled.div<{ $right: string; $height: number | null }>`
  width: 14px;
  position: fixed;
  top: ${(props) => (props.$height ? `calc(${props.$height / 2}px + var(--status-bar-height))` : '50%')};
  right: ${(props) => props.$right};
  max-height: ${(props) => (props.$height ? `${props.$height}px` : 'calc(100% - var(--status-bar-height) * 2)')};
  transform: translateY(-50%);
  z-index: 0;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 5px;
  overflow: hidden;
  &:hover {
    width: 440px;
    overflow-x: visible;
    overflow-y: hidden;
    ${MessageItemContainer} {
      opacity: 1;
    }
  }
`

const MessagesList = styled.div`
  display: flex;
  flex-direction: column-reverse;
  will-change: transform;
`

const MessageItem = styled.div`
  display: flex;
  position: relative;
  cursor: pointer;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  transform-origin: right center;
  padding: 2px 0;
  will-change: opacity;
  opacity: 0.4;
  transition: opacity 0.1s linear;
`

const MessageItemTitle = styled.div`
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
`
const MessageItemContent = styled.div`
  color: var(--color-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
`

const EmojiAvatar = styled.div<{ size: number }>`
  width: ${(props) => props.size}px;
  height: ${(props) => props.size}px;
  background-color: var(--color-background-soft);
  border-radius: 20%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: ${(props) => props.size * 0.6}px;
  border: 0.5px solid var(--color-border);
`

export default MessageAnchorLine
