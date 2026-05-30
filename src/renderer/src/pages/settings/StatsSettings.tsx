import { useTheme } from '@renderer/context/ThemeProvider'
import type { TopicStats } from '@renderer/utils/topicStats'
import { computeGlobalStatsFromDB } from '@renderer/utils/topicStats'
import { BarChart3, Bot, Coins, Cpu, Gauge, Loader, MessageSquare, User, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatSpeed(tokensPerSec: number): string {
  if (tokensPerSec < 1) return '—'
  return `${Math.round(tokensPerSec)} tok/s`
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
            <MessageSquare size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('stats.messages')}
          </SettingRowTitle>
          <span
            style={{
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
            <strong>{stats.totalMessages}</strong>
            <span style={{ color: 'var(--color-text-secondary, #888)', fontSize: 12 }}>
              (<User size={11} style={{ verticalAlign: 'middle' }} />
              {stats.userMessages} / <Bot size={11} style={{ verticalAlign: 'middle' }} />
              {stats.assistantMessages})
            </span>
          </span>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('stats.duration')}</SettingRowTitle>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDuration(stats.durationMs)}</span>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('stats.total_characters')}</SettingRowTitle>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.totalCharacters.toLocaleString()}</span>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('stats.total_words')}</SettingRowTitle>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.totalWords.toLocaleString()}</span>
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
              <Zap size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {t('stats.avg_first_token')}
            </SettingRowTitle>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {formatLatency(stats.avgFirstTokenLatency)}
            </span>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('stats.avg_completion')}</SettingRowTitle>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {formatDuration(stats.avgCompletionTime)}
            </span>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('stats.avg_speed')}</SettingRowTitle>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {formatSpeed(stats.avgTokensPerSecond)}
            </span>
          </SettingRow>
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
          {stats.modelStats.map((m, i) => (
            <div key={m.modelId}>
              {i > 0 && <SettingDivider />}
              <SettingRow>
                <SettingRowTitle
                  style={{ maxWidth: '50%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={m.modelName}>
                  {m.modelName}
                </SettingRowTitle>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
                  <span style={{ color: 'var(--color-text-secondary, #888)' }}>{m.messageCount} msgs</span>
                  <span style={{ color: 'var(--color-text-secondary, #888)' }}>{formatTokens(m.totalTokens)} tok</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatCost(m.cost)}</span>
                </span>
              </SettingRow>
            </div>
          ))}
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
