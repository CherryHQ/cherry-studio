import { Avatar, AvatarImage, EmojiAvatar } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { getModelLogo } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import useAvatar from '@renderer/hooks/useAvatar'
import { useTimer } from '@renderer/hooks/useTimer'
import { getMessageModelId } from '@renderer/services/MessagesService'
import type { Message } from '@renderer/types/newMessage'
import { isEmoji, removeLeadingEmoji } from '@renderer/utils'
import { scrollIntoView } from '@renderer/utils/dom'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import { CircleChevronDown } from 'lucide-react'
import { type FC, type Ref, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePartsMap } from './Blocks'

interface MessageLineProps {
  messages: Message[]
  scrollToMessageId?: (messageId: string) => void
  /** Scroll the message list to its bottom. */
  scrollToBottom?: () => void
}

const MessageAnchorLine: FC<MessageLineProps> = ({
  messages,
  scrollToMessageId,
  scrollToBottom: scrollToBottomProp
}) => {
  const { t } = useTranslation()
  const partsMap = usePartsMap()
  const avatar = useAvatar()
  const { theme } = useTheme()
  const [userName] = usePreference('app.user.name')
  const { setTimeoutTimer } = useTimer()

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
      if (message.role === 'assistant') {
        if (message.model) {
          return message.model.name || message.model.id || message.modelId || ''
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
          const cacheKey = `message.ui.${m.id}` as const
          const current = cacheService.get(cacheKey) || {}
          cacheService.set(cacheKey, { ...current, foldSelected: m.id === message.id })
        }

        setTimeoutTimer(
          'setSelectedMessage',
          () => {
            const messageElement = document.getElementById(`message-${message.id}`)
            if (messageElement) {
              scrollIntoView(messageElement, { behavior: 'auto', block: 'start', container: 'nearest' })
            }
          },
          100
        )
      }
    },
    [messages, setTimeoutTimer]
  )

  const scrollToMessage = useCallback(
    (message: Message) => {
      // Virtualized message list: prefer the imperative API. Off-screen
      // messages have no DOM, so the legacy `getElementById` lookup
      // would silently no-op. Fall back to it only when the prop isn't
      // wired (older callers / tests).
      if (scrollToMessageId) {
        // Resolve fold state first — multi-model groups hide non-active
        // siblings via display:none; selecting the right sibling unfolds
        // it before we ask the virtualizer to scroll.
        scrollToMessageId(message.id)
        return
      }
      const messageElement = document.getElementById(`message-${message.id}`)
      if (!messageElement) return
      const display = messageElement ? window.getComputedStyle(messageElement).display : null
      if (display === 'none') {
        setSelectedMessage(message)
        return
      }
      scrollIntoView(messageElement, { behavior: 'smooth', block: 'start', container: 'nearest' })
    },
    [scrollToMessageId, setSelectedMessage]
  )

  const scrollToBottom = useCallback(() => {
    if (scrollToBottomProp) {
      scrollToBottomProp()
      return
    }
    const messagesContainer = document.getElementById('messages')
    if (messagesContainer) {
      messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' })
    }
  }, [scrollToBottomProp])

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
        {messages.map((message, index) => {
          const opacity = 0.5 + calculateValueByDistance(message.id, 1)
          const scale = 1 + calculateValueByDistance(message.id, 1.2)
          const size = 10 + calculateValueByDistance(message.id, 20)
          // Walk the full resolution chain (model icon → provider-by-model → provider).
          const ModelIcon = getModelLogo(message.model)
          const username = removeLeadingEmoji(getUserName(message))
          const parts = partsMap?.[message.id]
          const content = parts ? getTextFromParts(parts) : getMainTextContent(message)

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
                ModelIcon ? (
                  <ModelIcon.Avatar size={size} />
                ) : (
                  <MessageItemAvatar
                    style={{
                      width: size,
                      height: size,
                      border: 'none',
                      filter: theme === 'dark' ? 'invert(0.05)' : undefined
                    }}></MessageItemAvatar>
                )
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
                    <MessageItemAvatar style={{ width: size, height: size }}>
                      <AvatarImage src={avatar} />
                    </MessageItemAvatar>
                  )}
                </>
              )}
            </MessageItem>
          )
        })}
        <MessageItem
          key="bottom-anchor"
          ref={(el) => {
            if (el) messageItemsRef.current.set('bottom-anchor', el)
            else messageItemsRef.current.delete('bottom-anchor')
          }}
          style={{
            opacity: mouseY ? 0.5 : Math.max(0, 0.6 - (0.3 * Math.abs(messages.length - messages.length / 2)) / 5)
          }}
          onClick={scrollToBottom}>
          <CircleChevronDown
            size={10 + calculateValueByDistance('bottom-anchor', 20)}
            style={{ color: theme === 'dark' ? 'var(--color-text)' : 'var(--color-primary)' }}
          />
        </MessageItem>
      </MessagesList>
    </MessageLineContainer>
  )
}

const MessageItemContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={[
      'flex origin-right flex-col items-end justify-between gap-[3px] text-right leading-none opacity-0 transition-transform duration-150 ease-[cubic-bezier(0.25,1,0.5,1)] [will-change:transform] group-hover:opacity-100',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const MessageItemAvatar = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Avatar>) => (
  <Avatar
    className={[
      'transition-[width,height] duration-150 ease-[cubic-bezier(0.25,1,0.5,1)] [will-change:width,height]',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const MessageLineContainer = ({
  ref,
  className,
  $height,
  style,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $height: number | null } & {
  ref?: React.RefObject<HTMLDivElement | null>
}) => (
  <div
    ref={ref}
    className={[
      'group fixed right-[13px] z-0 flex w-[14px] translate-y-[-50%] select-none items-center justify-end overflow-hidden text-[5px] hover:w-[500px] hover:overflow-y-hidden hover:overflow-x-visible',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    style={{
      top: 'calc(50% - var(--status-bar-height) - 10px)',
      maxHeight: $height ? `${$height - 20}px` : 'calc(100% - var(--status-bar-height) * 2 - 20px)',
      ...style
    }}
    {...props}
  />
)
MessageLineContainer.displayName = 'MessageLineContainer'

const MessagesList = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { ref?: Ref<HTMLDivElement> }) => (
  <div
    ref={ref}
    className={['flex flex-col [will-change:transform]', className].filter(Boolean).join(' ')}
    {...props}
  />
)
MessagesList.displayName = 'MessagesList'

const MessageItem = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { ref?: Ref<HTMLDivElement> }) => (
  <div
    ref={ref}
    className={[
      'relative flex origin-right cursor-pointer items-center justify-end gap-2.5 py-0.5 opacity-40 transition-opacity duration-100 ease-linear [will-change:opacity]',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)
MessageItem.displayName = 'MessageItem'

const MessageItemTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['whitespace-nowrap font-medium text-(--color-text)', className].filter(Boolean).join(' ')}
    {...props}
  />
)
const MessageItemContent = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-(--color-text-2)', className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

export default MessageAnchorLine
