import {
  AgentSessionsSourceContext,
  AssistantTopicsSourceContext,
  useRawAgentSessionsSource,
  useRawAssistantTopicsSource
} from '@renderer/hooks/resourceViewSources'
import { useTabs } from '@renderer/hooks/tab'
import {
  getSidebarApp,
  isMessageOnlyConversationUrl,
  type SidebarAppId,
  tabBelongsToApp
} from '@renderer/utils/sidebar'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

export function shouldLoadResourceViewSource(
  tabs: readonly Tab[],
  activeTabId: string | null | undefined,
  appId: SidebarAppId
): boolean {
  const app = getSidebarApp(appId)
  if (!app) return false

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  return Boolean(
    activeTab?.type === 'route' &&
      !activeTab.isDormant &&
      tabBelongsToApp(app, activeTab.url) &&
      !isMessageOnlyConversationUrl(activeTab.url)
  )
}

export function ResourceViewSourceProvider({ children }: { children: ReactNode }) {
  const { activeTabId, tabs } = useTabs()
  const assistantTopicsEnabled = useMemo(
    () => shouldLoadResourceViewSource(tabs, activeTabId, 'assistants'),
    [activeTabId, tabs]
  )
  const agentSessionsEnabled = useMemo(
    () => shouldLoadResourceViewSource(tabs, activeTabId, 'agents'),
    [activeTabId, tabs]
  )
  const assistantTopicsSource = useRawAssistantTopicsSource({ enabled: assistantTopicsEnabled })
  const agentSessionsSource = useRawAgentSessionsSource({ enabled: agentSessionsEnabled })

  return (
    <AssistantTopicsSourceContext value={assistantTopicsSource}>
      <AgentSessionsSourceContext value={agentSessionsSource}>{children}</AgentSessionsSourceContext>
    </AssistantTopicsSourceContext>
  )
}
