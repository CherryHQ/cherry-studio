import {
  Button,
  Input,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Scrollbar,
  Switch
} from '@cherrystudio/ui'
import { Plus, Search } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Shape expected by both the bound list and the add popover. Each tab in
 * `ToolsSection` maps its own domain type (built-in Tool, MCPServer,
 * InstalledSkill) into a `CatalogItem` before passing it in. Keeping the
 * shape generic lets us share the render + add-popover logic across all
 * three tabs — the interaction pattern (bound cards with switch-off + add
 * popover listing pickable items) is identical.
 */
export interface CatalogItem {
  id: string
  name: string
  description?: string | null
  icon?: ReactNode
  /** Shown in the bound card when truthy (e.g. MCP "未启用" for inactive servers). */
  inactiveBadge?: string
  /** When false, this item is excluded from the add popover even when not
   * bound. Used by MCP to hide inactive servers from the picker. */
  pickable?: boolean
}

/**
 * Single bound-item card. Visual: icon tile + name + description + Switch.
 * The switch is always "checked" while the item is rendered here (presence
 * in the bound list == enabled); flipping it off calls `onDisable`.
 */
export function BoundRow({ item, onDisable }: { item: CatalogItem; onDisable: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/15 bg-accent/5 px-3 py-2.5 transition-colors hover:border-border/25 hover:bg-accent/10">
      {item.icon ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/50">{item.icon}</div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11px] text-foreground">{item.name}</span>
          {item.inactiveBadge ? (
            <span className="shrink-0 rounded-4xs bg-warning/10 px-1 py-px text-[8px] text-warning">
              {item.inactiveBadge}
            </span>
          ) : null}
        </div>
        {item.description ? (
          <div className="mt-0.5 truncate text-[9px] text-muted-foreground/45">{item.description}</div>
        ) : null}
      </div>
      <Switch
        size="sm"
        checked
        onCheckedChange={onDisable}
        classNames={{
          root: 'h-3.5 w-6 shrink-0 shadow-none',
          thumb: 'size-2.5 ml-0.5 data-[state=checked]:translate-x-3'
        }}
      />
    </div>
  )
}

/**
 * List of currently-bound items. Handles loading + empty states and keeps
 * the parent tab's render code short.
 */
export const BoundCatalogList: FC<{
  items: CatalogItem[]
  loading?: boolean
  /** Search keyword (outer search bar in `ToolsSection`). Filters by name
   * and description, case-insensitive. Empty string = show everything. */
  search?: string
  onDisable: (id: string) => void
  emptyLabel: ReactNode
  noMatchLabel: ReactNode
}> = ({ items, loading, search, onDisable, emptyLabel, noMatchLabel }) => {
  const { t } = useTranslation()

  const filtered = useMemo(() => {
    const q = (search ?? '').trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => it.name.toLowerCase().includes(q) || (it.description ?? '').toLowerCase().includes(q))
  }, [items, search])

  if (loading) {
    return <EmptyPlaceholder>{t('common.loading')}</EmptyPlaceholder>
  }
  if (items.length === 0) {
    return <EmptyPlaceholder>{emptyLabel}</EmptyPlaceholder>
  }
  if (filtered.length === 0) {
    return <EmptyPlaceholder>{noMatchLabel}</EmptyPlaceholder>
  }
  return (
    <div className="flex flex-col gap-1.5">
      {filtered.map((it) => (
        <BoundRow key={it.id} item={it} onDisable={() => onDisable(it.id)} />
      ))}
    </div>
  )
}

/**
 * Popover trigger + content for "+ 添加". Lists currently-unbound items
 * (optionally filtered by `item.pickable !== false`) with an internal
 * search input — mirrors the `AssistantConfig` MCP picker interaction.
 *
 * `onAdd` receives the picked id; the popover closes itself afterwards.
 */
export const AddCatalogPopover: FC<{
  items: CatalogItem[]
  /** Set of ids already bound/enabled — excluded from the picker. */
  enabledIds: ReadonlySet<string>
  onAdd: (id: string) => void
  triggerLabel: string
  searchPlaceholder: string
  emptyLabel: string
  disabled?: boolean
  /** Popover alignment; defaults to end so it anchors off the tab-bar
   * right edge (where "+ 添加" lives). */
  align?: 'start' | 'end'
}> = ({ items, enabledIds, onAdd, triggerLabel, searchPlaceholder, emptyLabel, disabled, align = 'end' }) => {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')

  const available = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return items.filter((it) => {
      if (enabledIds.has(it.id)) return false
      if (it.pickable === false) return false
      if (!q) return true
      return it.name.toLowerCase().includes(q) || (it.description ?? '').toLowerCase().includes(q)
    })
  }, [items, enabledIds, keyword])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setKeyword('')
      }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          className="ml-auto flex h-auto min-h-0 items-center gap-1 rounded-md px-2 py-1 font-normal text-[10px] text-muted-foreground/40 shadow-none transition-colors hover:bg-accent/15 hover:text-foreground focus-visible:ring-0 disabled:opacity-30">
          <Plus size={10} />
          <span>{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} sideOffset={4} className="w-64 rounded-2xs p-2">
        <div className="relative mb-2">
          <Search
            size={10}
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 text-muted-foreground/40"
          />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-auto rounded-3xs border border-border/20 bg-accent/10 py-1.5 pr-2 pl-6 text-[10px] shadow-none transition-all focus-visible:border-border/40 focus-visible:ring-0 md:text-[10px]"
          />
        </div>
        {available.length === 0 ? (
          <p className="px-2 py-3 text-center text-[9px] text-muted-foreground/40">{emptyLabel}</p>
        ) : (
          <Scrollbar className="max-h-60">
            <MenuList>
              {available.map((it) => (
                <MenuItem
                  key={it.id}
                  size="sm"
                  variant="ghost"
                  className="rounded-3xs"
                  icon={it.icon}
                  label={it.name}
                  description={it.description || undefined}
                  descriptionLines={1}
                  onClick={() => {
                    onAdd(it.id)
                    setOpen(false)
                    setKeyword('')
                  }}
                />
              ))}
            </MenuList>
          </Scrollbar>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function EmptyPlaceholder({ children }: { children: ReactNode }) {
  return <div className="py-14 text-center text-[10px] text-muted-foreground/40">{children}</div>
}
