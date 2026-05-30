import { TopView } from '@renderer/components/TopView'
import { useAppSelector } from '@renderer/store'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { computeTopicStats } from '@renderer/utils/topicStats'
import { BarChart3, Bot, Coins, Cpu, FileText, Gauge, MessageSquare, User, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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
  const d = new Date(iso)
  return d.toLocaleString()
}

// ─── Styled Components ──────────────────────────────────────────────────────

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease;

  [theme-mode='light'] & {
    background: rgba(0, 0, 0, 0.3);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`

const ModalContent = styled.div`
  background: var(--modal-background, #1a1a2e);
  border-radius: 16px;
  width: 720px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.3);
  animation: slideUp 0.25s ease;

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 3px;
  }
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--color-border);
`

const Title = styled.h2`
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
`

const CloseButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-secondary, #888);
  cursor: pointer;
  font-size: 20px;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.15s;

  &:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
`

const Body = styled.div`
  padding: 20px 24px 24px;
`

// ─── Overview Cards ─────────────────────────────────────────────────────────

const OverviewGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 24px;
`

const StatCard = styled.div<{ $accent?: string }>`
  background: var(--color-background-soft, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 16px;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: ${(p) => p.$accent || 'var(--color-primary)'};
    border-radius: 12px 12px 0 0;
  }
`

const StatCardIcon = styled.div<{ $color?: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: ${(p) => (p.$color ? `${p.$color}15` : 'var(--color-primary-alpha, rgba(99, 102, 241, 0.1))')};
  color: ${(p) => p.$color || 'var(--color-primary)'};
  margin-bottom: 10px;
`

const StatCardValue = styled.div`
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1.2;
  margin-bottom: 4px;
  font-variant-numeric: tabular-nums;
`

const StatCardLabel = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

// ─── Section ────────────────────────────────────────────────────────────────

const Section = styled.div`
  margin-bottom: 24px;
`

const SectionTitle = styled.h3`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

// ─── Stacked Bar ────────────────────────────────────────────────────────────

const StackedBarContainer = styled.div`
  margin-bottom: 16px;
`

const StackedBarTrack = styled.div`
  height: 28px;
  border-radius: 8px;
  background: var(--color-background-soft, rgba(255, 255, 255, 0.03));
  overflow: hidden;
  display: flex;
  margin-bottom: 8px;
`

const StackedBarSegment = styled.div<{ $width: number; $color: string }>`
  width: ${(p) => p.$width}%;
  background: ${(p) => p.$color};
  transition: width 0.5s ease;
  min-width: ${(p) => (p.$width > 0 ? '2px' : '0')};
`

const BarLegend = styled.div`
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
`

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-text-secondary, #888);
`

const LegendDot = styled.div<{ $color: string }>`
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: ${(p) => p.$color};
`

const LegendValue = styled.span`
  color: var(--color-text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`

// ─── Model Table ────────────────────────────────────────────────────────────

const ModelRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 100px 90px 80px;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);

  &:last-child {
    border-bottom: none;
  }
`

const ModelRowHeader = styled(ModelRow)`
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding-bottom: 8px;
`

const ModelName = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ModelBar = styled.div`
  height: 8px;
  border-radius: 4px;
  background: var(--color-background-soft, rgba(255, 255, 255, 0.03));
  overflow: hidden;
`

const ModelBarFill = styled.div<{ $width: number }>`
  height: 100%;
  width: ${(p) => p.$width}%;
  background: var(--color-primary);
  border-radius: 4px;
  transition: width 0.5s ease;
`

const ModelMetric = styled.div`
  font-size: 13px;
  color: var(--color-text-secondary, #888);
  font-variant-numeric: tabular-nums;
`

// ─── Performance Grid ───────────────────────────────────────────────────────

const PerfGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
`

const PerfCard = styled.div`
  background: var(--color-background-soft, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 14px 16px;
  text-align: center;
`

const PerfValue = styled.div`
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 4px;
  font-variant-numeric: tabular-nums;
`

const PerfLabel = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary, #888);
`

// ─── Info Grid ──────────────────────────────────────────────────────────────

const InfoGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
`

const InfoItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const InfoLabel = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary, #888);
`

const InfoValue = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
`

// ─── Empty State ────────────────────────────────────────────────────────────

const EmptyState = styled.div`
  text-align: center;
  padding: 48px 24px;
  color: var(--color-text-secondary, #888);
`

// ─── Container Component ────────────────────────────────────────────────────

const TopicStatsPopupContainer: React.FC<Props> = ({ topicId, topicName, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  const messages = useAppSelector((state) => selectMessagesForTopic(state, topicId))
  const stats = useMemo(() => computeTopicStats(messages), [messages])

  const onClose = () => {
    setOpen(false)
    setTimeout(() => {
      TopicStatsPopup.hide()
      resolve()
    }, 200)
  }

  // Colors
  const COLORS = {
    input: '#6366f1',
    output: '#10b981',
    thinking: '#a855f7',
    primary: 'var(--color-primary)',
    card1: '#6366f1',
    card2: '#10b981',
    card3: '#f59e0b',
    card4: '#ef4444'
  }

  const totalTokensForBar = stats.totalTokens || 1
  const inputPct = (stats.totalInputTokens / totalTokensForBar) * 100
  const outputPct = (stats.totalOutputTokens / totalTokensForBar) * 100
  const thinkingPct = (stats.totalThinkingTokens / totalTokensForBar) * 100

  const totalCostForBar = stats.totalCost || 1
  const inputCostPct = stats.totalCost > 0 ? (stats.inputCost / totalCostForBar) * 100 : 50
  const outputCostPct = stats.totalCost > 0 ? (stats.outputCost / totalCostForBar) * 100 : 50

  const maxModelTokens = stats.modelStats.length > 0 ? stats.modelStats[0].totalTokens : 1

  TopicStatsPopup.hide = onClose

  if (!open) return null

  return (
    <ModalOverlay onClick={onClose}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>
            <BarChart3 size={20} />
            {t('stats.title', { topic: topicName })}
          </Title>
          <CloseButton onClick={onClose}>✕</CloseButton>
        </Header>
        <Body>
          {stats.totalMessages === 0 ? (
            <EmptyState>{t('stats.no_data')}</EmptyState>
          ) : (
            <>
              {/* ── Overview Cards ── */}
              <OverviewGrid>
                <StatCard $accent={COLORS.card1}>
                  <StatCardIcon $color={COLORS.card1}>
                    <MessageSquare size={16} />
                  </StatCardIcon>
                  <StatCardValue>{stats.totalMessages}</StatCardValue>
                  <StatCardLabel>{t('stats.messages')}</StatCardLabel>
                </StatCard>
                <StatCard $accent={COLORS.card2}>
                  <StatCardIcon $color={COLORS.card2}>
                    <Cpu size={16} />
                  </StatCardIcon>
                  <StatCardValue>{formatTokens(stats.totalTokens)}</StatCardValue>
                  <StatCardLabel>{t('stats.total_tokens')}</StatCardLabel>
                </StatCard>
                <StatCard $accent={COLORS.card3}>
                  <StatCardIcon $color={COLORS.card3}>
                    <Coins size={16} />
                  </StatCardIcon>
                  <StatCardValue>{formatCost(stats.totalCost)}</StatCardValue>
                  <StatCardLabel>{t('stats.total_cost')}</StatCardLabel>
                </StatCard>
                <StatCard $accent={COLORS.card4}>
                  <StatCardIcon $color={COLORS.card4}>
                    <Zap size={16} />
                  </StatCardIcon>
                  <StatCardValue>{formatLatency(stats.avgFirstTokenLatency)}</StatCardValue>
                  <StatCardLabel>{t('stats.avg_first_token')}</StatCardLabel>
                </StatCard>
              </OverviewGrid>

              {/* ── Token Breakdown ── */}
              {stats.totalTokens > 0 && (
                <Section>
                  <SectionTitle>
                    <Cpu size={14} />
                    {t('stats.token_breakdown')}
                  </SectionTitle>
                  <StackedBarContainer>
                    <StackedBarTrack>
                      <StackedBarSegment $width={inputPct} $color={COLORS.input} />
                      <StackedBarSegment $width={outputPct} $color={COLORS.output} />
                      <StackedBarSegment $width={thinkingPct} $color={COLORS.thinking} />
                    </StackedBarTrack>
                    <BarLegend>
                      <LegendItem>
                        <LegendDot $color={COLORS.input} />
                        {t('stats.input_tokens')}{' '}
                        <LegendValue>
                          {formatTokens(stats.totalInputTokens)} ({Math.round(inputPct)}%)
                        </LegendValue>
                      </LegendItem>
                      <LegendItem>
                        <LegendDot $color={COLORS.output} />
                        {t('stats.output_tokens')}{' '}
                        <LegendValue>
                          {formatTokens(stats.totalOutputTokens)} ({Math.round(outputPct)}%)
                        </LegendValue>
                      </LegendItem>
                      {stats.totalThinkingTokens > 0 && (
                        <LegendItem>
                          <LegendDot $color={COLORS.thinking} />
                          {t('stats.thinking_tokens')}{' '}
                          <LegendValue>
                            {formatTokens(stats.totalThinkingTokens)} ({Math.round(thinkingPct)}%)
                          </LegendValue>
                        </LegendItem>
                      )}
                    </BarLegend>
                  </StackedBarContainer>
                </Section>
              )}

              {/* ── Cost Breakdown ── */}
              {stats.totalCost > 0 && (
                <Section>
                  <SectionTitle>
                    <Coins size={14} />
                    {t('stats.cost_breakdown')}
                  </SectionTitle>
                  <StackedBarContainer>
                    <StackedBarTrack>
                      <StackedBarSegment $width={inputCostPct} $color="#f59e0b" />
                      <StackedBarSegment $width={outputCostPct} $color="#ef4444" />
                    </StackedBarTrack>
                    <BarLegend>
                      <LegendItem>
                        <LegendDot $color="#f59e0b" />
                        {t('stats.input_cost')}{' '}
                        <LegendValue>
                          {formatCost(stats.inputCost)} ({Math.round(inputCostPct)}%)
                        </LegendValue>
                      </LegendItem>
                      <LegendItem>
                        <LegendDot $color="#ef4444" />
                        {t('stats.output_cost')}{' '}
                        <LegendValue>
                          {formatCost(stats.outputCost)} ({Math.round(outputCostPct)}%)
                        </LegendValue>
                      </LegendItem>
                    </BarLegend>
                  </StackedBarContainer>
                </Section>
              )}

              {/* ── Model Usage ── */}
              {stats.modelStats.length > 0 && (
                <Section>
                  <SectionTitle>
                    <Bot size={14} />
                    {t('stats.model_usage')}
                  </SectionTitle>
                  <ModelRowHeader>
                    <div>{t('stats.model_name')}</div>
                    <div>{t('stats.distribution')}</div>
                    <div>{t('stats.messages')}</div>
                    <div>{t('stats.total_cost')}</div>
                  </ModelRowHeader>
                  {stats.modelStats.map((m) => (
                    <ModelRow key={m.modelId}>
                      <ModelName title={m.modelName}>{m.modelName}</ModelName>
                      <ModelBar>
                        <ModelBarFill $width={(m.totalTokens / maxModelTokens) * 100} />
                      </ModelBar>
                      <ModelMetric>{m.messageCount}</ModelMetric>
                      <ModelMetric>{formatCost(m.cost)}</ModelMetric>
                    </ModelRow>
                  ))}
                </Section>
              )}

              {/* ── Performance ── */}
              {stats.assistantMessages > 0 && (
                <Section>
                  <SectionTitle>
                    <Gauge size={14} />
                    {t('stats.performance')}
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

              {/* ── Conversation Info ── */}
              <Section>
                <SectionTitle>
                  <FileText size={14} />
                  {t('stats.conversation_info')}
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
                      <User size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                      {t('stats.user_messages')}
                    </InfoLabel>
                    <InfoValue>{stats.userMessages}</InfoValue>
                  </InfoItem>
                  <InfoItem>
                    <InfoLabel>
                      <Bot size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                      {t('stats.assistant_messages')}
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
        </Body>
      </ModalContent>
    </ModalOverlay>
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
