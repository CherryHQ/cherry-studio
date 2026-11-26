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

import { PortalContainerProvider, Tabs, TabsContent } from '@cherrystudio/ui'
import { CliModelAvatar } from '@renderer/components/Avatar/CliModelAvatar'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { LocalAgentModelTabList } from '@renderer/components/localAgent/LocalAgentModelTabList'
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
import { useLocalAgentModelTabs } from '@renderer/hooks/agent/useLocalAgentModelTabs'
import { classifyLocalAgentError } from '@renderer/utils/agent/localAgentError'
import { getSearchMatchScore } from '@renderer/utils/model'
import { reasoningEffortLabel } from '@renderer/utils/reasoning'
import { cn } from '@renderer/utils/style'

type ModelOption = { key: string; model?: LocalAgentModelOption; label: string; score: number }
type ModelSelectorListRow = { type: 'group'; key: string; label: string } | ({ type: 'option' } & ModelOption)

const GROUP_HEADER_HEIGHT = 28

interface LocalAgentModelSelectorProps {
  trigger: ReactElement
  models: LocalAgentModelOption[]
  sourceRestrictions?: LocalAgentModelSourceRestrictions
  showFollowCli?: boolean
  value?: string
  disabled?: boolean
  loading?: boolean
  loaded?: boolean
  error?: string
  onOpenSettings?: () => void
  footer?: ReactNode
  configuration?: ReactNode
  side?: 'top' | 'bottom'
  onLoad: () => void | Promise<void>
  onSelect: (value?: string) => Promise<boolean>
}

export function LocalAgentModelSelector({
  trigger,
  models,
  sourceRestrictions,
  showFollowCli = true,
  value,
  disabled,
  loading,
  loaded,
  error,
  onOpenSettings,
  footer,
  configuration,
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
  const tabs = useLocalAgentModelTabs(models, value, showFollowCli)
  const source = tabs.sources.includes(tabs.source) ? tabs.source : ''
  const selectionDisabled = disabled || !!sourceRestrictions?.[tabs.source]
  const sourceModels = tabs.models
  const availableTags = useMemo(
    () =>
      tabs.source === 'gateway'
        ? MODEL_SELECTOR_TAGS.filter((tag) => sourceModels.some((model) => model.tags?.includes(tag)))
        : [],
    [sourceModels, tabs.source]
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
    const options = tabs.source === 'native' && showFollowCli ? [undefined, ...sourceModels] : sourceModels
    const query = searchText.trim()
    const matches: ModelOption[] = []
    for (const model of options) {
      if (selectedTags.length && !selectedTags.every((tag) => model?.tags?.includes(tag))) continue
      const label = model ? model.name || model.id : t('local_agents.follow_cli')
      const score = query
        ? getSearchMatchScore(searchText, [
            { value: label, weight: 0, allowAbbreviation: true },
            { value: model?.id, weight: 1, allowAbbreviation: true },
            { value: model?.group, weight: 2, allowAbbreviation: false, allowPinyin: true }
          ])
        : 0
      if (score !== null) matches.push({ key: model?.id ?? '__cli_default__', model, label, score })
    }
    const groups = new Map<string, ModelOption[]>()
    for (const item of matches.sort((a, b) => a.score - b.score)) {
      const group = item.model?.group ?? ''
      const entries = groups.get(group)
      if (entries) entries.push(item)
      else groups.set(group, [item])
    }
    for (const [group, entries] of groups) {
      if (group) rows.push({ type: 'group', key: `group:${group}`, label: group })
      for (const item of entries) {
        optionIndexes.set(item.key, rows.length)
        rows.push({ ...item, type: 'option' })
        items.push(item)
      }
    }
    return { rows, items, optionIndexes }
  }, [availableTags, open, searchText, showFollowCli, sourceModels, t, tabs.source, tagSelection])
  const selectedKey = value ?? '__cli_default__'
  const activeKey = optionIndexes.has(focusedKey)
    ? focusedKey
    : optionIndexes.has(selectedKey)
      ? selectedKey
      : items[0]?.key
  const activeIndex = activeKey === undefined ? undefined : optionIndexes.get(activeKey)
  const keepMountedIndexes = useMemo(() => (activeIndex === undefined ? [] : [activeIndex]), [activeIndex])
  const getRowKey = useCallback((index: number) => `${rows[index].type}:${rows[index].key}`, [rows])
  const isStickyGroup = useCallback((index: number) => rows[index].type === 'group', [rows])
  const estimateRowSize = useCallback(
    (index: number) => {
      const row = rows[index]
      return row.type === 'group' ? GROUP_HEADER_HEIGHT : row.model?.effort?.options.length ? 44 : 36
    },
    [rows]
  )
  const optionId = (key: string) => `${listboxId}-${encodeURIComponent(key)}`
  const select = async (next?: string) => {
    if (selectionDisabled) return
    if (await onSelect(next)) setOpen(false)
  }
  useModelListKeyboardNav({
    open,
    focusedItemKey: activeKey ?? '',
    items: selectionDisabled ? [] : items,
    onClose: () => setOpen(false),
    onFocusItem: (key) => {
      pointerFocusKey.current = ''
      setFocusedKey(key)
    },
    onSelectItem: (item) => void select(item.model?.id)
  })
  useLayoutEffect(() => {
    if (open && activeIndex !== undefined && pointerFocusKey.current !== activeKey) {
      virtualList?.scrollToIndex(activeIndex, { align: 'auto' })
    }
  }, [activeIndex, activeKey, open, virtualList])
  return (
    <Tabs
      value={source}
      onValueChange={(source) => {
        tabs.setSource(source)
        setSearchText('')
        resetFocus()
        resetTags()
      }}
      className="contents">
      <SelectorShell
        trigger={trigger}
        open={open}
        onOpenChange={(next) => {
          if (next) tabs.setSource()
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
          <div className="flex w-full min-w-0 flex-col gap-2">
            <LocalAgentModelTabList
              sources={tabs.sources}
              sourceRestrictions={sourceRestrictions}
              className="min-h-7 w-full p-0.5 [&_[data-slot=tabs-trigger]]:py-0.5"
            />
            {availableTags.length > 0 && (
              <ModelSelectorFilterTags tags={availableTags} tagSelection={tagSelection} onToggleTag={toggleTag} />
            )}
          </div>
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
            <TabsContent value={source} className="flex h-full min-h-0 flex-col">
              {configuration && (
                <div className="shrink-0 px-2 py-1" onKeyDown={(event) => event.stopPropagation()}>
                  {configuration}
                </div>
              )}
              {(error || footer || (!loading && loaded && !models.length)) && (
                <div className="shrink-0 space-y-2 border-b border-border-subtle px-3 py-2 text-xs">
                  {error && (
                    <div role="alert" className="flex gap-2">
                      {authenticationRequired && (
                        <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <p className={cn('min-w-0 break-words', !authenticationRequired && 'text-destructive')}>
                        {authenticationRequired
                          ? t(
                              regionRestricted
                                ? 'local_agents.auth_region_unavailable'
                                : 'local_agents.sign_in_required'
                            )
                          : classifiedError?.message}
                      </p>
                    </div>
                  )}
                  {!loading && !error && loaded && !models.length && (
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
                    const { key, model, label } = row
                    const selected = model ? value === model.id : !value
                    const effort = model?.effort?.options
                      .map(({ value, name }) => reasoningEffortLabel(value, t, name))
                      .join(' · ')
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
                          className={effort ? 'h-10' : undefined}
                          selected={selected}
                          focused={activeKey === key}
                          disabled={selectionDisabled}
                          showSelectedIndicator={selected}
                          onSelect={() => void select(model?.id)}
                          optionProps={{
                            id: optionId(key),
                            'aria-label': label,
                            'aria-description': effort || undefined
                          }}
                          leading={
                            model ? (
                              <ModelAvatar model={model} size={24} className="rounded-full border border-border" />
                            ) : (
                              <CliModelAvatar className="size-6 border border-border" />
                            )
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
                          <div className="min-w-0">
                            <div className="truncate" title={model ? label : undefined}>
                              {label}
                            </div>
                            {effort && (
                              <div className="truncate text-muted-foreground text-xs" title={effort}>
                                {effort}
                              </div>
                            )}
                          </div>
                        </ModelSelectorRow>
                      </div>
                    )
                  }}
                </DynamicVirtualList>
              ) : (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">{t('models.no_matches')}</div>
              )}
            </TabsContent>
          </PortalContainerProvider>
        )}
      </SelectorShell>
    </Tabs>
  )
}
