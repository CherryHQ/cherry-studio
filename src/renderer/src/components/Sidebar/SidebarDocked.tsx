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
  if (layout === 'vertical-card') return <VerticalCardDockedTabs dockedTabs={dockedTabs} {...props} />
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
                className={`relative flex h-7 w-7 cursor-grab items-center justify-center rounded-full transition-all duration-150 active:cursor-grabbing ${
                  isActive ? 'bg-sidebar-active-bg' : 'hover:bg-accent/50'
                }`}>
                {isActive && <ActiveIndicator className="rounded-full" />}
                <SidebarTabIcon tab={dockedTab} size={14} strokeWidth={1.6} miniAppSize="md" />
              </button>
            </SidebarTooltip>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onCloseDockedTab?.(dockedTab.id)
              }}
              className="-right-1 -top-1 absolute z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/dock:opacity-100">
              <X size={7} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function VerticalCardDockedTabs({
  dockedTabs,
  activeTabId,
  onMiniAppTabClick,
  onStartSidebarDrag,
  onCloseDockedTab
}: DockedTabsProps) {
  return (
    <div className="mt-1 flex flex-col items-center gap-0 border-border/30 border-t px-1 pt-1 [-webkit-app-region:no-drag]">
      {dockedTabs.map((dockedTab) => {
        const isActive = activeTabId === dockedTab.id

        return (
          <div key={dockedTab.id} className="group/dock relative w-full">
            <button
              type="button"
              onClick={() => onMiniAppTabClick?.(dockedTab.id)}
              onMouseDown={(event) => {
                event.stopPropagation()
                onStartSidebarDrag?.(event, dockedTab.id)
              }}
              className={`relative flex w-full cursor-grab flex-col items-center gap-0.5 rounded-md py-1.5 transition-all duration-150 active:cursor-grabbing ${
                isActive ? 'bg-sidebar-active-bg' : 'hover:bg-accent/40'
              }`}>
              {isActive && <ActiveIndicator className="rounded-md" />}
              <SidebarTabIcon tab={dockedTab} size={18} strokeWidth={1.6} miniAppSize="md" />
              <span className="max-w-[50px] truncate text-[8px] text-muted-foreground leading-tight">
                {dockedTab.title}
              </span>
            </button>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onCloseDockedTab?.(dockedTab.id)
              }}
              className="absolute top-0.5 right-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/dock:opacity-100">
              <X size={7} />
            </button>
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
  return (
    <div className="mt-1 space-y-0.5 border-border/30 border-t px-2 pt-1 [-webkit-app-region:no-drag]">
      {dockedTabs.map((dockedTab) => {
        const isActive = activeTabId === dockedTab.id

        return (
          <div
            key={dockedTab.id}
            className={`group/dock relative flex cursor-grab items-center gap-2.5 rounded-xl px-2.5 py-[6px] text-[12px] transition-all duration-150 active:cursor-grabbing ${
              isActive
                ? 'bg-sidebar-active-bg text-foreground'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
            }`}
            onClick={() => onMiniAppTabClick?.(dockedTab.id)}
            onMouseDown={(event) => {
              event.stopPropagation()
              onStartSidebarDrag?.(event, dockedTab.id)
            }}>
            {isActive && <ActiveIndicator className="rounded-xl" glow />}
            <SidebarTabIcon tab={dockedTab} size={14} strokeWidth={1.6} className="flex-shrink-0" />
            <span className="flex-1 truncate">{dockedTab.title}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onCloseDockedTab?.(dockedTab.id)
              }}
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-foreground/10 group-hover/dock:opacity-100">
              <X size={9} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
