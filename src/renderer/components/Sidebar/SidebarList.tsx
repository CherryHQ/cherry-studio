import { MenuItem } from '@cherrystudio/ui'
import { CommandContextMenu } from '@renderer/components/command'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { cn } from '@renderer/utils/style'
import type { ReactNode } from 'react'

import type { SidebarClickGuard } from './SidebarSortableList'
import { SidebarSortableList } from './SidebarSortableList'
import { SidebarTooltip } from './Tooltip'
import type { ResolvedSidebarEntry, SidebarActiveState, SidebarVisibleLayout } from './types'

export interface SidebarListProps {
  layout: SidebarVisibleLayout
  entries: ResolvedSidebarEntry[]
  active: SidebarActiveState
  onReorder?: (event: { oldIndex: number; newIndex: number }) => void
  onContextMenuOpenChange?: (open: boolean) => void
}

/**
 * Renders built-in apps and mini apps as one continuous, drag-reorderable list.
 * A single `SidebarSortableList` (one dnd-kit context) backs the whole list, so a
 * drag can move an item to any position regardless of type — apps and mini apps
 * freely interleave with no divider between them.
 *
 * Entries are already resolved to a type-agnostic shape (see
 * `components/app/sidebarVariants`), so this presentation layer never switches on
 * whether a row is an app or a mini app.
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

function IconList({ entries, active, onReorder, onContextMenuOpenChange }: ListProps) {
  return (
    <SidebarSortableList
      items={entries}
      itemKey="key"
      onReorder={onReorder}
      className="flex flex-col items-center gap-1 px-1.5 [-webkit-app-region:no-drag]">
      {(entry, guardClick) => {
        const isActive = entry.isActive(active)

        return (
          <SidebarTooltip key={entry.key} content={entry.label}>
            <EntryContextMenu items={entry.contextMenuItems} onOpenChange={onContextMenuOpenChange}>
              <button
                type="button"
                aria-label={entry.label}
                onClick={guardClick(entry.key, entry.onOpen)}
                className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150 [&_svg]:text-current ${
                  isActive ? 'bg-accent text-foreground' : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground'
                }`}>
                {entry.renderIcon(18, 'lg')}
              </button>
            </EntryContextMenu>
          </SidebarTooltip>
        )
      }}
    </SidebarSortableList>
  )
}

function FullList({ entries, active, onReorder, onContextMenuOpenChange }: ListProps) {
  const isMacTransparentWindow = useMacTransparentWindow()

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
                icon={entry.renderIcon(16, 'md')}
                label={entry.label}
                active={isActive}
                onClick={guardClick(entry.key, entry.onOpen)}
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
            </EntryContextMenu>
          </div>
        )
      }}
    </SidebarSortableList>
  )
}
