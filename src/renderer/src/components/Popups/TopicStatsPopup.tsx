import { TopView } from '@renderer/components/TopView'
import type { TopicStats } from '@renderer/utils/topicStats'
import { computeTopicStatsFromDB } from '@renderer/utils/topicStats'
import { Modal as AntdModal, Spin } from 'antd'
import { BarChart3, Bot, Coins, Cpu, Gauge, MessageSquare, User, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ShowParams {
  topicId: string
  topicName: string
}

interface Props extends ShowParams {
  resolve: () => void
}

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

// ─── Styled Components ──────────────────────────────────────────────────────

const Modal = styled(AntdModal)`
  .ant-modal-close {
    top: 8px;
  }
  .ant-modal-body {
    padding: 20px 24px;
    max-height: 70vh;
    overflow-y: auto;
  }
`

const Section = styled.div`
  margin-bottom: 20px;
`

const SectionTitle = styled.h3`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  text-transform: uppercase;
  letter-spacing: 0.3px;
`

const OverviewGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 20px;
`

const StatCard = styled.div<{ $accent: string }>`
  background: var(--color-background-soft, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 12px;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: ${(p) => p.$accent};
  }
`

const StatCardIcon = styled.div<{ $color: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: ${(p) => `${p.$color}15`};
  color: ${(p) => p.$color};
  margin-bottom: 8px;
`

const StatCardValue = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1.2;
  margin-bottom: 2px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const StatCardLabel = styled.div`
  font-size: 11px;
  color: var(--color-text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.3px;
`

const StackedBarTrack = styled.div`
  height: 20px;
  border-radius: 6px;
  background: var(--color-background-soft, rgba(255, 255, 255, 0.03));
  overflow: hidden;
  display: flex;
  margin-bottom: 6px;
`

const StackedBarSegment = styled.div<{ $width: number; $color: string }>`
  width: ${(p) => p.$width}%;
  background: ${(p) => p.$color};
  min-width: ${(p) => (p.$width > 0 ? '2px' : '0')};
`

const BarLegend = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
`

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--color-text-secondary, #888);
`

const LegendDot = styled.div<{ $color: string }>`
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: ${(p) => p.$color};
`

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
`

const ModelBarMetrics = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-secondary, #888);
  font-variant-numeric: tabular-nums;
`

// ─── Performance Grid ───────────────────────────────────────────────────────

const PerfGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
`

const PerfCard = styled.div`
  background: var(--color-background-soft, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
`

const PerfValue = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 2px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const PerfLabel = styled.div`
  font-size: 11px;
  color: var(--color-text-secondary, #888);
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

function DailyHeatmap({ dailyUsage }: { dailyUsage: { date: string; messages: number }[] }) {
  const usageMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of dailyUsage) {
      map.set(d.date, d.messages)
    }
    return map
  }, [dailyUsage])

  const { weeks, monthLabels } = useMemo(() => {
    const today = new Date()
    const startDate = new Date(today)
    startDate.setDate(startDate.getDate() - 364)
    const dayOfWeek = startDate.getDay()
    startDate.setDate(startDate.getDate() - dayOfWeek)

    const weeksArr: { dateStr: string; count: number }[][] = []
    let currentWeek: { dateStr: string; count: number }[] = []
    const monthsSet = new Set<string>()
    const mLabels: { label: string; weekIdx: number }[] = []
    let weekIdx = 0

    const d = new Date(startDate)
    while (d <= today) {
      const dateStr = d.toISOString().slice(0, 10)
      const count = usageMap.get(dateStr) || 0
      currentWeek.push({ dateStr, count })

      const monthKey = `${d.getFullYear()}-${d.getMonth()}`
      if (!monthsSet.has(monthKey)) {
        monthsSet.add(monthKey)
        const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        mLabels.push({ label: names[d.getMonth()], weekIdx })
      }

      if (currentWeek.length === 7) {
        weeksArr.push(currentWeek)
        currentWeek = []
        weekIdx++
      }
      d.setDate(d.getDate() + 1)
    }
    if (currentWeek.length > 0) weeksArr.push(currentWeek)

    return { weeks: weeksArr, monthLabels: mLabels }
  }, [usageMap])

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
      <div style={{ display: 'flex', marginBottom: 4 }}>
        {monthLabels.map((m, i) => {
          const gap = i === 0 ? m.weekIdx * 15 : (m.weekIdx - monthLabels[i - 1].weekIdx) * 15
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
    </HeatmapContainer>
  )
}

// ─── Info Grid ──────────────────────────────────────────────────────────────

const InfoGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
`

const InfoItem = styled.div``

const InfoLabel = styled.div`
  font-size: 11px;
  color: var(--color-text-secondary, #888);
  margin-bottom: 2px;
`

const InfoValue = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
`

const EmptyState = styled.div`
  text-align: center;
  padding: 32px 16px;
  color: var(--color-text-secondary, #888);
  font-size: 14px;
`

// ─── Container Component ────────────────────────────────────────────────────

const COLORS = {
  input: '#6366f1',
  output: '#10b981',
  thinking: '#a855f7',
  card1: '#6366f1',
  card2: '#10b981',
  card3: '#f59e0b',
  card4: '#ef4444'
}

const TopicStatsPopupContainer: React.FC<Props> = ({ topicId, topicName, resolve }) => {
  const [open, setOpen] = useState(true)
  const [stats, setStats] = useState<TopicStats | null>(null)
  const { t } = useTranslation()

  useEffect(() => {
    let cancelled = false
    computeTopicStatsFromDB(topicId).then((result) => {
      if (!cancelled) setStats(result)
    })
    return () => {
      cancelled = true
    }
  }, [topicId])

  const maxModelTokens = stats && stats.modelStats.length > 0 ? stats.modelStats[0].totalTokens : 1

  const afterClose = () => {
    TopicStatsPopup.hide()
    resolve()
  }

  TopicStatsPopup.hide = () => setOpen(false)

  return (
    <Modal
      open={open}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BarChart3 size={18} />
          {t('stats.title', { topic: topicName })}
        </span>
      }
      onCancel={() => setOpen(false)}
      onOk={() => setOpen(false)}
      afterClose={afterClose}
      footer={null}
      width={620}
      centered
      destroyOnClose
      transitionName="animation-move-down">
      {stats === null ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : stats.totalMessages === 0 ? (
        <EmptyState>{t('stats.no_data')}</EmptyState>
      ) : (
        <>
          {/* Overview */}
          <OverviewGrid>
            <StatCard $accent={COLORS.card1}>
              <StatCardIcon $color={COLORS.card1}>
                <MessageSquare size={14} />
              </StatCardIcon>
              <StatCardValue>{stats.totalMessages}</StatCardValue>
              <StatCardLabel>{t('stats.messages')}</StatCardLabel>
            </StatCard>
            <StatCard $accent={COLORS.card2}>
              <StatCardIcon $color={COLORS.card2}>
                <Cpu size={14} />
              </StatCardIcon>
              <StatCardValue>{formatTokens(stats.totalTokens)}</StatCardValue>
              <StatCardLabel>{t('stats.total_tokens')}</StatCardLabel>
            </StatCard>
            <StatCard $accent={COLORS.card3}>
              <StatCardIcon $color={COLORS.card3}>
                <Coins size={14} />
              </StatCardIcon>
              <StatCardValue>{formatCost(stats.totalCost)}</StatCardValue>
              <StatCardLabel>{t('stats.total_cost')}</StatCardLabel>
            </StatCard>
            <StatCard $accent={COLORS.card4}>
              <StatCardIcon $color={COLORS.card4}>
                <Zap size={14} />
              </StatCardIcon>
              <StatCardValue>{formatLatency(stats.avgFirstTokenLatency)}</StatCardValue>
              <StatCardLabel>{t('stats.avg_first_token')}</StatCardLabel>
            </StatCard>
          </OverviewGrid>

          {/* Tokens */}
          {stats.totalTokens > 0 && (
            <Section>
              <SectionTitle>
                <Cpu size={13} /> {t('stats.token_breakdown')}
              </SectionTitle>
              <StackedBarTrack>
                <StackedBarSegment $width={(stats.totalInputTokens / stats.totalTokens) * 100} $color={COLORS.input} />
                <StackedBarSegment
                  $width={(stats.totalOutputTokens / stats.totalTokens) * 100}
                  $color={COLORS.output}
                />
                {stats.totalThinkingTokens > 0 && (
                  <StackedBarSegment
                    $width={(stats.totalThinkingTokens / stats.totalTokens) * 100}
                    $color={COLORS.thinking}
                  />
                )}
              </StackedBarTrack>
              <BarLegend>
                <LegendItem>
                  <LegendDot $color={COLORS.input} />
                  {t('stats.input_tokens')}{' '}
                  <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                    {formatTokens(stats.totalInputTokens)}
                  </span>
                </LegendItem>
                <LegendItem>
                  <LegendDot $color={COLORS.output} />
                  {t('stats.output_tokens')}{' '}
                  <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                    {formatTokens(stats.totalOutputTokens)}
                  </span>
                </LegendItem>
                {stats.totalThinkingTokens > 0 && (
                  <LegendItem>
                    <LegendDot $color={COLORS.thinking} />
                    {t('stats.thinking_tokens')}{' '}
                    <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                      {formatTokens(stats.totalThinkingTokens)}
                    </span>
                  </LegendItem>
                )}
              </BarLegend>
            </Section>
          )}

          {/* Cost */}
          {stats.totalCost > 0 && (
            <Section>
              <SectionTitle>
                <Coins size={13} /> {t('stats.cost_breakdown')}
              </SectionTitle>
              <StackedBarTrack>
                <StackedBarSegment $width={(stats.inputCost / stats.totalCost) * 100} $color="#f59e0b" />
                <StackedBarSegment $width={(stats.outputCost / stats.totalCost) * 100} $color="#ef4444" />
              </StackedBarTrack>
              <BarLegend>
                <LegendItem>
                  <LegendDot $color="#f59e0b" />
                  {t('stats.input_cost')}{' '}
                  <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{formatCost(stats.inputCost)}</span>
                </LegendItem>
                <LegendItem>
                  <LegendDot $color="#ef4444" />
                  {t('stats.output_cost')}{' '}
                  <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{formatCost(stats.outputCost)}</span>
                </LegendItem>
              </BarLegend>
            </Section>
          )}

          {/* Daily Usage */}
          {stats.dailyUsage.length > 0 && (
            <Section>
              <SectionTitle>
                <BarChart3 size={13} /> {t('stats.daily_usage')}
              </SectionTitle>
              <DailyHeatmap dailyUsage={stats.dailyUsage} />
            </Section>
          )}

          {/* Models */}
          {stats.modelStats.length > 0 && (
            <Section>
              <SectionTitle>
                <Bot size={13} /> {t('stats.model_usage')}
              </SectionTitle>
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
            </Section>
          )}

          {/* Performance */}
          {stats.assistantMessages > 0 && (
            <Section>
              <SectionTitle>
                <Gauge size={13} /> {t('stats.performance')}
              </SectionTitle>
              <PerfGrid>
                <PerfCard>
                  <PerfValue>{formatLatency(stats.avgFirstTokenLatency)}</PerfValue>
                  <PerfLabel>{t('stats.avg_first_token')}</PerfLabel>
                </PerfCard>
                <PerfCard>
                  <PerfValue>{formatDuration(stats.avgCompletionTime)}</PerfValue>
                  <PerfLabel>{t('stats.avg_completion')}</PerfLabel>
                </PerfCard>
                <PerfCard>
                  <PerfValue>{formatSpeed(stats.avgTokensPerSecond)}</PerfValue>
                  <PerfLabel>{t('stats.avg_speed')}</PerfLabel>
                </PerfCard>
              </PerfGrid>
            </Section>
          )}

          {/* Info */}
          <Section>
            <SectionTitle>
              <MessageSquare size={13} /> {t('stats.conversation_info')}
            </SectionTitle>
            <InfoGrid>
              <InfoItem>
                <InfoLabel>{t('stats.created_at')}</InfoLabel>
                <InfoValue>{stats.firstMessageAt ? new Date(stats.firstMessageAt).toLocaleString() : '—'}</InfoValue>
              </InfoItem>
              <InfoItem>
                <InfoLabel>{t('stats.duration')}</InfoLabel>
                <InfoValue>{formatDuration(stats.durationMs)}</InfoValue>
              </InfoItem>
              <InfoItem>
                <InfoLabel>{t('stats.total_characters')}</InfoLabel>
                <InfoValue>{stats.totalCharacters.toLocaleString()}</InfoValue>
              </InfoItem>
              <InfoItem>
                <InfoLabel>
                  <User size={11} style={{ verticalAlign: 'middle' }} /> {t('stats.user_messages')}
                </InfoLabel>
                <InfoValue>{stats.userMessages}</InfoValue>
              </InfoItem>
              <InfoItem>
                <InfoLabel>
                  <Bot size={11} style={{ verticalAlign: 'middle' }} /> {t('stats.assistant_messages')}
                </InfoLabel>
                <InfoValue>{stats.assistantMessages}</InfoValue>
              </InfoItem>
              <InfoItem>
                <InfoLabel>{t('stats.total_words')}</InfoLabel>
                <InfoValue>{stats.totalWords.toLocaleString()}</InfoValue>
              </InfoItem>
            </InfoGrid>
          </Section>
        </>
      )}
    </Modal>
  )
}

// ─── TopView Popup Class ────────────────────────────────────────────────────

const TopViewKey = 'TopicStatsPopup'

export default class TopicStatsPopup {
  static hide() {
    TopView.hide(TopViewKey)
  }

  static show(props: ShowParams): Promise<void> {
    return new Promise<void>((resolve) => {
      TopView.show(
        <TopicStatsPopupContainer
          {...props}
          resolve={() => {
            resolve()
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
