import type { TopicMessageFlowLiveState } from '@renderer/components/chat/flow'
import {
  RESOURCE_PANE_TAB,
  type ResourcePaneConfig,
  ResourcePaneLocateOpener,
  ResourcePaneProvider,
  RightPanel,
  type RightPanelCapability,
  type RightPanelComponentProps,
  RightPanelProvider,
  RightPanelShortcut,
  RightPanelViewport,
  useRightPanelState
} from '@renderer/components/chat/panes/Shell'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { TracePane } from '@renderer/components/chat/trace/TracePane'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { Activity, GitBranch } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { createContext, use, useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import TopicBranchPanel from './TopicBranchPanel'

interface TopicRightPaneMeta {
  topicId?: string
  topicName?: string
  /** Container-level trace id. When developer mode is on, the Trace tab renders this trace tree. */
  traceId?: string
}

interface TopicRightPaneViewportCallbacks {
  onLocateMessage?: (messageId: string) => void
  onStartBranchDraft?: (messageId: string) => Promise<void> | void
  onCancelBranchDraft?: (nextActiveNodeId?: string | null) => void
}

interface TopicRightPanelScope extends TopicRightPaneMeta {
  branchTitle: string
  developerMode: boolean
  resourcePane: ResourcePaneConfig | null
  traceTitle: string
}

type TopicBranchLiveStateSetter = (topicId: string, state: TopicMessageFlowLiveState | null) => void

interface TopicBranchLiveStateStore {
  getSnapshot: (topicId: string) => TopicMessageFlowLiveState | null
  setSnapshot: TopicBranchLiveStateSetter
  subscribe: (topicId: string, listener: () => void) => () => void
}

function createTopicBranchLiveStateStore(): TopicBranchLiveStateStore {
  const snapshots = new Map<string, TopicMessageFlowLiveState>()
  const listeners = new Map<string, Set<() => void>>()

  const notify = (topicId: string) => {
    for (const listener of listeners.get(topicId) ?? []) listener()
  }

  return {
    getSnapshot: (topicId) => snapshots.get(topicId) ?? null,
    setSnapshot: (topicId, state) => {
      const current = snapshots.get(topicId) ?? null
      if (current === state) return
      if (state) {
        snapshots.set(topicId, state)
      } else {
        snapshots.delete(topicId)
      }
      notify(topicId)
    },
    subscribe: (topicId, listener) => {
      let topicListeners = listeners.get(topicId)
      if (!topicListeners) {
        topicListeners = new Set()
        listeners.set(topicId, topicListeners)
      }
      topicListeners.add(listener)

      return () => {
        topicListeners?.delete(listener)
        if (topicListeners?.size === 0) listeners.delete(topicId)
      }
    }
  }
}

const TopicBranchLiveStateStoreContext = createContext<TopicBranchLiveStateStore | null>(null)
const TopicRightPaneViewportContext = createContext<TopicRightPaneViewportCallbacks | null>(null)

function useTopicBranchLiveStateStore(): TopicBranchLiveStateStore {
  const store = use(TopicBranchLiveStateStoreContext)
  if (!store) throw new Error('useTopicBranchLiveStateStore must be used within <TopicRightPane>')
  return store
}

function useTopicRightPaneViewport(): TopicRightPaneViewportCallbacks {
  const value = use(TopicRightPaneViewportContext)
  if (!value) throw new Error('useTopicRightPaneViewport must be used within <TopicRightPane.Viewport>')
  return value
}

export function useTopicBranchLiveStateSetter(): TopicBranchLiveStateSetter {
  return useTopicBranchLiveStateStore().setSnapshot
}

function useTopicBranchLiveState(topicId: string): TopicMessageFlowLiveState | null {
  const store = useTopicBranchLiveStateStore()
  const subscribe = useCallback((listener: () => void) => store.subscribe(topicId, listener), [store, topicId])
  const getSnapshot = useCallback(() => store.getSnapshot(topicId), [store, topicId])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function TopicResourceRightPanel({ scope }: RightPanelComponentProps<TopicRightPanelScope>) {
  return scope.resourcePane?.node ?? null
}

function TopicBranchRightPanel({ active, scope }: RightPanelComponentProps<TopicRightPanelScope>) {
  const panelState = useRightPanelState()
  const branchLiveState = useTopicBranchLiveState(scope.topicId ?? '')
  const callbacks = useTopicRightPaneViewport()
  const canvasFocusKey = `${scope.topicId ?? ''}:${panelState.maximized ? 'maximized' : 'docked'}:${panelState.pdfLayoutRefreshKey}`
  const canvasLayoutReady = panelState.maximized || !panelState.pdfLayoutPending

  if (!scope.topicId) return null

  return (
    <TopicBranchPanel
      open={active}
      topicId={scope.topicId}
      topicName={scope.topicName}
      liveState={branchLiveState}
      focusKey={canvasFocusKey}
      layoutReady={canvasLayoutReady}
      onLocateMessage={callbacks.onLocateMessage}
      onStartBranchDraft={callbacks.onStartBranchDraft}
      onCancelBranchDraft={callbacks.onCancelBranchDraft}
    />
  )
}

function TopicTraceRightPanel({ scope }: RightPanelComponentProps<TopicRightPanelScope>) {
  return <TracePane payload={{ topicId: scope.topicId ?? '', traceId: scope.traceId ?? '' }} />
}

/** Stable capability declarations; catalog order is the fallback order. */
const TOPIC_RIGHT_PANEL_CAPABILITIES = [
  {
    component: TopicResourceRightPanel,
    resolve: (scope) => ({
      id: RESOURCE_PANE_TAB,
      instanceKey: RESOURCE_PANE_TAB,
      title: scope.resourcePane?.label ?? '',
      readiness: scope.resourcePane ? 'ready' : 'unavailable'
    })
  },
  {
    component: TopicBranchRightPanel,
    resolve: (scope) => ({
      id: 'branch',
      instanceKey: `branch:${scope.topicId ?? 'unavailable'}`,
      title: scope.branchTitle,
      readiness: scope.topicId ? 'ready' : 'unavailable'
    })
  },
  {
    component: TopicTraceRightPanel,
    resolve: (scope) => ({
      id: 'trace',
      instanceKey: `trace:${scope.topicId ?? 'unavailable'}:${scope.traceId ?? ''}`,
      title: scope.traceTitle,
      readiness: scope.developerMode && scope.topicId ? 'ready' : 'unavailable'
    })
  }
] satisfies readonly RightPanelCapability<TopicRightPanelScope>[]

function TopicRightPaneProvider({
  children,
  resourcePane,
  topicId,
  topicName,
  traceId,
  present = true,
  defaultOpen = false,
  onOpenChange,
  revealRequest
}: PropsWithChildren<
  TopicRightPaneMeta & {
    resourcePane?: ResourcePaneConfig | null
    present?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
    revealRequest?: ResourceListRevealRequest
  }
>) {
  const { t } = useTranslation()
  const [enableDeveloperMode] = usePreference('app.developer_mode.enabled')
  const storeRef = useRef<TopicBranchLiveStateStore>(undefined as never)
  if (!storeRef.current) storeRef.current = createTopicBranchLiveStateStore()
  const scope = useMemo<TopicRightPanelScope>(
    () => ({
      topicId,
      topicName,
      traceId,
      resourcePane: resourcePane ?? null,
      developerMode: enableDeveloperMode,
      branchTitle: t('chat.message.flow.title'),
      traceTitle: t('trace.label')
    }),
    [enableDeveloperMode, resourcePane, t, topicId, topicName, traceId]
  )

  return (
    <ResourcePaneProvider value={resourcePane ?? null}>
      <RightPanelProvider
        capabilities={TOPIC_RIGHT_PANEL_CAPABILITIES}
        scope={scope}
        defaultPanelId={RESOURCE_PANE_TAB}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        present={present}>
        <ResourcePaneLocateOpener revealRequest={revealRequest} />
        <TopicBranchLiveStateStoreContext value={storeRef.current}>{children}</TopicBranchLiveStateStoreContext>
      </RightPanelProvider>
    </ResourcePaneProvider>
  )
}

function TopicRightPaneViewport({
  onLocateMessage,
  onStartBranchDraft,
  onCancelBranchDraft
}: TopicRightPaneViewportCallbacks) {
  const callbacks = useMemo<TopicRightPaneViewportCallbacks>(
    () => ({ onLocateMessage, onStartBranchDraft, onCancelBranchDraft }),
    [onCancelBranchDraft, onLocateMessage, onStartBranchDraft]
  )

  return (
    <TopicRightPaneViewportContext value={callbacks}>
      <RightPanelViewport>
        <RightPanel />
      </RightPanelViewport>
    </TopicRightPaneViewportContext>
  )
}

function TopicRightPaneShortcuts() {
  const { t } = useTranslation()

  return (
    <>
      <RightPanelShortcut tab="branch" label={t('chat.message.flow.title')} icon={<GitBranch className="size-3.5" />} />
      <RightPanelShortcut tab="trace" label={t('trace.label')} icon={<Activity className="size-3.5" />} />
    </>
  )
}

export const TopicRightPane = Object.assign(TopicRightPaneProvider, {
  Viewport: TopicRightPaneViewport,
  Shortcuts: TopicRightPaneShortcuts
})
