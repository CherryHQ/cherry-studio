import { MenuItem } from '@cherrystudio/ui'

import { ActiveIndicator } from './primitives'
import { SidebarTooltip } from './Tooltip'
import type { SidebarMenuItem, SidebarVisibleLayout } from './types'

export interface SidebarMenuProps {
  layout: SidebarVisibleLayout
  items: SidebarMenuItem[]
  activeItem: string
  onItemClick: (id: string) => void | Promise<void>
}

export function SidebarMenu({ layout, ...props }: SidebarMenuProps) {
  if (layout === 'icon') return <IconMenuItems {...props} />
  return <FullMenuItems {...props} />
}

type MenuItemsProps = Omit<SidebarMenuProps, 'layout'>

function IconMenuItems({ items, activeItem, onItemClick }: MenuItemsProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1.5 [-webkit-app-region:no-drag]">
      {items.map((item) => {
        const isActive = activeItem === item.id
        const Icon = item.icon

        return (
          <SidebarTooltip key={item.id} content={item.label}>
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
          </SidebarTooltip>
        )
      })}
    </div>
  )
}

function FullMenuItems({ items, activeItem, onItemClick }: MenuItemsProps) {
  return (
    <div className="space-y-0.5 px-2 [-webkit-app-region:no-drag]">
      {items.map((item) => {
        const isActive = activeItem === item.id
        const Icon = item.icon

        return (
          <div key={item.id} className="relative">
            <MenuItem
              variant="ghost"
              icon={<Icon size={16} strokeWidth={1.6} />}
              label={item.label}
              active={isActive}
              onClick={() => void onItemClick(item.id)}
              className="rounded-xl data-[active=true]:bg-sidebar-active-bg"
            />
            {isActive && <ActiveIndicator className="rounded-xl" />}
          </div>
        )
      })}
    </div>
  )
}
