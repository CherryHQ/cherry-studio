import type { ReactNode } from 'react'

import { Tabs, TabsContent } from '@cherrystudio/ui'
import type { LocalAgentModelSourceRestrictions } from '@renderer/hooks/agent/useLocalAgentModelSelection'
import type { useLocalAgentModelTabs } from '@renderer/hooks/agent/useLocalAgentModelTabs'

import { LocalAgentModelTabList } from './LocalAgentModelTabList'

export function LocalAgentModelTabs({
  tabs,
  sourceRestrictions,
  renderHeader,
  children
}: {
  tabs: ReturnType<typeof useLocalAgentModelTabs>
  sourceRestrictions?: LocalAgentModelSourceRestrictions
  renderHeader?: (tabList: ReactNode) => ReactNode
  children: ReactNode
}) {
  const tabList = (
    <LocalAgentModelTabList
      sources={tabs.sources}
      sourceRestrictions={sourceRestrictions}
      className="min-h-9 [&_[data-slot=tabs-trigger]]:text-sm"
    />
  )
  const header = renderHeader ? renderHeader(tabList) : tabList
  const source = tabs.sources.includes(tabs.source) ? tabs.source : ''
  return (
    <Tabs variant="underline" value={source} onValueChange={tabs.setSource} className="min-w-0 gap-3">
      {header}
      <TabsContent value={source} className="min-w-0 space-y-3">
        {children}
      </TabsContent>
    </Tabs>
  )
}
