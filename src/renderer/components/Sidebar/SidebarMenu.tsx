import { MenuItem } from '@cherrystudio/ui'
import { CommandContextMenu } from '@renderer/components/command'
import type { ReactNode } from 'react'

import { ActiveIndicator } from './primitives'
import { SidebarTooltip } from './Tooltip'
import type { SidebarMenuItem, SidebarVisibleLayout } from './types'

export interface SidebarMenuProps {
  layout: SidebarVisibleLayout
  items: SidebarMenuItem[]
  activeItem: string
  onItemClick: (id: string) => void | Promise<void>
  onContextMenuOpenChange?: (open: boolean) => void
}

export function SidebarMenu({ layout, ...props }: SidebarMenuProps) {
  if (layout === 'icon') return <IconMenuItems {...props} />
  return <FullMenuItems {...props} />
}

type MenuItemsProps = Omit<SidebarMenuProps, 'layout'>

function SidebarItemContextMenu({
  children,
  items,
  onOpenChange
}: {
  children: ReactNode
  items?: SidebarMenuItem['contextMenuItems']
  onOpenChange?: (open: boolean) => void
}) {
  if (!items?.length) return <>{children}</>

  return (
    <CommandContextMenu location="webcontents.context" extraItems={items} onOpenChange={onOpenChange}>
      {children}
    </CommandContextMenu>
  )
}

function IconMenuItems({ items, activeItem, onItemClick, onContextMenuOpenChange }: MenuItemsProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1.5 [-webkit-app-region:no-drag]">
      {items.map((item) => {
        const isActive = activeItem === item.id
        const Icon = item.icon

        return (
          <SidebarTooltip key={item.id} content={item.label}>
            <SidebarItemContextMenu items={item.contextMenuItems} onOpenChange={onContextMenuOpenChange}>
              <button
                type="button"
                onClick={() => void onItemClick(item.id)}
                className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 ${
                  isActive
                    ? 'bg-sidebar-active-bg text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}>
                {isActive && <ActiveIndicator className="rounded-full" />}
                <Icon size={18} strokeWidth={1.6} />
              </button>
            </SidebarItemContextMenu>
          </SidebarTooltip>
        )
      })}
    </div>
  )
}

function FullMenuItems({ items, activeItem, onItemClick, onContextMenuOpenChange }: MenuItemsProps) {
  return (
    <div className="space-y-0.5 px-2 [-webkit-app-region:no-drag]">
      {items.map((item) => {
        const isActive = activeItem === item.id
        const Icon = item.icon

        return (
          <div key={item.id} className="relative">
            <SidebarItemContextMenu items={item.contextMenuItems} onOpenChange={onContextMenuOpenChange}>
              <MenuItem
                variant="ghost"
                icon={<Icon size={16} strokeWidth={1.6} />}
                label={item.label}
                active={isActive}
                onClick={() => void onItemClick(item.id)}
                className="rounded-xl data-[active=true]:bg-sidebar-active-bg"
              />
            </SidebarItemContextMenu>
            {isActive && <ActiveIndicator className="rounded-xl" />}
          </div>
        )
      })}
    </div>
  )
}
