import { MenuItem } from '@cherrystudio/ui'

import { MiniAppIcon } from './primitives'
import { SidebarTooltip } from './Tooltip'
import type { SidebarMenuItem, SidebarVisibleLayout } from './types'

export interface SidebarMenuProps {
  layout: SidebarVisibleLayout
  items: SidebarMenuItem[]
  activeItem: string
  activeTabId?: string
  onItemClick: (id: string) => void | Promise<void>
  onMiniAppTabClick?: (tabId: string) => void
}

export function SidebarMenu({ layout, ...props }: SidebarMenuProps) {
  if (layout === 'icon') return <IconMenuItems {...props} />
  return <FullMenuItems {...props} />
}

type MenuItemsProps = Omit<SidebarMenuProps, 'layout'>

function IconMenuItems({ items, activeItem, activeTabId, onItemClick, onMiniAppTabClick }: MenuItemsProps) {
  return (
    <div className="flex flex-col items-center gap-1 px-1.5 [-webkit-app-region:no-drag]">
      {items.map((item) => {
        const isActive = activeItem === item.id
        const Icon = item.icon
        const miniTabs = item.miniAppTabs ?? []

        return (
          <div key={item.id} className="contents">
            <SidebarTooltip content={item.label}>
              <button
                type="button"
                onClick={() => void onItemClick(item.id)}
                className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150 [&_svg]:text-current ${
                  isActive ? 'bg-accent text-foreground' : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground'
                }`}>
                <Icon size={16} strokeWidth={1.6} />
              </button>
            </SidebarTooltip>

            {miniTabs.map((miniTab) => (
              <SidebarTooltip key={miniTab.id} content={miniTab.title}>
                <button
                  type="button"
                  onClick={() => onMiniAppTabClick?.(miniTab.id)}
                  className={`relative flex h-7 w-7 items-center justify-center rounded-full transition-all duration-150 ${
                    activeTabId === miniTab.id ? 'bg-accent' : 'hover:bg-accent/50'
                  }`}>
                  <MiniAppIcon tab={miniTab} size="md" />
                </button>
              </SidebarTooltip>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function FullMenuItems({ items, activeItem, activeTabId, onItemClick, onMiniAppTabClick }: MenuItemsProps) {
  return (
    <div className="space-y-0.5 px-2 [-webkit-app-region:no-drag]">
      {items.map((item) => {
        const isActive = activeItem === item.id
        const Icon = item.icon
        const miniTabs = item.miniAppTabs ?? []

        return (
          <div key={item.id}>
            <div className="relative">
              <MenuItem
                variant="ghost"
                icon={<Icon size={16} strokeWidth={1.6} />}
                label={item.label}
                active={isActive}
                onClick={() => void onItemClick(item.id)}
                className="gap-2.5 py-1 text-foreground/80 hover:text-foreground data-[active=true]:bg-selected data-[active=true]:text-foreground data-[active=true]:shadow-[inset_0_0_0_0.5px_var(--color-selected-border)] [&_svg]:text-current"
              />
            </div>

            {miniTabs.map((miniTab) => (
              <button
                type="button"
                key={miniTab.id}
                onClick={() => onMiniAppTabClick?.(miniTab.id)}
                className={`relative flex w-full items-center gap-2 rounded-lg py-[5px] pr-2.5 pl-7 text-[12px] transition-all duration-150 ${
                  activeTabId === miniTab.id
                    ? 'bg-selected text-foreground shadow-[inset_0_0_0_0.5px_var(--color-selected-border)]'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                }`}>
                <MiniAppIcon tab={miniTab} />
                <span className="truncate">{miniTab.title}</span>
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}
