import type { ReactNode } from 'react'

import { TabIdContext } from '@renderer/hooks/tab'

export function TabIdProvider({ tabId, children }: { tabId: string; children: ReactNode }) {
  return <TabIdContext value={tabId}>{children}</TabIdContext>
}
