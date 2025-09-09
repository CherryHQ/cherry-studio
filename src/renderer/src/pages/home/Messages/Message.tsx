import { loggerService } from '@logger'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMessageEditing } from '@renderer/context/MessageEditingContext'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { useModel } from '@renderer/hooks/useModel'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTimer } from '@renderer/hooks/useTimer'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getMessageModelId } from '@renderer/services/MessagesService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { estimateMessageUsage } from '@renderer/services/TokenService'
import { Assistant, Topic } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { classNames } from '@renderer/utils'
import { isMessageProcessing } from '@renderer/utils/messageUtils/is'
import { Divider } from 'antd'
import React, { Dispatch, FC, memo, SetStateAction, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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
  const { messageFont, fontSize, messageStyle, showMessageOutline } = useSettings()
  const { editMessageBlocks, resendUserMessageWithEdit, editMessage } = useMessageOperations(topic)
  const messageContainerRef = useRef<HTMLDivElement>(null)
  const { editingMessageId, startEditing, stopEditing } = useMessageEditing()
  const { setTimeoutTimer } = useTimer()
  const isEditing = editingMessageId === message.id

  useEffect(() => {
    if (isEditing && messageContainerRef.current) {
      messageContainerRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    }
  }, [isEditing])

  const handleEditSave = useCallback(
    async (blocks: MessageBlock[]) => {
      try {
        await editMessageBlocks(message.id, blocks)
        const usage = await estimateMessageUsage(message)
        editMessage(message.id, { usage: usage })
        stopEditing()
      } catch (error) {
        logger.error('Failed to save message blocks:', error as Error)
      }
    },
    [message, editMessageBlocks, stopEditing, editMessage]
  )

  const handleEditResend = useCallback(
    async (blocks: MessageBlock[]) => {
      try {
        await resendUserMessageWithEdit(message, blocks, assistant)
        stopEditing()
      } catch (error) {
        logger.error('Failed to resend message:', error as Error)
      }
    },
    [message, resendUserMessageWithEdit, assistant, stopEditing]
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
        messageContainerRef.current.scrollIntoView({ behavior: 'smooth' })
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
      <NewContextMessage
        isMultiSelectMode={isMultiSelectMode}
        className="clear-context-divider"
        onClick={() => {
          if (isMultiSelectMode) {
            return
          }
          EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
        }}>
        <Divider dashed style={{ padding: '0 20px' }} plain>
          {t('chat.message.new.context')}
        </Divider>
      </NewContextMessage>
    )
  }

  return (
    <WrapperContainer isMultiSelectMode={isMultiSelectMode}>
      <MessageContainer
        key={message.id}
        className={classNames({
          message: true,
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
            topicId={topic.id}
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
            <MessageContentContainer
              className="message-content-container"
              style={{
                fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
                fontSize,
                overflowY: 'visible'
              }}>
              <MessageErrorBoundary>
                <MessageContent message={message} />
              </MessageErrorBoundary>
            </MessageContentContainer>
            {showMenubar && (
              <MessageFooter className="MessageFooter" $isLastMessage={isLastMessage} $messageStyle={messageStyle}>
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
              </MessageFooter>
            )}
          </>
        )}
      </MessageContainer>
    </WrapperContainer>
  )
}

const MessageContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  position: relative;
  transition: background-color 0.3s ease;
  transform: translateZ(0);
  will-change: transform;
  padding: 10px;
  padding-bottom: 0;
  border-radius: 10px;
  .menubar {
    opacity: 0;
    transition: opacity 0.2s ease;
    transform: translateZ(0);
    will-change: opacity;
    &.show {
      opacity: 1;
    }
  }
  &:hover {
    .menubar {
      opacity: 1;
    }
  }
`

const MessageContentContainer = styled(Scrollbar)`
  max-width: 100%;
  padding-left: 46px;
  margin-top: 0;
  overflow-y: auto;
`

const MessageFooter = styled.div<{ $isLastMessage: boolean; $messageStyle: 'plain' | 'bubble' }>`
  display: flex;
  flex-direction: ${({ $isLastMessage, $messageStyle }) =>
    $isLastMessage && $messageStyle === 'plain' ? 'row-reverse' : 'row'};
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-left: 46px;
  margin-top: 3px;
`

const NewContextMessage = styled.div<{ isMultiSelectMode: boolean }>`
  cursor: pointer;
  flex: 1;

  ${({ isMultiSelectMode }) => isMultiSelectMode && 'cursor: default;'}
`

export default memo(MessageItem)
