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
  useMessagePriorCitationParts,
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
  isAssistantMessage: boolean
  isProcessing: boolean
  messageContainerRef: React.RefObject<HTMLDivElement>
  onStartEditing?: (messageId: string) => void
  onMenuOpenChange?: (open: boolean) => void
  onSelectContext?: (msgId: string) => void
  variant?: 'footer' | 'header'
}

const STABLE_MESSAGE_ACTION_IDS = new Set(['more-menu'])
const COARSE_POINTER_STABLE_MESSAGE_ACTION_IDS = new Set(['copy'])

const MessageMenuBar: FC<Props> = (props) => {
  const {
    message,
    isGrouped,
    isLastMessage,
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
  const priorCitationParts = useMessagePriorCitationParts(message.id)
  const messageForExport = useMemo(
    () => createMessageExportView(message, messageParts, priorCitationParts),
    [message, messageParts, priorCitationParts]
  )

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
          isUserBubbleStyleMessage && 'user-bubble-style mt-[5px]'
        )}>
        {toolbarActions.map((action) => {
          const isStable = isLastMessage || STABLE_MESSAGE_ACTION_IDS.has(action.id)
          const isCoarsePointerStable = COARSE_POINTER_STABLE_MESSAGE_ACTION_IDS.has(action.id)

          return (
            <span
              key={action.id}
              data-message-action-id={action.id}
              className={classNames(
                'shrink-0 transition-opacity duration-200 motion-reduce:transition-none',
                isStable
                  ? 'pointer-events-auto opacity-100'
                  : classNames(
                      'pointer-events-none opacity-0 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100',
                      isCoarsePointerStable && 'pointer-coarse:pointer-events-auto pointer-coarse:opacity-100'
                    )
              )}>
              <MessageMenuBarToolbarAction
                action={action}
                actionContext={actionContext}
                executeAction={executeAction}
                menuActions={menuActions}
                onMenuOpenChange={onMenuOpenChange}
                softHoverBg={softHoverBg}
                translationItems={translationItems}
              />
            </span>
          )
        })}
      </div>
      {showMessageTokens && <MessageTokens message={message} />}
    </>
  )
}

export default memo(MessageMenuBar)
