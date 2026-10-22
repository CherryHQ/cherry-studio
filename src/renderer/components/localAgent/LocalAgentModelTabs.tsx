import type { ReactNode } from 'react'

import { Tabs, TabsContent } from '@cherrystudio/ui'
import type { useLocalAgentModelTabs } from '@renderer/hooks/agent/useLocalAgentModelTabs'

import { LocalAgentModelTabList } from './LocalAgentModelTabList'

export function LocalAgentModelTabs({
  tabs,
  renderHeader,
  children
}: {
  tabs: ReturnType<typeof useLocalAgentModelTabs>
  renderHeader?: (tabList: ReactNode) => ReactNode
  children: ReactNode
}) {
  const tabList = tabs.sources.length > 1 ? <LocalAgentModelTabList sources={tabs.sources} /> : null
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
