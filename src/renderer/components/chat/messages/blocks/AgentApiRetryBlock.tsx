import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentApiRetryPartData } from '@shared/data/types/uiParts'

/** Durable summary of the latest provider backoff in this agent turn. */
export default function AgentApiRetryBlock({ data }: { data: AgentApiRetryPartData }) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const startedAt = useMemo(
    () =>
      new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.startedAt)),
    [language, data.startedAt]
  )

  return (
    <div
      className="my-1 rounded-md border border-warning-border bg-warning-subtle px-3 py-2 text-sm font-medium text-foreground"
      title={t('agent.session.api_retry.history_detail', {
        error: data.errorCategory,
        status: data.errorStatus ?? '—',
        time: startedAt
      })}>
      {t('agent.session.api_retry.history', {
        attempt: data.attempt,
        max: data.maxRetries,
        status: data.errorStatus ?? '—'
      })}
    </div>
  )
}
