import {
  Avatar,
  AvatarFallback,
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { resolveIcon } from '@cherrystudio/ui/icons'
import { cn } from '@cherrystudio/ui/lib/utils'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { isUniqueModelId, type Model, type UniqueModelId } from '@shared/data/types/model'
import { first } from 'lodash'
import { Pin, Search, Settings2 } from 'lucide-react'
import {
  isValidElement,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { matchesModelTag, MODEL_SELECTOR_TAGS } from './filters'
import { FreeTrialModelTag } from './FreeTrialModelTag'
import { ModelTagChip } from './ModelTagChip'
import type { FlatListItem, ModelSelectorModelItem, ModelSelectorProps, ModelSelectorSelectionType } from './types'
import { useModelListKeyboardNav } from './useModelListKeyboardNav'
import { useModelSelectorData } from './useModelSelectorData'
import { getProviderDisplayName } from './utils'

const PAGE_SIZE = 12
const ITEM_HEIGHT = 36
const ROW_TAG_SIZE = 8
const FILTER_TAG_SIZE = 10

type ModelSelectorValue = Model | UniqueModelId | Model[] | UniqueModelId[] | undefined

function dedupeSelectedIds(ids: readonly UniqueModelId[]): UniqueModelId[] {
  const nextSelectedIds: UniqueModelId[] = []
  const seen = new Set<UniqueModelId>()

  for (const modelId of ids) {
    if (seen.has(modelId)) {
      continue
    }

    seen.add(modelId)
    nextSelectedIds.push(modelId)
  }

  return nextSelectedIds
}

function areSelectedIdsEqual(left: readonly UniqueModelId[], right: readonly UniqueModelId[]) {
  return left.length === right.length && left.every((modelId, index) => modelId === right[index])
}

function normalizeSelectedIdsFromValue(
  value: ModelSelectorValue,
  selectionType: ModelSelectorSelectionType,
  multiple: boolean
): UniqueModelId[] {
  if (selectionType === 'id') {
    const candidateIds = multiple
      ? Array.isArray(value)
        ? value.filter((modelId): modelId is UniqueModelId => typeof modelId === 'string' && isUniqueModelId(modelId))
        : []
      : typeof value === 'string' && isUniqueModelId(value)
        ? [value]
        : []

    return dedupeSelectedIds(candidateIds)
  }

  const candidateValues = multiple ? (Array.isArray(value) ? value : []) : value && !Array.isArray(value) ? [value] : []
  const candidateIds = candidateValues.flatMap((candidate) => {
    if (candidate && typeof candidate === 'object' && 'id' in candidate && candidate.id) {
      return [candidate.id]
    }

    return []
  })

  return dedupeSelectedIds(candidateIds)
}

function modelsFromSelectedIds(
  selectedIds: readonly UniqueModelId[],
  selectableModelsById: ReadonlyMap<UniqueModelId, Model>
) {
  return selectedIds.flatMap((modelId) => {
    const model = selectableModelsById.get(modelId)
    return model ? [model] : []
  })
}

function ModelRow({
  item,
  isFocused,
  onPin,
  onSelect,
  onNavigateBeforeTrial,
  showCheckbox,
  t
}: {
  item: ModelSelectorModelItem
  isFocused: boolean
  onPin: (modelId: UniqueModelId) => void
  onSelect: (item: ModelSelectorModelItem) => void
  onNavigateBeforeTrial: () => void
  showCheckbox: boolean
  t: (key: string) => string
}) {
  const icon = resolveIcon(item.modelIdentifier, item.provider.id)
  const rowTags = useMemo(() => MODEL_SELECTOR_TAGS.filter((tag) => matchesModelTag(item.model, tag)), [item.model])
  const providerName = getProviderDisplayName(item.provider)
  const isCherryAi = item.provider.id === 'cherryai'

  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={item.isSelected}
      className={cn(
        'group relative flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-xs transition-colors',
        item.isSelected && 'bg-primary/10 text-foreground',
        !item.isSelected && isFocused && 'bg-accent/60',
        !item.isSelected && !isFocused && 'text-foreground hover:bg-accent/60'
      )}
      data-testid={`model-selector-item-${item.modelId}`}
      onClick={() => onSelect(item)}>
      {!showCheckbox && item.isSelected && (
        <span
          aria-hidden="true"
          className="-translate-y-1/2 absolute top-1/2 left-0 block h-[60%] w-0.75 rounded-4xs bg-primary/40"
        />
      )}
      {showCheckbox && (
        <Checkbox
          checked={item.isSelected}
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none"
          data-testid={`model-selector-checkbox-${item.modelId}`}
        />
      )}
      {/* 左侧：图标 + 名称 */}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {icon ? (
          <icon.Avatar size={20} />
        ) : (
          <Avatar size="sm">
            <AvatarFallback>{first(item.model.name) || 'M'}</AvatarFallback>
          </Avatar>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate">{item.model.name}</span>
          {item.showIdentifier && item.modelIdentifier !== item.model.name && (
            <span className="max-w-[45%] truncate font-mono text-muted-foreground text-xs" title={item.modelIdentifier}>
              {item.modelIdentifier}
            </span>
          )}
          {item.isPinned && <span className="shrink-0 truncate text-muted-foreground text-xs">| {providerName}</span>}
          {isCherryAi && (
            <FreeTrialModelTag model={item.model} showLabel={false} onBeforeNavigate={onNavigateBeforeTrial} />
          )}
        </div>
      </div>
      {/* 右侧：tags — 容器固定 h-4，所有 tag h-full + items-center，消除 SVG/iconfont/纯文字渲染高度差 */}
      {rowTags.length > 0 && (
        <div className="ml-2 flex h-4 max-w-[65%] shrink-0 items-center justify-end gap-1 overflow-hidden">
          {rowTags.map((tag) => (
            <ModelTagChip
              key={`${item.key}-${tag}`}
              tag={tag}
              size={ROW_TAG_SIZE}
              showLabel={false}
              showTooltip
              className="h-full items-center"
            />
          ))}
        </div>
      )}
      {/* Pin 按钮 — 悬浮/置顶时显示 */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t(item.isPinned ? 'models.action.unpin' : 'models.action.pin')}
        className={cn(
          'ml-1 size-5 shrink-0 text-muted-foreground opacity-0 transition hover:opacity-100! group-hover:opacity-60',
          item.isPinned && '-rotate-45 text-primary opacity-100'
        )}
        onClick={(event) => {
          event.stopPropagation()
          onPin(item.modelId)
        }}>
        <Pin className="size-3" />
      </Button>
    </div>
  )
}

export function ModelSelector(props: ModelSelectorProps) {
  const {
    trigger,
    open: openProp,
    onOpenChange,
    filter,
    showTagFilter = true,
    showPinnedModels = true,
    prioritizedProviderIds = [],
    side = 'bottom',
    align = 'start',
    sideOffset = 4,
    contentClassName,
    multiSelectMode: multiSelectModeProp,
    defaultMultiSelectMode = false,
    onMultiSelectModeChange
  } = props
  const { t } = useTranslation()
  const multiple = props.multiple === true
  const selectionType = props.selectionType ?? 'model'
  const value = props.value
  const onSelect = props.onSelect
  const [internalOpen, setInternalOpen] = useState(false)
  const [internalMultiSelectMode, setInternalMultiSelectMode] = useState(defaultMultiSelectMode)
  const [searchText, setSearchText] = useState('')
  const deferredSearchText = useDeferredValue(searchText)
  const [focusedItemKey, _setFocusedItemKey] = useState('')
  // 用 startTransition 包裹：滚动时虚拟列表内部可能已进入 layout lifecycle（flushSync），
  // 此时 onMouseEnter 同步 setState 会与之冲突，转为 transition 避免竞争。
  const setFocusedItemKey = useCallback((key: string) => {
    startTransition(() => _setFocusedItemKey(key))
  }, [])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<DynamicVirtualListRef>(null)
  const skipNextFocusScroll = useRef(false)
  // 标记列表是否正在滚动：滚动期间 onMouseEnter 跳过 setFocusedItemKey，
  // 避免与 virtualizer measureElement 的 flushSync 在同一 commit phase 冲突。
  const isScrollingRef = useRef(false)
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleListScroll = useCallback(() => {
    isScrollingRef.current = true
    if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current)
    scrollIdleTimerRef.current = setTimeout(() => {
      isScrollingRef.current = false
    }, 150)
  }, [])

  useEffect(() => {
    return () => {
      if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current)
    }
  }, [])

  const open = openProp ?? internalOpen
  const multiSelectMode = multiple ? (multiSelectModeProp ?? internalMultiSelectMode) : false
  const triggerNode = isValidElement(trigger) ? trigger : <span>{trigger}</span>

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (openProp === undefined) {
        setInternalOpen(nextOpen)
      }
      onOpenChange?.(nextOpen)
    },
    [onOpenChange, openProp]
  )

  const setMultiSelectMode = useCallback(
    (nextEnabled: boolean) => {
      if (!multiple) {
        return
      }

      if (multiSelectModeProp === undefined) {
        setInternalMultiSelectMode(nextEnabled)
      }
      onMultiSelectModeChange?.(nextEnabled)
    },
    [multiSelectModeProp, multiple, onMultiSelectModeChange]
  )

  const rawSelectedModelIds = useMemo(
    () => normalizeSelectedIdsFromValue(value as ModelSelectorValue, selectionType, multiple),
    [multiple, selectionType, value]
  )

  const {
    availableTags,
    isLoading,
    listItems,
    modelItems,
    resetTags,
    resolvedSelectedModelIds,
    selectableModelsById,
    selectedTags,
    tagSelection,
    togglePin,
    toggleTag
  } = useModelSelectorData({
    selectedModelIds: rawSelectedModelIds,
    maxSelectedCount: multiple && multiSelectMode ? undefined : 1,
    searchText: deferredSearchText,
    filter,
    prioritizedProviderIds,
    showPinnedModels,
    showTagFilter
  })

  const listHeight = useMemo(() => Math.min(PAGE_SIZE, listItems.length || 1) * ITEM_HEIGHT, [listItems.length])

  const emitSelection = useCallback(
    (nextSelectedIds: UniqueModelId[]) => {
      if (multiple) {
        if (selectionType === 'id') {
          ;(onSelect as (modelIds: UniqueModelId[]) => void)(nextSelectedIds)
          return
        }

        ;(onSelect as (models: Model[]) => void)(modelsFromSelectedIds(nextSelectedIds, selectableModelsById))
        return
      }

      const nextSelectedId = nextSelectedIds[0]
      if (selectionType === 'id') {
        ;(onSelect as (modelId: UniqueModelId | undefined) => void)(nextSelectedId)
        return
      }

      ;(onSelect as (model: Model | undefined) => void)(
        nextSelectedId ? selectableModelsById.get(nextSelectedId) : undefined
      )
    },
    [multiple, onSelect, selectableModelsById, selectionType]
  )

  const focusItem = useCallback(
    (key: string) => {
      setFocusedItemKey(key)
      const index = listItems.findIndex((item) => item.key === key)
      if (index >= 0) {
        requestAnimationFrame(() => {
          listRef.current?.scrollToIndex(index, { align: 'auto' })
        })
      }
    },
    [listItems, setFocusedItemKey]
  )

  const handleSelectItem = useCallback(
    (item: ModelSelectorModelItem) => {
      skipNextFocusScroll.current = true

      if (multiple && multiSelectMode) {
        // 用 rawSelectedModelIds 作为 toggle 基底：保留业务侧存的所有 ID（包括当前 provider 禁用的），
        // 否则 toggle 一次就会把"暂时不可选"的 ID 静默抹掉
        const nextSelectedIds = rawSelectedModelIds.includes(item.modelId)
          ? rawSelectedModelIds.filter((modelId) => modelId !== item.modelId)
          : [...rawSelectedModelIds, item.modelId]

        emitSelection(nextSelectedIds)
        return
      }

      emitSelection([item.modelId])
      setOpen(false)
    },
    [emitSelection, multiple, multiSelectMode, rawSelectedModelIds, setOpen]
  )

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  const handleNavigateToProviderSettings = useCallback(
    (providerId: string) => {
      setOpen(false)
      void window.navigate?.({ to: '/settings/provider', search: { id: providerId } })
    },
    [setOpen]
  )

  const handleTogglePin = useCallback(
    (modelId: UniqueModelId) => {
      skipNextFocusScroll.current = true
      void togglePin(modelId)
    },
    [togglePin]
  )

  const handleMultiSelectModeChange = useCallback(
    (nextEnabled: boolean) => {
      if (!multiple) {
        return
      }

      skipNextFocusScroll.current = true
      setMultiSelectMode(nextEnabled)

      // 只在关闭方向回写业务 value：塌缩到首个有效 ID，保证 UI 和 value 一致（稳定性诉求）。
      // 打开方向不 emit —— 业务 value 保持原样，由 visibleSelectedModelIdSet 自行决定 UI 显示。
      if (nextEnabled) {
        return
      }

      const collapsed = resolvedSelectedModelIds.slice(0, 1)
      if (!areSelectedIdsEqual(collapsed, rawSelectedModelIds)) {
        emitSelection(collapsed)
      }
    },
    [emitSelection, multiple, rawSelectedModelIds, resolvedSelectedModelIds, setMultiSelectMode]
  )

  useModelListKeyboardNav({
    open,
    focusedItemKey,
    items: modelItems,
    onClose: handleClose,
    onFocusItem: focusItem,
    onSelectItem: handleSelectItem,
    pageSize: PAGE_SIZE
  })

  useEffect(() => {
    if (!open) {
      return undefined
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) {
      setSearchText('')
      setFocusedItemKey('')
      resetTags()
    }
  }, [open, resetTags, setFocusedItemKey])

  useEffect(() => {
    if (!open || isLoading || modelItems.length === 0) {
      return
    }

    if (skipNextFocusScroll.current) {
      skipNextFocusScroll.current = false
      return
    }

    const targetKey =
      deferredSearchText || selectedTags.length > 0
        ? modelItems[0]?.key
        : (modelItems.find((item) => item.isSelected)?.key ?? modelItems[0]?.key)

    if (targetKey) {
      focusItem(targetKey)
    }
  }, [deferredSearchText, focusItem, isLoading, modelItems, open, selectedTags.length])

  const rowRenderer = useCallback(
    (item: FlatListItem) => {
      if (item.type === 'group') {
        const groupTitle =
          item.groupKind === 'pinned' ? t('models.pinned') : item.provider ? getProviderDisplayName(item.provider) : ''

        return (
          <div className="group flex h-7 items-center gap-1 bg-popover px-3 text-[11px] text-muted-foreground">
            <span className="truncate">{groupTitle}</span>
            {item.provider && item.canNavigateToSettings && (
              <Tooltip content={t('navigate.provider_settings')} delay={500}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('navigate.provider_settings')}
                  className="size-4 shrink-0 text-muted-foreground opacity-0 transition hover:opacity-100! group-hover:opacity-60"
                  onClick={() => handleNavigateToProviderSettings(item.provider!.id)}>
                  <Settings2 className="size-3" />
                </Button>
              </Tooltip>
            )}
          </div>
        )
      }

      return (
        // 静态时 onMouseEnter 同步 focusedItemKey（让 Enter 命中鼠标所在行）。
        // 滚动中通过 isScrollingRef 跳过 setState，避免与 virtualizer flushSync 竞争。
        <div
          className="py-0.5"
          onMouseEnter={() => {
            if (isScrollingRef.current) return
            setFocusedItemKey(item.key)
          }}>
          <ModelRow
            item={item}
            isFocused={focusedItemKey === item.key}
            onPin={handleTogglePin}
            onSelect={handleSelectItem}
            onNavigateBeforeTrial={handleClose}
            showCheckbox={multiple && multiSelectMode}
            t={t}
          />
        </div>
      )
    },
    [
      focusedItemKey,
      handleClose,
      handleNavigateToProviderSettings,
      handleSelectItem,
      handleTogglePin,
      multiple,
      multiSelectMode,
      setFocusedItemKey,
      t
    ]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{triggerNode}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn('max-h-140 w-90 overflow-hidden rounded-2xs p-0 py-1', contentClassName)}
        data-testid="model-selector-content">
        <div className="flex items-center gap-2 border-border/60 border-b px-3 py-2.5">
          <Search className="pointer-events-none size-3.25 shrink-0 text-muted-foreground/50" />
          <Input
            ref={inputRef}
            value={searchText}
            autoFocus
            spellCheck={false}
            placeholder={t('models.search.placeholder')}
            className={cn(
              'h-auto flex-1 border-0 bg-transparent p-0 shadow-none transition-none',
              'text-xs md:text-xs',
              'focus-visible:border-transparent focus-visible:ring-0',
              'placeholder:text-muted-foreground/40'
            )}
            data-testid="model-selector-search"
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter'].includes(event.key)) {
                event.preventDefault()
              }
            }}
          />
        </div>

        {showTagFilter && availableTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-border/60 border-b px-3 py-2">
            <span className="mr-1 text-[10px] text-muted-foreground">{t('models.filter.by_tag')}</span>
            {availableTags.map((tag) => (
              <ModelTagChip
                key={`filter-${tag}`}
                tag={tag}
                size={FILTER_TAG_SIZE}
                showLabel
                inactive={!tagSelection[tag]}
                onClick={() => toggleTag(tag)}
                className="transition-colors"
              />
            ))}
          </div>
        )}

        {multiple && (
          <div
            className="flex items-center justify-between gap-3 border-border/60 border-b px-3 py-2"
            data-testid="model-selector-multi-select-row">
            <span className="min-w-0 truncate text-[10px] text-muted-foreground">
              {t('models.multi_select.title')}
              {t('models.multi_select.mutually_exclusive')}
            </span>
            <Switch
              checked={multiSelectMode}
              size="sm"
              data-testid="model-selector-multi-select-switch"
              onCheckedChange={handleMultiSelectModeChange}
            />
          </div>
        )}

        {listItems.length > 0 ? (
          <div
            className="px-1 py-1"
            role="listbox"
            aria-multiselectable={multiple && multiSelectMode}
            onScroll={handleListScroll}>
            <DynamicVirtualList
              ref={listRef}
              list={listItems}
              size={listHeight}
              estimateSize={() => ITEM_HEIGHT}
              getItemKey={(index) => listItems[index].key}
              isSticky={(index) => listItems[index].type === 'group'}
              scrollPaddingStart={ITEM_HEIGHT}
              overscan={6}>
              {rowRenderer}
            </DynamicVirtualList>
          </div>
        ) : (
          <div
            className="flex items-center justify-center px-3 py-4 text-muted-foreground text-xs"
            data-testid="model-selector-empty">
            {t('models.no_matches')}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
