import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { LOCAL_AGENT_MODEL_SOURCE_LABELS } from '@renderer/hooks/agent/useLocalAgentModelSelection'
import type { useLocalAgentModelTabs } from '@renderer/hooks/agent/useLocalAgentModelTabs'

export function LocalAgentModelTabs({
  tabs,
  renderHeader,
  children
}: {
  tabs: ReturnType<typeof useLocalAgentModelTabs>
  renderHeader?: (tabList: ReactNode) => ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const tabList =
    tabs.sources.length > 1 ? (
      <TabsList className="h-auto min-h-9 max-w-full shrink-0 flex-wrap" aria-label={t('settings.models.list_title')}>
        {tabs.sources.map((source) => (
          <TabsTrigger key={source} value={source} className="text-xs">
            {t(LOCAL_AGENT_MODEL_SOURCE_LABELS[source])}
          </TabsTrigger>
        ))}
      </TabsList>
    ) : null
  const header = renderHeader ? renderHeader(tabList) : tabList
  if (!tabList)
    return (
      <>
        {header}
        {children}
      </>
    )
  return (
    <Tabs value={tabs.source} onValueChange={tabs.setSource} className="min-w-0 gap-3">
      {header}
      <TabsContent value={tabs.source} className="min-w-0 space-y-3">
        {children}
      </TabsContent>
    </Tabs>
  )
}
