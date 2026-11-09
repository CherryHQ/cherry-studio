import type { ReactNode } from 'react'

import { useCommandRuntime } from '@renderer/hooks/command'
import { TabCommandRuntimeContext, TabIdContext } from '@renderer/hooks/tab'

export function TabIdProvider({ tabId, children }: { tabId: string; children: ReactNode }) {
  const runtime = useCommandRuntime()
  return (
    <TabIdContext value={tabId}>
      <TabCommandRuntimeContext value={runtime}>{children}</TabCommandRuntimeContext>
    </TabIdContext>
  )
}
