import {
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ModelSelector } from '@renderer/components/Selector'
import type { MessageMenuBarScope } from '@renderer/config/registry/messageMenuBar'
import { DEFAULT_MESSAGE_MENUBAR_SCOPE, getMessageMenuBarConfig } from '@renderer/config/registry/messageMenuBar'
import { useMessageEditing } from '@renderer/context/MessageEditingContext'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { translateText } from '@renderer/services/TranslateService'
import type { Topic, TranslateLanguage } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { abortCompletion } from '@renderer/utils/abortController'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import {
  getTextFromParts,
  getTranslationFromParts,
  hasTextParts,
  hasTranslationParts
} from '@renderer/utils/messageUtils/partsHelpers'
import type { CherryMessagePart } from '@shared/data/types/message'
import { createUniqueModelId, type Model as SharedModel, parseUniqueModelId } from '@shared/data/types/model'
import { isNonChatModel, isVisionModel as isSharedVisionModel } from '@shared/utils/model'
import { CirclePause } from 'lucide-react'
import type { ComponentProps, FC, ReactNode } from 'react'
import { Fragment, memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePartsMap } from '../blocks'
import { useMessageListActions, useMessageListSelection, useMessageListUi } from '../MessageListProvider'
import type { MessageListItem } from '../types'
import { createMessageExportView, getMessageListItemModel } from '../utils/messageListItem'
import {
  executeMessageMenuBarAction,
  type MessageMenuBarActionContext,
  type MessageMenuBarResolvedAction,
  resolveMessageMenuBarMenuActions,
  resolveMessageMenuBarToolbarActions
} from './messageMenuBarActions'
import MessageTokens from './MessageTokens'

const createTranslationAbortKey = (messageId: string) => `translation-abort-key:${messageId}`

const abortTranslation = (messageId: string) => {
  abortCompletion(createTranslationAbortKey(messageId))
}

interface Props {
  message: MessageListItem
  topic: Topic
  isGrouped?: boolean
  isLastMessage: boolean
  isAssistantMessage: boolean
  isProcessing: boolean
  messageContainerRef: React.RefObject<HTMLDivElement>
  onUpdateUseful?: (msgId: string) => void
  variant?: 'footer' | 'header'
}

const logger = loggerService.withContext('MessageMenuBar')

type TranslateMenuItem =
  | {
      key: string
      label: string
      onClick: () => void | Promise<void>
    }
  | {
      key: string
      type: 'divider'
    }

const isTranslateMenuDivider = (item: TranslateMenuItem): item is Extract<TranslateMenuItem, { type: 'divider' }> =>
  'type' in item && item.type === 'divider'

const MessageMenuBar: FC<Props> = (props) => {
  const {
    message,
    isGrouped,
    isLastMessage,
    isAssistantMessage,
    isProcessing,
    topic,
    messageContainerRef,
    onUpdateUseful,
    variant = 'footer'
  } = props
  const { t } = useTranslation()
  const actions = useMessageListActions()
  const selection = useMessageListSelection()
  const messageUi = useMessageListUi()
  const messageModel = useMemo(() => getMessageListItemModel(message), [message])
  const currentMentionModel = useMemo<SharedModel | undefined>(() => {
    if (!messageModel) return undefined
    return {
      id: createUniqueModelId(messageModel.provider, messageModel.id),
      providerId: messageModel.provider,
      name: messageModel.name,
      group: messageModel.group
    } as SharedModel
  }, [messageModel])
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const translationAbortKey = createTranslationAbortKey(message.id)
  const [showDeleteTooltip, setShowDeleteTooltip] = useState(false)
  const translateLanguages = messageUi.translationLanguages ?? []
  const getLanguageLabel = useCallback(
    (language: TranslateLanguage, withEmoji?: boolean) =>
      messageUi.getTranslationLanguageLabel?.(language, withEmoji) ?? language.langCode,
    [messageUi.getTranslationLanguageLabel]
  )

  const [messageStyle] = usePreference('chat.message.style')
  const [enableDeveloperMode] = usePreference('app.developer_mode.enabled')
  const [confirmDeleteMessage] = usePreference('chat.message.confirm_delete')
  const [confirmRegenerateMessage] = usePreference('chat.message.confirm_regenerate')

  const isBubbleStyle = messageStyle === 'bubble'

  const isUserMessage = message.role === 'user'

  const [exportMenuOptions] = useMultiplePreferences({
    image: 'data.export.menus.image',
    markdown: 'data.export.menus.markdown',
    markdown_reason: 'data.export.menus.markdown_reason',
    notion: 'data.export.menus.notion',
    yuque: 'data.export.menus.yuque',
    joplin: 'data.export.menus.joplin',
    obsidian: 'data.export.menus.obsidian',
    siyuan: 'data.export.menus.siyuan',
    docx: 'data.export.menus.docx',
    plain_text: 'data.export.menus.plain_text'
  })

  const partsMap = usePartsMap()
  const messageParts = useMemo(() => partsMap?.[message.id] ?? [], [partsMap, message.id])
  const messageForExport = useMemo(() => createMessageExportView(message, messageParts), [message, messageParts])

  const mainTextContent = useMemo(() => getTextFromParts(messageParts), [messageParts])

  /**
   * Mention a specific model to regenerate this assistant turn — produces a
   * new sibling in the same group (parent user message, shared
   * `siblingsGroupId`) using the chosen model. Filters out non-chat models
   * (embedding/rerank/image-gen/audio/etc.) and text-only models when the
   * upstream turn carries images.
   */
  const mentionModelFilter = useCallback(
    (m: SharedModel) => {
      if (isNonChatModel(m)) return false
      const needsVision = messageParts.some((part) => part.type === 'file' && part.mediaType?.startsWith('image/'))
      if (needsVision && !isSharedVisionModel(m)) return false
      return true
    },
    [messageParts]
  )

  const onSelectMentionModel = useCallback(
    async (selected: SharedModel | undefined) => {
      if (!selected) return
      const { providerId, modelId } = parseUniqueModelId(selected.id)
      await actions.regenerateMessageWithModel?.(message.id, selected.id, {
        id: modelId,
        name: selected.name,
        provider: providerId,
        ...(selected.group && { group: selected.group })
      })
    },
    [actions, message.id]
  )

  const { startEditing } = useMessageEditing()

  const isTranslating = useMemo(
    () =>
      messageParts.some((part) => {
        if (part.type !== 'data-translation') return false
        const state = (part as { state?: string }).state
        return state === 'input-streaming' || state === 'input-available'
      }),
    [messageParts]
  )

  const handleTranslate = useCallback(
    async (language: TranslateLanguage) => {
      if (isTranslating) return

      const translationUpdater = await actions.getTranslationUpdater?.(message.id, language.langCode)
      if (!translationUpdater) return

      try {
        await translateText(mainTextContent, language, translationUpdater, translationAbortKey)
      } catch (error) {
        if (!isAbortError(error)) {
          logger.error('Message translation failed', error as Error)
          window.toast.error(formatErrorMessageWithPrefix(error, t('translate.error.failed')))
        }
      }
    },
    [actions, isTranslating, mainTextContent, message.id, translationAbortKey, t]
  )

  const menubarScope: MessageMenuBarScope = topic?.type ?? DEFAULT_MESSAGE_MENUBAR_SCOPE
  const { buttonIds } = getMessageMenuBarConfig(menubarScope)
  const toolbarButtonIds = useMemo(() => new Set(buttonIds), [buttonIds])

  const isEditable = useMemo(() => hasTextParts(messageParts), [messageParts])

  const hasTranslationBlocks = useMemo(() => hasTranslationParts(messageParts), [messageParts])
  const isUseful = !!messageUi.getMessageUiState?.(message.id).useful
  const abortCurrentTranslation = useCallback(() => abortTranslation(message.id), [message.id])

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
      exportMenuOptions,
      confirmDeleteMessage,
      confirmRegenerateMessage,
      copied,
      setCopied,
      enableDeveloperMode,
      isAssistantMessage,
      isGrouped,
      isProcessing,
      isUserMessage,
      isUseful,
      isEditable,
      startEditing,
      onUpdateUseful,
      abortTranslation: abortCurrentTranslation,
      t
    }),
    [
      abortCurrentTranslation,
      actions,
      confirmDeleteMessage,
      confirmRegenerateMessage,
      copied,
      enableDeveloperMode,
      exportMenuOptions,
      isAssistantMessage,
      isEditable,
      isGrouped,
      isProcessing,
      isUseful,
      isUserMessage,
      mainTextContent,
      message,
      messageContainerRef,
      messageForExport,
      messageParts,
      onUpdateUseful,
      selection,
      setCopied,
      startEditing,
      t,
      toolbarButtonIds
    ]
  )

  const menuActions = useMemo(() => resolveMessageMenuBarMenuActions(actionContext), [actionContext])
  const toolbarActions = useMemo(() => resolveMessageMenuBarToolbarActions(actionContext), [actionContext])

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
          <Fragment key={action.id}>
            {renderToolbarAction({
              action,
              actionContext,
              currentMentionModel,
              executeAction,
              getLanguageLabel,
              handleTranslate,
              hasTranslationBlocks,
              isTranslating,
              mentionModelFilter,
              menuActions,
              message,
              messageParts,
              onSelectMentionModel,
              setShowDeleteTooltip,
              showDeleteTooltip,
              softHoverBg,
              t,
              translateLanguages
            })}
          </Fragment>
        ))}
      </div>
      {showMessageTokens && <MessageTokens message={message} />}
    </>
  )
}

const ActionButton = ({
  $softHoverBg,
  className,
  type,
  ...props
}: ComponentProps<'button'> & { $softHoverBg?: boolean }) => {
  return (
    <button
      type={type ?? 'button'}
      className={classNames(
        'flex size-5.5 items-center justify-center rounded-md border-0 bg-transparent p-0 text-(--color-icon) transition-all duration-150 ease-out',
        '[&_.icon-at]:text-sm [&_.iconfont]:text-[13px] [&_svg]:size-3.5',
        'enabled:cursor-pointer enabled:hover:text-foreground',
        'enabled:[&_.iconfont]:cursor-pointer enabled:[&_svg]:cursor-pointer',
        $softHoverBg ? 'enabled:hover:bg-muted' : 'enabled:hover:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className
      )}
      {...props}
    />
  )
}

const ConfirmActionButton = ({
  children,
  title,
  confirmText,
  disabled,
  onConfirm,
  onOpenChange
}: {
  children: ReactNode
  title: ReactNode
  confirmText?: string
  disabled?: boolean
  onConfirm: () => void | Promise<void>
  onOpenChange?: (open: boolean) => void
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled) return
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  return (
    <>
      <span onClickCapture={() => handleOpenChange(true)}>{children}</span>
      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={title}
        confirmText={confirmText ?? t('common.confirm')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={onConfirm}
      />
    </>
  )
}

interface RenderToolbarActionOptions {
  action: MessageMenuBarResolvedAction
  actionContext: MessageMenuBarActionContext
  currentMentionModel?: SharedModel
  executeAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
  getLanguageLabel: (language: TranslateLanguage, withEmoji?: boolean) => string | undefined
  handleTranslate: (language: TranslateLanguage) => Promise<void>
  hasTranslationBlocks: boolean
  isTranslating: boolean
  mentionModelFilter: (m: SharedModel) => boolean
  menuActions: MessageMenuBarResolvedAction[]
  message: MessageListItem
  messageParts: CherryMessagePart[]
  onSelectMentionModel: (m: SharedModel | undefined) => void | Promise<void>
  setShowDeleteTooltip: (open: boolean) => void
  showDeleteTooltip: boolean
  softHoverBg: boolean
  t: (key: string) => string
  translateLanguages: TranslateLanguage[]
}

const renderToolbarAction = ({
  action,
  currentMentionModel,
  executeAction,
  getLanguageLabel,
  handleTranslate,
  hasTranslationBlocks,
  isTranslating,
  mentionModelFilter,
  menuActions,
  message,
  messageParts,
  onSelectMentionModel,
  setShowDeleteTooltip,
  showDeleteTooltip,
  softHoverBg,
  t,
  translateLanguages
}: RenderToolbarActionOptions) => {
  if (action.id === 'assistant-mention-model') {
    return (
      <ModelSelector
        multiple={false}
        value={currentMentionModel}
        filter={mentionModelFilter}
        onSelect={onSelectMentionModel}
        trigger={
          <Tooltip content={action.label} delay={800}>
            <ActionButton className="message-action-button" $softHoverBg={softHoverBg}>
              {action.icon}
            </ActionButton>
          </Tooltip>
        }
      />
    )
  }

  if (action.id === 'translate') {
    return renderTranslateAction({
      action,
      getLanguageLabel,
      handleTranslate,
      hasTranslationBlocks,
      isTranslating,
      message,
      messageParts,
      softHoverBg,
      t,
      translateLanguages
    })
  }

  if (action.id === 'more-menu') {
    if (menuActions.length === 0) return null
    return (
      <MessageActionMenuPopover actions={menuActions} align="end" onAction={executeAction}>
        <ActionButton className="message-action-button" onClick={(e) => e.stopPropagation()} $softHoverBg={softHoverBg}>
          {action.icon}
        </ActionButton>
      </MessageActionMenuPopover>
    )
  }

  if (action.id === 'delete') {
    return renderActionButton({
      action,
      executeAction,
      icon: (
        <Tooltip content={action.label} delay={1000} isOpen={showDeleteTooltip} onOpenChange={setShowDeleteTooltip}>
          {action.icon}
        </Tooltip>
      ),
      setShowDeleteTooltip,
      softHoverBg,
      tooltip: false
    })
  }

  return renderActionButton({
    action,
    executeAction,
    setShowDeleteTooltip,
    softHoverBg
  })
}

const renderActionButton = ({
  action,
  executeAction,
  icon = action.icon,
  setShowDeleteTooltip,
  softHoverBg,
  tooltip = action.label
}: {
  action: MessageMenuBarResolvedAction
  executeAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
  icon?: ReactNode
  setShowDeleteTooltip: (open: boolean) => void
  softHoverBg: boolean
  tooltip?: ReactNode | false
}) => {
  const disabled = !action.availability.enabled
  const button = (
    <ActionButton
      className="message-action-button"
      onClick={(e) => {
        e.stopPropagation()
        if (!action.confirm) {
          void executeAction(action)
        }
      }}
      disabled={disabled}
      $softHoverBg={softHoverBg}>
      {icon}
    </ActionButton>
  )

  const content = action.confirm ? (
    <ConfirmActionButton
      title={action.confirm.title}
      confirmText={action.confirm.confirmText}
      onConfirm={() => executeAction(action)}
      onOpenChange={(open) => open && setShowDeleteTooltip(false)}
      disabled={disabled}>
      {button}
    </ConfirmActionButton>
  ) : (
    button
  )

  if (tooltip === false) return content

  return (
    <Tooltip content={tooltip} delay={800}>
      {content}
    </Tooltip>
  )
}

const renderTranslateAction = ({
  action,
  getLanguageLabel,
  handleTranslate,
  hasTranslationBlocks,
  isTranslating,
  message,
  messageParts,
  softHoverBg,
  t,
  translateLanguages
}: {
  action: MessageMenuBarResolvedAction
  getLanguageLabel: (language: TranslateLanguage, withEmoji?: boolean) => string | undefined
  handleTranslate: (language: TranslateLanguage) => Promise<void>
  hasTranslationBlocks: boolean
  isTranslating: boolean
  message: MessageListItem
  messageParts: CherryMessagePart[]
  softHoverBg: boolean
  t: (key: string) => string
  translateLanguages: TranslateLanguage[]
}) => {
  if (isTranslating) {
    return (
      <Tooltip content={t('translate.stop')}>
        <ActionButton
          className="message-action-button"
          onClick={(e) => {
            e.stopPropagation()
            abortTranslation(message.id)
          }}
          $softHoverBg={softHoverBg}>
          <CirclePause size={15} />
        </ActionButton>
      </Tooltip>
    )
  }

  const items: TranslateMenuItem[] = [
    ...translateLanguages.map((item) => ({
      label: getLanguageLabel(item) ?? item.langCode,
      key: item.langCode,
      onClick: () => handleTranslate(item)
    })),
    ...(hasTranslationBlocks
      ? [
          { type: 'divider' as const, key: 'translate-divider' },
          {
            label: '📋 ' + t('common.copy'),
            key: 'translate-copy',
            onClick: () => {
              const translationContent = getTranslationFromParts(messageParts)
                .map((item) => item.content || '')
                .join('\n\n')
                .trim()

              if (translationContent) {
                void navigator.clipboard.writeText(translationContent)
                window.toast.success(t('translate.copied'))
              } else {
                window.toast.warning(t('translate.empty'))
              }
            }
          }
        ]
      : [])
  ]

  return (
    <Tooltip content={action.label} delay={1200}>
      <TranslateMenuPopover items={items} align="center" contentClassName="max-h-[250px] overflow-y-auto">
        <ActionButton className="message-action-button" onClick={(e) => e.stopPropagation()} $softHoverBg={softHoverBg}>
          {action.icon}
        </ActionButton>
      </TranslateMenuPopover>
    </Tooltip>
  )
}

const MessageActionMenuPopover = ({
  actions,
  align = 'end',
  children,
  contentClassName,
  onAction
}: {
  actions: MessageMenuBarResolvedAction[]
  align?: 'start' | 'center' | 'end'
  children: ReactNode
  contentClassName?: string
  onAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <DropdownMenuContent className={classNames('min-w-36', contentClassName)} align={align} side="top">
      <MessageActionMenuItems actions={actions} onAction={onAction} />
    </DropdownMenuContent>
  </DropdownMenu>
)

const MessageActionMenuItems = ({
  actions,
  onAction
}: {
  actions: MessageMenuBarResolvedAction[]
  onAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
}) => {
  let previousGroup: string | undefined

  return (
    <>
      {actions.map((action, index) => {
        const separatorBefore = index > 0 && action.group !== previousGroup
        previousGroup = action.group

        return (
          <Fragment key={action.id}>
            {separatorBefore && <DropdownMenuSeparator />}
            <MessageActionMenuItem action={action} onAction={onAction} />
          </Fragment>
        )
      })}
    </>
  )
}

const MessageActionMenuItem = ({
  action,
  onAction
}: {
  action: MessageMenuBarResolvedAction
  onAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
}) => {
  const disabled = !action.availability.enabled

  if (action.children.length) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={disabled}>
          {action.icon}
          <span>{action.label}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-56 max-w-80">
          <MessageActionMenuItems actions={action.children} onAction={onAction} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }

  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={(event) => {
        event.stopPropagation()
        void onAction(action)
      }}>
      {action.icon}
      <span>{action.label}</span>
    </DropdownMenuItem>
  )
}

const TranslateMenuPopover = ({
  children,
  contentClassName,
  items,
  align = 'end'
}: {
  children: ReactNode
  contentClassName?: string
  items: TranslateMenuItem[]
  align?: 'start' | 'center' | 'end'
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <DropdownMenuContent className={classNames('min-w-36', contentClassName)} align={align} side="top">
      {items.map((item) => {
        if (isTranslateMenuDivider(item)) {
          return <DropdownMenuSeparator key={item.key} />
        }
        return (
          <DropdownMenuItem
            key={item.key}
            onSelect={(event) => {
              event.stopPropagation()
              void item.onClick()
            }}>
            <span>{item.label}</span>
          </DropdownMenuItem>
        )
      })}
    </DropdownMenuContent>
  </DropdownMenu>
)

export default memo(MessageMenuBar)
