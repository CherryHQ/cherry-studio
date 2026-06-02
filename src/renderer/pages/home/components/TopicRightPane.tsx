import type { TopicMessageFlowLiveState } from '@renderer/components/chat/messages/flow/topicMessageFlowLiveTree'
import { Shell, useShellActions, useShellState } from '@renderer/components/chat/panes/Shell'
import { TracePane, type TracePanePayload } from '@renderer/components/chat/trace/TracePane'
import { useIsActiveTab } from '@renderer/context/TabIdContext'
import { Activity, GitBranch } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { createContext, use, useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import TopicBranchPanel from './TopicBranchPanel'

interface TopicRightPaneSurfaceProps {
  topicId: string
  topicName?: string
  onLocateMessage?: (messageId: string) => void
}

interface TopicRightPaneState {
  tracePayload: TracePanePayload | null
}

interface TopicRightPaneActions {
  openTrace: (payload: TracePanePayload) => void
  closeTrace: () => void
}

interface TopicRightPaneContextValue {
  state: TopicRightPaneState
  actions: TopicRightPaneActions
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
const TopicRightPaneContext = createContext<TopicRightPaneContextValue | null>(null)

function useTopicBranchLiveStateStore(): TopicBranchLiveStateStore {
  const store = use(TopicBranchLiveStateStoreContext)
  if (!store) throw new Error('useTopicBranchLiveStateStore must be used within <TopicRightPane>')
  return store
}

function useTopicRightPane(): TopicRightPaneContextValue {
  const value = use(TopicRightPaneContext)
  if (!value) throw new Error('useTopicRightPane must be used within <TopicRightPane>')
  return value
}

export function useTopicRightPaneActions(): TopicRightPaneActions {
  return useTopicRightPane().actions
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

function TopicRightPaneStateProvider({ children }: PropsWithChildren) {
  const { openTab } = useShellActions()
  const { activeTab } = useShellState()
  const [tracePayload, setTracePayload] = useState<TracePanePayload | null>(null)

  const openTrace = useCallback(
    (payload: TracePanePayload) => {
      setTracePayload(payload)
      openTab('trace')
    },
    [openTab]
  )
  const closeTrace = useCallback(() => {
    if (activeTab === 'trace') openTab('branch')
    setTracePayload(null)
  }, [activeTab, openTab])

  const value = useMemo<TopicRightPaneContextValue>(
    () => ({
      state: { tracePayload },
      actions: { openTrace, closeTrace }
    }),
    [closeTrace, openTrace, tracePayload]
  )

  return <TopicRightPaneContext value={value}>{children}</TopicRightPaneContext>
}

function TopicRightPaneProvider({ children }: PropsWithChildren) {
  const storeRef = useRef<TopicBranchLiveStateStore>(undefined as never)
  if (!storeRef.current) storeRef.current = createTopicBranchLiveStateStore()

  return (
    <Shell defaultTab="branch">
      <TopicBranchLiveStateStoreContext value={storeRef.current}>
        <TopicRightPaneStateProvider>{children}</TopicRightPaneStateProvider>
      </TopicBranchLiveStateStoreContext>
    </Shell>
  )
}

function TopicRightPaneSurface({ topicId, topicName, onLocateMessage }: TopicRightPaneSurfaceProps) {
  const { t } = useTranslation()
  const { state, actions } = useTopicRightPane()
  const shellState = useShellState()
  const shellActions = useShellActions()
  const branchLiveState = useTopicBranchLiveState(topicId)
  const canvasFocusKey = `${topicId}:${shellState.maximized ? 'maximized' : 'docked'}:${shellState.pdfLayoutRefreshKey}`
  const canvasLayoutReady = shellState.maximized || !shellState.pdfLayoutPending
  const handleLocateMessage = useCallback(
    (messageId: string) => {
      shellActions.close(() => onLocateMessage?.(messageId))
    },
    [onLocateMessage, shellActions]
  )

  return (
    <Shell.Tabs>
      <Shell.TabList>
        <Shell.Tab value="branch" icon={<GitBranch className="size-3.5" />}>
          {t('chat.message.flow.title')}
        </Shell.Tab>
        {state.tracePayload && (
          <Shell.Tab value="trace" icon={<Activity className="size-3.5" />} onClose={actions.closeTrace}>
            {t('trace.label')}
          </Shell.Tab>
        )}
      </Shell.TabList>
      <Shell.Panel value="branch">
        <TopicBranchPanel
          open
          topicId={topicId}
          topicName={topicName}
          liveState={branchLiveState}
          focusKey={canvasFocusKey}
          layoutReady={canvasLayoutReady}
          onLocateMessage={handleLocateMessage}
        />
      </Shell.Panel>
      {state.tracePayload && (
        <Shell.Panel value="trace">
          <TracePane payload={state.tracePayload} />
        </Shell.Panel>
      )}
    </Shell.Tabs>
  )
}

function TopicRightPaneHost(props: TopicRightPaneSurfaceProps) {
  return (
    <Shell.Host>
      <TopicRightPaneSurface {...props} />
    </Shell.Host>
  )
}

function TopicRightPaneMaximizedOverlay(props: TopicRightPaneSurfaceProps) {
  return (
    <Shell.MaximizedOverlay>
      <TopicRightPaneSurface {...props} />
    </Shell.MaximizedOverlay>
  )
}

function TopicRightPaneToggle({ disabled }: { disabled?: boolean }) {
  const isActiveTab = useIsActiveTab()
  return <Shell.Toggle tab="branch" command="topic.sidebar.toggle" commandEnabled={isActiveTab} disabled={disabled} />
}

export const TopicRightPane = Object.assign(TopicRightPaneProvider, {
  Host: TopicRightPaneHost,
  MaximizedOverlay: TopicRightPaneMaximizedOverlay,
  Toggle: TopicRightPaneToggle
})
