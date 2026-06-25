import { MenuItem } from '@cherrystudio/ui'
import { X } from 'lucide-react'
import React from 'react'

import { ActiveIndicator, SidebarTabIcon } from './primitives'
import { SidebarTooltip } from './Tooltip'
import type { SidebarTab, SidebarVisibleLayout } from './types'

export interface SidebarDockedProps {
  layout: SidebarVisibleLayout
  dockedTabs: SidebarTab[]
  activeTabId?: string
  onMiniAppTabClick?: (tabId: string) => void
  onStartSidebarDrag?: (e: React.MouseEvent, tabId: string) => void
  onCloseDockedTab?: (tabId: string) => void
}

export function SidebarDocked({ layout, dockedTabs, ...props }: SidebarDockedProps) {
  if (dockedTabs.length === 0) return null

  if (layout === 'icon') return <IconDockedTabs dockedTabs={dockedTabs} {...props} />
  return <FullDockedTabs dockedTabs={dockedTabs} {...props} />
}

type DockedTabsProps = Omit<SidebarDockedProps, 'layout'>

function IconDockedTabs({
  dockedTabs,
  activeTabId,
  onMiniAppTabClick,
  onStartSidebarDrag,
  onCloseDockedTab
}: DockedTabsProps) {
  const isDraggable = Boolean(onStartSidebarDrag)

  return (
    <div className="mt-1 flex flex-col items-center gap-0.5 border-border/30 border-t px-1.5 pt-1 [-webkit-app-region:no-drag]">
      {dockedTabs.map((dockedTab) => {
        const isActive = activeTabId === dockedTab.id

        return (
          <div key={dockedTab.id} className="group/dock relative">
            <SidebarTooltip content={dockedTab.title}>
              <button
                type="button"
                onClick={() => onMiniAppTabClick?.(dockedTab.id)}
                onMouseDown={(event) => {
                  event.stopPropagation()
                  onStartSidebarDrag?.(event, dockedTab.id)
                }}
                className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 ${
                  isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
                } ${
                  isActive
                    ? 'bg-sidebar-active-bg text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}>
                {isActive && <ActiveIndicator className="rounded-full" />}
                <SidebarTabIcon tab={dockedTab} size={18} strokeWidth={1.6} miniAppSize="lg" />
              </button>
            </SidebarTooltip>

            {onCloseDockedTab && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onCloseDockedTab(dockedTab.id)
                }}
                className="-right-1 -top-1 absolute z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/dock:opacity-100">
                <X size={7} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FullDockedTabs({
  dockedTabs,
  activeTabId,
  onMiniAppTabClick,
  onStartSidebarDrag,
  onCloseDockedTab
}: DockedTabsProps) {
  const isDraggable = Boolean(onStartSidebarDrag)

  return (
    <div className="mt-1 space-y-0.5 border-border/30 border-t px-2 pt-1 [-webkit-app-region:no-drag]">
      {dockedTabs.map((dockedTab) => {
        const isActive = activeTabId === dockedTab.id

        return (
          <div key={dockedTab.id} className="group/dock relative">
            <MenuItem
              variant="ghost"
              icon={<SidebarTabIcon tab={dockedTab} size={16} strokeWidth={1.6} miniAppSize="md" />}
              label={dockedTab.title}
              active={isActive}
              onClick={() => onMiniAppTabClick?.(dockedTab.id)}
              onMouseDown={(event) => {
                event.stopPropagation()
                onStartSidebarDrag?.(event, dockedTab.id)
              }}
              className={
                isDraggable
                  ? 'cursor-grab rounded-xl active:cursor-grabbing data-[active=true]:bg-sidebar-active-bg'
                  : 'rounded-xl data-[active=true]:bg-sidebar-active-bg'
              }
            />
            {isActive && <ActiveIndicator className="rounded-xl" />}
            {onCloseDockedTab && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onCloseDockedTab(dockedTab.id)
                }}
                className="-translate-y-1/2 absolute top-1/2 right-2 flex h-4 w-4 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-foreground/10 group-hover/dock:opacity-100">
                <X size={9} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
