import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import ConfirmActionPopup from '@renderer/components/popups/ConfirmActionPopup'
import { bindSelectionContextMenuItems } from '@renderer/components/selection/selectionContextMenuItems'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
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
  variant?: 'footer' | 'header' | 'context'
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
  const { getMessageSiblings } = messageUi
  const renderConfig = useMessageRenderConfig()
  const messageMountLease = useOptionalMessageMountLease()
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

  const isEditable =
    actions.canEditMessage?.(message) ??
    (isAssistantMessage ? canEditAssistantMessageParts(messageParts) : hasTextParts(messageParts))

  const hasTranslationBlocks = hasTranslationParts(messageParts)
  const isSelectedForContext = !!message.isActiveBranch

  const softHoverBg = isBubbleStyle && !isLastMessage
  const showMessageTokens = variant === 'footer' && (!isBubbleStyle || isAssistantMessage)
  const isUserBubbleStyleMessage = variant === 'footer' && isBubbleStyle && isUserMessage

  const actionContext = useMemo<MessageMenuBarActionContext>(
    () => ({
      actions: actions.canDeleteMessage?.(message) === false ? { ...actions, deleteMessage: undefined } : actions,
      message,
      messageParts,
      messageForExport,
      messageContainerRef,
      acquireMessageCaptureLease: messageMountLease?.acquireMessageMountLease,
      getRenderedMessageElement: messageMountLease?.getRenderedMessageElement,
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
      messageMountLease,
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

  useEffect(() => {
    const frame = messageContainerRef.current
    if (variant !== 'context' || !frame) return

    return bindSelectionContextMenuItems(frame, () => {
      const run = (action: MessageMenuBarResolvedAction) => {
        if (!action.availability.enabled) return
        if (action.confirm) {
          void ConfirmActionPopup.show({
            title: action.confirm.title,
            content: action.confirm.description ?? action.confirm.content,
            okText: action.confirm.confirmText,
            cancelText: action.confirm.cancelText,
            danger: action.confirm.destructive,
            action: () => executeAction(action)
          })
        } else {
          void executeAction(action)
        }
      }
      const primary = toolbarActions.filter(
        (action) => action.commandId && action.id !== 'delete' && (action.id !== 'translate' || isTranslating)
      )
      const more = toolbarActions.some((action) => action.id === 'more-menu') ? menuActions : []
      const items = actionsToCommandMenuExtraItems([...primary, ...more], run)

      const translate = toolbarActions.find((action) => action.id === 'translate')
      if (translate && !isTranslating && translationItems.length > 0) {
        actions.requestTranslationLanguages?.()
        items.push({
          type: 'submenu',
          id: translate.id,
          label: t('chat.translate'),
          icon: translate.icon,
          children: translationItems.map((item) =>
            'type' in item
              ? { type: 'separator' }
              : { type: 'item', id: item.key, label: item.label, enabled: item.enabled, onSelect: item.onSelect }
          )
        })
      }

      const siblings = getMessageSiblings?.(message.id)
      if (siblings && actions.setActiveBranch) {
        items.push({
          type: 'submenu',
          id: 'message.branches',
          label: t('chat.message.branches'),
          children: siblings.group.map((item, index) => ({
            type: 'item',
            id: item.id,
            label: item.preview || `${index + 1}/${siblings.group.length}`,
            enabled: index !== siblings.activeIndex,
            onSelect: async () => {
              try {
                await actions.setActiveBranch?.(item.id)
              } catch (error) {
                actions.notifyError?.(error instanceof Error ? error.message : String(error))
              }
            }
          }))
        })
      }

      const remove = toolbarActions.find((action) => action.id === 'delete')
      if (remove)
        items.push({ type: 'separator' }, ...actionsToCommandMenuExtraItems([{ ...remove, danger: true }], run))
      return items
    })
  }, [
    actions,
    executeAction,
    getMessageSiblings,
    isTranslating,
    menuActions,
    message.id,
    messageContainerRef,
    t,
    toolbarActions,
    translationItems,
    variant
  ])

  if (variant === 'context') return null

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
