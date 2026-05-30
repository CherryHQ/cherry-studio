import { TopView } from '@renderer/components/TopView'
import { useAppSelector } from '@renderer/store'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { computeTopicStats } from '@renderer/utils/topicStats'
import { Modal as AntdModal } from 'antd'
import { BarChart3, Bot, Coins, Cpu, FileText, Gauge, MessageSquare, User, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
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

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
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

const ModelRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);

  &:last-child {
    border-bottom: none;
  }
`

const ModelName = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: 12px;
`

const ModelBar = styled.div`
  height: 6px;
  border-radius: 3px;
  background: var(--color-background-soft, rgba(255, 255, 255, 0.03));
  overflow: hidden;
  width: 80px;
  margin-right: 12px;
`

const ModelBarFill = styled.div<{ $width: number }>`
  height: 100%;
  width: ${(p) => p.$width}%;
  background: var(--color-primary);
  border-radius: 3px;
`

const ModelMetric = styled.span`
  font-size: 12px;
  color: var(--color-text-secondary, #888);
  font-variant-numeric: tabular-nums;
  min-width: 50px;
  text-align: right;
`

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
`

const PerfLabel = styled.div`
  font-size: 11px;
  color: var(--color-text-secondary, #888);
`

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
  const { t } = useTranslation()

  const messages = useAppSelector((state) => selectMessagesForTopic(state, topicId))
  const stats = useMemo(() => computeTopicStats(messages), [messages])

  const maxModelTokens = stats.modelStats.length > 0 ? stats.modelStats[0].totalTokens : 1

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
      width={600}
      centered
      destroyOnClose
      transitionName="animation-move-down">
      {stats.totalMessages === 0 ? (
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

          {/* Models */}
          {stats.modelStats.length > 0 && (
            <Section>
              <SectionTitle>
                <Bot size={13} /> {t('stats.model_usage')}
              </SectionTitle>
              {stats.modelStats.map((m) => (
                <ModelRow key={m.modelId}>
                  <ModelName title={m.modelName}>{m.modelName}</ModelName>
                  <ModelBar>
                    <ModelBarFill $width={(m.totalTokens / maxModelTokens) * 100} />
                  </ModelBar>
                  <ModelMetric>{m.messageCount} msgs</ModelMetric>
                  <ModelMetric>{formatCost(m.cost)}</ModelMetric>
                </ModelRow>
              ))}
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
              <FileText size={13} /> {t('stats.conversation_info')}
            </SectionTitle>
            <InfoGrid>
              <InfoItem>
                <InfoLabel>{t('stats.created_at')}</InfoLabel>
                <InfoValue>{formatDate(stats.firstMessageAt)}</InfoValue>
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
