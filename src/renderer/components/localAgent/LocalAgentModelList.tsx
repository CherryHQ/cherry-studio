import { Check, ChevronDown, RefreshCw, Search, X } from 'lucide-react'
import { useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, Tooltip } from '@cherrystudio/ui'
import { CliModelAvatar } from '@renderer/components/Avatar/CliModelAvatar'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelTag } from '@renderer/components/tags/Model'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import type {
  LocalAgentModelOption,
  LocalAgentModelSourceRestrictions
} from '@renderer/hooks/agent/useLocalAgentModelSelection'
import { useLocalAgentModelTabs } from '@renderer/hooks/agent/useLocalAgentModelTabs'
import { cn } from '@renderer/utils/style'
import { deriveModelGroupName } from '@shared/utils/model'

import { LocalAgentModelTabs } from './LocalAgentModelTabs'

type ModelListRow =
  | { type: 'group'; key: string; label: string; open: boolean }
  | { type: 'model'; key: string; model: LocalAgentModelOption; first: boolean; last: boolean }

export function LocalAgentModelList({
  models,
  sourceRestrictions,
  showFollowCli = true,
  groupFallback,
  value,
  loaded,
  loading,
  disabled,
  loadDisabled,
  onLoad,
  onSelect
}: {
  showFollowCli?: boolean
  models: LocalAgentModelOption[]
  sourceRestrictions?: LocalAgentModelSourceRestrictions
  groupFallback?: string
  value?: string
  loaded: boolean
  loading: boolean
  disabled: boolean
  loadDisabled: boolean
  onLoad: () => Promise<void>
  onSelect: (value?: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const iconButtonClass =
    'size-6 shrink-0 rounded-md p-0 text-muted-foreground shadow-none hover:bg-accent/40 hover:text-foreground'
  const closeSearch = () => {
    setQuery('')
    setSearchOpen(false)
  }
  const tabs = useLocalAgentModelTabs(models, value, showFollowCli)
  const selectionDisabled = disabled || !!sourceRestrictions?.[tabs.source]
  const search = query.trim().toLowerCase()
  const sourceModels = tabs.models
  const source = tabs.source
  useLayoutEffect(() => {
    if (scrollElement) scrollElement.scrollTop = 0
  }, [scrollElement, search, source])
  const groups = useMemo(() => {
    const grouped = new Map<string, { label: string; models: LocalAgentModelOption[] }>()
    for (const model of sourceModels) {
      if (search && !`${model.name} ${model.id} ${model.group ?? ''}`.toLowerCase().includes(search)) continue
      const label = model.group ?? deriveModelGroupName(model.id) ?? groupFallback ?? t('models.group.ungrouped')
      const key = `group:${model.source ?? ''}:${label}`
      const group = grouped.get(key)
      if (group) group.models.push(model)
      else grouped.set(key, { label, models: [model] })
    }
    return [...grouped].sort(
      ([a, groupA], [b, groupB]) =>
        Number(!!groupA.models[0].group) - Number(!!groupB.models[0].group) || a.localeCompare(b)
    )
  }, [groupFallback, search, sourceModels, t])
  const rows = useMemo(() => {
    const rows: ModelListRow[] = []
    for (const [key, group] of groups) {
      const open = !!search || !collapsedGroups.has(key)
      rows.push({ type: 'group', key, label: group.label, open })
      if (!open) continue
      group.models.forEach((model, index) => {
        rows.push({
          type: 'model',
          key: `model:${key}:${model.id}`,
          model,
          first: index === 0,
          last: index === group.models.length - 1
        })
      })
    }
    return rows
  }, [collapsedGroups, groups, search])
  const rowClass = cn(
    'group flex min-h-[42px] items-center gap-2.5 px-2.5 py-1 text-foreground leading-none',
    'h-auto w-full justify-start rounded-lg font-normal hover:bg-accent/40 aria-pressed:hover:bg-transparent disabled:opacity-100'
  )
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="local-agent-model-label">
      <LocalAgentModelTabs
        tabs={tabs}
        sourceRestrictions={sourceRestrictions}
        viewportRef={setScrollElement}
        renderHeader={(tabList) => (
          <div className="flex min-h-9 min-w-0 items-end justify-between gap-2 border-b border-border-subtle">
            <h2 id="local-agent-model-label" className="sr-only">
              {t('settings.models.list_title')}
            </h2>
            {tabList}
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1 self-center">
              <Tooltip content={t('common.refresh')}>
                <Button
                  variant="ghost"
                  className={iconButtonClass}
                  aria-label={t('common.refresh')}
                  aria-busy={refreshing}
                  disabled={disabled || loadDisabled}
                  onClick={async () => {
                    if (loading || refreshing) return
                    setRefreshing(true)
                    try {
                      await onLoad()
                    } finally {
                      setRefreshing(false)
                    }
                  }}>
                  <RefreshCw
                    className={cn('lucide-custom size-3 text-muted-foreground', refreshing && 'animate-spin')}
                  />
                </Button>
              </Tooltip>
              {searchOpen || query ? (
                <InputGroup className="h-8 w-[min(38vw,220px)] min-w-0 rounded-[10px] border-border-subtle shadow-none">
                  <InputGroupAddon className="pl-2.5">
                    <Search className="lucide-custom size-3 text-muted-foreground" />
                  </InputGroupAddon>
                  <InputGroupInput
                    autoFocus
                    placeholder={t('models.search.placeholder')}
                    aria-label={t('models.search.placeholder')}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onBlur={() => {
                      if (!query) setSearchOpen(false)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.stopPropagation()
                        closeSearch()
                      }
                    }}
                  />
                  {query && (
                    <InputGroupAddon align="inline-end" className="pr-2">
                      <InputGroupButton size="icon-xs" aria-label={t('common.clear')} onClick={closeSearch}>
                        <X className="size-3" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  )}
                </InputGroup>
              ) : (
                <Tooltip content={t('common.search')}>
                  <Button
                    variant="ghost"
                    className={iconButtonClass}
                    aria-label={t('common.search')}
                    onClick={() => setSearchOpen(true)}>
                    <Search className="lucide-custom size-3 text-muted-foreground" />
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
        )}>
        {showFollowCli && tabs.source === 'native' && (
          <div className="overflow-hidden rounded-lg border border-border-subtle p-1.5">
            <Button
              variant="ghost"
              aria-pressed={!value}
              disabled={selectionDisabled}
              className={rowClass}
              onClick={() => void onSelect()}>
              <CliModelAvatar className="size-[26px] shrink-0 rounded-full border border-border" />
              <span className="min-w-0 flex-1 truncate text-left text-sm">{t('local_agents.follow_cli')}</span>
              <span className="flex size-[30px] shrink-0 items-center justify-center">
                {!value && <Check className="size-4 text-primary" />}
              </span>
            </Button>
          </div>
        )}
        {rows.length > 0 ? (
          <DynamicVirtualList
            externalScrollElement={scrollElement}
            list={rows}
            estimateSize={(index) => {
              const row = rows[index]
              if (row.type === 'group') return row.open ? 38 : 48
              return 46 + (row.first ? 6 : 0) + (row.last ? 13 : 0)
            }}
            getItemKey={(index) => rows[index].key}
            overscan={8}>
            {(row) => {
              if (row.type === 'group') {
                return (
                  <div className={cn(!row.open && 'pb-2.5')}>
                    <div
                      className={cn(
                        'overflow-hidden border border-border-subtle',
                        row.open ? 'rounded-t-lg' : 'rounded-lg'
                      )}>
                      <Button
                        variant="ghost"
                        aria-expanded={row.open}
                        className="h-9 w-full justify-start gap-2 rounded-none bg-muted/30 px-4 font-normal text-foreground"
                        onClick={() => {
                          if (search) return
                          setCollapsedGroups((previous) => {
                            const next = new Set(previous)
                            if (row.open) next.add(row.key)
                            else next.delete(row.key)
                            return next
                          })
                        }}>
                        <ChevronDown
                          className={cn('lucide-custom size-4 text-muted-foreground', !row.open && '-rotate-90')}
                          aria-hidden
                        />
                        <span className="min-w-0 truncate leading-5">{row.label}</span>
                      </Button>
                    </div>
                  </div>
                )
              }
              const { model } = row
              const rowTags = model.tags ?? (/free/i.test(`${model.id} ${model.name}`) ? (['free'] as const) : [])
              return (
                <div className={cn(row.last && 'pb-2.5')}>
                  <div
                    className={cn(
                      'border-x border-border-subtle px-1.5 pb-1',
                      row.first && 'pt-1.5',
                      row.last && 'rounded-b-lg border-b pb-1.5'
                    )}>
                    <Button
                      key={model.id}
                      variant="ghost"
                      aria-pressed={value === model.id}
                      disabled={selectionDisabled}
                      className={rowClass}
                      onClick={() => void onSelect(model.id)}>
                      <ModelAvatar
                        model={model}
                        size={26}
                        className="shrink-0 overflow-hidden rounded-full border border-border [&_*]:overflow-hidden [&_*]:rounded-[inherit] [&_img]:rounded-[inherit] [&_svg]:rounded-[inherit]"
                      />
                      <span className="min-w-0 flex-1 truncate text-left text-sm" title={model.name || model.id}>
                        {model.name || model.id}
                      </span>
                      {rowTags.length > 0 && (
                        <div className="flex shrink-0 items-center gap-1">
                          {rowTags.map((tag) => (
                            <ModelTag
                              key={`${model.id}-${tag}`}
                              tag={tag}
                              size={9}
                              showLabel={false}
                              showTooltip
                              className="[&_svg]:size-[9px]!"
                            />
                          ))}
                        </div>
                      )}
                      <span className="flex size-[30px] shrink-0 items-center justify-center">
                        {value === model.id && <Check className="size-4 text-primary" />}
                      </span>
                    </Button>
                  </div>
                </div>
              )
            }}
          </DynamicVirtualList>
        ) : (
          (loaded || query) && (
            <p className="rounded-lg border border-dashed border-border-subtle px-4 py-6 text-center text-xs text-muted-foreground">
              {t(query ? 'common.no_results' : 'local_agents.models_unavailable')}
            </p>
          )
        )}
      </LocalAgentModelTabs>
    </section>
  )
}
