import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMessageEditing } from '@renderer/context/MessageEditingContext'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { useModel } from '@renderer/hooks/useModel'
import { useTimer } from '@renderer/hooks/useTimer'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getMessageModelId } from '@renderer/services/MessagesService'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { Assistant, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { classNames, cn } from '@renderer/utils'
import { scrollIntoView } from '@renderer/utils/dom'
import { isMessageProcessing } from '@renderer/utils/messageUtils/is'
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
  isGroupContextMessage
}) => {
  const { t } = useTranslation()
  const { assistant, setModel } = useAssistant(message.assistantId)
  const { isMultiSelectMode } = useChatContext(topic)
  const model = useModel(getMessageModelId(message), message.model?.provider) || message.model

  const [messageFont] = usePreference('chat.message.font')
  const [fontSize] = usePreference('chat.message.font_size')
  const [messageStyle] = usePreference('chat.message.style')
  const [showMessageOutline] = usePreference('chat.message.show_outline')

  const { editMessageParts, resendUserMessageWithEditParts } = useMessageOperations(topic)
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
        await editMessageParts(message.id, parts)
        stopEditing()
      } catch (error) {
        logger.error('Failed to save message parts:', error as Error)
      }
    },
    [message.id, editMessageParts, stopEditing]
  )

  const handleEditResend = useCallback(
    async (parts: CherryMessagePart[]) => {
      try {
        await resendUserMessageWithEditParts(message, parts)
        stopEditing()
      } catch (error) {
        logger.error('Failed to resend message with parts:', error as Error)
      }
    },
    [message, resendUserMessageWithEditParts, stopEditing]
  )

  const handleEditCancel = useCallback(() => {
    stopEditing()
  }, [stopEditing])

  const isLastMessage = index === 0 || !!isGrouped
  const isAssistantMessage = message.role === 'assistant'
  const isProcessing = isMessageProcessing(message)
  const showMenubar = !hideMenuBar && !isEditing && !isProcessing

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
        className={cn('cursor-pointer flex-1 clear-context-divider', isMultiSelectMode && 'cursor-default')}
        onClick={() => {
          if (isMultiSelectMode) return
          void EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
        }}>
        <div className="flex items-center my-0 mx-5 gap-2 text-[var(--color-text-3)] text-sm">
          <hr className="flex-1 border-dashed border-[var(--color-border)]" />
          <span>{t('chat.message.new.context')}</span>
          <hr className="flex-1 border-dashed border-[var(--color-border)]" />
        </div>
      </div>
    )
  }

  return (
    <WrapperContainer isMultiSelectMode={isMultiSelectMode}>
      <div
        key={message.id}
        className={classNames({
          'message flex flex-col w-full relative transition-colors duration-300 p-[10px] pb-0 rounded-[10px] [transform:translateZ(0)] [will-change:transform] [&_.menubar]:opacity-0 [&_.menubar]:transition-opacity [&_.menubar]:duration-200 [&:hover_.menubar]:opacity-100 [&_.menubar.show]:opacity-100': true,
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
              className="message-content-container max-w-full pl-[46px] mt-0 overflow-y-auto"
              style={{
                fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
                fontSize,
                overflowY: 'visible'
              }}>
              <MessageErrorBoundary>
                <MessageContent message={message} />
              </MessageErrorBoundary>
            </Scrollbar>
            {showMenubar && (
              <div className="MessageFooter flex items-center justify-between gap-2.5 ml-[46px] mt-[3px]">
                <HorizontalScrollContainer
                  classNames={{
                    content: cn(
                      'flex-1 items-center justify-between',
                      isLastMessage && messageStyle === 'plain' ? 'flex-row-reverse' : 'flex-row'
                    )
                  }}>
                  <MessageMenubar
                    message={message}
                    assistant={assistant}
                    model={model}
                    index={index}
                    topic={topic}
                    isLastMessage={isLastMessage}
                    isAssistantMessage={isAssistantMessage}
                    isGrouped={isGrouped}
                    messageContainerRef={messageContainerRef as React.RefObject<HTMLDivElement>}
                    setModel={setModel}
                    onUpdateUseful={onUpdateUseful}
                  />
                </HorizontalScrollContainer>
              </div>
            )}
          </>
        )}
      </div>
    </WrapperContainer>
  )
}

export default memo(MessageItem)
