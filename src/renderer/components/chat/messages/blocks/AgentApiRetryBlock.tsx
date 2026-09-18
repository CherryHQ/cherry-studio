import { useTranslation } from 'react-i18next'

import type { AgentApiRetryPartData } from '@shared/data/types/uiParts'

/** Durable summary of the latest provider backoff in this agent turn. */
export default function AgentApiRetryBlock({ data }: { data: AgentApiRetryPartData }) {
  const { t } = useTranslation()
  return (
    <div
      className="my-1 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm font-medium text-foreground"
      title={`${data.errorCategory} · HTTP ${data.errorStatus ?? '—'} · ${data.startedAt}`}>
      {t('agent.session.api_retry.history', {
        attempt: data.attempt,
        max: data.maxRetries,
        status: data.errorStatus ?? '—'
      })}
    </div>
  )
}
