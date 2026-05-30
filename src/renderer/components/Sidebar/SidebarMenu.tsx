import { MenuItem } from '@cherrystudio/ui'

import { ActiveIndicator, MiniAppIcon } from './primitives'
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
  if (layout === 'vertical-card') return <VerticalCardMenuItems {...props} />
  return <FullMenuItems {...props} />
}

type MenuItemsProps = Omit<SidebarMenuProps, 'layout'>

function IconMenuItems({ items, activeItem, activeTabId, onItemClick, onMiniAppTabClick }: MenuItemsProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1.5 [-webkit-app-region:no-drag]">
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
                className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 ${
                  isActive
                    ? 'bg-sidebar-active-bg text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}>
                {isActive && <ActiveIndicator className="rounded-full" />}
                <Icon size={18} strokeWidth={1.6} />
              </button>
            </SidebarTooltip>

            {miniTabs.map((miniTab) => (
              <SidebarTooltip key={miniTab.id} content={miniTab.title}>
                <button
                  type="button"
                  onClick={() => onMiniAppTabClick?.(miniTab.id)}
                  className={`relative flex h-7 w-7 items-center justify-center rounded-full transition-all duration-150 ${
                    activeTabId === miniTab.id ? 'bg-sidebar-active-bg' : 'hover:bg-accent/50'
                  }`}>
                  {activeTabId === miniTab.id && <ActiveIndicator className="rounded-full" />}
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

function VerticalCardMenuItems({ items, activeItem, activeTabId, onItemClick, onMiniAppTabClick }: MenuItemsProps) {
  return (
    <div className="flex flex-col items-center gap-1 px-1.5 [-webkit-app-region:no-drag]">
      {items.map((item) => {
        const isActive = activeItem === item.id
        const Icon = item.icon
        const miniTabs = item.miniAppTabs ?? []

        return (
          <div key={item.id} className="flex w-full flex-col gap-1">
            <button
              type="button"
              onClick={() => void onItemClick(item.id)}
              className={`relative flex w-full flex-col items-center gap-0.5 rounded-lg py-2.5 transition-all duration-150 ${
                isActive
                  ? 'bg-sidebar-active-bg text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}>
              {isActive && <ActiveIndicator className="rounded-lg" />}
              <Icon size={18} strokeWidth={1.6} />
              <span className="text-[9px] leading-tight">{item.label}</span>
            </button>

            {miniTabs.map((miniTab) => (
              <button
                type="button"
                key={miniTab.id}
                onClick={() => onMiniAppTabClick?.(miniTab.id)}
                className={`relative flex w-full flex-col items-center gap-0.5 rounded-lg py-2 transition-all duration-150 ${
                  activeTabId === miniTab.id
                    ? 'bg-sidebar-active-bg text-foreground'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                }`}>
                {activeTabId === miniTab.id && <ActiveIndicator className="rounded-lg" />}
                <MiniAppIcon tab={miniTab} size="md" />
                <span className="max-w-[50px] truncate text-[8px] leading-tight">{miniTab.title}</span>
              </button>
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
                className="rounded-xl data-[active=true]:bg-sidebar-active-bg"
              />
              {isActive && <ActiveIndicator className="rounded-xl" />}
            </div>

            {miniTabs.map((miniTab) => (
              <button
                type="button"
                key={miniTab.id}
                onClick={() => onMiniAppTabClick?.(miniTab.id)}
                className={`relative flex w-full items-center gap-2 rounded-xl py-[5px] pr-2.5 pl-7 text-[12px] transition-all duration-150 ${
                  activeTabId === miniTab.id
                    ? 'bg-sidebar-active-bg text-foreground'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                }`}>
                {activeTabId === miniTab.id && <ActiveIndicator className="rounded-xl" glow />}
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
