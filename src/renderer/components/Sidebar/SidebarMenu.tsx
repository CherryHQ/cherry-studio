import { MenuItem } from '@cherrystudio/ui'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { cn } from '@renderer/utils/style'

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

function FullMenuItems({ items, activeItem, activeTabId, onItemClick, onMiniAppTabClick }: MenuItemsProps) {
  const isMacTransparentWindow = useMacTransparentWindow()
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
                className={cn(
                  'gap-2.5 py-1 text-foreground/80 hover:text-foreground data-[active=true]:text-foreground [&_svg]:text-current',
                  // On glass, the opaque --cs-selected fill washes out and the default hover:bg-accent
                  // diverges from the tab bar. Mirror AppShellTabBar's transparent-mode active AND
                  // hover recipes EXACTLY (same glass-surface/hover/border tokens, backdrop-blur, and
                  // dark border/shadow) so the sidebar and top selected/hover states match. The
                  // glass-hover override beats the shared MenuItem variant's hover:bg-accent via
                  // tailwind-merge. Non-transparent mode keeps bg-accent (already matches the tab bar).
                  isMacTransparentWindow
                    ? 'hover:bg-[var(--color-tabbar-glass-hover)] data-[active=true]:border-[var(--color-tabbar-glass-border)] data-[active=true]:bg-[var(--color-tabbar-glass-surface)] data-[active=true]:backdrop-blur-sm dark:data-[active=true]:border-0 dark:data-[active=true]:shadow-[inset_0_0_0_1px_var(--color-tabbar-glass-shadow)]'
                    : 'data-[active=true]:bg-selected data-[active=true]:shadow-(--shadow-selected-outline)'
                )}
              />
            </div>

            {miniTabs.map((miniTab) => (
              <button
                type="button"
                key={miniTab.id}
                onClick={() => onMiniAppTabClick?.(miniTab.id)}
                className={`text-(length:--font-size-body-xs) relative flex w-full items-center gap-2 rounded-lg py-[5px] pr-2.5 pl-7 transition-all duration-150 ${
                  activeTabId === miniTab.id
                    ? 'bg-sidebar-active-bg text-foreground'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                }`}>
                {activeTabId === miniTab.id && <ActiveIndicator className="rounded-lg" glow />}
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
