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
    qwen: 'Qwen'
  }
  return m[p] || p
}
function useFmtDuration() {
  const { t } = useTranslation()
  return (ms: number): string => {
    if (ms <= 0) return '—'
    if (ms < 1000) return `${ms}ms`
    let r = Math.floor(ms / 1000)
    const p: string[] = []
    const d = Math.floor(r / 86400)
    if (d > 0) {
      p.push(`${d}${t('stats.duration_d')}`)
      r %= 86400
    }
    const h = Math.floor(r / 3600)
    if (h > 0) {
      p.push(`${h}${t('stats.duration_h')}`)
      r %= 3600
    }
    const m = Math.floor(r / 60)
    if (m > 0) {
      p.push(`${m}${t('stats.duration_m')}`)
      r %= 60
    }
    if (r > 0 || p.length === 0) p.push(`${r}${t('stats.duration_s')}`)
    return p.join(' ')
  }
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const CC = { input: '#6366f1', output: '#10b981', thinking: '#a855f7' }
const MC = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']

// ─── Styled — clean Ant Design-native look ──────────────────────────────────

const Modal = styled(AntdModal)`
  .ant-modal-content { border: 0.5px solid var(--color-border); border-radius: 10px; overflow: hidden; }
  .ant-modal-header { margin-bottom: 0; padding: 14px 20px; border-bottom: 0.5px solid var(--color-border); }
  .ant-modal-title { font-size: 15px; font-weight: 600; }
  .ant-modal-close { top: 13px; }
  .ant-modal-body { padding: 20px 20px 16px; max-height: 62vh; overflow-y: auto; }
`

// Section divider
const SDiv = styled.div`
  margin: 16px 0 14px;
  font-size: 11px; font-weight: 600; color: var(--color-text-secondary, #999);
  text-transform: uppercase; letter-spacing: 0.4px;
  display: flex; align-items: center; gap: 6px;
`

// Overview cards — simple 3-col grid
const CardRow = styled.div` display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 8px; `
const Card = styled.div`
  background: var(--color-background-soft); border: 0.5px solid var(--color-border);
  border-radius: 8px; padding: 12px 14px;
`
const CardIcon = styled.div<{ $c: string }>`
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 5px;
  background: ${(p) => `${p.$c}18`}; color: ${(p) => p.$c}; margin-bottom: 8px;
`
const CardValue = styled.div` font-size: 18px; font-weight: 700; color: var(--color-text); white-space: nowrap; font-variant-numeric: tabular-nums; `
const CardLabel = styled.div` font-size: 10.5px; color: var(--color-text-secondary, #888); margin-top: 2px; `

// Token bar
const BTrack = styled.div` height: 16px; border-radius: 4px; background: var(--color-background-soft); overflow: hidden; display: flex; margin-bottom: 8px; `
const BSeg = styled.div<{
  $w: number
  $c: string
}>` width: ${(p) => p.$w}%; background: ${(p) => p.$c}; min-width: ${(p) => (p.$w > 0 ? 2 : 0)}px; `
const Legend = styled.div` display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--color-text-secondary, #888); `
const Dot = styled.div<{
  $c: string
}>` width: 8px; height: 8px; border-radius: 2px; background: ${(p) => p.$c}; flex-shrink: 0; `

// Model cards — compact
const MBox = styled.div`
  background: var(--color-background-soft); border: 0.5px solid var(--color-border);
  border-radius: 8px; padding: 10px 12px;
`
const MTop = styled.div` display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 3px; `
const MName = styled.span` font-size: 13px; font-weight: 500; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; `
const MBadge = styled.span` font-size: 10px; color: var(--color-text-secondary, #888); background: var(--color-background-soft); padding: 1px 6px; border-radius: 3px; flex-shrink: 0; white-space: nowrap; `
const MTrack = styled.div` height: 5px; border-radius: 3px; background: var(--color-background); overflow: hidden; margin-bottom: 4px; `
const MFill = styled.div<{
  $w: number
  $c: string
}>` height: 100%; width: ${(p) => p.$w}%; background: ${(p) => p.$c}; border-radius: 3px; `
const MMeta = styled.div` display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px; color: var(--color-text-secondary, #888); font-variant-numeric: tabular-nums; `

// Info grid — 3 columns
const InfoGrid = styled.div` display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; `
const ILbl = styled.div` font-size: 10.5px; color: var(--color-text-secondary, #888); margin-bottom: 2px; `
const IVal = styled.div` font-size: 13px; font-weight: 500; color: var(--color-text); white-space: nowrap; font-variant-numeric: tabular-nums; `

// ─── Panel ──────────────────────────────────────────────────────────────────

const TopicStatsPanel: React.FC<Props> = ({ topicId, topicName, resolve }) => {
  const [open, setOpen] = useState(true)
  const [stats, setStats] = useState<TopicStats | null>(null)
  const { t } = useTranslation()
  const fmtDuration = useFmtDuration()

  useEffect(() => {
    let c = false
    void computeTopicStatsFromDB(topicId).then((r) => {
      if (!c) setStats(r)
    })
    return () => {
      c = true
    }
  }, [topicId])

  const close = () => setOpen(false)
  const afterClose = () => resolve()

  const body = () => {
    if (!stats)
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      )
    if (stats.totalMessages === 0)
      return (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-secondary, #888)', fontSize: 14 }}>
          {t('stats.no_data')}
        </div>
      )

    const maxT = stats.modelStats[0]?.totalTokens || 1

    return (
      <>
        {/* Overview Cards */}
        <CardRow>
          <Card>
            <CardIcon $c="#6366f1">
              <MessageSquare size={12} />
            </CardIcon>
            <CardValue>{stats.totalMessages.toLocaleString()}</CardValue>
            <CardLabel>{t('stats.messages')}</CardLabel>
          </Card>
          <Card>
            <CardIcon $c="#10b981">
              <Cpu size={12} />
            </CardIcon>
            <CardValue>{fmtTokens(stats.totalTokens)}</CardValue>
            <CardLabel>{t('stats.total_tokens')}</CardLabel>
          </Card>
          <Card>
            <CardIcon $c="#f59e0b">
              <Zap size={12} />
            </CardIcon>
            <CardValue>{fmtLatency(stats.avgFirstTokenLatency)}</CardValue>
            <CardLabel>{t('stats.avg_first_token')}</CardLabel>
          </Card>
        </CardRow>

        {/* Token Breakdown */}
        {stats.totalTokens > 0 && (
          <>
            <SDiv>
              <Cpu size={12} />
              {t('stats.token_breakdown')}
            </SDiv>
            <BTrack>
              <BSeg $w={(stats.totalInputTokens / stats.totalTokens) * 100} $c={CC.input} />
              <BSeg $w={(stats.totalOutputTokens / stats.totalTokens) * 100} $c={CC.output} />
              {stats.totalThinkingTokens > 0 && (
                <BSeg $w={(stats.totalThinkingTokens / stats.totalTokens) * 100} $c={CC.thinking} />
              )}
            </BTrack>
            <Legend>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Dot $c={CC.input} />
                {t('stats.input_tokens')}{' '}
                <b style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalInputTokens)}</b>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Dot $c={CC.output} />
                {t('stats.output_tokens')}{' '}
                <b style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalOutputTokens)}</b>
              </span>
              {stats.totalThinkingTokens > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Dot $c={CC.thinking} />
                  {t('stats.thinking_tokens')}{' '}
                  <b style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalThinkingTokens)}</b>
                </span>
              )}
            </Legend>
          </>
        )}

        {/* Performance — compact, right after tokens */}
        {stats.assistantMessages > 0 && (
          <>
            <SDiv>
              <Gauge size={12} />
              {t('stats.performance')}
            </SDiv>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div
                style={{
                  background: 'var(--color-background-soft)',
                  border: '0.5px solid var(--color-border)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  textAlign: 'center'
                }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
                  {fmtLatency(stats.avgFirstTokenLatency)}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--color-text-secondary, #888)' }}>
                  {t('stats.avg_first_token')}
                </div>
              </div>
              <div
                style={{
                  background: 'var(--color-background-soft)',
                  border: '0.5px solid var(--color-border)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  textAlign: 'center'
                }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
                  {fmtDuration(stats.avgCompletionTime)}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--color-text-secondary, #888)' }}>
                  {t('stats.avg_completion')}
                </div>
              </div>
              <div
                style={{
                  background: 'var(--color-background-soft)',
                  border: '0.5px solid var(--color-border)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  textAlign: 'center'
                }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
                  {fmtSpeed(stats.avgTokensPerSecond)}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--color-text-secondary, #888)' }}>
                  {t('stats.avg_speed')}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Model Usage — compact list */}
        {stats.modelStats.length > 0 && (
          <>
            <SDiv>
              <Bot size={12} />
              {t('stats.model_usage')}
            </SDiv>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.modelStats.map((m, i) => (
                <MBox key={m.modelId}>
                  <MTop>
                    <MName title={m.modelName}>{m.modelName}</MName>
                    <MBadge>{fmtProvider(m.provider)}</MBadge>
                  </MTop>
                  <MTrack>
                    <MFill $w={maxT > 0 ? (m.totalTokens / maxT) * 100 : 0} $c={MC[i % MC.length]} />
                  </MTrack>
                  <MMeta>
                    <span>{m.messageCount} msgs</span>
                    <span>{fmtTokens(m.totalTokens)} tok</span>
                    {m.avgTokensPerSecond > 0 && <span>⚡ {fmtSpeed(m.avgTokensPerSecond)}</span>}
                    {m.avgFirstTokenLatency > 0 && <span>⏱ {fmtLatency(m.avgFirstTokenLatency)}</span>}
                  </MMeta>
                </MBox>
              ))}
            </div>
          </>
        )}

        {/* Conversation Info */}
        <SDiv>
          <Hash size={12} />
          {t('stats.conversation_info')}
        </SDiv>
        <InfoGrid>
          <div>
            <ILbl>{t('stats.created_at')}</ILbl>
            <IVal>{stats.firstMessageAt ? new Date(stats.firstMessageAt).toLocaleString() : '—'}</IVal>
          </div>
          <div>
            <ILbl>{t('stats.duration')}</ILbl>
            <IVal>{fmtDuration(stats.durationMs)}</IVal>
          </div>
          <div>
            <ILbl>{t('stats.user_messages')}</ILbl>
            <IVal>{stats.userMessages.toLocaleString()}</IVal>
          </div>
          <div>
            <ILbl>{t('stats.assistant_messages')}</ILbl>
            <IVal>{stats.assistantMessages.toLocaleString()}</IVal>
          </div>
          <div>
            <ILbl>{t('stats.total_characters')}</ILbl>
            <IVal>{stats.totalCharacters.toLocaleString()}</IVal>
          </div>
          <div>
            <ILbl>{t('stats.total_words')}</ILbl>
            <IVal>{stats.totalWords.toLocaleString()}</IVal>
          </div>
        </InfoGrid>
      </>
    )
  }

  return (
    <Modal
      open={open}
      onCancel={close}
      afterClose={afterClose}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BarChart3 size={16} />
          {t('stats.title', { topic: topicName })}
        </span>
      }
      footer={null}
      width={580}
      centered
      destroyOnClose>
      {body()}
    </Modal>
  )
}

// ─── API ────────────────────────────────────────────────────────────────────

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
