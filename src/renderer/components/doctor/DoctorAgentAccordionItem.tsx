import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AccordionContent, AccordionItem, AccordionTrigger, Badge } from '@cherrystudio/ui'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { StaticMarkdown } from '@renderer/components/markdown'
import type { DoctorScopeKey } from '@shared/types/doctor'
import { doctorAgentStateCacheKey } from '@shared/utils/doctor'

/**
 * The completed AI diagnosis as one more row in the check list. Must render inside an `Accordion`.
 * Supplementary by design: it never changes the report summary or the check statuses.
 */
export function DoctorAgentAccordionItem({
  scope,
  reportRunId,
  compact = true
}: {
  readonly scope: DoctorScopeKey
  readonly reportRunId?: string
  readonly compact?: boolean
}) {
  const { t } = useTranslation()
  const state = useSharedCacheValue(doctorAgentStateCacheKey(scope))
  if (!state || state.status !== 'completed' || !state.text) return null
  if (reportRunId !== undefined && state.reportRunId !== reportRunId) return null

  return (
    <AccordionItem value="doctor-agent-summary" className={compact ? 'px-4' : 'px-2'}>
      <AccordionTrigger className="rounded-none py-3 font-normal hover:bg-transparent focus:bg-transparent focus-visible:bg-transparent">
        <span className="flex min-w-0 items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
          <span className={compact ? 'min-w-0 truncate text-xs font-medium' : 'min-w-0 truncate text-sm font-medium'}>
            {t('settings.doctor.agent.summary.title')}
          </span>
          <Badge variant="outline" className="shrink-0 border-primary/40 text-xs font-normal text-primary">
            {t('settings.doctor.agent.summary.status')}
          </Badge>
        </span>
      </AccordionTrigger>
      <AccordionContent className={`space-y-2 pb-3 text-sm ${compact ? '' : 'pl-6'}`}>
        <StaticMarkdown id={`doctor-agent-summary-${state.runId}`}>{state.text}</StaticMarkdown>
        <p className="text-xs text-muted-foreground">{t('settings.doctor.agent.summary.note')}</p>
      </AccordionContent>
    </AccordionItem>
  )
}
