import { ChevronRight, Columns2 } from 'lucide-react'
import React from 'react'

import { UserAvatar } from './primitives'
import { SidebarTooltip } from './Tooltip'
import type { SidebarUser, SidebarVisibleLayout } from './types'

export interface SidebarFooterProps {
  layout: SidebarVisibleLayout
  user?: SidebarUser
  actions?: React.ReactNode
  extensionsLabel?: string
  onExtensionsClick?: () => void
}

export function SidebarFooter({ layout, ...props }: SidebarFooterProps) {
  if (layout === 'icon') return <IconFooter {...props} />
  if (layout === 'vertical-card') return <VerticalCardFooter {...props} />
  return <FullFooter {...props} />
}

type FooterProps = Omit<SidebarFooterProps, 'layout'>

function IconFooter({ user, actions, extensionsLabel, onExtensionsClick }: FooterProps) {
  return (
    <div className="flex flex-col items-center gap-1 px-1.5 pt-2 pb-5 [-webkit-app-region:no-drag]">
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

function VerticalCardFooter({ user, actions, extensionsLabel, onExtensionsClick }: FooterProps) {
  return (
    <div className="flex flex-col items-center gap-0 px-1 pt-1 pb-5 [-webkit-app-region:no-drag]">
      {extensionsLabel && (
        <button
          type="button"
          onClick={onExtensionsClick}
          className="flex w-full flex-col items-center gap-0.5 rounded-lg py-2 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
          <Columns2 size={18} strokeWidth={1.6} />
          <span className="text-[9px] leading-tight">{extensionsLabel}</span>
        </button>
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
