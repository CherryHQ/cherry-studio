import {
  type AgentSessionsSource,
  AgentSessionsSourceContext,
  type AssistantTopicsSource,
  AssistantTopicsSourceContext,
  type AssistantTopicsView,
  deriveAssistantTopicsView,
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

const EMPTY_PIN_IDS = new Map<string, string>()
const EMPTY_TOPICS: ReturnType<typeof useRawAssistantTopicsSource>['topics'] = []
const EMPTY_ASSISTANT_TOPICS_VIEW: AssistantTopicsView = { rendererTopics: [], orderSignature: '' }

type AssistantTopicsSnapshot = Pick<ReturnType<typeof useRawAssistantTopicsSource>, 'pages' | 'topics'>
type AgentSessionsSnapshot = Pick<ReturnType<typeof useRawAgentSessionsSource>, 'pinIdBySessionId' | 'sessions'>

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

function useCommittedAssistantTopicsSource(enabled: boolean, retainDerivedView: boolean): AssistantTopicsSource {
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
  // A failed background refresh keeps serving the stale snapshot (stale-while-
  // error). While a retry fetch is actually in flight `isRefreshing` stays
  // honest, but once the source is idle with an error, `!isFullyLoaded` alone
  // must not pin consumers in a perpetual refreshing state (e.g. reorder
  // disabled) with no visible cause.
  const isBackgroundRefreshing =
    enabled &&
    snapshot !== null &&
    (rawSource.isRefreshing ||
      (!rawSource.error && (!rawSource.isFullyLoaded || (rawSourceReady && !snapshotIsCurrent))))

  const topics = snapshot?.topics ?? (enabled ? rawSource.topics : EMPTY_TOPICS)
  // Derived once per window here — kept-alive tabs consume this shared view
  // instead of each remapping the full list (see AssistantTopicsView).
  const topicsView = useMemo(
    () => (retainDerivedView ? deriveAssistantTopicsView(topics) : EMPTY_ASSISTANT_TOPICS_VIEW),
    [retainDerivedView, topics]
  )

  return useMemo(
    () => ({
      topics,
      ...topicsView,
      isLoadingAll: isColdLoading && rawSource.isLoadingAll,
      isFullyLoaded: snapshot !== null,
      isRefreshing: isBackgroundRefreshing,
      error: snapshot ? undefined : rawSource.error,
      refreshError: snapshot ? rawSource.error : undefined,
      refetch: rawSource.refetch
    }),
    [
      isBackgroundRefreshing,
      isColdLoading,
      rawSource.error,
      rawSource.isLoadingAll,
      rawSource.refetch,
      topics,
      topicsView,
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
  // See useCommittedAssistantTopicsSource: a failed background refresh serves
  // the stale snapshot and reports refreshing only while a fetch is in flight,
  // never as a perpetual error-idle state.
  const isBackgroundRefreshing =
    enabled &&
    snapshot !== null &&
    (rawSource.isValidating ||
      rawSource.isPinsRefreshing ||
      (!rawSource.error && (!rawSource.isFullyLoaded || (rawSourceReady && !snapshotIsCurrent))))

  return useMemo(
    () => ({
      sessions: snapshot?.sessions ?? (enabled ? rawSource.sessions : []),
      // `togglePin` decides pin vs unpin from the raw map, so the rendered pin
      // state has to come from that same map. A snapshot frozen by a failed
      // refresh would otherwise make the button do the opposite of its label.
      // `/pins` is a plain cached key, so reading it directly costs no flicker.
      pinIdBySessionId: enabled ? rawSource.pinIdBySessionId : (snapshot?.pinIdBySessionId ?? EMPTY_PIN_IDS),
      hasMore: snapshot || !enabled ? false : rawSource.hasMore,
      error: snapshot ? undefined : rawSource.error,
      refreshError: snapshot ? rawSource.error : undefined,
      isLoading: isColdLoading && rawSource.isLoading,
      isLoadingMore: snapshot || !enabled ? false : rawSource.isLoadingMore,
      isValidating: isBackgroundRefreshing || (isColdLoading && rawSource.isValidating),
      reload: rawSource.reload,
      deleteSession: rawSource.deleteSession,
      deleteSessions: rawSource.deleteSessions,
      reorderSession: rawSource.reorderSession,
      togglePin: rawSource.togglePin,
      isFullyLoaded: snapshot !== null,
      isLoadingAll: isColdLoading && rawSource.isLoadingAll,
      isPinsLoading: isColdLoading && rawSource.isPinsLoading
    }),
    [
      enabled,
      isBackgroundRefreshing,
      isColdLoading,
      rawSource.deleteSession,
      rawSource.deleteSessions,
      rawSource.error,
      rawSource.hasMore,
      rawSource.isLoading,
      rawSource.isLoadingAll,
      rawSource.isLoadingMore,
      rawSource.isPinsLoading,
      rawSource.isValidating,
      rawSource.pinIdBySessionId,
      rawSource.reload,
      rawSource.reorderSession,
      rawSource.sessions,
      rawSource.togglePin,
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
  const retainAssistantTopicsView = useMemo(() => {
    const app = getSidebarApp('assistants')
    if (!app) return false
    return tabs.some(
      (tab) =>
        tab.type === 'route' &&
        !tab.isDormant &&
        tabBelongsToApp(app, tab.url) &&
        !isMessageOnlyConversationUrl(tab.url)
    )
  }, [tabs])
  const agentSessionsEnabled = useMemo(
    () => shouldLoadResourceViewSource(tabs, activeTabId, 'agents'),
    [activeTabId, tabs]
  )
  const assistantTopicsSource = useCommittedAssistantTopicsSource(assistantTopicsEnabled, retainAssistantTopicsView)
  const agentSessionsSource = useCommittedAgentSessionsSource(agentSessionsEnabled)

  return (
    <AssistantTopicsSourceContext value={assistantTopicsSource}>
      <AgentSessionsSourceContext value={agentSessionsSource}>{children}</AgentSessionsSourceContext>
    </AssistantTopicsSourceContext>
  )
}
