import type { FC } from 'react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import type { MessageExportView } from '@renderer/types/messageExport'
import { getComposerTextFromParts } from '@renderer/utils/message/composerTokens'
import { canEditAssistantMessageParts, hasTextParts, hasTranslationParts } from '@renderer/utils/message/partsHelpers'
import { classNames } from '@renderer/utils/style'

import { useMessageParts } from '../blocks/MessagePartsContext'
import { useOptionalMessageMountLease } from '../list/MessageMountLeaseContext'
import {
  useMessageListActions,
  useMessageListSelection,
  useMessageListUi,
  useMessagePriorCitationParts,
  useMessageRenderConfig
} from '../MessageListProvider'
import { defaultMessageMenuConfig, type MessageListItem } from '../types'
import { createMessageExportView } from '../utils/messageListItem'
import {
  executeMessageMenuBarAction,
  hasMessageMenuBarMenuActions,
  hasMessageMenuBarTranslationItems,
  type MessageMenuBarActionContext,
  type MessageMenuBarResolvedAction,
  resolveMessageMenuBarMenuActions,
  resolveMessageMenuBarToolbarActions,
  resolveMessageMenuBarTranslationItems
} from './messageMenuBarActions'
import { MessageMenuBarToolbarAction } from './MessageMenuBarToolbar'
import MessageTokens from './MessageTokens'

interface Props {
  message: MessageListItem
  isGrouped?: boolean
  isLastMessage: boolean
  forceVisible?: boolean
  isAssistantMessage: boolean
  isProcessing: boolean
  messageContainerRef: React.RefObject<HTMLDivElement>
  onStartEditing?: (messageId: string) => void
  onMenuOpenChange?: (open: boolean) => void
  onSelectContext?: (msgId: string) => void
  variant?: 'footer' | 'header'
}

const MessageMenuBar: FC<Props> = (props) => {
  const {
    message,
    isGrouped,
    isLastMessage,
    forceVisible = false,
    isAssistantMessage,
    isProcessing,
    messageContainerRef,
    onStartEditing,
    onMenuOpenChange,
    onSelectContext,
    variant = 'footer'
  } = props
  const { t } = useTranslation()
  const actions = useMessageListActions()
  const selection = useMessageListSelection()
  const messageUi = useMessageListUi()
  const renderConfig = useMessageRenderConfig()
  const messageMountLease = useOptionalMessageMountLease()
  const menuConfig = messageUi.menuConfig ?? defaultMessageMenuConfig
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const translateLanguages = useMemo(() => messageUi.translationLanguages ?? [], [messageUi.translationLanguages])
  const isBubbleStyle = renderConfig.messageStyle === 'bubble'

  const isUserMessage = message.role === 'user'

  const messageParts = useMessageParts(message.id)
  const priorCitationParts = useMessagePriorCitationParts(message.id)

  const isTranslating = messageUi.isMessageTranslating?.(message.id) ?? false

  const isEditable =
    actions.canEditMessage?.(message) ??
    (isAssistantMessage ? canEditAssistantMessageParts(messageParts) : hasTextParts(messageParts))

  const hasTranslationBlocks = hasTranslationParts(messageParts)
  const isSelectedForContext = !!message.isActiveBranch

  const softHoverBg = isBubbleStyle && !isLastMessage
  const showMessageTokens = variant === 'footer' && (!isBubbleStyle || isAssistantMessage)
  const isUserBubbleStyleMessage = variant === 'footer' && isBubbleStyle && isUserMessage

  const actionContext = useMemo<MessageMenuBarActionContext>(() => {
    let cachedMessageForExport: MessageExportView | undefined
    let cachedMainTextContent: string | undefined

    return {
      actions: actions.canDeleteMessage?.(message) === false ? { ...actions, deleteMessage: undefined } : actions,
      message,
      messageParts,
      get messageForExport() {
        cachedMessageForExport ??= createMessageExportView(message, messageParts, priorCitationParts)
        return cachedMessageForExport
      },
      messageContainerRef,
      acquireMessageCaptureLease: messageMountLease?.acquireMessageMountLease,
      getRenderedMessageElement: messageMountLease?.getRenderedMessageElement,
      get mainTextContent() {
        cachedMainTextContent ??= getComposerTextFromParts(messageParts)
        return cachedMainTextContent
      },
      selection,
      menuConfig,
      copied,
      setCopied,
      isAssistantMessage,
      isGrouped,
      isLastMessage,
      isProcessing,
      isTranslating,
      hasTranslationBlocks,
      isUserMessage,
      isSelectedForContext,
      isEditable,
      translateLanguages,
      translationLanguagesStatus: messageUi.translationLanguagesStatus,
      getTranslationLanguageLabel: messageUi.getTranslationLanguageLabel,
      startEditingMessage: onStartEditing,
      onSelectContext,
      t
    }
  }, [
    actions,
    copied,
    hasTranslationBlocks,
    isAssistantMessage,
    isEditable,
    isGrouped,
    isLastMessage,
    isProcessing,
    isTranslating,
    isSelectedForContext,
    isUserMessage,
    menuConfig,
    message,
    messageContainerRef,
    messageMountLease,
    messageParts,
    messageUi.getTranslationLanguageLabel,
    messageUi.translationLanguagesStatus,
    onStartEditing,
    onSelectContext,
    priorCitationParts,
    selection,
    setCopied,
    t,
    translateLanguages
  ])

  const hasMenuActions = useMemo(() => hasMessageMenuBarMenuActions(actionContext), [actionContext])
  const getMenuActions = useCallback(() => resolveMessageMenuBarMenuActions(actionContext), [actionContext])
  const toolbarActions = useMemo(() => resolveMessageMenuBarToolbarActions(actionContext), [actionContext])
  const hasTranslationItems = useMemo(() => hasMessageMenuBarTranslationItems(actionContext), [actionContext])
  const getTranslationItems = useCallback(() => resolveMessageMenuBarTranslationItems(actionContext), [actionContext])

  const executeAction = useCallback(
    async (action: MessageMenuBarResolvedAction) => {
      await executeMessageMenuBarAction(action.id, actionContext)
    },
    [actionContext]
  )

  return (
    <>
      <div
        data-ui="part:message-actions"
        className={classNames(
          'menubar flex select-none flex-row items-center justify-end gap-1.5',
          isUserBubbleStyleMessage && 'user-bubble-style mt-[5px]',
          (isLastMessage || forceVisible) && 'show'
        )}>
        {toolbarActions.map((action) => (
          <MessageMenuBarToolbarAction
            key={action.id}
            action={action}
            actionContext={actionContext}
            executeAction={executeAction}
            hasMenuActions={hasMenuActions}
            getMenuActions={getMenuActions}
            onMenuOpenChange={onMenuOpenChange}
            softHoverBg={softHoverBg}
            hasTranslationItems={hasTranslationItems}
            getTranslationItems={getTranslationItems}
          />
        ))}
      </div>
      {showMessageTokens && <MessageTokens message={message} />}
    </>
  )
}

export default memo(MessageMenuBar)
