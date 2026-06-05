import { Checkbox, CustomTag, EmptyState, type EmptyStatePreset } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import Scrollbar from '@renderer/components/Scrollbar'
import { Pin, Plus, SquarePen } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  MODEL_SELECTOR_ROW_CHECKBOX_CLASS,
  ModelSelectorRow,
  ModelSelectorRowActionButton
} from '../model/ModelSelectorRow'
import { SelectorShell, type SelectorShellMountStrategy, type SelectorShellProps } from '../shell/SelectorShell'

export type ResourceSelectorShellItem = {
  id: string
  name: string
  emoji?: string
  description?: string
  tags?: string[]
  disabled?: boolean
  editable?: boolean
  pinnable?: boolean
}

export type ResourceSelectorShellTag = string | { name: string; color?: string }

export type ResourceSelectorShellLabels = {
  searchPlaceholder: string
  pin: string
  unpin: string
  edit: string
  createNew: string
  emptyText: string
  /** Heading rendered above the pinned group in the list. */
  pinnedTitle: string
  tagFilter?: string
}

type ResourceSelectorShellEmptyState = {
  preset: EmptyStatePreset
}

type ResourceSelectorSection<T extends ResourceSelectorShellItem> = {
  key: string
  header?: ReactNode
  items: T[]
}

type ResourceSelectorShellSharedProps<T extends ResourceSelectorShellItem> = {
  trigger: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * Fires when the popover transitions from closed -> open, regardless of whether the open was
   * driven by a click on the trigger (uncontrolled / Radix-internal) or by an external state
   * change on the controlled `open` prop. Pin refresh on open belongs here so it covers both
   * paths - relying on `onOpenChange` alone misses external opens (e.g. global shortcut).
   */
  onOpen?: () => void

  items: T[]
  fallbackIcon?: ReactNode

  tags?: ResourceSelectorShellTag[]

  pinnedIds: readonly string[]
  onTogglePin: (id: string) => void | Promise<void>
  /** Disable pin toggles while a pin read/write is in flight (prevents over-fire from rapid clicks). */
  isPinActionDisabled?: boolean

  onCreateNew?: () => void
  onEditItem?: (item: T) => void

  emptyState?: ResourceSelectorShellEmptyState

  labels: ResourceSelectorShellLabels

  loading?: boolean
  width?: number | string
  side?: SelectorShellProps['side']
  align?: SelectorShellProps['align']
  sideOffset?: SelectorShellProps['sideOffset']
  mountStrategy?: SelectorShellMountStrategy
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
 * `multi` x `selectionType` produces four strict combinations; the caller picks one and TS enforces
 * `value` / `onChange` accordingly. `selectionType` defaults to `'id'` when omitted.
 *
 * Toolbar semantics (only rendered in multi): UX-only state, initial ON/OFF derived from value
 * length on mount (>=2 -> ON). ON = checkbox toggle; OFF = radio-in-array (replace + close).
 */
export type ResourceSelectorShellProps<T extends ResourceSelectorShellItem> =
  | ResourceSelectorShellSingleIdProps<T>
  | ResourceSelectorShellSingleItemProps<T>
  | ResourceSelectorShellMultiIdProps<T>
  | ResourceSelectorShellMultiItemProps<T>

/**
 * Normalize value of any supported shape to an id list - used internally for selection display
 * and toolbar's initial state. Handles string, string[], item object, item[], and null.
 */
function extractValueIds<T extends ResourceSelectorShellItem>(value: unknown): string[] {
  if (value === null) return []
  if (value === undefined) return []
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

const DEFAULT_RESOURCE_TAG_COLOR = '#6372bd'
const DEFAULT_MIN_LIST_HEIGHT = 144
const DEFAULT_MAX_CONTENT_HEIGHT = 360

function normalizeTag(tag: ResourceSelectorShellTag) {
  return typeof tag === 'string' ? { name: tag, color: undefined } : tag
}

function ResourceTagChip({
  tag,
  color,
  active = true,
  onClick
}: {
  tag: string
  color?: string
  active?: boolean
  onClick?: () => void
}) {
  const chip = (
    <CustomTag
      size={10}
      color={color ?? DEFAULT_RESOURCE_TAG_COLOR}
      inactive={!active}
      className={cn('h-full max-w-24 items-center overflow-hidden transition-colors', onClick && 'cursor-pointer')}>
      <span className="min-w-0 truncate">{tag}</span>
    </CustomTag>
  )

  if (!onClick) return chip

  return (
    <button type="button" aria-pressed={active} aria-label={tag} className="inline-flex h-4 p-0" onClick={onClick}>
      {chip}
    </button>
  )
}

export function ResourceSelectorShell<T extends ResourceSelectorShellItem>(props: ResourceSelectorShellProps<T>) {
  const {
    trigger,
    open: openProp,
    onOpenChange: onOpenChangeProp,
    items,
    fallbackIcon,
    tags,
    pinnedIds,
    onTogglePin,
    isPinActionDisabled = false,
    onOpen,
    onCreateNew,
    onEditItem,
    emptyState,
    labels,
    loading,
    width,
    side,
    align,
    sideOffset,
    mountStrategy
  } = props

  const isMulti = props.multi === true
  const isItemType = 'selectionType' in props && props.selectionType === 'item'

  const [internalOpen, setInternalOpen] = useState(false)
  const [shellKey, setShellKey] = useState(0)
  const open = openProp ?? internalOpen
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setInternalOpen(next)
      onOpenChangeProp?.(next)
    },
    [openProp, onOpenChangeProp]
  )

  const pendingCloseActionRef = useRef<(() => void) | null>(null)
  const runPendingCloseAction = useCallback(() => {
    const action = pendingCloseActionRef.current
    if (!action) return

    pendingCloseActionRef.current = null
    action()
  }, [])
  const closeBeforeAction = useCallback(
    (action: () => void) => {
      pendingCloseActionRef.current = action
      if (!open) {
        setShellKey((key) => key + 1)
        runPendingCloseAction()
        return
      }

      setShellKey((key) => key + 1)
      handleOpenChange(false)
    },
    [handleOpenChange, open, runPendingCloseAction]
  )

  const [searchValue, setSearchValue] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const listboxId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) return

    setSearchValue('')
    const frameId = window.requestAnimationFrame(runPendingCloseAction)
    return () => window.cancelAnimationFrame(frameId)
  }, [open, runPendingCloseAction])

  const onOpenRef = useRef(onOpen)
  useEffect(() => {
    onOpenRef.current = onOpen
  }, [onOpen])

  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      void onOpenRef.current?.()
    }
    wasOpenRef.current = open
  }, [open])

  const valueIds = useMemo(() => extractValueIds<T>(props.value), [props.value])
  const [multiEnabledLocal, setMultiEnabledLocal] = useState(false)
  const [userOptedOut, setUserOptedOut] = useState(false)
  const shouldForceMulti = isMulti && valueIds.length >= 2
  const multiEnabled = isMulti && !userOptedOut && (multiEnabledLocal || shouldForceMulti)

  useEffect(() => {
    if (isMulti && userOptedOut && valueIds.length >= 2) {
      setUserOptedOut(false)
    }
  }, [isMulti, userOptedOut, valueIds.length])

  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
  const selectedSet = useMemo(() => new Set(valueIds), [valueIds])
  const tagOptions = useMemo(() => (tags ?? []).map(normalizeTag), [tags])
  const tagColorByName = useMemo(() => new Map(tagOptions.map((tag) => [tag.name, tag.color])), [tagOptions])

  const { pinnedItems, unpinnedItems } = useMemo(() => {
    let filtered = items
    if (selectedTagIds.length > 0) {
      const wanted = new Set(selectedTagIds)
      filtered = filtered.filter((item) => item.tags?.some((tag) => wanted.has(tag)))
    }

    const query = searchValue.trim().toLowerCase()
    if (query) {
      filtered = filtered.filter(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          (item.description ? item.description.toLowerCase().includes(query) : false)
      )
    }

    const pinned = filtered.filter((item) => pinnedSet.has(item.id))
    const unpinned = filtered.filter((item) => !pinnedSet.has(item.id))
    const pinnedOrdered = pinnedIds.map((id) => pinned.find((item) => item.id === id)).filter(Boolean) as T[]
    return { pinnedItems: pinnedOrdered, unpinnedItems: unpinned }
  }, [items, pinnedIds, pinnedSet, searchValue, selectedTagIds])

  const sections = useMemo<ResourceSelectorSection<T>[]>(() => {
    const nextSections: ResourceSelectorSection<T>[] = []
    if (pinnedItems.length > 0) {
      nextSections.push({
        key: 'pinned',
        header: (
          <div className="group flex h-7 items-center gap-1 bg-popover px-3 text-[11px] text-muted-foreground">
            <span className="truncate">{labels.pinnedTitle}</span>
          </div>
        ),
        items: pinnedItems
      })
    }
    nextSections.push({ key: 'rest', items: unpinnedItems })
    return nextSections
  }, [labels.pinnedTitle, pinnedItems, unpinnedItems])

  const { flatItems, sectionOffsets } = useMemo(() => {
    const offsets: number[] = []
    const flat: T[] = []
    for (const section of sections) {
      offsets.push(flat.length)
      flat.push(...section.items)
    }
    return { flatItems: flat, sectionOffsets: offsets }
  }, [sections])

  const firstEnabledIndex = useMemo(() => flatItems.findIndex((item) => !item.disabled), [flatItems])
  const [activeIndex, setActiveIndex] = useState(-1)
  const initActiveIndex = useCallback(() => {
    const selectedIdx = flatItems.findIndex((item) => selectedSet.has(item.id) && !item.disabled)
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : firstEnabledIndex)
  }, [firstEnabledIndex, flatItems, selectedSet])

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1)
      return
    }
    initActiveIndex()
  }, [flatItems, firstEnabledIndex, initActiveIndex, open])

  const emitChange = useCallback(
    (ids: string[]) => {
      if (isMulti) {
        if (isItemType) {
          const byId = new Map<string, T>(items.map((item) => [item.id, item]))
          const mapped = ids.map((id) => byId.get(id)).filter(Boolean) as T[]
          ;(props.onChange as (value: T[]) => void)(mapped)
        } else {
          ;(props.onChange as (value: string[]) => void)(ids)
        }
        return
      }

      const id = ids[0] ?? null
      if (isItemType) {
        const item = items.find((candidate) => candidate.id === id) ?? null
        ;(props.onChange as (value: T | null) => void)(item)
      } else {
        ;(props.onChange as (value: string | null) => void)(id)
      }
    },
    [isItemType, isMulti, items, props.onChange]
  )

  const handleSelectItem = useCallback(
    (item: T) => {
      if (item.disabled) return

      if (isMulti) {
        if (multiEnabled) {
          const next = new Set(valueIds)
          if (next.has(item.id)) next.delete(item.id)
          else next.add(item.id)
          emitChange(Array.from(next))
        } else {
          emitChange([item.id])
          handleOpenChange(false)
        }
        return
      }

      emitChange([item.id])
      handleOpenChange(false)
    },
    [emitChange, handleOpenChange, isMulti, multiEnabled, valueIds]
  )

  const step = useCallback(
    (from: number, direction: 1 | -1): number => {
      if (flatItems.length === 0) return -1
      const total = flatItems.length
      let index = from
      for (let count = 0; count < total; count += 1) {
        index = (index + direction + total) % total
        if (!flatItems[index]?.disabled) return index
      }
      return -1
    },
    [flatItems]
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // Skip during IME composition: some browsers only signal via keyCode 229.
      // oxlint-disable-next-line no-deprecated
      if (event.nativeEvent.isComposing || event.keyCode === 229) return

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          setActiveIndex((index) => step(index < 0 ? -1 : index, 1))
          return
        case 'ArrowUp':
          event.preventDefault()
          setActiveIndex((index) => step(index < 0 ? flatItems.length : index, -1))
          return
        case 'Home':
          if (flatItems.length === 0) return
          event.preventDefault()
          setActiveIndex(step(-1, 1))
          return
        case 'End':
          if (flatItems.length === 0) return
          event.preventDefault()
          setActiveIndex(step(0, -1))
          return
        case 'Enter': {
          if (activeIndex < 0) return
          const item = flatItems[activeIndex]
          if (!item || item.disabled) return
          event.preventDefault()
          handleSelectItem(item)
          return
        }
      }
    },
    [activeIndex, flatItems, handleSelectItem, step]
  )

  useEffect(() => {
    if (activeIndex < 0) return
    const item = flatItems[activeIndex]
    if (!item) return
    const element = listRef.current?.querySelector<HTMLElement>(`[data-option-id="${CSS.escape(item.id)}"]`)
    element?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, flatItems])

  const activeOptionDomId =
    activeIndex >= 0 && flatItems[activeIndex] ? `${listboxId}-opt-${flatItems[activeIndex].id}` : undefined

  const togglePin = useCallback(
    (id: string) => {
      if (isPinActionDisabled) return
      void onTogglePin(id)
    },
    [isPinActionDisabled, onTogglePin]
  )

  const renderPinAction = useCallback(
    (item: T) => {
      if (item.pinnable === false) return null

      const itemId = item.id
      const isPinned = pinnedSet.has(itemId)
      return (
        <ModelSelectorRowActionButton
          disabled={item.disabled || isPinActionDisabled}
          aria-label={isPinned ? labels.unpin : labels.pin}
          className="size-4 rounded-sm hover:bg-transparent"
          pinned={isPinned}
          selected={selectedSet.has(itemId)}
          onClick={() => {
            togglePin(itemId)
          }}>
          <Pin className="size-3" />
        </ModelSelectorRowActionButton>
      )
    },
    [isPinActionDisabled, labels.pin, labels.unpin, pinnedSet, selectedSet, togglePin]
  )

  const renderEditAction = useCallback(
    (item: T) => {
      if (!onEditItem) return null
      if (item.editable === false) return null

      return (
        <ModelSelectorRowActionButton
          disabled={item.disabled}
          aria-label={labels.edit}
          className="size-4 rounded-sm hover:bg-transparent"
          onClick={() => {
            closeBeforeAction(() => onEditItem(item))
          }}>
          <SquarePen className="size-3" />
        </ModelSelectorRowActionButton>
      )
    },
    [closeBeforeAction, labels.edit, onEditItem]
  )

  const multiToggleLabel = 'multiToggleLabel' in props ? props.multiToggleLabel : null
  const multiToggleHint = 'multiToggleHint' in props ? props.multiToggleHint : undefined

  const handleMultiEnabledChange = useCallback(
    (next: boolean) => {
      setMultiEnabledLocal(next)
      setUserOptedOut(!next)
      if (next || !isMulti || valueIds.length < 2) return

      const firstId = valueIds[0]
      if (isItemType) {
        const firstItem = items.find((item) => item.id === firstId) ?? null
        ;(props.onChange as (value: T[]) => void)(firstItem ? [firstItem] : [])
      } else {
        ;(props.onChange as (value: string[]) => void)([firstId])
      }
    },
    [isItemType, isMulti, items, props.onChange, valueIds]
  )

  const filterContent =
    tagOptions.length > 0 ? (
      <>
        {labels.tagFilter ? <span className="mr-1 text-[10px] text-muted-foreground">{labels.tagFilter}</span> : null}
        {tagOptions.map((tag) => {
          const active = selectedTagIds.includes(tag.name)
          return (
            <ResourceTagChip
              key={tag.name}
              tag={tag.name}
              color={tag.color}
              active={active}
              onClick={() =>
                setSelectedTagIds((prev) =>
                  prev.includes(tag.name) ? prev.filter((value) => value !== tag.name) : [...prev, tag.name]
                )
              }
            />
          )
        })}
      </>
    ) : undefined

  const bottomAction = onCreateNew
    ? {
        icon: <Plus size={14} className="shrink-0" />,
        label: labels.createNew,
        onClick: () => closeBeforeAction(onCreateNew)
      }
    : undefined

  const renderOptionRow = (item: T, flatIndex: number) => {
    const itemDomId = item.id
    const isSelected = selectedSet.has(item.id)
    const isActive = flatIndex === activeIndex
    const editAction = renderEditAction(item)
    const pinAction = renderPinAction(item)

    const leading = item.emoji ? (
      <span className="flex size-5 shrink-0 items-center justify-center text-base leading-none">{item.emoji}</span>
    ) : fallbackIcon ? (
      <span className="flex size-5 shrink-0 items-center justify-center">{fallbackIcon}</span>
    ) : null

    const trailing =
      item.tags && item.tags.length > 0 ? (
        <div
          className="ml-2 flex h-4 max-w-[48%] shrink-0 items-center justify-end gap-1 overflow-hidden"
          data-resource-selector-tags={itemDomId}>
          {item.tags.map((tag) => (
            <ResourceTagChip key={`${itemDomId}-${tag}`} tag={tag} color={tagColorByName.get(tag)} />
          ))}
        </div>
      ) : null

    return (
      <div key={itemDomId} className="py-0.5">
        <ModelSelectorRow
          selected={isSelected}
          focused={isActive}
          disabled={item.disabled}
          showSelectedIndicator={!multiEnabled && isSelected}
          checkbox={
            multiEnabled ? (
              <Checkbox
                checked={isSelected}
                tabIndex={-1}
                aria-hidden="true"
                className={cn('pointer-events-none', MODEL_SELECTOR_ROW_CHECKBOX_CLASS)}
              />
            ) : null
          }
          leading={leading}
          trailing={trailing}
          actions={
            <>
              {editAction}
              {pinAction}
            </>
          }
          onSelect={() => handleSelectItem(item)}
          rootProps={{
            onMouseEnter: () => {
              if (!item.disabled) setActiveIndex(flatIndex)
            },
            className: 'pr-0.5',
            'data-option-row': itemDomId
          }}
          optionProps={{
            id: `${listboxId}-opt-${itemDomId}`,
            'aria-disabled': item.disabled || undefined,
            'data-option-id': itemDomId,
            'data-active': isActive || undefined
          }}>
          <span className="min-w-0 truncate" data-resource-selector-name={itemDomId}>
            {item.name}
          </span>
        </ModelSelectorRow>
      </div>
    )
  }

  const listContent = loading ? null : flatItems.length === 0 ? (
    <EmptyState
      compact
      preset={emptyState?.preset ?? 'no-result'}
      description={labels.emptyText}
      className="min-h-full px-3 py-4"
    />
  ) : (
    sections.map((section, sectionIndex) => {
      if (section.items.length === 0) return null
      const offset = sectionOffsets[sectionIndex] ?? 0
      return (
        <div key={section.key} role="group">
          {section.header != null ? (
            <div role="presentation" data-entity-section-header={section.key}>
              {section.header}
            </div>
          ) : null}
          {section.items.map((item, itemIndex) => renderOptionRow(item, offset + itemIndex))}
        </div>
      )
    })
  )

  return (
    <SelectorShell
      key={shellKey}
      trigger={trigger}
      open={open}
      onOpenChange={handleOpenChange}
      width={width ?? 320}
      side={side}
      align={align}
      sideOffset={sideOffset ?? 6}
      contentClassName="min-w-[280px]"
      mountStrategy={mountStrategy}
      maxContentHeight={DEFAULT_MAX_CONTENT_HEIGHT}
      search={{
        value: searchValue,
        onChange: setSearchValue,
        placeholder: labels.searchPlaceholder,
        inputRef: searchInputRef,
        ariaControls: listboxId,
        activeDescendant: activeOptionDomId
      }}
      filterContent={filterContent}
      multiSelect={
        isMulti
          ? {
              checked: multiEnabled,
              onCheckedChange: handleMultiEnabledChange,
              label: multiToggleLabel,
              hint: multiToggleHint
            }
          : undefined
      }
      bottomAction={bottomAction}
      contentProps={{
        onKeyDown: handleKeyDown
      }}>
      {({ availableListHeight }) => {
        const listMaxHeight =
          availableListHeight === undefined
            ? DEFAULT_MAX_CONTENT_HEIGHT
            : Math.min(DEFAULT_MAX_CONTENT_HEIGHT, availableListHeight)
        const listMinHeight =
          availableListHeight === undefined
            ? DEFAULT_MIN_LIST_HEIGHT
            : Math.min(DEFAULT_MIN_LIST_HEIGHT, availableListHeight)

        return (
          <Scrollbar
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-multiselectable={multiEnabled}
            tabIndex={-1}
            className="min-h-0 flex-1 px-1 py-1 outline-none"
            style={{ maxHeight: listMaxHeight, minHeight: listMinHeight }}>
            {listContent}
          </Scrollbar>
        )
      }}
    </SelectorShell>
  )
}
