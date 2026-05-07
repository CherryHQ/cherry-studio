import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMessageEditing } from '@renderer/context/MessageEditingContext'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMessage } from '@renderer/hooks/useMessage'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicAwaitingApproval } from '@renderer/hooks/useTopicAwaitingApproval'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { Assistant, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { classNames, cn } from '@renderer/utils'
import { scrollIntoView } from '@renderer/utils/dom'
import { isMessageAwaitingApproval } from '@renderer/utils/messageUtils/is'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { Dispatch, FC, SetStateAction } from 'react'
import React, { memo, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import MessageContent from './MessageContent'
import MessageEditor from './MessageEditor'
import MessageErrorBoundary from './MessageErrorBoundary'
import MessageHeader from './MessageHeader'
import MessageMenubar from './MessageMenubar'
import MessageOutline from './MessageOutline'
import SiblingNavigator from './SiblingNavigator'

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
  const [messageStyle] = usePreference('chat.message.style')
  const [showMessageOutline] = usePreference('chat.message.show_outline')

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
  const showMenubar = !hideMenuBar && !isEditing && !isStreamTarget && !isApprovalAnchor

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
        <div className="mx-5 my-0 flex items-center gap-2 text-(--color-text-3) text-sm">
          <hr className="flex-1 border-(--color-border) border-dashed" />
          <span>{t('chat.message.new.context')}</span>
          <hr className="flex-1 border-(--color-border) border-dashed" />
        </div>
      </div>
    )
  }

  return (
    <WrapperContainer isMultiSelectMode={isMultiSelectMode}>
      <div
        key={message.id}
        className={classNames({
          'message transform-[translateZ(0)] relative flex w-full flex-col rounded-[10px] p-[10px] pb-0 transition-colors duration-300 will-change-transform [&:hover_.menubar]:opacity-100 [&_.menubar.show]:opacity-100 [&_.menubar]:opacity-0 [&_.menubar]:transition-opacity [&_.menubar]:duration-200': true,
          'message-assistant': isAssistantMessage,
          'message-user': !isAssistantMessage
        })}
        ref={messageContainerRef}>
        <MessageHeader
          message={message}
          assistant={assistant}
          model={model}
          key={getModelUniqId(model)}
          topic={topic}
          isGroupContextMessage={isGroupContextMessage}
        />
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
            <Scrollbar
              className="message-content-container mt-0 max-w-full overflow-y-auto pl-[46px]"
              style={{
                fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
                fontSize,
                overflowY: isHorizontalMultiModelLayout ? 'auto' : 'visible'
              }}>
              <MessageErrorBoundary>
                <MessageContent message={message} />
              </MessageErrorBoundary>
            </Scrollbar>
            {showMenubar && (
              <div className="MessageFooter mt-[3px] ml-[46px] flex items-center justify-between gap-2.5">
                <HorizontalScrollContainer
                  classNames={{
                    content: cn(
                      'flex-1 items-center justify-between',
                      isLastMessage && messageStyle === 'plain' ? 'flex-row-reverse' : 'flex-row'
                    )
                  }}>
                  <MessageMenubar
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
