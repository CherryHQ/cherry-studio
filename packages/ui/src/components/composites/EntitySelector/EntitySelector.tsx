import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui/components/primitives/popover'
import { cn } from '@cherrystudio/ui/lib/utils'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'

import { Header } from './parts/Header'
import { ItemContextMenu, useItemContextMenu } from './parts/ItemContextMenu'
import { MultiSelectBar } from './parts/MultiSelectBar'
import type { EntityItemBase, EntitySelectorProps } from './types'

const DEFAULT_MAX_LIST_HEIGHT = 320
const DEFAULT_WIDTH = 320

export function EntitySelector<T extends EntityItemBase>({
  open: openProp,
  onOpenChange,
  trigger,
  items,
  mode,
  value,
  onChange,
  renderItem,
  search,
  filterPanel,
  filterActive,
  multiSelect,
  renderItemContextMenu,
  contextMenuViewportMargin,
  footer,
  maxListHeight = DEFAULT_MAX_LIST_HEIGHT,
  emptyState,
  loading,
  loadingState,
  width = DEFAULT_WIDTH,
  className,
  popoverContentProps
}: EntitySelectorProps<T>) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [openProp, onOpenChange]
  )

  const [filterOpen, setFilterOpen] = useState(false)
  const ctxMenu = useItemContextMenu()
  const listboxId = useId()
  const listRef = useRef<HTMLDivElement>(null)

  // Reset transient panel/menu state when popover closes. Intentionally depend only on `open`:
  // `ctxMenu.close` is a stable useCallback from `useItemContextMenu`, but eslint-plugin-react-hooks
  // can't prove that across file boundaries, so we silence the lint here rather than resubscribing
  // every render.
  useEffect(() => {
    if (!open) {
      setFilterOpen(false)
      ctxMenu.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const isMultiMode = mode === 'multi' && !!multiSelect?.enabled
  const showFilterButton = !!filterPanel

  const selectedSet = useMemo(() => {
    if (mode === 'multi') return new Set(Array.isArray(value) ? value : [])
    return new Set(value && typeof value === 'string' ? [value] : [])
  }, [mode, value])

  // ── Keyboard navigation ────────────────────────────────────────────────
  const firstEnabledIndex = useMemo(() => items.findIndex((it) => !it.disabled), [items])
  const [activeIndex, setActiveIndex] = useState<number>(-1)

  // When the popover opens or items list changes (e.g. search filtering), reset the active row.
  // Prefer a currently-selected item; otherwise the first enabled row.
  useEffect(() => {
    if (!open) {
      setActiveIndex(-1)
      return
    }
    const selectedIdx = items.findIndex((it) => selectedSet.has(it.id) && !it.disabled)
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : firstEnabledIndex)
    // selectedSet is derived from value+mode; including it directly churns on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, firstEnabledIndex])

  const step = useCallback(
    (from: number, direction: 1 | -1): number => {
      if (items.length === 0) return -1
      const total = items.length
      let i = from
      for (let n = 0; n < total; n++) {
        i = (i + direction + total) % total
        if (!items[i]?.disabled) return i
      }
      return -1
    },
    [items]
  )

  const handleSelectItem = useCallback(
    (item: T) => {
      if (item.disabled) return
      // `mode` fixes the onChange payload shape (string vs string[]); the toolbar's enabled flag
      // only affects interaction semantics within multi mode (checkbox toggle vs radio-in-array).
      if (mode === 'multi') {
        if (isMultiMode) {
          const current = new Set(Array.isArray(value) ? value : [])
          if (current.has(item.id)) current.delete(item.id)
          else current.add(item.id)
          onChange(Array.from(current))
        } else {
          // Toolbar off / not provided → replace to honor the multi-array contract, then close.
          onChange([item.id])
          setOpen(false)
        }
      } else {
        onChange(item.id)
        setOpen(false)
      }
    },
    [mode, isMultiMode, onChange, setOpen, value]
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault()
          setActiveIndex((i) => step(i < 0 ? -1 : i, 1))
          return
        }
        case 'ArrowUp': {
          event.preventDefault()
          setActiveIndex((i) => step(i < 0 ? items.length : i, -1))
          return
        }
        case 'Home': {
          if (items.length === 0) return
          event.preventDefault()
          setActiveIndex(step(-1, 1))
          return
        }
        case 'End': {
          if (items.length === 0) return
          event.preventDefault()
          setActiveIndex(step(0, -1))
          return
        }
        case 'Enter': {
          if (activeIndex < 0) return
          const item = items[activeIndex]
          if (!item || item.disabled) return
          event.preventDefault()
          handleSelectItem(item)
          return
        }
      }
    },
    [activeIndex, handleSelectItem, items, step]
  )

  // Keep the active row scrolled into view when activeIndex moves.
  useEffect(() => {
    if (activeIndex < 0) return
    const item = items[activeIndex]
    if (!item) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-option-id="${CSS.escape(item.id)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, items])

  const activeOptionDomId =
    activeIndex >= 0 && items[activeIndex] ? `${listboxId}-opt-${items[activeIndex].id}` : undefined

  const ctxMenuNode = useMemo(() => {
    if (!renderItemContextMenu || !ctxMenu.position) return null
    const target = items.find((it) => it.id === ctxMenu.position!.itemId)
    if (!target) return null
    return renderItemContextMenu(target, { close: ctxMenu.close })
  }, [renderItemContextMenu, ctxMenu.position, ctxMenu.close, items])

  // Popover content props: compose with our overrides without clobbering caller intent.
  const {
    align: userAlign,
    sideOffset: userSideOffset,
    className: userPopoverClassName,
    onInteractOutside: userOnInteractOutside,
    onKeyDown: userOnKeyDown,
    onEscapeKeyDown: userOnEscapeKeyDown,
    style: userStyle,
    ...restPopoverContentProps
  } = popoverContentProps ?? {}

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger as ReactElement}</PopoverTrigger>
        <PopoverContent
          align={userAlign ?? 'start'}
          sideOffset={userSideOffset ?? 6}
          {...restPopoverContentProps}
          style={{ width: typeof width === 'number' ? `${width}px` : width, ...userStyle }}
          // Right-click menu is rendered in a body portal (see ItemContextMenu), so Radix treats
          // clicks inside it as outside-popover. Veto the dismiss when the interaction originates
          // from within our context-menu marker — Radix CustomEvents expose the real DOM target
          // on `detail.originalEvent`. Then delegate to the caller.
          onInteractOutside={(event) => {
            const originalTarget = (event.detail?.originalEvent?.target ?? event.target) as Element | null
            if (originalTarget?.closest?.('[data-entity-context-menu-root]')) {
              event.preventDefault()
            }
            userOnInteractOutside?.(event)
          }}
          onKeyDown={(event) => {
            handleKeyDown(event)
            userOnKeyDown?.(event)
          }}
          // Radix dispatches Escape before React bubbles the synthetic keydown. Intercept here so
          // an open filter panel can be closed by Escape without dismissing the popover itself.
          onEscapeKeyDown={(event) => {
            if (filterOpen) {
              event.preventDefault()
              setFilterOpen(false)
              return
            }
            userOnEscapeKeyDown?.(event)
          }}
          className={cn(
            'flex max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden rounded-2xs border-border/60 bg-popover p-0 shadow-lg',
            userPopoverClassName,
            className
          )}>
          <Header
            search={search}
            showFilterButton={showFilterButton}
            filterActive={!!filterActive}
            filterOpen={filterOpen}
            onToggleFilter={() => setFilterOpen((prev) => !prev)}
          />

          {filterOpen && filterPanel ? <div className="px-3 pb-2">{filterPanel}</div> : null}

          {multiSelect ? (
            <MultiSelectBar
              enabled={multiSelect.enabled}
              onEnabledChange={multiSelect.onEnabledChange}
              label={multiSelect.label}
              hint={multiSelect.hint}
              disabled={multiSelect.disabled}
            />
          ) : null}

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-multiselectable={isMultiMode}
            aria-activedescendant={activeOptionDomId}
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto outline-none"
            style={{ maxHeight: typeof maxListHeight === 'number' ? `${maxListHeight}px` : maxListHeight }}>
            {loading
              ? (loadingState ?? null)
              : items.length === 0
                ? (emptyState ?? null)
                : items.map((it, idx) => {
                    const isSelected = selectedSet.has(it.id)
                    const isActive = idx === activeIndex
                    return (
                      <div
                        key={it.id}
                        id={`${listboxId}-opt-${it.id}`}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={it.disabled || undefined}
                        data-option-id={it.id}
                        data-active={isActive || undefined}
                        onMouseEnter={() => {
                          if (!it.disabled) setActiveIndex(idx)
                        }}>
                        {renderItem(it, {
                          isSelected,
                          isMultiMode,
                          isActive,
                          onSelect: () => handleSelectItem(it),
                          onContextMenu: renderItemContextMenu ? (e) => ctxMenu.open(e, it.id) : undefined
                        })}
                      </div>
                    )
                  })}
          </div>

          {footer ?? null}
        </PopoverContent>
      </Popover>

      {ctxMenu.position && ctxMenuNode ? (
        <ItemContextMenu position={ctxMenu.position} onClose={ctxMenu.close} viewportMargin={contextMenuViewportMargin}>
          {ctxMenuNode}
        </ItemContextMenu>
      ) : null}
    </>
  )
}
