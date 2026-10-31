import { useTranslation } from 'react-i18next'

import { TabsList, TabsTrigger, Tooltip } from '@cherrystudio/ui'
import {
  LOCAL_AGENT_MODEL_SOURCE_LABELS,
  type LocalAgentModelSourceRestrictions
} from '@renderer/hooks/agent/useLocalAgentModelSelection'
import type { useLocalAgentModelTabs } from '@renderer/hooks/agent/useLocalAgentModelTabs'
import { cn } from '@renderer/utils/style'

export function LocalAgentModelTabList({
  sources,
  sourceRestrictions,
  className
}: {
  sources: ReturnType<typeof useLocalAgentModelTabs>['sources']
  sourceRestrictions?: LocalAgentModelSourceRestrictions
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <TabsList
      className={cn('h-auto min-h-9 max-w-full shrink-0 flex-wrap', className)}
      aria-label={t('settings.models.list_title')}>
      {(['native', 'gateway'] as const).map((source) => {
        const disabled = !sources.includes(source)
        return (
          <Tooltip
            key={source}
            content={
              disabled
                ? (sourceRestrictions?.[source] ??
                  t(
                    source === 'native'
                      ? 'local_agents.model_sources.native_unavailable'
                      : 'local_agents.model_sources.gateway_unavailable'
                  ))
                : undefined
            }
            classNames={{ placeholder: 'inline-flex flex-1' }}>
            <TabsTrigger value={source} disabled={disabled} className="text-xs">
              {t(LOCAL_AGENT_MODEL_SOURCE_LABELS[source])}
            </TabsTrigger>
          </Tooltip>
        )
      })}
    </TabsList>
  )
}
