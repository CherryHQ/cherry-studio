import type { TopicMessageFlowLiveState } from '@renderer/components/chat/messages/flow/topicMessageFlowLiveTree'
import { Shell, useShellState } from '@renderer/components/chat/panes/Shell'
import { useWindowFrame } from '@renderer/components/chat/shell/WindowFrameContext'
import { TracePane } from '@renderer/components/chat/trace/TracePane'
import { useIsActiveTab } from '@renderer/context/TabIdContext'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { Activity, GitBranch } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { createContext, use, useCallback, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import TopicBranchPanel from './TopicBranchPanel'

interface TopicRightPaneSurfaceProps {
  topicId: string
  topicName?: string
  /** Container-level trace id. When developer mode is on, the Trace tab renders this trace tree. */
  traceId?: string
  onLocateMessage?: (messageId: string) => void
  onStartBranchDraft?: (messageId: string) => Promise<void> | void
  onCancelBranchDraft?: (nextActiveNodeId?: string | null) => void
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

function useTopicBranchLiveStateStore(): TopicBranchLiveStateStore {
  const store = use(TopicBranchLiveStateStoreContext)
  if (!store) throw new Error('useTopicBranchLiveStateStore must be used within <TopicRightPane>')
  return store
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

function TopicRightPaneProvider({ children }: PropsWithChildren) {
  const storeRef = useRef<TopicBranchLiveStateStore>(undefined as never)
  if (!storeRef.current) storeRef.current = createTopicBranchLiveStateStore()

  return (
    <Shell defaultTab="branch">
      <TopicBranchLiveStateStoreContext value={storeRef.current}>{children}</TopicBranchLiveStateStoreContext>
    </Shell>
  )
}

function TopicRightPaneSurface({
  topicId,
  topicName,
  traceId,
  onLocateMessage,
  onStartBranchDraft,
  onCancelBranchDraft
}: TopicRightPaneSurfaceProps) {
  const { t } = useTranslation()
  const [enableDeveloperMode] = usePreference('app.developer_mode.enabled')
  const shellState = useShellState()
  const branchLiveState = useTopicBranchLiveState(topicId)
  const { mode, chrome } = useWindowFrame()
  const isWindow = mode === 'window'
  const canvasFocusKey = `${topicId}:${shellState.maximized ? 'maximized' : 'docked'}:${shellState.pdfLayoutRefreshKey}`
  const canvasLayoutReady = shellState.maximized || !shellState.pdfLayoutPending
  const handleLocateMessage = useCallback(
    (messageId: string) => {
      onLocateMessage?.(messageId)
    },
    [onLocateMessage]
  )

  // The TabList absorbs the navbar's right cluster while the pane is open: pin/back-to-main
  // when we're in a sub-window, plus the pane toggle (closes the open pane). Navbar suppresses
  // its own copy via useOptionalShellState — see ConversationShellTopRightTool.
  const tabListTrailing = (
    <>
      {isWindow ? chrome?.titleTrailing : null}
      <TopicRightPaneToggle />
    </>
  )

  return (
    <Shell.Tabs>
      <Shell.TabList extraTrailing={tabListTrailing}>
        <Shell.Tab value="branch" icon={<GitBranch className="size-3.5" />}>
          {t('chat.message.flow.title')}
        </Shell.Tab>
        {enableDeveloperMode && (
          <Shell.Tab value="trace" icon={<Activity className="size-3.5" />}>
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
          onStartBranchDraft={onStartBranchDraft}
          onCancelBranchDraft={onCancelBranchDraft}
        />
      </Shell.Panel>
      {enableDeveloperMode && (
        <Shell.Panel value="trace">
          <TracePane payload={{ topicId, traceId: traceId ?? '' }} />
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
