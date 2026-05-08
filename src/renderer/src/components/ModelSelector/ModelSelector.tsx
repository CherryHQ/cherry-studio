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
import { loggerService } from '@logger'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { isDev } from '@renderer/config/constant'
import { isUniqueModelId, type Model, type UniqueModelId } from '@shared/data/types/model'
import { useNavigate } from '@tanstack/react-router'
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
import { computeCollapsedSelection, computeToggledSelection } from './selection'
import type { FlatListItem, ModelSelectorModelItem, ModelSelectorProps } from './types'
import { useModelListKeyboardNav } from './useModelListKeyboardNav'
import { useModelSelectorData } from './useModelSelectorData'
import { getProviderDisplayName } from './utils'

const logger = loggerService.withContext('ModelSelector')

const PAGE_SIZE = 12
const ITEM_HEIGHT = 36
const ROW_TAG_SIZE = 8
const FILTER_TAG_SIZE = 10

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

function getMalformedSelectionWarning(
  props: ModelSelectorProps
): { message: string; context: Record<string, unknown> } | null {
  if (props.multiple) {
    if (props.selectionType === 'id') {
      const value = props.value
      return value !== undefined && !Array.isArray(value)
        ? {
            message: 'normalizeSelectedIdsFromValue: multiple=true but value is not an array; coercing to []',
            context: { selectionType: 'id', valueType: typeof value }
          }
        : null
    }

    const value = props.value
    return value !== undefined && !Array.isArray(value)
      ? {
          message: 'normalizeSelectedIdsFromValue: multiple=true but value is not an array; coercing to []',
          context: { selectionType: 'model', valueType: typeof value }
        }
      : null
  }

  if (props.selectionType === 'id') {
    const value = props.value
    return value !== undefined && Array.isArray(value)
      ? {
          message: 'normalizeSelectedIdsFromValue: multiple=false but value is an array; coercing to []',
          context: { selectionType: 'id', valueLength: value.length }
        }
      : null
  }

  const value = props.value
  return value !== undefined && Array.isArray(value)
    ? {
        message: 'normalizeSelectedIdsFromValue: multiple=false but value is an array; coercing to []',
        context: { selectionType: 'model', valueLength: value.length }
      }
    : null
}

function normalizeSelectedIdsFromValue(props: ModelSelectorProps): UniqueModelId[] {
  // Narrow on the discriminator pair directly so each branch operates on the
  // variant-specific `value` type — no wide `ModelSelectorValue` needed.
  if (props.multiple) {
    if (props.selectionType === 'id') {
      const value = props.value
      const ids = Array.isArray(value)
        ? value.filter((modelId): modelId is UniqueModelId => typeof modelId === 'string' && isUniqueModelId(modelId))
        : []
      return dedupeSelectedIds(ids)
    }

    const value = props.value
    const modelValues = Array.isArray(value) ? value : []
    const ids = modelValues.flatMap((candidate) => (candidate?.id ? [candidate.id] : []))
    return dedupeSelectedIds(ids)
  }

  if (props.selectionType === 'id') {
    const value = props.value
    return typeof value === 'string' && isUniqueModelId(value) ? dedupeSelectedIds([value]) : []
  }

  const value = props.value
  return value?.id ? dedupeSelectedIds([value.id]) : []
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
  showPinActions,
  isPinActionDisabled,
  t
}: {
  item: ModelSelectorModelItem
  isFocused: boolean
  onPin: (modelId: UniqueModelId) => void
  onSelect: (item: ModelSelectorModelItem) => void
  onNavigateBeforeTrial: () => void
  showCheckbox: boolean
  showPinActions: boolean
  isPinActionDisabled: boolean
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
      {showPinActions && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={isPinActionDisabled}
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
      )}
    </div>
  )
}

export function ModelSelector(props: ModelSelectorProps) {
  const {
    trigger,
    open: openProp,
    onOpenChange,
    dataOverride,
    filter,
    showTagFilter = true,
    showPinnedModels = true,
    showPinActions = true,
    prioritizedProviderIds = [],
    side = 'bottom',
    align = 'start',
    sideOffset = 4,
    contentClassName,
    listVisibleCount = PAGE_SIZE,
    multiSelectMode: multiSelectModeProp,
    defaultMultiSelectMode = false,
    onMultiSelectModeChange
  } = props
  const { t } = useTranslation()
  const navigate = useNavigate()
  // `multiple` is required-literal on the union, so reading it directly gives
  // a proper boolean for conditional UI branches. Narrowing to the specific
  // variant happens at the `onSelect` / `value` touchpoints below (see
  // `emitSelection` / `normalizeSelectedIdsFromValue`).
  const multiple = props.multiple
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
  const focusScrollFrameRef = useRef<number | null>(null)
  const malformedSelectionWarningKeyRef = useRef<string | null>(null)
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
      if (focusScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(focusScrollFrameRef.current)
      }
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
    () => normalizeSelectedIdsFromValue(props),
    // Narrowing is driven by the three discriminators — any of them changing
    // means `props.value` may be typed differently too.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- these discriminators intentionally cover the relevant prop shape.
    [props.multiple, props.selectionType, props.value]
  )

  const {
    availableTags,
    isLoading,
    isPinActionDisabled,
    listItems,
    modelItems,
    refetchPinnedModels,
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
    providersOverride: dataOverride?.providers,
    modelsOverride: dataOverride?.models,
    isDataLoadingOverride: dataOverride?.isLoading,
    searchText: deferredSearchText,
    filter,
    prioritizedProviderIds,
    showPinnedModels,
    showTagFilter
  })
  const listItemsRef = useRef(listItems)
  const modelItemsRef = useRef(modelItems)
  listItemsRef.current = listItems
  modelItemsRef.current = modelItems

  const listHeight = useMemo(
    () => Math.min(listVisibleCount, listItems.length || 1) * ITEM_HEIGHT,
    [listItems.length, listVisibleCount]
  )
  const selectedTagsKey = useMemo(() => selectedTags.join('|'), [selectedTags])

  const emitSelection = useCallback(
    (nextSelectedIds: UniqueModelId[]) => {
      // Switch on the discriminator pair; TS narrows `props` (and therefore
      // `props.onSelect`) to the matching variant in each branch. No casts.
      if (props.multiple) {
        if (props.selectionType === 'id') {
          props.onSelect(nextSelectedIds)
          return
        }

        props.onSelect(modelsFromSelectedIds(nextSelectedIds, selectableModelsById))
        return
      }

      const nextSelectedId = nextSelectedIds[0]
      if (props.selectionType === 'id') {
        props.onSelect(nextSelectedId)
        return
      }

      props.onSelect(nextSelectedId ? selectableModelsById.get(nextSelectedId) : undefined)
    },
    [props, selectableModelsById]
  )

  const focusItem = useCallback(
    (key: string) => {
      setFocusedItemKey(key)
      const index = listItemsRef.current.findIndex((item) => item.key === key)
      if (index >= 0) {
        if (focusScrollFrameRef.current !== null) {
          window.cancelAnimationFrame(focusScrollFrameRef.current)
        }
        focusScrollFrameRef.current = window.requestAnimationFrame(() => {
          focusScrollFrameRef.current = null
          listRef.current?.scrollToIndex(index, { align: 'auto' })
        })
      }
    },
    [setFocusedItemKey]
  )

  const handleSelectItem = useCallback(
    (item: ModelSelectorModelItem) => {
      skipNextFocusScroll.current = true

      if (multiple && multiSelectMode) {
        emitSelection(computeToggledSelection(rawSelectedModelIds, item.modelId))
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
      navigate({ to: '/settings/provider', search: { id: providerId } }).catch((error) => {
        logger.error('Failed to navigate to provider settings', error as Error, { providerId })
      })
    },
    [navigate, setOpen]
  )

  const handleTogglePin = useCallback(
    (modelId: UniqueModelId) => {
      if (isPinActionDisabled) {
        return
      }

      skipNextFocusScroll.current = true
      togglePin(modelId).catch((error) => {
        logger.error('Failed to toggle model pin', error as Error, { modelId })
        window.toast?.error(t('common.error'))
      })
    },
    [isPinActionDisabled, t, togglePin]
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

      const collapsed = computeCollapsedSelection(resolvedSelectedModelIds, rawSelectedModelIds)
      if (collapsed !== null) {
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
    pageSize: listVisibleCount
  })

  useEffect(() => {
    if (!isDev) {
      return
    }

    const warning = getMalformedSelectionWarning(props)
    if (!warning) {
      return
    }

    const warningKey = `${warning.message}:${JSON.stringify(warning.context)}`
    if (malformedSelectionWarningKeyRef.current === warningKey) {
      return
    }

    malformedSelectionWarningKeyRef.current = warningKey
    logger.warn(warning.message, warning.context)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the warning only depends on the discriminator subset above.
  }, [props.multiple, props.selectionType, props.value])

  useEffect(() => {
    if (!open) {
      return undefined
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (open && showPinnedModels) {
      void refetchPinnedModels()
    }
  }, [open, refetchPinnedModels, showPinnedModels])

  useEffect(() => {
    if (!open) {
      setSearchText('')
      setFocusedItemKey('')
      resetTags()
    }
  }, [open, resetTags, setFocusedItemKey])

  useEffect(() => {
    const currentModelItems = modelItemsRef.current
    if (!open || isLoading || currentModelItems.length === 0) {
      return
    }

    if (skipNextFocusScroll.current) {
      skipNextFocusScroll.current = false
      return
    }

    const targetKey =
      deferredSearchText || selectedTagsKey.length > 0
        ? currentModelItems[0]?.key
        : (currentModelItems.find((item) => item.isSelected)?.key ?? currentModelItems[0]?.key)

    if (targetKey) {
      focusItem(targetKey)
    }
  }, [deferredSearchText, focusItem, isLoading, open, selectedTagsKey])

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
                  onClick={(event) => {
                    event.stopPropagation()
                    handleNavigateToProviderSettings(item.provider!.id)
                  }}>
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
            isPinActionDisabled={isPinActionDisabled}
            onPin={handleTogglePin}
            onSelect={handleSelectItem}
            onNavigateBeforeTrial={handleClose}
            showCheckbox={multiple && multiSelectMode}
            showPinActions={showPinActions}
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
      isPinActionDisabled,
      multiple,
      multiSelectMode,
      setFocusedItemKey,
      showPinActions,
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
            <span className="min-w-0 truncate text-[10px] text-muted-foreground">{t('models.multi_select.label')}</span>
            <Switch
              checked={multiSelectMode}
              size="sm"
              data-testid="model-selector-multi-select-switch"
              onCheckedChange={handleMultiSelectModeChange}
            />
          </div>
        )}

        {listItems.length > 0 ? (
          <div className="px-1 py-1" role="listbox" aria-multiselectable={multiple && multiSelectMode}>
            <DynamicVirtualList
              ref={listRef}
              list={listItems}
              size={listHeight}
              estimateSize={() => ITEM_HEIGHT}
              getItemKey={(index) => listItems[index].key}
              isSticky={(index) => listItems[index].type === 'group'}
              scrollPaddingStart={ITEM_HEIGHT}
              onScroll={handleListScroll}
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
