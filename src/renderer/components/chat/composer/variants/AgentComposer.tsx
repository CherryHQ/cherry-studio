import { Button, Tooltip } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import { useCommandHandler } from '@renderer/commands'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import ComposerSurface, { type ComposerSurfaceActions } from '@renderer/components/chat/composer/ComposerSurface'
import {
  ComposerActiveToolControls,
  ComposerToolDerivedStateProvider,
  ComposerToolMenu,
  ComposerToolRuntimeHost,
  ComposerToolRuntimeProvider,
  useComposerToolDispatch,
  useComposerToolLauncherActions,
  useComposerToolState
} from '@renderer/components/chat/composer/ComposerToolRuntime'
import { getComposerToolConfig } from '@renderer/components/chat/composer/tools/registry'
import type { ToolContext } from '@renderer/components/chat/composer/tools/types'
import { formatQuoteTokenPromptText } from '@renderer/components/chat/utils/quoteToken'
import type { QuickPanelInputAdapter, QuickPanelListItem } from '@renderer/components/QuickPanel'
import { AgentSelector, ModelSelector, WorkspaceSelector } from '@renderer/components/Selector'
import { isGenerateImageModel, isVisionModel } from '@renderer/config/models'
import { useIsActiveTab } from '@renderer/context/TabIdContext'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { isSoulModeEnabled } from '@renderer/hooks/agents/agentConfiguration'
import { useAgent, useUpdateAgent } from '@renderer/hooks/agents/useAgent'
import { useAgentModelFilter } from '@renderer/hooks/agents/useAgentModelFilter'
import { useSession, useUpdateSession } from '@renderer/hooks/agents/useSession'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviderDisplayName } from '@renderer/hooks/useProvider'
import { useAvailableSkills } from '@renderer/hooks/useSkills'
import { useTimer } from '@renderer/hooks/useTimer'
import { AgentLabel } from '@renderer/pages/agents/components/AgentLabel'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { FILE_TYPE, type FileMetadata, type LocalSkill, type ThinkingOption } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { getFileTypeByExt } from '@shared/file/types'
import type { PathStatus } from '@shared/file/types/ipc'
import { IpcChannel } from '@shared/IpcChannel'
import type { TFunction } from 'i18next'
import { Bot, ChevronDown, CircleSlash, Folder, Sparkles, TriangleAlert } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createComposerUserMessageParts, serializeComposerDocument } from '../composerDraft'
import type { ComposerSuggestionSource } from '../quickPanel'
import type { ComposerDraftToken, ComposerSerializedDraft, ComposerSerializedToken } from '../tokens'
import {
  agentComposerTokenId,
  agentFileToComposerToken,
  agentSkillToComposerToken,
  getAgentComposerTokenIds
} from './agentComposerTokens'
import { useComposerBottomToolbarIconOnly } from './useComposerBottomToolbarIconOnly'

const logger = loggerService.withContext('AgentComposer')
const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000

function useWorkspacePathStatus(path: string | undefined): PathStatus | null {
  const [status, setStatus] = useState<PathStatus | null>(null)
  useEffect(() => {
    let disposed = false
    setStatus(null)
    if (!path) return

    void (async () => {
      try {
        const next = await window.api.file.getPathStatus({ path, expectedKind: 'directory' })
        if (!disposed) setStatus(next)
      } catch (error) {
        if (!disposed) {
          logger.warn('Failed to check workspace path status', {
            path,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [path])
  return status
}

function formatWorkspacePathWarning(
  t: TFunction,
  status: PathStatus | null,
  path: string | undefined
): string | undefined {
  if (!status || status.ok) return undefined
  switch (status.reason) {
    case 'missing':
      return t('agent.session.workspace_status.missing', { path })
    case 'not-directory':
      return t('agent.session.workspace_status.not_directory', { path })
    case 'not-file':
      return t('agent.session.workspace_status.inaccessible', { path })
    case 'inaccessible':
      return t('agent.session.workspace_status.inaccessible', { path })
  }
}

const AGENT_MANAGED_TOKEN_KINDS = ['file', 'skill'] as const satisfies readonly ComposerDraftToken['kind'][]
const COMPOSER_TOOLBAR_CLASS = 'flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden'
const COMPOSER_SELECTOR_BUTTON_CLASS = 'h-7 shrink-0 gap-1.5 rounded-full px-2 text-xs'
const COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS = 'w-8 justify-center px-0'
const COMPOSER_ICON_ONLY_LABEL_CLASS = 'sr-only'

const getAgentDraftCacheKey = (agentId: string) => `agent-session-draft-${agentId}`

interface AgentComposerDraftCache {
  text: string
  tokens: ComposerSerializedToken[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLocalSkill(value: unknown): value is LocalSkill {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.filename === 'string' &&
    (value.description === undefined || typeof value.description === 'string')
  )
}

function isComposerSerializedToken(value: unknown): value is ComposerSerializedToken {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.label === 'string' &&
    typeof value.index === 'number' &&
    typeof value.textOffset === 'number'
  )
}

function getSkillFilenameFromToken(token: ComposerSerializedToken): string {
  return token.id.startsWith('skill:') ? token.id.slice('skill:'.length) : token.label
}

function getSkillFromCachedToken(token: ComposerSerializedToken): LocalSkill {
  if (isLocalSkill(token.payload)) return token.payload

  return {
    name: token.label,
    ...(token.description && { description: token.description }),
    filename: getSkillFilenameFromToken(token)
  }
}

function getCachedSkillTokens(tokens: readonly ComposerSerializedToken[]) {
  return tokens.filter((token) => token.kind === 'skill')
}

function readAgentDraftCache(cacheKey: string): AgentComposerDraftCache {
  const cached = cacheService.getCasual<string | AgentComposerDraftCache>(cacheKey)
  if (typeof cached === 'string') return { text: cached, tokens: [] }
  if (!isRecord(cached) || typeof cached.text !== 'string' || !Array.isArray(cached.tokens)) {
    return { text: '', tokens: [] }
  }

  return {
    text: cached.text,
    tokens: getCachedSkillTokens(cached.tokens.filter(isComposerSerializedToken))
  }
}

function writeAgentDraftCache(cacheKey: string, text: string, tokens: readonly ComposerSerializedToken[]) {
  cacheService.setCasual<AgentComposerDraftCache>(
    cacheKey,
    {
      text,
      tokens: getCachedSkillTokens(tokens)
    },
    DRAFT_CACHE_TTL
  )
}

const getBaseName = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
}

const getFileExtension = (fileName: string) => {
  const lastDotIndex = fileName.lastIndexOf('.')
  return lastDotIndex > 0 ? fileName.slice(lastDotIndex) : ''
}

const createFileMetadataFromPath = (filePath: string): FileMetadata => {
  const name = getBaseName(filePath)
  const ext = getFileExtension(name)
  return {
    id: filePath,
    name,
    origin_name: name,
    path: filePath,
    size: 0,
    ext,
    type: ext ? getFileTypeByExt(ext) : FILE_TYPE.OTHER,
    created_at: new Date().toISOString(),
    count: 1
  }
}

const getRelativePath = (filePath: string, accessiblePaths: readonly string[]) => {
  const normalizedFilePath = filePath.replace(/\\/g, '/')

  for (const basePath of accessiblePaths) {
    const normalizedBasePath = basePath.replace(/\\/g, '/')
    const baseWithSlash = normalizedBasePath.endsWith('/') ? normalizedBasePath : `${normalizedBasePath}/`

    if (normalizedFilePath.startsWith(baseWithSlash)) {
      return normalizedFilePath.slice(baseWithSlash.length)
    }
  }

  return filePath
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
    icon: <Sparkles size={16} />,
    suffix: options.skillLabel,
    filterText: `${skill.name} ${skill.description ?? ''} ${options.skillLabel}`,
    action: ({ inputAdapter }) => {
      options.onInsertSkill(skill, inputAdapter)
    }
  }))
}

type Props = {
  agentId: string
  sessionId: string
  sessionOverride?: AgentSessionEntity
  sendMessage: (message?: { text: string }, options?: { body?: Record<string, unknown> }) => Promise<void>
  stop: () => Promise<void>
  onNewSessionDraft?: () => void | Promise<void>
  onAgentChange?: (agentId: string | null) => void | Promise<void>
  agentChanging?: boolean
  workspaceId?: string | null
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  showWorkspaceSelector?: boolean
  workspaceChanging?: boolean
  isStreaming: boolean
  sendDisabled?: boolean
}

type AgentComposerRootProps = Props & {
  renderControls: AgentComposerControlsRenderer
}

type ProviderActionHandlers = ComposerSurfaceActions & {
  addNewTopic: () => void
}

const emptyActions: ProviderActionHandlers = {
  addNewTopic: () => undefined,
  focus: () => undefined,
  onTextChange: () => undefined,
  toggleExpanded: () => undefined,
  removeToken: () => undefined,
  insertToken: () => undefined,
  getDraft: () => ({ text: '', tokens: [] })
}

const createQuoteToken = (selectedText: string, label: string): ComposerDraftToken => ({
  id: `quote:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  kind: 'quote',
  label,
  description: selectedText,
  promptText: formatQuoteTokenPromptText(selectedText)
})

const AgentComposerRoot = ({
  agentId,
  sessionId,
  sessionOverride,
  sendMessage,
  stop,
  onNewSessionDraft,
  onAgentChange,
  agentChanging,
  workspaceId,
  onWorkspaceChange,
  showWorkspaceSelector,
  workspaceChanging,
  isStreaming,
  sendDisabled = false,
  renderControls
}: AgentComposerRootProps) => {
  const { session: loadedSession } = useSession(sessionOverride ? null : sessionId)
  const session = sessionOverride ?? loadedSession
  const { agent } = useAgent(agentId)
  const { model: sessionModel } = useModelById((agent?.model ?? '') as UniqueModelId)
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })
  const handleNewSessionShortcut = useCallback(() => {
    void onNewSessionDraft?.()
  }, [onNewSessionDraft])

  const isActiveTab = useIsActiveTab()
  useCommandHandler('topic.create', handleNewSessionShortcut, {
    enabled: isActiveTab && Boolean(session && agent && onNewSessionDraft)
  })

  const sessionData = useMemo(() => {
    if (!session || !agent) return undefined
    return {
      agentId,
      sessionId,
      agentType: agent.type,
      accessiblePaths: session.workspace?.path ? [session.workspace.path] : []
    }
  }, [session, agent, agentId, sessionId])

  const initialState = useMemo(
    () => ({
      mentionedModels: [],
      selectedKnowledgeBases: [],
      files: [] as FileMetadata[],
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
        onAgentChange={onAgentChange}
        agentChanging={agentChanging}
        onWorkspaceChange={onWorkspaceChange}
        showWorkspaceSelector={showWorkspaceSelector}
        workspaceChanging={workspaceChanging}
        isStreaming={isStreaming}
        sendDisabled={sendDisabled}
        renderControls={renderControls}
      />
    </ComposerToolRuntimeProvider>
  )
}

interface InnerProps {
  model?: Model
  agentId: string
  sessionId: string
  sessionData?: ToolContext['session']
  workspace?: AgentSessionEntity['workspace']
  workspaceId?: string | null
  actionsRef: React.MutableRefObject<ProviderActionHandlers>
  chatSendMessage: Props['sendMessage']
  chatStop: Props['stop']
  onAgentChange?: Props['onAgentChange']
  agentChanging?: boolean
  onWorkspaceChange?: Props['onWorkspaceChange']
  showWorkspaceSelector?: boolean
  workspaceChanging?: boolean
  isStreaming: boolean
  sendDisabled: boolean
  renderControls: AgentComposerControlsRenderer
}

interface AgentComposerContextControlsProps {
  agent?: AgentEntity
  model?: Model
  modelProviderName?: string
  modelFilter?: (model: Model) => boolean
  selectAgentLabel: string
  selectModelLabel: string
  agentChanging?: boolean
  shouldAutoSelectCreatedAgent: boolean
  side: 'top' | 'bottom'
  iconOnly?: boolean
  onAgentChange: (agentId: string | null) => void | Promise<void>
  onModelSelect: (model: Model | undefined) => void
}

interface AgentComposerWorkspaceControlProps {
  workspace?: AgentSessionEntity['workspace']
  workspaceId?: string | null
  workspaceChanging?: boolean
  workspaceWarning?: string
  selectWorkspaceLabel: string
  side: 'top' | 'bottom'
  iconOnly?: boolean
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
}

const AgentComposerContextControls = ({
  agent,
  model,
  modelProviderName,
  modelFilter,
  selectAgentLabel,
  selectModelLabel,
  agentChanging,
  shouldAutoSelectCreatedAgent,
  side,
  iconOnly = false,
  onAgentChange,
  onModelSelect
}: AgentComposerContextControlsProps) => {
  const triggerClassName = cn(COMPOSER_SELECTOR_BUTTON_CLASS, iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS)
  const labelClassName = cn('truncate', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)
  const chevronClassName = cn('text-muted-foreground', iconOnly && 'hidden')
  const modelTriggerClassName = cn(
    COMPOSER_SELECTOR_BUTTON_CLASS,
    iconOnly && model && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS
  )
  const modelLabelClassName = cn('truncate', iconOnly && model && COMPOSER_ICON_ONLY_LABEL_CLASS)
  const modelChevronClassName = cn('text-muted-foreground', iconOnly && model && 'hidden')
  const [agentModelSelectorOpen, setAgentModelSelectorOpen] = useState(false)

  return (
    <>
      <AgentSelector
        value={agent?.id ?? null}
        onChange={onAgentChange}
        autoSelectOnCreate={shouldAutoSelectCreatedAgent}
        side={side}
        align="start"
        mountStrategy="lazy-keep"
        trigger={
          <Button variant="ghost" size="sm" className={triggerClassName} disabled={agentChanging}>
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
            <ChevronDown size={14} className={chevronClassName} />
          </Button>
        }
      />
      {agent ? (
        <ModelSelector
          multiple={false}
          value={model}
          onSelect={onModelSelect}
          open={agentModelSelectorOpen}
          onOpenChange={setAgentModelSelectorOpen}
          filter={modelFilter}
          shortcut="chat.model.select"
          side={side}
          align="start"
          mountStrategy="lazy-keep"
          trigger={
            <Button variant="ghost" size="sm" className={modelTriggerClassName}>
              {model ? <ModelAvatar model={model} size={20} /> : null}
              <span className={cn('max-w-52', modelLabelClassName)}>
                {model ? model.name : selectModelLabel}
                {modelProviderName ? ` | ${modelProviderName}` : ''}
              </span>
              <ChevronDown size={14} className={modelChevronClassName} />
            </Button>
          }
        />
      ) : (
        <Button variant="ghost" size="sm" className={COMPOSER_SELECTOR_BUTTON_CLASS} disabled>
          <span className="max-w-52 truncate text-muted-foreground">{selectModelLabel}</span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </Button>
      )}
    </>
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
  const hasWarning = Boolean(workspaceWarning)
  const isSystemWorkspace = workspace?.type === 'system'
  const selectorValue = isSystemWorkspace ? null : workspaceId
  const workspaceLabel = isSystemWorkspace
    ? t('agent.session.workspace_selector.no_project')
    : (workspace?.name ?? selectWorkspaceLabel)
  const selector = (
    <WorkspaceSelector
      value={selectorValue}
      onChange={onWorkspaceChange ?? (() => undefined)}
      side={side}
      align="start"
      mountStrategy="lazy-keep"
      disabled={!onWorkspaceChange || workspaceChanging}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            COMPOSER_SELECTOR_BUTTON_CLASS,
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
          <ChevronDown size={14} aria-hidden className={cn('text-muted-foreground', iconOnly && 'hidden')} />
        </Button>
      }
    />
  )

  if (!hasWarning) return selector
  return <Tooltip content={workspaceWarning}>{selector}</Tooltip>
}

interface AgentComposerToolbarControlsProps extends Omit<AgentComposerContextControlsProps, 'side'> {
  inputAdapter?: QuickPanelInputAdapter
}

const AgentComposerToolMenuControls = ({ inputAdapter }: { inputAdapter?: QuickPanelInputAdapter }) => {
  return (
    <>
      <ComposerToolMenu inputAdapter={inputAdapter} />
      <ComposerActiveToolControls inputAdapter={inputAdapter} />
    </>
  )
}

const AgentComposerToolbarControls = ({ inputAdapter, ...contextProps }: AgentComposerToolbarControlsProps) => {
  const { iconOnly, toolbarRef } = useComposerBottomToolbarIconOnly()

  return (
    <div ref={toolbarRef} className={cn(COMPOSER_TOOLBAR_CLASS, 'w-full')}>
      <AgentComposerToolMenuControls inputAdapter={inputAdapter} />
      <AgentComposerContextControls {...contextProps} side="top" iconOnly={iconOnly} />
    </div>
  )
}

type AgentComposerControlProps = Omit<AgentComposerToolbarControlsProps, 'inputAdapter'> & {
  workspace?: AgentSessionEntity['workspace']
  workspaceId?: string | null
  workspaceChanging?: boolean
  workspaceWarning?: string
  showWorkspaceSelector?: boolean
  selectWorkspaceLabel: string
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
}
type ComposerSurfaceProps = React.ComponentProps<typeof ComposerSurface>
type AgentComposerControlSlots = Pick<ComposerSurfaceProps, 'renderLeftControls' | 'renderBelowControls'>
type AgentComposerControlsRenderer = (props: AgentComposerControlProps) => AgentComposerControlSlots

const AgentComposerBelowControls = (contextProps: AgentComposerControlProps) => {
  const { showWorkspaceSelector = true, ...controlProps } = contextProps
  const { iconOnly, toolbarRef } = useComposerBottomToolbarIconOnly()

  return (
    <div ref={toolbarRef} className={cn(COMPOSER_TOOLBAR_CLASS, 'w-full')}>
      <AgentComposerContextControls {...controlProps} side="bottom" iconOnly={iconOnly} />
      {showWorkspaceSelector ? (
        <div className="ml-auto flex shrink-0">
          <AgentComposerWorkspaceControl {...controlProps} side="bottom" iconOnly={iconOnly} />
        </div>
      ) : null}
    </div>
  )
}

const renderAgentToolbarControls: AgentComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter) => <AgentComposerToolbarControls inputAdapter={inputAdapter} {...props} />
})

const renderAgentHomeControls: AgentComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter) => (
    <div className={COMPOSER_TOOLBAR_CLASS}>
      <AgentComposerToolMenuControls inputAdapter={inputAdapter} />
    </div>
  ),
  renderBelowControls: () => <AgentComposerBelowControls {...props} />
})

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
  onAgentChange,
  agentChanging,
  onWorkspaceChange,
  showWorkspaceSelector,
  workspaceChanging,
  isStreaming,
  sendDisabled,
  renderControls
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
  const { t } = useTranslation()
  const { setTimeoutTimer } = useTimer()
  const workspacePathStatus = useWorkspacePathStatus(workspace?.path)
  const workspaceWarning = formatWorkspacePathWarning(t, workspacePathStatus, workspace?.path)
  const initialDraftRef = useRef<AgentComposerDraftCache | null>(null)
  if (initialDraftRef.current === null) {
    initialDraftRef.current = readAgentDraftCache(getAgentDraftCacheKey(agentId))
  }

  const [reasoningEffort, setReasoningEffort] = useState<ThinkingOption>('default')
  const [selectedSkills, setSelectedSkills] = useState<LocalSkill[]>(() =>
    initialDraftRef.current ? initialDraftRef.current.tokens.map(getSkillFromCachedToken) : []
  )
  const modelFilter = useAgentModelFilter(agentBase?.type)
  const providerName = useProviderDisplayName(model?.providerId)
  const draftCacheKey = getAgentDraftCacheKey(agentId)
  const [text, setTextState] = useState(() => initialDraftRef.current?.text ?? '')
  const [draftTokens, setDraftTokens] = useState<ComposerSerializedToken[]>(() => initialDraftRef.current?.tokens ?? [])
  const textRef = useRef(text)
  const draftTokensRef = useRef(draftTokens)
  const sessionTopicId = buildAgentSessionTopicId(sessionId)
  const accessiblePaths = sessionData?.accessiblePaths ?? []
  const enableMentionModelTrigger = accessiblePaths.length > 0
  const { skills: availableSkills, refresh: refreshAvailableSkills } = useAvailableSkills(agentId, workspace?.path)

  const isVisionAssistant = useMemo(() => (model ? isVisionModel(model) : false), [model])
  const isGenerateImageAssistant = useMemo(() => (model ? isGenerateImageModel(model) : false), [model])

  const canAddImageFile = useMemo(
    () => isVisionAssistant || isGenerateImageAssistant,
    [isGenerateImageAssistant, isVisionAssistant]
  )

  const canAddTextFile = useMemo(
    () => isVisionAssistant || (!isVisionAssistant && !isGenerateImageAssistant),
    [isGenerateImageAssistant, isVisionAssistant]
  )

  const supportedExts = useMemo(() => {
    if (canAddImageFile && canAddTextFile) return [...imageExts, ...documentExts, ...textExts]
    if (canAddImageFile) return [...imageExts]
    if (canAddTextFile) return [...documentExts, ...textExts]
    return []
  }, [canAddImageFile, canAddTextFile])

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

  const handleTokensChange = useCallback(
    (draftTokens: readonly ComposerSerializedToken[]) => {
      const nextDraftTokens = getCachedSkillTokens(draftTokens)
      setDraftTokens(nextDraftTokens)
      draftTokensRef.current = nextDraftTokens
      writeAgentDraftCache(draftCacheKey, textRef.current, nextDraftTokens)
      const fileTokenIds = getAgentComposerTokenIds(draftTokens, 'file')
      const skillTokenIds = getAgentComposerTokenIds(draftTokens, 'skill')
      const skillTokens = draftTokens.filter((token) => token.kind === 'skill')
      setFiles((prev) => {
        const next = prev.filter((file) => fileTokenIds.has(agentComposerTokenId.file(file)))
        return next.length === prev.length ? prev : next
      })
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
    [availableSkills, draftCacheKey, setFiles]
  )

  useEffect(() => {
    setFiles((prev) => {
      const seenIds = new Set<string>()
      const next: typeof prev = []
      let changed = false

      for (const file of prev) {
        const id = agentComposerTokenId.file(file)
        if (seenIds.has(id)) {
          changed = true
          continue
        }

        seenIds.add(id)
        next.push(file)
      }

      return changed ? next : prev
    })
  }, [files, setFiles])

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

  const handleQuote = useCallback(
    (selectedText: string) => {
      if (!selectedText) return

      actionsRef.current.insertToken(createQuoteToken(selectedText, t('selection.action.builtin.quote')))
      actionsRef.current.toggleExpanded(isExpanded)
    },
    [actionsRef, isExpanded, t]
  )

  useEffect(() => {
    return window.electron?.ipcRenderer.on(IpcChannel.App_QuoteToMain, (_, selectedText: string) => {
      handleQuote(selectedText)
    })
  }, [handleQuote])

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
    (nextModel: Model | undefined) => {
      if (!agentBase || !nextModel) return
      void updateModel(agentBase.id, nextModel.id, { showSuccessToast: false })
    },
    [agentBase, updateModel]
  )

  const toolsSession = useMemo(() => {
    if (!sessionData) return undefined
    return { ...sessionData, reasoningEffort, onReasoningEffortChange: setReasoningEffort }
  }, [sessionData, reasoningEffort])

  const placeholderText = useMemo(() => {
    if (isSoulModeEnabled(agentBase?.configuration)) return t('agent.input.soul_placeholder')
    return t('agent.input.placeholder', {
      key: getSendMessageShortcutLabel(sendMessageShortcut)
    })
  }, [agentBase?.configuration, sendMessageShortcut, t])

  const buildQueuedPayload = useCallback(
    (draft: ComposerSerializedDraft): ComposerQueuedMessagePayload | null => {
      if (draft.text.trim().length === 0 && files.length === 0) return null
      const fileTokenIds = getAgentComposerTokenIds(draft.tokens, 'file')
      const attachedFiles = files.filter((file) => fileTokenIds.has(agentComposerTokenId.file(file)))
      const userMessageParts = createComposerUserMessageParts(draft, { files: attachedFiles })

      return {
        text: draft.text.trim(),
        files: attachedFiles.length ? (attachedFiles as unknown as Array<Record<string, unknown>>) : undefined,
        userMessageParts
      }
    },
    [files]
  )

  const sendQueuedPayload = useCallback(
    async (payload: ComposerQueuedMessagePayload) => {
      try {
        await chatSendMessage(
          { text: payload.text },
          { body: { agentId, sessionId, userMessageParts: payload.userMessageParts } }
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

  const handleSendDraft = useCallback(
    (draft: ComposerSerializedDraft) => {
      if (sendDisabled) return
      // The send queue was removed; while the session is streaming we no longer buffer
      // messages, so block sending until it finishes instead of dispatching concurrently.
      if (isStreaming) return
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

      clearCurrentDraft()
      void sendQueuedPayload(payload).catch((error: unknown) => {
        logger.warn('Failed to send message:', error as Error)
      })
    },
    [buildQueuedPayload, clearCurrentDraft, isStreaming, model, sendDisabled, sendQueuedPayload, t, workspaceWarning]
  )

  const resourceSuggestionStateRef = useRef({ accessiblePaths, files, setFiles, t })
  resourceSuggestionStateRef.current = { accessiblePaths, files, setFiles, t }

  const resourceSuggestionSource = useMemo<ComposerSuggestionSource>(
    () => ({
      pluginKey: 'agent-resource-mention-suggestion',
      char: '@',
      title: t('chat.input.resource_panel.title'),
      allowedPrefixes: [' ', '\n'],
      items: async ({ query }) => {
        const { accessiblePaths, files, setFiles, t } = resourceSuggestionStateRef.current
        if (accessiblePaths.length === 0) {
          return [
            {
              id: 'agent-resource:no-paths',
              label: t('chat.input.resource_panel.no_file_found.label'),
              description: t('chat.input.resource_panel.no_file_found.description'),
              disabled: true,
              command: () => undefined
            }
          ]
        }

        const searchPattern = query.trim() || '.'
        const results = await Promise.allSettled(
          accessiblePaths.map((dirPath) =>
            window.api.file.listDirectory(dirPath, {
              recursive: true,
              maxDepth: 3,
              includeHidden: false,
              includeFiles: true,
              includeDirectories: true,
              maxEntries: 20,
              searchPattern
            })
          )
        )
        const collected = new Set<string>()
        for (const result of results) {
          if (result.status !== 'fulfilled') continue
          for (const filePath of result.value) {
            collected.add(filePath.replace(/\\/g, '/'))
          }
        }

        if (collected.size === 0 && results.some((result) => result.status === 'rejected')) {
          return [
            {
              id: 'agent-resource:error',
              label: t('common.error'),
              description: t('chat.input.resource_panel.no_file_found.description'),
              disabled: true,
              command: () => undefined
            }
          ]
        }

        return [...collected].slice(0, 50).map((filePath) => {
          const relativePath = getRelativePath(filePath, accessiblePaths)
          const file = files.find((currentFile) => currentFile.path === filePath || currentFile.id === filePath)
          const tokenFile = file ?? createFileMetadataFromPath(filePath)
          const token = agentFileToComposerToken(tokenFile)

          return {
            id: token.id,
            label: relativePath,
            description: filePath,
            icon: <Folder size={16} />,
            filterText: `${relativePath} ${filePath}`,
            disabled: files.some((currentFile) => agentComposerTokenId.file(currentFile) === token.id),
            command: ({ editor }) => {
              const exists = serializeComposerDocument(editor).tokens.some(
                (currentToken) => currentToken.id === token.id
              )
              if (!exists) {
                editor.chain().focus().insertComposerToken(token).insertContent(' ').run()
              }
              setFiles((prevFiles) =>
                prevFiles.some((currentFile) => agentComposerTokenId.file(currentFile) === token.id)
                  ? prevFiles
                  : [...prevFiles, tokenFile]
              )
            }
          }
        })
      }
    }),
    [t]
  )

  const suggestionSources = useMemo(
    () => (enableMentionModelTrigger ? [resourceSuggestionSource] : []),
    [enableMentionModelTrigger, resourceSuggestionSource]
  )

  const controlSlots = renderControls({
    agent: agentBase,
    model,
    modelProviderName: providerName,
    modelFilter,
    workspace,
    workspaceId,
    workspaceWarning,
    selectAgentLabel: t('chat.alerts.select_agent'),
    selectModelLabel: t('button.select_model'),
    selectWorkspaceLabel: t('agent.session.workspace_selector.placeholder'),
    agentChanging,
    shouldAutoSelectCreatedAgent: Boolean(onAgentChange),
    workspaceChanging,
    showWorkspaceSelector,
    onAgentChange: handleAgentChange,
    onWorkspaceChange,
    onModelSelect: handleModelSelect
  })

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
        sendDisabled={
          isStreaming || sendDisabled || (text.trim().length === 0 && files.length === 0 && selectedSkills.length === 0)
        }
        sendBlockedReason={sendDisabled ? t('common.loading') : undefined}
        isLoading={isStreaming}
        onSendDraft={handleSendDraft}
        onPause={abortAgentSession}
        supportedExts={supportedExts}
        setFiles={setFiles}
        filesCount={files.length}
        isExpanded={isExpanded}
        onExpandedChange={setIsExpanded}
        quickPanelEnabled={config.enableQuickPanel ?? true}
        enableDragDrop={config.enableDragDrop ?? true}
        enableSpellCheck={enableSpellCheck}
        fontSize={fontSize}
        narrowMode={narrowMode}
        onActionsChange={handleSurfaceActionsChange}
        getToolLaunchers={() => getLaunchers()}
        suggestionSources={suggestionSources}
        rootPanelAdditionalItems={rootPanelSkillItems}
        onRootPanelOpen={handleRootPanelOpen}
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
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
  actionsRef: React.MutableRefObject<ProviderActionHandlers>
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
  const [narrowMode] = usePreference('chat.narrow_mode')
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
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
    model: undefined,
    modelProviderName: undefined,
    modelFilter: undefined,
    workspace: undefined,
    workspaceId: null,
    workspaceWarning: undefined,
    selectAgentLabel: selectAgentMessage,
    selectModelLabel: t('button.select_model'),
    selectWorkspaceLabel: t('agent.session.workspace_selector.placeholder'),
    agentChanging,
    shouldAutoSelectCreatedAgent: true,
    workspaceChanging: false,
    showWorkspaceSelector: false,
    onAgentChange: handleAgentChange,
    onWorkspaceChange: undefined,
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
        narrowMode={narrowMode}
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
      files: [] as FileMetadata[],
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
  return <AgentComposerRoot {...props} renderControls={renderAgentHomeControls} />
}

export default AgentComposer
