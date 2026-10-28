import { CircleCheck, CircleStop, CircleX, Clock3, Loader2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { TaskRunSummary } from '@shared/data/api/schemas/agents'

export function formatTaskCardTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

export const TaskRunSummaryLine: FC<{ summary: TaskRunSummary }> = ({ summary }) => {
  const { t } = useTranslation()

  if (summary.status === 'queued') {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Clock3 aria-hidden className="size-3" />
        {t('agent.tasks.runSummary.queued')}
      </span>
    )
  }

  if (summary.status === 'running') {
    return (
      <span className="flex items-center gap-1.5 text-foreground">
        <Loader2 aria-hidden className="size-3 shrink-0 motion-safe:animate-spin" />
        {t('agent.tasks.runSummary.running')}
      </span>
    )
  }

  const time = formatTaskCardTime(summary.finishedAt)
  if (summary.status === 'completed') {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <CircleCheck aria-hidden className="size-3 shrink-0" />
        {t('agent.tasks.runSummary.completed', { time })}
      </span>
    )
  }
  if (summary.status === 'failed') {
    return (
      <span className="flex items-center gap-1.5 text-error-subtle-foreground">
        <CircleX aria-hidden className="size-3 shrink-0" />
        {t('agent.tasks.runSummary.failed', { time })}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <CircleStop aria-hidden className="size-3 shrink-0" />
      {t('agent.tasks.runSummary.cancelled', { time })}
    </span>
  )
}
