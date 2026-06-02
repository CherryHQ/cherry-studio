import { Scrollbar } from '@cherrystudio/ui'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import { useMessageEditing } from '@renderer/context/MessageEditingContext'
import { useTimer } from '@renderer/hooks/useTimer'
import type { Topic } from '@renderer/types'
import { classNames, cn } from '@renderer/utils'
import { scrollIntoView } from '@renderer/utils/dom'
import type { CherryMessagePart } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import dayjs from 'dayjs'
import type { FC } from 'react'
import React, { memo, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getMessageEnterMotionAttributes,
  getMessageEnterMotionVariant,
  useMessageEnterMotionActive
} from '../../motion/messageEnterMotion'
import SiblingNavigator from '../list/SiblingNavigator'
import {
  useMessageListActions,
  useMessageListMeta,
  useMessageListSelection,
  useMessageListUiSelectors,
  useMessageRenderConfig
} from '../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem } from '../types'
import { getMessageListItemModel } from '../utils/messageListItem'
import MessageAvatar from './MessageAvatar'
import MessageContent from './MessageContent'
import MessageEditor from './MessageEditor'
import MessageErrorBoundary from './MessageErrorBoundary'
import MessageHeader from './MessageHeader'
import MessageMenuBar from './MessageMenuBar'

const USER_MESSAGE_FOOTER_ACTIONS_CLASS =
  'absolute inset-0 flex items-center gap-2 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/message:opacity-100'

interface Props {
  message: MessageListItem
  topic: Topic
  index?: number
  total?: number
  hideMenuBar?: boolean
  style?: React.CSSProperties
  isGrouped?: boolean
  isStreaming?: boolean
  onUpdateUseful?: (msgId: string) => void
  isGroupContextMessage?: boolean
  isHorizontalMultiModelLayout?: boolean
  isLatestAssistantMessage?: boolean
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
  isLatestAssistantMessage = false
}) => {
  const { t } = useTranslation()
  const actions = useMessageListActions()
  const renderConfig = useMessageRenderConfig() ?? defaultMessageRenderConfig
  const selection = useMessageListSelection()
  const messageUi = useMessageListUiSelectors()
  const isMultiSelectMode = selection?.isMultiSelectMode ?? false
  const isSelected = selection?.selectedMessageIds?.includes(message.id) ?? false
  // Use the message-embedded snapshot rather than re-resolving the live model
  // config: the snapshot is what the message was actually generated with.
  const model = getMessageListItemModel(message)

  const messageFont = renderConfig.messageFont
  const fontSize = renderConfig.fontSize
  const messageStyle = renderConfig.messageStyle

  const messageContainerRef = useRef<HTMLDivElement>(null)
  const { editingMessageId, startEditing, stopEditing } = useMessageEditing()
  const { setTimeoutTimer } = useTimer()
  const canEditMessage = !!actions.editMessage
  const isEditing = canEditMessage && editingMessageId === message.id
  const handleStartEditing = useCallback(
    (messageId: string) => {
      if (canEditMessage) {
        startEditing(messageId)
      }
    },
    [canEditMessage, startEditing]
  )

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
      await actions.editMessage(message.id, parts)
      stopEditing()
    },
    [actions, message.id, stopEditing]
  )

  const handleEditResend = useCallback(
    async (parts: CherryMessagePart[]) => {
      if (!actions.forkAndResendMessage) return
      await actions.forkAndResendMessage(message.id, parts)
      stopEditing()
    },
    [actions, message.id, stopEditing]
  )

  const handleEditCancel = useCallback(() => {
    stopEditing()
  }, [stopEditing])

  const isLastMessage = index === 0 || !!isGrouped
  const isAssistantMessage = message.role === 'assistant'

  const activityState = messageUi.getMessageActivityState?.(message)
  const isProcessing = activityState?.isProcessing ?? false
  const isStreamTarget = activityState?.isStreamTarget ?? false
  const isApprovalAnchor = activityState?.isApprovalAnchor ?? false
  const showMenuBar = !hideMenuBar && !isEditing && !isStreamTarget && !isApprovalAnchor
  const isUserBubbleMessage = messageStyle === 'bubble' && !isAssistantMessage && !isMultiSelectMode
  const enterMotionActive = useMessageEnterMotionActive(message.id)
  const enterMotionVariant = getMessageEnterMotionVariant({
    active: enterMotionActive,
    role: message.role,
    messageStyle,
    isMultiSelectMode
  })
  const enterMotionAttributes = getMessageEnterMotionAttributes(enterMotionVariant)
  const showAssistantFooterActions = showMenuBar && isAssistantMessage
  const showUserFooterActions = showMenuBar && !isAssistantMessage && !isMultiSelectMode && !isUserBubbleMessage
  const assistantFooterVisibilityClass = isLatestAssistantMessage
    ? 'opacity-100'
    : 'opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/message:opacity-100'

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
        handleStartEditing(message.id)
      }
    })
  }, [actions, handleStartEditing, message.id, messageHighlightHandler])

  const handleStartNewContext = useCallback(() => {
    if (isMultiSelectMode) return
    actions.startNewContext?.()
  }, [actions, isMultiSelectMode])

  const handleMessageSelectClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isMultiSelectMode) return
      if ((event.target as HTMLElement | null)?.closest('[role="checkbox"]')) return

      event.preventDefault()
      event.stopPropagation()
      actions.selectMessage?.(message.id, !isSelected)
    },
    [actions, isMultiSelectMode, isSelected, message.id]
  )

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

  const messageEditor = (
    <MessageEditor message={message} onSave={handleEditSave} onResend={handleEditResend} onCancel={handleEditCancel} />
  )

  const plainMessageContent = isEditing ? (
    messageEditor
  ) : (
    <Scrollbar
      className="message-content-container mt-0 max-w-full overflow-y-auto pl-0"
      style={{
        fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
        fontSize,
        overflowY: isHorizontalMultiModelLayout ? 'auto' : 'visible'
      }}>
      <MessageErrorBoundary>
        <MessageContent message={message} />
      </MessageErrorBoundary>
    </Scrollbar>
  )

  const userFooter = showUserFooterActions ? (
    <div className="MessageFooter relative mt-1 flex min-h-6.5 max-w-full items-center text-foreground-muted text-xs leading-none">
      <div className={USER_MESSAGE_FOOTER_ACTIONS_CLASS}>
        <MessageMenuBar
          message={message}
          topic={topic}
          isLastMessage={isLastMessage}
          isAssistantMessage={false}
          isGrouped={isGrouped}
          isProcessing={isProcessing}
          messageContainerRef={messageContainerRef as React.RefObject<HTMLDivElement>}
          onStartEditing={handleStartEditing}
          onUpdateUseful={onUpdateUseful}
          variant="header"
        />
        <SiblingNavigator messageId={message.id} />
      </div>
    </div>
  ) : undefined

  const assistantFooter = showAssistantFooterActions ? (
    <div
      className={cn(
        'MessageFooter mt-1 flex min-h-6.5 items-center justify-between gap-1.5 text-xs leading-none',
        assistantFooterVisibilityClass
      )}>
      <HorizontalScrollContainer
        classNames={{
          content: cn('flex-1 flex-row items-center justify-between')
        }}>
        <MessageMenuBar
          message={message}
          topic={topic}
          isLastMessage={isLatestAssistantMessage}
          isAssistantMessage={isAssistantMessage}
          isGrouped={isGrouped}
          isProcessing={isProcessing}
          messageContainerRef={messageContainerRef as React.RefObject<HTMLDivElement>}
          onStartEditing={handleStartEditing}
          onUpdateUseful={onUpdateUseful}
        />
      </HorizontalScrollContainer>
      <SiblingNavigator messageId={message.id} />
    </div>
  ) : undefined

  return (
    <div
      key={message.id}
      data-message-enter-motion={enterMotionAttributes?.motion}
      className={cn(
        classNames({
          'message group/message transform-[translateZ(0)] relative flex w-full flex-col rounded-[10px] pt-2.5 pb-0 transition-colors duration-300 will-change-transform [&:hover_.menubar]:opacity-100 [&_.menubar.show]:opacity-100 [&_.menubar]:opacity-0 [&_.menubar]:transition-opacity [&_.menubar]:duration-200': true,
          'message-assistant': isAssistantMessage,
          'message-user': !isAssistantMessage,
          'cursor-pointer': isMultiSelectMode
        }),
        enterMotionAttributes?.className
      )}
      ref={messageContainerRef}
      onClickCapture={handleMessageSelectClick}>
      {isUserBubbleMessage ? (
        isEditing ? (
          messageEditor
        ) : (
          <UserBubbleMessage
            message={message}
            topic={topic}
            isLastMessage={isLastMessage}
            isGrouped={isGrouped}
            isProcessing={isProcessing}
            messageContainerRef={messageContainerRef as React.RefObject<HTMLDivElement>}
            onStartEditing={handleStartEditing}
            onUpdateUseful={onUpdateUseful}
            messageFont={messageFont}
            fontSize={fontSize}
          />
        )
      ) : (
        <MessageHeader
          message={message}
          model={model}
          key={model ? createUniqueModelId(model.provider, model.id) : ''}
          isGroupContextMessage={isGroupContextMessage}
          contentSlot={plainMessageContent}
          footerSlot={userFooter ?? assistantFooter}
        />
      )}
    </div>
  )
}

export default memo(MessageItem)

const UserBubbleMessage = ({
  message,
  topic,
  isLastMessage,
  isGrouped,
  isProcessing,
  messageContainerRef,
  onStartEditing,
  onUpdateUseful,
  messageFont,
  fontSize
}: {
  message: MessageListItem
  topic: Topic
  isLastMessage: boolean
  isGrouped?: boolean
  isProcessing: boolean
  messageContainerRef: React.RefObject<HTMLDivElement>
  onStartEditing?: (messageId: string) => void
  onUpdateUseful?: (msgId: string) => void
  messageFont: string
  fontSize: number
}) => {
  const actions = useMessageListActions()
  const meta = useMessageListMeta()
  const avatar = meta.userProfile?.avatar ?? ''
  const canOpenUserProfile = !!actions.openUserProfile
  const openUserProfile = useCallback(() => {
    void actions.openUserProfile?.()
  }, [actions])

  return (
    <div className="flex w-full flex-col items-end">
      <div className="flex max-w-full items-start justify-end gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col items-end">
          <Scrollbar
            className="message-content-container mt-0 max-w-full overflow-y-auto rounded-[10px] bg-muted px-4 py-2.5 [&_.block-wrapper:last-child>*:last-child]:mb-0! [&_.markdown>p:last-child]:mb-0!"
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
        <MessageAvatar avatar={avatar} className="mt-1.5" onClick={canOpenUserProfile ? openUserProfile : undefined} />
      </div>
      <div className="MessageFooter relative mt-1 mr-[30px] flex min-h-6.5 w-[calc(100%-30px)] max-w-full items-center justify-end text-foreground-muted text-xs leading-none">
        <div className={cn(USER_MESSAGE_FOOTER_ACTIONS_CLASS, 'justify-end')}>
          <span className="shrink-0">{dayjs(message.updatedAt ?? message.createdAt).format('MM/DD HH:mm')}</span>
          <MessageMenuBar
            message={message}
            topic={topic}
            isLastMessage={isLastMessage}
            isAssistantMessage={false}
            isGrouped={isGrouped}
            isProcessing={isProcessing}
            messageContainerRef={messageContainerRef}
            onStartEditing={onStartEditing}
            onUpdateUseful={onUpdateUseful}
            variant="header"
          />
          <SiblingNavigator messageId={message.id} />
        </div>
      </div>
    </div>
  )
}
