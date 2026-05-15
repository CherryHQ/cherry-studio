import type { MessageMenuBarScope } from '@renderer/config/registry/messageMenuBar'
import { DEFAULT_MESSAGE_MENUBAR_SCOPE, getMessageMenuBarConfig } from '@renderer/config/registry/messageMenuBar'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import type { Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { getTextFromParts, hasTextParts, hasTranslationParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { FC } from 'react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useMessageParts } from '../blocks'
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
  topic: Topic
  isGrouped?: boolean
  isLastMessage: boolean
  isAssistantMessage: boolean
  isProcessing: boolean
  messageContainerRef: React.RefObject<HTMLDivElement>
  onStartEditing?: (messageId: string) => void
  onUpdateUseful?: (msgId: string) => void
  variant?: 'footer' | 'header'
}

const MessageMenuBar: FC<Props> = (props) => {
  const {
    message,
    isGrouped,
    isLastMessage,
    isAssistantMessage,
    isProcessing,
    topic,
    messageContainerRef,
    onStartEditing,
    onUpdateUseful,
    variant = 'footer'
  } = props
  const { t } = useTranslation()
  const actions = useMessageListActions()
  const selection = useMessageListSelection()
  const messageUi = useMessageListUi()
  const renderConfig = useMessageRenderConfig()
  const menuConfig = messageUi.menuConfig ?? defaultMessageMenuConfig
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const translateLanguages = messageUi.translationLanguages ?? []
  const isBubbleStyle = renderConfig.messageStyle === 'bubble'

  const isUserMessage = message.role === 'user'

  const messageParts = useMessageParts(message.id)
  const messageForExport = useMemo(() => createMessageExportView(message, messageParts), [message, messageParts])

  const mainTextContent = useMemo(() => getTextFromParts(messageParts), [messageParts])

  const isTranslating = useMemo(
    () =>
      messageParts.some((part) => {
        if (part.type !== 'data-translation') return false
        const state = (part as { state?: string }).state
        return state === 'input-streaming' || state === 'input-available'
      }),
    [messageParts]
  )

  const menubarScope: MessageMenuBarScope = topic?.type ?? DEFAULT_MESSAGE_MENUBAR_SCOPE
  const { buttonIds } = getMessageMenuBarConfig(menubarScope)
  const toolbarButtonIds = useMemo(() => new Set(buttonIds), [buttonIds])

  const isEditable = useMemo(() => hasTextParts(messageParts), [messageParts])

  const hasTranslationBlocks = useMemo(() => hasTranslationParts(messageParts), [messageParts])
  const isUseful = !!messageUi.getMessageUiState?.(message.id).useful

  const softHoverBg = isBubbleStyle && !isLastMessage
  const showMessageTokens = variant === 'footer' && !isBubbleStyle
  const isUserBubbleStyleMessage = variant === 'footer' && isBubbleStyle && isUserMessage

  const actionContext = useMemo<MessageMenuBarActionContext>(
    () => ({
      actions,
      message,
      messageParts,
      messageForExport,
      messageContainerRef,
      mainTextContent,
      toolbarButtonIds,
      selection,
      menuConfig,
      copied,
      setCopied,
      isAssistantMessage,
      isGrouped,
      isProcessing,
      isTranslating,
      hasTranslationBlocks,
      isUserMessage,
      isUseful,
      isEditable,
      translateLanguages,
      getTranslationLanguageLabel: messageUi.getTranslationLanguageLabel,
      startEditingMessage: onStartEditing,
      onUpdateUseful,
      t
    }),
    [
      actions,
      copied,
      hasTranslationBlocks,
      isAssistantMessage,
      isEditable,
      isGrouped,
      isProcessing,
      isTranslating,
      isUseful,
      isUserMessage,
      mainTextContent,
      menuConfig,
      message,
      messageContainerRef,
      messageUi.getTranslationLanguageLabel,
      messageForExport,
      messageParts,
      onStartEditing,
      onUpdateUseful,
      selection,
      setCopied,
      t,
      translateLanguages,
      toolbarButtonIds
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
        className={classNames(
          'menubar flex flex-row items-center justify-end gap-1.5',
          isUserBubbleStyleMessage && 'user-bubble-style mt-[5px]',
          isLastMessage && 'show'
        )}>
        {toolbarActions.map((action) => (
          <MessageMenuBarToolbarAction
            key={action.id}
            action={action}
            actionContext={actionContext}
            executeAction={executeAction}
            menuActions={menuActions}
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
