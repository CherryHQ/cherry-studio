import EmojiAvatar from '@renderer/components/Avatar/EmojiAvatar'
import { APP_NAME, AppLogo, isLocalAi } from '@renderer/config/env'
import { getModelLogo } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import useAvatar from '@renderer/hooks/useAvatar'
import { useSettings } from '@renderer/hooks/useSettings'
import { getMessageModelId } from '@renderer/services/MessagesService'
import { getModelName } from '@renderer/services/ModelService'
import { useAppDispatch } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
// import { updateMessageThunk } from '@renderer/store/thunk/messageThunk'
import type { Message } from '@renderer/types/newMessage'
import { isEmoji, removeLeadingEmoji } from '@renderer/utils'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { Avatar } from 'antd'
import { CircleChevronDown } from 'lucide-react'
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
          dispatch(
            newMessagesActions.updateMessage({
              topicId: m.topicId,
              messageId: m.id,
              updates: { foldSelected: m.id === message.id }
            })
          )
        }

        setTimeout(() => {
          const messageElement = document.getElementById(`message-${message.id}`)
          if (messageElement) {
            messageElement.scrollIntoView({ behavior: 'auto', block: 'start' })
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

  const scrollToBottom = useCallback(() => {
    const messagesContainer = document.getElementById('messages')
    if (messagesContainer) {
      messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' })
    }
  }, [])

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
      $height={containerHeight}>
      <MessagesList ref={messagesListRef} style={{ transform: `translateY(${listOffsetY}px)` }}>
        <MessageItem
          key="bottom-anchor"
          ref={(el) => {
            if (el) messageItemsRef.current.set('bottom-anchor', el)
            else messageItemsRef.current.delete('bottom-anchor')
          }}
          style={{
            opacity: mouseY ? 0.5 : Math.max(0, 0.6 - (0.3 * Math.abs(0 - messages.length / 2)) / 5)
          }}
          onClick={scrollToBottom}>
          <CircleChevronDown
            size={10 + calculateValueByDistance('bottom-anchor', 20)}
            style={{ color: theme === 'dark' ? 'var(--color-text)' : 'var(--color-primary)' }}
          />
        </MessageItem>
        {messages.map((message, index) => {
          const opacity = 0.5 + calculateValueByDistance(message.id, 1)
          const scale = 1 + calculateValueByDistance(message.id, 1.2)
          const size = 10 + calculateValueByDistance(message.id, 20)
          const avatarSource = getAvatarSource(isLocalAi, getMessageModelId(message))
          const username = removeLeadingEmoji(getUserName(message))
          const content = getMainTextContent(message)

          if (message.type === 'clear') return null

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
                <MessageItemContent>{content.substring(0, 50)}</MessageItemContent>
              </MessageItemContainer>

              {message.role === 'assistant' ? (
                <MessageItemAvatar
                  src={avatarSource}
                  size={size}
                  style={{
                    border: isLocalAi ? '1px solid var(--color-border-soft)' : 'none',
                    filter: theme === 'dark' ? 'invert(0.05)' : undefined
                  }}
                />
              ) : (
                <>
                  {isEmoji(avatar) ? (
                    <EmojiAvatar
                      size={size}
                      fontSize={size * 0.6}
                      style={{
                        cursor: 'default',
                        pointerEvents: 'none'
                      }}>
                      {avatar}
                    </EmojiAvatar>
                  ) : (
                    <MessageItemAvatar src={avatar} size={size} />
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
  gap: 3px;
  opacity: 0;
  transform-origin: right center;
  transition: transform cubic-bezier(0.25, 1, 0.5, 1) 150ms;
  will-change: transform;
`

const MessageItemAvatar = styled(Avatar)`
  transition:
    width,
    height,
    cubic-bezier(0.25, 1, 0.5, 1) 150ms;
  will-change: width, height;
`

const MessageLineContainer = styled.div<{ $height: number | null }>`
  width: 14px;
  position: fixed;
  top: calc(50% - var(--status-bar-height) - 10px);
  right: 13px;
  max-height: ${(props) =>
    props.$height ? `${props.$height - 20}px` : 'calc(100% - var(--status-bar-height) * 2 - 20px)'};
  transform: translateY(-50%);
  z-index: 0;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 5px;
  overflow: hidden;
  &:hover {
    width: 500px;
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

export default MessageAnchorLine
