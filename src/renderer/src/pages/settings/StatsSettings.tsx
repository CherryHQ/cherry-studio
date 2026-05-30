import { useTheme } from '@renderer/context/ThemeProvider'
import type { DailyUsage, TopicStats } from '@renderer/utils/topicStats'
import { computeGlobalStatsFromDB } from '@renderer/utils/topicStats'
import { BarChart3, Bot, Coins, Cpu, Gauge, Loader, MessageSquare, User, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from './'

// ─── Utility Functions ──────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function formatCost(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const rem = seconds % 60
    return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rem = minutes % 60
    return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  if (days < 30) {
    const rem = hours % 24
    return rem > 0 ? `${days}d ${rem}h` : `${days}d`
  }
  const months = Math.floor(days / 30)
  if (months < 12) {
    const rem = days % 30
    return rem > 0 ? `${months}mo ${rem}d` : `${months}mo`
  }
  const years = Math.floor(months / 12)
  const rem = months % 12
  return rem > 0 ? `${years}y ${rem}mo` : `${years}y`
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatSpeed(tokensPerSec: number): string {
  if (tokensPerSec < 1) return '—'
  return `${Math.round(tokensPerSec)} tok/s`
}

function formatProvider(provider: string): string {
  const map: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    openrouter: 'OpenRouter',
    azure: 'Azure',
    deepseek: 'DeepSeek',
    mistral: 'Mistral',
    groq: 'Groq',
    ollama: 'Ollama',
    lmstudio: 'LM Studio',
    siliconflow: 'SiliconFlow',
    oneapi: 'OneAPI',
    gemini: 'Gemini'
  }
  return map[provider] || provider
}

// ─── Bar Components ─────────────────────────────────────────────────────────

interface BarSegment {
  value: number
  pct: number
  color: string
  label: string
  formatted: string
}

function StackedBar({ segments }: { segments: BarSegment[] }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          height: 20,
          borderRadius: 6,
          background: 'var(--color-background-soft, rgba(255,255,255,0.03))',
          overflow: 'hidden',
          display: 'flex',
          marginBottom: 8
        }}>
        {segments.map((seg, i) => (
          <div
            key={i}
            style={{
              width: `${seg.pct}%`,
              background: seg.color,
              minWidth: seg.pct > 0 ? 2 : 0,
              transition: 'width 0.3s ease'
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {segments.map((seg, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: 'var(--color-text-secondary, #888)'
            }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: seg.color }} />
            {seg.label}{' '}
            <span style={{ color: 'var(--color-text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {seg.formatted} ({Math.round(seg.pct)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Model Bar Chart ────────────────────────────────────────────────────────

const MODEL_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']

const ModelBarContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const ModelBarRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const ModelBarHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
`

const ModelBarName = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
`

const ModelBarProvider = styled.span`
  font-size: 11px;
  color: var(--color-text-secondary, #888);
  background: var(--color-background-soft, rgba(255, 255, 255, 0.05));
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
`

const ModelBarTrack = styled.div`
  height: 8px;
  border-radius: 4px;
  background: var(--color-background-soft, rgba(255, 255, 255, 0.03));
  overflow: hidden;
`

const ModelBarFill = styled.div<{ $width: number; $color: string }>`
  height: 100%;
  width: ${(p) => p.$width}%;
  background: ${(p) => p.$color};
  border-radius: 4px;
  transition: width 0.3s ease;
`

const ModelBarMetrics = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-secondary, #888);
  font-variant-numeric: tabular-nums;
`

// ─── Daily Heatmap ──────────────────────────────────────────────────────────

const HeatmapContainer = styled.div`
  overflow-x: auto;
  padding: 4px 0;
`

const HeatmapGrid = styled.div`
  display: flex;
  gap: 3px;
`

const HeatmapColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
`

const HeatmapCell = styled.div<{ $level: number }>`
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: ${(p) => {
    const colors = ['var(--color-background-soft, rgba(255,255,255,0.03))', '#0e4429', '#006d32', '#26a641', '#39d353']
    return colors[p.$level]
  }};
`

const HeatmapLabels = styled.div`
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 10px;
  color: var(--color-text-secondary, #888);
`

function DailyHeatmap({ dailyUsage }: { dailyUsage: DailyUsage[] }) {
  // Build a map of date -> messages
  const usageMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of dailyUsage) {
      map.set(d.date, d.messages)
    }
    return map
  }, [dailyUsage])

  // Generate last 365 days
  const { weeks, months } = useMemo(() => {
    const today = new Date()
    const startDate = new Date(today)
    startDate.setDate(startDate.getDate() - 364)

    // Align to Sunday
    const dayOfWeek = startDate.getDay()
    startDate.setDate(startDate.getDate() - dayOfWeek)

    const weeksArr: { date: Date; count: number; dateStr: string }[][] = []
    let currentWeek: { date: Date; count: number; dateStr: string }[] = []
    const monthsSet = new Set<string>()
    const monthLabels: { label: string; index: number }[] = []
    let weekIndex = 0

    const d = new Date(startDate)
    while (d <= today) {
      const dateStr = d.toISOString().slice(0, 10)
      const count = usageMap.get(dateStr) || 0
      currentWeek.push({ date: new Date(d), count, dateStr })

      // Track month boundaries
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`
      if (!monthsSet.has(monthKey)) {
        monthsSet.add(monthKey)
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        monthLabels.push({ label: monthNames[d.getMonth()], index: weekIndex })
      }

      if (currentWeek.length === 7) {
        weeksArr.push(currentWeek)
        currentWeek = []
        weekIndex++
      }
      d.setDate(d.getDate() + 1)
    }
    if (currentWeek.length > 0) {
      weeksArr.push(currentWeek)
    }

    return { weeks: weeksArr, months: monthLabels }
  }, [usageMap])

  // Compute max for level mapping
  const maxCount = useMemo(() => {
    let max = 0
    for (const week of weeks) {
      for (const day of week) {
        if (day.count > max) max = day.count
      }
    }
    return max || 1
  }, [weeks])

  const getLevel = (count: number): number => {
    if (count === 0) return 0
    const ratio = count / maxCount
    if (ratio <= 0.25) return 1
    if (ratio <= 0.5) return 2
    if (ratio <= 0.75) return 3
    return 4
  }

  return (
    <HeatmapContainer>
      {/* Month labels */}
      <div style={{ display: 'flex', marginBottom: 4, marginLeft: 2 }}>
        {months.map((m, i) => {
          const gap = i === 0 ? m.index * 15 : (m.index - months[i - 1].index) * 15
          return (
            <div
              key={i}
              style={{
                fontSize: 10,
                color: 'var(--color-text-secondary, #888)',
                marginLeft: gap,
                whiteSpace: 'nowrap'
              }}>
              {m.label}
            </div>
          )
        })}
      </div>
      <HeatmapGrid>
        {weeks.map((week, wi) => (
          <HeatmapColumn key={wi}>
            {week.map((day, di) => (
              <HeatmapCell key={di} $level={getLevel(day.count)} title={`${day.dateStr}: ${day.count} msgs`} />
            ))}
          </HeatmapColumn>
        ))}
      </HeatmapGrid>
      <HeatmapLabels>
        <span>365 days ago</span>
        <span>Today</span>
      </HeatmapLabels>
    </HeatmapContainer>
  )
}

// ─── Stats Display ──────────────────────────────────────────────────────────

interface StatsDisplayProps {
  stats: TopicStats
  t: (key: string) => string
}

const StatsDisplay: React.FC<StatsDisplayProps> = ({ stats, t }) => {
  if (stats.totalMessages === 0) {
    return (
      <SettingGroup>
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-secondary, #888)' }}>
          {t('stats.no_data')}
        </div>
      </SettingGroup>
    )
  }

  const totalTokens = stats.totalTokens || 1
  const totalCost = stats.totalCost || 1
  const maxModelTokens = stats.modelStats.length > 0 ? stats.modelStats[0].totalTokens : 1

  return (
    <>
      {/* ── Overview ── */}
      <SettingGroup>
        <SettingTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarChart3 size={16} />
            {t('stats.conversation_info')}
          </span>
        </SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <MessageSquare size={14} style={{ marginRight: 6 }} />
            {t('stats.messages')}
          </SettingRowTitle>
          <span
            style={{
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0
            }}>
            <strong>{stats.totalMessages}</strong>
            <span style={{ color: 'var(--color-text-secondary, #888)', fontSize: 12 }}>
              (<User size={11} style={{ verticalAlign: 'middle' }} />
              {stats.userMessages}
              <span style={{ margin: '0 2px' }}>/</span>
              <Bot size={11} style={{ verticalAlign: 'middle' }} />
              {stats.assistantMessages})
            </span>
          </span>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('stats.duration')}</SettingRowTitle>
          <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {formatDuration(stats.durationMs)}
          </span>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('stats.total_characters')}</SettingRowTitle>
          <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {stats.totalCharacters.toLocaleString()}
          </span>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('stats.total_words')}</SettingRowTitle>
          <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {stats.totalWords.toLocaleString()}
          </span>
        </SettingRow>
      </SettingGroup>

      {/* ── Tokens ── */}
      <SettingGroup>
        <SettingTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cpu size={16} />
            {t('stats.token_breakdown')}
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>
            {formatTokens(stats.totalTokens)}
          </span>
        </SettingTitle>
        <SettingDivider />
        <StackedBar
          segments={[
            {
              value: stats.totalInputTokens,
              pct: (stats.totalInputTokens / totalTokens) * 100,
              color: '#6366f1',
              label: t('stats.input_tokens'),
              formatted: formatTokens(stats.totalInputTokens)
            },
            {
              value: stats.totalOutputTokens,
              pct: (stats.totalOutputTokens / totalTokens) * 100,
              color: '#10b981',
              label: t('stats.output_tokens'),
              formatted: formatTokens(stats.totalOutputTokens)
            },
            ...(stats.totalThinkingTokens > 0
              ? [
                  {
                    value: stats.totalThinkingTokens,
                    pct: (stats.totalThinkingTokens / totalTokens) * 100,
                    color: '#a855f7',
                    label: t('stats.thinking_tokens'),
                    formatted: formatTokens(stats.totalThinkingTokens)
                  }
                ]
              : [])
          ]}
        />
      </SettingGroup>

      {/* ── Cost ── */}
      {stats.totalCost > 0 && (
        <SettingGroup>
          <SettingTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Coins size={16} />
              {t('stats.cost_breakdown')}
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>
              {formatCost(stats.totalCost)}
            </span>
          </SettingTitle>
          <SettingDivider />
          <StackedBar
            segments={[
              {
                value: stats.inputCost,
                pct: (stats.inputCost / totalCost) * 100,
                color: '#f59e0b',
                label: t('stats.input_cost'),
                formatted: formatCost(stats.inputCost)
              },
              {
                value: stats.outputCost,
                pct: (stats.outputCost / totalCost) * 100,
                color: '#ef4444',
                label: t('stats.output_cost'),
                formatted: formatCost(stats.outputCost)
              }
            ]}
          />
        </SettingGroup>
      )}

      {/* ── Daily Usage Heatmap ── */}
      {stats.dailyUsage.length > 0 && (
        <SettingGroup>
          <SettingTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart3 size={16} />
              {t('stats.daily_usage')}
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #888)' }}>
              {stats.dailyUsage.length} {t('stats.active_days')}
            </span>
          </SettingTitle>
          <SettingDivider />
          <DailyHeatmap dailyUsage={stats.dailyUsage} />
        </SettingGroup>
      )}

      {/* ── Models ── */}
      {stats.modelStats.length > 0 && (
        <SettingGroup>
          <SettingTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bot size={16} />
              {t('stats.model_usage')}
            </span>
          </SettingTitle>
          <SettingDivider />
          <ModelBarContainer>
            {stats.modelStats.map((m, i) => (
              <ModelBarRow key={m.modelId}>
                <ModelBarHeader>
                  <ModelBarName title={m.modelName}>{m.modelName}</ModelBarName>
                  <ModelBarProvider>{formatProvider(m.provider)}</ModelBarProvider>
                </ModelBarHeader>
                <ModelBarTrack>
                  <ModelBarFill
                    $width={(m.totalTokens / maxModelTokens) * 100}
                    $color={MODEL_COLORS[i % MODEL_COLORS.length]}
                  />
                </ModelBarTrack>
                <ModelBarMetrics>
                  <span>{m.messageCount} msgs</span>
                  <span>{formatTokens(m.totalTokens)} tok</span>
                  {m.cost > 0 && <span>{formatCost(m.cost)}</span>}
                  {m.avgTokensPerSecond > 0 && <span>{formatSpeed(m.avgTokensPerSecond)}</span>}
                  {m.avgFirstTokenLatency > 0 && <span>FT: {formatLatency(m.avgFirstTokenLatency)}</span>}
                </ModelBarMetrics>
              </ModelBarRow>
            ))}
          </ModelBarContainer>
        </SettingGroup>
      )}

      {/* ── Performance ── */}
      {stats.assistantMessages > 0 && (
        <SettingGroup>
          <SettingTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Gauge size={16} />
              {t('stats.performance')}
            </span>
          </SettingTitle>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>
              <Zap size={14} style={{ marginRight: 6 }} />
              {t('stats.avg_first_token')}
            </SettingRowTitle>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {formatLatency(stats.avgFirstTokenLatency)}
            </span>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('stats.avg_completion')}</SettingRowTitle>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {formatDuration(stats.avgCompletionTime)}
            </span>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('stats.avg_speed')}</SettingRowTitle>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {formatSpeed(stats.avgTokensPerSecond)}
            </span>
          </SettingRow>
        </SettingGroup>
      )}
    </>
  )
}

// ─── Loading State ──────────────────────────────────────────────────────────

const LoadingState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  color: var(--color-text-secondary, #888);
  font-size: 14px;

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  svg {
    animation: spin 1s linear infinite;
  }
`

// ─── Main Component ─────────────────────────────────────────────────────────

const StatsSettings: React.FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [stats, setStats] = useState<TopicStats | null>(null)

  useEffect(() => {
    let cancelled = false
    computeGlobalStatsFromDB().then((result) => {
      if (!cancelled) setStats(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <SettingContainer theme={theme}>
      {stats === null ? (
        <LoadingState>
          <Loader size={16} />
          {t('stats.loading')}
        </LoadingState>
      ) : (
        <StatsDisplay stats={stats} t={t} />
      )}
    </SettingContainer>
  )
}

export default StatsSettings
