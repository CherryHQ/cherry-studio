import { Button, NormalTooltip, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ContextUsageSummary, getAgentContextUsageColor } from '@renderer/components/chat/agent/ContextUsageSummary'
import OpenExternalAppButton from '@renderer/components/chat/panes/OpenExternalAppButton'
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
import type { ComposerSuggestionSource } from '@renderer/components/composer/quickPanel'
import { ComposerPanelSymbol, getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { getComposerToolConfig } from '@renderer/components/composer/tools/registry'
import type { ToolContext } from '@renderer/components/composer/tools/types'
import NewConversationIcon from '@renderer/components/icons/NewConversationIcon'
import { ModelSelector } from '@renderer/components/ModelSelector'
import type { QuickPanelInputAdapter, QuickPanelListItem } from '@renderer/components/QuickPanel'
import type { ResourceEditDialogTarget } from '@renderer/components/resourceCatalog/dialogs/edit'
import { AgentSelector, WorkspaceSelector } from '@renderer/components/resourceCatalog/selectors'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgent, useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { useAgentSessionCompaction } from '@renderer/hooks/agent/useAgentSessionCompaction'
import { useAgentSessionContextUsage } from '@renderer/hooks/agent/useAgentSessionContextUsage'
import { useAgentSessionSlashCommands } from '@renderer/hooks/agent/useAgentSessionSlashCommands'
import { useSession, useUpdateSession } from '@renderer/hooks/agent/useSession'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { useModelById } from '@renderer/hooks/useModel'
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
import { cn } from '@renderer/utils/style'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import type { AgentEntity } from '@shared/data/types/agent'
import type { FileUIPart } from '@shared/data/types/message'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { OutputFor } from '@shared/ipc/types'
import type { FilePath } from '@shared/types/file'
import type { LocalSkill } from '@shared/types/skill'
import { canonicalizeAbsolutePath, createFilePathHandle, toFileUrl } from '@shared/utils/file'
import { Bot, Cable, ChevronDown, CircleSlash, Folder, Sparkles, Terminal, TriangleAlert, X, Zap } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { InputHistoryDirection } from '../inputHistoryNavigation'
import { QueuedFollowupsDock } from '../QueuedFollowupsDock'
import type { ComposerDraftToken, ComposerSerializedDraft, ComposerSerializedToken } from '../tokens'
import { type FollowupQueueItem, useFollowupQueue } from '../useFollowupQueue'
import { useInputHistory } from '../useInputHistory'
import { isPathWithinAccessiblePath } from './agent/accessiblePath'
import {
  type AgentComposerDraftCache,
  getAgentDraftCacheKey,
  getCachedSkillTokens,
  getSkillFromCachedToken,
  readAgentDraftCache,
  writeAgentDraftCache
} from './agent/agentDraftCache'
import { AgentLabel } from './agent/AgentLabel'
import { useAgentResourceSearchProvider } from './agent/useAgentResourceSearchProvider'
import {
  agentComposerTokenId,
  agentFileToComposerToken,
  agentSkillToComposerToken,
  getAgentComposerTokenIds
} from './agentComposerTokens'
import {
  COMPOSER_BELOW_SELECTOR_BUTTON_CLASS,
  COMPOSER_ICON_ONLY_LABEL_CLASS,
  COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
  COMPOSER_SELECTOR_BUTTON_CLASS,
  COMPOSER_SEND_ACCESSORY_BUTTON_CLASS,
  COMPOSER_TOOLBAR_CLASS,
  ComposerBelowControls,
  ComposerToolbarControls,
  ComposerToolMenuControls
} from './shared/ComposerControlScaffolding'
import { emptyActions, type ProviderActionHandlers } from './shared/composerProviderActions'
import { buildComposerQueuedPayload } from './shared/composerQueuedPayload'
import { useComposerQuoteInsertion } from './shared/composerQuote'
import { type ComposerToolbarCustomTool, ComposerToolbarShortcuts } from './shared/ComposerToolbarShortcuts'
import { useComposerFileCapabilities } from './shared/useComposerFileCapabilities'
import { useComposerToolbarPinnedTools } from './shared/useComposerToolbarPinnedTools'
import { useLatest } from './shared/useLatest'

const logger = loggerService.withContext('AgentComposer')
const ResourceEditDialogHost = React.lazy(() =>
  import('@renderer/components/resourceCatalog/dialogs/edit').then((module) => ({
    default: module.ResourceEditDialogHost
  }))
)

const AGENT_MANAGED_TOKEN_KINDS = ['file', 'skill'] as const satisfies readonly ComposerDraftToken['kind'][]
const EMPTY_ACCESSIBLE_PATHS: readonly string[] = []
const EMPTY_SUGGESTION_SOURCES: readonly ComposerSuggestionSource[] = []
const FILE_IPC_BATCH_SIZE = 500

type AccessibleAttachment = {
  attachment: ComposerAttachment
  filePath: FilePath
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
  filePath: FilePath,
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
    if (isPathWithinAccessiblePath(attachment.path, accessiblePaths)) {
      accessibleAttachments.push({
        attachment,
        filePath: canonicalizeAbsolutePath(attachment.path) as FilePath,
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
    icon: <Zap size={16} />,
    suffix: options.skillLabel,
    // Skills still exclude descriptions from root-panel search; the category alias powers the persistent shortcut.
    filterText: skill.name,
    searchAliases: [options.skillLabel],
    action: ({ inputAdapter }) => {
      options.onInsertSkill(skill, inputAdapter)
    }
  }))
}

type AgentComposerWorkspacePreview = Pick<AgentWorkspaceEntity, 'type'> &
  Partial<Pick<AgentWorkspaceEntity, 'id' | 'name' | 'path'>>

type AgentComposerSessionSnapshot = {
  workspace?: AgentComposerWorkspacePreview | null
  workspaceId?: string | null
}

type Props = {
  agentId: string
  sessionId: string
  sessionOverride?: AgentComposerSessionSnapshot
  sendMessage: (message?: { text: string }, options?: { body?: Record<string, unknown> }) => Promise<void>
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
}

type AgentComposerRootProps = Props & {
  renderControls: AgentComposerControlsRenderer
  forceNarrowLayout?: boolean
}

const AgentComposerRoot = ({
  agentId,
  sessionId,
  sessionOverride,
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
  renderControls,
  forceNarrowLayout = false
}: AgentComposerRootProps) => {
  const { session: loadedSession } = useSession(sessionOverride ? null : sessionId)
  const session = sessionOverride ?? loadedSession
  const { agent } = useAgent(agentId)
  const { model: sessionModel } = useModelById(agent?.model)
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })
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
      slashCommands: sessionSlashCommands
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

  if (!session || !agent) return null

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
        model={sessionModel}
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
        renderControls={renderControls}
        forceNarrowLayout={forceNarrowLayout}
      />
    </ComposerToolRuntimeProvider>
  )
}

interface InnerProps {
  model?: Model
  agentId: string
  sessionId: string
  sessionData?: ToolContext['session']
  workspace?: AgentComposerWorkspacePreview | null
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
  renderControls: AgentComposerControlsRenderer
  forceNarrowLayout?: boolean
}

interface AgentComposerContextControlsProps {
  agent?: AgentEntity
  selectAgentLabel: string
  agentChanging?: boolean
  shouldAutoSelectCreatedAgent: boolean
  side: 'top' | 'bottom'
  iconOnly?: boolean
  agentTriggerMode: 'selector' | 'edit'
  onDialogCloseAutoFocus?: () => void
  onAgentChange: (agentId: string | null) => void | Promise<void>
}

interface AgentComposerWorkspaceControlProps {
  workspace?: AgentComposerWorkspacePreview | null
  workspaceId?: string | null
  workspaceChanging?: boolean
  workspaceWarning?: string
  selectWorkspaceLabel: string
  side: 'top' | 'bottom'
  iconOnly?: boolean
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
}

interface AgentComposerModelControlProps {
  model?: Model
  selectModelLabel: string
  canChangeModel: boolean
  side: 'top' | 'bottom'
  iconOnly?: boolean
  onModelSelect: (model: Model | undefined) => void
  modelFilter?: (model: Model) => boolean
}

const AgentComposerContextControls = ({
  agent,
  selectAgentLabel,
  agentChanging,
  shouldAutoSelectCreatedAgent,
  side,
  iconOnly = false,
  agentTriggerMode,
  onDialogCloseAutoFocus,
  onAgentChange
}: AgentComposerContextControlsProps) => {
  const baseTriggerClassName = side === 'bottom' ? COMPOSER_BELOW_SELECTOR_BUTTON_CLASS : COMPOSER_SELECTOR_BUTTON_CLASS
  const triggerClassName = cn(baseTriggerClassName, iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS)
  const labelClassName = cn('truncate', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)
  const chevronClassName = cn('text-muted-foreground', iconOnly && 'hidden')
  const [agentEditDialogTarget, setAgentEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)

  const agentTrigger = (
    <Button
      variant="ghost"
      size="sm"
      className={triggerClassName}
      disabled={agentChanging || (agentTriggerMode === 'edit' && !agent)}
      onClick={
        agentTriggerMode === 'edit' && agent
          ? () => setAgentEditDialogTarget({ kind: 'agent', id: agent.id })
          : undefined
      }>
      {agent ? (
        <AgentLabel
          agent={agent}
          avatarSize={20}
          classNames={{
            name: cn('max-w-40 text-xs', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS),
            container: 'gap-1.5'
          }}
        />
      ) : (
        <>
          {iconOnly ? <Bot size={20} aria-hidden /> : null}
          <span className={cn('max-w-40 text-muted-foreground', labelClassName)}>{selectAgentLabel}</span>
        </>
      )}
      {agentTriggerMode === 'selector' ? <ChevronDown size={14} className={chevronClassName} /> : null}
    </Button>
  )

  if (agentTriggerMode === 'edit') {
    return (
      <>
        {agentTrigger}
        {agentEditDialogTarget ? (
          <React.Suspense fallback={null}>
            <ResourceEditDialogHost
              target={agentEditDialogTarget}
              onOpenChange={(open) => {
                if (!open) {
                  setAgentEditDialogTarget(null)
                  onDialogCloseAutoFocus?.()
                }
              }}
            />
          </React.Suspense>
        ) : null}
      </>
    )
  }

  return (
    <AgentSelector
      value={agent?.id ?? null}
      onChange={onAgentChange}
      autoSelectOnCreate={shouldAutoSelectCreatedAgent}
      side={side}
      align="start"
      mountStrategy="lazy-keep"
      onDialogCloseAutoFocus={onDialogCloseAutoFocus}
      trigger={agentTrigger}
    />
  )
}

const AgentComposerModelControl = ({
  model,
  selectModelLabel,
  canChangeModel,
  side,
  iconOnly = false,
  onModelSelect,
  modelFilter
}: AgentComposerModelControlProps) => {
  const baseTriggerClassName = side === 'bottom' ? COMPOSER_BELOW_SELECTOR_BUTTON_CLASS : COMPOSER_SELECTOR_BUTTON_CLASS
  const triggerClassName = cn(baseTriggerClassName, iconOnly && model && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS)
  const labelClassName = cn('truncate', iconOnly && model && COMPOSER_ICON_ONLY_LABEL_CLASS)
  const modelLabel = model ? model.name : selectModelLabel
  const trigger = (
    <Button variant="ghost" size="sm" className={triggerClassName} disabled={!canChangeModel}>
      {model ? (
        <ModelAvatar model={model} size={20} className="shrink-0" />
      ) : (
        <Sparkles size={20} aria-hidden className="text-muted-foreground" />
      )}
      <span
        className={cn(
          'max-w-40 text-xs',
          canChangeModel ? (model ? 'text-foreground/85' : 'text-muted-foreground') : undefined,
          labelClassName
        )}>
        {modelLabel}
      </span>
      <ChevronDown size={14} aria-hidden className={cn('text-muted-foreground', iconOnly && model && 'hidden')} />
    </Button>
  )

  return (
    <ModelSelector
      multiple={false}
      value={model}
      onSelect={onModelSelect}
      filter={modelFilter}
      shortcut={canChangeModel ? 'chat.model.select' : undefined}
      side={side}
      align="start"
      mountStrategy="lazy-keep"
      trigger={trigger}
    />
  )
}

const AgentComposerWorkspaceControl = ({
  workspace,
  workspaceId,
  workspaceChanging,
  workspaceWarning,
  selectWorkspaceLabel,
  side,
  iconOnly = false,
  onWorkspaceChange
}: AgentComposerWorkspaceControlProps) => {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const baseTriggerClassName = side === 'bottom' ? COMPOSER_BELOW_SELECTOR_BUTTON_CLASS : COMPOSER_SELECTOR_BUTTON_CLASS
  const hasWarning = Boolean(workspaceWarning)
  const isSystemWorkspace = workspace?.type === 'system'
  const selectorValue = isSystemWorkspace ? null : workspaceId
  const workspaceLabel = isSystemWorkspace
    ? t('agent.session.workspace_selector.no_project')
    : (workspace?.name ?? selectWorkspaceLabel)
  const canQuickClearWorkspace = Boolean(onWorkspaceChange && workspace && !iconOnly)
  if (!onWorkspaceChange && workspace?.type === 'user' && workspace.path) {
    const openMenuTrigger = (
      <Button
        variant="ghost"
        size="sm"
        type="button"
        className={cn(
          baseTriggerClassName,
          'relative',
          iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
          hasWarning && 'text-warning hover:text-warning'
        )}
        aria-label={workspaceWarning}>
        {hasWarning ? (
          <TriangleAlert size={20} aria-hidden />
        ) : (
          <span className="relative flex size-5 shrink-0 items-center justify-center">
            <Folder size={20} aria-hidden className="shrink-0 text-muted-foreground" />
          </span>
        )}
        <span className={cn('max-w-40 truncate', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)}>{workspaceLabel}</span>
        <ChevronDown size={14} aria-hidden className={cn('text-muted-foreground', iconOnly && 'hidden')} />
      </Button>
    )
    return <OpenExternalAppButton workdir={workspace.path} menuTrigger={openMenuTrigger} tooltip={workspaceWarning} />
  }

  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      className={cn(
        baseTriggerClassName,
        !menuOpen && 'group',
        'relative',
        iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
        hasWarning && 'text-warning hover:text-warning'
      )}
      disabled={!onWorkspaceChange || workspaceChanging}
      aria-label={workspaceWarning}
      onClick={(event) => {
        const target = event.target as Element | null
        if (!canQuickClearWorkspace || !target?.closest('[data-clear-workspace-button]')) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        if (!workspaceChanging) void onWorkspaceChange?.(null)
      }}>
      {hasWarning ? (
        <TriangleAlert size={20} aria-hidden />
      ) : isSystemWorkspace ? (
        <CircleSlash size={20} aria-hidden className="text-muted-foreground" />
      ) : (
        <span className="relative flex size-5 shrink-0 items-center justify-center">
          <Folder
            size={20}
            aria-hidden
            className={cn(
              'shrink-0 text-muted-foreground transition-all duration-200',
              canQuickClearWorkspace && !menuOpen && 'group-hover:scale-75 group-hover:opacity-0'
            )}
          />
          {canQuickClearWorkspace && (
            <NormalTooltip content={t('agent.session.workspace_selector.no_project')} side="top">
              <span
                data-clear-workspace-button
                data-testid="clear-workspace-button"
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-0 z-10 flex scale-75 items-center justify-center rounded-full bg-transparent text-muted-foreground/95 opacity-0 transition-all duration-200 hover:bg-muted-foreground/25 hover:text-foreground active:scale-95',
                  !menuOpen && 'group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100',
                  workspaceChanging && 'cursor-not-allowed opacity-50'
                )}
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={(e) => e.preventDefault()}>
                <X size={10} className="stroke-[2.5]" />
              </span>
            </NormalTooltip>
          )}
        </span>
      )}
      <span className={cn('max-w-40 truncate', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)}>{workspaceLabel}</span>
      {onWorkspaceChange ? (
        <ChevronDown size={14} aria-hidden className={cn('text-muted-foreground', iconOnly && 'hidden')} />
      ) : null}
    </Button>
  )
  const selector = onWorkspaceChange ? (
    <WorkspaceSelector
      value={selectorValue}
      onChange={onWorkspaceChange}
      side={side}
      align="start"
      mountStrategy="lazy-keep"
      disabled={workspaceChanging}
      trigger={trigger}
      open={menuOpen}
      onOpenChange={setMenuOpen}
    />
  ) : (
    trigger
  )

  if (!hasWarning) return selector
  return <Tooltip content={workspaceWarning}>{selector}</Tooltip>
}

function AgentComposerContextUsage({ model, sessionId }: { model?: Model; sessionId: string }) {
  const { t } = useTranslation()
  const expectedModels = useMemo(() => getContextUsageModelCandidates(model), [model])
  const { percentage, usage } = useAgentSessionContextUsage(sessionId, expectedModels)
  const compaction = useAgentSessionCompaction(sessionId)
  if (percentage === null || !usage) return null

  const isCompacting = compaction.status === 'compacting'
  const ringColor = getAgentContextUsageColor(percentage)

  return (
    <Tooltip
      placement="top"
      sideOffset={8}
      showArrow={false}
      classNames={{
        placeholder: 'inline-grid',
        content: 'w-64 max-w-64 rounded-md border border-border bg-card p-3 text-card-foreground shadow-md'
      }}
      content={
        <ContextUsageSummary usage={usage} percentage={percentage} color={ringColor} isCompacting={isCompacting} />
      }>
      <span
        aria-label={`${t('agent.right_pane.info.context_usage')} ${percentage}%`}
        aria-busy={isCompacting || undefined}
        className={cn(
          'relative inline-grid size-5 shrink-0 place-items-center rounded-full bg-[conic-gradient(var(--context-usage-color)_var(--context-usage-progress),var(--color-border-subtle)_0)]',
          isCompacting && 'animate-pulse'
        )}
        style={
          {
            '--context-usage-color': ringColor,
            '--context-usage-progress': `${percentage}%`
          } as React.CSSProperties
        }>
        <span aria-hidden className="absolute inset-[2px] rounded-full bg-card" />
      </span>
    </Tooltip>
  )
}

function getContextUsageModelCandidates(model: Model | undefined): string[] | undefined {
  if (!model) return undefined
  return [model.apiModelId, parseUniqueModelId(model.id).modelId].filter((value): value is string => Boolean(value))
}

type AgentComposerControlProps = Omit<AgentComposerContextControlsProps, 'side'> & {
  topBarPortalAvailable: boolean
  topBarPortalIconOnly: boolean
  model?: Model
  selectModelLabel: string
  canChangeModel: boolean
  onModelSelect: (model: Model | undefined) => void
  modelFilter?: (model: Model) => boolean
  leadingControl?: React.ReactNode
  renderQuickPanelShortcuts?: (args: {
    inputAdapter?: AgentComposerInputAdapter
    unifiedPanelControl?: AgentComposerUnifiedPanelControl
  }) => React.ReactNode
  renderWorkspaceControl?: (args: { side: 'top' | 'bottom'; iconOnly?: boolean }) => React.ReactNode
}
type ComposerSurfaceProps = React.ComponentProps<typeof ComposerSurface>
type AgentComposerControlSlots = Pick<ComposerSurfaceProps, 'renderLeftControls' | 'renderBelowControls'>
type AgentComposerControlsRenderer = (props: AgentComposerControlProps) => AgentComposerControlSlots

type AgentComposerInputAdapter = Parameters<NonNullable<ComposerSurfaceProps['renderLeftControls']>>[0]
type AgentComposerUnifiedPanelControl = Parameters<NonNullable<ComposerSurfaceProps['renderLeftControls']>>[1]

const restoreAgentComposerInputFocus = (inputAdapter: AgentComposerInputAdapter) => {
  window.requestAnimationFrame(() => inputAdapter?.focus())
}

const AgentComposerContextControlsWithAutoFocus = ({
  inputAdapter,
  ...props
}: AgentComposerContextControlsProps & { inputAdapter: AgentComposerInputAdapter }) => {
  const onDialogCloseAutoFocus = useCallback(() => restoreAgentComposerInputFocus(inputAdapter), [inputAdapter])

  return <AgentComposerContextControls {...props} onDialogCloseAutoFocus={onDialogCloseAutoFocus} />
}

const renderAgentComposerContextControls = (
  props: AgentComposerControlProps,
  inputAdapter: AgentComposerInputAdapter,
  { side, iconOnly }: { side: 'top' | 'bottom'; iconOnly: boolean }
) => {
  const resolvedSide = props.topBarPortalAvailable ? 'bottom' : side
  const resolvedIconOnly = props.topBarPortalAvailable ? props.topBarPortalIconOnly : iconOnly
  const controls = (
    <>
      <AgentComposerContextControlsWithAutoFocus
        {...props}
        side={resolvedSide}
        iconOnly={resolvedIconOnly}
        inputAdapter={inputAdapter}
      />
      <AgentComposerModelControl {...props} side={resolvedSide} iconOnly={resolvedIconOnly} />
      {props.renderWorkspaceControl?.({ side: resolvedSide, iconOnly: resolvedIconOnly })}
    </>
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
    }
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
  model,
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
  renderControls,
  forceNarrowLayout = false
}: InnerProps) => {
  const { agent: agentBase } = useAgent(agentId)
  const { updateModel } = useUpdateAgent()
  const { updateSession } = useUpdateSession()
  const scope = TopicType.Session
  const config = getComposerToolConfig(scope)
  const { files, isExpanded } = useComposerToolState()
  const { setFiles, setIsExpanded } = useComposerToolDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherActions()
  const toolLaunchersVersion = useComposerToolLauncherVersion()
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const [narrowMode] = usePreference('chat.narrow_mode')
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
  const agentModelFilter = useAgentModelFilter(agentBase?.type)
  const { setTimeoutTimer, clearTimeoutTimer } = useTimer()
  const [workspaceWarning, setWorkspaceWarning] = useState<string | undefined>(undefined)
  const initialDraftRef = useRef<AgentComposerDraftCache | null>(null)
  if (initialDraftRef.current === null) {
    initialDraftRef.current = readAgentDraftCache(getAgentDraftCacheKey(agentId))
  }

  const [reasoningEffort, setReasoningEffort] = useState<ThinkingOption>('default')
  const [selectedSkills, setSelectedSkills] = useState<LocalSkill[]>(() =>
    initialDraftRef.current ? initialDraftRef.current.tokens.map(getSkillFromCachedToken) : []
  )
  const draftCacheKey = getAgentDraftCacheKey(agentId)
  const [text, setTextState] = useState(() => initialDraftRef.current?.text ?? '')
  const [draftTokens, setDraftTokens] = useState<ComposerSerializedToken[]>(() => initialDraftRef.current?.tokens ?? [])
  const textRef = useRef(text)
  const draftTokensRef = useRef(draftTokens)
  const sessionTopicId = buildAgentSessionTopicId(sessionId)
  const accessiblePaths = sessionData?.accessiblePaths ?? EMPTY_ACCESSIBLE_PATHS
  const enableMentionModelTrigger = accessiblePaths.length > 0
  const userWorkspacePath = workspace?.type === 'user' ? workspace.path : undefined
  const { skills: availableSkills, refresh: refreshAvailableSkills } = useAvailableSkills(agentId, userWorkspacePath)

  const { canAddImageFile, supportedExts } = useComposerFileCapabilities(model)

  useEffect(() => {
    const workspacePath = userWorkspacePath
    if (!workspacePath) {
      setWorkspaceWarning(undefined)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const isDirectory = await window.api.file.isDirectory(workspacePath)
        if (cancelled) return
        if (isDirectory) {
          setWorkspaceWarning(undefined)
          return
        }
        setWorkspaceWarning(t('agent.session.workspace_status.inaccessible', { path: workspacePath }))
      } catch (error) {
        logger.warn('Failed to check agent workspace path status', error as Error)
        if (!cancelled) setWorkspaceWarning(undefined)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [t, userWorkspacePath])

  const setText = useCallback(
    (nextText: string, options: { persist?: boolean } = {}) => {
      clearTimeoutTimer('agentComposerSendMessage')
      textRef.current = nextText
      setTextState(nextText)
      if (options.persist ?? true) {
        writeAgentDraftCache(draftCacheKey, nextText, draftTokensRef.current)
      }
    },
    [clearTimeoutTimer, draftCacheKey]
  )
  const filesRef = useLatest(files)
  const inputHistoryFilesRef = useRef<ComposerAttachment[] | null>(null)
  const applyHistoryDraft = useCallback(
    (historyDraft: ComposerSerializedDraft, options: { source: 'history' | 'draft' }) => {
      const nextSkillTokens = getCachedSkillTokens(historyDraft.tokens)
      const persistDraft = options.source === 'draft'
      actionsRef.current.replaceDraft(historyDraft)
      setText(historyDraft.text, { persist: false })
      setDraftTokens(nextSkillTokens)
      draftTokensRef.current = nextSkillTokens
      if (persistDraft) {
        writeAgentDraftCache(draftCacheKey, historyDraft.text, nextSkillTokens)
      }
      setSelectedSkills(nextSkillTokens.map(getSkillFromCachedToken))

      if (options.source === 'history') {
        inputHistoryFilesRef.current ??= filesRef.current
        setFiles([])
        return
      }

      const savedFiles = inputHistoryFilesRef.current
      inputHistoryFilesRef.current = null
      if (!savedFiles) return
      setFiles(savedFiles)
    },
    [actionsRef, draftCacheKey, filesRef, setFiles, setText]
  )
  const { navigateHistory, resetHistoryIndex, saveHistory } = useInputHistory({
    applyDraft: applyHistoryDraft
  })
  const handleTextChange = useCallback(
    (nextText: string) => {
      resetHistoryIndex()
      inputHistoryFilesRef.current = null
      setText(nextText)
    },
    [resetHistoryIndex, setText]
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

  const tokens = useMemo(
    () => [...files.map(agentFileToComposerToken), ...selectedSkills.map(agentSkillToComposerToken)],
    [files, selectedSkills]
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

  const rootPanelTrailingItems = useMemo(
    () => [
      ...createSkillQuickPanelItems(availableSkills, {
        skillLabel: t('plugins.skills'),
        onInsertSkill: insertSkillToken
      }),
      customizePanelItem
    ],
    [availableSkills, customizePanelItem, insertSkillToken, t]
  )

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
    (nextModel?: Model) => {
      if (!canChangeModel || !nextModel || nextModel.id === model?.id) return
      void updateModel(agentId, nextModel.id, { showSuccessToast: false })
    },
    [agentId, canChangeModel, model?.id, updateModel]
  )

  const handleCreateEmptySession = useCallback(() => {
    void onCreateEmptySession?.()
  }, [onCreateEmptySession])
  const hasNewSessionAction = Boolean(agentBase && onCreateEmptySession)

  const rootPanelNewSessionItems = useMemo<QuickPanelListItem[]>(() => {
    if (!hasNewSessionAction) return []

    const label = t('agent.session.new')

    return [
      {
        id: 'composer:new-session',
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

  const toolsSession = useMemo(() => {
    if (!sessionData) return undefined
    return { ...sessionData, reasoningEffort, onReasoningEffortChange: setReasoningEffort }
  }, [sessionData, reasoningEffort])

  // File reconcile (prune + dedup) is owned by attachmentTool via the tools DI seam. Skill
  // reconcile stays here (agent-only, no shared duplication) alongside the editor draft-token
  // cache snapshot, which is variant state.
  const reconcileTokens = useComposerTokenReconcile({ scope, model, session: toolsSession })
  const handleTokensChange = useCallback(
    (draftTokens: readonly ComposerSerializedToken[]) => {
      const nextDraftTokens = getCachedSkillTokens(draftTokens)
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
    (draft: ComposerSerializedDraft): ComposerQueuedMessagePayload | null =>
      buildComposerQueuedPayload(draft, { files, fileTokenId: agentComposerTokenId.file }),
    [files]
  )

  const sendQueuedPayload = useCallback(
    async (payload: ComposerQueuedMessagePayload) => {
      try {
        const attachments = (payload.attachments as ComposerAttachment[] | undefined) ?? []
        const fileParts = await buildAgentFilePartsForAttachments(attachments, accessiblePaths)
        await chatSendMessage(
          { text: payload.text },
          { body: { agentId, sessionId, userMessageParts: [...payload.userMessageParts, ...fileParts] } }
        )
        void EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: sessionTopicId })
        saveHistory(payload.text)
        return true
      } catch (error: unknown) {
        logger.warn('Failed to send message:', error as Error)
        return false
      }
    },
    [accessiblePaths, agentId, chatSendMessage, saveHistory, sessionId, sessionTopicId]
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
    inputHistoryFilesRef.current = null
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

  // Edit a queued item = atomically restore the whole editor draft, then synchronize the persisted
  // skill subset and managed file/skill state before dropping it from the queue.
  const restoreFollowupDraft = useCallback(
    (item: FollowupQueueItem) => {
      const nextDraftTokens = getCachedSkillTokens(item.draft.tokens)
      resetHistoryIndex()
      inputHistoryFilesRef.current = null
      actionsRef.current.replaceDraft(item.draft)
      setDraftTokens(nextDraftTokens)
      draftTokensRef.current = nextDraftTokens
      setText(item.draft.text)
      setFiles((item.payload.attachments as ComposerAttachment[] | undefined) ?? [])
      setSelectedSkills(nextDraftTokens.map(getSkillFromCachedToken))
    },
    [actionsRef, resetHistoryIndex, setFiles, setText]
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

  const resourceProvider = useAgentResourceSearchProvider({
    accessiblePaths,
    files,
    setFiles,
    enabled: enableMentionModelTrigger
  })

  const renderWorkspaceControl = ({ side, iconOnly = false }: { side: 'top' | 'bottom'; iconOnly?: boolean }) => (
    <AgentComposerWorkspaceControl
      workspace={workspace}
      workspaceId={workspaceId}
      workspaceWarning={workspaceWarning}
      selectWorkspaceLabel={t('agent.session.workspace_selector.placeholder')}
      workspaceChanging={workspaceChanging}
      side={side}
      iconOnly={iconOnly}
      onWorkspaceChange={onWorkspaceChange}
    />
  )

  const newSessionControl = hasNewSessionAction ? (
    <Tooltip content={t('agent.session.new')} placement="top">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn(COMPOSER_SEND_ACCESSORY_BUTTON_CLASS, '[&_.new-conversation-icon]:!size-5')}
        aria-label={t('agent.session.new')}
        onClick={handleCreateEmptySession}>
        <NewConversationIcon size={20} aria-hidden />
      </Button>
    </Tooltip>
  ) : undefined

  const toolbarCustomTools = useMemo<ComposerToolbarCustomTool[]>(() => {
    const skillLabel = t('plugins.skills')
    const slashCommandsLabel = t('chat.input.slash_commands.title')
    return [
      {
        id: 'skills',
        label: skillLabel,
        icon: <Zap size={18} aria-hidden />,
        onSelect: ({ unifiedPanelControl }) => unifiedPanelControl?.open({ searchText: skillLabel })
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
        icon: <Cable size={18} aria-hidden />,
        onSelect: ({ unifiedPanelControl }) =>
          unifiedPanelControl?.open({ launcherId: ComposerPanelSymbol.McpStatus, searchText: 'MCP' })
      }
    ]
  }, [t])

  const renderQuickPanelShortcuts = useCallback(
    ({
      inputAdapter,
      unifiedPanelControl
    }: {
      inputAdapter?: AgentComposerInputAdapter
      unifiedPanelControl?: AgentComposerUnifiedPanelControl
    }) => (
      <ComposerToolbarShortcuts
        pinnedIds={pinnedToolIds}
        onPinnedIdsChange={setPinnedToolIds}
        onResetPinnedIds={resetPinnedToolIds}
        isDefault={pinnedToolsAtDefault}
        customTools={toolbarCustomTools}
        customizeOpen={customizeToolbarOpen}
        onCustomizeOpenChange={setCustomizeToolbarOpen}
        inputAdapter={inputAdapter}
        unifiedPanelControl={unifiedPanelControl}
      />
    ),
    [
      customizeToolbarOpen,
      pinnedToolIds,
      pinnedToolsAtDefault,
      resetPinnedToolIds,
      setCustomizeToolbarOpen,
      setPinnedToolIds,
      toolbarCustomTools
    ]
  )

  const controlSlots = renderControls({
    agent: agentBase,
    model,
    selectAgentLabel: t('chat.alerts.select_agent'),
    selectModelLabel: t('button.select_model'),
    agentChanging,
    agentTriggerMode: canChangeAgent ? 'selector' : 'edit',
    shouldAutoSelectCreatedAgent: true,
    topBarPortalAvailable,
    topBarPortalIconOnly,
    canChangeModel,
    onModelSelect: handleModelSelect,
    modelFilter: agentModelFilter,
    leadingControl: newSessionControl,
    renderQuickPanelShortcuts,
    onAgentChange: handleAgentChange,
    renderWorkspaceControl
  })

  const sendAccessory: ComposerSurfaceProps['sendAccessory'] = (
    <AgentComposerContextUsage model={model} sessionId={sessionId} />
  )

  return (
    <ComposerToolDerivedStateProvider couldAddImageFile={canAddImageFile} extensions={supportedExts}>
      {model && <ComposerToolRuntimeHost scope={scope} model={model} session={toolsSession} />}
      <ComposerPinnedToolsProvider value={pinnedToolIds}>
        <ComposerSurface
          text={text}
          onTextChange={handleTextChange}
          tokens={tokens}
          draftTokens={draftTokens}
          managedTokenKinds={AGENT_MANAGED_TOKEN_KINDS}
          onTokensChange={handleTokensChange}
          resolveSkillMarker={resolveSkillMarker}
          placeholder={placeholderText}
          sendDisabled={sendDisabled || (text.trim().length === 0 && files.length === 0 && selectedSkills.length === 0)}
          sendBlockedReason={sendDisabled ? t('common.loading') : undefined}
          isLoading={isStreaming}
          onSendDraft={handleSendDraft}
          onPause={abortAgentSession}
          queueContent={
            queuedFollowups.length > 0 ? (
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
            ) : undefined
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
          onActionsChange={handleSurfaceActionsChange}
          onInputHistoryNavigate={handleInputHistoryNavigate}
          getToolLaunchers={() => getLaunchers()}
          toolLaunchersVersion={toolLaunchersVersion}
          suggestionSources={EMPTY_SUGGESTION_SOURCES}
          resourceProvider={resourceProvider}
          rootPanelLeadingItems={rootPanelNewSessionItems}
          rootPanelAdditionalItems={rootPanelTrailingItems}
          onRootPanelOpen={handleRootPanelOpen}
          onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
          sendAccessory={sendAccessory}
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
    agentChanging,
    agentTriggerMode: 'selector',
    shouldAutoSelectCreatedAgent: true,
    topBarPortalAvailable,
    topBarPortalIconOnly,
    canChangeModel: false,
    onAgentChange: handleAgentChange,
    onModelSelect: () => undefined,
    // Show the workspace/folder selector as a disabled placeholder (no session to bind yet);
    // it becomes live once an agent is picked and the real composer mounts.
    renderWorkspaceControl: ({ side, iconOnly = false }) => (
      <AgentComposerWorkspaceControl
        selectWorkspaceLabel={t('agent.session.workspace_selector.placeholder')}
        side={side}
        iconOnly={iconOnly}
      />
    )
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
        onActionsChange={handleSurfaceActionsChange}
        getToolLaunchers={() => getLaunchers()}
        toolLaunchersVersion={toolLaunchersVersion}
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
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
  return <AgentComposerRoot key={props.agentId} {...props} renderControls={renderAgentToolbarControls} />
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
