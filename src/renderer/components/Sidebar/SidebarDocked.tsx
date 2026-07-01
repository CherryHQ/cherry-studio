import { MenuItem } from '@cherrystudio/ui'
import { CommandContextMenu } from '@renderer/components/command'
import type { ReactNode } from 'react'

import { ActiveIndicator, SidebarTabIcon } from './primitives'
import { SidebarTooltip } from './Tooltip'
import type { SidebarTab, SidebarVisibleLayout } from './types'

export interface SidebarDockedProps {
  layout: SidebarVisibleLayout
  dockedTabs: SidebarTab[]
  activeTabId?: string
  onMiniAppTabClick?: (tabId: string) => void
  onContextMenuOpenChange?: (open: boolean) => void
}

export function SidebarDocked({ layout, dockedTabs, ...props }: SidebarDockedProps) {
  if (dockedTabs.length === 0) return null

  if (layout === 'icon') return <IconDockedTabs dockedTabs={dockedTabs} {...props} />
  return <FullDockedTabs dockedTabs={dockedTabs} {...props} />
}

type DockedTabsProps = Omit<SidebarDockedProps, 'layout'>

function DockedContextMenu({
  children,
  items,
  onOpenChange
}: {
  children: ReactNode
  items?: SidebarTab['contextMenuItems']
  onOpenChange?: (open: boolean) => void
}) {
  if (!items?.length) return <>{children}</>

  return (
    <CommandContextMenu location="webcontents.context" extraItems={items} onOpenChange={onOpenChange}>
      {children}
    </CommandContextMenu>
  )
}

function DockedDivider({ layout }: { layout: SidebarVisibleLayout }) {
  const layoutClass = layout === 'icon' ? 'mx-auto w-3/5 max-w-12' : 'mx-2.5'

  return <div aria-hidden="true" className={`sidebar-docked-divider my-1.5 h-px bg-border-subtle ${layoutClass}`} />
}

function IconDockedTabs({ dockedTabs, activeTabId, onMiniAppTabClick, onContextMenuOpenChange }: DockedTabsProps) {
  return (
    <div className="mt-1 flex flex-col items-center gap-0.5 px-1.5 [-webkit-app-region:no-drag]">
      <DockedDivider layout="icon" />
      {dockedTabs.map((dockedTab) => {
        const isActive = activeTabId === dockedTab.id

        return (
          <SidebarTooltip key={dockedTab.id} content={dockedTab.title}>
            <DockedContextMenu items={dockedTab.contextMenuItems} onOpenChange={onContextMenuOpenChange}>
              <button
                type="button"
                aria-label={dockedTab.title}
                onClick={() => onMiniAppTabClick?.(dockedTab.id)}
                className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 ${
                  isActive
                    ? 'bg-sidebar-active-bg text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}>
                {isActive && <ActiveIndicator className="rounded-full" />}
                <SidebarTabIcon tab={dockedTab} size={18} strokeWidth={1.6} miniAppSize="lg" />
              </button>
            </DockedContextMenu>
          </SidebarTooltip>
        )
      })}
    </div>
  )
}

function FullDockedTabs({ dockedTabs, activeTabId, onMiniAppTabClick, onContextMenuOpenChange }: DockedTabsProps) {
  return (
    <div className="mt-1 space-y-0.5 px-2 [-webkit-app-region:no-drag]">
      <DockedDivider layout="full" />
      {dockedTabs.map((dockedTab) => {
        const isActive = activeTabId === dockedTab.id

        return (
          <div key={dockedTab.id} className="relative">
            <DockedContextMenu items={dockedTab.contextMenuItems} onOpenChange={onContextMenuOpenChange}>
              <MenuItem
                variant="ghost"
                icon={<SidebarTabIcon tab={dockedTab} size={16} strokeWidth={1.6} miniAppSize="md" />}
                label={dockedTab.title}
                active={isActive}
                onClick={() => onMiniAppTabClick?.(dockedTab.id)}
                className="rounded-xl data-[active=true]:bg-sidebar-active-bg"
              />
            </DockedContextMenu>
            {isActive && <ActiveIndicator className="rounded-xl" />}
          </div>
        )
      })}
    </div>
  )
}
