import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ContextUsageSummary, getAgentContextUsageColor } from '@renderer/components/chat/agent/ContextUsageSummary'
import ComposerSurface, { type ComposerSurfaceActions } from '@renderer/components/composer/ComposerSurface'
import {
  ComposerToolDerivedStateProvider,
  ComposerToolRuntimeHost,
  ComposerToolRuntimeProvider,
  useComposerTokenReconcile,
  useComposerToolDispatch,
  useComposerToolLauncherActions,
  useComposerToolState
} from '@renderer/components/composer/ComposerToolRuntime'
import { getComposerToolConfig } from '@renderer/components/composer/tools/registry'
import type { ToolContext } from '@renderer/components/composer/tools/types'
import type { QuickPanelInputAdapter, QuickPanelListItem } from '@renderer/components/QuickPanel'
import { AgentSelector, WorkspaceSelector } from '@renderer/components/resource'
import type { ResourceEditDialogTarget } from '@renderer/components/resource/dialogs'
import { ModelSelector } from '@renderer/components/Selector'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { isSoulModeEnabled } from '@renderer/hooks/agent/agentConfiguration'
import { useAgent, useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { useAgentSessionCompaction } from '@renderer/hooks/agent/useAgentSessionCompaction'
import { useAgentSessionContextUsage } from '@renderer/hooks/agent/useAgentSessionContextUsage'
import { useSession, useUpdateSession } from '@renderer/hooks/agent/useSession'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviderDisplayName } from '@renderer/hooks/useProvider'
import { useAvailableSkills } from '@renderer/hooks/useSkills'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ThinkingOption } from '@renderer/types/reasoning'
import { TopicType } from '@renderer/types/topic'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { buildFilePartsForAttachments } from '@renderer/utils/file/buildFileParts'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { cn } from '@renderer/utils/style'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import type { AgentEntity } from '@shared/data/types/agent'
import { type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { LocalSkill } from '@shared/types/skill'
import { Bot, ChevronDown, CircleSlash, Folder, Sparkles, TriangleAlert } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { QueuedFollowupsDock } from '../QueuedFollowupsDock'
import type { ComposerDraftToken, ComposerSerializedDraft, ComposerSerializedToken } from '../tokens'
import { type FollowupQueueItem, useFollowupQueue } from '../useFollowupQueue'
import {
  type AgentComposerDraftCache,
  getAgentDraftCacheKey,
  getCachedSkillTokens,
  getSkillFromCachedToken,
  readAgentDraftCache,
  writeAgentDraftCache
} from './agent/agentDraftCache'
import { AgentLabel } from './agent/AgentLabel'
import { useAgentResourceSuggestion } from './agent/useAgentResourceSuggestion'
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
  COMPOSER_TOOLBAR_CLASS,
  ComposerBelowControls,
  type ComposerNewConversationAction,
  ComposerToolbarControls,
  ComposerToolMenuControls
} from './shared/ComposerControlScaffolding'
import { emptyActions, type ProviderActionHandlers } from './shared/composerProviderActions'
import { buildComposerQueuedPayload } from './shared/composerQueuedPayload'
import { useComposerQuoteInsertion } from './shared/composerQuote'
import { useComposerFileCapabilities } from './shared/useComposerFileCapabilities'

const logger = loggerService.withContext('AgentComposer')
const ResourceEditDialogHost = React.lazy(() =>
  import('@renderer/components/resource/dialogs/ResourceEditDialogHost').then((module) => ({
    default: module.ResourceEditDialogHost
  }))
)

const AGENT_MANAGED_TOKEN_KINDS = ['file', 'skill'] as const satisfies readonly ComposerDraftToken['kind'][]

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
    icon: <Sparkles size={16} />,
    suffix: options.skillLabel,
    filterText: `${skill.name} ${skill.description ?? ''} ${options.skillLabel}`,
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
  onNewSessionDraft?: () => void | Promise<void>
  onCreateEmptySession?: () => void | Promise<void>
  onAgentChange?: (agentId: string | null) => void | Promise<void>
  agentChanging?: boolean
  workspaceId?: string | null
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  showWorkspaceSelector?: boolean
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
  onNewSessionDraft,
  onCreateEmptySession,
  onAgentChange,
  agentChanging,
  workspaceId,
  onWorkspaceChange,
  showWorkspaceSelector,
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
  const { model: sessionModel } = useModelById((agent?.model ?? '') as UniqueModelId)
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })
  const handleNewSessionShortcut = useCallback(() => {
    if (onCreateEmptySession) {
      void onCreateEmptySession()
      return
    }

    void onNewSessionDraft?.()
  }, [onCreateEmptySession, onNewSessionDraft])

  const isActiveTab = useIsActiveTab()
  useCommandHandler('topic.create', handleNewSessionShortcut, {
    enabled: isActiveTab && Boolean(session && agent && (onNewSessionDraft || onCreateEmptySession))
  })

  const sessionData = useMemo(() => {
    if (!session || !agent) return undefined
    const accessiblePaths = session.workspace?.type === 'user' && session.workspace.path ? [session.workspace.path] : []
    return {
      agentId,
      sessionId,
      agentType: agent.type,
      accessiblePaths
    }
  }, [session, agent, agentId, sessionId])

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
      initialState={initialState}
      actions={{
        onTextChange: (updater) => actionsRef.current.onTextChange(updater),
        addNewTopic: () => {
          void onNewSessionDraft?.()
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
        onWorkspaceChange={onWorkspaceChange}
        showWorkspaceSelector={showWorkspaceSelector}
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
  onWorkspaceChange?: Props['onWorkspaceChange']
  showWorkspaceSelector?: boolean
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
  showAgentTrigger?: boolean
  agentTriggerMode?: 'selector' | 'edit'
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
  modelProviderName?: string
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
  showAgentTrigger = true,
  agentTriggerMode = 'selector',
  onAgentChange
}: AgentComposerContextControlsProps) => {
  const baseTriggerClassName = side === 'bottom' ? COMPOSER_BELOW_SELECTOR_BUTTON_CLASS : COMPOSER_SELECTOR_BUTTON_CLASS
  const triggerClassName = cn(baseTriggerClassName, iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS)
  const labelClassName = cn('truncate', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)
  const chevronClassName = cn('text-muted-foreground', iconOnly && 'hidden')
  const [agentEditDialogTarget, setAgentEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)

  if (!showAgentTrigger) return null

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
          classNames={{
            name: cn('max-w-40 text-xs', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS),
            avatar: 'h-4.5 w-4.5',
            container: 'gap-1.5'
          }}
        />
      ) : (
        <>
          {iconOnly ? <Bot size={16} aria-hidden /> : null}
          <span className={cn('max-w-40 text-muted-foreground', labelClassName)}>{selectAgentLabel}</span>
        </>
      )}
      {agentTriggerMode === 'selector' ? <ChevronDown size={14} className={chevronClassName} /> : null}
    </Button>
  )

  return (
    <>
      {agentTriggerMode === 'edit' ? (
        <>
          {agentTrigger}
          {agentEditDialogTarget ? (
            <React.Suspense fallback={null}>
              <ResourceEditDialogHost
                target={agentEditDialogTarget}
                onOpenChange={(open) => {
                  if (!open) setAgentEditDialogTarget(null)
                }}
              />
            </React.Suspense>
          ) : null}
        </>
      ) : (
        <AgentSelector
          value={agent?.id ?? null}
          onChange={onAgentChange}
          autoSelectOnCreate={shouldAutoSelectCreatedAgent}
          side={side}
          align="start"
          mountStrategy="lazy-keep"
          trigger={agentTrigger}
        />
      )}
    </>
  )
}

const AgentComposerModelControl = ({
  model,
  modelProviderName,
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
  const modelLabel = model ? `${model.name}${modelProviderName ? ` | ${modelProviderName}` : ''}` : selectModelLabel
  const trigger = (
    <Button variant="ghost" size="sm" className={triggerClassName} disabled={!canChangeModel}>
      {model ? (
        <ModelAvatar model={model} size={16} className="shrink-0" />
      ) : (
        <Sparkles size={16} aria-hidden className="text-muted-foreground" />
      )}
      <span
        className={cn(
          'max-w-40 text-xs',
          canChangeModel ? (model ? 'text-foreground/85' : 'text-muted-foreground') : undefined,
          labelClassName
        )}>
        {modelLabel}
      </span>
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
  const baseTriggerClassName = side === 'bottom' ? COMPOSER_BELOW_SELECTOR_BUTTON_CLASS : COMPOSER_SELECTOR_BUTTON_CLASS
  const hasWarning = Boolean(workspaceWarning)
  const isSystemWorkspace = workspace?.type === 'system'
  const selectorValue = isSystemWorkspace ? null : workspaceId
  const workspaceLabel = isSystemWorkspace
    ? t('agent.session.workspace_selector.no_project')
    : (workspace?.name ?? selectWorkspaceLabel)
  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        baseTriggerClassName,
        iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
        hasWarning && 'text-warning hover:text-warning'
      )}
      disabled={!onWorkspaceChange || workspaceChanging}
      aria-label={workspaceWarning}>
      {hasWarning ? (
        <TriangleAlert size={14} aria-hidden />
      ) : isSystemWorkspace ? (
        <CircleSlash size={14} aria-hidden className="text-muted-foreground" />
      ) : (
        <Folder size={14} aria-hidden className="text-muted-foreground" />
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
  newConversationAction?: ComposerNewConversationAction
  model?: Model
  modelProviderName?: string
  selectModelLabel: string
  canChangeModel: boolean
  onModelSelect: (model: Model | undefined) => void
  modelFilter?: (model: Model) => boolean
  renderWorkspaceControl?: (args: { side: 'top' | 'bottom'; iconOnly?: boolean }) => React.ReactNode
}
type ComposerSurfaceProps = React.ComponentProps<typeof ComposerSurface>
type AgentComposerControlSlots = Pick<ComposerSurfaceProps, 'renderLeftControls' | 'renderBelowControls'> & {
  placesWorkspaceInBelowControls?: boolean
}
type AgentComposerControlsRenderer = (props: AgentComposerControlProps) => AgentComposerControlSlots

// Active agent sessions are bound to their agent, so the agent trigger opens edit instead of switching.
const renderAgentToolbarControls: AgentComposerControlsRenderer = (props) => {
  return {
    renderLeftControls: (inputAdapter) => (
      <ComposerToolbarControls
        inputAdapter={inputAdapter}
        newConversationAction={props.newConversationAction}
        // Classic layout hides the agent trigger (switching lives in the left rail), freeing the toolbar's
        // leading slot — so the tool menu sits before the context controls. Modern layout keeps the
        // trigger, so the menu stays after.
        toolMenuPlacement={props.showAgentTrigger === false ? 'afterContext' : 'beforeContext'}
        renderContextControls={({ side, iconOnly }) => (
          <>
            <AgentComposerContextControls {...props} side={side} iconOnly={iconOnly} agentTriggerMode="edit" />
            <AgentComposerModelControl {...props} side={side} iconOnly={iconOnly} />
          </>
        )}
      />
    )
  }
}

const renderAgentHomeControls: AgentComposerControlsRenderer = (props) => {
  return {
    renderLeftControls: (inputAdapter) => (
      <div className={COMPOSER_TOOLBAR_CLASS}>
        <ComposerToolMenuControls inputAdapter={inputAdapter} newConversationAction={props.newConversationAction} />
      </div>
    ),
    renderBelowControls: () => (
      <ComposerBelowControls
        renderContextControls={({ side, iconOnly }) => (
          <>
            <AgentComposerContextControls {...props} side={side} iconOnly={iconOnly} />
            <AgentComposerModelControl {...props} side={side} iconOnly={iconOnly} />
          </>
        )}
        trailing={
          props.renderWorkspaceControl
            ? ({ iconOnly }) => props.renderWorkspaceControl?.({ side: 'bottom', iconOnly })
            : undefined
        }
      />
    ),
    placesWorkspaceInBelowControls: true
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
  onWorkspaceChange,
  showWorkspaceSelector,
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
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const [narrowMode] = usePreference('chat.narrow_mode')
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [sessionLayout] = usePreference('agent.layout')
  const { t } = useTranslation()
  const modelProviderName = useProviderDisplayName(model?.providerId)
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
  const accessiblePaths = sessionData?.accessiblePaths ?? []
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
    (nextText: string) => {
      textRef.current = nextText
      setTextState(nextText)
      writeAgentDraftCache(draftCacheKey, nextText, draftTokensRef.current)
    },
    [draftCacheKey]
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

  const rootPanelSkillItems = useMemo(
    () =>
      createSkillQuickPanelItems(availableSkills, {
        skillLabel: t('plugins.skills'),
        onInsertSkill: insertSkillToken
      }),
    [availableSkills, insertSkillToken, t]
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

  const placeholderText = useMemo(() => {
    if (isSoulModeEnabled(agentBase?.configuration)) return t('agent.input.soul_placeholder')
    return t('agent.input.placeholder', {
      key: getSendMessageShortcutLabel(sendMessageShortcut)
    })
  }, [agentBase?.configuration, sendMessageShortcut, t])

  const buildQueuedPayload = useCallback(
    (draft: ComposerSerializedDraft): ComposerQueuedMessagePayload | null =>
      buildComposerQueuedPayload(draft, { files, fileTokenId: agentComposerTokenId.file }),
    [files]
  )

  const sendQueuedPayload = useCallback(
    async (payload: ComposerQueuedMessagePayload) => {
      try {
        const attachments = (payload.attachments as ComposerAttachment[] | undefined) ?? []
        const fileParts = await buildFilePartsForAttachments(attachments)
        await chatSendMessage(
          { text: payload.text },
          { body: { agentId, sessionId, userMessageParts: [...payload.userMessageParts, ...fileParts] } }
        )
        void EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: sessionTopicId })
        return true
      } catch (error: unknown) {
        logger.warn('Failed to send message:', error as Error)
        return false
      }
    },
    [agentId, chatSendMessage, sessionId, sessionTopicId]
  )

  const clearCurrentDraft = useCallback(() => {
    setText('')
    setFiles([])
    setSelectedSkills([])
    setDraftTokens([])
    draftTokensRef.current = []
    writeAgentDraftCache(draftCacheKey, '', [])
    setTimeoutTimer('agentComposerSendMessage', () => setText(''), 500)
  }, [draftCacheKey, setFiles, setText, setTimeoutTimer])

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
    onDrainFailed: () => window.toast?.error(t('chat.input.send_failed'))
  })

  // Edit a queued item = restore the draft (text + files + skills) into the live composer, then drop
  // it from the queue. Agent editor tokens derive from `files` + `selectedSkills`, so set those.
  const restoreFollowupDraft = useCallback(
    (item: FollowupQueueItem) => {
      setText(item.draft.text)
      setFiles((item.payload.attachments as ComposerAttachment[] | undefined) ?? [])
      setSelectedSkills(item.draft.tokens.filter((token) => token.kind === 'skill').map(getSkillFromCachedToken))
    },
    [setFiles, setText]
  )

  const handleSendDraft = useCallback(
    (draft: ComposerSerializedDraft) => {
      if (sendDisabled) return
      if (!model) {
        window.toast?.error(t('code.model_required'))
        return
      }
      if (workspaceWarning) {
        window.toast?.error(workspaceWarning)
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
      void sendQueuedPayload(payload).then((sent) => {
        if (!sent) {
          clearTimeoutTimer('agentComposerSendMessage')
          setText(previousText)
          setFiles(previousFiles)
          setSelectedSkills(previousSkills)
          setDraftTokens(previousDraftTokens)
          draftTokensRef.current = previousDraftTokens
          writeAgentDraftCache(draftCacheKey, previousText, previousDraftTokens)
          window.toast?.error(t('chat.input.send_failed'))
        }
      })
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

  const suggestionSources = useAgentResourceSuggestion({
    accessiblePaths,
    files,
    setFiles,
    enabled: enableMentionModelTrigger
  })

  const renderWorkspaceControl = showWorkspaceSelector
    ? ({ side, iconOnly = false }: { side: 'top' | 'bottom'; iconOnly?: boolean }) => (
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
    : undefined

  const renderedControlSlots = renderControls({
    agent: agentBase,
    model,
    modelProviderName,
    selectAgentLabel: t('chat.alerts.select_agent'),
    selectModelLabel: t('button.select_model'),
    agentChanging,
    shouldAutoSelectCreatedAgent: Boolean(onAgentChange),
    showAgentTrigger: sessionLayout !== 'classic',
    canChangeModel,
    onModelSelect: handleModelSelect,
    modelFilter: agentModelFilter,
    newConversationAction:
      onCreateEmptySession && agentBase
        ? {
            label: t('agent.session.new'),
            onClick: handleCreateEmptySession
          }
        : undefined,
    onAgentChange: handleAgentChange,
    renderWorkspaceControl
  })
  const { placesWorkspaceInBelowControls, ...controlSlots } = renderedControlSlots

  const sendAccessory = (
    <div className="flex items-center gap-1.5">
      {!placesWorkspaceInBelowControls ? renderWorkspaceControl?.({ side: 'top' }) : null}
      <AgentComposerContextUsage model={model} sessionId={sessionId} />
    </div>
  )

  return (
    <ComposerToolDerivedStateProvider couldAddImageFile={canAddImageFile} extensions={supportedExts}>
      {model && <ComposerToolRuntimeHost scope={scope} model={model} session={toolsSession} />}
      <ComposerSurface
        text={text}
        onTextChange={setText}
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
                else window.toast?.error(t('chat.input.send_failed'))
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
        getToolLaunchers={() => getLaunchers()}
        suggestionSources={suggestionSources}
        rootPanelAdditionalItems={rootPanelSkillItems}
        onRootPanelOpen={handleRootPanelOpen}
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
        sendAccessory={sendAccessory}
        {...controlSlots}
      />
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
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [sessionLayout] = usePreference('agent.layout')
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
    window.toast?.error(selectAgentMessage)
  }, [selectAgentMessage])
  const placeholderText = t('agent.input.placeholder', {
    key: getSendMessageShortcutLabel(sendMessageShortcut)
  })
  const controlSlots = renderAgentHomeControls({
    agent: undefined,
    selectAgentLabel: selectAgentMessage,
    model: undefined,
    modelProviderName: undefined,
    selectModelLabel: t('button.select_model'),
    agentChanging,
    shouldAutoSelectCreatedAgent: true,
    showAgentTrigger: sessionLayout !== 'classic',
    canChangeModel: false,
    onAgentChange: handleAgentChange,
    onModelSelect: () => undefined
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
        narrowMode
        onActionsChange={handleSurfaceActionsChange}
        getToolLaunchers={() => getLaunchers()}
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

const AgentComposer = (props: Props) => {
  return <AgentComposerRoot {...props} renderControls={renderAgentToolbarControls} />
}

export const AgentHomeComposer = (props: Props) => {
  return (
    <AgentComposerRoot
      {...props}
      showWorkspaceSelector={props.showWorkspaceSelector ?? true}
      forceNarrowLayout
      renderControls={renderAgentHomeControls}
    />
  )
}

export default AgentComposer
