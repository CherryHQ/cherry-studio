import type { TopicMessageFlowLiveState } from '@renderer/components/chat/flow'
import {
  createResourcePaneCapability,
  RESOURCE_PANE_TAB,
  type ResourcePaneConfig,
  ResourcePaneLocateOpener,
  type RightPanelCapability,
  type RightPanelComponentProps,
  type RightPanelComposition,
  RightPanelProvider,
  RightPanelShortcut,
  RightPanelViewport,
  useRightPanelState
} from '@renderer/components/chat/panes/Shell'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { Activity, GitBranch } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { createContext, lazy, Suspense, use, useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import TopicBranchPanel from './TopicBranchPanel'

const TracePane = lazy(() =>
  import('@renderer/components/chat/trace/TracePane').then((module) => ({ default: module.TracePane }))
)

interface TopicRightPaneMeta {
  topicId?: string
  topicName?: string
  /** Container-level trace id. When developer mode is on, the Trace tab renders this trace tree. */
  traceId?: string
}

interface TopicRightPaneViewportCallbacks {
  onLocateMessage?: (messageId: string) => void
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
  if (!store) throw new Error('useTopicBranchLiveStateStore must be used within <TopicRightPane.Scope>')
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
    />
  )
}

function TopicTraceRightPanel({ scope }: RightPanelComponentProps<TopicRightPanelScope>) {
  return (
    <Suspense fallback={null}>
      <TracePane payload={{ topicId: scope.topicId ?? '', traceId: scope.traceId ?? '' }} />
    </Suspense>
  )
}

/** Stable capability declarations; catalog order is the fallback order. */
const TRACE_PANE_ID = 'trace'
const TOPIC_RESOURCE_PANE_CAPABILITY = createResourcePaneCapability<TopicRightPanelScope>()
const TOPIC_TRACE_PANE_CAPABILITY = {
  component: TopicTraceRightPanel,
  resolve: (scope: TopicRightPanelScope) => ({
    id: TRACE_PANE_ID,
    instanceKey: `trace:${scope.topicId ?? 'unavailable'}:${scope.traceId ?? ''}`,
    title: scope.traceTitle,
    readiness: scope.developerMode && scope.topicId ? 'ready' : 'unavailable'
  })
} satisfies RightPanelCapability<TopicRightPanelScope>
const TOPIC_RIGHT_PANEL_CAPABILITIES = [
  TOPIC_RESOURCE_PANE_CAPABILITY,
  {
    component: TopicBranchRightPanel,
    resolve: (scope) => ({
      id: 'branch',
      instanceKey: `branch:${scope.topicId ?? 'unavailable'}`,
      title: scope.branchTitle,
      readiness: scope.topicId ? 'ready' : 'unavailable',
      canMaximize: true
    })
  },
  TOPIC_TRACE_PANE_CAPABILITY
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
  userOpenIntentSeq,
  revealRequest
}: PropsWithChildren<
  TopicRightPaneMeta & {
    resourcePane?: ResourcePaneConfig | null
    present?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
    userOpenIntentSeq?: number
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
    <RightPanelProvider
      capabilities={TOPIC_RIGHT_PANEL_CAPABILITIES}
      scope={scope}
      defaultPanelId={RESOURCE_PANE_TAB}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      userOpenIntentSeq={userOpenIntentSeq}
      present={present}>
      <ResourcePaneLocateOpener revealRequest={revealRequest} />
      <TopicBranchLiveStateStoreContext value={storeRef.current}>{children}</TopicBranchLiveStateStoreContext>
    </RightPanelProvider>
  )
}

function TopicRightPaneViewport({ onLocateMessage }: TopicRightPaneViewportCallbacks) {
  const callbacks = useMemo<TopicRightPaneViewportCallbacks>(() => ({ onLocateMessage }), [onLocateMessage])

  return (
    <TopicRightPaneViewportContext value={callbacks}>
      <RightPanelViewport />
    </TopicRightPaneViewportContext>
  )
}

function TopicRightPaneShortcuts() {
  const { t } = useTranslation()

  return (
    <>
      <RightPanelShortcut tab="branch" label={t('chat.message.flow.title')} icon={<GitBranch className="size-3.5" />} />
      <RightPanelShortcut tab={TRACE_PANE_ID} label={t('trace.label')} icon={<Activity className="size-3.5" />} />
    </>
  )
}

export const TopicRightPane = {
  Scope: TopicRightPaneProvider,
  Viewport: TopicRightPaneViewport,
  Shortcuts: TopicRightPaneShortcuts
} satisfies RightPanelComposition
