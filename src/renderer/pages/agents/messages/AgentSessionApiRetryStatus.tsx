import { memo, type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BeatLoader } from 'react-spinners'

import { useAgentSessionApiRetry } from '@renderer/hooks/agent/useAgentSessionApiRetry'
import type { AgentSessionApiRetryState } from '@shared/ai/agentSessionApiRetry'

// SDK retry categories that map onto an existing diagnosis; others fall back to the generic reason.
const RETRY_CATEGORY_DIAGNOSIS: Record<string, string> = {
  rate_limit: 'error.diagnosis.rate_limit',
  overloaded: 'error.diagnosis.server',
  server_error: 'error.diagnosis.server'
}

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

const AgentSessionApiRetryStatus = ({ sessionId, fallback = null }: { sessionId: string; fallback?: ReactNode }) => {
  const { t } = useTranslation()
  const retry = useAgentSessionApiRetry(sessionId)
  const remainingSeconds = useRetryRemainingSeconds(retry)

  // Not retrying → yield to the default processing placeholder passed by the renderer.
  if (retry.status !== 'retrying') return <>{fallback}</>

  const label =
    remainingSeconds > 0
      ? t('agent.session.api_retry.retrying_in', {
          attempt: retry.attempt,
          max: retry.maxRetries,
          seconds: remainingSeconds
        })
      : t('agent.session.api_retry.retrying', { attempt: retry.attempt, max: retry.maxRetries })

  const diagnosisKey = RETRY_CATEGORY_DIAGNOSIS[retry.errorCategory]
  const tooltip =
    [
      diagnosisKey && t(diagnosisKey),
      retry.errorStatus !== null && t('agent.session.api_retry.reason', { status: retry.errorStatus })
    ]
      .filter(Boolean)
      .join(' · ') || t('error.diagnosis.unknown')

  return (
    <div
      title={tooltip}
      data-testid="agent-session-api-retry"
      className="flex min-h-7 flex-row items-center gap-1.5 py-0.5 text-[13px] leading-5 text-foreground-tertiary select-none">
      <span>{label}</span>
      <BeatLoader color="currentColor" size={4} speedMultiplier={0.8} />
    </div>
  )
}

export default memo(AgentSessionApiRetryStatus)
