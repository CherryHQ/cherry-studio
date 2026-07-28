import { ChevronRight, Columns2 } from 'lucide-react'
import React from 'react'

import { UserAvatar } from './primitives'
import { SidebarTooltip } from './Tooltip'
import type { SidebarUser, SidebarVisibleLayout } from './types'

export type SidebarFooterActions = React.ReactNode | ((layout: SidebarVisibleLayout) => React.ReactNode)

export interface SidebarFooterProps {
  layout: SidebarVisibleLayout
  user?: SidebarUser
  actions?: SidebarFooterActions
  extensionsLabel?: string
  onExtensionsClick?: () => void
}

export function SidebarFooter({ layout, actions, ...props }: SidebarFooterProps) {
  const resolvedActions = typeof actions === 'function' ? actions(layout) : actions

  if (layout === 'icon') return <IconFooter actions={resolvedActions} {...props} />
  return <FullFooter actions={resolvedActions} {...props} />
}

type FooterProps = Omit<SidebarFooterProps, 'layout' | 'actions'> & {
  actions?: React.ReactNode
}

function IconFooter({ user, actions, extensionsLabel, onExtensionsClick }: FooterProps) {
  return (
    <div className="flex flex-col items-center gap-1 px-1.5 pt-2 pb-3 [-webkit-app-region:no-drag]">
      {extensionsLabel && (
        <SidebarTooltip content={extensionsLabel}>
          <button
            type="button"
            onClick={onExtensionsClick}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
            <Columns2 size={18} strokeWidth={1.6} />
          </button>
        </SidebarTooltip>
      )}
      {actions}
      {user && (
        <div className="cursor-pointer" onClick={user.onClick}>
          <UserAvatar user={user} className="h-7 w-7" />
        </div>
      )}
    </div>
  )
}

function FullFooter({ user, actions, extensionsLabel, onExtensionsClick }: FooterProps) {
  return (
    <div className="space-y-1 px-2 py-2 [-webkit-app-region:no-drag]">
      {extensionsLabel && (
        <button
          type="button"
          onClick={onExtensionsClick}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.75 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
          <Columns2 size={16} strokeWidth={1.6} />
          <span>{extensionsLabel}</span>
        </button>
      )}

      {actions}

      {user && (
        <div
          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-accent/60"
          onClick={user.onClick}>
          <UserAvatar user={user} className="h-7 w-7 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] text-sidebar-foreground">{user.name}</div>
          </div>
          <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
        </div>
      )}
    </div>
  )
}
