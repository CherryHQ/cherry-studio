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
import type { MessageMenuBarScope } from '@renderer/config/registry/messageMenuBar'
import { DEFAULT_MESSAGE_MENUBAR_SCOPE, getMessageMenuBarConfig } from '@renderer/config/registry/messageMenuBar'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import type { Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { getTextFromParts, hasTextParts, hasTranslationParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { ComponentProps, FC, ReactNode } from 'react'
import { Fragment, memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePartsMap } from '../blocks'
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
  getMessageMenuBarToolbarRenderKind,
  isMessageMenuBarTranslationDivider,
  type MessageMenuBarActionContext,
  type MessageMenuBarResolvedAction,
  type MessageMenuBarTranslationItem,
  resolveMessageMenuBarMenuActions,
  resolveMessageMenuBarToolbarActions,
  resolveMessageMenuBarTranslationItems
} from './messageMenuBarActions'
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
  const [showDeleteTooltip, setShowDeleteTooltip] = useState(false)
  const translateLanguages = messageUi.translationLanguages ?? []
  const isBubbleStyle = renderConfig.messageStyle === 'bubble'

  const isUserMessage = message.role === 'user'

  const partsMap = usePartsMap()
  const messageParts = useMemo(() => partsMap?.[message.id] ?? [], [partsMap, message.id])
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
          <Fragment key={action.id}>
            {renderToolbarAction({
              action,
              actionContext,
              executeAction,
              isTranslating,
              menuActions,
              messageParts,
              setShowDeleteTooltip,
              showDeleteTooltip,
              softHoverBg,
              t,
              translationItems
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
  executeAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
  isTranslating: boolean
  menuActions: MessageMenuBarResolvedAction[]
  messageParts: MessageMenuBarActionContext['messageParts']
  setShowDeleteTooltip: (open: boolean) => void
  showDeleteTooltip: boolean
  softHoverBg: boolean
  t: (key: string) => string
  translationItems: MessageMenuBarTranslationItem[]
}

const renderToolbarAction = ({
  action,
  actionContext,
  executeAction,
  isTranslating,
  menuActions,
  messageParts,
  setShowDeleteTooltip,
  showDeleteTooltip,
  softHoverBg,
  t,
  translationItems
}: RenderToolbarActionOptions) => {
  switch (getMessageMenuBarToolbarRenderKind(action.id)) {
    case 'model-picker':
      return (
        actionContext.actions.renderRegenerateModelPicker?.({
          message: actionContext.message,
          messageParts,
          trigger: (
            <Tooltip content={action.label} delay={800}>
              <ActionButton className="message-action-button" $softHoverBg={softHoverBg}>
                {action.icon}
              </ActionButton>
            </Tooltip>
          )
        }) ?? null
      )
    case 'translate':
      return renderTranslateAction({
        action,
        executeAction,
        isTranslating,
        softHoverBg,
        t,
        translationItems
      })
    case 'more-menu':
      if (menuActions.length === 0) return null
      return (
        <MessageActionMenuPopover actions={menuActions} align="end" onAction={executeAction}>
          <ActionButton
            className="message-action-button"
            onClick={(e) => e.stopPropagation()}
            $softHoverBg={softHoverBg}>
            {action.icon}
          </ActionButton>
        </MessageActionMenuPopover>
      )
    case 'delete':
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
    case 'button':
      return renderActionButton({
        action,
        executeAction,
        setShowDeleteTooltip,
        softHoverBg
      })
  }
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
  executeAction,
  isTranslating,
  softHoverBg,
  t,
  translationItems
}: {
  action: MessageMenuBarResolvedAction
  executeAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
  isTranslating: boolean
  softHoverBg: boolean
  t: (key: string) => string
  translationItems: MessageMenuBarTranslationItem[]
}) => {
  if (isTranslating) {
    return (
      <Tooltip content={t('translate.stop')}>
        <ActionButton
          className="message-action-button"
          onClick={(e) => {
            e.stopPropagation()
            void executeAction(action)
          }}
          $softHoverBg={softHoverBg}>
          {action.icon}
        </ActionButton>
      </Tooltip>
    )
  }

  if (translationItems.length === 0) return null

  return (
    <Tooltip content={action.label} delay={1200}>
      <TranslateMenuPopover items={translationItems} align="center" contentClassName="max-h-[250px] overflow-y-auto">
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
  items: MessageMenuBarTranslationItem[]
  align?: 'start' | 'center' | 'end'
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <DropdownMenuContent className={classNames('min-w-36', contentClassName)} align={align} side="top">
      {items.map((item) => {
        if (isMessageMenuBarTranslationDivider(item)) {
          return <DropdownMenuSeparator key={item.key} />
        }
        return (
          <DropdownMenuItem
            key={item.key}
            onSelect={(event) => {
              event.stopPropagation()
              void item.onSelect()
            }}>
            <span>{item.label}</span>
          </DropdownMenuItem>
        )
      })}
    </DropdownMenuContent>
  </DropdownMenu>
)

export default memo(MessageMenuBar)
