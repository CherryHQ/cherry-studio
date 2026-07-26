import { TabIdContext } from '@renderer/hooks/tab'
import type { ReactNode } from 'react'

export function TabIdProvider({ tabId, children }: { tabId: string; children: ReactNode }) {
  return <TabIdContext value={tabId}>{children}</TabIdContext>
}
