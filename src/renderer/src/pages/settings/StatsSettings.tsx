import { useTheme } from '@renderer/context/ThemeProvider'
import type { DailyUsage, ModelStats, TopicStats } from '@renderer/utils/topicStats'
import { computeGlobalStatsFromDB } from '@renderer/utils/topicStats'
import { Select } from 'antd'
import { BarChart3, Bot, Clock, Cpu, FileText, Gauge, Hash, Loader, MessageSquare, Type, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from './'

// ─── Formatters ─────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtLatency(ms: number): string {
  if (ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtSpeed(tps: number): string {
  return tps > 0 ? `${Math.round(tps)} tok/s` : '—'
}

function fmtProvider(p: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p)) return 'Custom'
  const m: Record<string, string> = {
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
    gemini: 'Gemini',
    moonshot: 'Moonshot',
    zhipu: 'Zhipu',
    baichuan: 'Baichuan',
    qwen: 'Qwen',
    deepseek_chat: 'DeepSeek',
    deepseek_reasoner: 'DeepSeek'
  }
  return m[p] || p
}

/** i18n-aware fine-grained duration: "3d 5h 23m 12s" */
function useFmtDuration() {
  const { t } = useTranslation()
  return (ms: number): string => {
    if (ms <= 0) return '—'
    if (ms < 1000) return `${ms}ms`
    let remaining = Math.floor(ms / 1000) // seconds
    const parts: string[] = []
    const d = Math.floor(remaining / 86400)
    if (d > 0) {
      parts.push(`${d}${t('stats.duration_d')}`)
      remaining %= 86400
    }
    const h = Math.floor(remaining / 3600)
    if (h > 0) {
      parts.push(`${h}${t('stats.duration_h')}`)
      remaining %= 3600
    }
    const m = Math.floor(remaining / 60)
    if (m > 0) {
      parts.push(`${m}${t('stats.duration_m')}`)
      remaining %= 60
    }
    if (remaining > 0 || parts.length === 0) parts.push(`${remaining}${t('stats.duration_s')}`)
    return parts.join(' ')
  }
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const C = { input: '#6366f1', output: '#10b981', thinking: '#a855f7' }
const MODEL_C = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']

// ─── Overview Cards ─────────────────────────────────────────────────────────

const OV = styled.div` display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; `
const OCard = styled.div<{ $a: string }>`
  background: var(--color-background-soft); border: 0.5px solid var(--color-border);
  border-radius: 10px; padding: 14px 16px; position: relative; overflow: hidden;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  &::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: ${(p) => p.$a}; }
  &:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
`
const OIcon = styled.div<{ $c: string }>`
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px;
  background: ${(p) => `${p.$c}18`}; color: ${(p) => p.$c}; margin-bottom: 10px;
`
const OVal = styled.div` font-size: 20px; font-weight: 700; color: var(--color-text); line-height: 1.2; font-variant-numeric: tabular-nums; white-space: nowrap; `
const OLbl = styled.div` font-size: 11px; color: var(--color-text-secondary, #888); text-transform: uppercase; letter-spacing: 0.3px; margin-top: 2px; `

// ─── Bar ────────────────────────────────────────────────────────────────────

const BTrack = styled.div` height: 20px; border-radius: 6px; background: var(--color-background-soft); overflow: hidden; display: flex; margin-bottom: 8px; `
const BSeg = styled.div<{ $w: number; $c: string }>`
  width: ${(p) => p.$w}%; background: ${(p) => p.$c}; min-width: ${(p) => (p.$w > 0 ? 2 : 0)}px; transition: width 0.4s ease;
`
const BLegend = styled.div` display: flex; gap: 16px; flex-wrap: wrap; `
const BLItem = styled.div` display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--color-text-secondary, #888); `
const BLDot = styled.div<{
  $c: string
}>` width: 9px; height: 9px; border-radius: 2px; background: ${(p) => p.$c}; flex-shrink: 0; `

// ─── Model Bars ─────────────────────────────────────────────────────────────

const MBContainer = styled.div` display: flex; flex-direction: column; gap: 8px; `
const MBox = styled.div`
  background: var(--color-background-soft); border: 0.5px solid var(--color-border);
  border-radius: 8px; padding: 12px 14px; transition: box-shadow 0.15s;
  &:hover { box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
`
const MTop = styled.div` display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 6px; `
const MName = styled.span` font-size: 13px; font-weight: 600; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; `
const MBadge = styled.span` font-size: 10px; color: var(--color-text-secondary, #888); background: var(--color-background); padding: 2px 6px; border-radius: 4px; flex-shrink: 0; white-space: nowrap; `
const MTrack = styled.div` height: 8px; border-radius: 4px; background: var(--color-background); overflow: hidden; margin-bottom: 6px; `
const MFill = styled.div<{ $w: number; $c: string }>`
  height: 100%; width: ${(p) => p.$w}%; background: ${(p) => p.$c}; border-radius: 4px; transition: width 0.5s ease;
`
const MMeta = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 4px 12px;
  font-size: 11px; color: var(--color-text-secondary, #888); font-variant-numeric: tabular-nums;
`

// Model filter controls
const MFilter = styled.div`
  display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;
  .ant-select { min-width: 140px; }
`
const MSearch = styled.input`
  background: var(--color-background-soft); border: 0.5px solid var(--color-border);
  border-radius: 6px; padding: 4px 10px; font-size: 13px; color: var(--color-text);
  outline: none; min-width: 160px;
  &::placeholder { color: var(--color-text-secondary, #888); }
  &:focus { border-color: #6366f1; }
`

// ─── Heatmap ────────────────────────────────────────────────────────────────

// Reverse color gradient: More messages = darker green
const HM_LEVEL_COLORS = ['var(--color-background-soft)', '#0e4429', '#006d32', '#1a7f3a', '#216e39']

function DailyHeatmap({ dailyUsage }: { dailyUsage: DailyUsage[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)

  const usageMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of dailyUsage) m.set(d.date, d.messages)
    return m
  }, [dailyUsage])

  const { weeks, monthMarkers, maxCount } = useMemo(() => {
    const today = new Date()
    const end = new Date(today)
    const start = new Date(end)
    start.setDate(start.getDate() - 364)
    start.setDate(start.getDate() - start.getDay())

    const allWeeks: { dateStr: string; count: number; month: number }[][] = []
    let cur: { dateStr: string; count: number; month: number }[] = []
    let max = 0
    const top: { date: string; count: number }[] = []

    const mn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const markers: { label: string; weekIdx: number }[] = []
    let lastMonth = -1
    let wi = 0

    const d = new Date(start)
    while (d <= end) {
      const ds = d.toISOString().slice(0, 10)
      const count = usageMap.get(ds) || 0
      if (count > max) max = count
      cur.push({ dateStr: ds, count, month: d.getMonth() })

      if (d.getMonth() !== lastMonth) {
        if (lastMonth !== -1) markers.push({ label: mn[lastMonth], weekIdx: wi })
        lastMonth = d.getMonth()
      }

      d.setDate(d.getDate() + 1)
      if (cur.length === 7) {
        allWeeks.push(cur)
        cur = []
        wi++
      }
    }
    if (cur.length > 0) allWeeks.push(cur)
    if (lastMonth >= 0) markers.push({ label: mn[lastMonth], weekIdx: wi })

    return { weeks: allWeeks, monthMarkers: markers, maxCount: max || 1, topDates: top }
  }, [usageMap])

  const getLevel = (count: number): number => {
    if (count === 0) return 0
    if (count <= maxCount * 0.25) return 1
    if (count <= maxCount * 0.5) return 2
    if (count <= maxCount * 0.75) return 3
    return 4
  }

  if (weeks.length === 0) return null

  const weekMonthMap = new Map<number, string>()
  for (const m of monthMarkers) weekMonthMap.set(m.weekIdx, m.label)

  const handleCellHover = (e: React.MouseEvent, dateStr: string, count: number) => {
    setTooltip({ x: e.clientX, y: e.clientY, text: `${dateStr}: ${count} messages` })
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', overflowX: 'auto' }}
      onMouseLeave={() => setTooltip(null)}>
      {/* Month labels */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 4, height: 16 }}>
        {weeks.map((_week, wi) => (
          <div
            key={wi}
            style={{
              width: 12,
              flexShrink: 0,
              fontSize: 10,
              color: 'var(--color-text-secondary, #888)',
              lineHeight: '16px'
            }}>
            {weekMonthMap.has(wi) ? weekMonthMap.get(wi) : ''}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ display: 'flex', gap: 3 }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {week.map((day, di) => {
              const lvl = getLevel(day.count)
              return (
                <div
                  key={di}
                  title={`${day.dateStr}: ${day.count} messages`}
                  onMouseEnter={(e) => handleCellHover(e, day.dateStr, day.count)}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    flexShrink: 0,
                    cursor: day.count > 0 ? 'pointer' : 'default',
                    background: HM_LEVEL_COLORS[lvl],
                    transition: 'outline 0.1s',
                    outline: tooltip ? undefined : undefined
                  }}
                  onMouseOver={(e) => {
                    ;(e.currentTarget as HTMLElement).style.outline = '2px solid var(--color-text)'
                  }}
                  onMouseOut={(e) => {
                    ;(e.currentTarget as HTMLElement).style.outline = 'none'
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x + 10,
            top: tooltip.y - 30,
            background: 'var(--color-background)',
            border: '0.5px solid var(--color-border)',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            color: 'var(--color-text)',
            pointerEvents: 'none',
            zIndex: 9999,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
          {tooltip.text}
        </div>
      )}

      {/* Legend — More = right side, darker color */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          justifyContent: 'center',
          marginTop: 8,
          fontSize: 10,
          color: 'var(--color-text-secondary, #888)'
        }}>
        Less
        {[0, 1, 2, 3, 4].map((lvl) => (
          <div
            key={lvl}
            style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0, background: HM_LEVEL_COLORS[lvl] }}
          />
        ))}
        More
      </div>
    </div>
  )
}

// ─── Model Filter + Display ─────────────────────────────────────────────────

function ModelUsageSection({ modelStats }: { modelStats: ModelStats[] }) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'tokens' | 'messages' | 'speed'>('tokens')
  const [providerFilter, setProviderFilter] = useState<string>('all')

  const providers = useMemo(() => {
    const seen = new Set<string>()
    for (const m of modelStats) seen.add(fmtProvider(m.provider))
    return Array.from(seen).sort()
  }, [modelStats])

  const filtered = useMemo(() => {
    let list = [...modelStats]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (m) => m.modelName.toLowerCase().includes(q) || fmtProvider(m.provider).toLowerCase().includes(q)
      )
    }
    if (providerFilter !== 'all') {
      list = list.filter((m) => fmtProvider(m.provider) === providerFilter)
    }
    list.sort((a, b) => {
      if (sortBy === 'tokens') return b.totalTokens - a.totalTokens
      if (sortBy === 'messages') return b.messageCount - a.messageCount
      return b.avgTokensPerSecond - a.avgTokensPerSecond
    })
    return list
  }, [modelStats, search, sortBy, providerFilter])

  const maxT = filtered.length > 0 ? filtered[0].totalTokens : 1

  return (
    <>
      <MFilter>
        <MSearch placeholder="Search models..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select
          size="small"
          value={providerFilter}
          onChange={setProviderFilter}
          options={[
            { value: 'all', label: t('stats.model_filter_all') },
            ...providers.map((p) => ({ value: p, label: p }))
          ]}
        />
        <Select
          size="small"
          value={sortBy}
          onChange={setSortBy}
          options={[
            { value: 'tokens', label: t('stats.model_sort_tokens') },
            { value: 'messages', label: t('stats.model_sort_messages') },
            { value: 'speed', label: t('stats.model_sort_speed') }
          ]}
        />
      </MFilter>
      <MBContainer>
        {filtered.map((m, i) => (
          <MBox key={m.modelId}>
            <MTop>
              <MName title={m.modelName}>{m.modelName}</MName>
              <MBadge>{fmtProvider(m.provider)}</MBadge>
            </MTop>
            <MTrack>
              <MFill $w={maxT > 0 ? (m.totalTokens / maxT) * 100 : 0} $c={MODEL_C[i % MODEL_C.length]} />
            </MTrack>
            <MMeta>
              <span>
                {t('stats.messages')}: <strong style={{ color: 'var(--color-text)' }}>{m.messageCount}</strong>
              </span>
              <span>
                Tokens: <strong style={{ color: 'var(--color-text)' }}>{fmtTokens(m.totalTokens)}</strong>
              </span>
              {m.avgTokensPerSecond > 0 && (
                <span>
                  ⚡ <strong style={{ color: 'var(--color-text)' }}>{fmtSpeed(m.avgTokensPerSecond)}</strong>
                </span>
              )}
              {m.avgFirstTokenLatency > 0 && (
                <span>
                  ⏱ <strong style={{ color: 'var(--color-text)' }}>{fmtLatency(m.avgFirstTokenLatency)}</strong>
                </span>
              )}
            </MMeta>
          </MBox>
        ))}
      </MBContainer>
    </>
  )
}

// ─── Stats Display ──────────────────────────────────────────────────────────

function StatsDisplay({ stats }: { stats: TopicStats }) {
  const { t } = useTranslation()
  const fmtDuration = useFmtDuration()

  const tokTotal = stats.totalTokens || 1

  return (
    <>
      {/* ── Overview Cards ── */}
      <OV>
        <OCard $a="#6366f1">
          <OIcon $c="#6366f1">
            <MessageSquare size={14} />
          </OIcon>
          <OVal>{stats.totalMessages.toLocaleString()}</OVal>
          <OLbl>{t('stats.messages')}</OLbl>
        </OCard>
        <OCard $a="#10b981">
          <OIcon $c="#10b981">
            <Cpu size={14} />
          </OIcon>
          <OVal>{fmtTokens(stats.totalTokens)}</OVal>
          <OLbl>{t('stats.total_tokens')}</OLbl>
        </OCard>
        <OCard $a="#f59e0b">
          <OIcon $c="#f59e0b">
            <Zap size={14} />
          </OIcon>
          <OVal>{fmtLatency(stats.avgFirstTokenLatency)}</OVal>
          <OLbl>{t('stats.avg_first_token')}</OLbl>
        </OCard>
      </OV>

      {/* ── Conversation Info ── */}
      <SettingGroup>
        <SettingTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Hash size={15} />
            {t('stats.conversation_info')}
          </span>
        </SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <MessageSquare size={13} style={{ marginRight: 6 }} />
            {t('stats.messages')}
          </SettingRowTitle>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, whiteSpace: 'nowrap' }}>
            <strong>{stats.totalMessages.toLocaleString()}</strong>
            <span style={{ color: 'var(--color-text-secondary, #888)', marginLeft: 6 }}>
              (用户 {stats.userMessages.toLocaleString()} / 助手 {stats.assistantMessages.toLocaleString()})
            </span>
          </span>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <Clock size={13} style={{ marginRight: 6 }} />
            {t('stats.duration')}
          </SettingRowTitle>
          <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {fmtDuration(stats.durationMs)}
          </strong>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <Type size={13} style={{ marginRight: 6 }} />
            {t('stats.total_characters')}
          </SettingRowTitle>
          <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {stats.totalCharacters.toLocaleString()}
          </strong>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <FileText size={13} style={{ marginRight: 6 }} />
            {t('stats.total_words')}
          </SettingRowTitle>
          <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {stats.totalWords.toLocaleString()}
          </strong>
        </SettingRow>
      </SettingGroup>

      {/* ── Token Breakdown ── */}
      {stats.totalTokens > 0 && (
        <SettingGroup>
          <SettingTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Cpu size={15} />
              {t('stats.token_breakdown')}
            </span>
            <strong style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(stats.totalTokens)}</strong>
          </SettingTitle>
          <SettingDivider />
          <BTrack>
            <BSeg $w={(stats.totalInputTokens / tokTotal) * 100} $c={C.input} />
            <BSeg $w={(stats.totalOutputTokens / tokTotal) * 100} $c={C.output} />
            {stats.totalThinkingTokens > 0 && (
              <BSeg $w={(stats.totalThinkingTokens / tokTotal) * 100} $c={C.thinking} />
            )}
          </BTrack>
          <BLegend>
            <BLItem>
              <BLDot $c={C.input} />
              {t('stats.input_tokens')}{' '}
              <strong style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalInputTokens)}</strong>
            </BLItem>
            <BLItem>
              <BLDot $c={C.output} />
              {t('stats.output_tokens')}{' '}
              <strong style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalOutputTokens)}</strong>
            </BLItem>
            {stats.totalThinkingTokens > 0 && (
              <BLItem>
                <BLDot $c={C.thinking} />
                {t('stats.thinking_tokens')}{' '}
                <strong style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalThinkingTokens)}</strong>
              </BLItem>
            )}
          </BLegend>
        </SettingGroup>
      )}

      {/* ── Daily Usage Heatmap ── */}
      {stats.dailyUsage.length > 0 && (
        <SettingGroup>
          <SettingTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart3 size={15} />
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

      {/* ── Model Usage ── */}
      {stats.modelStats.length > 0 && (
        <SettingGroup>
          <SettingTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bot size={15} />
              {t('stats.model_usage')}
            </span>
          </SettingTitle>
          <SettingDivider />
          <ModelUsageSection modelStats={stats.modelStats} />
        </SettingGroup>
      )}

      {/* ── Performance ── */}
      {stats.assistantMessages > 0 && (
        <SettingGroup>
          <SettingTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Gauge size={15} />
              {t('stats.performance')}
            </span>
          </SettingTitle>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>
              <Zap size={13} style={{ marginRight: 6 }} />
              {t('stats.avg_first_token')}
            </SettingRowTitle>
            <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {fmtLatency(stats.avgFirstTokenLatency)}
            </strong>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>
              <Clock size={13} style={{ marginRight: 6 }} />
              {t('stats.avg_completion')}
            </SettingRowTitle>
            <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {fmtDuration(stats.avgCompletionTime)}
            </strong>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>
              <Gauge size={13} style={{ marginRight: 6 }} />
              {t('stats.avg_speed')}
            </SettingRowTitle>
            <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {fmtSpeed(stats.avgTokensPerSecond)}
            </strong>
          </SettingRow>
        </SettingGroup>
      )}
    </>
  )
}

// ─── Loading ────────────────────────────────────────────────────────────────

const LoadingState = styled.div`
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 48px 24px; color: var(--color-text-secondary, #888); font-size: 14px;
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  svg { animation: spin 1s linear infinite; }
`

// ─── Main ───────────────────────────────────────────────────────────────────

const StatsSettings: React.FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [stats, setStats] = useState<TopicStats | null>(null)

  useEffect(() => {
    let cancelled = false
    void computeGlobalStatsFromDB().then((r) => {
      if (!cancelled) setStats(r)
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
      ) : stats.totalMessages === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--color-text-secondary, #888)', fontSize: 14 }}>
          {t('stats.no_data')}
        </div>
      ) : (
        <StatsDisplay stats={stats} />
      )}
    </SettingContainer>
  )
}

export default StatsSettings
