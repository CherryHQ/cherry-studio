import { Scrollbar } from '@cherrystudio/ui'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import { useTimer } from '@renderer/hooks/useTimer'
import type { Topic } from '@renderer/types'
import { classNames, cn } from '@renderer/utils'
import { scrollIntoView } from '@renderer/utils/dom'
import { createUniqueModelId, type Model } from '@shared/data/types/model'
import dayjs from 'dayjs'
import type { FC } from 'react'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getMessageEnterMotionAttributes,
  getMessageEnterMotionVariant,
  useMessageEnterMotionActive
} from '../../motion/messageEnterMotion'
import { useMessageParts } from '../blocks'
import SiblingNavigator from '../list/SiblingNavigator'
import {
  useMessageListActions,
  useMessageListEditingId,
  useMessageListMeta,
  useMessageListSelection,
  useMessageListUiSelectors,
  useMessageRenderConfig
} from '../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem } from '../types'
import { getMessageListItemModel } from '../utils/messageListItem'
import MessageAvatar from './MessageAvatar'
import MessageContent from './MessageContent'
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
  lockedMentionedModels?: Model[]
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
  isLatestAssistantMessage = false,
  lockedMentionedModels
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
  const messageParts = useMessageParts(message.id)
  const [isMessageMenuOpen, setIsMessageMenuOpen] = useState(false)
  const editingMessageId = useMessageListEditingId()
  const { setTimeoutTimer } = useTimer()
  const canEditMessage = !!actions.editMessage
  const isEditing = editingMessageId === message.id
  const handleStartEditing = useCallback(
    (messageId: string) => {
      if (canEditMessage && messageId === message.id) {
        actions.startEditing?.(message, messageParts, {
          lockedMentionedModels:
            lockedMentionedModels && lockedMentionedModels.length > 1 ? lockedMentionedModels : undefined
        })
      }
    },
    [actions, canEditMessage, lockedMentionedModels, message, messageParts]
  )

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
  const keepAssistantFooterVisible = isLatestAssistantMessage || isMessageMenuOpen
  const assistantFooterVisibilityClass = keepAssistantFooterVisible
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

  const plainMessageContent = (
    <Scrollbar
      className="message-content-container mt-0 min-h-0 max-w-full overflow-y-auto pl-0"
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
    <div className="MessageFooter relative mt-1 flex min-h-6.5 max-w-full shrink-0 items-center text-foreground-muted text-xs leading-none">
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
        'MessageFooter mt-1 flex min-h-6.5 shrink-0 items-center justify-between gap-1.5 text-xs leading-none',
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
          forceVisible={isMessageMenuOpen}
          isAssistantMessage={isAssistantMessage}
          isGrouped={isGrouped}
          isProcessing={isProcessing}
          messageContainerRef={messageContainerRef as React.RefObject<HTMLDivElement>}
          onStartEditing={handleStartEditing}
          onMenuOpenChange={setIsMessageMenuOpen}
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
          'bg-muted px-3 pb-2 opacity-70 outline-offset-[-1px] [outline:1px_solid_var(--color-border)]': isEditing,
          'cursor-pointer': isMultiSelectMode
        }),
        enterMotionAttributes?.className
      )}
      aria-disabled={isEditing ? true : undefined}
      ref={messageContainerRef}
      onClickCapture={handleMessageSelectClick}>
      {isUserBubbleMessage ? (
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
          isEditing={isEditing}
        />
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
  fontSize,
  isEditing
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
  isEditing: boolean
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
      {!isEditing && (
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
      )}
    </div>
  )
}
