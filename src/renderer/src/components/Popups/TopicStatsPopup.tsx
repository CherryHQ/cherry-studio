import { TopView } from '@renderer/components/TopView'
import type { TopicStats } from '@renderer/utils/topicStats'
import { computeTopicStatsFromDB } from '@renderer/utils/topicStats'
import { Modal as AntdModal, Spin } from 'antd'
import { BarChart3, Bot, Cpu, Gauge, Hash, MessageSquare, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
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

// ─── Formatters ─────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
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
  if (tps <= 0) return '—'
  return `${Math.round(tps)} tok/s`
}

function fmtProvider(p: string): string {
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
    gemini: 'Gemini',
    moonshot: 'Moonshot',
    zhipu: 'Zhipu',
    baichuan: 'Baichuan',
    qwen: 'Qwen'
  }
  return map[p] || p
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const C = {
  input: '#6366f1',
  output: '#10b981',
  thinking: '#a855f7',
  card1: '#6366f1',
  card2: '#10b981',
  card3: '#f59e0b'
}
const MODEL_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']

// ─── Styled Components ──────────────────────────────────────────────────────

const Modal = styled(AntdModal)`
  .ant-modal-content {
    border: 0.5px solid var(--color-border);
    border-radius: 12px;
    overflow: hidden;
  }
  .ant-modal-header {
    margin-bottom: 0;
    padding: 16px 20px;
    border-bottom: 0.5px solid var(--color-border);
  }
  .ant-modal-title {
    font-size: 15px;
    font-weight: 600;
  }
  .ant-modal-close { top: 14px; }
  .ant-modal-body {
    padding: 20px;
    max-height: 65vh;
    overflow-y: auto;
  }
`

const Section = styled.div` margin-bottom: 20px; &:last-child { margin-bottom: 0; } `
const SectionHeader = styled.div`
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; color: var(--color-text-secondary, #999);
  text-transform: uppercase; letter-spacing: 0.5px;
  margin-bottom: 10px;
`

const CardRow = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px;
`
const Card = styled.div<{ $accent: string }>`
  background: var(--color-background-soft, rgba(128,128,128,0.04));
  border: 0.5px solid var(--color-border);
  border-radius: 10px; padding: 12px 14px; position: relative; overflow: hidden;
  &::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0;
    height: 3px; background: ${(p) => p.$accent};
  }
`
const CardIcon = styled.div<{ $c: string }>`
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 6px;
  background: ${(p) => `${p.$c}18`}; color: ${(p) => p.$c}; margin-bottom: 8px;
`
const CardValue = styled.div`
  font-size: 17px; font-weight: 700; color: var(--color-text);
  line-height: 1.2; margin-bottom: 1px; font-variant-numeric: tabular-nums;
  white-space: nowrap;
`
const CardLabel = styled.div`
  font-size: 10.5px; color: var(--color-text-secondary, #888);
  text-transform: uppercase; letter-spacing: 0.3px;
`

const BarTrack = styled.div`
  height: 18px; border-radius: 5px; background: var(--color-background-soft);
  overflow: hidden; display: flex; margin-bottom: 6px;
`
const BarSeg = styled.div<{ $w: number; $c: string }>`
  width: ${(p) => p.$w}%; background: ${(p) => p.$c};
  min-width: ${(p) => (p.$w > 0 ? 2 : 0)}px;
`
const Legend = styled.div` display: flex; gap: 14px; flex-wrap: wrap; `
const LegendItem = styled.div`
  display: flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--color-text-secondary, #888);
`
const Dot = styled.div<{ $c: string }>` width: 8px; height: 8px; border-radius: 2px; background: ${(p) => p.$c}; `

// Model bars
const MBox = styled.div`
  background: var(--color-background-soft, rgba(128,128,128,0.04));
  border: 0.5px solid var(--color-border);
  border-radius: 8px; padding: 10px 12px;
`
const MHeader = styled.div` display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 4px; `
const MName = styled.span`
  font-size: 13px; font-weight: 500; color: var(--color-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
`
const MBadge = styled.span`
  font-size: 10px; color: var(--color-text-secondary, #888);
  background: var(--color-background-soft); padding: 1px 6px; border-radius: 3px; flex-shrink: 0; white-space: nowrap;
`
const MTrack = styled.div`
  height: 6px; border-radius: 3px; background: var(--color-background); overflow: hidden; margin-bottom: 4px;
`
const MFill = styled.div<{ $w: number; $c: string }>`
  height: 100%; width: ${(p) => p.$w}%; background: ${(p) => p.$c}; border-radius: 3px;
`
const MMetrics = styled.div`
  display: flex; gap: 12px; flex-wrap: wrap;
  font-size: 11px; color: var(--color-text-secondary, #888); font-variant-numeric: tabular-nums;
`

const PerfGrid = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
`
const PerfCard = styled.div`
  background: var(--color-background-soft); border: 0.5px solid var(--color-border);
  border-radius: 8px; padding: 10px; text-align: center;
`
const PerfVal = styled.div`
  font-size: 17px; font-weight: 700; color: var(--color-text); margin-bottom: 2px;
  font-variant-numeric: tabular-nums; white-space: nowrap;
`
const PerfLbl = styled.div` font-size: 10.5px; color: var(--color-text-secondary, #888); `

const InfoGrid = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
`
const InfoLabel = styled.div` font-size: 10.5px; color: var(--color-text-secondary, #888); margin-bottom: 2px; `
const InfoVal = styled.div` font-size: 13px; font-weight: 500; color: var(--color-text); white-space: nowrap; font-variant-numeric: tabular-nums; `

const Empty = styled.div`
  text-align: center; padding: 32px 16px; color: var(--color-text-secondary, #888); font-size: 14px;
`

// ─── Topic Stats Panel ──────────────────────────────────────────────────────

const TopicStatsPanel: React.FC<Props> = ({ topicId, topicName, resolve }) => {
  const [open, setOpen] = useState(true)
  const [stats, setStats] = useState<TopicStats | null>(null)
  const { t } = useTranslation()

  useEffect(() => {
    let cancelled = false
    computeTopicStatsFromDB(topicId).then((r) => {
      if (!cancelled) setStats(r)
    })
    return () => {
      cancelled = true
    }
  }, [topicId])

  const handleClose = () => {
    setOpen(false)
  }

  const handleAfterClose = () => {
    resolve()
  }

  const renderContent = () => {
    if (!stats) {
      return (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      )
    }

    if (stats.totalMessages === 0) {
      return <Empty>{t('stats.no_data')}</Empty>
    }

    const maxT = stats.modelStats.length > 0 ? stats.modelStats[0].totalTokens : 1

    return (
      <>
        {/* ── Overview Cards (3 cards, no cost) ── */}
        <CardRow>
          <Card $accent={C.card1}>
            <CardIcon $c={C.card1}>
              <MessageSquare size={13} />
            </CardIcon>
            <CardValue>{stats.totalMessages.toLocaleString()}</CardValue>
            <CardLabel>{t('stats.messages')}</CardLabel>
          </Card>
          <Card $accent={C.card2}>
            <CardIcon $c={C.card2}>
              <Cpu size={13} />
            </CardIcon>
            <CardValue>{fmtTokens(stats.totalTokens)}</CardValue>
            <CardLabel>{t('stats.total_tokens')}</CardLabel>
          </Card>
          <Card $accent={C.card3}>
            <CardIcon $c={C.card3}>
              <Zap size={13} />
            </CardIcon>
            <CardValue>{fmtLatency(stats.avgFirstTokenLatency)}</CardValue>
            <CardLabel>{t('stats.avg_first_token')}</CardLabel>
          </Card>
        </CardRow>

        {/* ── Token Breakdown ── */}
        {stats.totalTokens > 0 && (
          <Section>
            <SectionHeader>
              <Cpu size={12} /> {t('stats.token_breakdown')}
            </SectionHeader>
            <BarTrack>
              <BarSeg $w={(stats.totalInputTokens / stats.totalTokens) * 100} $c={C.input} />
              <BarSeg $w={(stats.totalOutputTokens / stats.totalTokens) * 100} $c={C.output} />
              {stats.totalThinkingTokens > 0 && (
                <BarSeg $w={(stats.totalThinkingTokens / stats.totalTokens) * 100} $c={C.thinking} />
              )}
            </BarTrack>
            <Legend>
              <LegendItem>
                <Dot $c={C.input} />
                {t('stats.input_tokens')}{' '}
                <b style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalInputTokens)}</b>
              </LegendItem>
              <LegendItem>
                <Dot $c={C.output} />
                {t('stats.output_tokens')}{' '}
                <b style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalOutputTokens)}</b>
              </LegendItem>
              {stats.totalThinkingTokens > 0 && (
                <LegendItem>
                  <Dot $c={C.thinking} />
                  {t('stats.thinking_tokens')}{' '}
                  <b style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalThinkingTokens)}</b>
                </LegendItem>
              )}
            </Legend>
          </Section>
        )}

        {/* ── Model Usage ── */}
        {stats.modelStats.length > 0 && (
          <Section>
            <SectionHeader>
              <Bot size={12} /> {t('stats.model_usage')}
            </SectionHeader>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.modelStats.map((m, i) => (
                <MBox key={m.modelId}>
                  <MHeader>
                    <MName title={m.modelName}>{m.modelName}</MName>
                    <MBadge>{fmtProvider(m.provider)}</MBadge>
                  </MHeader>
                  <MTrack>
                    <MFill
                      $w={maxT > 0 ? (m.totalTokens / maxT) * 100 : 0}
                      $c={MODEL_COLORS[i % MODEL_COLORS.length]}
                    />
                  </MTrack>
                  <MMetrics>
                    <span>{m.messageCount} msgs</span>
                    <span>{fmtTokens(m.totalTokens)} tok</span>
                    {m.avgTokensPerSecond > 0 && <span>⚡ {fmtSpeed(m.avgTokensPerSecond)}</span>}
                    {m.avgFirstTokenLatency > 0 && <span>⏱ {fmtLatency(m.avgFirstTokenLatency)}</span>}
                  </MMetrics>
                </MBox>
              ))}
            </div>
          </Section>
        )}

        {/* ── Performance ── */}
        {stats.assistantMessages > 0 && (
          <Section>
            <SectionHeader>
              <Gauge size={12} /> {t('stats.performance')}
            </SectionHeader>
            <PerfGrid>
              <PerfCard>
                <PerfVal>{fmtLatency(stats.avgFirstTokenLatency)}</PerfVal>
                <PerfLbl>{t('stats.avg_first_token')}</PerfLbl>
              </PerfCard>
              <PerfCard>
                <PerfVal>{fmtDuration(stats.avgCompletionTime)}</PerfVal>
                <PerfLbl>{t('stats.avg_completion')}</PerfLbl>
              </PerfCard>
              <PerfCard>
                <PerfVal>{fmtSpeed(stats.avgTokensPerSecond)}</PerfVal>
                <PerfLbl>{t('stats.avg_speed')}</PerfLbl>
              </PerfCard>
            </PerfGrid>
          </Section>
        )}

        {/* ── Conversation Info ── */}
        <Section>
          <SectionHeader>
            <Hash size={12} /> {t('stats.conversation_info')}
          </SectionHeader>
          <InfoGrid>
            <div>
              <InfoLabel>{t('stats.created_at')}</InfoLabel>
              <InfoVal>{stats.firstMessageAt ? new Date(stats.firstMessageAt).toLocaleString() : '—'}</InfoVal>
            </div>
            <div>
              <InfoLabel>{t('stats.duration')}</InfoLabel>
              <InfoVal>{fmtDuration(stats.durationMs)}</InfoVal>
            </div>
            <div>
              <InfoLabel>{t('stats.user_messages')}</InfoLabel>
              <InfoVal>{stats.userMessages.toLocaleString()}</InfoVal>
            </div>
            <div>
              <InfoLabel>{t('stats.assistant_messages')}</InfoLabel>
              <InfoVal>{stats.assistantMessages.toLocaleString()}</InfoVal>
            </div>
            <div>
              <InfoLabel>{t('stats.total_characters')}</InfoLabel>
              <InfoVal>{stats.totalCharacters.toLocaleString()}</InfoVal>
            </div>
            <div>
              <InfoLabel>{t('stats.total_words')}</InfoLabel>
              <InfoVal>{stats.totalWords.toLocaleString()}</InfoVal>
            </div>
          </InfoGrid>
        </Section>
      </>
    )
  }

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      afterClose={handleAfterClose}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BarChart3 size={17} />
          {t('stats.title', { topic: topicName })}
        </span>
      }
      footer={null}
      width={600}
      centered
      destroyOnClose>
      {renderContent()}
    </Modal>
  )
}

// ─── TopView API ────────────────────────────────────────────────────────────

const KEY = 'TopicStatsPopup'

const TopicStatsPopup = {
  hide() {
    TopView.hide(KEY)
  },
  show(props: ShowParams): Promise<void> {
    return new Promise<void>((resolve) => {
      TopView.show(
        <TopicStatsPanel
          {...props}
          resolve={() => {
            resolve()
            TopView.hide(KEY)
          }}
        />,
        KEY
      )
    })
  }
}

export default TopicStatsPopup
