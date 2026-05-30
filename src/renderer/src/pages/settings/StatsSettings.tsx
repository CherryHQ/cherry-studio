import { useTheme } from '@renderer/context/ThemeProvider'
import type { DailyUsage, TopicStats } from '@renderer/utils/topicStats'
import { computeGlobalStatsFromDB } from '@renderer/utils/topicStats'
import {
  BarChart3,
  Bot,
  Clock,
  Coins,
  Cpu,
  FileText,
  Gauge,
  Hash,
  Loader,
  MessageSquare,
  Type,
  User,
  Zap
} from 'lucide-react'
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
function fmtCost(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}
function fmtDuration(ms: number): string {
  if (ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ${h % 24}h`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ${d % 30}d`
  const y = Math.floor(mo / 12)
  return `${y}y ${mo % 12}mo`
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
    gemini: 'Gemini'
  }
  return m[p] || p
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const COLORS = {
  input: '#6366f1',
  output: '#10b981',
  thinking: '#a855f7'
}
const MODEL_C = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']

// ─── Overview Cards ─────────────────────────────────────────────────────────

const OV = styled.div` display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; `
const OCard = styled.div<{ $a: string }>`
  background: var(--color-background-soft); border: 0.5px solid var(--color-border);
  border-radius: 10px; padding: 14px 16px; position: relative; overflow: hidden;
  &::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: ${(p) => p.$a}; }
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
  width: ${(p) => p.$w}%; background: ${(p) => p.$c}; min-width: ${(p) => (p.$w > 0 ? 2 : 0)}px; transition: width 0.3s;
`
const BLegend = styled.div` display: flex; gap: 16px; flex-wrap: wrap; `
const BLItem = styled.div` display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--color-text-secondary, #888); `
const BLDot = styled.div<{
  $c: string
}>` width: 9px; height: 9px; border-radius: 2px; background: ${(p) => p.$c}; flex-shrink: 0; `

// ─── Model Bars ─────────────────────────────────────────────────────────────

const MBContainer = styled.div` display: flex; flex-direction: column; gap: 10px; `
const MBox = styled.div`
  background: var(--color-background-soft); border: 0.5px solid var(--color-border);
  border-radius: 8px; padding: 12px 14px;
`
const MTop = styled.div` display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 6px; `
const MName = styled.span` font-size: 13px; font-weight: 600; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; `
const MBadge = styled.span` font-size: 10px; color: var(--color-text-secondary, #888); background: var(--color-background); padding: 2px 6px; border-radius: 4px; flex-shrink: 0; `
const MTrack = styled.div` height: 8px; border-radius: 4px; background: var(--color-background); overflow: hidden; margin-bottom: 6px; `
const MFill = styled.div<{ $w: number; $c: string }>`
  height: 100%; width: ${(p) => p.$w}%; background: ${(p) => p.$c}; border-radius: 4px; transition: width 0.5s ease;
`
const MMeta = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 4px 12px;
  font-size: 11px; color: var(--color-text-secondary, #888); font-variant-numeric: tabular-nums;
`

// ─── Compact Row (for message count — guarantees single line) ───────────────

const CompactRow = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 2px 0; min-height: 28px;
`
const CompactLabel = styled.span`
  font-size: 13px; color: var(--color-text-1); flex-shrink: 0;
  display: flex; align-items: center; gap: 4px;
`
const CompactVal = styled.span`
  font-variant-numeric: tabular-nums; font-size: 13px; white-space: nowrap;
  display: flex; align-items: center; gap: 4px;
  margin-left: auto;
`

// ─── Daily Heatmap ──────────────────────────────────────────────────────────

const HMWrap = styled.div` overflow-x: auto; padding-bottom: 4px; `

const HMGrid = styled.div` display: flex; gap: 3px; `

const HMCol = styled.div` display: flex; flex-direction: column; gap: 3px; `

const HMCell = styled.div.attrs<{ $level: number; title: string }>((p) => ({ title: p.title }))<{ $level: number }>`
  width: 11px; height: 11px; border-radius: 2px; flex-shrink: 0;
  background: ${(p) => {
    const g = ['var(--color-background-soft)', '#0e4429', '#006d32', '#26a641', '#39d353']
    return g[p.$level] || g[0]
  }};
`

const HMLegend = styled.div`
  display: flex; align-items: center; gap: 4px; justify-content: flex-end;
  margin-top: 8px; font-size: 10px; color: var(--color-text-secondary, #888);
`

// ─── Heatmap Component ──────────────────────────────────────────────────────

function DailyHeatmap({ dailyUsage }: { dailyUsage: DailyUsage[] }) {
  const usageMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of dailyUsage) m.set(d.date, d.messages)
    return m
  }, [dailyUsage])

  const { weeks, monthMarkers, maxCount } = useMemo(() => {
    const today = new Date()
    // Go back 364 days from today, then align to start of week (Sunday)
    const end = new Date(today)
    const start = new Date(end)
    start.setDate(start.getDate() - 364)
    // Align to Sunday
    start.setDate(start.getDate() - start.getDay())

    const allWeeks: { dateStr: string; count: number; month: number; year: number }[][] = []
    let cur: { dateStr: string; count: number; month: number; year: number }[] = []
    let max = 0

    // Track month labels: for each month, record which week index it first appears in
    const seenMonths = new Set<string>()
    const markers: { label: string; weekIdx: number }[] = []
    let wi = 0

    const d = new Date(start)
    while (d <= end) {
      const ds = d.toISOString().slice(0, 10)
      const count = usageMap.get(ds) || 0
      if (count > max) max = count
      cur.push({ dateStr: ds, count, month: d.getMonth(), year: d.getFullYear() })

      // Track month first appearance
      const mk = `${d.getFullYear()}-${d.getMonth()}`
      if (!seenMonths.has(mk)) {
        seenMonths.add(mk)
        const mn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        markers.push({ label: mn[d.getMonth()], weekIdx: wi })
      }

      d.setDate(d.getDate() + 1)
      if (cur.length === 7) {
        allWeeks.push(cur)
        cur = []
        wi++
      }
    }
    if (cur.length > 0) allWeeks.push(cur)

    return { weeks: allWeeks, monthMarkers: markers, maxCount: max || 1 }
  }, [usageMap])

  const getLevel = (count: number): number => {
    if (count === 0) return 0
    const r = count / maxCount
    if (r <= 0.25) return 1
    if (r <= 0.5) return 2
    if (r <= 0.75) return 3
    return 4
  }

  if (weeks.length === 0) return null

  // Build month label row: place labels at their week index offset
  // Each week column = 11px cell + 3px gap = 14px
  const COL_W = 14

  return (
    <HMWrap>
      {/* Month labels */}
      <div style={{ display: 'flex', height: 16, marginBottom: 4, position: 'relative' }}>
        {monthMarkers.map((m, i) => {
          const left = m.weekIdx * COL_W
          return (
            <span
              key={i}
              style={{
                position: 'absolute',
                left,
                fontSize: 10,
                color: 'var(--color-text-secondary, #888)',
                whiteSpace: 'nowrap'
              }}>
              {m.label}
            </span>
          )
        })}
      </div>

      <HMGrid>
        {weeks.map((week, wi) => (
          <HMCol key={wi}>
            {week.map((day, di) => (
              <HMCell key={di} $level={getLevel(day.count)} title={`${day.dateStr}: ${day.count} messages`} />
            ))}
          </HMCol>
        ))}
      </HMGrid>

      <HMLegend>
        Less
        {[0, 1, 2, 3, 4].map((lvl) => (
          <HMCell key={lvl} $level={lvl} title="" style={{ width: 11, height: 11, borderRadius: 2 }} />
        ))}
        More
      </HMLegend>
    </HMWrap>
  )
}

// ─── Stats Display ──────────────────────────────────────────────────────────

function StatsDisplay({ stats }: { stats: TopicStats }) {
  const { t } = useTranslation()

  const tokTotal = stats.totalTokens || 1
  const costTotal = stats.totalCost || 1
  const maxModelT = stats.modelStats.length > 0 ? stats.modelStats[0].totalTokens : 1

  return (
    <>
      {/* ── Overview Cards ── */}
      <OV>
        <OCard $a="#6366f1">
          <OIcon $c="#6366f1">
            <MessageSquare size={14} />
          </OIcon>
          <OVal>{stats.totalMessages}</OVal>
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
            <Coins size={14} />
          </OIcon>
          <OVal>{fmtCost(stats.totalCost)}</OVal>
          <OLbl>{t('stats.total_cost')}</OLbl>
        </OCard>
        <OCard $a="#ef4444">
          <OIcon $c="#ef4444">
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

        {/* Message count — compact non-wrapping row */}
        <CompactRow>
          <CompactLabel>
            <MessageSquare size={13} />
            {t('stats.messages')}
          </CompactLabel>
          <CompactVal>
            <strong>{stats.totalMessages}</strong>
            <span style={{ color: 'var(--color-text-secondary, #888)' }}>
              (<User size={10} style={{ verticalAlign: 'baseline' }} /> {stats.userMessages}{' '}
              <Bot size={10} style={{ verticalAlign: 'baseline' }} /> {stats.assistantMessages})
            </span>
          </CompactVal>
        </CompactRow>
        <SettingDivider />
        <CompactRow>
          <CompactLabel>
            <Clock size={13} />
            {t('stats.duration')}
          </CompactLabel>
          <CompactVal>
            <strong>{fmtDuration(stats.durationMs)}</strong>
          </CompactVal>
        </CompactRow>
        <SettingDivider />
        <CompactRow>
          <CompactLabel>
            <Type size={13} />
            {t('stats.total_characters')}
          </CompactLabel>
          <CompactVal>
            <strong>{stats.totalCharacters.toLocaleString()}</strong>
          </CompactVal>
        </CompactRow>
        <SettingDivider />
        <CompactRow>
          <CompactLabel>
            <FileText size={13} />
            {t('stats.total_words')}
          </CompactLabel>
          <CompactVal>
            <strong>{stats.totalWords.toLocaleString()}</strong>
          </CompactVal>
        </CompactRow>
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
            <BSeg $w={(stats.totalInputTokens / tokTotal) * 100} $c={COLORS.input} />
            <BSeg $w={(stats.totalOutputTokens / tokTotal) * 100} $c={COLORS.output} />
            {stats.totalThinkingTokens > 0 && (
              <BSeg $w={(stats.totalThinkingTokens / tokTotal) * 100} $c={COLORS.thinking} />
            )}
          </BTrack>
          <BLegend>
            <BLItem>
              <BLDot $c={COLORS.input} />
              {t('stats.input_tokens')}{' '}
              <strong style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalInputTokens)}</strong>
            </BLItem>
            <BLItem>
              <BLDot $c={COLORS.output} />
              {t('stats.output_tokens')}{' '}
              <strong style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalOutputTokens)}</strong>
            </BLItem>
            {stats.totalThinkingTokens > 0 && (
              <BLItem>
                <BLDot $c={COLORS.thinking} />
                {t('stats.thinking_tokens')}{' '}
                <strong style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalThinkingTokens)}</strong>
              </BLItem>
            )}
          </BLegend>
        </SettingGroup>
      )}

      {/* ── Cost Breakdown ── */}
      {stats.totalCost > 0 && (
        <SettingGroup>
          <SettingTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Coins size={15} />
              {t('stats.cost_breakdown')}
            </span>
            <strong style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{fmtCost(stats.totalCost)}</strong>
          </SettingTitle>
          <SettingDivider />
          <BTrack>
            <BSeg $w={(stats.inputCost / costTotal) * 100} $c="#f59e0b" />
            <BSeg $w={(stats.outputCost / costTotal) * 100} $c="#ef4444" />
          </BTrack>
          <BLegend>
            <BLItem>
              <BLDot $c="#f59e0b" />
              {t('stats.input_cost')} <strong style={{ color: 'var(--color-text)' }}>{fmtCost(stats.inputCost)}</strong>
            </BLItem>
            <BLItem>
              <BLDot $c="#ef4444" />
              {t('stats.output_cost')}{' '}
              <strong style={{ color: 'var(--color-text)' }}>{fmtCost(stats.outputCost)}</strong>
            </BLItem>
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
          <MBContainer>
            {stats.modelStats.map((m, i) => (
              <MBox key={m.modelId}>
                <MTop>
                  <MName title={m.modelName}>{m.modelName}</MName>
                  <MBadge>{fmtProvider(m.provider)}</MBadge>
                </MTop>
                <MTrack>
                  <MFill $w={maxModelT > 0 ? (m.totalTokens / maxModelT) * 100 : 0} $c={MODEL_C[i % MODEL_C.length]} />
                </MTrack>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                  <MMeta>
                    <span>
                      {t('stats.messages')}: <strong style={{ color: 'var(--color-text)' }}>{m.messageCount}</strong>
                    </span>
                    <span>
                      Tokens: <strong style={{ color: 'var(--color-text)' }}>{fmtTokens(m.totalTokens)}</strong>
                    </span>
                    {m.cost > 0 && (
                      <span>
                        {t('stats.total_cost')}:{' '}
                        <strong style={{ color: 'var(--color-text)' }}>{fmtCost(m.cost)}</strong>
                      </span>
                    )}
                  </MMeta>
                </div>
              </MBox>
            ))}
          </MBContainer>
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

// ─── Loading State ──────────────────────────────────────────────────────────

const LoadingState = styled.div`
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 48px 24px; color: var(--color-text-secondary, #888); font-size: 14px;

  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  svg { animation: spin 1s linear infinite; }
`

// ─── Main Component ─────────────────────────────────────────────────────────

const StatsSettings: React.FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [stats, setStats] = useState<TopicStats | null>(null)

  useEffect(() => {
    let cancelled = false
    computeGlobalStatsFromDB().then((r) => {
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
