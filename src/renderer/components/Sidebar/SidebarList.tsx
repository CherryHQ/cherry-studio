import type { ReactNode } from 'react'

import { Button, MenuItem, Tooltip } from '@cherrystudio/ui'
import { CommandContextMenu } from '@renderer/components/command'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { cn } from '@renderer/utils/style'

import type { SidebarClickGuard } from './SidebarSortableList'
import { SidebarSortableList } from './SidebarSortableList'
import { SidebarTooltip } from './Tooltip'
import type { ResolvedSidebarEntry, SidebarIconPresentation, SidebarVisibleLayout } from './types'

const FULL_ICON_PRESENTATION = { slotSize: 18, glyphSize: 16 } as const
const ICON_ICON_PRESENTATION = { slotSize: 24, glyphSize: 18 } as const

export interface SidebarListProps {
  layout: SidebarVisibleLayout
  entries: ResolvedSidebarEntry[]
  onReorder?: (event: { oldIndex: number; newIndex: number }) => void
  onContextMenuOpenChange?: (open: boolean) => void
}

/**
 * Renders resolved shortcuts as one continuous, drag-reorderable list.
 * A single `SidebarSortableList` (one dnd-kit context) backs the whole list, so a
 * drag can move an item to any position regardless of its resource provider.
 */
export function SidebarList({ layout, ...props }: SidebarListProps) {
  const isMacTransparentWindow = useMacTransparentWindow()
  const activeBackgroundClassName = isMacTransparentWindow
    ? 'data-[active=true]:bg-white/78! dark:data-[active=true]:bg-white/10!'
    : 'data-[active=true]:bg-black/8! dark:data-[active=true]:bg-sidebar-accent!'

  if (layout === 'icon') return <IconList {...props} activeBackgroundClassName={activeBackgroundClassName} />
  return <FullList {...props} activeBackgroundClassName={activeBackgroundClassName} />
}

type ListProps = Omit<SidebarListProps, 'layout'> & { activeBackgroundClassName: string }

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
  if (entry.disabled || !entry.onOpenNewTab) return undefined
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
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center"
      style={{ width: presentation.slotSize, height: presentation.slotSize }}>
      {entry.renderIcon(presentation)}
    </span>
  )
}

function IconList({ entries, onReorder, onContextMenuOpenChange, activeBackgroundClassName }: ListProps) {
  return (
    <SidebarSortableList
      items={entries}
      itemKey="key"
      onReorder={onReorder}
      className="flex flex-col items-center gap-1 px-1.5 [-webkit-app-region:no-drag]">
      {(entry, guardClick) => {
        const isActive = !entry.disabled && entry.isActive

        return (
          <SidebarTooltip
            key={entry.key}
            content={entry.statusLabel ? `${entry.label} — ${entry.statusLabel}` : entry.label}>
            <EntryContextMenu items={entry.contextMenuItems} onOpenChange={onContextMenuOpenChange}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={entry.label}
                aria-description={entry.statusLabel}
                aria-disabled={entry.disabled || undefined}
                aria-current={isActive ? 'page' : undefined}
                data-active={isActive || undefined}
                onClick={entry.disabled ? undefined : guardClick(entry.key, entry.onOpen)}
                onMouseDown={preventMiddleClickAutoscroll}
                onAuxClick={createAuxClickHandler(entry, guardClick)}
                className={cn(
                  "sidebar-action relative flex h-9 w-9 items-center justify-center rounded-full border-[0.5px] border-transparent aria-disabled:cursor-not-allowed [&_svg:not([class*='size-'])]:size-4.5",
                  activeBackgroundClassName
                )}>
                <SidebarEntryIcon entry={entry} presentation={ICON_ICON_PRESENTATION} />
              </Button>
            </EntryContextMenu>
          </SidebarTooltip>
        )
      }}
    </SidebarSortableList>
  )
}

function FullList({ entries, onReorder, onContextMenuOpenChange, activeBackgroundClassName }: ListProps) {
  return (
    <SidebarSortableList
      items={entries}
      itemKey="key"
      onReorder={onReorder}
      className="space-y-0.5 px-2 [-webkit-app-region:no-drag]">
      {(entry, guardClick: SidebarClickGuard) => {
        const isActive = !entry.disabled && entry.isActive

        return (
          <div key={entry.key}>
            <Tooltip
              content={entry.statusLabel ? `${entry.label} — ${entry.statusLabel}` : entry.label}
              placement="right"
              delay={400}
              fullWidthTrigger>
              <EntryContextMenu items={entry.contextMenuItems} onOpenChange={onContextMenuOpenChange}>
                <MenuItem
                  variant="ghost"
                  icon={<SidebarEntryIcon entry={entry} presentation={FULL_ICON_PRESENTATION} />}
                  label={entry.label}
                  aria-label={entry.label}
                  aria-description={entry.statusLabel}
                  title={entry.statusLabel}
                  active={isActive}
                  aria-current={isActive ? 'page' : undefined}
                  aria-disabled={entry.disabled || undefined}
                  onClick={entry.disabled ? undefined : guardClick(entry.key, entry.onOpen)}
                  onMouseDown={preventMiddleClickAutoscroll}
                  onAuxClick={createAuxClickHandler(entry, guardClick)}
                  className={cn(
                    'sidebar-action rounded-full border-[0.5px] aria-disabled:cursor-not-allowed',
                    activeBackgroundClassName
                  )}
                />
              </EntryContextMenu>
            </Tooltip>
          </div>
        )
      }}
    </SidebarSortableList>
  )
}
