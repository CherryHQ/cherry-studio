import { Avatar, AvatarFallback, AvatarImage, EmojiAvatar } from '@cherrystudio/ui'
import { useIcon } from '@cherrystudio/ui/icons'
import { useTheme } from '@renderer/hooks/useTheme'
import { useTimer } from '@renderer/hooks/useTimer'
import { scrollIntoView } from '@renderer/utils/dom'
import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import { getModelLogoRef } from '@renderer/utils/model'
import { firstLetter, isEmoji, removeLeadingEmoji } from '@renderer/utils/naming'
import { CircleChevronDown } from 'lucide-react'
import { type FC, type Ref, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePartsMap } from '../blocks/MessagePartsContext'
import { useMessageListActions, useMessageListMeta, useMessageRenderConfig } from '../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem } from '../types'
import { getMessageListItemModel, getMessageListItemModelName } from '../utils/messageListItem'

interface MessageLineProps {
  messages: MessageListItem[]
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
  const { theme } = useTheme()
  const actions = useMessageListActions()
  const meta = useMessageListMeta()
  const renderConfig = useMessageRenderConfig() ?? defaultMessageRenderConfig
  const userName = renderConfig.userName
  const assistantProfile = meta.assistantProfile
  const avatar = meta.userProfile?.avatar ?? ''
  const { updateMessageUiState } = actions
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
  }, [])

  const calculateDistanceFactor = useCallback(
    (itemId: string) => {
      if (mouseY === null) return 0

      const element = messageItemsRef.current.get(itemId)
      if (!element) return 0

      const rect = element.getBoundingClientRect()
      const centerY = rect.top + rect.height / 2
      const distance = Math.abs(centerY - mouseY)
      const maxDistance = 100

      return Math.max(0, 1 - distance / maxDistance)
    },
    [mouseY]
  )

  const getUserName = useCallback(
    (message: MessageListItem) => {
      if (message.role === 'assistant') {
        if (assistantProfile?.name) {
          return assistantProfile.name
        }

        return getMessageListItemModelName(message)
      }

      return userName || t('common.you')
    },
    [assistantProfile?.name, userName, t]
  )

  const setSelectedMessage = useCallback(
    (message: MessageListItem) => {
      const groupMessages = messages.filter((m) => m.parentId === message.parentId)
      if (groupMessages.length > 1) {
        for (const m of groupMessages) {
          updateMessageUiState?.(m.id, { foldSelected: m.id === message.id })
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
    [messages, setTimeoutTimer, updateMessageUiState]
  )

  const scrollToMessage = useCallback(
    (message: MessageListItem) => {
      if (message.role === 'assistant' && message.parentId) {
        const siblings = messages.filter((m) => m.role === 'assistant' && m.parentId === message.parentId)
        if (siblings.length > 1) {
          for (const sibling of siblings) {
            updateMessageUiState?.(sibling.id, { foldSelected: sibling.id === message.id })
          }
        }
      }

      // Virtualized message list: prefer the imperative API. Off-screen
      // messages have no DOM, so direct DOM lookup would silently no-op.
      // Fall back to it only when the prop isn't wired.
      if (scrollToMessageId) {
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
    [messages, scrollToMessageId, setSelectedMessage, updateMessageUiState]
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
      setMouseY(e.clientY)

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
          const distanceFactor = calculateDistanceFactor(message.id)
          const opacity = 0.5 + distanceFactor
          const scale = 1 + distanceFactor * 1.2
          const size = 10 + distanceFactor * 20
          const model = getMessageListItemModel(message)
          const username = removeLeadingEmoji(getUserName(message))
          const parts = partsMap?.[message.id]
          const content = parts ? getTextFromParts(parts) : ''

          if (message.type === 'clear') return null

          return (
            <MessageItem
              key={message.id}
              ref={(el) => {
                if (el) messageItemsRef.current.set(message.id, el)
                else messageItemsRef.current.delete(message.id)
              }}
              style={{
                opacity:
                  mouseY !== null ? opacity : Math.max(0, 0.6 - (0.3 * Math.abs(index - messages.length / 2)) / 5)
              }}
              onClick={() => scrollToMessage(message)}>
              <MessageItemContainer style={{ transform: ` scale(${scale})` }}>
                <MessageItemTitle>{username}</MessageItemTitle>
                <MessageItemContent>{content.substring(0, 50)}</MessageItemContent>
              </MessageItemContainer>

              {message.role === 'assistant' ? (
                assistantProfile?.avatar ? (
                  isEmoji(assistantProfile.avatar) ? (
                    <EmojiAvatar
                      className="rounded-full"
                      size={size}
                      fontSize={size * 0.6}
                      style={{
                        cursor: 'default',
                        pointerEvents: 'none'
                      }}>
                      {assistantProfile.avatar}
                    </EmojiAvatar>
                  ) : (
                    <MessageItemAvatar style={{ width: size, height: size }}>
                      <AvatarImage src={assistantProfile.avatar} />
                      <AvatarFallback>{firstLetter(assistantProfile.name ?? '').toUpperCase()}</AvatarFallback>
                    </MessageItemAvatar>
                  )
                ) : (
                  <AnchorModelAvatar model={model} size={size} />
                )
              ) : (
                <>
                  {isEmoji(avatar) ? (
                    <EmojiAvatar
                      className="rounded-full"
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
            opacity:
              mouseY !== null ? 0.5 : Math.max(0, 0.6 - (0.3 * Math.abs(messages.length - messages.length / 2)) / 5)
          }}
          onClick={scrollToBottom}>
          <CircleChevronDown
            size={10 + calculateDistanceFactor('bottom-anchor') * 20}
            style={{ color: theme === 'dark' ? 'var(--color-foreground)' : 'var(--color-primary)' }}
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
      'overflow-hidden rounded-full transition-[width,height] duration-150 ease-[cubic-bezier(0.25,1,0.5,1)] [will-change:width,height]',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

/** Model avatar for one anchor item: sync ref resolution, async icon component. */
const AnchorModelAvatar: FC<{ model: ReturnType<typeof getMessageListItemModel>; size: number }> = ({
  model,
  size
}) => {
  const { theme } = useTheme()
  // Walk the full resolution chain (model icon → provider-by-model → provider).
  const ModelIcon = useIcon(getModelLogoRef(model))
  if (ModelIcon) {
    return <ModelIcon.Avatar size={size} shape="circle" className="rounded-full" />
  }
  return (
    <MessageItemAvatar
      style={{
        width: size,
        height: size,
        border: 'none',
        filter: theme === 'dark' ? 'invert(0.05)' : undefined
      }}></MessageItemAvatar>
  )
}

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
      'group absolute right-3.25 z-20 flex w-3.5 translate-y-[-50%] select-none items-center justify-end overflow-hidden text-[5px] hover:w-125 hover:overflow-y-hidden hover:overflow-x-visible',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    style={{
      top: '50%',
      maxHeight: $height ? `${$height - 20}px` : 'calc(100% - 20px)',
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
  <div className={['whitespace-nowrap font-medium text-foreground', className].filter(Boolean).join(' ')} {...props} />
)
const MessageItemContent = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-foreground-secondary', className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

export default MessageAnchorLine
