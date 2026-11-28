import { Check, ChevronRight, ChevronsDownUp, ChevronsUpDown, RefreshCw, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { modelSettingsListClasses as styles } from '@renderer/components/modelSettingsStyles'
import { ModelTag } from '@renderer/components/tags/Model'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import type {
  LocalAgentModelOption,
  LocalAgentModelSourceRestrictions
} from '@renderer/hooks/agent/useLocalAgentModelSelection'
import { cn } from '@renderer/utils/style'

import { groupLocalAgentModels } from './groupLocalAgentModels'
import { LocalAgentModelAvatar } from './LocalAgentModelAvatar'

type ModelListRow =
  | { type: 'group'; key: string; label: string; open: boolean }
  | { type: 'model'; key: string; label: string; model?: LocalAgentModelOption; last: boolean }
  | { type: 'separator'; key: string }

export function LocalAgentModelList({
  models,
  sourceRestrictions,
  followCliLabel,
  presetId,
  scrollElement,
  value,
  loaded,
  loading,
  disabled,
  loadDisabled,
  onLoad,
  onSelect
}: {
  followCliLabel?: string
  models: LocalAgentModelOption[]
  sourceRestrictions?: LocalAgentModelSourceRestrictions
  presetId?: string
  scrollElement: HTMLDivElement | null
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
  const search = query.trim().toLowerCase()
  const closeSearch = () => {
    setQuery('')
    setSearchOpen(false)
  }
  const groups = useMemo(
    () =>
      groupLocalAgentModels(models, {
        officialLabel: t('local_agents.model_sources.native'),
        ungroupedLabel: t('models.group.ungrouped'),
        followCliLabel,
        search,
        value
      }),
    [models, search, followCliLabel, t, value]
  )
  const rows = useMemo(() => {
    const rows: ModelListRow[] = []
    for (const { key, label, entries } of groups) {
      const open = !!search || !collapsedGroups.has(key)
      rows.push({ type: 'group', key, label, open })
      if (open) {
        entries.forEach(({ key, label, model }, index) => {
          rows.push({
            type: 'model',
            key,
            label,
            model,
            last: index === entries.length - 1
          })
        })
      }
      rows.push({ type: 'separator', key: `separator:${key}` })
    }
    return rows
  }, [collapsedGroups, groups, search])
  const groupsExpanded = groups.some(({ key }) => !collapsedGroups.has(key))
  const toggleAllLabel = t(groupsExpanded ? 'settings.models.collapse_all' : 'settings.models.expand_all')
  const GroupExpansionIcon = groupsExpanded ? ChevronsDownUp : ChevronsUpDown

  return (
    <section className={styles.headerBlock} aria-labelledby="local-agent-model-label">
      <div className={styles.headerInlineRow}>
        <div className={styles.sectionTitleLine}>
          <h2 id="local-agent-model-label" className={styles.sectionTitle}>
            {t('settings.models.list_title')}
          </h2>
          <Tooltip content={toggleAllLabel}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={styles.groupToggleIconButton}
              aria-label={toggleAllLabel}
              disabled={!!search || !groups.length}
              onClick={() => setCollapsedGroups(new Set(groupsExpanded ? groups.map(({ key }) => key) : []))}>
              <GroupExpansionIcon className={styles.toolbarHeaderIcon} />
            </Button>
          </Tooltip>
          {searchOpen || query ? (
            <div className={styles.searchCompactWrap}>
              <Search className={styles.searchIcon} />
              <input
                autoFocus
                type="text"
                className={styles.searchInput}
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
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={styles.searchClear}
                  aria-label={t('common.clear')}
                  onClick={closeSearch}>
                  <X className="size-2.5" />
                </Button>
              )}
            </div>
          ) : (
            <Tooltip content={t('common.search')}>
              <Button
                variant="ghost"
                size="icon-sm"
                className={styles.searchIconButton}
                aria-label={t('common.search')}
                onClick={() => setSearchOpen(true)}>
                <Search className={styles.toolbarHeaderIcon} />
              </Button>
            </Tooltip>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className={styles.fetchActionButton}
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
            className={cn(
              styles.toolbarDesignIcon,
              'lucide-custom text-muted-foreground',
              refreshing && 'motion-safe:animate-spin'
            )}
          />
          {t('settings.models.toolbar.pull_short')}
        </Button>
      </div>
      {rows.length ? (
        <DynamicVirtualList
          externalScrollElement={scrollElement}
          list={rows}
          className={styles.listScroller}
          role="list"
          estimateSize={(index) => {
            const row = rows[index]
            if (row.type === 'group') return 38
            if (row.type === 'separator') return 10
            return row.last ? 47 : 42
          }}
          getItemKey={(index) => rows[index].key}
          overscan={10}>
          {(row) => {
            if (row.type === 'separator') return <div aria-hidden className="h-2.5" />

            if (row.type === 'group') {
              return (
                <div className={cn(styles.groupCard, row.open && styles.groupCardOpen)}>
                  <Button
                    variant="ghost"
                    className={cn(
                      styles.groupHeader,
                      row.open && styles.groupHeaderOpen,
                      'justify-start rounded-none font-normal focus-visible:bg-accent'
                    )}
                    aria-expanded={row.open}
                    aria-disabled={!!search}
                    onClick={() => {
                      if (search) return
                      setCollapsedGroups((previous) => {
                        const next = new Set(previous)
                        if (row.open) next.add(row.key)
                        else next.delete(row.key)
                        return next
                      })
                    }}>
                    <ChevronRight
                      className={cn('lucide-custom', styles.groupChevron, row.open && styles.groupChevronOpen)}
                      aria-hidden
                    />
                    <span className={styles.groupTitle}>{row.label}</span>
                  </Button>
                </div>
              )
            }

            const { label, model } = row
            const source = model?.source ?? 'native'
            const restriction = sourceRestrictions?.[source]
            const details = [model?.description, restriction].filter(Boolean).join(' · ') || undefined
            const rowTags = model?.tags ?? (model && /free/i.test(`${model.id} ${label}`) ? (['free'] as const) : [])
            const checked = value === model?.id
            return (
              <div className={cn(styles.virtualModelRow, row.last && styles.virtualModelRowLast)}>
                <Tooltip content={restriction} fullWidthTrigger>
                  <Button
                    variant="ghost"
                    className={cn(
                      styles.row,
                      'h-auto w-full justify-start rounded-none font-normal hover:bg-accent/40 disabled:opacity-100'
                    )}
                    aria-label={label}
                    aria-description={details}
                    aria-pressed={checked}
                    disabled={disabled || !!restriction}
                    onClick={() => void onSelect(model?.id)}>
                    <LocalAgentModelAvatar model={model} presetId={presetId} size={26} className={styles.rowAvatar} />
                    <span className={cn(styles.rowLabel, 'min-w-0 flex-1 truncate text-left')}>{label}</span>
                    {rowTags.length > 0 && (
                      <div className="flex shrink-0 items-center gap-0.5 [&_svg]:size-3!">
                        {rowTags.map((tag) => (
                          <ModelTag key={tag} tag={tag} size={12} showLabel={false} />
                        ))}
                      </div>
                    )}
                    <span className="flex size-8 shrink-0 items-center justify-center">
                      {checked && <Check className="lucide-custom size-4 text-foreground" />}
                    </span>
                  </Button>
                </Tooltip>
              </div>
            )
          }}
        </DynamicVirtualList>
      ) : (
        (loaded || search) && (
          <p className={styles.emptyState}>{t(search ? 'common.no_results' : 'local_agents.models_unavailable')}</p>
        )
      )}
    </section>
  )
}
