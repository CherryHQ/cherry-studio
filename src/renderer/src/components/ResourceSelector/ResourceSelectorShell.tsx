// Thin shell around @cherrystudio/ui's EntitySelector composite. All generic selector plumbing
// (popover, search, filter-panel toggle, multi-select toolbar, right-click menu portal, keyboard
// nav + a11y) lives in EntitySelector. This file is business-shaped: it owns the row visuals,
// pinned-group layout, filter panel contents, tag/sort state, and mapping between the caller's
// id/item × single/multi API and EntitySelector's flat string/string[] contract.

import {
  Checkbox,
  EntitySelector,
  type EntitySelectorRowContext,
  type EntitySelectorSection,
  Separator
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { cn } from '@renderer/utils'
import { ArrowDown, ArrowUp, Bolt, Check, ChevronRight, Pencil, Pin, Plus } from 'lucide-react'
import { type ReactElement, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type ResourceSelectorShellItem = {
  id: string
  name: string
  emoji?: string
  description?: string
  tags?: string[]
  disabled?: boolean
}

export type ResourceSelectorShellSortOption<T extends ResourceSelectorShellItem> = {
  id: string
  label: ReactNode
  icon?: ReactNode
  comparator: (a: T, b: T) => number
}

export type ResourceSelectorShellLabels = {
  searchPlaceholder: string
  sortLabel: string
  edit: string
  pin: string
  unpin: string
  createNew: string
  emptyText: string
  /** Heading rendered above the pinned group in the list. */
  pinnedTitle: string
}

type ResourceSelectorShellSharedProps<T extends ResourceSelectorShellItem> = {
  trigger: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * Fires when the popover transitions from closed → open, regardless of whether the open was
   * driven by a click on the trigger (uncontrolled / Radix-internal) or by an external state
   * change on the controlled `open` prop. Pin refresh on open belongs here so it covers both
   * paths — relying on `onOpenChange` alone misses external opens (e.g. global shortcut).
   */
  onOpen?: () => void

  items: T[]
  renderFallbackIcon?: (item: T) => ReactNode

  tags?: string[]
  sortOptions?: ResourceSelectorShellSortOption<T>[]
  defaultSortId?: string

  pinnedIds: string[]
  onTogglePin: (id: string) => void | Promise<void>
  /** Disable pin toggles while a pin read/write is in flight (prevents over-fire from rapid clicks). */
  isPinActionDisabled?: boolean

  onEditItem: (id: string) => void
  onCreateNew: () => void

  labels: ResourceSelectorShellLabels

  loading?: boolean
  width?: number | string
}

export type ResourceSelectorShellSelectionType = 'id' | 'item'

/** Single + id payload (default). */
export type ResourceSelectorShellSingleIdProps<T extends ResourceSelectorShellItem> =
  ResourceSelectorShellSharedProps<T> & {
    multi?: false
    selectionType?: 'id'
    value: string | null
    onChange: (value: string | null) => void
  }

/** Single + item object payload. */
export type ResourceSelectorShellSingleItemProps<T extends ResourceSelectorShellItem> =
  ResourceSelectorShellSharedProps<T> & {
    multi?: false
    selectionType: 'item'
    value: T | null
    onChange: (value: T | null) => void
  }

type MultiCommon = {
  multiToggleLabel: ReactNode
  multiToggleHint?: ReactNode
}

/** Multi + id[] payload (default). */
export type ResourceSelectorShellMultiIdProps<T extends ResourceSelectorShellItem> =
  ResourceSelectorShellSharedProps<T> &
    MultiCommon & {
      multi: true
      selectionType?: 'id'
      value: string[]
      onChange: (value: string[]) => void
    }

/** Multi + item[] payload. */
export type ResourceSelectorShellMultiItemProps<T extends ResourceSelectorShellItem> =
  ResourceSelectorShellSharedProps<T> &
    MultiCommon & {
      multi: true
      selectionType: 'item'
      value: T[]
      onChange: (value: T[]) => void
    }

/**
 * `multi` × `selectionType` produces four strict combinations; the caller picks one and TS enforces
 * `value` / `onChange` accordingly. `selectionType` defaults to `'id'` when omitted.
 *
 * Toolbar semantics (only rendered in multi): UX-only state, initial ON/OFF derived from value
 * length on mount (>=2 → ON). ON = checkbox toggle; OFF = radio-in-array (replace + close).
 */
export type ResourceSelectorShellProps<T extends ResourceSelectorShellItem> =
  | ResourceSelectorShellSingleIdProps<T>
  | ResourceSelectorShellSingleItemProps<T>
  | ResourceSelectorShellMultiIdProps<T>
  | ResourceSelectorShellMultiItemProps<T>

/**
 * Normalize value of any supported shape to an id list — used internally for selection display
 * and toolbar initial state. Handles string, string[], item object, item[], and null.
 */
function extractValueIds<T extends ResourceSelectorShellItem>(value: unknown): string[] {
  if (value == null) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    if (value.length === 0) return []
    return value.map((v) => (typeof v === 'string' ? v : (v as T).id))
  }
  if (typeof value === 'object' && 'id' in value) {
    return [(value as T).id]
  }
  return []
}

const SORT_ICON_DEFAULTS = {
  desc: <ArrowDown className="size-2.5" />,
  asc: <ArrowUp className="size-2.5" />
} as const

const logger = loggerService.withContext('ResourceSelectorShell')

export function ResourceSelectorShell<T extends ResourceSelectorShellItem>(props: ResourceSelectorShellProps<T>) {
  const {
    trigger,
    open: openProp,
    onOpenChange: onOpenChangeProp,
    items,
    renderFallbackIcon,
    tags,
    sortOptions,
    defaultSortId,
    pinnedIds,
    onTogglePin,
    isPinActionDisabled = false,
    onOpen,
    onEditItem,
    onCreateNew,
    labels,
    loading,
    width
  } = props

  const isMulti = props.multi === true
  const isItemType = 'selectionType' in props && props.selectionType === 'item'

  // Own the open state so we can reset search on close without relying on the caller being
  // controlled. When `openProp` is set the caller wins; otherwise we track it ourselves.
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setInternalOpen(next)
      onOpenChangeProp?.(next)
    },
    [openProp, onOpenChangeProp]
  )

  const [searchValue, setSearchValue] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [selectedSortId, setSelectedSortId] = useState<string | null>(defaultSortId ?? null)

  // Reset search text on close. Filter panel + right-click menu dismiss is handled by EntitySelector.
  useEffect(() => {
    if (!open) setSearchValue('')
  }, [open])

  // Fire onOpen for both Radix-internal and external (controlled) opens. Routing this through
  // an effect on the effective `open` value covers the controlled `open=true` path that
  // `handleOpenChange` misses entirely.
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  useEffect(() => {
    if (open) onOpenRef.current?.()
  }, [open])

  // Normalize caller's value to an id list for both the EntitySelector contract (string/string[])
  // and the toolbar's initial seed.
  const valueIds = useMemo(() => extractValueIds<T>(props.value), [props.value])
  const [multiEnabled, setMultiEnabled] = useState(() => props.multi === true && valueIds.length >= 2)

  // Async-loaded or externally-updated values can land with 2+ selected ids after mount. If we
  // stayed OFF, the next click would replay the OFF branch (replace-and-close) and silently drop
  // the extra selection. Force ON whenever the incoming value implies multi; never auto-collapse
  // in the other direction — users turn multi OFF themselves via the toolbar.
  useEffect(() => {
    if (isMulti && valueIds.length >= 2 && !multiEnabled) {
      setMultiEnabled(true)
    }
  }, [isMulti, valueIds.length, multiEnabled])

  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
  const selectedSet = useMemo(() => new Set(valueIds), [valueIds])

  const { pinnedItems, unpinnedItems } = useMemo(() => {
    let filtered = items
    if (selectedTagIds.length > 0) {
      const wanted = new Set(selectedTagIds)
      filtered = filtered.filter((it) => it.tags?.some((t) => wanted.has(t)))
    }
    const q = searchValue.trim().toLowerCase()
    if (q) {
      filtered = filtered.filter(
        (it) => it.name.toLowerCase().includes(q) || (it.description ? it.description.toLowerCase().includes(q) : false)
      )
    }
    const sorter = sortOptions?.find((s) => s.id === selectedSortId)
    if (sorter) filtered = [...filtered].sort(sorter.comparator)
    const pinned = filtered.filter((it) => pinnedSet.has(it.id))
    const unpinned = filtered.filter((it) => !pinnedSet.has(it.id))
    // Honor the user's pinnedIds order so reordering persists visually.
    const pinnedOrdered = pinnedIds.map((id) => pinned.find((it) => it.id === id)).filter(Boolean) as T[]
    return { pinnedItems: pinnedOrdered, unpinnedItems: unpinned }
  }, [items, selectedTagIds, searchValue, selectedSortId, sortOptions, pinnedSet, pinnedIds])

  // Two-section composition: pinned on top (when non-empty), then the rest. Keyboard nav walks
  // across both as if flat.
  const sections = useMemo<EntitySelectorSection<T>[]>(() => {
    const out: EntitySelectorSection<T>[] = []
    if (pinnedItems.length > 0) {
      out.push({
        key: 'pinned',
        header: <div className="px-3 pt-2 pb-1 text-muted-foreground/35 text-xs">{labels.pinnedTitle}</div>,
        items: pinnedItems
      })
    }
    out.push({ key: 'rest', items: unpinnedItems })
    return out
  }, [pinnedItems, unpinnedItems, labels.pinnedTitle])

  // EntitySelector's value/onChange contract is flat string | string[]. Translate both directions
  // so callers who picked item-shape payloads get their items back.
  const entityValue = isMulti ? valueIds : (valueIds[0] ?? null)
  const entityMode: 'single' | 'multi' = isMulti ? 'multi' : 'single'

  const handleEntityChange = useCallback(
    (next: string | string[]) => {
      if (isMulti) {
        const ids = Array.isArray(next) ? next : [next]
        if (isItemType) {
          // Preserve caller-chosen order: iterate their previous items first for stability, then
          // append newcomers as they arrive. Falls back to current `items` for the object lookup.
          const byId = new Map<string, T>(items.map((it) => [it.id, it]))
          const mapped = ids.map((id) => byId.get(id)).filter(Boolean) as T[]
          ;(props.onChange as (v: T[]) => void)(mapped)
        } else {
          ;(props.onChange as (v: string[]) => void)(ids)
        }
      } else {
        const id = typeof next === 'string' ? next : (next[0] ?? null)
        if (isItemType) {
          const item = id ? (items.find((it) => it.id === id) ?? null) : null
          ;(props.onChange as (v: T | null) => void)(item)
        } else {
          ;(props.onChange as (v: string | null) => void)(id)
        }
      }
    },
    [isMulti, isItemType, items, props.onChange]
  )

  const togglePin = useCallback(
    (id: string) => {
      if (isPinActionDisabled) return
      Promise.resolve(onTogglePin(id)).catch((error) => {
        logger.error('Failed to toggle pin', error as Error, { id })
      })
    },
    [onTogglePin, isPinActionDisabled]
  )

  const renderItem = useCallback(
    (item: T, ctx: EntitySelectorRowContext) => {
      const isSelected = selectedSet.has(item.id)
      const isPinned = pinnedSet.has(item.id)
      // Row root is a div, not a button, because it hosts real child buttons (Checkbox, pin
      // toggle, edit) — nested <button> is invalid HTML and trips React's validateDOMNesting.
      // EntitySelector already wraps this div in a listbox option (role / aria-selected /
      // aria-disabled) so we intentionally do not repeat those attributes here; a nested
      // duplicate role="option" would confuse assistive tech and DOM queries.
      return (
        <div
          onClick={item.disabled ? undefined : ctx.onSelect}
          onContextMenu={item.disabled ? undefined : ctx.onContextMenu}
          className={cn(
            'group mb-0.5 flex w-full cursor-pointer items-center gap-2.5 rounded-2xs px-3 py-[5px] text-left transition-all',
            isSelected ? 'bg-accent/40 text-foreground' : 'text-foreground/80 hover:bg-accent/20',
            ctx.isActive && !isSelected && 'bg-accent/20',
            item.disabled && 'cursor-not-allowed opacity-50'
          )}>
          {/* Layered leading slot — Checkbox (multi) > Check (selected) > Pin (pinned). */}
          {ctx.isMultiMode ? (
            <Checkbox
              size="sm"
              checked={isSelected}
              onCheckedChange={() => ctx.onSelect()}
              onClick={(e) => e.stopPropagation()}
              className="size-3.5 shrink-0"
              tabIndex={-1}
            />
          ) : (
            <span className="flex w-4 shrink-0 items-center justify-center">
              {isSelected ? (
                <Check size={12} className="text-foreground/50" />
              ) : isPinned ? (
                <button
                  type="button"
                  disabled={isPinActionDisabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePin(item.id)
                  }}
                  className="text-muted-foreground/40 transition-colors hover:text-destructive/60 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground/40"
                  title={labels.unpin}
                  aria-label={labels.unpin}>
                  <Pin size={10} />
                </button>
              ) : null}
            </span>
          )}
          {item.emoji ? (
            <span className="shrink-0 text-base leading-none">{item.emoji}</span>
          ) : renderFallbackIcon ? (
            <span className="flex size-5 shrink-0 items-center justify-center">{renderFallbackIcon(item)}</span>
          ) : null}
          <span className={cn('min-w-0 flex-1 truncate text-sm', isSelected && 'font-medium')}>{item.name}</span>
          {/* Trailing hover-revealed config button. Right-click menu offers the same entry. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onEditItem(item.id)
            }}
            className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/15 opacity-0 transition-all hover:text-muted-foreground/40 group-hover:opacity-100"
            aria-label={labels.edit}>
            <Bolt size={13} />
          </button>
        </div>
      )
    },
    [selectedSet, pinnedSet, labels.unpin, labels.edit, renderFallbackIcon, togglePin, onEditItem, isPinActionDisabled]
  )

  const hasFilterControls = (tags && tags.length > 0) || (sortOptions && sortOptions.length > 0)
  const filterActive = selectedTagIds.length > 0 || selectedSortId !== null

  const filterPanel = hasFilterControls ? (
    <div className="space-y-1.5">
      {tags && tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => {
            const active = selectedTagIds.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  setSelectedTagIds((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
                }
                className={cn(
                  'cursor-pointer rounded-full border px-2 py-[3px] text-xs transition-colors',
                  active
                    ? 'border-border/60 bg-foreground/8 text-foreground/80'
                    : 'border-border/40 bg-transparent text-muted-foreground/50 hover:bg-accent/20 hover:text-muted-foreground/70'
                )}>
                {tag}
              </button>
            )
          })}
        </div>
      ) : null}
      {sortOptions && sortOptions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground/35 text-xs">{labels.sortLabel}</span>
          {sortOptions.map((s) => {
            const active = selectedSortId === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedSortId(active ? null : s.id)}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-[3px] text-xs transition-colors',
                  active
                    ? 'border-border/60 bg-foreground/8 text-foreground/80'
                    : 'border-border/40 bg-transparent text-muted-foreground/50 hover:bg-accent/20 hover:text-muted-foreground/70'
                )}>
                {s.icon ?? SORT_ICON_DEFAULTS[s.id as keyof typeof SORT_ICON_DEFAULTS] ?? null}
                <span>{s.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  ) : undefined

  const multiToggleLabel = 'multiToggleLabel' in props ? props.multiToggleLabel : null
  const multiToggleHint = 'multiToggleHint' in props ? props.multiToggleHint : undefined

  // Only write back to the caller's value on ON→OFF: collapse to the first selected id so UI and
  // value stay in sync. Opening multi never emits — value stays as-is so a toggle can't silently
  // truncate business data.
  const handleMultiEnabledChange = useCallback(
    (next: boolean) => {
      setMultiEnabled(next)
      if (next || !isMulti || valueIds.length < 2) return
      const firstId = valueIds[0]
      if (isItemType) {
        const firstItem = items.find((it) => it.id === firstId) ?? null
        ;(props.onChange as (v: T[]) => void)(firstItem ? [firstItem] : [])
      } else {
        ;(props.onChange as (v: string[]) => void)([firstId])
      }
    },
    [isMulti, isItemType, items, props.onChange, valueIds]
  )

  const footer = (
    <>
      <Separator className="bg-border/20" />
      <div className="px-1.5 py-1">
        <button
          type="button"
          onClick={() => {
            handleOpenChange(false)
            onCreateNew()
          }}
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-2xs px-3 py-[5px] text-left text-muted-foreground text-sm transition-colors hover:bg-accent/20 hover:text-foreground">
          <Plus size={14} className="shrink-0" />
          <span className="flex-1">{labels.createNew}</span>
          <ChevronRight size={12} className="text-muted-foreground/40" />
        </button>
      </div>
    </>
  )

  return (
    <EntitySelector
      trigger={trigger}
      open={open}
      onOpenChange={handleOpenChange}
      sections={sections}
      mode={entityMode}
      value={entityValue}
      onChange={handleEntityChange}
      renderItem={renderItem}
      width={width ?? 320}
      loading={loading}
      emptyState={<div className="px-3 py-4 text-center text-muted-foreground/40 text-sm">{labels.emptyText}</div>}
      search={{ value: searchValue, onChange: setSearchValue, placeholder: labels.searchPlaceholder }}
      filterActive={filterActive}
      filterPanel={filterPanel}
      multiSelect={
        isMulti
          ? {
              enabled: multiEnabled,
              onEnabledChange: handleMultiEnabledChange,
              label: multiToggleLabel,
              hint: multiToggleHint
            }
          : undefined
      }
      renderItemContextMenu={(item, { close }) => (
        <div className="min-w-0 rounded-2xs border border-border bg-popover p-0.5 shadow-md">
          <button
            type="button"
            onClick={() => {
              onEditItem(item.id)
              close()
            }}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-3xs px-2 py-[3px] text-left text-foreground text-xs transition-colors hover:bg-accent/15">
            <Pencil size={10} />
            <span>{labels.edit}</span>
          </button>
          <button
            type="button"
            disabled={isPinActionDisabled}
            onClick={() => {
              togglePin(item.id)
              close()
            }}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-3xs px-2 py-[3px] text-left text-foreground text-xs transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent">
            <Pin size={10} className={pinnedSet.has(item.id) ? 'rotate-45' : ''} />
            <span>{pinnedSet.has(item.id) ? labels.unpin : labels.pin}</span>
          </button>
        </div>
      )}
      footer={footer}
      popoverContentProps={{
        className: 'min-w-[280px] border-border/60'
      }}
    />
  )
}
