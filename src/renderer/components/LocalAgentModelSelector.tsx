import { LockKeyhole, Settings2 } from 'lucide-react'
import {
  type ReactElement,
  type ReactNode,
  startTransition,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { PortalContainerProvider } from '@cherrystudio/ui'
import { groupLocalAgentModels } from '@renderer/components/localAgent/groupLocalAgentModels'
import { LocalAgentModelAvatar } from '@renderer/components/localAgent/LocalAgentModelAvatar'
import {
  MODEL_SELECTOR_CONTENT_HEIGHT,
  MODEL_SELECTOR_TAGS,
  MODEL_SELECTOR_WIDTH,
  ModelSelectorFilterTags,
  ModelSelectorRow,
  type ModelSelectorTag,
  useModelListKeyboardNav
} from '@renderer/components/ModelSelector'
import { SelectorShell } from '@renderer/components/SelectorShell'
import { ModelTag } from '@renderer/components/tags/Model'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import type {
  LocalAgentModelOption,
  LocalAgentModelSourceRestrictions
} from '@renderer/hooks/agent/useLocalAgentModelSelection'
import { classifyLocalAgentError } from '@renderer/utils/agent/localAgentError'
import { cn } from '@renderer/utils/style'

type ModelOption = { key: string; model?: LocalAgentModelOption; label: string; restriction?: string }
type ModelSelectorListRow = { type: 'group'; key: string; label: string } | ({ type: 'option' } & ModelOption)

const GROUP_HEADER_HEIGHT = 28

interface LocalAgentModelSelectorProps {
  trigger: ReactElement
  models: LocalAgentModelOption[]
  presetId?: string
  sourceRestrictions?: LocalAgentModelSourceRestrictions
  followCliLabel?: string
  value?: string
  disabled?: boolean
  loading?: boolean
  loaded?: boolean
  error?: string
  onOpenSettings?: () => void
  footer?: ReactNode
  side?: 'top' | 'bottom'
  onLoad: () => void | Promise<void>
  onSelect: (value?: string) => Promise<boolean>
}

export function LocalAgentModelSelector({
  trigger,
  models,
  presetId,
  sourceRestrictions,
  followCliLabel,
  value,
  disabled,
  loading,
  loaded,
  error,
  onOpenSettings,
  footer,
  side = 'bottom',
  onLoad,
  onSelect
}: LocalAgentModelSelectorProps) {
  const { t } = useTranslation()
  const classifiedError = error ? classifyLocalAgentError(error) : undefined
  const regionRestricted = classifiedError?.kind === 'region'
  const authenticationRequired = regionRestricted || classifiedError?.kind === 'authentication'
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [focusedKey, setFocusedKey] = useState('')
  const [virtualList, setVirtualList] = useState<DynamicVirtualListRef | null>(null)
  const pointerFocusKey = useRef('')
  const [tagSelection, setTagSelection] = useState<Record<ModelSelectorTag, boolean>>(
    () => Object.fromEntries(MODEL_SELECTOR_TAGS.map((tag) => [tag, false])) as Record<ModelSelectorTag, boolean>
  )
  const listboxId = useId()
  const availableTags = useMemo(
    () => MODEL_SELECTOR_TAGS.filter((tag) => models.some((model) => model.tags?.includes(tag))),
    [models]
  )
  const resetFocus = () => {
    pointerFocusKey.current = ''
    setFocusedKey('')
  }
  const toggleTag = (tag: ModelSelectorTag) => {
    setTagSelection((prev) => ({ ...prev, [tag]: !prev[tag] }))
    resetFocus()
  }
  const resetTags = () =>
    setTagSelection(
      Object.fromEntries(MODEL_SELECTOR_TAGS.map((tag) => [tag, false])) as Record<ModelSelectorTag, boolean>
    )
  const { rows, items, optionIndexes } = useMemo(() => {
    const rows: ModelSelectorListRow[] = []
    const items: ModelOption[] = []
    const optionIndexes = new Map<string, number>()
    if (!open) return { rows, items, optionIndexes }

    const selectedTags = availableTags.filter((tag) => tagSelection[tag])
    const groups = groupLocalAgentModels(models, {
      officialLabel: t('local_agents.model_sources.native'),
      ungroupedLabel: t('models.group.ungrouped'),
      followCliLabel,
      search: searchText,
      value
    })
    for (const { key, label, entries } of groups) {
      const visible = selectedTags.length
        ? entries.filter(({ model }) => selectedTags.every((tag) => model?.tags?.includes(tag)))
        : entries
      if (!visible.length) continue
      rows.push({ type: 'group', key, label })
      for (const { key, label, model } of visible) {
        const item = { key, label, model, restriction: sourceRestrictions?.[model?.source ?? 'native'] }
        optionIndexes.set(item.key, rows.length)
        rows.push({ ...item, type: 'option' })
        if (!disabled && !item.restriction) items.push(item)
      }
    }
    return { rows, items, optionIndexes }
  }, [availableTags, disabled, followCliLabel, models, open, searchText, sourceRestrictions, t, tagSelection, value])
  const selectedKey = value ? `model:${value}` : 'follow-cli'
  const activeKey = items.some(({ key }) => key === focusedKey)
    ? focusedKey
    : optionIndexes.has(selectedKey)
      ? selectedKey
      : items[0]?.key
  const activeIndex = activeKey === undefined ? undefined : optionIndexes.get(activeKey)
  const keepMountedIndexes = useMemo(() => (activeIndex === undefined ? [] : [activeIndex]), [activeIndex])
  const getRowKey = useCallback((index: number) => `${rows[index].type}:${rows[index].key}`, [rows])
  const isStickyGroup = useCallback((index: number) => rows[index].type === 'group', [rows])
  const estimateRowSize = useCallback(
    (index: number) => (isStickyGroup(index) ? GROUP_HEADER_HEIGHT : 36),
    [isStickyGroup]
  )
  const optionId = (key: string) => `${listboxId}-${encodeURIComponent(key)}`
  const select = async ({ model, restriction }: ModelOption) => {
    if (disabled || restriction) return
    if (await onSelect(model?.id)) setOpen(false)
  }
  useModelListKeyboardNav({
    open,
    focusedItemKey: activeKey ?? '',
    items,
    onClose: () => setOpen(false),
    onFocusItem: (key) => {
      pointerFocusKey.current = ''
      setFocusedKey(key)
    },
    onSelectItem: (item) => void select(item)
  })
  useLayoutEffect(() => {
    if (open && activeIndex !== undefined && pointerFocusKey.current !== activeKey) {
      virtualList?.scrollToIndex(activeIndex, { align: 'auto' })
    }
  }, [activeIndex, activeKey, open, virtualList])
  return (
    <SelectorShell
      trigger={trigger}
      open={open}
      onOpenChange={(next) => {
        setSearchText('')
        resetFocus()
        resetTags()
        setOpen(next)
        if (next && !loaded && !loading && !disabled) void onLoad()
      }}
      width={MODEL_SELECTOR_WIDTH}
      contentHeight={MODEL_SELECTOR_CONTENT_HEIGHT}
      side={side}
      search={{
        value: searchText,
        onChange: (text) => {
          setSearchText(text)
          resetFocus()
        },
        placeholder: t('models.search.placeholder'),
        ariaControls: rows.length > 0 ? listboxId : undefined,
        activeDescendant: activeKey ? optionId(activeKey) : undefined,
        onKeyDown: (event) => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter'].includes(event.key)) event.preventDefault()
        }
      }}
      filterContent={
        availableTags.length > 0 && (
          <ModelSelectorFilterTags tags={availableTags} tagSelection={tagSelection} onToggleTag={toggleTag} />
        )
      }
      bottomAction={
        onOpenSettings
          ? {
              icon: <Settings2 className="size-3.5" />,
              label: t('local_agents.title'),
              onClick: () => {
                setOpen(false)
                onOpenSettings()
              }
            }
          : undefined
      }>
      {({ contentElement }) => (
        <PortalContainerProvider container={contentElement ?? null}>
          <div className="flex h-full min-h-0 flex-col">
            {(error || footer || (!footer && !loading && loaded && !models.length)) && (
              <div className="shrink-0 space-y-2 border-b border-border-subtle px-3 py-2 text-xs">
                {error && (
                  <div role="alert" className="flex gap-2">
                    {authenticationRequired && (
                      <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <p className={cn('min-w-0 break-words', !authenticationRequired && 'text-destructive')}>
                      {authenticationRequired
                        ? t(regionRestricted ? 'local_agents.auth_region_unavailable' : 'local_agents.sign_in_required')
                        : classifiedError?.message}
                    </p>
                  </div>
                )}
                {!footer && !loading && !error && loaded && !models.length && (
                  <p className="text-muted-foreground">{t('local_agents.models_unavailable')}</p>
                )}
                {footer}
              </div>
            )}
            {rows.length > 0 ? (
              <DynamicVirtualList
                ref={setVirtualList}
                list={rows}
                size="auto"
                scrollAreaClassName="min-h-0 flex-1"
                contentProps={{ className: 'py-1' }}
                role="listbox"
                scrollerProps={{ id: listboxId, 'aria-label': t('settings.models.list_title') }}
                estimateSize={estimateRowSize}
                getItemKey={getRowKey}
                isSticky={isStickyGroup}
                keepMountedIndexes={keepMountedIndexes}
                scrollPaddingStart={GROUP_HEADER_HEIGHT}
                autoHideScrollbar
                overscan={6}>
                {(row) => {
                  if (row.type === 'group') {
                    return (
                      <div className="flex h-7 items-center bg-popover px-4 text-[11px] text-muted-foreground">
                        {row.label}
                      </div>
                    )
                  }
                  const { key, model, label, restriction } = row
                  const selected = model ? value === model.id : !value
                  const details = [model?.description, restriction].filter(Boolean).join(' · ') || undefined
                  const rowTags =
                    model?.tags ?? (model && /free/i.test(`${model.id} ${model.name}`) ? (['free'] as const) : [])
                  return (
                    <div
                      className="px-1 py-0.5"
                      onPointerMove={() => {
                        if (activeKey === key || pointerFocusKey.current === key) return
                        pointerFocusKey.current = key
                        startTransition(() => setFocusedKey(key))
                      }}>
                      <ModelSelectorRow
                        selected={selected}
                        focused={activeKey === key}
                        disabled={disabled || !!restriction}
                        showSelectedIndicator={selected}
                        onSelect={() => void select(row)}
                        optionProps={{
                          id: optionId(key),
                          'aria-label': label,
                          'aria-description': details
                        }}
                        leading={
                          <LocalAgentModelAvatar
                            model={model}
                            presetId={presetId}
                            size={24}
                            className="rounded-full border border-border"
                          />
                        }
                        trailing={
                          rowTags.length > 0 ? (
                            <div className="ml-2 flex h-[18px] max-w-[65%] shrink-0 items-center justify-end gap-1 overflow-hidden">
                              {rowTags.map((tag) => (
                                <ModelTag
                                  key={`${key}-${tag}`}
                                  tag={tag}
                                  size={9}
                                  showLabel={false}
                                  showTooltip
                                  className="h-full items-center"
                                />
                              ))}
                            </div>
                          ) : undefined
                        }>
                        <div
                          className="min-w-0 truncate"
                          title={[label, model?.description, restriction].filter(Boolean).join('\n')}>
                          {label}
                        </div>
                      </ModelSelectorRow>
                    </div>
                  )
                }}
              </DynamicVirtualList>
            ) : models.length > 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">{t('models.no_matches')}</div>
            ) : null}
          </div>
        </PortalContainerProvider>
      )}
    </SelectorShell>
  )
}
