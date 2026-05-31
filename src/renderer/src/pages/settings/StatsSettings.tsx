import { useTheme } from '@renderer/context/ThemeProvider'
import type { DailyUsage, ModelStats, TopicStats } from '@renderer/utils/topicStats'
import { computeGlobalStatsFromDB } from '@renderer/utils/topicStats'
import { Select } from 'antd'
import { BarChart3, Bot, Clock, Cpu, FileText, Gauge, Loader, MessageSquare, Type, Zap } from 'lucide-react'
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

/** Duration without seconds — d/h/m granularity for global stats */
function fmtDurationCoarse(ms: number, t: (k: string) => string): string {
  if (ms <= 0) return '—'
  if (ms < 60_000) return '<1' + t('stats.duration_m')
  let r = Math.floor(ms / 1000)
  const parts: string[] = []
  const d = Math.floor(r / 86400)
  if (d > 0) {
    parts.push(`${d}${t('stats.duration_d')}`)
    r %= 86400
  }
  const h = Math.floor(r / 3600)
  if (h > 0) {
    parts.push(`${h}${t('stats.duration_h')}`)
    r %= 3600
  }
  const m = Math.floor(r / 60)
  if (m > 0) {
    parts.push(`${m}${t('stats.duration_m')}`)
    r %= 60
  }
  // drop seconds for global
  return parts.join(' ') || `<1${t('stats.duration_m')}`
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const C = { input: '#6366f1', output: '#10b981', thinking: '#a855f7' }
const MODEL_C = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']

// ─── Bar ────────────────────────────────────────────────────────────────────

const BTrack = styled.div` height: 20px; border-radius: 6px; background: var(--color-background-soft); overflow: hidden; display: flex; margin-bottom: 8px; `
const BSeg = styled.div<{
  $w: number
  $c: string
}>` width: ${(p) => p.$w}%; background: ${(p) => p.$c}; min-width: ${(p) => (p.$w > 0 ? 2 : 0)}px; transition: width 0.4s ease; `
const BLegend = styled.div` display: flex; gap: 16px; flex-wrap: wrap; `
const BLItem = styled.div` display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--color-text-secondary, #888); `
const BLDot = styled.div<{
  $c: string
}>` width: 9px; height: 9px; border-radius: 2px; background: ${(p) => p.$c}; flex-shrink: 0; `

// ─── Model Cards ────────────────────────────────────────────────────────────

const MBContainer = styled.div` display: flex; flex-direction: column; gap: 8px; `
const MBox = styled.div` background: var(--color-background-soft); border: 0.5px solid var(--color-border); border-radius: 8px; padding: 12px 14px; `
const MTop = styled.div` display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 6px; `
const MName = styled.span` font-size: 13px; font-weight: 600; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; `
const MBadge = styled.span` font-size: 10px; color: var(--color-text-secondary, #888); background: var(--color-background); padding: 2px 6px; border-radius: 4px; flex-shrink: 0; white-space: nowrap; `
const MTrack = styled.div` height: 8px; border-radius: 4px; background: var(--color-background); overflow: hidden; margin-bottom: 6px; `
const MFill = styled.div<{
  $w: number
  $c: string
}>` height: 100%; width: ${(p) => p.$w}%; background: ${(p) => p.$c}; border-radius: 4px; transition: width 0.5s ease; `
const MMeta = styled.div` display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 4px 12px; font-size: 11px; color: var(--color-text-secondary, #888); font-variant-numeric: tabular-nums; `
const MFilter = styled.div` display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; `
const MSearch = styled.input` background: var(--color-background-soft); border: 0.5px solid var(--color-border); border-radius: 6px; padding: 0 8px; font-size: 13px; color: var(--color-text); outline: none; min-width: 160px; height: 24px; line-height: 24px; box-sizing: border-box; &::placeholder{color:var(--color-text-secondary, #888)} &:focus{border-color:#6366f1} `

// ─── Heatmap ────────────────────────────────────────────────────────────────

// Continuous color: interpolate between light green (1 msg) and dark green (max msg)
function heatColor(count: number, max: number): string {
  if (count === 0) return 'var(--color-background-soft)'
  const r = Math.max(0, Math.min(1, Math.log(count + 1) / Math.log(max + 1)))
  // light green #9be9a8 → dark green #216e39
  const R = Math.round(155 + (33 - 155) * r)
  const G = Math.round(233 + (110 - 233) * r)
  const B = Math.round(168 + (57 - 168) * r)
  return `rgb(${R},${G},${B})`
}

function DailyHeatmap({ dailyUsage }: { dailyUsage: DailyUsage[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const um = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of dailyUsage) m.set(d.date, d.messages)
    return m
  }, [dailyUsage])
  const { weeks, markers, maxC } = useMemo(() => {
    const today = new Date()
    const end = new Date(today)
    const start = new Date(end)
    start.setFullYear(start.getFullYear() - 1)
    start.setDate(start.getDate() - start.getDay())
    const aw: { ds: string; c: number; mo: number }[][] = []
    let cur: (typeof aw)[0] = []
    let mx = 0
    const mn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const ms: { l: string; wi: number }[] = []
    let lm = -1,
      wi = 0
    const d = new Date(start)
    while (d <= end) {
      const ds = d.toISOString().slice(0, 10)
      const c = um.get(ds) || 0
      if (c > mx) mx = c
      cur.push({ ds, c, mo: d.getMonth() })
      if (d.getMonth() !== lm) {
        if (lm !== -1) ms.push({ l: mn[lm], wi })
        lm = d.getMonth()
      }
      d.setDate(d.getDate() + 1)
      if (cur.length === 7) {
        aw.push(cur)
        cur = []
        wi++
      }
    }
    if (cur.length > 0) aw.push(cur)
    if (lm >= 0) ms.push({ l: mn[lm], wi })
    return { weeks: aw, markers: ms, maxC: mx || 1 }
  }, [um])
  if (weeks.length === 0) return null
  const wm = new Map<number, string>()
  for (const m of markers) wm.set(m.wi, m.l)
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', overflowX: 'auto' }}
      onMouseLeave={() => setTip(null)}>
      <div style={{ display: 'flex', gap: 3, marginBottom: 4, height: 16 }}>
        {weeks.map((_, wi) => (
          <div
            key={wi}
            style={{
              width: 12,
              flexShrink: 0,
              fontSize: 10,
              color: 'var(--color-text-secondary, #888)',
              lineHeight: '16px'
            }}>
            {wm.get(wi) || ''}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {weeks.map((wk, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {wk.map((dy, di) => {
              return (
                <div
                  key={di}
                  title={`${dy.ds}: ${dy.c} messages`}
                  onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${dy.ds}: ${dy.c} messages` })}
                  onMouseOver={(e) => {
                    ;(e.currentTarget as HTMLElement).style.outline = '2px solid var(--color-text)'
                  }}
                  onMouseOut={(e) => {
                    ;(e.currentTarget as HTMLElement).style.outline = 'none'
                  }}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    flexShrink: 0,
                    cursor: dy.c > 0 ? 'pointer' : 'default',
                    background: heatColor(dy.c, maxC)
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>
      {tip && (
        <div
          style={{
            position: 'fixed',
            left: tip.x + 10,
            top: tip.y - 30,
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
          {tip.text}
        </div>
      )}
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
        Less{' '}
        {[0, 1, 2, 3, 4].map((l) => (
          <div
            key={l}
            style={{
              width: 12,
              height: 12,
              borderRadius: 2,
              flexShrink: 0,
              background:
                l === 0 ? 'var(--color-background-soft)' : heatColor(l === 4 ? maxC : Math.ceil((maxC * l) / 4), maxC)
            }}
          />
        ))}{' '}
        More
      </div>
    </div>
  )
}

// ─── Model Filter ───────────────────────────────────────────────────────────

function ModelUsageSection({ stats }: { stats: ModelStats[] }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [sb, setSb] = useState<'tokens' | 'messages' | 'speed'>('tokens')
  const [pf, setPf] = useState('all')
  const [lim, setLim] = useState(10)
  const provs = useMemo(() => {
    const s = new Set<string>()
    for (const m of stats) s.add(fmtProvider(m.provider))
    return [...s].sort()
  }, [stats])
  const list = useMemo(() => {
    let l = [...stats]
    if (q) {
      const lo = q.toLowerCase()
      l = l.filter((m) => m.modelName.toLowerCase().includes(lo) || fmtProvider(m.provider).toLowerCase().includes(lo))
    }
    if (pf !== 'all') l = l.filter((m) => fmtProvider(m.provider) === pf)
    l.sort((a, b) =>
      sb === 'tokens'
        ? b.totalTokens - a.totalTokens
        : sb === 'messages'
          ? b.messageCount - a.messageCount
          : b.avgTokensPerSecond - a.avgTokensPerSecond
    )
    return l.slice(0, lim)
  }, [stats, q, sb, pf, lim])
  const maxT = list[0]?.totalTokens || 1
  return (
    <>
      <MFilter>
        <MSearch placeholder="Search models..." value={q} onChange={(e) => setQ(e.target.value)} />
        <Select
          size="small"
          value={pf}
          onChange={setPf}
          options={[
            { value: 'all', label: t('stats.model_filter_all') },
            ...provs.map((p) => ({ value: p, label: p }))
          ]}
        />
        <Select
          size="small"
          value={sb}
          onChange={setSb}
          options={[
            { value: 'tokens', label: t('stats.model_sort_tokens') },
            { value: 'messages', label: t('stats.model_sort_messages') },
            { value: 'speed', label: t('stats.model_sort_speed') }
          ]}
        />
        <Select
          size="small"
          value={lim}
          onChange={setLim}
          options={[
            { value: 10, label: '10' },
            { value: 20, label: '20' },
            { value: 50, label: '50' },
            { value: 100, label: '100' }
          ]}
        />
      </MFilter>
      <MBContainer>
        {list.map((m, i) => (
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

// ─── Main Display — no overview cards, key metrics in Conversation Info ─────

function StatsDisplay({ stats }: { stats: TopicStats }) {
  const { t } = useTranslation()
  const tokTotal = stats.totalTokens || 1

  return (
    <>
      {/* Conversation Info — includes key overview metrics inline */}
      <SettingGroup>
        <SettingTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={15} />
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
            <Cpu size={13} style={{ marginRight: 6 }} />
            {t('stats.total_tokens')}
          </SettingRowTitle>
          <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {fmtTokens(stats.totalTokens)}
          </strong>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <Clock size={13} style={{ marginRight: 6 }} />
            {t('stats.duration')}
          </SettingRowTitle>
          <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {fmtDurationCoarse(stats.durationMs, t)}
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

      {/* Performance */}
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
              {fmtLatency(stats.avgCompletionTime)}
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

      {/* Token Breakdown */}
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

      {/* Daily Heatmap */}
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

      {/* Model Usage */}
      {stats.modelStats.length > 0 && (
        <SettingGroup>
          <SettingTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bot size={15} />
              {t('stats.model_usage')}
            </span>
          </SettingTitle>
          <SettingDivider />
          <ModelUsageSection stats={stats.modelStats} />
        </SettingGroup>
      )}
    </>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

const StatsSettings: React.FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [stats, setStats] = useState<TopicStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let c = false
    void computeGlobalStatsFromDB().then((r) => {
      if (!c) {
        setStats(r)
        setLoading(false)
      }
    })
    return () => {
      c = true
    }
  }, [])

  if (stats === null && loading) {
    return (
      <SettingContainer theme={theme}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '48px 24px',
            color: 'var(--color-text-secondary, #888)',
            fontSize: 14
          }}>
          <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
          {t('stats.loading')}
        </div>
      </SettingContainer>
    )
  }

  return (
    <SettingContainer theme={theme}>
      {stats === null || stats.totalMessages === 0 ? (
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
