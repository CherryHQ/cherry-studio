import { ChevronDown, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  TabsList,
  TabsTrigger
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { CommandContextMenu, type CommandContextMenuExtraItem, type MaybePromise } from '@renderer/components/command'

export interface ArtifactPaneFileTab {
  key: string
  title: string
  path: string
}

interface ArtifactPaneFileTabsProps {
  tabs: ArtifactPaneFileTab[]
  activeKey: string | null
  activeDirty: boolean
  dirtyLabel: string
  closeLabel: string
  overflowLabel: string
  onActivate: (key: string) => void
  onClose: (key: string) => void
  getMenuItems?: (key: string) => MaybePromise<readonly CommandContextMenuExtraItem[]>
}

// One tab at its readable minimum (min-w-28) plus the gap; the overflow button (size-7) plus the gap.
const TAB_SLOT_PX = 116
const OVERFLOW_BUTTON_PX = 32

/** Splits tabs into those that fit the strip and those listed in the overflow menu; the active tab stays visible. */
export function fitFileTabs<T extends { key: string }>(
  tabs: T[],
  activeKey: string | null,
  width: number
): { visible: T[]; hidden: T[] } {
  if (width <= 0 || tabs.length * TAB_SLOT_PX <= width) return { visible: tabs, hidden: [] }
  const capacity = Math.max(1, Math.floor((width - OVERFLOW_BUTTON_PX) / TAB_SLOT_PX))
  let visible = tabs.slice(0, capacity)
  const active = tabs.find((tab) => tab.key === activeKey)
  if (active && !visible.includes(active)) visible = [...visible.slice(0, capacity - 1), active]
  return { visible, hidden: tabs.filter((tab) => !visible.includes(tab)) }
}

export function ArtifactPaneFileTabs({
  tabs,
  activeKey,
  activeDirty,
  dirtyLabel,
  closeLabel,
  overflowLabel,
  onActivate,
  onClose,
  getMenuItems
}: ArtifactPaneFileTabsProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    setWidth(root.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])
  const { visible, hidden } = fitFileTabs(tabs, activeKey, width)

  return (
    <Tabs
      ref={rootRef}
      variant="underline"
      value={activeKey ?? ''}
      onValueChange={onActivate}
      className="min-w-0 flex-1 flex-row items-center gap-1">
      <TabsList className="min-w-0 gap-1">
        {visible.map((tab) => {
          const active = tab.key === activeKey
          const row = (
            // The close button cannot nest inside the trigger button, so the row carries the tab surface.
            <div
              key={tab.key}
              className={cn(
                'flex h-7 max-w-48 min-w-28 items-center gap-1 rounded-md pr-1 pl-2 text-sm transition-colors',
                active
                  ? 'bg-resource-list-row-selected text-resource-list-row-selected-foreground'
                  : 'text-muted-foreground hover:bg-resource-list-row-hover hover:text-foreground'
              )}>
              <TabsTrigger
                value={tab.key}
                title={tab.path}
                // Start-aligned with a truncating span: the shared trigger centres flex content, which clips both ends.
                className="min-w-0 flex-1 justify-start p-0 text-inherit data-[state=active]:text-inherit data-[state=active]:after:bg-transparent">
                <span className={cn('truncate', active && 'pr-0.5 italic')}>{tab.title}</span>
              </TabsTrigger>
              {active && activeDirty ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-warning"
                  aria-label={dirtyLabel}
                  title={dirtyLabel}
                />
              ) : null}
              <button
                type="button"
                aria-label={`${closeLabel} ${tab.title}`}
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => onClose(tab.key)}>
                <X size={12} />
              </button>
            </div>
          )
          return getMenuItems ? (
            <CommandContextMenu
              key={tab.key}
              location="webcontents.context"
              getExtraItems={() => getMenuItems(tab.key)}>
              {row}
            </CommandContextMenu>
          ) : (
            row
          )
        })}
      </TabsList>
      {hidden.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={overflowLabel}>
              <ChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
            {hidden.map((tab) => (
              <DropdownMenuItem key={tab.key} title={tab.path} onSelect={() => onActivate(tab.key)}>
                <span className="truncate">{tab.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </Tabs>
  )
}
