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

export function shouldLoadResourceViewSource(tabs: readonly Tab[], appId: SidebarAppId): boolean {
  const app = getSidebarApp(appId)
  if (!app) return false

  return tabs.some(
    (tab) =>
      tab.type === 'route' && !tab.isDormant && tabBelongsToApp(app, tab.url) && !isMessageOnlyConversationUrl(tab.url)
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
      topics: snapshot?.topics ?? [],
      pages: snapshot?.pages ?? [],
      hasNext: snapshot ? false : rawSource.hasNext,
      loadNext: rawSource.loadNext,
      isLoading: isColdLoading && rawSource.isLoading,
      isLoadingAll: isColdLoading,
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
      rawSource.loadNext,
      rawSource.mutate,
      rawSource.refetch,
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
      sessions: snapshot?.sessions ?? [],
      pinIdBySessionId: snapshot?.pinIdBySessionId ?? new Map(),
      total: snapshot?.sessions.length ?? 0,
      hasMore: snapshot ? false : rawSource.hasMore,
      error: snapshot ? undefined : rawSource.error,
      isLoading: isColdLoading && rawSource.isLoading,
      isLoadingMore: snapshot ? false : rawSource.isLoadingMore,
      isValidating: isBackgroundRefreshing,
      reload: rawSource.reload,
      loadMore: rawSource.loadMore,
      createSession: rawSource.createSession,
      deleteSession: rawSource.deleteSession,
      deleteSessions: rawSource.deleteSessions,
      reorderSession: rawSource.reorderSession,
      reorderSessions: rawSource.reorderSessions,
      togglePin: rawSource.togglePin,
      isFullyLoaded: snapshot !== null,
      isLoadingAll: isColdLoading,
      isPinsLoading: snapshot === null && rawSource.isPinsLoading,
      isPinsRefreshing: isBackgroundRefreshing && rawSource.isPinsRefreshing
    }),
    [
      isBackgroundRefreshing,
      isColdLoading,
      rawSource.createSession,
      rawSource.deleteSession,
      rawSource.deleteSessions,
      rawSource.error,
      rawSource.hasMore,
      rawSource.isLoading,
      rawSource.isLoadingMore,
      rawSource.isPinsLoading,
      rawSource.isPinsRefreshing,
      rawSource.loadMore,
      rawSource.reload,
      rawSource.reorderSession,
      rawSource.reorderSessions,
      rawSource.togglePin,
      snapshot
    ]
  )
}

export function ResourceViewSourceProvider({ children }: { children: ReactNode }) {
  const { tabs } = useTabs()
  const assistantTopicsEnabled = useMemo(() => shouldLoadResourceViewSource(tabs, 'assistants'), [tabs])
  const agentSessionsEnabled = useMemo(() => shouldLoadResourceViewSource(tabs, 'agents'), [tabs])
  const assistantTopicsSource = useCommittedAssistantTopicsSource(assistantTopicsEnabled)
  const agentSessionsSource = useCommittedAgentSessionsSource(agentSessionsEnabled)

  return (
    <AssistantTopicsSourceContext value={assistantTopicsSource}>
      <AgentSessionsSourceContext value={agentSessionsSource}>{children}</AgentSessionsSourceContext>
    </AssistantTopicsSourceContext>
  )
}
