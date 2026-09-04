import { Checkbox, ConfirmDialog } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import { ChatLayoutModeProvider } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import {
  type ResourcePaneConfig,
  ResourcePaneCountButton,
  type ResourcePaneCountButtonProps
} from '@renderer/components/chat/panes/Shell'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import ConversationCenterState from '@renderer/components/chat/shell/ConversationCenterState'
import { ConversationGreeting } from '@renderer/components/chat/shell/ConversationGreeting'
import ConversationShell from '@renderer/components/chat/shell/ConversationShell'
import ConversationStageCenter from '@renderer/components/chat/shell/ConversationStageCenter'
import { useConversationTopBarPortalLayout } from '@renderer/components/chat/shell/ConversationTopBarPortal'
import type { ChatPanePosition } from '@renderer/components/chat/shell/paneLayout'
import ConversationComposerSlot from '@renderer/components/composer/ConversationComposerSlot'
import {
  AgentConversationControls,
  type AgentConversationControlsProps
} from '@renderer/components/composer/variants/agent/AgentConversationControls'
import {
  type AgentComposerLaunchOptions,
  MissingAgentHomeComposer
} from '@renderer/components/composer/variants/AgentComposer'
import DiagnosticUploadDialog from '@renderer/components/feedback/DiagnosticUploadDialog'
import { useCache, useSharedCache } from '@renderer/data/hooks/useCache'
import { useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentModelDisabled, useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { useAgentWorkspaceWarning } from '@renderer/hooks/agent/useAgentWorkspaceWarning'
import { useUpdateSession } from '@renderer/hooks/agent/useSession'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { GetAgentResponse } from '@renderer/types/agent'
import type { ConversationCenterSlot, PaneManualToggleSignal } from '@renderer/types/conversationLayout'
import type { Citation } from '@renderer/types/message'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { cn } from '@renderer/utils/style'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChatMain from './AgentChatMain'
import AgentComposerSlot from './AgentComposerSlot'
import { AgentChatNavbar } from './components/AgentChatNavbar'
import { type AgentFileNavigationRequest, AgentRightPane, AgentTaskProgressCapsule } from './components/AgentRightPane'
import { ApiGatewayRequiredDialog } from './components/ApiGatewayRequiredDialog'
import { locateAgentMessageInList } from './messages/agentMessageListAdapter'
import type { CreateAgentSessionDefaults } from './types'
import { type AgentChatRuntimeState, useAgentChatRuntimeState } from './useAgentChatRuntimeState'
import type { AgentConversationBootstrap } from './useAgentConversationBootstrap'

const EMPTY_MESSAGES: CherryUIMessage[] = []
const EMPTY_PARTS: Record<string, CherryMessagePart[]> = {}

interface ModelSwitchTarget {
  agentId: string
  model: Model
}

interface CitationPanelState {
  sessionId: string
  citations: Citation[]
}

interface DiagnosticReportDraft {
  sessionId: string
  description: string
}

function getNewSessionWorkspaceDefaults(
  session: AgentSessionEntity
): Pick<CreateAgentSessionDefaults, 'workspaceId' | 'workspaceMode'> {
  if (session.workspace?.type === 'system') {
    return { workspaceMode: 'system' }
  }
  return session.workspaceId ? { workspaceId: session.workspaceId } : {}
}

type AgentTopBarControlsProps = Omit<AgentConversationControlsProps, 'iconOnly' | 'side'>

function AgentTopBarControls(props: AgentTopBarControlsProps) {
  const { iconOnly } = useConversationTopBarPortalLayout()

  return <AgentConversationControls {...props} side="bottom" iconOnly={iconOnly} />
}

interface AgentChatProps {
  centerSurface?: ConversationCenterSlot | null
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  conversationBootstrap: AgentConversationBootstrap
  showResourceListControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  onPaneCollapse?: () => void
  onPaneAutoCollapseChange?: (collapsed: boolean) => void
  onFileNavigationRequestChange?: (request: AgentFileNavigationRequest | null) => void
  requestFileNavigation?: AgentFileNavigationRequest
  paneManualToggle?: PaneManualToggleSignal
  missingAgentSelection?: boolean
  onCreateEmptySession?: (defaults?: CreateAgentSessionDefaults) => void | Promise<unknown>
  onMissingAgentSelectionAgentChange?: (agentId: string | null) => void | Promise<void>
  onSessionWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  onVisibleAgentChange?: (agentId: string) => void
  onVisibleWorkspaceChange?: (workspaceId: string) => void
  selectingMissingAgent?: boolean
  replacingSessionWorkspace?: boolean
  resourcePane?: ResourcePaneConfig | null
  resourcePaneCount?: ResourcePaneCountButtonProps
  resourcePaneRevealRequest?: ResourceListRevealRequest
  sessionPaneOpen?: boolean
  onSessionPaneOpenChange?: (open: boolean) => void
  sessionPaneUserOpenIntentSeq?: number
  composerLaunchOptions?: AgentComposerLaunchOptions
}

interface AgentChatLayoutProps {
  activeAgent?: GetAgentResponse
  /** Active model — the right pane needs it for the context-usage denominator. */
  model?: Model
  center?: ReactNode
  centerClassName?: string
  centerSurface?: ConversationCenterSlot | null
  className?: string
  conversationState: 'pending' | 'ready' | 'unavailable'
  messages: CherryUIMessage[]
  onPaneAutoCollapseChange?: (collapsed: boolean) => void
  onPaneCollapse?: () => void
  onFileNavigationRequestChange?: (request: AgentFileNavigationRequest | null) => void
  pane?: ReactNode
  paneManualToggle?: PaneManualToggleSignal
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  partsByMessageId: Record<string, CherryMessagePart[]>
  resourcePane?: ResourcePaneConfig | null
  resourcePaneRevealRequest?: ResourceListRevealRequest
  rightPanelDefaultOpen?: boolean
  onRightPanelOpenChange?: (open: boolean) => void
  rightPanelUserOpenIntentSeq?: number
  sessionSnapshot: AgentSessionEntity | null
  sidePanel?: ReactNode
  topBar?: ReactNode
  topRightTool?: ReactNode
}

const AgentChat = ({
  centerSurface,
  pane,
  paneOpen,
  panePosition,
  conversationBootstrap,
  showResourceListControls = true,
  sidebarOpen,
  onSidebarToggle,
  locateMessageId,
  onLocateMessageHandled,
  onPaneCollapse,
  onPaneAutoCollapseChange,
  onFileNavigationRequestChange,
  requestFileNavigation,
  paneManualToggle,
  missingAgentSelection = false,
  onCreateEmptySession,
  onMissingAgentSelectionAgentChange,
  onSessionWorkspaceChange,
  onVisibleAgentChange,
  onVisibleWorkspaceChange,
  selectingMissingAgent,
  replacingSessionWorkspace,
  resourcePane,
  resourcePaneCount,
  resourcePaneRevealRequest,
  sessionPaneOpen,
  onSessionPaneOpenChange,
  sessionPaneUserOpenIntentSeq,
  composerLaunchOptions
}: AgentChatProps) => {
  const { t } = useTranslation()
  const [messageStyle] = usePreference('chat.message.style')
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')
  const [skipModelSwitchConfirmationsForAppRun, setSkipModelSwitchConfirmationsForAppRun] = useSharedCache(
    'agent.model_switch_confirmation.skipped'
  )
  const currentSessionId = conversationBootstrap.session?.id
  const [citationPanelState, setCitationPanelState] = useState<CitationPanelState | null>(null)
  const [modelSwitchTarget, setModelSwitchTarget] = useState<ModelSwitchTarget>()
  const [modelSwitchConfirmOpen, setModelSwitchConfirmOpen] = useState(false)
  const [skipModelSwitchConfirmation, setSkipModelSwitchConfirmation] = useState(false)
  const [diagnosticReportDraft, setDiagnosticReportDraft] = useState<DiagnosticReportDraft | null>(null)
  const [sessionAgentChanging, setSessionAgentChanging] = useState(false)

  const sessionSnapshot = conversationBootstrap.session
  const visibleAgentId = sessionSnapshot?.agentId ?? null
  const visibleWorkspaceId = sessionSnapshot?.workspaceId ?? null
  const visibleWorkspace = sessionSnapshot?.workspace ?? null
  const activeAgent = conversationBootstrap.resources.agent
  const isSupportAgent = activeAgent?.configuration?.builtin_role === BUILTIN_AGENT_ROLE.SUPPORT
  const isActiveAgentLoading = conversationBootstrap.resources.agentLoading
  const activeModel = conversationBootstrap.resources.model
  const isActiveModelLoading = conversationBootstrap.resources.modelLoading
  const { updateModel } = useUpdateAgent()
  const { updateSession } = useUpdateSession()
  const agentModelFilter = useAgentModelFilter(activeAgent?.type)
  const isModelDisabled = useAgentModelDisabled()
  const workspacePath = visibleWorkspace?.type === 'user' ? visibleWorkspace.path : undefined
  const workspaceWarning = useAgentWorkspaceWarning(workspacePath)
  const citationPanelCitations =
    citationPanelState && citationPanelState.sessionId === currentSessionId ? citationPanelState.citations : null
  const activeDiagnosticReportDraft =
    diagnosticReportDraft?.sessionId === currentSessionId ? diagnosticReportDraft : null

  useEffect(() => {
    if (visibleAgentId) onVisibleAgentChange?.(visibleAgentId)
  }, [onVisibleAgentChange, visibleAgentId])
  useEffect(() => {
    if (visibleWorkspaceId && visibleWorkspace?.type !== 'system') onVisibleWorkspaceChange?.(visibleWorkspaceId)
  }, [onVisibleWorkspaceChange, visibleWorkspace, visibleWorkspaceId])
  useEffect(() => {
    setCitationPanelState(null)
  }, [currentSessionId])
  useEffect(() => {
    setDiagnosticReportDraft((current) => (current?.sessionId === currentSessionId ? current : null))
  }, [currentSessionId])

  const handleOpenCitationsPanel = useCallback(
    ({ citations }: { citations: Citation[] }) => {
      if (!currentSessionId) return
      setCitationPanelState({ sessionId: currentSessionId, citations })
    },
    [currentSessionId]
  )

  const isInitializing = !sessionSnapshot && conversationBootstrap.sessionLoading
  const citationsPanelOpen = citationPanelCitations !== null
  const conversationState = sessionSnapshot ? 'ready' : isInitializing ? 'pending' : 'unavailable'
  const sessionAgentId = sessionSnapshot?.agentId ?? null
  const sendableAgentId = activeAgent && sessionAgentId ? sessionAgentId : undefined
  const composerAgentId = isActiveAgentLoading ? (sessionAgentId ?? undefined) : sendableAgentId
  const shouldFetchSessionHistoryOnMount = Boolean(
    sessionSnapshot &&
      (conversationBootstrap.sessionSource === 'query' ||
        conversationBootstrap.sessionSource === 'pending' ||
        conversationBootstrap.sessionSource === 'none')
  )
  const sessionMessagesEnabled = Boolean(sessionSnapshot)
  const runtime = useAgentChatRuntimeState({
    sessionId: sessionSnapshot?.id ?? '',
    sessionMessagesEnabled,
    sessionHistoryFetchOnMount: shouldFetchSessionHistoryOnMount,
    reservedMessages: EMPTY_MESSAGES
  })
  const {
    hasOlder: runtimeHasOlder,
    isLoading: runtimeIsLoading,
    loadOlder: runtimeLoadOlder,
    sessionId: runtimeSessionId,
    uiMessages: runtimeUiMessages
  } = runtime
  const openDiagnosticReport = useCallback(
    (description = '') => {
      if (!currentSessionId) return
      setDiagnosticReportDraft({ sessionId: currentSessionId, description })
    },
    [currentSessionId]
  )
  const isEmptyConversation = Boolean(
    sessionSnapshot &&
      sessionMessagesEnabled &&
      !runtime.isLoading &&
      !runtime.isPending &&
      !runtime.hasOlder &&
      runtime.uiMessages.length === 0
  )
  const canChangeWorkspace = Boolean(onSessionWorkspaceChange && isEmptyConversation)
  const runAfterFileNavigation = useCallback(
    (transition: () => void) => {
      if (requestFileNavigation) {
        requestFileNavigation(transition)
        return
      }
      transition()
    },
    [requestFileNavigation]
  )
  const handleSessionAgentChange = useCallback(
    async (nextAgentId: string | null) => {
      if (sessionAgentChanging || !sessionSnapshot || !nextAgentId || nextAgentId === sessionSnapshot.agentId) return
      setSessionAgentChanging(true)
      try {
        await updateSession({ id: sessionSnapshot.id, agentId: nextAgentId }, { showSuccessToast: false })
      } finally {
        setSessionAgentChanging(false)
      }
    },
    [sessionAgentChanging, sessionSnapshot, updateSession]
  )
  const handleAgentModelChange = useCallback(
    async (nextModel?: Model) => {
      if (!activeAgent || !nextModel || nextModel.id === activeModel?.id) return
      if (!isEmptyConversation && !skipModelSwitchConfirmationsForAppRun) {
        setModelSwitchTarget({ agentId: activeAgent.id, model: nextModel })
        setSkipModelSwitchConfirmation(false)
        setModelSwitchConfirmOpen(true)
        return
      }
      await updateModel({ agentId: activeAgent.id, modelId: nextModel.id }, { showSuccessToast: false })
    },
    [activeAgent, activeModel?.id, isEmptyConversation, skipModelSwitchConfirmationsForAppRun, updateModel]
  )
  const handleSessionWorkspaceChange = useCallback(
    (workspaceId: string | null) => {
      runAfterFileNavigation(() => {
        void onSessionWorkspaceChange?.(workspaceId)
      })
    },
    [onSessionWorkspaceChange, runAfterFileNavigation]
  )
  const handleCreateEmptySession = useCallback(() => {
    if (!sessionSnapshot || !onCreateEmptySession) return
    const transition = () => {
      void onCreateEmptySession({
        agentId: sessionSnapshot.agentId,
        ...getNewSessionWorkspaceDefaults(sessionSnapshot)
      })
    }
    if (sessionSnapshot.workspaceId && sessionSnapshot.workspace?.type !== 'system') {
      transition()
      return
    }
    runAfterFileNavigation(transition)
  }, [onCreateEmptySession, runAfterFileNavigation, sessionSnapshot])
  const handleRestoreComposerFocus = useCallback(() => {
    if (!runtime.sessionId) return
    void EventEmitter.emit(EVENT_NAMES.FOCUS_CHAT_COMPOSER, {
      topicId: buildAgentSessionTopicId(runtime.sessionId)
    })
  }, [runtime.sessionId])
  const locateLoadRequestRef = useRef<string | undefined>(undefined)
  const sessionTopicId = runtimeSessionId ? buildAgentSessionTopicId(runtimeSessionId) : ''

  useEffect(() => {
    if (!runtimeSessionId || !locateMessageId) {
      locateLoadRequestRef.current = undefined
      return
    }

    if (runtimeUiMessages.some((message) => message.id === locateMessageId)) {
      locateLoadRequestRef.current = undefined
      window.requestAnimationFrame(() => {
        locateAgentMessageInList(sessionTopicId, locateMessageId, true)
      })
      onLocateMessageHandled?.()
      return
    }

    if (runtimeHasOlder && !runtimeIsLoading) {
      const requestKey = `${runtimeSessionId}:${locateMessageId}:${runtimeUiMessages.length}`
      if (locateLoadRequestRef.current !== requestKey) {
        locateLoadRequestRef.current = requestKey
        runtimeLoadOlder?.()
      }
      return
    }

    if (!runtimeHasOlder && !runtimeIsLoading) {
      locateLoadRequestRef.current = undefined
      onLocateMessageHandled?.()
    }
  }, [
    locateMessageId,
    onLocateMessageHandled,
    runtimeHasOlder,
    runtimeIsLoading,
    runtimeLoadOlder,
    runtimeSessionId,
    runtimeUiMessages,
    sessionTopicId
  ])
  const rightPaneTools =
    !centerSurface && (sessionSnapshot || resourcePane) ? (
      <>
        {resourcePaneCount && <ResourcePaneCountButton {...resourcePaneCount} />}
        <AgentRightPane.Shortcuts />
      </>
    ) : undefined
  let topBar: ReactNode
  let center: ReactNode
  let sidePanel: ReactNode
  let centerClassName = centerSurface?.className

  if (centerSurface) {
    center = centerSurface.content
  } else if (isInitializing) {
    topBar = (
      <AgentChatNavbar
        activeAgent={null}
        showSidebarControls={showResourceListControls}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={onSidebarToggle}
      />
    )
    center = <ConversationCenterState state="loading" />
  } else if (!sessionSnapshot && missingAgentSelection) {
    const composer = !isMultiSelectMode ? (
      <ConversationComposerSlot
        fallback={
          <MissingAgentHomeComposer
            onAgentChange={onMissingAgentSelectionAgentChange}
            agentChanging={selectingMissingAgent}
          />
        }
      />
    ) : undefined
    topBar = (
      <AgentChatNavbar
        activeAgent={null}
        showSidebarControls={showResourceListControls}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={onSidebarToggle}
      />
    )
    center = <ConversationStageCenter placement="docked" main={null} composer={composer} />
  } else if (!sessionSnapshot) {
    topBar = (
      <AgentChatNavbar
        activeAgent={null}
        showSidebarControls={showResourceListControls}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={onSidebarToggle}
      />
    )
    center = <ConversationCenterState state="empty" />
  } else {
    topBar = (
      <AgentChatNavbar
        className="min-w-0"
        activeAgent={activeAgent ?? null}
        conversationControls={
          activeAgent ? (
            <AgentTopBarControls
              agent={activeAgent}
              model={activeModel}
              workspace={sessionSnapshot.workspace}
              workspaceId={sessionSnapshot.workspace?.type === 'system' ? null : sessionSnapshot.workspaceId}
              workspaceChanging={replacingSessionWorkspace}
              workspaceWarning={workspaceWarning}
              selectAgentLabel={t('chat.alerts.select_agent')}
              selectModelLabel={t('button.select_model')}
              selectWorkspaceLabel={t('agent.session.workspace_selector.placeholder')}
              shouldAutoSelectCreatedAgent
              agentTriggerMode={isEmptyConversation ? 'selector' : 'edit'}
              canChangeModel
              onAgentChange={handleSessionAgentChange}
              onModelSelect={handleAgentModelChange}
              onWorkspaceChange={canChangeWorkspace ? handleSessionWorkspaceChange : undefined}
              modelFilter={agentModelFilter}
              isModelDisabled={isModelDisabled}
              onAgentDialogCloseAutoFocus={handleRestoreComposerFocus}
            />
          ) : undefined
        }
        showSidebarControls={showResourceListControls}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={onSidebarToggle}
      />
    )
    sidePanel = (
      <CitationsPanel
        open={citationsPanelOpen}
        onClose={() => setCitationPanelState(null)}
        citations={citationPanelCitations ?? []}
      />
    )
    centerClassName = 'transform-[translateZ(0)] relative justify-between'
    center = (
      <AgentChatSessionCenter
        key={sessionSnapshot.id}
        session={sessionSnapshot}
        runtime={runtime}
        homeWelcomeText={t('agent.home.welcome_title')}
        agentId={composerAgentId}
        composerPending={isActiveAgentLoading || isActiveModelLoading}
        activeAgent={activeAgent}
        activeModel={activeModel}
        workspaceWarning={workspaceWarning}
        isEmptyConversation={isEmptyConversation}
        isMultiSelectMode={isMultiSelectMode}
        sessionMessagesEnabled={sessionMessagesEnabled}
        onAgentChange={handleSessionAgentChange}
        agentChanging={sessionAgentChanging}
        onOpenCitationsPanel={handleOpenCitationsPanel}
        onCreateEmptySession={sessionAgentId && onCreateEmptySession ? handleCreateEmptySession : undefined}
        composerLaunchOptions={composerLaunchOptions}
        openDiagnosticReport={isSupportAgent ? openDiagnosticReport : undefined}
      />
    )
  }

  const layoutProps: AgentChatLayoutProps = {
    activeAgent,
    model: activeModel,
    center,
    centerClassName,
    centerSurface,
    className: cn(messageStyle, {
      'multi-select-mode': Boolean(!centerSurface && sessionSnapshot && isMultiSelectMode)
    }),
    conversationState,
    messages: sessionSnapshot ? runtime.uiMessages : EMPTY_MESSAGES,
    onFileNavigationRequestChange,
    onPaneAutoCollapseChange,
    onPaneCollapse,
    pane,
    paneOpen,
    panePosition,
    partsByMessageId: sessionSnapshot ? runtime.partsByMessageId : EMPTY_PARTS,
    resourcePane,
    resourcePaneRevealRequest,
    rightPanelDefaultOpen: sessionPaneOpen,
    onRightPanelOpenChange: onSessionPaneOpenChange,
    rightPanelUserOpenIntentSeq: sessionPaneUserOpenIntentSeq,
    paneManualToggle,
    sessionSnapshot,
    sidePanel,
    topBar,
    topRightTool: rightPaneTools
  }

  return (
    <>
      <AgentChatLayout {...layoutProps} />
      {isSupportAgent && activeDiagnosticReportDraft ? (
        <DiagnosticUploadDialog
          key={activeDiagnosticReportDraft.sessionId}
          initialDescription={activeDiagnosticReportDraft.description}
          open
          onOpenChange={(nextOpen) => {
            if (nextOpen) return
            setDiagnosticReportDraft((current) =>
              current?.sessionId === activeDiagnosticReportDraft.sessionId ? null : current
            )
          }}
        />
      ) : null}
      <ConfirmDialog
        open={modelSwitchConfirmOpen}
        onOpenChange={setModelSwitchConfirmOpen}
        title={t('agent.session.model_switch_confirm.title', { model: modelSwitchTarget?.model.name ?? '' })}
        description={t('agent.session.model_switch_confirm.description')}
        content={
          <div className="flex items-center gap-2">
            <Checkbox
              id="skip-model-switch-confirmation"
              size="sm"
              checked={skipModelSwitchConfirmation}
              onCheckedChange={(checked) => setSkipModelSwitchConfirmation(checked === true)}
            />
            <label
              htmlFor="skip-model-switch-confirmation"
              className="cursor-pointer text-foreground text-sm leading-none">
              {t('agent.session.model_switch_confirm.skip_for_app_run')}
            </label>
          </div>
        }
        confirmText={t('agent.session.model_switch_confirm.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={async () => {
          if (
            !activeAgent ||
            !modelSwitchTarget ||
            modelSwitchTarget.agentId !== activeAgent.id ||
            modelSwitchTarget.model.id === activeModel?.id
          ) {
            return
          }
          const updatedAgent = await updateModel(
            { agentId: activeAgent.id, modelId: modelSwitchTarget.model.id },
            { showSuccessToast: false }
          )
          if (updatedAgent && skipModelSwitchConfirmation) {
            setSkipModelSwitchConfirmationsForAppRun(true)
          }
        }}
      />
    </>
  )
}

interface AgentChatSessionCenterProps {
  session: AgentSessionEntity
  runtime: AgentChatRuntimeState
  homeWelcomeText?: string
  agentId?: string
  composerPending: boolean
  activeAgent: GetAgentResponse | undefined
  activeModel?: Model
  workspaceWarning?: string
  isEmptyConversation: boolean
  isMultiSelectMode: boolean
  sessionMessagesEnabled: boolean
  onAgentChange?: (agentId: string | null) => void | Promise<void>
  agentChanging?: boolean
  onOpenCitationsPanel: (payload: { citations: Citation[] }) => void
  onCreateEmptySession?: () => void | Promise<unknown>
  composerLaunchOptions?: AgentComposerLaunchOptions
  openDiagnosticReport?: (description?: string) => void
}

const AgentChatSessionCenter = ({
  session,
  runtime,
  homeWelcomeText,
  agentId,
  composerPending,
  activeAgent,
  activeModel,
  workspaceWarning,
  isEmptyConversation,
  isMultiSelectMode,
  sessionMessagesEnabled,
  onAgentChange,
  agentChanging,
  onOpenCitationsPanel,
  onCreateEmptySession,
  composerLaunchOptions,
  openDiagnosticReport
}: AgentChatSessionCenterProps) => {
  const composer = (
    <div className="flex w-full flex-col">
      {!isMultiSelectMode && <AgentTaskProgressCapsule />}
      <AgentComposerSlot
        agentId={agentId}
        activeAgent={activeAgent}
        activeModel={activeModel}
        workspaceWarning={workspaceWarning}
        isMultiSelectMode={isMultiSelectMode}
        session={session}
        sessionId={runtime.sessionId}
        sendMessage={runtime.sendMessage}
        stop={runtime.stop}
        isStreaming={runtime.isPending}
        sendDisabled={composerPending}
        onAgentChange={onAgentChange}
        agentChanging={agentChanging}
        onCreateEmptySession={onCreateEmptySession}
        composerContext={runtime.composerContext}
        composerLaunchOptions={composerLaunchOptions}
      />
    </div>
  )
  const messageList = (
    <AgentChatMain
      placement="docked"
      sessionMessagesEnabled={sessionMessagesEnabled}
      agentId={agentId}
      sessionId={runtime.sessionId}
      messages={runtime.uiMessages}
      activeAgent={activeAgent}
      partsByMessageId={runtime.partsByMessageId}
      streamingLayers={runtime.streamingLayers}
      optimisticAskUserQuestionInputsByToolCallId={runtime.optimisticAskUserQuestionInputsByToolCallId}
      isLoading={runtime.isLoading}
      hasOlder={runtime.hasOlder}
      loadOlder={runtime.loadOlder}
      onOpenCitationsPanel={onOpenCitationsPanel}
      openDiagnosticReport={openDiagnosticReport}
      deleteMessage={runtime.deleteMessage}
      respondToolApproval={runtime.respondToolApproval}
    />
  )
  const main = (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {isEmptyConversation && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <ConversationGreeting
            avatar={activeAgent ? getAgentAvatarFromConfiguration(activeAgent.configuration) : undefined}
            title={homeWelcomeText ?? ''}
          />
        </div>
      )}
      {messageList}
      <ApiGatewayRequiredDialog sessionId={runtime.sessionId} />
    </div>
  )

  return <ConversationStageCenter placement="docked" main={main} composer={composer} />
}

function AgentChatLayout({
  activeAgent,
  model,
  center,
  centerClassName,
  centerSurface,
  className,
  conversationState,
  messages,
  onFileNavigationRequestChange,
  onPaneAutoCollapseChange,
  onPaneCollapse,
  pane,
  paneOpen,
  panePosition,
  partsByMessageId,
  resourcePane,
  resourcePaneRevealRequest,
  rightPanelDefaultOpen,
  onRightPanelOpenChange,
  rightPanelUserOpenIntentSeq,
  paneManualToggle,
  sessionSnapshot,
  sidePanel,
  topBar,
  topRightTool
}: AgentChatLayoutProps) {
  return (
    <AgentRightPane.Scope
      model={model}
      conversationState={conversationState}
      workspaceId={sessionSnapshot?.workspaceId}
      workspacePath={sessionSnapshot?.workspace?.path}
      workspaceType={sessionSnapshot?.workspace?.type}
      messages={messages}
      partsByMessageId={partsByMessageId}
      resourcePane={resourcePane}
      defaultOpen={rightPanelDefaultOpen}
      onOpenChange={onRightPanelOpenChange}
      onFileNavigationRequestChange={onFileNavigationRequestChange}
      userOpenIntentSeq={rightPanelUserOpenIntentSeq}
      sessionId={sessionSnapshot?.id}
      sessionName={sessionSnapshot?.name}
      traceId={sessionSnapshot?.traceId ?? undefined}
      agentId={sessionSnapshot?.agentId ?? undefined}
      agentName={activeAgent?.name}
      agentAvatar={activeAgent ? getAgentAvatarFromConfiguration(activeAgent.configuration) : undefined}
      present={!centerSurface}
      revealRequest={resourcePaneRevealRequest}>
      <ConversationShell
        className={className}
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        onPaneCollapse={onPaneCollapse}
        onPaneAutoCollapseChange={onPaneAutoCollapseChange}
        paneManualToggle={paneManualToggle}
        topBar={topBar}
        topRightTool={topRightTool}
        showTopRightToolWhenPaneOpen
        center={
          // The layout-mode provider links the message column and the composer so
          // both yield the same anchor-rail gutter and stay aligned.
          <ChatLayoutModeProvider>{center}</ChatLayoutModeProvider>
        }
        sidePanel={sidePanel}
        rightPane={<AgentRightPane.Viewport />}
        centerId={centerSurface?.id}
        centerRef={centerSurface?.ref}
        centerClassName={centerClassName}
      />
    </AgentRightPane.Scope>
  )
}

export default AgentChat
