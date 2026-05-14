import { Avatar, AvatarImage, EmojiAvatar, Scrollbar } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import UserPopup from '@renderer/components/Popups/UserPopup'
import { useMessageEditing } from '@renderer/context/MessageEditingContext'
import { useAssistant } from '@renderer/hooks/useAssistant'
import useAvatar from '@renderer/hooks/useAvatar'
import { useTimer } from '@renderer/hooks/useTimer'
import type { Assistant, Model, Topic } from '@renderer/types'
import { classNames, cn, isEmoji } from '@renderer/utils'
import { scrollIntoView } from '@renderer/utils/dom'
import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import dayjs from 'dayjs'
import type { FC } from 'react'
import React, { memo, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import SiblingNavigator from '../list/SiblingNavigator'
import { useMessageList } from '../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem } from '../types'
import { getMessageListItemModel } from '../utils/messageListItem'
import MessageContent from './MessageContent'
import MessageEditor from './MessageEditor'
import MessageErrorBoundary from './MessageErrorBoundary'
import MessageHeader from './MessageHeader'
import MessageMenuBar from './MessageMenuBar'
import MessageOutline from './MessageOutline'

interface Props {
  message: MessageListItem
  topic: Topic
  assistant?: Assistant
  index?: number
  total?: number
  hideMenuBar?: boolean
  style?: React.CSSProperties
  isGrouped?: boolean
  isStreaming?: boolean
  onUpdateUseful?: (msgId: string) => void
  isGroupContextMessage?: boolean
  isHorizontalMultiModelLayout?: boolean
  multiModelMessageStyle?: MultiModelMessageStyle
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
  isHorizontalMultiModelLayout = false,
  multiModelMessageStyle = 'fold'
}) => {
  const { t } = useTranslation()
  const { assistant, setModel } = useAssistant(message.assistantId)
  const { state, actions } = useMessageList()
  const renderConfig = state.renderConfig ?? defaultMessageRenderConfig
  const isMultiSelectMode = state.selection?.isMultiSelectMode ?? false
  // Use the message-embedded snapshot rather than re-resolving the live model
  // config: the snapshot is what the message was actually generated with.
  const model = getMessageListItemModel(message)

  const messageFont = renderConfig.messageFont
  const fontSize = renderConfig.fontSize
  const showMessageOutline = renderConfig.showMessageOutline
  const messageStyle = renderConfig.messageStyle

  const messageContainerRef = useRef<HTMLDivElement>(null)
  const { editingMessageId, startEditing, stopEditing } = useMessageEditing()
  const { setTimeoutTimer } = useTimer()
  const canEditMessage = !!actions.editMessage
  const isEditing = canEditMessage && editingMessageId === message.id

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
      if (!actions.editMessage) return
      try {
        await actions.editMessage(message.id, parts)
        stopEditing()
      } catch (error) {
        logger.error('Failed to save message parts:', error as Error)
      }
    },
    [actions, message.id, stopEditing]
  )

  const handleEditResend = useCallback(
    async (parts: CherryMessagePart[]) => {
      if (!actions.forkAndResendMessage) return
      try {
        stopEditing()
        await actions.forkAndResendMessage(message.id, parts)
      } catch (error) {
        logger.error('Failed to resend message with parts:', error as Error)
      }
    },
    [actions, message.id, stopEditing]
  )

  const handleEditCancel = useCallback(() => {
    stopEditing()
  }, [stopEditing])

  const isLastMessage = index === 0 || !!isGrouped
  const isAssistantMessage = message.role === 'assistant'

  const activityState = state.getMessageActivityState?.(message)
  const isProcessing = activityState?.isProcessing ?? false
  const isStreamTarget = activityState?.isStreamTarget ?? false
  const isApprovalAnchor = activityState?.isApprovalAnchor ?? false
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
    return actions.bindMessageRuntime?.(message.id, {
      locateMessage: messageHighlightHandler,
      startEditing: () => {
        if (canEditMessage) {
          startEditing(message.id)
        }
      }
    })
  }, [actions, canEditMessage, message.id, messageHighlightHandler, startEditing])

  const handleStartNewContext = useCallback(() => {
    if (isMultiSelectMode) return
    actions.startNewContext?.()
  }, [actions, isMultiSelectMode])

  if (message.type === 'clear') {
    return (
      <div
        className={cn('clear-context-divider flex-1 cursor-pointer', isMultiSelectMode && 'cursor-default')}
        onClick={handleStartNewContext}>
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
              <MessageOutline message={message} multiModelMessageStyle={multiModelMessageStyle} />
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
  message: MessageListItem
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
          <Avatar className="size-7.5 shrink-0 cursor-pointer rounded-full" onClick={() => UserPopup.show()}>
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
