import { useAgentSessionApiRetry } from '@renderer/hooks/agent/useAgentSessionApiRetry'
import type { AgentSessionApiRetryState } from '@shared/ai/agentSessionApiRetry'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BeatLoader } from 'react-spinners'

/** Seconds left in the current backoff, ticking down locally from `startedAt + retryDelayMs`. */
function useRetryRemainingSeconds(retry: AgentSessionApiRetryState): number {
  const active = retry.status === 'retrying'
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [active])

  if (retry.status !== 'retrying') return 0
  const endsAt = Date.parse(retry.startedAt) + retry.retryDelayMs
  return Math.max(0, Math.ceil((endsAt - now) / 1000))
}

const AgentSessionApiRetryStatus = ({ sessionId }: { sessionId: string }) => {
  const { t } = useTranslation()
  const retry = useAgentSessionApiRetry(sessionId)
  const remainingSeconds = useRetryRemainingSeconds(retry)

  if (retry.status !== 'retrying') return null

  const label =
    remainingSeconds > 0
      ? t('agent.session.api_retry.retrying_in', {
          attempt: retry.attempt,
          max: retry.maxRetries,
          seconds: remainingSeconds
        })
      : t('agent.session.api_retry.retrying', { attempt: retry.attempt, max: retry.maxRetries })

  const tooltip = t('agent.session.api_retry.reason', {
    error: retry.errorCategory,
    status: retry.errorStatus ?? '—'
  })

  return (
    <div
      title={tooltip}
      data-testid="agent-session-api-retry"
      className="pointer-events-auto flex select-none items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[13px] text-foreground-muted leading-5 shadow-sm">
      <BeatLoader color="var(--color-foreground-muted)" size={4} speedMultiplier={0.8} />
      <span>{label}</span>
    </div>
  )
}

export default memo(AgentSessionApiRetryStatus)
