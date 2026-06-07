import { RefreshIcon } from '@renderer/components/Icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, Search } from 'lucide-react'
import { type FC, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AggregatedStats,
  invalidateGlobalStatsCache,
  loadGlobalStats,
  reaggregateModelUsage,
  type ResolvedModelUsage
} from '../../utils/topicStatsLoader'
import { SettingGroup, SettingSubtitle, SettingTitle } from '.'

// ---------------------------------------------------------------------------
// Token breakdown bar (input / output / thinking)
// ---------------------------------------------------------------------------

const TokenBreakdownBar: FC<{ input: number; output: number; thinking: number; total: number }> = ({
  input,
  output,
  thinking,
  total
}) => {
  if (total === 0) return null
  const inputPct = (input / total) * 100
  const outputPct = (output / total) * 100
  const thinkingPct = (thinking / total) * 100
  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-(--color-background-soft)">
        {inputPct > 0 && (
          <div
            className="bg-[#6366f1] transition-all duration-300"
            style={{ width: `${inputPct}%` }}
            title={`Input ${input.toLocaleString()}`}
          />
        )}
        {outputPct > 0 && (
          <div
            className="bg-[#10b981] transition-all duration-300"
            style={{ width: `${outputPct}%` }}
            title={`Output ${output.toLocaleString()}`}
          />
        )}
        {thinkingPct > 0 && (
          <div
            className="bg-[#a855f7] transition-all duration-300"
            style={{ width: `${thinkingPct}%` }}
            title={`Thinking ${thinking.toLocaleString()}`}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-(--color-foreground-muted) text-xs">
        <span>
          <span className="mr-1.5 inline-block size-2 rounded-full bg-[#6366f1]" />
          Input {input.toLocaleString()} ({inputPct.toFixed(1)}%)
        </span>
        <span>
          <span className="mr-1.5 inline-block size-2 rounded-full bg-[#10b981]" />
          Output {output.toLocaleString()} ({outputPct.toFixed(1)}%)
        </span>
        {thinking > 0 && (
          <span>
            <span className="mr-1.5 inline-block size-2 rounded-full bg-[#a855f7]" />
            Thinking {thinking.toLocaleString()} ({thinkingPct.toFixed(1)}%)
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Daily usage heatmap (365 days, log-interpolated color)
// ---------------------------------------------------------------------------

interface HeatmapCell {
  date: string
  count: number
  intensity: number // 0..1
}

const HEATMAP_DAYS = 365
const MS_PER_DAY = 24 * 60 * 60 * 1000

const startOfLocalDay = (d: Date) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

const dateKey = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

const buildHeatmap = (daily: { date: string; messageCount: number }[]): HeatmapCell[] => {
  const counts = new Map(daily.map((d) => [d.date, d.messageCount]))
  const today = startOfLocalDay(new Date())
  const out: HeatmapCell[] = []
  let max = 0
  for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * MS_PER_DAY)
    const key = dateKey(d)
    const c = counts.get(key) ?? 0
    out.push({ date: key, count: c, intensity: 0 })
    if (c > max) max = c
  }
  // log-interpolate intensity
  const denom = max > 0 ? Math.log(max + 1) : 1
  for (const cell of out) {
    cell.intensity = denom > 0 ? Math.log(cell.count + 1) / denom : 0
  }
  return out
}

const lerpColor = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)

const heatColor = (intensity: number) => {
  if (intensity <= 0) return 'var(--color-background-soft)'
  // 155,233,168 -> 33,110,57
  const r = lerpColor(155, 33, intensity)
  const g = lerpColor(233, 110, intensity)
  const b = lerpColor(168, 57, intensity)
  return `rgb(${r}, ${g}, ${b})`
}

const DailyHeatmap: FC<{ data: { date: string; messageCount: number }[] }> = ({ data }) => {
  const cells = useMemo(() => buildHeatmap(data), [data])
  const [cellSize, setCellSize] = useState(12)
  const containerRef = useResizeObserver((width) => {
    if (!width) return
    // 54 weeks + 3px gap. 12px*54 + 3*53 = 648 + 159 = 807
    const needed = 54 * 12 + 53 * 3
    if (width >= needed) {
      setCellSize(12)
      return
    }
    const scaled = Math.max(9, Math.floor((width - 53 * 3) / 54))
    setCellSize(scaled)
  })

  // Group by ISO week — for simplicity, group by column index
  const weekCount = Math.ceil(HEATMAP_DAYS / 7)

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="overflow-x-auto">
        <div className="inline-flex flex-col gap-1">
          <div className="flex gap-[3px]">
            {Array.from({ length: weekCount }).map((_, w) => (
              <div key={w} className="flex flex-col gap-[3px]" style={{ width: cellSize }}>
                {Array.from({ length: 7 }).map((_, d) => {
                  const idx = w * 7 + d
                  const cell = cells[idx]
                  if (!cell) return <div key={d} style={{ width: cellSize, height: cellSize }} />
                  return (
                    <div
                      key={d}
                      title={`${cell.date}: ${cell.count} message${cell.count === 1 ? '' : 's'}`}
                      className="rounded-[2px] transition-colors"
                      style={{
                        width: cellSize,
                        height: cellSize,
                        background: heatColor(cell.intensity)
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-(--color-foreground-muted) text-xs">
        <span>Less</span>
        <div className="flex gap-1">
          {[0, 0.25, 0.5, 0.75, 1].map((i) => (
            <div key={i} className="size-3 rounded-[2px]" style={{ background: heatColor(i) }} />
          ))}
        </div>
        <span>More</span>
        <span className="ml-auto">
          {cells.filter((c) => c.count > 0).length} active day
          {cells.filter((c) => c.count > 0).length === 1 ? '' : 's'} / {HEATMAP_DAYS}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tiny ResizeObserver hook
// ---------------------------------------------------------------------------

import { useRef } from 'react'

const useResizeObserver = (cb: (width: number) => void) => {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        cb(entry.contentRect.width)
      }
    })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [cb])
  return ref
}

// ---------------------------------------------------------------------------
// Model usage card
// ---------------------------------------------------------------------------

const ModelCard: FC<{ usage: ResolvedModelUsage; maxTokens: number }> = ({ usage, maxTokens }) => {
  const { t } = useTranslation()
  const ratio = maxTokens > 0 ? (usage.totalTokens / maxTokens) * 100 : 0
  return (
    <div className="rounded-lg border border-border/60 bg-(--color-background) p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-(--color-foreground) text-sm">{usage.modelName}</div>
          <div className="truncate text-(--color-foreground-muted) text-xs">{usage.providerName}</div>
        </div>
        <div className="text-right text-(--color-foreground) text-sm tabular-nums">
          {usage.totalTokens.toLocaleString()}{' '}
          <span className="text-(--color-foreground-muted) text-xs">{t('stats.units.tok')}</span>
        </div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-(--color-background-soft)">
        <div className="h-full bg-(--color-primary)" style={{ width: `${ratio}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-(--color-foreground-muted) text-xs">
        <span>
          {t('stats.messages')}: {usage.messageCount}
        </span>
        {usage.performance.avgFirstTokenMs != null && (
          <span>{t('stats.units.ttft', { ms: Math.round(usage.performance.avgFirstTokenMs) })}</span>
        )}
        {usage.performance.avgTokensPerSecond != null && (
          <span>{t('stats.units.tok_per_sec', { value: usage.performance.avgTokensPerSecond.toFixed(1) })}</span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main settings page
// ---------------------------------------------------------------------------

const StatsSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [refreshTick, setRefreshTick] = useState(0)
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'tokens' | 'messages' | 'speed'>('tokens')
  const [limit, setLimit] = useState<number>(20)

  const aggregate = useLiveQuery(
    async () => {
      void refreshTick
      return loadGlobalStats({ force: true })
    },
    [refreshTick],
    null
  )

  const providerOptions = useMemo(() => {
    if (!aggregate) return [] as string[]
    const set = new Set<string>()
    for (const u of aggregate.modelUsage) set.add(u.provider)
    return Array.from(set).sort()
  }, [aggregate])

  const filtered = useMemo(() => {
    if (!aggregate) return [] as ResolvedModelUsage[]
    return reaggregateModelUsage(
      aggregate,
      (u) => {
        if (providerFilter !== 'all' && u.provider !== providerFilter) return false
        if (
          search &&
          !u.modelName.toLowerCase().includes(search.toLowerCase()) &&
          !u.providerName.toLowerCase().includes(search.toLowerCase())
        ) {
          return false
        }
        return true
      },
      sortBy,
      limit
    )
  }, [aggregate, search, providerFilter, sortBy, limit])

  if (!aggregate) {
    return (
      <div className="flex h-full items-center justify-center text-(--color-foreground-muted) text-sm">
        {t('stats.loading')}
      </div>
    )
  }

  const totalMessages = aggregate.messages.length
  const userMsgs = aggregate.messages.filter((m) => m.role === 'user').length
  const asstMsgs = aggregate.messages.filter((m) => m.role === 'assistant').length
  const totalTokens = aggregate.modelUsage.reduce((s, u) => s + u.totalTokens, 0)
  const inputTokens = aggregate.modelUsage.reduce((s, u) => s + u.inputTokens, 0)
  const outputTokens = aggregate.modelUsage.reduce((s, u) => s + u.outputTokens, 0)
  const thinkingTokens = aggregate.modelUsage.reduce((s, u) => s + u.thinkingTokens, 0)

  if (totalMessages === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="font-semibold text-(--color-foreground) text-sm">{t('stats.no_data')}</div>
        <div className="max-w-md text-(--color-foreground-muted) text-xs">{t('stats.no_data_hint')}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4" data-theme-mode={theme}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <SettingTitle>{t('stats.title')}</SettingTitle>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-(--color-background) px-2.5 py-1 text-(--color-foreground) text-xs hover:bg-(--color-background-soft)"
          onClick={() => {
            invalidateGlobalStatsCache()
            setRefreshTick((x) => x + 1)
          }}>
          <RefreshIcon size={12} />
          {t('common.refresh')}
        </button>
      </div>

      {/* Conversation Info */}
      <SettingGroup theme={theme}>
        <SettingSubtitle>{t('stats.conversation_info')}</SettingSubtitle>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={t('stats.topics')} value={String(aggregate.topicCount)} />
          <StatCard
            label={t('stats.total_messages')}
            value={totalMessages.toLocaleString()}
            sub={`${userMsgs} / ${asstMsgs}`}
          />
          <StatCard label={t('stats.total_tokens')} value={totalTokens.toLocaleString()} />
          <StatCard label={t('stats.unique_models')} value={String(aggregate.modelUsage.length)} />
        </div>
      </SettingGroup>

      {/* Token Breakdown */}
      <SettingGroup theme={theme}>
        <SettingSubtitle>{t('stats.token_breakdown')}</SettingSubtitle>
        <div className="mt-3">
          <TokenBreakdownBar input={inputTokens} output={outputTokens} thinking={thinkingTokens} total={totalTokens} />
        </div>
      </SettingGroup>

      {/* Performance */}
      <SettingGroup theme={theme}>
        <SettingSubtitle>{t('stats.performance')}</SettingSubtitle>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label={t('stats.avg_first_token')}
            value={
              aggregate.topicStats.length > 0
                ? formatMs(avgAcross(aggregate, (t) => t.stats.performance.avgFirstTokenMs))
                : '—'
            }
          />
          <StatCard
            label={t('stats.avg_completion')}
            value={
              aggregate.topicStats.length > 0
                ? formatMs(avgAcross(aggregate, (t) => t.stats.performance.avgCompletionMs))
                : '—'
            }
          />
          <StatCard
            label={t('stats.avg_speed')}
            value={
              aggregate.topicStats.length > 0
                ? `${avgAcross(aggregate, (t) => t.stats.performance.avgTokensPerSecond).toFixed(1)} tok/s`
                : '—'
            }
          />
        </div>
      </SettingGroup>

      {/* Daily Usage */}
      <SettingGroup theme={theme}>
        <SettingSubtitle>{t('stats.daily_usage')}</SettingSubtitle>
        <div className="mt-3">
          <DailyHeatmap data={aggregate.dailyUsage} />
        </div>
      </SettingGroup>

      {/* Model Usage */}
      <SettingGroup theme={theme}>
        <SettingSubtitle>{t('stats.model_usage')}</SettingSubtitle>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search
              size={12}
              className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 text-(--color-foreground-muted)"
            />
            <input
              type="text"
              placeholder={t('stats.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full rounded-md border border-border/60 bg-(--color-background) pr-2 pl-7 text-(--color-foreground) text-xs placeholder:text-(--color-foreground-muted) focus:border-(--color-primary) focus:outline-none"
            />
          </div>
          <FilterSelect
            value={providerFilter}
            onChange={setProviderFilter}
            options={[
              { value: 'all', label: t('stats.model_filter_all') },
              ...providerOptions.map((p) => ({ value: p, label: p }))
            ]}
            ariaLabel={t('stats.model_filter_all')}
          />
          <FilterSelect
            value={sortBy}
            onChange={(v) => setSortBy(v as 'tokens' | 'messages' | 'speed')}
            options={[
              { value: 'tokens', label: t('stats.model_sort_tokens') },
              { value: 'messages', label: t('stats.model_sort_messages') },
              { value: 'speed', label: t('stats.model_sort_speed') }
            ]}
            ariaLabel={t('stats.sort_by')}
          />
          <FilterSelect
            value={String(limit)}
            onChange={(v) => setLimit(Number(v))}
            options={[
              { value: '10', label: '10' },
              { value: '20', label: '20' },
              { value: '50', label: '50' },
              { value: '100', label: '100' }
            ]}
            ariaLabel={t('stats.limit')}
          />
        </div>

        {filtered.length === 0 ? (
          <div className="mt-4 text-center text-(--color-foreground-muted) text-xs">{t('stats.no_models_match')}</div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(() => {
              const maxTokens = filtered.reduce((m, u) => Math.max(m, u.totalTokens), 0)
              return filtered.map((u) => (
                <ModelCard key={`${u.modelId}-${u.provider}`} usage={u} maxTokens={maxTokens} />
              ))
            })()}
          </div>
        )}
      </SettingGroup>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small inline components
// ---------------------------------------------------------------------------

const StatCard: FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="rounded-lg border border-border/60 bg-(--color-background) px-3 py-2.5">
    <div className="text-(--color-foreground-muted) text-xs">{label}</div>
    <div className="mt-0.5 font-semibold text-(--color-foreground) text-lg tabular-nums">{value}</div>
    {sub && <div className="mt-0.5 text-(--color-foreground-muted) text-xs">{sub}</div>}
  </div>
)

const FilterSelect: FC<{
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  ariaLabel?: string
}> = ({ value, onChange, options, ariaLabel }) => (
  <div className="relative">
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="h-8 appearance-none rounded-md border border-border/60 bg-(--color-background) pr-7 pl-2 text-(--color-foreground) text-xs focus:border-(--color-primary) focus:outline-none">
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
    <ChevronDown
      size={12}
      className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2 text-(--color-foreground-muted)"
    />
  </div>
)

const formatMs = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const avgAcross = (
  data: AggregatedStats,
  pick: (t: AggregatedStats['topicStats'][number]) => number | null
): number => {
  const values: number[] = []
  for (const t of data.topicStats) {
    const v = pick(t)
    if (typeof v === 'number' && Number.isFinite(v)) values.push(v)
  }
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

export default StatsSettings
