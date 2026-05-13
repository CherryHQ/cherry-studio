import { Avatar, AvatarImage, EmojiAvatar } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import UserPopup from '@renderer/components/Popups/UserPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMessageEditing } from '@renderer/context/MessageEditingContext'
import { useAssistant } from '@renderer/hooks/useAssistant'
import useAvatar from '@renderer/hooks/useAvatar'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMessage } from '@renderer/hooks/useMessage'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicAwaitingApproval } from '@renderer/hooks/useTopicAwaitingApproval'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Assistant, Model, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { classNames, cn, isEmoji } from '@renderer/utils'
import { scrollIntoView } from '@renderer/utils/dom'
import { isMessageAwaitingApproval } from '@renderer/utils/messageUtils/is'
import type { CherryMessagePart } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import dayjs from 'dayjs'
import type { Dispatch, FC, SetStateAction } from 'react'
import React, { memo, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import SiblingNavigator from '../list/SiblingNavigator'
import MessageContent from './MessageContent'
import MessageEditor from './MessageEditor'
import MessageErrorBoundary from './MessageErrorBoundary'
import MessageHeader from './MessageHeader'
import MessageMenuBar from './MessageMenuBar'
import MessageOutline from './MessageOutline'

interface Props {
  message: Message
  topic: Topic
  assistant?: Assistant
  index?: number
  total?: number
  hideMenuBar?: boolean
  style?: React.CSSProperties
  isGrouped?: boolean
  isStreaming?: boolean
  onSetMessages?: Dispatch<SetStateAction<Message[]>>
  onUpdateUseful?: (msgId: string) => void
  isGroupContextMessage?: boolean
  isHorizontalMultiModelLayout?: boolean
}

const logger = loggerService.withContext('MessageItem')

const WrapperContainer = ({
  isMultiSelectMode,
  children
}: {
  isMultiSelectMode: boolean
  children: React.ReactNode
}) => {
  return isMultiSelectMode ? <label style={{ cursor: 'pointer' }}>{children}</label> : children
}

const MessageItem: FC<Props> = ({
  message,
  topic,
  // assistant,
  index,
  hideMenuBar = false,
  isGrouped,
  onUpdateUseful,
  isGroupContextMessage,
  isHorizontalMultiModelLayout = false
}) => {
  const { t } = useTranslation()
  const { assistant, setModel } = useAssistant(message.assistantId)
  const { isMultiSelectMode } = useChatContext(topic)
  // Use the message-embedded snapshot rather than re-resolving the live model
  // config: the snapshot is what the message was actually generated with.
  const model = message.model

  const [messageFont] = usePreference('chat.message.font')
  const [fontSize] = usePreference('chat.message.font_size')
  const [showMessageOutline] = usePreference('chat.message.show_outline')
  const [messageStyle] = usePreference('chat.message.style')

  const { editParts, forkAndResend } = useMessage(message.id, topic)
  const messageContainerRef = useRef<HTMLDivElement>(null)
  const { editingMessageId, startEditing, stopEditing } = useMessageEditing()
  const { setTimeoutTimer } = useTimer()
  const isEditing = editingMessageId === message.id

  useEffect(() => {
    if (isEditing && messageContainerRef.current) {
      scrollIntoView(messageContainerRef.current, {
        behavior: 'smooth',
        block: 'center',
        container: 'nearest'
      })
    }
  }, [isEditing])

  const handleEditSave = useCallback(
    async (parts: CherryMessagePart[]) => {
      try {
        await editParts(parts)
        stopEditing()
      } catch (error) {
        logger.error('Failed to save message parts:', error as Error)
      }
    },
    [editParts, stopEditing]
  )

  const handleEditResend = useCallback(
    async (parts: CherryMessagePart[]) => {
      try {
        stopEditing()
        await forkAndResend(parts)
      } catch (error) {
        logger.error('Failed to resend message with parts:', error as Error)
      }
    },
    [forkAndResend, stopEditing]
  )

  const handleEditCancel = useCallback(() => {
    stopEditing()
  }, [stopEditing])

  const isLastMessage = index === 0 || !!isGrouped
  const isAssistantMessage = message.role === 'assistant'

  const { status: topicStreamStatus, activeExecutions } = useTopicStreamStatus(topic.id)
  const isTopicStreaming = topicStreamStatus === 'pending' || topicStreamStatus === 'streaming'
  const isAwaitingApproval = useTopicAwaitingApproval(topic.id)
  const isProcessing = isTopicStreaming || isAwaitingApproval
  const isStreamTarget = activeExecutions.some((e) => e.anchorMessageId === message.id)
  const isApprovalAnchor = isMessageAwaitingApproval(message)
  const showMenuBar = !hideMenuBar && !isEditing && !isStreamTarget && !isApprovalAnchor
  const showUserHeaderActions = showMenuBar && !isAssistantMessage && !isMultiSelectMode
  const showAssistantFooterActions = showMenuBar && isAssistantMessage
  const isUserBubbleMessage = messageStyle === 'bubble' && !isAssistantMessage && !isMultiSelectMode

  const messageHighlightHandler = useCallback(
    (highlight: boolean = true) => {
      if (messageContainerRef.current) {
        scrollIntoView(messageContainerRef.current, { behavior: 'smooth', block: 'center', container: 'nearest' })
        if (highlight) {
          setTimeoutTimer(
            'messageHighlightHandler',
            () => {
              const classList = messageContainerRef.current?.classList
              classList?.add('animation-locate-highlight')

              const handleAnimationEnd = () => {
                classList?.remove('animation-locate-highlight')
                messageContainerRef.current?.removeEventListener('animationend', handleAnimationEnd)
              }

              messageContainerRef.current?.addEventListener('animationend', handleAnimationEnd)
            },
            500
          )
        }
      }
    },
    [setTimeoutTimer]
  )

  useEffect(() => {
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, messageHighlightHandler)]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [message.id, messageHighlightHandler])

  // Listen for external edit requests and activate editor for this message if it matches
  useEffect(() => {
    const handleEditRequest = (targetId: string) => {
      if (targetId === message.id) {
        startEditing(message.id)
      }
    }
    const unsubscribe = EventEmitter.on(EVENT_NAMES.EDIT_MESSAGE, handleEditRequest)
    return () => {
      unsubscribe()
    }
  }, [message.id, startEditing])

  if (message.type === 'clear') {
    return (
      <div
        className={cn('clear-context-divider flex-1 cursor-pointer', isMultiSelectMode && 'cursor-default')}
        onClick={() => {
          if (isMultiSelectMode) return
          void EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
        }}>
        <div className="mx-5 my-0 flex items-center gap-2 text-foreground-muted text-sm">
          <hr className="flex-1 border-border border-dashed" />
          <span>{t('chat.message.new.context')}</span>
          <hr className="flex-1 border-border border-dashed" />
        </div>
      </div>
    )
  }

  return (
    <WrapperContainer isMultiSelectMode={isMultiSelectMode}>
      <div
        key={message.id}
        className={classNames({
          'message group/message transform-[translateZ(0)] relative flex w-full flex-col rounded-[10px] p-2.5 pb-0 transition-colors duration-300 will-change-transform [&:hover_.menubar]:opacity-100 [&_.menubar.show]:opacity-100 [&_.menubar]:opacity-0 [&_.menubar]:transition-opacity [&_.menubar]:duration-200': true,
          'message-assistant': isAssistantMessage,
          'message-user': !isAssistantMessage
        })}
        ref={messageContainerRef}>
        {!isUserBubbleMessage && (
          <MessageHeader
            message={message}
            assistant={assistant}
            model={model}
            key={model ? createUniqueModelId(model.provider, model.id) : ''}
            topic={topic}
            isGroupContextMessage={isGroupContextMessage}
            actionsSlot={
              showUserHeaderActions ? (
                <>
                  <MessageMenuBar
                    message={message}
                    model={model}
                    topic={topic}
                    isLastMessage={isLastMessage}
                    isAssistantMessage={isAssistantMessage}
                    isGrouped={isGrouped}
                    isProcessing={isProcessing}
                    messageContainerRef={messageContainerRef as React.RefObject<HTMLDivElement>}
                    setModel={setModel}
                    onUpdateUseful={onUpdateUseful}
                    variant="header"
                  />
                  <SiblingNavigator messageId={message.id} />
                </>
              ) : undefined
            }
          />
        )}
        {isEditing && (
          <MessageEditor
            message={message}
            onSave={handleEditSave}
            onResend={handleEditResend}
            onCancel={handleEditCancel}
          />
        )}
        {!isEditing && (
          <>
            {!isMultiSelectMode && message.role === 'assistant' && showMessageOutline && (
              <MessageOutline message={message} />
            )}
            {isUserBubbleMessage ? (
              <UserBubbleMessage
                message={message}
                model={model}
                topic={topic}
                isLastMessage={isLastMessage}
                isGrouped={isGrouped}
                isProcessing={isProcessing}
                messageContainerRef={messageContainerRef as React.RefObject<HTMLDivElement>}
                setModel={setModel}
                onUpdateUseful={onUpdateUseful}
                messageFont={messageFont}
                fontSize={fontSize}
              />
            ) : (
              <Scrollbar
                className="message-content-container mt-0 max-w-full overflow-y-auto pl-10"
                style={{
                  fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
                  fontSize,
                  overflowY: isHorizontalMultiModelLayout ? 'auto' : 'visible'
                }}>
                <MessageErrorBoundary>
                  <MessageContent message={message} />
                </MessageErrorBoundary>
              </Scrollbar>
            )}
            {showAssistantFooterActions && (
              <div
                className={cn(
                  'MessageFooter mt-1 ml-10 flex min-h-6.5 items-center justify-between gap-1.5 text-xs leading-none'
                )}>
                <HorizontalScrollContainer
                  classNames={{
                    content: cn('flex-1 flex-row items-center justify-between')
                  }}>
                  <MessageMenuBar
                    message={message}
                    model={model}
                    topic={topic}
                    isLastMessage={isLastMessage}
                    isAssistantMessage={isAssistantMessage}
                    isGrouped={isGrouped}
                    isProcessing={isProcessing}
                    messageContainerRef={messageContainerRef as React.RefObject<HTMLDivElement>}
                    setModel={setModel}
                    onUpdateUseful={onUpdateUseful}
                  />
                </HorizontalScrollContainer>
                <SiblingNavigator messageId={message.id} />
              </div>
            )}
          </>
        )}
      </div>
    </WrapperContainer>
  )
}

export default memo(MessageItem)

const UserBubbleMessage = ({
  message,
  model,
  topic,
  isLastMessage,
  isGrouped,
  isProcessing,
  messageContainerRef,
  setModel,
  onUpdateUseful,
  messageFont,
  fontSize
}: {
  message: Message
  model?: Model
  topic: Topic
  isLastMessage: boolean
  isGrouped?: boolean
  isProcessing: boolean
  messageContainerRef: React.RefObject<HTMLDivElement>
  setModel: (model: Model) => void
  onUpdateUseful?: (msgId: string) => void
  messageFont: string
  fontSize: number
}) => {
  const avatar = useAvatar()

  return (
    <div className="flex w-full flex-col items-end">
      <div className="flex max-w-full items-center justify-end gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col items-end">
          <Scrollbar
            className="message-content-container mt-0 max-w-full overflow-y-auto rounded-[10px] bg-(--chat-background-user) px-4 py-2.5 [&_.block-wrapper:last-child>*:last-child]:mb-0! [&_.markdown>p:last-child]:mb-0!"
            style={{
              fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
              fontSize,
              overflowY: 'visible'
            }}>
            <MessageErrorBoundary>
              <MessageContent message={message} />
            </MessageErrorBoundary>
          </Scrollbar>
        </div>
        {isEmoji(avatar) ? (
          <EmojiAvatar className="shrink-0 rounded-full" onClick={() => UserPopup.show()} size={30} fontSize={17}>
            {avatar}
          </EmojiAvatar>
        ) : (
          <Avatar className="size-[30px] shrink-0 cursor-pointer rounded-full" onClick={() => UserPopup.show()}>
            <AvatarImage src={avatar} />
          </Avatar>
        )}
      </div>
      <div className="MessageFooter mt-1 mr-10 flex min-h-6.5 max-w-full items-center justify-end gap-2 text-foreground-muted text-xs leading-none opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/message:opacity-100">
        <span className="shrink-0">{dayjs(message.updatedAt ?? message.createdAt).format('MM/DD HH:mm')}</span>
        <MessageMenuBar
          message={message}
          model={model}
          topic={topic}
          isLastMessage={isLastMessage}
          isAssistantMessage={false}
          isGrouped={isGrouped}
          isProcessing={isProcessing}
          messageContainerRef={messageContainerRef}
          setModel={setModel}
          onUpdateUseful={onUpdateUseful}
          variant="header"
        />
        <SiblingNavigator messageId={message.id} />
      </div>
    </div>
  )
}
