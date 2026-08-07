import { Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { AgentContextUsageSummary } from '@renderer/components/chat/agent/AgentContextUsageSummary'
import { ContextUsageMeter } from '@renderer/components/chat/contextUsage'
import { useChatLayoutMode } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import {
  ConversationTopBarPortal,
  useConversationTopBarPortalLayout
} from '@renderer/components/chat/shell/ConversationTopBarPortal'
import ComposerSurface, { type ComposerSurfaceActions } from '@renderer/components/composer/ComposerSurface'
import {
  ComposerPinnedToolsProvider,
  ComposerToolDerivedStateProvider,
  ComposerToolRuntimeHost,
  ComposerToolRuntimeProvider,
  useComposerTokenReconcile,
  useComposerToolDispatch,
  useComposerToolLauncherActions,
  useComposerToolLauncherVersion,
  useComposerToolState
} from '@renderer/components/composer/ComposerToolRuntime'
import { ComposerPanelSymbol, getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { getComposerToolConfig } from '@renderer/components/composer/tools/registry'
import type { ToolContext } from '@renderer/components/composer/tools/types'
import NewConversationIcon from '@renderer/components/icons/NewConversationIcon'
import { McpLogo } from '@renderer/components/icons/SvgIcon'
import {
  type QuickPanelInputAdapter,
  type QuickPanelListItem,
  useOptionalQuickPanel
} from '@renderer/components/QuickPanel'
import { openResourceEditDialog, ResourceEditDialogEventHost } from '@renderer/components/resourceCatalog/dialogs/edit'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { useAgentSessionCompaction } from '@renderer/hooks/agent/useAgentSessionCompaction'
import { useAgentSessionContextUsage } from '@renderer/hooks/agent/useAgentSessionContextUsage'
import { useAgentSessionSlashCommands } from '@renderer/hooks/agent/useAgentSessionSlashCommands'
import { useUpdateSession } from '@renderer/hooks/agent/useSession'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useAvailableSkills } from '@renderer/hooks/useSkills'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { toast } from '@renderer/services/toast'
import type { ThinkingOption } from '@renderer/types/reasoning'
import { TopicType } from '@renderer/types/topic'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { buildFilePartsForAttachments, withComposerFilePartMeta } from '@renderer/utils/file/buildFileParts'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { resolveReasoningEffortForModel } from '@renderer/utils/model'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import type { AgentEntity } from '@shared/data/types/agent'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { FileUIPart } from '@shared/data/types/message'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import { getKnowledgeBaseIdsFromParts, withKnowledgeScopePart } from '@shared/data/types/uiParts'
import type { OutputFor } from '@shared/ipc/types'
import type { LocalSkill } from '@shared/types/skill'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { type CanonicalFilePath, canonicalizeFilePath, createFilePathHandle, toFileUrl } from '@shared/utils/file'
import { Settings2, Terminal, ToolCase } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { InputHistoryDirection } from '../inputHistoryNavigation'
import { QueuedFollowupsDock } from '../QueuedFollowupsDock'
import type { ComposerDraftToken, ComposerSerializedDraft, ComposerSerializedToken } from '../tokens'
import { type FollowupQueueItem, useFollowupQueue } from '../useFollowupQueue'
import { useInputHistory } from '../useInputHistory'
import { isPathWithinAccessiblePath } from './agent/accessiblePath'
import {
  AgentConversationControls,
  type AgentConversationControlsProps,
  type AgentConversationWorkspace
} from './agent/AgentConversationControls'
import {
  type AgentComposerDraftCache,
  getAgentDraftCacheKey,
  getAgentDraftTokens,
  getCachedSkillTokens,
  getSkillFromCachedToken,
  hasAgentDraftCache,
  readAgentDraftCache,
  writeAgentDraftCache
} from './agent/agentDraftCache'
import { useAgentResourceMentionSource } from './agent/useAgentResourceMentionSource'
import {
  agentComposerTokenId,
  agentFileToComposerToken,
  agentKnowledgeBaseToComposerToken,
  agentSkillToComposerToken,
  getAgentComposerTokenIds
} from './agentComposerTokens'
import {
  COMPOSER_TOOLBAR_CLASS,
  ComposerBelowControls,
  ComposerToolbarControls,
  ComposerToolMenuControls
} from './shared/ComposerControlScaffolding'
import { emptyActions, type ProviderActionHandlers } from './shared/composerProviderActions'
import { buildComposerQueuedPayload, getComposerHistoryText } from './shared/composerQueuedPayload'
import { useComposerQuoteInsertion } from './shared/composerQuote'
import { ComposerSpeedControl, resolveComposerReasoningEffort } from './shared/ComposerSpeedControl'
import { type ComposerToolbarCustomTool, ComposerToolbarShortcuts } from './shared/ComposerToolbarShortcuts'
import { useComposerFileCapabilities } from './shared/useComposerFileCapabilities'
import { useComposerKnowledgeBaseScope } from './shared/useComposerKnowledgeBaseScope'
import { useComposerToolbarPinnedTools } from './shared/useComposerToolbarPinnedTools'
import { useEntityReferenceMentionItems } from './shared/useEntityReferenceMentionSource'
import { useLatest } from './shared/useLatest'

const logger = loggerService.withContext('AgentComposer')

const AGENT_MANAGED_TOKEN_KINDS = [
  'file',
  'knowledge',
  'skill'
] as const satisfies readonly ComposerDraftToken['kind'][]
const AGENT_SKILLS_LAUNCHER_ID = 'agent-skills'
const AGENT_NEW_SESSION_TOOL_ID = 'composer:new-session'
const EMPTY_ACCESSIBLE_PATHS: readonly string[] = []
const FILE_IPC_BATCH_SIZE = 500

type AccessibleAttachment = {
  attachment: ComposerAttachment
  filePath: CanonicalFilePath
  index: number
}

const requestAccessiblePathMetadata = async (
  attachments: readonly AccessibleAttachment[]
): Promise<OutputFor<'file.batch_get_metadata'>> => {
  if (attachments.length === 0) return {}

  const chunks: AccessibleAttachment[][] = []
  for (let i = 0; i < attachments.length; i += FILE_IPC_BATCH_SIZE) {
    chunks.push(attachments.slice(i, i + FILE_IPC_BATCH_SIZE))
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      ipcApi.request('file.batch_get_metadata', {
        items: chunk.map(({ filePath }) => ({
          key: filePath,
          handle: createFilePathHandle(filePath)
        }))
      })
    )
  )

  return Object.assign({}, ...results)
}

const buildAccessiblePathFilePart = (
  attachment: ComposerAttachment,
  filePath: CanonicalFilePath,
  metadataByPath: OutputFor<'file.batch_get_metadata'>
): FileUIPart => {
  const metadata = metadataByPath[filePath]
  if (!metadata || metadata.kind !== 'file') {
    throw new Error(`Agent workspace reference is not a file: ${attachment.path}`)
  }

  return withComposerFilePartMeta(
    {
      type: 'file',
      url: toFileUrl(filePath),
      mediaType: metadata.mime,
      filename: attachment.origin_name || attachment.name
    },
    attachment
  )
}

const buildAgentFilePartsForAttachments = async (
  attachments: ComposerAttachment[],
  accessiblePaths: readonly string[]
): Promise<FileUIPart[]> => {
  const accessibleAttachments: AccessibleAttachment[] = []
  const internalizedAttachments: ComposerAttachment[] = []
  const internalizedIndexes: number[] = []

  attachments.forEach((attachment, index) => {
    // A path-less attachment (message-editing round-trip) cannot be matched
    // against the workspace, so it takes the internalized branch — the same
    // outcome it already had when its non-path value failed the match.
    if (attachment.path && isPathWithinAccessiblePath(attachment.path, accessiblePaths)) {
      accessibleAttachments.push({
        attachment,
        filePath: canonicalizeFilePath(attachment.path),
        index
      })
      return
    }

    internalizedAttachments.push(attachment)
    internalizedIndexes.push(index)
  })

  const [metadataByPath, internalizedFileParts] = await Promise.all([
    requestAccessiblePathMetadata(accessibleAttachments),
    buildFilePartsForAttachments(internalizedAttachments)
  ])

  const fileParts = new Array<FileUIPart>(attachments.length)

  accessibleAttachments.forEach(({ attachment, filePath, index }) => {
    fileParts[index] = buildAccessiblePathFilePart(attachment, filePath, metadataByPath)
  })

  internalizedFileParts.forEach((filePart, offset) => {
    const originalIndex = internalizedIndexes[offset]
    if (originalIndex === undefined || !filePart) {
      throw new Error(`Failed to build file part for attachment: ${internalizedAttachments[offset]?.path ?? ''}`)
    }
    fileParts[originalIndex] = filePart
  })

  return fileParts
}

const createSkillQuickPanelItems = (
  skills: readonly LocalSkill[],
  options: {
    skillLabel: string
    onInsertSkill: (skill: LocalSkill, inputAdapter?: QuickPanelInputAdapter) => void
  }
): QuickPanelListItem[] => {
  return skills.map((skill) => ({
    id: agentComposerTokenId.skill(skill),
    label: skill.name,
    description: skill.description ?? undefined,
    icon: <ToolCase size={16} />,
    suffix: options.skillLabel,
    // Skills still exclude descriptions from root-panel search; the category alias powers the persistent shortcut.
    filterText: skill.name,
    searchAliases: [options.skillLabel],
    action: ({ inputAdapter }) => {
      options.onInsertSkill(skill, inputAdapter)
    }
  }))
}

type AgentComposerSessionSnapshot = {
  workspace?: AgentConversationWorkspace | null
  workspaceId?: string | null
}

export interface AgentComposerSendBody {
  agentId: string
  sessionId: string
  userMessageParts: ComposerQueuedMessagePayload['userMessageParts']
  reasoningEffort?: ThinkingOption
  fastMode?: boolean
}

export type AgentComposerSendOptions = { body?: AgentComposerSendBody }

export interface AgentComposerLaunchOptions {
  draftCacheKey: string
  initialDraft: AgentComposerDraftCache
  onSent?: () => void
}

type Props = {
  agentId: string
  sessionId: string
  sessionOverride: AgentComposerSessionSnapshot
  resolvedAgent: AgentEntity | undefined
  resolvedModel: Model | undefined
  resolvedWorkspaceWarning: string | null
  externalContextControls?: boolean
  sendMessage: (message?: { text: string }, options?: AgentComposerSendOptions) => Promise<void>
  stop: () => Promise<void>
  onCreateEmptySession?: () => void | Promise<unknown>
  onAgentChange?: (agentId: string | null) => void | Promise<void>
  agentChanging?: boolean
  canChangeAgent?: boolean
  workspaceId?: string | null
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  workspaceChanging?: boolean
  canChangeModel?: boolean
  isStreaming: boolean
  sendDisabled?: boolean
  compactWhenSingleLine?: boolean
  launchOptions?: AgentComposerLaunchOptions
}

type AgentComposerRootProps = Props & {
  renderControls: AgentComposerControlsRenderer
  forceNarrowLayout?: boolean
  deferQuickPanel?: boolean
}

const AgentComposerRoot = ({
  agentId,
  sessionId,
  sessionOverride,
  resolvedAgent,
  resolvedModel,
  resolvedWorkspaceWarning,
  sendMessage,
  stop,
  onCreateEmptySession,
  onAgentChange,
  agentChanging,
  canChangeAgent = false,
  workspaceId,
  onWorkspaceChange,
  workspaceChanging,
  canChangeModel = true,
  isStreaming,
  sendDisabled = false,
  compactWhenSingleLine = false,
  launchOptions,
  renderControls,
  forceNarrowLayout = false,
  deferQuickPanel = false
}: AgentComposerRootProps) => {
  const session = sessionOverride
  const agent = resolvedAgent
  const sessionModel = resolvedModel
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })
  const launchIdentityRef = useRef({ sessionId, draftCacheKey: launchOptions?.draftCacheKey })
  if (launchIdentityRef.current.sessionId !== sessionId) {
    launchIdentityRef.current = { sessionId, draftCacheKey: launchOptions?.draftCacheKey }
  } else if (launchOptions) {
    launchIdentityRef.current.draftCacheKey = launchOptions.draftCacheKey
  }
  const composerInstanceKey = `${sessionId}:${launchIdentityRef.current.draftCacheKey ?? 'default'}`
  const handleNewSessionShortcut = useCallback(() => {
    void onCreateEmptySession?.()
  }, [onCreateEmptySession])
  const hasNewSessionShortcutAction = Boolean(onCreateEmptySession)

  const isActiveTab = useIsActiveTab()
  useCommandHandler('topic.create', handleNewSessionShortcut, {
    enabled: isActiveTab && Boolean(session && agent && hasNewSessionShortcutAction)
  })

  const sessionSlashCommands = useAgentSessionSlashCommands(sessionId)
  const sessionData = useMemo(() => {
    if (!session || !agent) return undefined
    const accessiblePaths = session.workspace?.type === 'user' && session.workspace.path ? [session.workspace.path] : []
    return {
      agentId,
      sessionId,
      agentType: agent.type,
      accessiblePaths,
      slashCommands: sessionSlashCommands,
      knowledgeBaseIds: agent.knowledgeBaseIds ?? []
    }
  }, [session, agent, agentId, sessionId, sessionSlashCommands])

  const initialState = useMemo(
    () => ({
      mentionedModels: [],
      selectedKnowledgeBases: [],
      files: [] as ComposerAttachment[],
      isExpanded: false,
      couldAddImageFile: false,
      extensions: [] as string[]
    }),
    []
  )

  return (
    <ComposerToolRuntimeProvider
      key={`${agentId}:${sessionId}`}
      initialState={initialState}
      actions={{
        onTextChange: (updater) => actionsRef.current.onTextChange(updater),
        addNewTopic: () => {
          void onCreateEmptySession?.()
        }
      }}>
      <AgentComposerInner
        key={composerInstanceKey}
        agent={agent}
        model={sessionModel}
        modelPending={!resolvedModel && sendDisabled}
        agentId={agentId}
        sessionId={sessionId}
        sessionData={sessionData}
        workspace={session?.workspace ?? null}
        workspaceId={workspaceId ?? session?.workspaceId ?? null}
        actionsRef={actionsRef}
        chatSendMessage={sendMessage}
        chatStop={stop}
        onCreateEmptySession={onCreateEmptySession}
        onAgentChange={onAgentChange}
        agentChanging={agentChanging}
        canChangeAgent={canChangeAgent}
        onWorkspaceChange={onWorkspaceChange}
        workspaceChanging={workspaceChanging}
        canChangeModel={canChangeModel}
        isStreaming={isStreaming}
        sendDisabled={sendDisabled}
        compactWhenSingleLine={compactWhenSingleLine}
        launchOptions={launchOptions}
        renderControls={renderControls}
        forceNarrowLayout={forceNarrowLayout}
        deferQuickPanel={deferQuickPanel}
        resolvedWorkspaceWarning={resolvedWorkspaceWarning}
      />
    </ComposerToolRuntimeProvider>
  )
}

/** Managed picks parked while an input-history entry is previewed, restored when the preview exits. */
interface InputHistoryToolSnapshot {
  files: ComposerAttachment[]
  selectedKnowledgeBases: KnowledgeBase[]
}

interface InnerProps {
  agent?: AgentEntity
  model?: Model
  modelPending?: boolean
  agentId: string
  sessionId: string
  sessionData?: ToolContext['session']
  workspace?: AgentConversationWorkspace | null
  workspaceId?: string | null
  actionsRef: React.MutableRefObject<ProviderActionHandlers>
  chatSendMessage: Props['sendMessage']
  chatStop: Props['stop']
  onCreateEmptySession?: Props['onCreateEmptySession']
  onAgentChange?: Props['onAgentChange']
  agentChanging?: boolean
  canChangeAgent: boolean
  onWorkspaceChange?: Props['onWorkspaceChange']
  workspaceChanging?: boolean
  canChangeModel: boolean
  isStreaming: boolean
  sendDisabled: boolean
  compactWhenSingleLine: boolean
  launchOptions?: AgentComposerLaunchOptions
  renderControls: AgentComposerControlsRenderer
  forceNarrowLayout?: boolean
  deferQuickPanel?: boolean
  resolvedWorkspaceWarning: string | null
}

function AgentComposerContextUsage({ model, sessionId }: { model?: Model; sessionId: string }) {
  const { t } = useTranslation()
  const expectedModels = useMemo(() => getContextUsageModelCandidates(model), [model])
  const { percentage, usage } = useAgentSessionContextUsage(sessionId, expectedModels)
  const compaction = useAgentSessionCompaction(sessionId)
  if (percentage === null || !usage) return null

  const isCompacting = compaction.status === 'compacting'
  const label = t('agent.right_pane.info.context_usage')

  return (
    <Tooltip
      placement="top"
      sideOffset={8}
      showArrow={false}
      classNames={{
        placeholder: 'inline-grid',
        content:
          'w-64 max-w-64 rounded-md border border-border bg-card p-3 text-card-foreground shadow-md dark:bg-card dark:text-card-foreground'
      }}
      content={
        <AgentContextUsageSummary
          usage={usage}
          percentage={percentage}
          isCompacting={isCompacting}
          modelName={model?.name}
          showCategories={false}
        />
      }>
      <ContextUsageMeter
        label={label}
        percentage={percentage}
        isBusy={isCompacting}
        // The cached reading is only refreshed when a turn settles, so it goes stale mid-turn. Main
        // throttles this and answers on the shared-cache key; a session with no live connection
        // keeps showing its last reading.
        onPointerEnter={() => {
          void ipcApi.request('ai.agent.session.refresh_context_usage', { sessionId })
        }}
      />
    </Tooltip>
  )
}

function getContextUsageModelCandidates(model: Model | undefined): string[] | undefined {
  if (!model) return undefined
  const { providerId, modelId } = parseUniqueModelId(model.id)
  const apiModelId = model.apiModelId ?? modelId
  const candidates = [apiModelId, modelId]

  try {
    candidates.push(formatGatewayModelId(providerId, apiModelId))
  } catch {
    // Some models are intentionally not gateway-addressable; their direct ids remain valid candidates.
  }

  return candidates
}

type AgentComposerControlProps = Omit<
  AgentConversationControlsProps,
  'side' | 'iconOnly' | 'onAgentDialogCloseAutoFocus'
> & {
  topBarPortalAvailable: boolean
  topBarPortalIconOnly: boolean
  leadingControl?: React.ReactNode
  renderQuickPanelShortcuts?: (args: {
    inputAdapter?: AgentComposerInputAdapter
    unifiedPanelControl?: AgentComposerUnifiedPanelControl
  }) => React.ReactNode
}
type ComposerSurfaceProps = React.ComponentProps<typeof ComposerSurface>
type AgentComposerControlSlots = Pick<
  ComposerSurfaceProps,
  'renderLeftControls' | 'renderBelowControls' | 'renderCompactControls'
>
type AgentComposerControlsRenderer = (props: AgentComposerControlProps) => AgentComposerControlSlots

type AgentComposerInputAdapter = Parameters<NonNullable<ComposerSurfaceProps['renderLeftControls']>>[0]
type AgentComposerUnifiedPanelControl = Parameters<NonNullable<ComposerSurfaceProps['renderLeftControls']>>[1]

const restoreAgentComposerInputFocus = (inputAdapter: AgentComposerInputAdapter) => {
  window.requestAnimationFrame(() => inputAdapter?.focus())
}

const AgentConversationControlsWithAutoFocus = ({
  inputAdapter,
  ...props
}: AgentConversationControlsProps & { inputAdapter: AgentComposerInputAdapter }) => {
  const onAgentDialogCloseAutoFocus = useCallback(() => restoreAgentComposerInputFocus(inputAdapter), [inputAdapter])

  return <AgentConversationControls {...props} onAgentDialogCloseAutoFocus={onAgentDialogCloseAutoFocus} />
}

const renderAgentComposerContextControls = (
  props: AgentComposerControlProps,
  inputAdapter: AgentComposerInputAdapter,
  { side, iconOnly }: { side: 'top' | 'bottom'; iconOnly: boolean }
) => {
  const resolvedSide = props.topBarPortalAvailable ? 'bottom' : side
  const resolvedIconOnly = props.topBarPortalAvailable ? props.topBarPortalIconOnly : iconOnly
  const controls = (
    <AgentConversationControlsWithAutoFocus
      {...props}
      side={resolvedSide}
      iconOnly={resolvedIconOnly}
      inputAdapter={inputAdapter}
    />
  )

  return props.topBarPortalAvailable ? <ConversationTopBarPortal>{controls}</ConversationTopBarPortal> : controls
}

const renderAgentToolbarControls: AgentComposerControlsRenderer = (props) => {
  return {
    renderLeftControls: (inputAdapter, unifiedPanelControl) => {
      const quickPanelShortcuts = props.renderQuickPanelShortcuts?.({ inputAdapter, unifiedPanelControl })

      return (
        <ComposerToolbarControls
          inputAdapter={inputAdapter}
          leading={
            <>
              {props.leadingControl}
              {quickPanelShortcuts}
            </>
          }
          unifiedPanelControl={unifiedPanelControl}
          renderContextControls={({ side, iconOnly }) =>
            renderAgentComposerContextControls(props, inputAdapter, { side, iconOnly })
          }
        />
      )
    },
    renderCompactControls: (inputAdapter, unifiedPanelControl) => (
      <>
        {props.topBarPortalAvailable
          ? renderAgentComposerContextControls(props, inputAdapter, {
              side: 'bottom',
              iconOnly: props.topBarPortalIconOnly
            })
          : null}
        {props.renderQuickPanelShortcuts?.({ inputAdapter, unifiedPanelControl })}
      </>
    )
  }
}

const renderAgentInputControls: AgentComposerControlsRenderer = (props) => {
  return {
    renderLeftControls: (inputAdapter, unifiedPanelControl) => (
      <ComposerToolbarControls
        inputAdapter={inputAdapter}
        leading={
          <>
            {props.leadingControl}
            {props.renderQuickPanelShortcuts?.({ inputAdapter, unifiedPanelControl })}
          </>
        }
        unifiedPanelControl={unifiedPanelControl}
        renderContextControls={() => null}
      />
    ),
    renderCompactControls: (inputAdapter, unifiedPanelControl) =>
      props.renderQuickPanelShortcuts?.({ inputAdapter, unifiedPanelControl })
  }
}

const renderAgentHomeControls: AgentComposerControlsRenderer = (props) => {
  return {
    renderLeftControls: (inputAdapter, unifiedPanelControl) => {
      const quickPanelShortcuts = props.renderQuickPanelShortcuts?.({ inputAdapter, unifiedPanelControl })

      return (
        <>
          {props.topBarPortalAvailable
            ? renderAgentComposerContextControls(props, inputAdapter, {
                side: 'bottom',
                iconOnly: false
              })
            : null}
          <div className={COMPOSER_TOOLBAR_CLASS}>
            {props.leadingControl}
            {quickPanelShortcuts}
            <ComposerToolMenuControls inputAdapter={inputAdapter} unifiedPanelControl={unifiedPanelControl} />
          </div>
        </>
      )
    },
    renderBelowControls: props.topBarPortalAvailable
      ? undefined
      : (inputAdapter) => (
          <ComposerBelowControls
            renderContextControls={({ side, iconOnly }) =>
              renderAgentComposerContextControls(props, inputAdapter, { side, iconOnly })
            }
          />
        )
  }
}

const AgentComposerInner = ({
  agent,
  model,
  modelPending,
  agentId,
  sessionId,
  sessionData,
  workspace,
  workspaceId,
  actionsRef,
  chatSendMessage,
  chatStop,
  onCreateEmptySession,
  onAgentChange,
  agentChanging,
  canChangeAgent,
  onWorkspaceChange,
  workspaceChanging,
  canChangeModel,
  isStreaming,
  sendDisabled,
  compactWhenSingleLine,
  launchOptions,
  renderControls,
  forceNarrowLayout = false,
  deferQuickPanel = false,
  resolvedWorkspaceWarning
}: InnerProps) => {
  const { updateAgent, updateModel } = useUpdateAgent()
  const { updateSession } = useUpdateSession()
  const scope = TopicType.Session
  const config = getComposerToolConfig(scope)
  const { files, isExpanded, selectedKnowledgeBases } = useComposerToolState()
  const { setFiles, setIsExpanded, setSelectedKnowledgeBases, toolsRegistry } = useComposerToolDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherActions()
  const toolLaunchersVersion = useComposerToolLauncherVersion()
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const [narrowMode] = usePreference('chat.narrow_mode')
  // Yield the same rail gutter as the message column so the composer stays aligned.
  const { railGutterPx } = useChatLayoutMode()
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const { available: topBarPortalAvailable, iconOnly: topBarPortalIconOnly } = useConversationTopBarPortalLayout()
  const {
    pinnedIds: pinnedToolIds,
    setPinnedIds: setPinnedToolIds,
    resetPinnedIds: resetPinnedToolIds,
    isDefault: pinnedToolsAtDefault,
    customizeOpen: customizeToolbarOpen,
    setCustomizeOpen: setCustomizeToolbarOpen,
    customizePanelItem
  } = useComposerToolbarPinnedTools('agent.input.toolbar.pinned_tools')
  const { t } = useTranslation()
  const agentModelFilter = useAgentModelFilter(agent?.type)
  const isModelUnavailable = Boolean(agent) && !model && !modelPending
  const missingModelMessage = isModelUnavailable ? t('code.model_required') : undefined
  const { setTimeoutTimer, clearTimeoutTimer } = useTimer()
  const pinnedLauncherIds = useMemo(
    () => pinnedToolIds.map((id) => (id === 'skills' ? AGENT_SKILLS_LAUNCHER_ID : id)),
    [pinnedToolIds]
  )
  const draftCacheKey = launchOptions?.draftCacheKey ?? getAgentDraftCacheKey(agentId)
  const shouldPersistInitialDraftRef = useRef(false)
  const initialDraftRef = useRef<AgentComposerDraftCache | null>(null)
  if (initialDraftRef.current === null) {
    const hasCachedDraft = hasAgentDraftCache(draftCacheKey)
    const cachedDraft = readAgentDraftCache(draftCacheKey)
    initialDraftRef.current = hasCachedDraft ? cachedDraft : (launchOptions?.initialDraft ?? cachedDraft)
    shouldPersistInitialDraftRef.current = !hasCachedDraft && launchOptions?.initialDraft !== undefined
  }

  const configuredReasoningEffort = agent?.configuration?.reasoning_effort ?? 'default'
  const canonicalReasoningEffort = model
    ? (resolveReasoningEffortForModel(model, configuredReasoningEffort) ?? 'default')
    : configuredReasoningEffort
  const [reasoningOverride, setReasoningOverride] = useState<{
    agentId: string
    value: ThinkingOption
    version: number
    canonicalAtMutationStart?: ThinkingOption
  } | null>(null)
  const reasoningMutationVersionRef = useRef(0)
  const pendingReasoningEditRef = useRef<{
    agentId: string
    version: number
    effort: ThinkingOption
  } | null>(null)
  const activeReasoningOverride =
    reasoningOverride &&
    reasoningOverride.agentId === agent?.id &&
    (reasoningOverride.canonicalAtMutationStart === undefined ||
      reasoningOverride.canonicalAtMutationStart === canonicalReasoningEffort)
      ? reasoningOverride
      : null
  useEffect(() => {
    if (
      !reasoningOverride ||
      reasoningOverride.agentId !== agent?.id ||
      reasoningOverride.canonicalAtMutationStart === undefined ||
      reasoningOverride.canonicalAtMutationStart === canonicalReasoningEffort
    ) {
      return
    }
    setReasoningOverride((current) => (current === reasoningOverride ? null : current))
  }, [agent?.id, canonicalReasoningEffort, reasoningOverride])
  const reasoningEffort = activeReasoningOverride?.value ?? canonicalReasoningEffort
  const [fastMode, setFastMode] = useState(false)
  const [selectedSkills, setSelectedSkills] = useState<LocalSkill[]>(() =>
    getCachedSkillTokens(initialDraftRef.current?.tokens ?? []).map(getSkillFromCachedToken)
  )
  const [text, setTextState] = useState(() => initialDraftRef.current?.text ?? '')
  const [draftTokens, setDraftTokens] = useState<ComposerSerializedToken[]>(() => initialDraftRef.current?.tokens ?? [])
  const textRef = useRef(text)
  const draftTokensRef = useRef(draftTokens)
  const sessionTopicId = buildAgentSessionTopicId(sessionId)
  const accessiblePaths = sessionData?.accessiblePaths ?? EMPTY_ACCESSIBLE_PATHS
  const enableResourceMention = accessiblePaths.length > 0
  const userWorkspacePath = workspace?.type === 'user' ? workspace.path : undefined
  const workspaceWarning = resolvedWorkspaceWarning ?? undefined
  const quickPanel = useOptionalQuickPanel()
  const rootPanelVisible = Boolean(quickPanel?.isVisible && quickPanel.symbol === ComposerPanelSymbol.Root)
  const skillsPanelVisible = Boolean(quickPanel?.isVisible && quickPanel.symbol === AGENT_SKILLS_LAUNCHER_ID)
  const knowledgeBasePanelVisible = Boolean(
    quickPanel?.isVisible && quickPanel.symbol === ComposerPanelSymbol.KnowledgeBase
  )
  const skillsDataEnabled =
    selectedSkills.length > 0 ||
    getAgentComposerTokenIds(draftTokens, 'skill').size > 0 ||
    rootPanelVisible ||
    skillsPanelVisible
  const knowledgeBasesDataEnabled =
    selectedKnowledgeBases.length > 0 ||
    getAgentComposerTokenIds(draftTokens, 'knowledge').size > 0 ||
    rootPanelVisible ||
    knowledgeBasePanelVisible
  const { skills: availableSkills, refresh: refreshAvailableSkills } = useAvailableSkills(agentId, userWorkspacePath, {
    enabled: skillsDataEnabled
  })
  const { bases: allKnowledgeBases, isLoading: isKnowledgeBasesLoading } = useKnowledgeBases({
    enabled: knowledgeBasesDataEnabled
  })

  useEffect(() => {
    if (!shouldPersistInitialDraftRef.current || !initialDraftRef.current) return
    shouldPersistInitialDraftRef.current = false
    writeAgentDraftCache(draftCacheKey, initialDraftRef.current.text, initialDraftRef.current.tokens)
  }, [draftCacheKey])

  const { canAddImageFile, supportedExts } = useComposerFileCapabilities(model)

  useEffect(() => {
    if (model?.supportsFastMode !== true) setFastMode(false)
  }, [model?.supportsFastMode])

  const setText = useCallback(
    (nextText: string, options: { persist?: boolean; tokens?: readonly ComposerSerializedToken[] } = {}) => {
      clearTimeoutTimer('agentComposerSendMessage')
      textRef.current = nextText
      setTextState(nextText)
      if (options.persist ?? true) {
        writeAgentDraftCache(draftCacheKey, nextText, options.tokens ?? draftTokensRef.current)
      }
    },
    [clearTimeoutTimer, draftCacheKey]
  )
  const filesRef = useLatest(files)
  const selectedKnowledgeBasesRef = useLatest(selectedKnowledgeBases)
  const inputHistoryToolsRef = useRef<InputHistoryToolSnapshot | null>(null)
  const applyHistoryDraft = useCallback(
    (historyDraft: ComposerSerializedDraft, options: { source: 'history' | 'draft' }) => {
      const nextDraftTokens = getAgentDraftTokens(historyDraft.tokens)
      const persistDraft = options.source === 'draft'
      actionsRef.current.replaceDraft(historyDraft)
      setText(historyDraft.text, { persist: false })
      setDraftTokens(nextDraftTokens)
      draftTokensRef.current = nextDraftTokens
      if (persistDraft) {
        writeAgentDraftCache(draftCacheKey, historyDraft.text, nextDraftTokens)
      }
      setSelectedSkills(getCachedSkillTokens(nextDraftTokens).map(getSkillFromCachedToken))

      if (options.source === 'history') {
        // A recalled entry is plain text with no tokens, so every managed pick steps aside — skills
        // and files already do. A live knowledge selection would re-insert its chip on top of the
        // sentence the entry already carries, sending the same attachment claim twice.
        inputHistoryToolsRef.current ??= {
          files: filesRef.current,
          selectedKnowledgeBases: selectedKnowledgeBasesRef.current
        }
        setFiles([])
        setSelectedKnowledgeBases([])
        return
      }

      const savedTools = inputHistoryToolsRef.current
      inputHistoryToolsRef.current = null
      if (!savedTools) return
      setFiles(savedTools.files)
      setSelectedKnowledgeBases(savedTools.selectedKnowledgeBases)
    },
    [actionsRef, draftCacheKey, filesRef, selectedKnowledgeBasesRef, setFiles, setSelectedKnowledgeBases, setText]
  )
  const { isInputHistoryActive, navigateHistory, resetHistoryIndex, saveHistory } = useInputHistory({
    applyDraft: applyHistoryDraft
  })
  const handleTextChange = useCallback(
    (nextText: string) => {
      resetHistoryIndex()
      inputHistoryToolsRef.current = null
      // Controlled token sync updates text without firing onTokensChange, so this editor-originated
      // path must persist the live token snapshot rather than the potentially stale draftTokensRef.
      setText(nextText, { tokens: actionsRef.current.getDraft().tokens })
    },
    [actionsRef, resetHistoryIndex, setText]
  )
  const handleInputHistoryNavigate = useCallback(
    (direction: InputHistoryDirection) => navigateHistory(direction, actionsRef.current.getDraft()),
    [actionsRef, navigateHistory]
  )

  useEffect(() => {
    textRef.current = text
  }, [text])

  useEffect(() => {
    draftTokensRef.current = draftTokens
  }, [draftTokens])

  const selectedKnowledgeBasesScopeKey = `${sessionTopicId}:${agentId}`
  const {
    selectableKnowledgeBases,
    selectedKnowledgeBasesInScope,
    resolveKnowledgeBaseMarker,
    restoreKnowledgeBaseSelection
  } = useComposerKnowledgeBaseScope({
    configuredKnowledgeBaseIds: agent?.knowledgeBaseIds,
    allKnowledgeBases,
    isKnowledgeBasesLoading,
    scopeKey: selectedKnowledgeBasesScopeKey,
    selectedKnowledgeBases,
    setSelectedKnowledgeBases,
    // The tool provider above is keyed by agent + session, so this hook remounts with the scope.
    remountsOnScopeChange: true
  })
  const tokens = useMemo(
    () => [
      ...files.map(agentFileToComposerToken),
      ...selectedKnowledgeBasesInScope.map(agentKnowledgeBaseToComposerToken),
      ...selectedSkills.map(agentSkillToComposerToken)
    ],
    [files, selectedKnowledgeBasesInScope, selectedSkills]
  )
  const skillByFilename = useMemo(
    () => new Map(availableSkills.map((skill) => [skill.filename, skill])),
    [availableSkills]
  )
  const resolveSkillMarker = useCallback(
    (marker: string): ComposerDraftToken | null => {
      const skill = skillByFilename.get(marker)
      return skill ? agentSkillToComposerToken(skill) : null
    },
    [skillByFilename]
  )

  const handleSurfaceActionsChange = useCallback(
    (actions: ComposerSurfaceActions) => {
      Object.assign(actionsRef.current, actions)
    },
    [actionsRef]
  )

  useEffect(() => {
    return EventEmitter.on(EVENT_NAMES.FOCUS_CHAT_COMPOSER, (payload) => {
      const topicId = typeof payload === 'object' && payload ? (payload as { topicId?: string }).topicId : undefined
      if (topicId !== sessionTopicId) return
      actionsRef.current.focus('end')
    })
  }, [actionsRef, sessionTopicId])

  useEffect(() => {
    if (!launchOptions?.initialDraft) return
    const frameId = window.requestAnimationFrame(() => actionsRef.current.focus('end'))
    return () => window.cancelAnimationFrame(frameId)
  }, [actionsRef, launchOptions?.initialDraft])

  const insertSkillToken = useCallback(
    (skill: LocalSkill, inputAdapter?: QuickPanelInputAdapter) => {
      if (!inputAdapter?.insertToken) return

      const token = agentSkillToComposerToken(skill)
      const exists = selectedSkills.some((selectedSkill) => agentComposerTokenId.skill(selectedSkill) === token.id)
      if (!exists) {
        inputAdapter.insertToken(token)
        setSelectedSkills((prev) =>
          prev.some((selectedSkill) => agentComposerTokenId.skill(selectedSkill) === token.id) ? prev : [...prev, skill]
        )
      }
      inputAdapter.focus()
    },
    [selectedSkills]
  )

  // Skills live in their own submenu (opened as the `agent-skills` launcher), with a pinned footer
  // that opens the agent's skills config. The customize-toolbar action stays in the root panel.
  const skillManageFooterItem = useMemo<QuickPanelListItem>(
    () => ({
      id: 'agent-skills:manage',
      label: t('plugins.manage_skills'),
      icon: <Settings2 size={16} />,
      fixedToBottom: true,
      action: () => openResourceEditDialog({ kind: 'agent', id: agentId, initialTab: 'tools.skills' })
    }),
    [agentId, t]
  )

  const skillItems = useMemo<QuickPanelListItem[]>(
    () =>
      createSkillQuickPanelItems(availableSkills, {
        skillLabel: t('plugins.skills'),
        onInsertSkill: insertSkillToken
      }),
    [availableSkills, insertSkillToken, t]
  )
  const skillPanelItems = useMemo(() => [...skillItems, skillManageFooterItem], [skillItems, skillManageFooterItem])

  const skillsLauncher = useMemo<ComposerToolLauncher>(() => {
    const skillLabel = t('plugins.skills')
    return {
      id: AGENT_SKILLS_LAUNCHER_ID,
      kind: 'panel',
      sources: ['root-panel'],
      order: 40,
      label: skillLabel,
      icon: <ToolCase />,
      searchAliases: [skillLabel],
      panelSymbol: AGENT_SKILLS_LAUNCHER_ID,
      rootSearchItems: skillItems,
      action: ({ parentPanel, queryAnchor, quickPanel, triggerInfo }) => {
        void refreshAvailableSkills().catch((error) => {
          logger.warn('Failed to refresh available skills when opening the skills panel', { error })
        })
        quickPanel.open({
          title: skillLabel,
          list: skillPanelItems,
          symbol: AGENT_SKILLS_LAUNCHER_ID,
          parentPanel,
          queryAnchor,
          triggerInfo: triggerInfo ?? { type: 'button' }
        })
      }
    }
  }, [refreshAvailableSkills, skillItems, skillPanelItems, t])

  useEffect(
    () => toolsRegistry.registerLaunchers(AGENT_SKILLS_LAUNCHER_ID, [skillsLauncher]),
    [skillsLauncher, toolsRegistry]
  )

  // Keep an already-open skills submenu in sync once a refresh resolves — the launcher action opens
  // it with the current (possibly stale) closure, so an externally installed/removed skill would
  // otherwise only appear on the next open (mirrors the MCP status panel).
  const updateQuickPanelList = quickPanel?.updateList
  useEffect(() => {
    if (!skillsPanelVisible || !updateQuickPanelList) return
    updateQuickPanelList(skillPanelItems)
  }, [skillsPanelVisible, skillPanelItems, updateQuickPanelList])

  const rootPanelTrailingItems = useMemo(() => [customizePanelItem], [customizePanelItem])

  const handleRootPanelOpen = useCallback(() => {
    void refreshAvailableSkills().catch((error) => {
      logger.warn('Failed to refresh available skills when opening root panel', { error })
    })
  }, [refreshAvailableSkills])

  useComposerQuoteInsertion(actionsRef)

  const abortAgentSession = useCallback(async () => {
    logger.info('Aborting agent session', { sessionTopicId })
    await chatStop()
  }, [chatStop, sessionTopicId])

  const handleAgentChange = useCallback(
    async (nextAgentId: string | null) => {
      if (!nextAgentId || nextAgentId === agentId) return
      if (onAgentChange) {
        await onAgentChange(nextAgentId)
        return
      }
      await updateSession({ id: sessionId, agentId: nextAgentId }, { showSuccessToast: false })
    },
    [agentId, onAgentChange, sessionId, updateSession]
  )

  const handleModelSelect = useCallback(
    async (nextModel?: Model) => {
      if (!agent || !canChangeModel || !nextModel || nextModel.id === model?.id) return

      const nextReasoningEffort = resolveReasoningEffortForModel(nextModel, reasoningEffort) ?? 'default'
      const pendingReasoningEdit =
        pendingReasoningEditRef.current?.agentId === agent.id ? pendingReasoningEditRef.current : null
      const pendingReasoningEffort = pendingReasoningEdit ? { reasoningEffort: pendingReasoningEdit.effort } : {}
      const previousReasoningOverride = activeReasoningOverride
      const version = ++reasoningMutationVersionRef.current
      setReasoningOverride({
        agentId: agent.id,
        value: nextReasoningEffort,
        version
      })

      const updatedAgent = await updateModel(
        { agentId: agent.id, modelId: nextModel.id, ...pendingReasoningEffort },
        { showSuccessToast: false }
      )
      if (!updatedAgent) {
        setReasoningOverride((current) => {
          if (current?.agentId !== agent.id || current.version !== version) return current
          if (!previousReasoningOverride) return null

          const previousEditStillPending =
            pendingReasoningEditRef.current?.agentId === previousReasoningOverride.agentId &&
            pendingReasoningEditRef.current.version === previousReasoningOverride.version
          return previousEditStillPending || previousReasoningOverride.canonicalAtMutationStart !== undefined
            ? previousReasoningOverride
            : { ...previousReasoningOverride, canonicalAtMutationStart: canonicalReasoningEffort }
        })
        return
      }
      if (
        pendingReasoningEdit &&
        pendingReasoningEditRef.current?.agentId === pendingReasoningEdit.agentId &&
        pendingReasoningEditRef.current?.version === pendingReasoningEdit.version
      ) {
        pendingReasoningEditRef.current = null
      }
      setReasoningOverride((current) => (current?.agentId === agent.id && current.version === version ? null : current))
    },
    [activeReasoningOverride, agent, canChangeModel, canonicalReasoningEffort, model?.id, reasoningEffort, updateModel]
  )

  const handleCreateEmptySession = useCallback(() => {
    void onCreateEmptySession?.()
  }, [onCreateEmptySession])
  const hasNewSessionAction = Boolean(onCreateEmptySession)

  const rootPanelNewSessionItems = useMemo<QuickPanelListItem[]>(() => {
    if (!hasNewSessionAction) return []

    const label = t('agent.session.new')

    return [
      {
        id: AGENT_NEW_SESSION_TOOL_ID,
        label,
        icon: <NewConversationIcon size={16} />,
        filterText: label,
        searchAliases: getQuickPanelSearchAliases(t, 'agent.session.new'),
        action: () => {
          handleCreateEmptySession()
        }
      }
    ]
  }, [handleCreateEmptySession, hasNewSessionAction, t])

  const toolsSession = sessionData
  const handleReasoningEffortChange = useCallback(
    (option: ThinkingOption) => {
      if (!agent) return

      const canonicalAtMutationStart = canonicalReasoningEffort
      const version = ++reasoningMutationVersionRef.current
      pendingReasoningEditRef.current = { agentId: agent.id, version, effort: option }
      setReasoningOverride({
        agentId: agent.id,
        value: option,
        version
      })

      void updateAgent(
        {
          id: agent.id,
          configuration: { reasoning_effort: option }
        },
        { showSuccessToast: false }
      ).then((updatedAgent) => {
        if (!updatedAgent) return

        if (
          pendingReasoningEditRef.current?.agentId === agent.id &&
          pendingReasoningEditRef.current.version === version
        ) {
          pendingReasoningEditRef.current = null
        }
        setReasoningOverride((current) =>
          current?.agentId === agent.id && current.version === version
            ? {
                ...current,
                value: updatedAgent.configuration?.reasoning_effort ?? 'default',
                canonicalAtMutationStart
              }
            : current
        )
      })
    },
    [agent, canonicalReasoningEffort, updateAgent]
  )

  // File reconcile (prune + dedup) is owned by attachmentTool via the tools DI seam. Skill
  // reconcile stays here (agent-only, no shared duplication) alongside the editor draft-token
  // cache snapshot, which is variant state.
  const reconcileTokens = useComposerTokenReconcile({ scope, model, session: toolsSession })
  const handleTokensChange = useCallback(
    (draftTokens: readonly ComposerSerializedToken[]) => {
      const nextDraftTokens = getAgentDraftTokens(draftTokens)
      setDraftTokens(nextDraftTokens)
      draftTokensRef.current = nextDraftTokens
      writeAgentDraftCache(draftCacheKey, textRef.current, nextDraftTokens)
      reconcileTokens(draftTokens)

      const skillTokenIds = getAgentComposerTokenIds(draftTokens, 'skill')
      const skillTokens = draftTokens.filter((token) => token.kind === 'skill')
      setSelectedSkills((prev) => {
        const next = prev.filter((skill) => skillTokenIds.has(agentComposerTokenId.skill(skill)))
        const nextIds = new Set(next.map(agentComposerTokenId.skill))
        let changed = next.length !== prev.length

        for (const token of skillTokens) {
          const skill = availableSkills.find((candidate) => {
            const candidateId = agentComposerTokenId.skill(candidate)
            return candidateId === token.id || candidate.name === token.label || candidate.filename === token.label
          })
          if (!skill) continue

          const skillId = agentComposerTokenId.skill(skill)
          if (nextIds.has(skillId)) continue
          next.push(skill)
          nextIds.add(skillId)
          changed = true
        }

        return changed ? next : prev
      })
    },
    [availableSkills, draftCacheKey, reconcileTokens]
  )

  const placeholderText = useMemo(
    () => t('agent.input.placeholder', { key: getSendMessageShortcutLabel(sendMessageShortcut) }),
    [sendMessageShortcut, t]
  )

  const buildQueuedPayload = useCallback(
    (draft: ComposerSerializedDraft): ComposerQueuedMessagePayload | null => {
      const payload = buildComposerQueuedPayload(draft, {
        files,
        fileTokenId: agentComposerTokenId.file,
        extra: () => ({
          reasoningEffort: model ? resolveComposerReasoningEffort(model, reasoningEffort) : reasoningEffort,
          ...(fastMode && model?.supportsFastMode === true ? { fastMode: true } : {})
        })
      })
      if (!payload) return null

      const tokenIds = getAgentComposerTokenIds(draft.tokens)
      const knowledgeBaseIds = selectedKnowledgeBasesInScope
        .filter((base) => tokenIds.has(agentComposerTokenId.knowledge(base)))
        .map((base) => base.id)
      return {
        ...payload,
        userMessageParts: withKnowledgeScopePart(payload.userMessageParts, knowledgeBaseIds)
      }
    },
    [fastMode, files, model, reasoningEffort, selectedKnowledgeBasesInScope]
  )

  const sendQueuedPayload = useCallback(
    async (payload: ComposerQueuedMessagePayload) => {
      try {
        const attachments = (payload.attachments as ComposerAttachment[] | undefined) ?? []
        const fileParts = await buildAgentFilePartsForAttachments(attachments, accessiblePaths)
        await chatSendMessage(
          { text: payload.text },
          {
            body: {
              agentId,
              sessionId,
              userMessageParts: [...payload.userMessageParts, ...fileParts],
              reasoningEffort: payload.reasoningEffort,
              ...(payload.fastMode ? { fastMode: true } : {})
            }
          }
        )
        void EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: sessionTopicId })
        saveHistory(getComposerHistoryText(payload.userMessageParts))
        launchOptions?.onSent?.()
        return true
      } catch (error: unknown) {
        logger.warn('Failed to send message:', error as Error)
        return false
      }
    },
    [accessiblePaths, agentId, chatSendMessage, launchOptions, saveHistory, sessionId, sessionTopicId]
  )

  const clearCurrentDraft = useCallback(() => {
    setText('')
    setFiles([])
    setSelectedSkills([])
    setDraftTokens([])
    draftTokensRef.current = []
    writeAgentDraftCache(draftCacheKey, '', [])
    setTimeoutTimer('agentComposerSendMessage', () => setText(''), 500)
    // Drop the input-history nav state so a recalled draft that gets sent/queued
    // does not leave useInputHistory pointing at it; otherwise the next
    // ArrowDown would restore the already-sent draft and ArrowUp would resume
    // from a stale index.
    resetHistoryIndex()
    inputHistoryToolsRef.current = null
  }, [draftCacheKey, resetHistoryIndex, setFiles, setText, setTimeoutTimer])

  // Queue mode (same as chat): while the session streams, follow-ups queue here and auto-drain on idle.
  const { isFulfilled: sessionFulfilled, markSeen: markSessionSeen } = useTopicStreamStatus(sessionTopicId)
  const {
    items: queuedFollowups,
    enqueue: enqueueFollowup,
    removeId: removeFollowup,
    reorder: reorderFollowups,
    paused: followupPaused,
    setPaused: setFollowupPaused
  } = useFollowupQueue({
    scopeKey: sessionTopicId,
    isFulfilled: sessionFulfilled,
    markSeen: markSessionSeen,
    onDrain: sendQueuedPayload,
    onDrainFailed: () => toast.error(t('chat.input.send_failed'))
  })

  // Edit a queued item = atomically restore the whole editor draft, then synchronize live token
  // state and the managed file/knowledge/skill selections before dropping it from the queue.
  const restoreFollowupDraft = useCallback(
    (item: FollowupQueueItem) => {
      const nextDraftTokens = getAgentDraftTokens(item.draft.tokens)
      resetHistoryIndex()
      inputHistoryToolsRef.current = null
      actionsRef.current.replaceDraft(item.draft)
      setDraftTokens(nextDraftTokens)
      draftTokensRef.current = nextDraftTokens
      setText(item.draft.text)
      setFiles((item.payload.attachments as ComposerAttachment[] | undefined) ?? [])
      setSelectedSkills(getCachedSkillTokens(nextDraftTokens).map(getSkillFromCachedToken))
      restoreKnowledgeBaseSelection(getKnowledgeBaseIdsFromParts(item.payload.userMessageParts) ?? [])
      handleReasoningEffortChange(item.payload.reasoningEffort ?? 'default')
      setFastMode(item.payload.fastMode === true)
    },
    [actionsRef, handleReasoningEffortChange, resetHistoryIndex, restoreKnowledgeBaseSelection, setFiles, setText]
  )

  const handleSendDraft = useCallback(
    async (draft: ComposerSerializedDraft) => {
      if (sendDisabled) return
      if (!model) {
        toast.error(t('code.model_required'))
        return
      }
      if (workspaceWarning) {
        toast.error(workspaceWarning)
        return
      }
      const payload = buildQueuedPayload(draft)
      if (!payload) return

      // Busy (streaming) → queue the follow-up; the head auto-drains when the session goes idle and
      // the dock lets the user steer/edit/remove items.
      if (isStreaming) {
        enqueueFollowup(draft, payload)
        clearCurrentDraft()
        return
      }

      const previousText = draft.text
      const previousFiles = files
      const previousSkills = selectedSkills
      const previousDraftTokens = draftTokensRef.current

      clearCurrentDraft()
      const sent = await sendQueuedPayload(payload)
      if (!sent) {
        clearTimeoutTimer('agentComposerSendMessage')
        setText(previousText)
        setFiles(previousFiles)
        setSelectedSkills(previousSkills)
        setDraftTokens(previousDraftTokens)
        draftTokensRef.current = previousDraftTokens
        writeAgentDraftCache(draftCacheKey, previousText, previousDraftTokens)
        toast.error(t('chat.input.send_failed'))
      }
    },
    [
      buildQueuedPayload,
      clearTimeoutTimer,
      clearCurrentDraft,
      draftCacheKey,
      enqueueFollowup,
      files,
      isStreaming,
      model,
      sendDisabled,
      sendQueuedPayload,
      setFiles,
      setText,
      selectedSkills,
      t,
      workspaceWarning
    ]
  )

  const { getItems: getEntityReferenceItems, hasPendingReference } = useEntityReferenceMentionItems({
    entityType: 'session',
    excludeId: sessionId
  })
  const resourceMentionSources = useAgentResourceMentionSource({
    accessiblePaths,
    files,
    setFiles,
    enabled: enableResourceMention,
    getAdditionalItems: getEntityReferenceItems
  })

  const toolbarCustomTools = useMemo<ComposerToolbarCustomTool[]>(() => {
    const newSessionLabel = t('agent.session.new')
    const skillLabel = t('plugins.skills')
    const slashCommandsLabel = t('chat.input.slash_commands.title')
    return [
      ...(hasNewSessionAction
        ? [
            {
              id: AGENT_NEW_SESSION_TOOL_ID,
              label: newSessionLabel,
              icon: <NewConversationIcon size={18} aria-hidden />,
              customizePlacement: 'leading' as const,
              requiresPanel: false,
              onSelect: () => handleCreateEmptySession()
            }
          ]
        : []),
      {
        id: 'skills',
        label: skillLabel,
        icon: <ToolCase size={18} aria-hidden />,
        onSelect: ({ unifiedPanelControl }) =>
          unifiedPanelControl?.open({ launcherId: AGENT_SKILLS_LAUNCHER_ID, searchText: skillLabel })
      },
      {
        id: 'slash-commands',
        label: slashCommandsLabel,
        icon: <Terminal size={18} aria-hidden />,
        onSelect: ({ unifiedPanelControl }) => unifiedPanelControl?.open({ searchText: slashCommandsLabel })
      },
      {
        id: ComposerPanelSymbol.McpStatus,
        label: 'MCP',
        icon: <McpLogo width={18} height={18} aria-hidden />,
        onSelect: ({ unifiedPanelControl }) =>
          unifiedPanelControl?.open({ launcherId: ComposerPanelSymbol.McpStatus, searchText: 'MCP' })
      }
    ]
  }, [handleCreateEmptySession, hasNewSessionAction, t])

  const renderQuickPanelShortcuts = useCallback(
    ({
      inputAdapter,
      unifiedPanelControl
    }: {
      inputAdapter?: AgentComposerInputAdapter
      unifiedPanelControl?: AgentComposerUnifiedPanelControl
    }) => (
      <ComposerToolbarShortcuts
        scope={TopicType.Session}
        pinnedIds={pinnedToolIds}
        onPinnedIdsChange={setPinnedToolIds}
        onResetPinnedIds={resetPinnedToolIds}
        isDefault={pinnedToolsAtDefault}
        customTools={toolbarCustomTools}
        customizeOpen={customizeToolbarOpen}
        onCustomizeOpenChange={setCustomizeToolbarOpen}
        isModelUnavailable={isModelUnavailable}
        inputAdapter={inputAdapter}
        unifiedPanelControl={unifiedPanelControl}
      />
    ),
    [
      customizeToolbarOpen,
      isModelUnavailable,
      pinnedToolIds,
      pinnedToolsAtDefault,
      resetPinnedToolIds,
      setCustomizeToolbarOpen,
      setPinnedToolIds,
      toolbarCustomTools
    ]
  )

  const controlSlots = renderControls({
    agent,
    model,
    workspace,
    workspaceId,
    workspaceWarning,
    selectAgentLabel: t('chat.alerts.select_agent'),
    selectModelLabel: t('button.select_model'),
    selectWorkspaceLabel: t('agent.session.workspace_selector.placeholder'),
    agentChanging,
    agentTriggerMode: canChangeAgent ? 'selector' : 'edit',
    shouldAutoSelectCreatedAgent: true,
    topBarPortalAvailable,
    topBarPortalIconOnly,
    canChangeModel,
    onModelSelect: handleModelSelect,
    modelFilter: agentModelFilter,
    renderQuickPanelShortcuts,
    onAgentChange: handleAgentChange,
    onWorkspaceChange,
    workspaceChanging
  })

  const sendAccessory: ComposerSurfaceProps['sendAccessory'] = (
    <>
      {model ? (
        <ComposerSpeedControl
          model={model}
          reasoningEffort={reasoningEffort}
          fastMode={fastMode}
          onReasoningEffortChange={handleReasoningEffortChange}
          onFastModeChange={setFastMode}
        />
      ) : null}
      <AgentComposerContextUsage model={model} sessionId={sessionId} />
    </>
  )

  return (
    <ComposerToolDerivedStateProvider
      couldAddImageFile={canAddImageFile}
      extensions={supportedExts}
      selectableKnowledgeBases={selectableKnowledgeBases}>
      {model && <ComposerToolRuntimeHost scope={scope} model={model} session={toolsSession} />}
      <ResourceEditDialogEventHost />
      <ComposerPinnedToolsProvider value={pinnedLauncherIds}>
        <ComposerSurface
          text={text}
          onTextChange={handleTextChange}
          tokens={tokens}
          draftTokens={draftTokens}
          managedTokenKinds={AGENT_MANAGED_TOKEN_KINDS}
          onTokensChange={handleTokensChange}
          resolveKnowledgeBaseMarker={resolveKnowledgeBaseMarker}
          resolveSkillMarker={resolveSkillMarker}
          placeholder={placeholderText}
          sendDisabled={
            sendDisabled ||
            hasPendingReference ||
            modelPending ||
            !!missingModelMessage ||
            (text.trim().length === 0 && files.length === 0 && selectedSkills.length === 0)
          }
          sendBlockedReason={sendDisabled || hasPendingReference ? t('common.loading') : missingModelMessage}
          isLoading={isStreaming}
          onSendDraft={handleSendDraft}
          onPause={abortAgentSession}
          queueContent={
            <>
              {queuedFollowups.length > 0 ? (
                <QueuedFollowupsDock
                  items={queuedFollowups}
                  paused={followupPaused}
                  onTogglePause={() => setFollowupPaused(!followupPaused)}
                  onSteer={async (id) => {
                    const item = queuedFollowups.find((entry) => entry.id === id)
                    if (!item) return
                    // Only drop the item once the send actually succeeds; a failed manual
                    // steer keeps it in the dock + toasts, matching the direct-send/auto-drain paths.
                    const sent = await sendQueuedPayload(item.payload)
                    if (sent) removeFollowup(id)
                    else toast.error(t('chat.input.send_failed'))
                  }}
                  onEdit={(id) => {
                    const item = queuedFollowups.find((entry) => entry.id === id)
                    if (!item) return
                    restoreFollowupDraft(item)
                    removeFollowup(id)
                  }}
                  onRemove={removeFollowup}
                  onReorder={reorderFollowups}
                />
              ) : undefined}
            </>
          }
          supportedExts={supportedExts}
          setFiles={setFiles}
          filesCount={files.length}
          isExpanded={isExpanded}
          onExpandedChange={setIsExpanded}
          quickPanelEnabled={config.enableQuickPanel ?? true}
          enableDragDrop={config.enableDragDrop ?? true}
          enableSpellCheck={enableSpellCheck}
          fontSize={fontSize}
          narrowMode={forceNarrowLayout || narrowMode}
          railGutterPx={railGutterPx}
          onActionsChange={handleSurfaceActionsChange}
          isInputHistoryActive={isInputHistoryActive}
          onInputHistoryNavigate={handleInputHistoryNavigate}
          getToolLaunchers={() => getLaunchers()}
          toolLaunchersVersion={toolLaunchersVersion}
          suggestionSources={resourceMentionSources}
          rootPanelLeadingItems={rootPanelNewSessionItems}
          rootPanelAdditionalItems={rootPanelTrailingItems}
          onRootPanelOpen={handleRootPanelOpen}
          onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
          sendAccessory={sendAccessory}
          compactWhenSingleLine={compactWhenSingleLine}
          deferQuickPanel={deferQuickPanel}
          {...controlSlots}
        />
      </ComposerPinnedToolsProvider>
    </ComposerToolDerivedStateProvider>
  )
}

type MissingAgentHomeComposerProps = {
  onAgentChange?: (agentId: string | null) => void | Promise<void>
  agentChanging?: boolean
}

type MissingAgentHomeComposerInnerProps = MissingAgentHomeComposerProps & {
  actionsRef: React.RefObject<ProviderActionHandlers>
}

const MissingAgentHomeComposerInner = ({
  onAgentChange,
  agentChanging,
  actionsRef
}: MissingAgentHomeComposerInnerProps) => {
  const config = getComposerToolConfig(TopicType.Session)
  const { files, isExpanded } = useComposerToolState()
  const { setFiles, setIsExpanded } = useComposerToolDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherActions()
  const toolLaunchersVersion = useComposerToolLauncherVersion()
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [narrowMode] = usePreference('chat.narrow_mode')
  // Yield the same rail gutter as the message column so the composer stays aligned.
  const { railGutterPx } = useChatLayoutMode()
  const { available: topBarPortalAvailable, iconOnly: topBarPortalIconOnly } = useConversationTopBarPortalLayout()
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const selectAgentMessage = t('chat.alerts.select_agent')
  const handleSurfaceActionsChange = useCallback(
    (actions: ComposerSurfaceActions) => {
      Object.assign(actionsRef.current, actions)
    },
    [actionsRef]
  )
  const handleAgentChange = useCallback(
    async (nextAgentId: string | null) => {
      if (!nextAgentId) return
      if (text.trim().length > 0) {
        writeAgentDraftCache(getAgentDraftCacheKey(nextAgentId), text, [])
      }
      await onAgentChange?.(nextAgentId)
    },
    [onAgentChange, text]
  )
  const handleBlockedSend = useCallback(() => {
    toast.error(selectAgentMessage)
  }, [selectAgentMessage])
  const placeholderText = t('agent.input.placeholder', {
    key: getSendMessageShortcutLabel(sendMessageShortcut)
  })
  const controlSlots = renderAgentToolbarControls({
    agent: undefined,
    selectAgentLabel: selectAgentMessage,
    model: undefined,
    selectModelLabel: t('button.select_model'),
    selectWorkspaceLabel: t('agent.session.workspace_selector.placeholder'),
    workspace: undefined,
    workspaceId: null,
    agentChanging,
    agentTriggerMode: 'selector',
    shouldAutoSelectCreatedAgent: true,
    topBarPortalAvailable,
    topBarPortalIconOnly,
    canChangeModel: false,
    onAgentChange: handleAgentChange,
    onModelSelect: () => undefined,
    // The workspace selector stays disabled until an agent creates a real session.
    onWorkspaceChange: undefined
  })

  return (
    <ComposerToolDerivedStateProvider couldAddImageFile={false} extensions={[]}>
      <ComposerSurface
        text={text}
        onTextChange={setText}
        tokens={[]}
        draftTokens={[]}
        managedTokenKinds={AGENT_MANAGED_TOKEN_KINDS}
        onTokensChange={() => undefined}
        placeholder={placeholderText}
        sendDisabled
        sendBlockedReason={selectAgentMessage}
        isLoading={false}
        onSendDraft={handleBlockedSend}
        onPause={() => undefined}
        supportedExts={[]}
        setFiles={setFiles}
        filesCount={files.length}
        isExpanded={isExpanded}
        onExpandedChange={setIsExpanded}
        quickPanelEnabled={config.enableQuickPanel ?? true}
        enableDragDrop={false}
        enableSpellCheck={enableSpellCheck}
        fontSize={fontSize}
        narrowMode={narrowMode}
        railGutterPx={railGutterPx}
        onActionsChange={handleSurfaceActionsChange}
        getToolLaunchers={() => getLaunchers()}
        toolLaunchersVersion={toolLaunchersVersion}
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
        deferQuickPanel
        {...controlSlots}
      />
    </ComposerToolDerivedStateProvider>
  )
}

export const MissingAgentHomeComposer = (props: MissingAgentHomeComposerProps) => {
  const initialState = useMemo(
    () => ({
      mentionedModels: [],
      selectedKnowledgeBases: [],
      files: [] as ComposerAttachment[],
      isExpanded: false,
      couldAddImageFile: false,
      extensions: [] as string[]
    }),
    []
  )
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })

  return (
    <ComposerToolRuntimeProvider
      initialState={initialState}
      actions={{
        onTextChange: (updater) => actionsRef.current.onTextChange(updater),
        addNewTopic: () => undefined
      }}>
      <MissingAgentHomeComposerInner {...props} actionsRef={actionsRef} />
    </ComposerToolRuntimeProvider>
  )
}

// Composer state is agent-scoped, so switching agents must also reset the draft and tool runtime.
const AgentComposer = (props: Props) => {
  return (
    <AgentComposerRoot
      key={props.agentId}
      {...props}
      deferQuickPanel
      renderControls={props.externalContextControls ? renderAgentInputControls : renderAgentToolbarControls}
    />
  )
}

export const AgentHomeComposer = (props: Props) => {
  return (
    <AgentComposerRoot
      key={props.agentId}
      {...props}
      canChangeAgent={props.canChangeAgent ?? true}
      forceNarrowLayout
      renderControls={renderAgentHomeControls}
    />
  )
}

export default AgentComposer
