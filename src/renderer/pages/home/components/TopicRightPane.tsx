import type { TopicMessageFlowLiveState } from '@renderer/components/chat/flow'
import { type ArtifactPaneFileSelection, ArtifactPaneView } from '@renderer/components/chat/panes/ArtifactPane'
import {
  createResourcePaneCapability,
  RESOURCE_PANE_TAB,
  type ResourcePaneConfig,
  ResourcePaneLocateOpener,
  type RightPanelCapability,
  type RightPanelComponentProps,
  type RightPanelComposition,
  RightPanelHeaderControls,
  RightPanelProvider,
  RightPanelShortcut,
  RightPanelViewport,
  useRightPanelState
} from '@renderer/components/chat/panes/Shell'
import { useArtifactFileTreeModel } from '@renderer/components/chat/panes/useArtifactFileTreeModel'
import { useArtifactPanePreviewNavigation } from '@renderer/components/chat/panes/useArtifactPanePreviewNavigation'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import type { ComposerInputFilePreviewAction } from '@renderer/components/composer/filePreview'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { Activity, GitBranch } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import {
  createContext,
  lazy,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { useTranslation } from 'react-i18next'

const TopicBranchPanel = lazy(() => import('./TopicBranchPanel'))

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
  filePreviewSelection: ArtifactPaneFileSelection | null
  filesTitle: string
  resourcePane: ResourcePaneConfig | null
  traceTitle: string
}

interface TopicRightPaneFileState {
  previewFileSelection: ArtifactPaneFileSelection | null
  selectedFile: string | null
  fileTreeExpandedIds: ReadonlySet<string>
  fileTreeSearchKeyword: string
  workspacePath?: string
}

interface TopicRightPaneActions {
  previewInputFile: ComposerInputFilePreviewAction
  closeFilePreview: () => void
  setSelectedFile: (file: string | null) => void
  setFileTreeExpandedIds: (ids: ReadonlySet<string>) => void
  setFileTreeSearchKeyword: (keyword: string) => void
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
const TopicRightPaneFileStateContext = createContext<TopicRightPaneFileState | null>(null)
const TopicRightPaneActionsContext = createContext<TopicRightPaneActions | null>(null)

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

function useTopicRightPaneFileState(): TopicRightPaneFileState {
  const value = use(TopicRightPaneFileStateContext)
  if (!value) throw new Error('useTopicRightPaneFileState must be used within <TopicRightPane.Scope>')
  return value
}

function useTopicRightPaneActions(): TopicRightPaneActions {
  const value = use(TopicRightPaneActionsContext)
  if (!value) throw new Error('useTopicRightPaneActions must be used within <TopicRightPane.Scope>')
  return value
}

export function useOptionalTopicRightPaneActions(): TopicRightPaneActions | undefined {
  return use(TopicRightPaneActionsContext) ?? undefined
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
    <Suspense fallback={null}>
      <TopicBranchPanel
        open={active}
        topicId={scope.topicId}
        topicName={scope.topicName}
        liveState={branchLiveState}
        focusKey={canvasFocusKey}
        layoutReady={canvasLayoutReady}
        onLocateMessage={callbacks.onLocateMessage}
      />
    </Suspense>
  )
}

function TopicTraceRightPanel({ active, scope }: RightPanelComponentProps<TopicRightPanelScope>) {
  if (!active) return null
  return (
    <Suspense fallback={null}>
      <TracePane payload={{ topicId: scope.topicId ?? '', traceId: scope.traceId ?? '' }} />
    </Suspense>
  )
}

function TopicFilePreviewRightPanel({ active, scope }: RightPanelComponentProps<TopicRightPanelScope>) {
  const state = useTopicRightPaneFileState()
  const actions = useTopicRightPaneActions()
  const model = useArtifactFileTreeModel({
    workspacePath: state.workspacePath,
    treeOpen: active,
    expandedIds: state.fileTreeExpandedIds,
    searchKeyword: state.fileTreeSearchKeyword,
    enableFileSearch: true,
    selectedFile: state.selectedFile,
    onExpandedIdsChange: actions.setFileTreeExpandedIds
  })

  return (
    <ArtifactPaneView
      headerVariant="pane"
      paneTitle={scope.filesTitle}
      paneActions={<RightPanelHeaderControls canMaximize />}
      workspacePath={state.workspacePath}
      previewFileSelection={state.previewFileSelection}
      onPreviewClose={actions.closeFilePreview}
      enableFileSearch
      model={model}
      selectedFile={state.selectedFile}
      onSelectedFileChange={actions.setSelectedFile}
      searchKeyword={state.fileTreeSearchKeyword}
      onSearchKeywordChange={actions.setFileTreeSearchKeyword}
    />
  )
}

function TopicRightPaneActionsProvider({
  children,
  previewFileSelection,
  requestFileSelection,
  selectFile,
  setFileTreeExpandedIds,
  setFileTreeSearchKeyword,
  topicId
}: PropsWithChildren<{
  previewFileSelection: ArtifactPaneFileSelection | null
  requestFileSelection: (selection: ArtifactPaneFileSelection | null) => void
  selectFile: (file: string | null) => void
  setFileTreeExpandedIds: (ids: ReadonlySet<string>) => void
  setFileTreeSearchKeyword: (keyword: string) => void
  topicId?: string
}>) {
  const { clearReturnTarget, closeFilePreview, previewInputFile } = useArtifactPanePreviewNavigation({
    paneId: FILE_PREVIEW_PANE_ID,
    previewFileSelection,
    requestFileSelection,
    scopeKey: topicId
  })
  const setSelectedFile = useCallback(
    (file: string | null) => {
      clearReturnTarget()
      selectFile(file)
    },
    [clearReturnTarget, selectFile]
  )
  const actions = useMemo<TopicRightPaneActions>(
    () => ({
      previewInputFile,
      closeFilePreview,
      setSelectedFile,
      setFileTreeExpandedIds,
      setFileTreeSearchKeyword
    }),
    [closeFilePreview, previewInputFile, setFileTreeExpandedIds, setFileTreeSearchKeyword, setSelectedFile]
  )

  return <TopicRightPaneActionsContext value={actions}>{children}</TopicRightPaneActionsContext>
}

/** Stable capability declarations; catalog order is the fallback order. */
const TRACE_PANE_ID = 'trace'
const FILE_PREVIEW_PANE_ID = 'files'
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
    component: TopicFilePreviewRightPanel,
    resolve: (scope) => ({
      id: FILE_PREVIEW_PANE_ID,
      instanceKey: `topic:${scope.topicId ?? ''}:file-preview`,
      title: scope.filePreviewSelection?.displayName ?? scope.filesTitle,
      readiness: scope.filePreviewSelection ? 'ready' : 'unavailable',
      headerMode: 'content',
      canMaximize: true
    })
  },
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
  const [previewFileSelection, setPreviewFileSelection] = useState<ArtifactPaneFileSelection | null>(null)
  const [selectedFile, setSelectedFileState] = useState<string | null>(null)
  const [fileTreeExpandedIds, setFileTreeExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [fileTreeSearchKeyword, setFileTreeSearchKeyword] = useState('')
  const fileWorkspacePath = previewFileSelection?.workspacePath
  const requestFileSelection = useCallback((selection: ArtifactPaneFileSelection | null) => {
    setPreviewFileSelection(selection)
    setSelectedFileState(selection?.filePath ?? null)
  }, [])
  const closeFilePreview = useCallback(() => requestFileSelection(null), [requestFileSelection])
  const selectFile = useCallback(
    (file: string | null) => {
      requestFileSelection(
        file && fileWorkspacePath
          ? {
              workspacePath: fileWorkspacePath,
              filePath: file,
              previewType: 'file',
              readOnly: true
            }
          : null
      )
    },
    [fileWorkspacePath, requestFileSelection]
  )
  const fileState = useMemo<TopicRightPaneFileState>(
    () => ({
      previewFileSelection,
      selectedFile,
      fileTreeExpandedIds,
      fileTreeSearchKeyword,
      workspacePath: fileWorkspacePath
    }),
    [fileTreeExpandedIds, fileTreeSearchKeyword, fileWorkspacePath, previewFileSelection, selectedFile]
  )
  useEffect(() => {
    closeFilePreview()
    setFileTreeExpandedIds(new Set())
    setFileTreeSearchKeyword('')
  }, [closeFilePreview, topicId])
  const scope = useMemo<TopicRightPanelScope>(
    () => ({
      topicId,
      topicName,
      traceId,
      filePreviewSelection: previewFileSelection,
      resourcePane: resourcePane ?? null,
      developerMode: enableDeveloperMode,
      branchTitle: t('chat.message.flow.title'),
      filesTitle: t('common.preview'),
      traceTitle: t('trace.label')
    }),
    [enableDeveloperMode, previewFileSelection, resourcePane, t, topicId, topicName, traceId]
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
      <TopicRightPaneActionsProvider
        previewFileSelection={previewFileSelection}
        requestFileSelection={requestFileSelection}
        selectFile={selectFile}
        setFileTreeExpandedIds={setFileTreeExpandedIds}
        setFileTreeSearchKeyword={setFileTreeSearchKeyword}
        topicId={topicId}>
        <TopicRightPaneFileStateContext value={fileState}>
          <TopicBranchLiveStateStoreContext value={storeRef.current}>{children}</TopicBranchLiveStateStoreContext>
        </TopicRightPaneFileStateContext>
      </TopicRightPaneActionsProvider>
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
