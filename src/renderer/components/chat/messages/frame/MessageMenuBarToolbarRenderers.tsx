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
import type { ReactNode } from 'react'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MessageActionButton } from './MessageActionButton'
import type {
  MessageMenuBarResolvedAction,
  MessageMenuBarToolbarRenderContext,
  MessageMenuBarTranslationItem
} from './messageMenuBarActions'

const isMessageMenuBarTranslationDivider = (
  item: MessageMenuBarTranslationItem
): item is Extract<MessageMenuBarTranslationItem, { type: 'divider' }> => 'type' in item && item.type === 'divider'

const ConfirmActionButton = ({
  children,
  destructive,
  title,
  confirmText,
  disabled,
  onConfirm,
  onOpenChange
}: {
  children: (open: () => void) => ReactNode
  destructive?: boolean
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
      {children(() => handleOpenChange(true))}
      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={title}
        confirmText={confirmText ?? t('common.confirm')}
        cancelText={t('common.cancel')}
        destructive={destructive}
        onConfirm={onConfirm}
      />
    </>
  )
}

const ActionButtonWithConfirm = ({
  action,
  executeAction,
  icon = action.icon,
  onConfirmOpen,
  softHoverBg,
  tooltip = action.label
}: {
  action: MessageMenuBarResolvedAction
  executeAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
  icon?: ReactNode
  onConfirmOpen?: () => void
  softHoverBg: boolean
  tooltip?: ReactNode | false
}) => {
  const disabled = !action.availability.enabled
  const button = (
    <MessageActionButton
      className="message-action-button"
      onClick={(e) => {
        e.stopPropagation()
        if (!action.confirm) {
          void executeAction(action)
        }
      }}
      disabled={disabled}
      softHoverBg={softHoverBg}>
      {icon}
    </MessageActionButton>
  )

  const content = action.confirm ? (
    <ConfirmActionButton
      title={action.confirm.title}
      destructive={action.confirm.destructive}
      confirmText={action.confirm.confirmText}
      onConfirm={() => executeAction(action)}
      onOpenChange={(open) => open && onConfirmOpen?.()}
      disabled={disabled}>
      {(open) => (
        <MessageActionButton
          className="message-action-button"
          onClick={(e) => {
            e.stopPropagation()
            open()
          }}
          disabled={disabled}
          softHoverBg={softHoverBg}>
          {icon}
        </MessageActionButton>
      )}
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

const DeleteToolbarAction = ({
  action,
  executeAction,
  softHoverBg
}: {
  action: MessageMenuBarResolvedAction
  executeAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
  softHoverBg: boolean
}) => {
  const [showDeleteTooltip, setShowDeleteTooltip] = useState(false)

  return (
    <ActionButtonWithConfirm
      action={action}
      executeAction={executeAction}
      icon={
        <Tooltip content={action.label} delay={1000} isOpen={showDeleteTooltip} onOpenChange={setShowDeleteTooltip}>
          {action.icon}
        </Tooltip>
      }
      onConfirmOpen={() => setShowDeleteTooltip(false)}
      softHoverBg={softHoverBg}
      tooltip={false}
    />
  )
}

const MessageActionMenuPopover = ({
  actions,
  align = 'end',
  children,
  onAction
}: {
  actions: MessageMenuBarResolvedAction[]
  align?: 'start' | 'center' | 'end'
  children: ReactNode
  onAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <DropdownMenuContent align={align} side="top">
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
        <DropdownMenuSubContent>
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
  items,
  align = 'end'
}: {
  children: ReactNode
  items: MessageMenuBarTranslationItem[]
  align?: 'start' | 'center' | 'end'
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <DropdownMenuContent align={align} side="top">
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

export function renderDefaultToolbarAction({ action, executeAction, softHoverBg }: MessageMenuBarToolbarRenderContext) {
  return <ActionButtonWithConfirm action={action} executeAction={executeAction} softHoverBg={softHoverBg} />
}

export function renderModelPickerToolbarAction({
  action,
  actionContext,
  softHoverBg
}: MessageMenuBarToolbarRenderContext) {
  const label = typeof action.label === 'string' ? action.label : undefined

  return (
    actionContext.actions.renderRegenerateModelPicker?.({
      message: actionContext.message,
      messageParts: actionContext.messageParts,
      trigger: (
        <MessageActionButton
          className="message-action-button"
          aria-label={label}
          title={label}
          softHoverBg={softHoverBg}>
          {action.icon}
        </MessageActionButton>
      )
    }) ?? null
  )
}

export function renderTranslateToolbarAction({
  action,
  actionContext,
  executeAction,
  softHoverBg,
  translationItems
}: MessageMenuBarToolbarRenderContext) {
  if (actionContext.isTranslating) {
    return (
      <Tooltip content={actionContext.t('translate.stop')}>
        <MessageActionButton
          className="message-action-button"
          onClick={(e) => {
            e.stopPropagation()
            void executeAction(action)
          }}
          softHoverBg={softHoverBg}>
          {action.icon}
        </MessageActionButton>
      </Tooltip>
    )
  }

  if (translationItems.length === 0) return null

  return (
    <Tooltip content={action.label} delay={1200}>
      <TranslateMenuPopover items={translationItems} align="center">
        <MessageActionButton
          className="message-action-button"
          onClick={(e) => e.stopPropagation()}
          softHoverBg={softHoverBg}>
          {action.icon}
        </MessageActionButton>
      </TranslateMenuPopover>
    </Tooltip>
  )
}

export function renderMoreMenuToolbarAction({
  action,
  executeAction,
  menuActions,
  softHoverBg
}: MessageMenuBarToolbarRenderContext) {
  if (menuActions.length === 0) return null

  return (
    <MessageActionMenuPopover actions={menuActions} align="end" onAction={executeAction}>
      <MessageActionButton
        className="message-action-button"
        onClick={(e) => e.stopPropagation()}
        softHoverBg={softHoverBg}>
        {action.icon}
      </MessageActionButton>
    </MessageActionMenuPopover>
  )
}

export function renderDeleteToolbarAction({ action, executeAction, softHoverBg }: MessageMenuBarToolbarRenderContext) {
  return <DeleteToolbarAction action={action} executeAction={executeAction} softHoverBg={softHoverBg} />
}
