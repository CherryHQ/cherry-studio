import { Columns2 } from 'lucide-react'
import React from 'react'

import { Button } from '@cherrystudio/ui'

import { UserAvatar } from './primitives'
import { SidebarTooltip } from './Tooltip'
import type { SidebarUser, SidebarVisibleLayout } from './types'

export type SidebarFooterActions =
  | React.ReactNode
  | ((layout: SidebarVisibleLayout, onOverlayOpenChange?: (open: boolean) => void) => React.ReactNode)

export interface SidebarFooterProps {
  layout: SidebarVisibleLayout
  user?: SidebarUser
  actions?: SidebarFooterActions
  userAction?: SidebarFooterActions
  extensionsLabel?: string
  onExtensionsClick?: () => void
  onOverlayOpenChange?: (open: boolean) => void
  renderUserTrigger?: (trigger: React.ReactElement) => React.ReactElement
}

export function SidebarFooter({ layout, actions, userAction, onOverlayOpenChange, ...props }: SidebarFooterProps) {
  const resolvedActions = typeof actions === 'function' ? actions(layout, onOverlayOpenChange) : actions
  const resolvedUserAction = typeof userAction === 'function' ? userAction(layout, onOverlayOpenChange) : userAction

  if (layout === 'icon') return <IconFooter actions={resolvedActions} userAction={resolvedUserAction} {...props} />
  return <FullFooter actions={resolvedActions} userAction={resolvedUserAction} {...props} />
}

type FooterProps = Omit<SidebarFooterProps, 'layout' | 'actions' | 'userAction' | 'onOverlayOpenChange'> & {
  actions?: React.ReactNode
  userAction?: React.ReactNode
}

function IconFooter({ user, userAction, actions, extensionsLabel, onExtensionsClick, renderUserTrigger }: FooterProps) {
  const userButton = user ? (
    <Button
      type="button"
      variant="ghost"
      aria-label={user.name}
      size="icon"
      className="shell-navigation-item rounded-full"
      onClick={user.onClick}>
      <UserAvatar user={user} className="size-6.5" />
    </Button>
  ) : null

  return (
    <div className="flex flex-col items-center gap-1 px-1.5 pt-2 pb-2.5 [-webkit-app-region:no-drag]">
      {extensionsLabel && (
        <SidebarTooltip content={extensionsLabel}>
          <Button
            type="button"
            variant="ghost"
            aria-label={extensionsLabel}
            onClick={onExtensionsClick}
            size="icon"
            className="shell-navigation-item size-9 rounded-full">
            <Columns2 className="size-4.5" strokeWidth={1.6} />
          </Button>
        </SidebarTooltip>
      )}
      {actions}
      {userAction}
      {userButton && user ? (
        <SidebarTooltip content={user.name}>{renderUserTrigger?.(userButton) ?? userButton}</SidebarTooltip>
      ) : null}
    </div>
  )
}

function FullFooter({ user, userAction, actions, extensionsLabel, onExtensionsClick, renderUserTrigger }: FooterProps) {
  const userButton = user ? (
    <Button
      type="button"
      variant="ghost"
      aria-label={user.name}
      className="shell-navigation-item h-9 min-w-0 flex-1 justify-start gap-2 rounded-full py-0 pr-1 pl-2 text-left"
      onClick={user.onClick}>
      <UserAvatar user={user} className="size-6.5 shrink-0" />
      <span className="min-w-0 truncate text-[13px] text-sidebar-foreground">{user.name}</span>
    </Button>
  ) : null

  return (
    <div className="space-y-1 px-2 pt-2 pb-3 [-webkit-app-region:no-drag]">
      {extensionsLabel && (
        <Button
          type="button"
          variant="ghost"
          aria-label={extensionsLabel}
          onClick={onExtensionsClick}
          className="shell-navigation-item flex w-full items-center gap-2.5 rounded-full px-2.5 py-1.75 text-[13px]">
          <Columns2 size={16} strokeWidth={1.6} />
          <span>{extensionsLabel}</span>
        </Button>
      )}

      {actions}

      {userButton ? (
        <div className="flex min-w-0 items-center">
          {renderUserTrigger?.(userButton) ?? userButton}
          <div className="ml-auto flex shrink-0 items-center">{userAction}</div>
        </div>
      ) : (
        userAction
      )}
    </div>
  )
}
