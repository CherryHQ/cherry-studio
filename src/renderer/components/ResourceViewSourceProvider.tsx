import {
  type AgentSessionsSource,
  AgentSessionsSourceContext,
  type AssistantTopicsSource,
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
import { useEffect, useMemo, useState } from 'react'

type AssistantTopicsSnapshot = Pick<AssistantTopicsSource, 'pages' | 'topics'>
type AgentSessionsSnapshot = Pick<AgentSessionsSource, 'pinIdBySessionId' | 'sessions'>

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

function useCommittedAssistantTopicsSource(enabled: boolean): AssistantTopicsSource {
  const rawSource = useRawAssistantTopicsSource({ enabled })
  const [snapshot, setSnapshot] = useState<AssistantTopicsSnapshot | null>(null)
  const rawSourceReady = enabled && rawSource.isFullyLoaded && !rawSource.isRefreshing && !rawSource.error

  useEffect(() => {
    if (!rawSourceReady) return

    setSnapshot((currentSnapshot) =>
      currentSnapshot?.pages === rawSource.pages && currentSnapshot?.topics === rawSource.topics
        ? currentSnapshot
        : {
            pages: rawSource.pages,
            topics: rawSource.topics
          }
    )
  }, [rawSource.pages, rawSource.topics, rawSourceReady])

  const isColdLoading = enabled && snapshot === null
  const snapshotIsCurrent = snapshot?.pages === rawSource.pages && snapshot?.topics === rawSource.topics
  const isBackgroundRefreshing =
    enabled &&
    snapshot !== null &&
    (!rawSource.isFullyLoaded || rawSource.isRefreshing || (rawSourceReady && !snapshotIsCurrent))

  return useMemo(
    () => ({
      topics: snapshot?.topics ?? (enabled ? rawSource.topics : []),
      pages: snapshot?.pages ?? (enabled ? rawSource.pages : []),
      hasNext: snapshot || !enabled ? false : rawSource.hasNext,
      loadNext: rawSource.loadNext,
      isLoading: isColdLoading && rawSource.isLoading,
      isLoadingAll: isColdLoading && rawSource.isLoadingAll,
      isFullyLoaded: snapshot !== null,
      isRefreshing: isBackgroundRefreshing,
      error: snapshot ? undefined : rawSource.error,
      refetch: rawSource.refetch,
      mutate: rawSource.mutate
    }),
    [
      isBackgroundRefreshing,
      isColdLoading,
      rawSource.error,
      rawSource.hasNext,
      rawSource.isLoading,
      rawSource.isLoadingAll,
      rawSource.loadNext,
      rawSource.mutate,
      rawSource.pages,
      rawSource.refetch,
      rawSource.topics,
      enabled,
      snapshot
    ]
  )
}

function useCommittedAgentSessionsSource(enabled: boolean): AgentSessionsSource {
  const rawSource = useRawAgentSessionsSource({ enabled })
  const [snapshot, setSnapshot] = useState<AgentSessionsSnapshot | null>(null)
  const rawSourceReady =
    enabled &&
    rawSource.isFullyLoaded &&
    !rawSource.isValidating &&
    !rawSource.isPinsLoading &&
    !rawSource.isPinsRefreshing &&
    !rawSource.error

  useEffect(() => {
    if (!rawSourceReady) return

    setSnapshot((currentSnapshot) =>
      currentSnapshot?.pinIdBySessionId === rawSource.pinIdBySessionId &&
      currentSnapshot?.sessions === rawSource.sessions
        ? currentSnapshot
        : {
            pinIdBySessionId: rawSource.pinIdBySessionId,
            sessions: rawSource.sessions
          }
    )
  }, [rawSource.pinIdBySessionId, rawSource.sessions, rawSourceReady])

  const isColdLoading = enabled && snapshot === null
  const snapshotIsCurrent =
    snapshot?.pinIdBySessionId === rawSource.pinIdBySessionId && snapshot?.sessions === rawSource.sessions
  const isBackgroundRefreshing =
    enabled &&
    snapshot !== null &&
    (!rawSource.isFullyLoaded ||
      rawSource.isValidating ||
      rawSource.isPinsRefreshing ||
      (rawSourceReady && !snapshotIsCurrent))

  return useMemo(
    () => ({
      sessions: snapshot?.sessions ?? (enabled ? rawSource.sessions : []),
      pinIdBySessionId: snapshot?.pinIdBySessionId ?? (enabled ? rawSource.pinIdBySessionId : new Map()),
      total: snapshot?.sessions.length ?? (enabled ? rawSource.total : 0),
      hasMore: snapshot || !enabled ? false : rawSource.hasMore,
      error: snapshot ? undefined : rawSource.error,
      isLoading: isColdLoading && rawSource.isLoading,
      isLoadingMore: snapshot || !enabled ? false : rawSource.isLoadingMore,
      isValidating: isBackgroundRefreshing || (isColdLoading && rawSource.isValidating),
      reload: rawSource.reload,
      loadMore: rawSource.loadMore,
      createSession: rawSource.createSession,
      deleteSession: rawSource.deleteSession,
      deleteSessions: rawSource.deleteSessions,
      reorderSession: rawSource.reorderSession,
      reorderSessions: rawSource.reorderSessions,
      togglePin: rawSource.togglePin,
      isFullyLoaded: snapshot !== null,
      isLoadingAll: isColdLoading && rawSource.isLoadingAll,
      isPinsLoading: isColdLoading && rawSource.isPinsLoading,
      isPinsRefreshing: isBackgroundRefreshing && rawSource.isPinsRefreshing
    }),
    [
      enabled,
      isBackgroundRefreshing,
      isColdLoading,
      rawSource.createSession,
      rawSource.deleteSession,
      rawSource.deleteSessions,
      rawSource.error,
      rawSource.hasMore,
      rawSource.isLoading,
      rawSource.isLoadingAll,
      rawSource.isLoadingMore,
      rawSource.isPinsLoading,
      rawSource.isPinsRefreshing,
      rawSource.isValidating,
      rawSource.loadMore,
      rawSource.pinIdBySessionId,
      rawSource.reload,
      rawSource.reorderSession,
      rawSource.reorderSessions,
      rawSource.sessions,
      rawSource.togglePin,
      rawSource.total,
      snapshot
    ]
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
  const assistantTopicsSource = useCommittedAssistantTopicsSource(assistantTopicsEnabled)
  const agentSessionsSource = useCommittedAgentSessionsSource(agentSessionsEnabled)

  return (
    <AssistantTopicsSourceContext value={assistantTopicsSource}>
      <AgentSessionsSourceContext value={agentSessionsSource}>{children}</AgentSessionsSourceContext>
    </AssistantTopicsSourceContext>
  )
}
