import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { getComposerTextFromParts } from '@renderer/utils/message/composerTokens'
import { canEditAssistantMessageParts, hasTextParts, hasTranslationParts } from '@renderer/utils/message/partsHelpers'
import { classNames } from '@renderer/utils/style'
import type { FC } from 'react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useMessageParts } from '../blocks/MessagePartsContext'
import {
  useMessageListActions,
  useMessageListSelection,
  useMessageListUi,
  useMessageRenderConfig
} from '../MessageListProvider'
import { defaultMessageMenuConfig, type MessageListItem } from '../types'
import { createMessageExportView } from '../utils/messageListItem'
import {
  executeMessageMenuBarAction,
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
  const menuConfig = messageUi.menuConfig ?? defaultMessageMenuConfig
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const translateLanguages = useMemo(() => messageUi.translationLanguages ?? [], [messageUi.translationLanguages])
  const isBubbleStyle = renderConfig.messageStyle === 'bubble'

  const isUserMessage = message.role === 'user'

  const messageParts = useMessageParts(message.id)
  const messageForExport = useMemo(() => createMessageExportView(message, messageParts), [message, messageParts])

  const mainTextContent = useMemo(() => getComposerTextFromParts(messageParts), [messageParts])

  const isTranslating = messageUi.isMessageTranslating?.(message.id) ?? false

  const isEditable = isAssistantMessage ? canEditAssistantMessageParts(messageParts) : hasTextParts(messageParts)

  const hasTranslationBlocks = hasTranslationParts(messageParts)
  const isSelectedForContext = !!message.isActiveBranch

  const softHoverBg = isBubbleStyle && !isLastMessage
  const showMessageTokens = variant === 'footer' && (!isBubbleStyle || isAssistantMessage)
  const isUserBubbleStyleMessage = variant === 'footer' && isBubbleStyle && isUserMessage

  const actionContext = useMemo<MessageMenuBarActionContext>(
    () => ({
      actions,
      message,
      messageParts,
      messageForExport,
      messageContainerRef,
      mainTextContent,
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
    }),
    [
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
      mainTextContent,
      menuConfig,
      message,
      messageContainerRef,
      messageUi.getTranslationLanguageLabel,
      messageUi.translationLanguagesStatus,
      messageForExport,
      messageParts,
      onStartEditing,
      onSelectContext,
      selection,
      setCopied,
      t,
      translateLanguages
    ]
  )

  const menuActions = useMemo(() => resolveMessageMenuBarMenuActions(actionContext), [actionContext])
  const toolbarActions = useMemo(() => resolveMessageMenuBarToolbarActions(actionContext), [actionContext])
  const translationItems = useMemo(() => resolveMessageMenuBarTranslationItems(actionContext), [actionContext])

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
            menuActions={menuActions}
            onMenuOpenChange={onMenuOpenChange}
            softHoverBg={softHoverBg}
            translationItems={translationItems}
          />
        ))}
      </div>
      {showMessageTokens && <MessageTokens message={message} />}
    </>
  )
}

export default memo(MessageMenuBar)
