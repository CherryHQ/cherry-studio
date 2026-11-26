import type { ReactNode, Ref } from 'react'

import { ScrollArea, Tabs, TabsContent } from '@cherrystudio/ui'
import type { LocalAgentModelSourceRestrictions } from '@renderer/hooks/agent/useLocalAgentModelSelection'
import type { useLocalAgentModelTabs } from '@renderer/hooks/agent/useLocalAgentModelTabs'

import { LocalAgentModelTabList } from './LocalAgentModelTabList'

export function LocalAgentModelTabs({
  tabs,
  sourceRestrictions,
  viewportRef,
  renderHeader,
  children
}: {
  tabs: ReturnType<typeof useLocalAgentModelTabs>
  sourceRestrictions?: LocalAgentModelSourceRestrictions
  viewportRef: Ref<HTMLDivElement>
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
    <Tabs variant="underline" value={source} onValueChange={tabs.setSource} className="min-h-0 min-w-0 flex-1 gap-3">
      <div className="shrink-0 px-6">
        <div className="mx-auto max-w-3xl">{header}</div>
      </div>
      <TabsContent value={source} className="flex min-h-0 min-w-0 flex-col">
        <ScrollArea
          className="min-h-0 flex-1"
          viewportProps={{ ref: viewportRef }}
          contentProps={{ className: 'px-6 pb-6' }}>
          <div className="mx-auto max-w-3xl space-y-3">{children}</div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  )
}
