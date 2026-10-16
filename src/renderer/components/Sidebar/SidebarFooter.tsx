import { Columns2 } from 'lucide-react'
import React from 'react'

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
    <button
      type="button"
      aria-label={user.name}
      className="flex size-9 items-center justify-center rounded-none bg-transparent transition-colors hover:bg-transparent hover:opacity-80 active:bg-transparent"
      onClick={user.onClick}>
      <UserAvatar user={user} className="size-6" />
    </button>
  ) : null

  return (
    <div className="flex flex-col items-center gap-1 px-1.5 pt-2 pb-3 [-webkit-app-region:no-drag]">
      {extensionsLabel && (
        <SidebarTooltip content={extensionsLabel}>
          <button
            type="button"
            onClick={onExtensionsClick}
            className="flex h-9 w-9 items-center justify-center bg-transparent text-muted-foreground opacity-55 transition-opacity hover:bg-transparent hover:text-foreground hover:opacity-100">
            <Columns2 size={18} strokeWidth={1.6} />
          </button>
        </SidebarTooltip>
      )}
      {actions}
      {userAction}
      {userButton ? (renderUserTrigger?.(userButton) ?? userButton) : null}
    </div>
  )
}

function FullFooter({ user, userAction, actions, extensionsLabel, onExtensionsClick, renderUserTrigger }: FooterProps) {
  const userButton = user ? (
    <button
      type="button"
      aria-label={user.name}
      className="flex min-w-0 flex-1 items-center gap-2 rounded-none py-1.5 pr-1 pl-2 text-left transition-colors hover:bg-transparent hover:opacity-80 active:bg-transparent"
      onClick={user.onClick}>
      <UserAvatar user={user} className="size-6 shrink-0" />
      <span className="min-w-0 truncate text-[13px] text-sidebar-foreground">{user.name}</span>
    </button>
  ) : null

  return (
    <div className="space-y-1 py-2 pr-1 pl-2 [-webkit-app-region:no-drag]">
      {extensionsLabel && (
        <button
          type="button"
          onClick={onExtensionsClick}
          className="flex w-full items-center gap-2.5 px-2.5 py-1.75 text-[13px] text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground">
          <Columns2 size={16} strokeWidth={1.6} />
          <span>{extensionsLabel}</span>
        </button>
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
