import { TopView } from '@renderer/components/TopView'
import type { TopicStats } from '@renderer/utils/topicStats'
import { computeTopicStatsFromDB } from '@renderer/utils/topicStats'
import { Modal as AntdModal, Spin } from 'antd'
import { BarChart3, Bot, Cpu, FileText, Gauge, Hash, MessageSquare, Type, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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
// ─── Colors ─────────────────────────────────────────────────────────────────

const CC = { input: '#6366f1', output: '#10b981', thinking: '#a855f7' }
const MC = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']

// ─── Styled ─────────────────────────────────────────────────────────────────

const Modal = styled(AntdModal)`
  .ant-modal-body { max-height: 60vh; overflow-y: auto; }
`
const Row = styled.div` display: flex; justify-content: space-between; align-items: center; min-height: 26px; padding: 2px 0; `
const RL = styled.span` font-size: 13px; color: var(--color-text-1); display: flex; align-items: center; gap: 6px; `
const RV = styled.span` font-size: 13px; font-weight: 600; color: var(--color-text); white-space: nowrap; font-variant-numeric: tabular-nums; `
const RVs = styled.span` font-size: 12px; color: var(--color-text-secondary, #888); font-weight: 400; white-space: nowrap; `

const SDiv = styled.div` margin: 14px 0 10px; height: 0.5px; background: var(--color-border); `
const SHdr = styled.div` font-size: 11px; font-weight: 600; color: var(--color-text-secondary, #999); text-transform: uppercase; letter-spacing: 0.4px; display: flex; align-items: center; gap: 6px; margin-bottom: 8px; `

const BTrack = styled.div` height: 14px; border-radius: 4px; background: var(--color-background-soft); overflow: hidden; display: flex; margin-bottom: 6px; `
const BSeg = styled.div<{
  $w: number
  $c: string
}>` width: ${(p) => p.$w}%; background: ${(p) => p.$c}; min-width: ${(p) => (p.$w > 0 ? 2 : 0)}px; `
const Leg = styled.span` font-size: 12px; color: var(--color-text-secondary, #888); display: inline-flex; align-items: center; gap: 4px; margin-right: 10px; `
const Dot = styled.span<{
  $c: string
}>` width: 8px; height: 8px; border-radius: 2px; background: ${(p) => p.$c}; display: inline-block; flex-shrink: 0; `

// Model cards — compact inline
const MBox = styled.div` background: var(--color-background-soft); border: 0.5px solid var(--color-border); border-radius: 8px; padding: 8px 12px; `
const MTop = styled.div` display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 2px; `
const MName = styled.span` font-size: 13px; font-weight: 500; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; `
const MBadge = styled.span` font-size: 10px; color: var(--color-text-secondary, #888); background: var(--color-background-soft); padding: 1px 6px; border-radius: 3px; flex-shrink: 0; white-space: nowrap; `
const MTrack = styled.div` height: 5px; border-radius: 3px; background: var(--color-background); overflow: hidden; margin-bottom: 3px; `
const MFill = styled.div<{
  $w: number
  $c: string
}>` height: 100%; width: ${(p) => p.$w}%; background: ${(p) => p.$c}; border-radius: 3px; `
const MMeta = styled.div` display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px; color: var(--color-text-secondary, #888); font-variant-numeric: tabular-nums; `

// ─── Panel ──────────────────────────────────────────────────────────────────

const TopicStatsPanel: React.FC<Props> = ({ topicId, topicName, resolve }) => {
  const [open, setOpen] = useState(true)
  const [stats, setStats] = useState<TopicStats | null>(null)
  const { t } = useTranslation()

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
    const createdDate = stats.firstMessageAt ? new Date(stats.firstMessageAt).toLocaleDateString() : '—'

    return (
      <>
        {/* Conversation Info — clean rows */}
        <SHdr>
          <Hash size={12} />
          {t('stats.conversation_info')}
        </SHdr>
        <Row>
          <RL>
            <MessageSquare size={12} />
            {t('stats.messages')}
          </RL>
          <span>
            <RV>{stats.totalMessages.toLocaleString()}</RV>
            <RVs style={{ marginLeft: 4 }}>
              (用户 {stats.userMessages.toLocaleString()} / 助手 {stats.assistantMessages.toLocaleString()})
            </RVs>
          </span>
        </Row>
        <Row>
          <RL>
            <Cpu size={12} />
            {t('stats.total_tokens')}
          </RL>
          <RV>{fmtTokens(stats.totalTokens)}</RV>
        </Row>
        <Row>
          <RL>
            <Zap size={12} />
            {t('stats.avg_first_token')}
          </RL>
          <RV>{fmtLatency(stats.avgFirstTokenLatency)}</RV>
        </Row>
        <Row>
          <RL>
            <Type size={12} />
            {t('stats.total_characters')}
          </RL>
          <RV>{stats.totalCharacters.toLocaleString()}</RV>
        </Row>
        <Row>
          <RL>
            <FileText size={12} />
            {t('stats.total_words')}
          </RL>
          <RV>{stats.totalWords.toLocaleString()}</RV>
        </Row>
        <Row>
          <RL>{t('stats.created_at')}</RL>
          <RV>{createdDate}</RV>
        </Row>

        {/* Token Breakdown */}
        {stats.totalTokens > 0 && (
          <>
            <SDiv />
            <SHdr>
              <Cpu size={12} />
              {t('stats.token_breakdown')}
            </SHdr>
            <BTrack>
              <BSeg $w={(stats.totalInputTokens / stats.totalTokens) * 100} $c={CC.input} />
              <BSeg $w={(stats.totalOutputTokens / stats.totalTokens) * 100} $c={CC.output} />
              {stats.totalThinkingTokens > 0 && (
                <BSeg $w={(stats.totalThinkingTokens / stats.totalTokens) * 100} $c={CC.thinking} />
              )}
            </BTrack>
            <div>
              <Leg>
                <Dot $c={CC.input} />
                {t('stats.input_tokens')}{' '}
                <strong style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalInputTokens)}</strong>
              </Leg>
              <Leg>
                <Dot $c={CC.output} />
                {t('stats.output_tokens')}{' '}
                <strong style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalOutputTokens)}</strong>
              </Leg>
              {stats.totalThinkingTokens > 0 && (
                <Leg>
                  <Dot $c={CC.thinking} />
                  {t('stats.thinking_tokens')}{' '}
                  <strong style={{ color: 'var(--color-text)' }}>{fmtTokens(stats.totalThinkingTokens)}</strong>
                </Leg>
              )}
            </div>
          </>
        )}

        {/* Performance */}
        {stats.assistantMessages > 0 && (
          <>
            <SDiv />
            <SHdr>
              <Gauge size={12} />
              {t('stats.performance')}
            </SHdr>
            <Row>
              <RL>{t('stats.avg_first_token')}</RL>
              <RV>{fmtLatency(stats.avgFirstTokenLatency)}</RV>
            </Row>
            <Row>
              <RL>{t('stats.avg_completion')}</RL>
              <RV>{fmtLatency(stats.avgCompletionTime)}</RV>
            </Row>
            <Row>
              <RL>{t('stats.avg_speed')}</RL>
              <RV>{fmtSpeed(stats.avgTokensPerSecond)}</RV>
            </Row>
          </>
        )}

        {/* Model Usage */}
        {stats.modelStats.length > 0 && (
          <>
            <SDiv />
            <SHdr>
              <Bot size={12} />
              {t('stats.model_usage')}
            </SHdr>
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
      width={560}
      centered
      transitionName="animation-move-down"
      destroyOnClose>
      {body()}
    </Modal>
  )
}

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
