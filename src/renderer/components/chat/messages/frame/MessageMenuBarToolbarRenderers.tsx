import { ConfirmDialog, Tooltip } from '@cherrystudio/ui'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import { type CommandContextMenuExtraItem, CommandPopupMenu } from '@renderer/components/command'
import type { ReactNode } from 'react'
import { useMemo, useRef, useState } from 'react'
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
    // Only block opening when disabled — never block closing, or a disable that
    // lands while the dialog is open (e.g. streaming starts) would trap it open.
    if (nextOpen && disabled) return
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
  onAction,
  onOpenChange
}: {
  actions: MessageMenuBarResolvedAction[]
  align?: 'start' | 'center' | 'end'
  children: ReactNode
  onAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
  onOpenChange?: (open: boolean) => void
}) => {
  const extraItems = useMemo(
    () =>
      actionsToCommandMenuExtraItems(actions, (action) => {
        void onAction(action)
      }),
    [actions, onAction]
  )

  return (
    <CommandPopupMenu
      location="webcontents.context"
      extraItems={extraItems}
      align={align}
      side="top"
      onOpenChange={onOpenChange}
      contentClassName="[-webkit-app-region:no-drag]">
      {children}
    </CommandPopupMenu>
  )
}

const TranslateMenuPopover = ({
  children,
  items,
  align = 'end',
  onOpenChange
}: {
  children: ReactNode
  items: MessageMenuBarTranslationItem[]
  align?: 'start' | 'center' | 'end'
  onOpenChange?: (open: boolean) => void
}) => {
  const extraItems = useMemo<readonly CommandContextMenuExtraItem[]>(
    () =>
      items.map((item) =>
        isMessageMenuBarTranslationDivider(item)
          ? { type: 'separator' as const }
          : {
              type: 'item' as const,
              id: item.key,
              label: item.label,
              onSelect: () => {
                void item.onSelect()
              }
            }
      ),
    [items]
  )

  return (
    <CommandPopupMenu
      location="webcontents.context"
      extraItems={extraItems}
      align={align}
      side="top"
      onOpenChange={onOpenChange}
      contentClassName="[-webkit-app-region:no-drag]">
      {children}
    </CommandPopupMenu>
  )
}

const useMenuTooltipState = (onOpenChange?: (open: boolean) => void) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isTooltipOpen, setIsTooltipOpen] = useState(false)
  const isMenuOpenRef = useRef(false)
  const suppressTooltipRef = useRef(false)

  const handleMenuOpenChange = (open: boolean) => {
    isMenuOpenRef.current = open
    suppressTooltipRef.current = !open
    setIsMenuOpen(open)
    setIsTooltipOpen(false)
    onOpenChange?.(open)
  }

  const handleTooltipOpenChange = (open: boolean) => {
    setIsTooltipOpen(open && !isMenuOpenRef.current && !suppressTooltipRef.current)
  }

  const releaseTooltipSuppression = () => {
    suppressTooltipRef.current = false
  }

  return {
    tooltipOpen: !isMenuOpen && isTooltipOpen,
    handleMenuOpenChange,
    handleTooltipOpenChange,
    tooltipTriggerProps: {
      onPointerEnter: releaseTooltipSuppression,
      onPointerLeave: releaseTooltipSuppression,
      onBlur: releaseTooltipSuppression
    }
  }
}

export function renderDefaultToolbarAction({ action, executeAction, softHoverBg }: MessageMenuBarToolbarRenderContext) {
  return <ActionButtonWithConfirm action={action} executeAction={executeAction} softHoverBg={softHoverBg} />
}

export function renderModelPickerToolbarAction({
  action,
  actionContext,
  softHoverBg,
  onMenuOpenChange
}: MessageMenuBarToolbarRenderContext) {
  const label = typeof action.label === 'string' ? action.label : undefined

  return (
    <Tooltip content={action.label} delay={800}>
      {actionContext.actions.renderRegenerateModelPicker?.({
        message: actionContext.message,
        messageParts: actionContext.messageParts,
        trigger: (
          <MessageActionButton className="message-action-button" aria-label={label} softHoverBg={softHoverBg}>
            {action.icon}
          </MessageActionButton>
        ),
        onOpenChange: onMenuOpenChange
      }) ?? null}
    </Tooltip>
  )
}

export function renderTranslateToolbarAction({
  action,
  actionContext,
  executeAction,
  softHoverBg,
  translationItems,
  onMenuOpenChange
}: MessageMenuBarToolbarRenderContext) {
  if (actionContext.isTranslating) {
    const label = actionContext.t('translate.stop')
    return (
      <Tooltip content={label}>
        <MessageActionButton
          className="message-action-button"
          aria-label={label}
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
    <TranslateToolbarAction
      action={action}
      translationItems={translationItems}
      softHoverBg={softHoverBg}
      onMenuOpenChange={onMenuOpenChange}
    />
  )
}

const TranslateToolbarAction = ({
  action,
  translationItems,
  softHoverBg,
  onMenuOpenChange
}: {
  action: MessageMenuBarResolvedAction
  translationItems: MessageMenuBarTranslationItem[]
  softHoverBg: boolean
  onMenuOpenChange?: (open: boolean) => void
}) => {
  const { handleMenuOpenChange, handleTooltipOpenChange, tooltipOpen, tooltipTriggerProps } =
    useMenuTooltipState(onMenuOpenChange)
  const label = typeof action.label === 'string' ? action.label : undefined

  return (
    <Tooltip content={action.label} delay={1200} isOpen={tooltipOpen} onOpenChange={handleTooltipOpenChange}>
      <TranslateMenuPopover items={translationItems} align="center" onOpenChange={handleMenuOpenChange}>
        <MessageActionButton
          className="message-action-button"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          softHoverBg={softHoverBg}
          {...tooltipTriggerProps}>
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
  softHoverBg,
  onMenuOpenChange
}: MessageMenuBarToolbarRenderContext) {
  if (menuActions.length === 0) return null

  return (
    <MoreMenuToolbarAction
      action={action}
      executeAction={executeAction}
      menuActions={menuActions}
      softHoverBg={softHoverBg}
      onMenuOpenChange={onMenuOpenChange}
    />
  )
}

const MoreMenuToolbarAction = ({
  action,
  executeAction,
  menuActions,
  softHoverBg,
  onMenuOpenChange
}: {
  action: MessageMenuBarResolvedAction
  executeAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
  menuActions: MessageMenuBarResolvedAction[]
  softHoverBg: boolean
  onMenuOpenChange?: (open: boolean) => void
}) => {
  const { handleMenuOpenChange, handleTooltipOpenChange, tooltipOpen, tooltipTriggerProps } =
    useMenuTooltipState(onMenuOpenChange)
  const label = typeof action.label === 'string' ? action.label : undefined

  return (
    <Tooltip content={action.label} delay={800} isOpen={tooltipOpen} onOpenChange={handleTooltipOpenChange}>
      <MessageActionMenuPopover
        actions={menuActions}
        align="end"
        onAction={executeAction}
        onOpenChange={handleMenuOpenChange}>
        <MessageActionButton
          className="message-action-button"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          softHoverBg={softHoverBg}
          {...tooltipTriggerProps}>
          {action.icon}
        </MessageActionButton>
      </MessageActionMenuPopover>
    </Tooltip>
  )
}

export function renderDeleteToolbarAction({ action, executeAction, softHoverBg }: MessageMenuBarToolbarRenderContext) {
  return <DeleteToolbarAction action={action} executeAction={executeAction} softHoverBg={softHoverBg} />
}
