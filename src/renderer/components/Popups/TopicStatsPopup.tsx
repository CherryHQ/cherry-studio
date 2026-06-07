import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { TopView } from '@renderer/components/TopView'
import { loadTopicStats, type ResolvedModelUsage } from '@renderer/utils/topicStatsLoader'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('Popups:TopicStatsPopup')
const CLOSE_ANIMATION_MS = 200

interface ShowParams {
  topicId: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

interface TopicStatsData {
  topicId: string
  topicName: string
  stats: {
    messageCount: number
    userMessageCount: number
    assistantMessageCount: number
    totalTokens: number
    inputTokens: number
    outputTokens: number
    thinkingTokens: number
    totalCharacters: number
    totalWords: number
    durationMs: number
    createdAt: string
    firstMessageAt: string | null
    lastMessageAt: string | null
    performance: {
      avgFirstTokenMs: number | null
      avgCompletionMs: number | null
      avgTokensPerSecond: number | null
      measuredMessages: number
    }
  }
  modelUsage: ResolvedModelUsage[]
  dailyUsage: { date: string; messageCount: number; totalTokens: number }[]
}

const PopupContainer: React.FC<Props> = ({ topicId, resolve }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [data, setData] = useState<TopicStatsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadTopicStats(topicId)
      .then((result) => {
        if (cancelled) return
        if (!result) {
          setError(t('stats.popup.topic_not_found'))
          return
        }
        setData(result as TopicStatsData)
      })
      .catch((e) => {
        logger.error('Failed to load topic stats', e as Error)
        if (!cancelled) setError(t('stats.popup.load_failed'))
      })
    return () => {
      cancelled = true
    }
  }, [topicId, t])

  const closePopup = () => {
    setOpen(false)
    window.setTimeout(() => resolve({}), CLOSE_ANIMATION_MS)
  }

  TopicStatsPopup.hide = closePopup

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closePopup()
      }}>
      <DialogContent className="max-h-[85vh] sm:max-w-[640px]">
        <DialogHeader className="pr-8">
          <DialogTitle>{t('stats.popup.title')}</DialogTitle>
          {data && <p className="text-(--color-foreground-muted) text-xs">{data.topicName}</p>}
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-2">
          {error && <div className="text-(--color-foreground-muted) text-sm">{error}</div>}
          {!error && !data && <div className="text-(--color-foreground-muted) text-sm">{t('stats.loading')}</div>}
          {data && <Body data={data} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const Body: React.FC<{ data: TopicStatsData }> = ({ data }) => {
  const { t } = useTranslation()
  const { stats } = data

  return (
    <div className="space-y-5 py-2 text-sm">
      {/* Conversation Info */}
      <Section title={t('stats.conversation_info')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatBox
            label={t('stats.total_messages')}
            value={String(stats.messageCount)}
            sub={`${stats.userMessageCount} / ${stats.assistantMessageCount}`}
          />
          <StatBox label={t('stats.total_tokens')} value={stats.totalTokens.toLocaleString()} />
          <StatBox label={t('stats.total_characters')} value={stats.totalCharacters.toLocaleString()} />
          <StatBox label={t('stats.total_words')} value={stats.totalWords.toLocaleString()} />
          {stats.durationMs > 0 && <StatBox label={t('stats.duration')} value={formatDuration(stats.durationMs)} />}
        </div>
      </Section>

      {/* Token Breakdown */}
      <Section title={t('stats.token_breakdown')}>
        <TokenBar
          input={stats.inputTokens}
          output={stats.outputTokens}
          thinking={stats.thinkingTokens}
          total={stats.totalTokens}
        />
      </Section>

      {/* Performance */}
      <Section title={t('stats.performance')}>
        <div className="grid grid-cols-3 gap-2">
          <StatBox label={t('stats.avg_first_token')} value={formatMs(stats.performance.avgFirstTokenMs)} />
          <StatBox label={t('stats.avg_completion')} value={formatMs(stats.performance.avgCompletionMs)} />
          <StatBox
            label={t('stats.avg_speed')}
            value={
              stats.performance.avgTokensPerSecond != null
                ? `${stats.performance.avgTokensPerSecond.toFixed(1)} tok/s`
                : '—'
            }
          />
        </div>
      </Section>

      {/* Model Usage */}
      {data.modelUsage.length > 0 && (
        <Section title={t('stats.model_usage')}>
          <div className="space-y-2">
            {data.modelUsage.map((u) => (
              <div
                key={`${u.modelId}-${u.provider}`}
                className="rounded-md border border-border/60 bg-(--color-background) p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-(--color-foreground) text-xs">{u.modelName}</div>
                    <div className="truncate text-(--color-foreground-muted) text-xs">{u.providerName}</div>
                  </div>
                  <div className="text-right text-(--color-foreground) text-xs tabular-nums">
                    {u.totalTokens.toLocaleString()} <span className="text-(--color-foreground-muted)">tok</span>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 text-(--color-foreground-muted) text-xs">
                  <span>
                    {t('stats.messages')}: {u.messageCount}
                  </span>
                  {u.performance.avgFirstTokenMs != null && (
                    <span>TTFT {Math.round(u.performance.avgFirstTokenMs)}ms</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div className="mb-1.5 font-semibold text-(--color-foreground) text-xs uppercase tracking-wide">{title}</div>
    {children}
  </div>
)

const StatBox: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="rounded-md border border-border/60 bg-(--color-background) px-2.5 py-2">
    <div className="text-(--color-foreground-muted) text-xs">{label}</div>
    <div className="mt-0.5 font-semibold text-(--color-foreground) tabular-nums">{value}</div>
    {sub && <div className="text-(--color-foreground-muted) text-xs">{sub}</div>}
  </div>
)

const TokenBar: React.FC<{ input: number; output: number; thinking: number; total: number }> = ({
  input,
  output,
  thinking,
  total
}) => {
  if (total === 0) return <div className="text-(--color-foreground-muted) text-xs">—</div>
  const i = (input / total) * 100
  const o = (output / total) * 100
  const th = (thinking / total) * 100
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-(--color-background-soft)">
        {i > 0 && <div className="bg-[#6366f1]" style={{ width: `${i}%` }} title={`Input ${input}`} />}
        {o > 0 && <div className="bg-[#10b981]" style={{ width: `${o}%` }} title={`Output ${output}`} />}
        {th > 0 && <div className="bg-[#a855f7]" style={{ width: `${th}%` }} title={`Thinking ${thinking}`} />}
      </div>
      <div className="flex flex-wrap gap-x-3 text-(--color-foreground-muted) text-xs">
        <span>
          <span className="mr-1 inline-block size-2 rounded-full bg-[#6366f1]" />
          Input {input.toLocaleString()}
        </span>
        <span>
          <span className="mr-1 inline-block size-2 rounded-full bg-[#10b981]" />
          Output {output.toLocaleString()}
        </span>
        {thinking > 0 && (
          <span>
            <span className="mr-1 inline-block size-2 rounded-full bg-[#a855f7]" />
            Thinking {thinking.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  )
}

const formatMs = (ms: number | null): string => {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const formatDuration = (ms: number): string => {
  if (ms <= 0) return '—'
  const totalMin = Math.floor(ms / 60_000)
  const d = Math.floor(totalMin / (60 * 24))
  const h = Math.floor((totalMin - d * 60 * 24) / 60)
  const m = totalMin - d * 60 * 24 - h * 60
  return `${d}d ${h}h ${m}m`
}

const TopViewKey = 'TopicStatsPopup'

export default class TopicStatsPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
