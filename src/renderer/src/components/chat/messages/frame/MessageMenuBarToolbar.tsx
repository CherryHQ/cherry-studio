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
import { classNames } from '@renderer/utils'
import type { ComponentProps, ReactNode } from 'react'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  isMessageMenuBarTranslationDivider,
  type MessageMenuBarActionContext,
  type MessageMenuBarResolvedAction,
  type MessageMenuBarResolvedToolbarAction,
  type MessageMenuBarTranslationItem
} from './messageMenuBarActions'

interface MessageMenuBarToolbarActionProps {
  action: MessageMenuBarResolvedToolbarAction
  actionContext: MessageMenuBarActionContext
  executeAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
  menuActions: MessageMenuBarResolvedAction[]
  messageParts: MessageMenuBarActionContext['messageParts']
  softHoverBg: boolean
  translationItems: MessageMenuBarTranslationItem[]
}

export function MessageMenuBarToolbarAction({
  action,
  actionContext,
  executeAction,
  menuActions,
  messageParts,
  softHoverBg,
  translationItems
}: MessageMenuBarToolbarActionProps) {
  switch (action.toolbarRenderKind) {
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
      return (
        <TranslateToolbarAction
          action={action}
          actionContext={actionContext}
          executeAction={executeAction}
          softHoverBg={softHoverBg}
          translationItems={translationItems}
        />
      )
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
      return <DeleteToolbarAction action={action} executeAction={executeAction} softHoverBg={softHoverBg} />
    case 'button':
      return <ActionButtonWithConfirm action={action} executeAction={executeAction} softHoverBg={softHoverBg} />
  }
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
      onOpenChange={(open) => open && onConfirmOpen?.()}
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

const TranslateToolbarAction = ({
  action,
  actionContext,
  executeAction,
  softHoverBg,
  translationItems
}: {
  action: MessageMenuBarResolvedAction
  actionContext: MessageMenuBarActionContext
  executeAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
  softHoverBg: boolean
  translationItems: MessageMenuBarTranslationItem[]
}) => {
  if (actionContext.isTranslating) {
    return (
      <Tooltip content={actionContext.t('translate.stop')}>
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
