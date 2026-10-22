import { useTranslation } from 'react-i18next'

import { TabsList, TabsTrigger } from '@cherrystudio/ui'
import { LOCAL_AGENT_MODEL_SOURCE_LABELS } from '@renderer/hooks/agent/useLocalAgentModelSelection'
import type { useLocalAgentModelTabs } from '@renderer/hooks/agent/useLocalAgentModelTabs'
import { cn } from '@renderer/utils/style'

export function LocalAgentModelTabList({
  sources,
  className
}: {
  sources: ReturnType<typeof useLocalAgentModelTabs>['sources']
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <TabsList
      className={cn('h-auto min-h-9 max-w-full shrink-0 flex-wrap', className)}
      aria-label={t('settings.models.list_title')}>
      {sources.map((source) => (
        <TabsTrigger key={source} value={source} className="text-xs">
          {t(LOCAL_AGENT_MODEL_SOURCE_LABELS[source])}
        </TabsTrigger>
      ))}
    </TabsList>
  )
}
