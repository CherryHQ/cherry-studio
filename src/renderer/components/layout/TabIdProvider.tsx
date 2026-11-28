import type { ReactNode } from 'react'

import { useCommandRuntime } from '@renderer/hooks/command'
import { TabCommandRuntimeContext, TabIdContext, TabRouteActiveContext } from '@renderer/hooks/tab'

export function TabIdProvider({
  tabId,
  isActive = true,
  children
}: {
  tabId: string
  isActive?: boolean
  children: ReactNode
}) {
  const runtime = useCommandRuntime()
  return (
    <TabIdContext value={tabId}>
      <TabRouteActiveContext value={isActive}>
        <TabCommandRuntimeContext value={runtime}>{children}</TabCommandRuntimeContext>
      </TabRouteActiveContext>
    </TabIdContext>
  )
}
