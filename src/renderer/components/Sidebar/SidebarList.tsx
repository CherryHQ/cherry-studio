import { MenuItem } from '@cherrystudio/ui'
import { CommandContextMenu } from '@renderer/components/command'
import type { ReactNode } from 'react'

import { ActiveIndicator } from './primitives'
import type { SidebarClickGuard } from './SidebarSortableList'
import { SidebarSortableList } from './SidebarSortableList'
import { SidebarTooltip } from './Tooltip'
import type { ResolvedSidebarEntry, SidebarActiveState, SidebarIconPresentation, SidebarVisibleLayout } from './types'

const FULL_ICON_PRESENTATION = { slotSize: 18, glyphSize: 16 } as const
const ICON_ICON_PRESENTATION = { slotSize: 24, glyphSize: 18 } as const

export interface SidebarListProps {
  layout: SidebarVisibleLayout
  entries: ResolvedSidebarEntry[]
  active: SidebarActiveState
  onReorder?: (event: { oldIndex: number; newIndex: number }) => void
  onContextMenuOpenChange?: (open: boolean) => void
}

/**
 * Renders resolved shortcuts as one continuous, drag-reorderable list.
 * A single `SidebarSortableList` (one dnd-kit context) backs the whole list, so a
 * drag can move an item to any position regardless of its resource provider.
 */
export function SidebarList({ layout, ...props }: SidebarListProps) {
  if (layout === 'icon') return <IconList {...props} />
  return <FullList {...props} />
}

type ListProps = Omit<SidebarListProps, 'layout'>

function EntryContextMenu({
  children,
  items,
  onOpenChange
}: {
  children: ReactNode
  items?: ResolvedSidebarEntry['contextMenuItems']
  onOpenChange?: (open: boolean) => void
}) {
  if (!items?.length) return <>{children}</>

  return (
    <CommandContextMenu location="webcontents.context" extraItems={items} onOpenChange={onOpenChange}>
      {children}
    </CommandContextMenu>
  )
}

function createAuxClickHandler(entry: ResolvedSidebarEntry, guardClick: SidebarClickGuard) {
  if (!entry.onOpenNewTab) return undefined
  return guardClick(entry.key, (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault()
      entry.onOpenNewTab?.()
    }
  })
}

function preventMiddleClickAutoscroll(e: React.MouseEvent) {
  if (e.button === 1) e.preventDefault()
}

function SidebarEntryIcon({
  entry,
  presentation
}: {
  entry: ResolvedSidebarEntry
  presentation: SidebarIconPresentation
}) {
  return (
    <span
      data-slot="sidebar-entry-icon"
      className="flex shrink-0 items-center justify-center"
      style={{ width: presentation.slotSize, height: presentation.slotSize }}>
      {entry.renderIcon(presentation)}
    </span>
  )
}

function IconList({ entries, active, onReorder, onContextMenuOpenChange }: ListProps) {
  return (
    <SidebarSortableList
      items={entries}
      itemKey="key"
      onReorder={onReorder}
      className="flex flex-col items-center gap-0.5 px-1.5 [-webkit-app-region:no-drag]">
      {(entry, guardClick) => {
        const isActive = entry.isActive(active)

        return (
          <SidebarTooltip key={entry.key} content={entry.label}>
            <EntryContextMenu items={entry.contextMenuItems} onOpenChange={onContextMenuOpenChange}>
              <button
                type="button"
                aria-label={entry.label}
                aria-disabled={entry.disabled || undefined}
                onClick={entry.disabled ? undefined : guardClick(entry.key, entry.onOpen)}
                onMouseDown={preventMiddleClickAutoscroll}
                onAuxClick={createAuxClickHandler(entry, guardClick)}
                className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 ${
                  entry.disabled ? 'cursor-not-allowed opacity-55' : ''
                } ${
                  isActive
                    ? 'bg-[var(--sidebar-active-bg)] text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}>
                {isActive && <ActiveIndicator className="rounded-full" />}
                <SidebarEntryIcon entry={entry} presentation={ICON_ICON_PRESENTATION} />
              </button>
            </EntryContextMenu>
          </SidebarTooltip>
        )
      }}
    </SidebarSortableList>
  )
}

function FullList({ entries, active, onReorder, onContextMenuOpenChange }: ListProps) {
  return (
    <SidebarSortableList
      items={entries}
      itemKey="key"
      onReorder={onReorder}
      className="space-y-0.5 px-2 [-webkit-app-region:no-drag]">
      {(entry, guardClick: SidebarClickGuard) => {
        const isActive = entry.isActive(active)

        return (
          <div key={entry.key} className="relative">
            <EntryContextMenu items={entry.contextMenuItems} onOpenChange={onContextMenuOpenChange}>
              <MenuItem
                variant="ghost"
                icon={<SidebarEntryIcon entry={entry} presentation={FULL_ICON_PRESENTATION} />}
                label={entry.label}
                active={isActive}
                aria-disabled={entry.disabled || undefined}
                onClick={entry.disabled ? undefined : guardClick(entry.key, entry.onOpen)}
                onMouseDown={preventMiddleClickAutoscroll}
                onAuxClick={createAuxClickHandler(entry, guardClick)}
                className="rounded-xl aria-disabled:cursor-not-allowed aria-disabled:opacity-55 data-[active=true]:bg-[var(--sidebar-active-bg)]"
              />
            </EntryContextMenu>
            {isActive && <ActiveIndicator className="rounded-xl" />}
          </div>
        )
      }}
    </SidebarSortableList>
  )
}
