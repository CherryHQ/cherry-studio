import { NormalTooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ContextUsageMeter, ContextUsageSummary } from '@renderer/components/chat/contextUsage'
import { MessageEditingProvider, useMessageEditing } from '@renderer/components/chat/editing/MessageEditingContext'
import { useChatLayoutMode } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import {
  ConversationTopBarPortal,
  useConversationTopBarPortalLayout
} from '@renderer/components/chat/shell/ConversationTopBarPortal'
import { useActiveComposerOverride } from '@renderer/components/composer/ComposerContext'
import ComposerSurface, { type ComposerSurfaceActions } from '@renderer/components/composer/ComposerSurface'
import {
  ComposerPinnedToolsProvider,
  ComposerToolDerivedStateProvider,
  ComposerToolRuntimeHost,
  ComposerToolRuntimeProvider,
  useComposerTokenReconcile,
  useComposerToolDispatch,
  useComposerToolLauncherController,
  useComposerToolLauncherVersion,
  useComposerToolState
} from '@renderer/components/composer/ComposerToolRuntime'
import { ComposerPanelSymbol, getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { getComposerToolConfig } from '@renderer/components/composer/tools/registry'
import NewConversationIcon from '@renderer/components/icons/NewConversationIcon'
import { McpLogo } from '@renderer/components/icons/SvgIcon'
import { type QuickPanelListItem, useOptionalQuickPanel } from '@renderer/components/QuickPanel'
import { ResourceEditDialogEventHost } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { useCache } from '@renderer/data/hooks/useCache'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useChatWrite } from '@renderer/hooks/chat/ChatWriteContext'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useModelById, useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { useTopicMutations } from '@renderer/hooks/useTopic'
import { useTopicAwaitingApproval, useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { toast } from '@renderer/services/toast'
import { type Topic, TopicType } from '@renderer/types/topic'
import { buildFilePartsForAttachments, withComposerFilePartMeta } from '@renderer/utils/file/buildFileParts'
import { getComposerShortcutLabel, resolveSendShortcut } from '@renderer/utils/input'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { canEditAssistantMessageParts } from '@renderer/utils/message/partsHelpers'
import {
  isGPT5SeriesReasoningModel,
  isOpenAIWebSearchModel,
  resolveReasoningEffortForModel
} from '@renderer/utils/model'
import type { ComposerChatTarget, ComposerQueuedMessagePayload } from '@shared/ai/transport'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { Model, ReasoningSummary, ServiceTierSelection, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { getKnowledgeBaseIdsFromParts, withKnowledgeScopePart } from '@shared/data/types/uiParts'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { Eraser } from 'lucide-react'
import React, { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createComposerUserMessageParts, trimComposerDraftBoundaryBlankLines } from '../composerDraft'
import type { InputHistoryDirection } from '../inputHistoryNavigation'
import { QueuedFollowupsDock } from '../QueuedFollowupsDock'
import type { ComposerDraftToken, ComposerSerializedDraft, ComposerSerializedToken } from '../tokens'
import { type FollowupQueueItem, useFollowupQueue } from '../useFollowupQueue'
import { useInputHistory } from '../useInputHistory'
import { ChatConversationControls, type ChatConversationControlsProps } from './chat/ChatConversationControls'
import { type ChatComposerDraftCache, readChatDraftCache, writeChatDraftCache } from './chat/chatDraftCache'
import { createEditableMessageDraft, getEditableKnowledgeBases } from './chat/messageEditingDraft'
import { useChatMentionedModels } from './chat/useChatMentionedModels'
import {
  chatComposerTokenId,
  fileToComposerToken,
  getComposerTokenIds,
  knowledgeBaseToComposerToken
} from './chatComposerTokens'
import {
  COMPOSER_TOOLBAR_CLASS,
  ComposerBelowControls,
  ComposerToolbarControls,
  ComposerToolMenuControls
} from './shared/ComposerControlScaffolding'
import { type AddNewTopicPayload, emptyActions, type ProviderActionHandlers } from './shared/composerProviderActions'
import {
  buildComposerQueuedPayload,
  getComposerHistoryText,
  hasUnsyncedComposerAttachments
} from './shared/composerQueuedPayload'
import { useComposerQuoteInsertion } from './shared/composerQuote'
import {
  ComposerSpeedControl,
  resolveComposerReasoningEffort,
  resolveComposerServiceTier
} from './shared/ComposerSpeedControl'
import { type ComposerToolbarCustomTool, ComposerToolbarShortcuts } from './shared/ComposerToolbarShortcuts'
import { useComposerFileCapabilities } from './shared/useComposerFileCapabilities'
import { useComposerKnowledgeBaseScope } from './shared/useComposerKnowledgeBaseScope'
import { useComposerToolbarPinnedTools } from './shared/useComposerToolbarPinnedTools'
import { useEntityReferenceMentionSource } from './shared/useEntityReferenceMentionSource'
import { useLatest } from './shared/useLatest'

const logger = loggerService.withContext('ChatComposer')
const CHAT_MANAGED_TOKEN_KINDS = ['file', 'knowledge'] as const satisfies readonly ComposerDraftToken['kind'][]
const CHAT_MANAGED_TOKEN_KINDS_BEFORE_KNOWLEDGE_RESTORE = [
  'file'
] as const satisfies readonly ComposerDraftToken['kind'][]
const CHAT_NEW_CONVERSATION_TOOL_ID = 'composer:new-conversation'
const CHAT_CLEAR_CONTEXT_TOOL_ID = 'composer:clear-context'
const EMPTY_MODELS: Model[] = []
const CHAT_TOOLBAR_CUSTOM_TOOLS: readonly ComposerToolbarCustomTool[] = [
  {
    id: ComposerPanelSymbol.McpStatus,
    label: 'MCP',
    icon: <McpLogo width={18} height={18} aria-hidden />,
    onSelect: ({ unifiedPanelControl }) =>
      unifiedPanelControl?.open({ launcherId: ComposerPanelSymbol.McpStatus, searchText: 'MCP' })
  }
]

export type ChatComposerResolvedContext = Pick<
  ReturnType<typeof useAssistant>,
  'assistant' | 'isLoading' | 'model' | 'isModelPending' | 'isModelMissing' | 'setModel' | 'updateAssistantSettings'
>

export interface ChatConversationControlsSnapshot {
  scopeKey: string
  mentionedModels: Model[]
  mentionedModelSelectorValue: Model[]
  lockedMentionedModels: Model[]
  mentionedModelMultiSelectMode: boolean
  onModelSelect: (model: Model | undefined) => void
  onMentionedModelsSelect: (models: Model[]) => void
  onMentionedModelMultiSelectModeChange: (enabled: boolean) => void
  onMentionedModelSelectorRestore: () => void
}

export type ChatConversationControlsChangeHandler = (snapshot: ChatConversationControlsSnapshot | null) => void

export interface ChatContextUsageSource {
  contextTokens: number
  modelId: UniqueModelId
}

export interface ChatComposerProps {
  topic?: Topic
  contextUsage?: ChatContextUsageSource | null
  scopeKey?: string
  topicId?: string
  assistantId?: string
  resolvedContext?: ChatComposerResolvedContext
  resolvedProviders?: Provider[]
  externalContextControls?: boolean
  onConversationControlsChange?: ChatConversationControlsChangeHandler
  onSend: (
    text: string,
    options?: {
      mentionedModels?: UniqueModelId[]
      userMessageParts?: CherryMessagePart[]
      reasoningEffort?: ReasoningEffortOption
      serviceTier?: ServiceTierSelection
      fastMode?: boolean
      chatTarget?: ComposerChatTarget
    }
  ) => boolean | void | Promise<boolean | void>
  chatTarget?: ComposerChatTarget
  sendDisabled?: boolean
  useMentionedModelSelector?: boolean
  onDraftAssistantChange?: (assistantId: string | null) => void | Promise<void>
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onCreateEmptyTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
}

interface SavedComposerDraft {
  text: string
  draftTokens: ComposerSerializedToken[]
  files: ComposerAttachment[]
  mentionedModels: Model[]
  mentionedModelSelectorValue: Model[]
  mentionedModelMultiSelectMode: boolean
  mentionedModelSelectionWasPending: boolean
  selectedKnowledgeBases: KnowledgeBase[]
  knowledgeBaseIds: string[]
}

interface InputHistoryToolSnapshot extends Pick<SavedComposerDraft, 'files' | 'selectedKnowledgeBases'> {
  mentionedModels: Model[]
}

type ComposerFilePart = Extract<CherryMessagePart, { type: 'file' }>

const isComposerEditableMessagePart = (part: CherryMessagePart) => part.type === 'text' || part.type === 'file'

// Composer edits as a single text field: the draft joins all text parts (`\n\n`) and
// rebuilds files from tokens. Saving replaces the first editable part with the rebuilt
// draft and drops trailing editable parts — non-editable `reasoning`/`dynamic-tool` blocks
// stay in place and `data-translation` is removed. Interleaved shapes such as
// [text "before", tool, text "after"] are blocked by `canEditAssistantMessageParts` and
// never reach this path, so no reordering occurs on save.
const replaceComposerEditableMessageParts = (
  originalParts: CherryMessagePart[],
  editedParts: CherryMessagePart[]
): CherryMessagePart[] => {
  const firstEditablePartIndex = originalParts.findIndex(isComposerEditableMessagePart)
  if (firstEditablePartIndex === -1) return editedParts

  return originalParts.flatMap((part, index) => {
    if (part.type === 'data-translation') return []
    if (!isComposerEditableMessagePart(part)) return [part]
    return index === firstEditablePartIndex ? editedParts : []
  })
}

type ChatComposerControlProps = Omit<ChatConversationControlsProps, 'side'> & {
  topBarPortalAvailable: boolean
  topBarPortalIconOnly: boolean
  leadingControl?: React.ReactNode
  renderPersistentToolShortcuts?: (args: {
    inputAdapter?: ComposerInputAdapter
    unifiedPanelControl?: ComposerUnifiedPanelControl
  }) => React.ReactNode
}

type ComposerSurfaceProps = React.ComponentProps<typeof ComposerSurface>
type ComposerInputAdapter = Parameters<NonNullable<ComposerSurfaceProps['renderLeftControls']>>[0]
type ComposerUnifiedPanelControl = Parameters<NonNullable<ComposerSurfaceProps['renderLeftControls']>>[1]
type ChatComposerControlSlots = Pick<
  ComposerSurfaceProps,
  'renderLeftControls' | 'renderBelowControls' | 'renderCompactControls'
>
type ChatComposerControlsRenderer = (props: ChatComposerControlProps) => ChatComposerControlSlots

const renderChatPersistentCompactControls = (
  props: ChatComposerControlProps,
  inputAdapter: ComposerInputAdapter,
  unifiedPanelControl: ComposerUnifiedPanelControl
) => props.renderPersistentToolShortcuts?.({ inputAdapter, unifiedPanelControl })

const restoreComposerInputFocus = (inputAdapter: ComposerInputAdapter) => {
  window.requestAnimationFrame(() => inputAdapter?.focus())
}

const ChatComposerContextControlsWithAutoFocus = ({
  inputAdapter,
  ...props
}: ChatComposerControlProps & { side: 'top' | 'bottom'; iconOnly?: boolean; inputAdapter: ComposerInputAdapter }) => {
  const onDialogCloseAutoFocus = useCallback(() => restoreComposerInputFocus(inputAdapter), [inputAdapter])

  return <ChatConversationControls {...props} onDialogCloseAutoFocus={onDialogCloseAutoFocus} />
}

const renderChatComposerContextControls = (
  props: ChatComposerControlProps,
  inputAdapter: ComposerInputAdapter,
  { side, iconOnly }: { side: 'top' | 'bottom'; iconOnly: boolean }
) => {
  const controls = (
    <ChatComposerContextControlsWithAutoFocus
      {...props}
      side={props.topBarPortalAvailable ? 'bottom' : side}
      iconOnly={props.topBarPortalAvailable ? props.topBarPortalIconOnly : iconOnly}
      inputAdapter={inputAdapter}
    />
  )

  return props.topBarPortalAvailable ? <ConversationTopBarPortal>{controls}</ConversationTopBarPortal> : controls
}

const renderChatToolbarControls: ChatComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter, unifiedPanelControl) => {
    const persistentToolShortcuts = props.renderPersistentToolShortcuts?.({ inputAdapter, unifiedPanelControl })

    return (
      <ComposerToolbarControls
        inputAdapter={inputAdapter}
        leading={
          <>
            {props.leadingControl}
            {persistentToolShortcuts}
          </>
        }
        unifiedPanelControl={unifiedPanelControl}
        renderContextControls={(placement) => renderChatComposerContextControls(props, inputAdapter, placement)}
      />
    )
  }
})

const renderChatInputControls: ChatComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter, unifiedPanelControl) => (
    <ComposerToolbarControls
      inputAdapter={inputAdapter}
      leading={
        <>
          {props.leadingControl}
          {props.renderPersistentToolShortcuts?.({ inputAdapter, unifiedPanelControl })}
        </>
      }
      unifiedPanelControl={unifiedPanelControl}
      renderContextControls={() => null}
    />
  ),
  renderCompactControls: (inputAdapter, unifiedPanelControl) =>
    renderChatPersistentCompactControls(props, inputAdapter, unifiedPanelControl)
})

const renderChatHomeControls: ChatComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter, unifiedPanelControl) => {
    const persistentToolShortcuts = props.renderPersistentToolShortcuts?.({ inputAdapter, unifiedPanelControl })

    return (
      <>
        {props.topBarPortalAvailable
          ? renderChatComposerContextControls(props, inputAdapter, { side: 'bottom', iconOnly: false })
          : null}
        <div className={COMPOSER_TOOLBAR_CLASS}>
          {props.leadingControl}
          {persistentToolShortcuts}
          <ComposerToolMenuControls inputAdapter={inputAdapter} unifiedPanelControl={unifiedPanelControl} />
        </div>
      </>
    )
  },
  renderBelowControls: props.topBarPortalAvailable
    ? undefined
    : (inputAdapter) => (
        <ComposerBelowControls
          renderContextControls={(placement) =>
            renderChatComposerContextControls({ ...props, useMentionedModelSelector: true }, inputAdapter, placement)
          }
        />
      )
})

const renderChatHomeInputControls: ChatComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter, unifiedPanelControl) => (
    <div className={COMPOSER_TOOLBAR_CLASS}>
      {props.leadingControl}
      {props.renderPersistentToolShortcuts?.({ inputAdapter, unifiedPanelControl })}
      <ComposerToolMenuControls inputAdapter={inputAdapter} unifiedPanelControl={unifiedPanelControl} />
    </div>
  ),
  renderCompactControls: (inputAdapter, unifiedPanelControl) =>
    renderChatPersistentCompactControls(props, inputAdapter, unifiedPanelControl)
})

function ChatComposerContextUsage({ usage }: { usage?: ChatContextUsageSource | null }) {
  const { t } = useTranslation()
  const { model } = useModelById(usage?.modelId)
  const maxTokens = model?.contextWindow
  if (!usage || !model || typeof maxTokens !== 'number' || maxTokens <= 0) return null

  const percentage = (usage.contextTokens / maxTokens) * 100
  const label = t('agent.right_pane.info.context_usage')

  return (
    <NormalTooltip
      side="top"
      sideOffset={8}
      showArrow={false}
      contentProps={{
        className:
          'w-64 max-w-64 rounded-md border border-border bg-card p-3 text-card-foreground shadow-md dark:bg-card dark:text-card-foreground'
      }}
      content={
        <ContextUsageSummary
          title={label}
          emptyLabel={t('common.none')}
          data={{ usedTokens: usage.contextTokens, maxTokens, percentage, modelName: model.name }}
        />
      }>
      <ContextUsageMeter label={label} percentage={percentage} />
    </NormalTooltip>
  )
}

interface ChatComposerPresentationProps {
  compactWhenSingleLine?: boolean
}

type ChatComposerRootProps = ChatComposerProps &
  ChatComposerPresentationProps & {
    renderControls: ChatComposerControlsRenderer
    forceNarrowLayout?: boolean
    deferQuickPanel?: boolean
  }

type ChatPlacementPresentationProps =
  | { externalContextControls: true; compactWhenSingleLine?: boolean }
  | { externalContextControls?: false; compactWhenSingleLine?: never }
type ChatPlacementHomeProps = Omit<ChatComposerProps, 'externalContextControls'> & ChatPlacementPresentationProps
type ChatPlacementDockedProps = Omit<ChatComposerProps, 'externalContextControls' | 'onDraftAssistantChange'> &
  ChatPlacementPresentationProps
type ChatPlacementComposerProps =
  | (ChatPlacementHomeProps & { placement: 'home' })
  | (ChatPlacementDockedProps & { placement: 'docked' })

const ChatComposerRoot = ({
  topic,
  contextUsage,
  scopeKey,
  topicId,
  assistantId,
  resolvedContext,
  resolvedProviders,
  externalContextControls,
  onConversationControlsChange,
  onSend,
  chatTarget,
  sendDisabled,
  compactWhenSingleLine = false,
  useMentionedModelSelector,
  onDraftAssistantChange,
  onNewTopic,
  onCreateEmptyTopic,
  renderControls,
  forceNarrowLayout = false,
  deferQuickPanel = false
}: ChatComposerRootProps) => {
  const resolvedScopeKey = scopeKey ?? topic?.id
  const resolvedTopicId = topicId ?? topic?.id
  const resolvedAssistantId = assistantId ?? topic?.assistantId
  const draftCacheScopeKey = resolvedTopicId ?? resolvedScopeKey ?? ''
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })
  // Snapshot the topic draft before mounting its tool provider: files seed the provider synchronously so
  // the surface's managed-token sync does not strip restored file tokens, and the same snapshot
  // feeds text/draftTokens in ChatComposerInner so files and tokens stay consistent.
  const initialDraftRef = useRef<{ scopeKey: string; draft: ChatComposerDraftCache } | null>(null)
  if (initialDraftRef.current?.scopeKey !== draftCacheScopeKey) {
    initialDraftRef.current = { scopeKey: draftCacheScopeKey, draft: readChatDraftCache(draftCacheScopeKey) }
  }
  const initialDraft = initialDraftRef.current.draft
  const initialState = useMemo(
    () => ({
      files: initialDraft.files,
      mentionedModels: [] as Model[],
      selectedKnowledgeBases: [] as KnowledgeBase[],
      isExpanded: false,
      couldAddImageFile: false,
      extensions: [] as string[]
    }),
    [initialDraft]
  )

  return (
    <MessageEditingProvider>
      <ComposerToolRuntimeProvider
        key={draftCacheScopeKey}
        initialState={initialState}
        actions={{
          addNewTopic: () => actionsRef.current.addNewTopic(),
          onTextChange: (updater) => actionsRef.current.onTextChange(updater)
        }}>
        {resolvedScopeKey ? (
          <ChatComposerInner
            scopeKey={resolvedScopeKey}
            topicId={resolvedTopicId}
            contextUsage={contextUsage}
            assistantId={resolvedAssistantId}
            resolvedContext={resolvedContext}
            resolvedProviders={resolvedProviders}
            externalContextControls={externalContextControls}
            onConversationControlsChange={onConversationControlsChange}
            initialDraft={initialDraft}
            draftCacheScopeKey={draftCacheScopeKey}
            actionsRef={actionsRef}
            onSend={onSend}
            chatTarget={chatTarget}
            sendDisabled={sendDisabled}
            compactWhenSingleLine={compactWhenSingleLine}
            useMentionedModelSelector={useMentionedModelSelector}
            onDraftAssistantChange={onDraftAssistantChange}
            onNewTopic={onNewTopic}
            onCreateEmptyTopic={onCreateEmptyTopic}
            renderControls={renderControls}
            forceNarrowLayout={forceNarrowLayout}
            deferQuickPanel={deferQuickPanel}
          />
        ) : null}
      </ComposerToolRuntimeProvider>
    </MessageEditingProvider>
  )
}

interface ChatComposerInnerProps extends Omit<ChatComposerProps, 'scopeKey'>, ChatComposerPresentationProps {
  scopeKey: string
  initialDraft: ChatComposerDraftCache
  draftCacheScopeKey: string
  actionsRef: React.RefObject<ProviderActionHandlers>
  renderControls: ChatComposerControlsRenderer
  forceNarrowLayout?: boolean
  deferQuickPanel?: boolean
}

const ChatComposerInner = ({
  scopeKey,
  topicId,
  contextUsage,
  assistantId,
  resolvedContext,
  resolvedProviders,
  externalContextControls = false,
  onConversationControlsChange,
  initialDraft,
  draftCacheScopeKey,
  actionsRef,
  onSend,
  chatTarget,
  sendDisabled = false,
  compactWhenSingleLine = false,
  useMentionedModelSelector,
  onDraftAssistantChange,
  onNewTopic,
  onCreateEmptyTopic,
  renderControls,
  forceNarrowLayout = false,
  deferQuickPanel = false
}: ChatComposerInnerProps) => {
  const streamScopeKey = topicId ?? scopeKey
  const awaitingApproval = useTopicAwaitingApproval(streamScopeKey)
  const scope = TopicType.Chat
  const config = getComposerToolConfig(scope)
  const { files, mentionedModels, selectedKnowledgeBases, isExpanded } = useComposerToolState()
  const { setFiles, setMentionedModels, setSelectedKnowledgeBases, setIsExpanded, toolsRegistry } =
    useComposerToolDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherController()
  const toolLaunchersVersion = useComposerToolLauncherVersion()
  const loadedContext = useAssistant(externalContextControls ? null : assistantId, {
    loadDefaultModel: !externalContextControls
  })
  const {
    assistant,
    isLoading: isAssistantLoading,
    model,
    isModelPending,
    isModelMissing,
    setModel,
    updateAssistantSettings
  } = resolvedContext ?? loadedContext
  const { updateTopic } = useTopicMutations()
  const [storedSendShortcut] = usePreference('chat.input.send_message_shortcut')
  const sendMessageShortcut = resolveSendShortcut(storedSendShortcut)
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const {
    pinnedIds: pinnedToolIds,
    setPinnedIds: setPinnedToolIds,
    resetPinnedIds: resetPinnedToolIds,
    isDefault: pinnedToolsAtDefault,
    customizeOpen: customizeToolbarOpen,
    setCustomizeOpen: setCustomizeToolbarOpen,
    customizeFooterAction
  } = useComposerToolbarPinnedTools('chat.input.toolbar.pinned_tools')
  const [fontSize] = usePreference('chat.message.font_size')
  const [narrowMode] = usePreference('chat.narrow_mode')
  // Yield the same rail gutter as the message column so the composer stays aligned.
  const { railGutterPx } = useChatLayoutMode()
  const { available: topBarPortalAvailable, iconOnly: topBarPortalIconOnly } = useConversationTopBarPortalLayout()
  const composerOverridden = useActiveComposerOverride() !== null
  const [searching, setSearching] = useCache('chat.web_search.searching')
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')
  const { t } = useTranslation()
  const chatWrite = useChatWrite()
  const { editingMessage, cancelEditing, stopEditing } = useMessageEditing()
  const editingMessageForCurrentTopic = topicId && editingMessage?.message.topicId === topicId ? editingMessage : null
  const staleEditingMessage = editingMessage && !editingMessageForCurrentTopic
  const { isPending, isFulfilled, markSeen } = useTopicStreamStatus(streamScopeKey)
  const [isSending, setIsSending] = useState(false)
  const [isDirectSending, setIsDirectSending] = useState(false)
  const directSendInFlightRef = useRef(false)
  const [isStartingNewContext, setIsStartingNewContext] = useState(false)
  const [savingEditingSessionId, setSavingEditingSessionId] = useState<number | null>(null)
  const [text, setText] = useState(() => initialDraft.text)
  const [draftTokens, setDraftTokens] = useState<ComposerSerializedToken[] | undefined>(() =>
    initialDraft.tokens.length ? initialDraft.tokens : undefined
  )
  const surfaceGetDraftRef = useRef<ComposerSurfaceActions['getDraft']>(emptyActions.getDraft)
  const [draftTokenRevision, setDraftTokenRevision] = useState(0)
  const knowledgeBaseIdsRef = useRef([...initialDraft.knowledgeBaseIds])
  const mentionedModelDraftRef = useRef({
    mentionedModelIds: [...initialDraft.mentionedModelIds],
    modelMultiSelectMode: initialDraft.modelMultiSelectMode
  })
  const shouldHydrateMentionedModelDraft =
    Boolean(useMentionedModelSelector) &&
    (initialDraft.mentionedModelIds.length > 0 || initialDraft.modelMultiSelectMode)
  const [isMentionedModelDraftHydrated, setIsMentionedModelDraftHydrated] = useState(!shouldHydrateMentionedModelDraft)
  const { models: draftModels, isLoading: isDraftModelsLoading } = useModels(
    { enabled: true },
    { fetchEnabled: shouldHydrateMentionedModelDraft && initialDraft.mentionedModelIds.length > 0 }
  )
  const observedKnowledgeBaseSelectionKeyRef = useRef<string | null>(
    initialDraft.knowledgeBaseIds.length === 0 ? JSON.stringify([]) : null
  )
  const [isKnowledgeBaseDraftHydrated, setIsKnowledgeBaseDraftHydrated] = useState(
    initialDraft.knowledgeBaseIds.length === 0
  )
  const quickPanel = useOptionalQuickPanel()
  const rootPanelVisible = Boolean(quickPanel?.isVisible && quickPanel.symbol === ComposerPanelSymbol.Root)
  const knowledgeBasePanelVisible = Boolean(
    quickPanel?.isVisible && quickPanel.symbol === ComposerPanelSymbol.KnowledgeBase
  )
  const knowledgeBasesDataEnabled =
    selectedKnowledgeBases.length > 0 ||
    getComposerTokenIds(draftTokens ?? [], 'knowledge').size > 0 ||
    Boolean(editingMessageForCurrentTopic) ||
    rootPanelVisible ||
    knowledgeBasePanelVisible
  const { bases: allKnowledgeBases, isLoading: isKnowledgeBasesLoading } = useKnowledgeBases({
    enabled: knowledgeBasesDataEnabled
  })
  const filesRef = useLatest(files)
  const selectedKnowledgeBasesRef = useLatest(selectedKnowledgeBases)
  const mentionedModelsRef = useLatest(mentionedModels)
  const editingMessageForCurrentTopicRef = useLatest(editingMessageForCurrentTopic)
  const inputHistoryToolsRef = useRef<InputHistoryToolSnapshot | null>(null)
  const skipDraftCacheWriteForHistoryPreviewRef = useRef(false)
  const applyHistoryDraft = useCallback(
    (historyDraft: ComposerSerializedDraft, options: { source: 'history' | 'draft' }) => {
      skipDraftCacheWriteForHistoryPreviewRef.current = options.source === 'history'
      actionsRef.current.replaceDraft(historyDraft)
      setText(historyDraft.text)
      setDraftTokens(historyDraft.tokens.length ? historyDraft.tokens : undefined)

      if (options.source === 'history') {
        inputHistoryToolsRef.current ??= {
          files: filesRef.current,
          mentionedModels: mentionedModelsRef.current,
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
      setMentionedModels(savedTools.mentionedModels)
      setSelectedKnowledgeBases(savedTools.selectedKnowledgeBases)
    },
    [
      actionsRef,
      filesRef,
      mentionedModelsRef,
      selectedKnowledgeBasesRef,
      setFiles,
      setMentionedModels,
      setSelectedKnowledgeBases
    ]
  )
  const { isInputHistoryActive, navigateHistory, resetHistoryIndex, takeDraftBeforeHistory, saveHistory } =
    useInputHistory({
      applyDraft: applyHistoryDraft
    })
  const handleInputHistoryNavigate = useCallback(
    (direction: InputHistoryDirection) => navigateHistory(direction, actionsRef.current.getDraft()),
    [actionsRef, navigateHistory]
  )
  const handleTextChange = useCallback(
    (nextText: string) => {
      resetHistoryIndex()
      inputHistoryToolsRef.current = null
      skipDraftCacheWriteForHistoryPreviewRef.current = false
      setText(nextText)
    },
    [resetHistoryIndex]
  )
  const savedDraftBeforeEditingRef = useRef<SavedComposerDraft | null>(null)
  const editSaveInFlightSessionIdRef = useRef<number | null>(null)
  const editingOriginalFilePartsByTokenIdRef = useRef(new Map<string, ComposerFilePart>())
  const restoredEditingSessionIdRef = useRef<number | null>(null)
  const isSavingEdit = savingEditingSessionId === editingMessageForCurrentTopic?.editingSessionId
  const selectAssistantMessage = t('button.select_assistant')
  const displayAssistant = assistant
  const hasMissingPersistedAssistant = !!assistantId && !isAssistantLoading && !assistant
  const runtimeModel = assistant || !assistantId ? model : undefined
  const runtimeModelPending = isAssistantLoading || isModelPending
  const selectedAssistantId = assistant?.id ?? null
  const canonicalReasoningEffort = (assistant?.settings.reasoning_effort ?? 'default') as ReasoningEffortOption
  const [reasoningOverride, setReasoningOverride] = useState<{
    assistantId: string
    value: ReasoningEffortOption
    version: number
  } | null>(null)
  const reasoningMutationVersionRef = useRef(0)
  const reasoningEffort =
    reasoningOverride?.assistantId === selectedAssistantId ? reasoningOverride.value : canonicalReasoningEffort
  const canonicalServiceTier = assistant?.settings.service_tier ?? 'standard'
  const [serviceTierOverride, setServiceTierOverride] = useState<{
    assistantId: string
    value: ServiceTierSelection
    version: number
  } | null>(null)
  const serviceTierMutationVersionRef = useRef(0)
  const serviceTier =
    serviceTierOverride?.assistantId === selectedAssistantId ? serviceTierOverride.value : canonicalServiceTier
  const [fastMode, setFastMode] = useState(false)

  // A local override only bridges the latest PATCH/revalidation window. Do
  // not retire it on an intermediate refresh from an older mutation.
  useEffect(() => {
    setReasoningOverride((current) => {
      if (!current) return current
      if (current.assistantId !== selectedAssistantId) return null
      return current
    })
  }, [selectedAssistantId])

  useEffect(() => {
    setServiceTierOverride((current) => {
      if (!current) return current
      return current.assistantId === selectedAssistantId ? current : null
    })
  }, [selectedAssistantId])

  const handleModelSelect = useCallback(
    (nextModel: Model | undefined) => {
      if (!nextModel) return
      if (!assistant) return

      const nextReasoningEffort = resolveReasoningEffortForModel(nextModel, reasoningEffort)
      const version = ++reasoningMutationVersionRef.current
      setReasoningOverride({
        assistantId: assistant.id,
        value: nextReasoningEffort ?? 'default',
        version
      })
      // No web-search reconciliation here: `setModel` already runs `reconcileWebSearchForModel`
      // with the provider data owned by that operation. Repeating it here would duplicate the
      // state transition against the composer's presentation-oriented provider list.
      const extraSettings: {
        reasoning_effort?: ReasoningEffortOption
      } = {}
      if (reasoningOverride?.assistantId === assistant.id) {
        extraSettings.reasoning_effort = nextReasoningEffort
      }
      const update = setModel(nextModel, extraSettings)
      return update
        ?.then(() => {
          setReasoningOverride((current) => (current?.version === version ? null : current))
        })
        .catch((error) => {
          setReasoningOverride((current) => (current?.version === version ? null : current))
          throw error
        })
    },
    [assistant, reasoningEffort, reasoningOverride, setModel]
  )

  const {
    mentionedModelSelectorValue,
    mentionedModelMultiSelectMode,
    handleMentionedModelsSelect: selectMentionedModels,
    handleMentionedModelMultiSelectModeChange: changeMentionedModelMultiSelectMode,
    handleMentionedModelSelectorRestore: restoreMentionedModelSelector,
    restoreMentionedModelDraft,
    restoreMentionedModelSelection
  } = useChatMentionedModels({
    enabled: useMentionedModelSelector,
    runtimeModel,
    runtimeModelPending,
    selectedAssistantId,
    topicId: scopeKey,
    mentionedModels,
    setMentionedModels,
    preserveExplicitSelectionOnRuntimeChange: !assistant && !assistantId,
    onModelSelect: handleModelSelect
  })
  const mentionedModelSelectorValueRef = useLatest(mentionedModelSelectorValue)
  const mentionedModelMultiSelectModeRef = useLatest(mentionedModelMultiSelectMode)
  const runtimeModelRef = useLatest(runtimeModel)

  useEffect(() => {
    if (isMentionedModelDraftHydrated || !useMentionedModelSelector) return
    if (runtimeModelPending || (initialDraft.mentionedModelIds.length > 0 && isDraftModelsLoading)) return

    const modelById = new Map(draftModels.map((model) => [model.id, model]))
    const restoredModels = initialDraft.mentionedModelIds.flatMap((modelId) => {
      const restoredModel = modelById.get(modelId)
      return restoredModel ? [restoredModel] : []
    })
    if (initialDraft.mentionedModelIds.length > 0 && restoredModels.length === 0) {
      restoreMentionedModelSelector()
    } else {
      restoreMentionedModelDraft(restoredModels, initialDraft.modelMultiSelectMode)
    }
    setIsMentionedModelDraftHydrated(true)
  }, [
    draftModels,
    initialDraft.mentionedModelIds,
    initialDraft.modelMultiSelectMode,
    isDraftModelsLoading,
    isMentionedModelDraftHydrated,
    restoreMentionedModelDraft,
    restoreMentionedModelSelector,
    runtimeModelPending,
    useMentionedModelSelector
  ])

  useEffect(() => {
    if (!useMentionedModelSelector || !isMentionedModelDraftHydrated) return
    mentionedModelDraftRef.current = {
      mentionedModelIds: mentionedModels.map((model) => model.id),
      modelMultiSelectMode: mentionedModelMultiSelectMode
    }
  }, [isMentionedModelDraftHydrated, mentionedModelMultiSelectMode, mentionedModels, useMentionedModelSelector])

  const exitInputHistoryPreview = useCallback(() => {
    const draft = takeDraftBeforeHistory()
    const tools = inputHistoryToolsRef.current
    inputHistoryToolsRef.current = null
    skipDraftCacheWriteForHistoryPreviewRef.current = false
    return { draft, tools }
  }, [takeDraftBeforeHistory])
  const exitInputHistoryPreviewForModelChange = useCallback(() => {
    const historyPreview = exitInputHistoryPreview()
    if (!historyPreview.draft) return

    const visibleDraft = actionsRef.current.getDraft()
    writeChatDraftCache(draftCacheScopeKey, {
      text: visibleDraft.text,
      tokens: visibleDraft.tokens,
      files: filesRef.current,
      knowledgeBaseIds: knowledgeBaseIdsRef.current,
      ...mentionedModelDraftRef.current
    })
  }, [actionsRef, draftCacheScopeKey, exitInputHistoryPreview, filesRef])
  const handleMentionedModelsSelect = useCallback(
    (nextModels: Model[]) => {
      exitInputHistoryPreviewForModelChange()
      selectMentionedModels(nextModels)
    },
    [exitInputHistoryPreviewForModelChange, selectMentionedModels]
  )
  const handleMentionedModelMultiSelectModeChange = useCallback(
    (enabled: boolean) => {
      changeMentionedModelMultiSelectMode(enabled)
    },
    [changeMentionedModelMultiSelectMode]
  )
  const handleMentionedModelSelectorRestore = useCallback(() => {
    exitInputHistoryPreviewForModelChange()
    restoreMentionedModelSelector()
  }, [exitInputHistoryPreviewForModelChange, restoreMentionedModelSelector])

  const selectedModelForMissingAssistantDefault =
    assistant && !assistant.modelId ? mentionedModelSelectorValue[0] : undefined
  const selectedModelForUnlinkedHome =
    !assistant && !assistantId && useMentionedModelSelector ? mentionedModelSelectorValue[0] : undefined
  const lockedMentionedModels =
    editingMessageForCurrentTopic?.lockedMentionedModels &&
    editingMessageForCurrentTopic.lockedMentionedModels.length > 1
      ? editingMessageForCurrentTopic.lockedMentionedModels
      : EMPTY_MODELS
  const shouldLoadProviders =
    !externalContextControls &&
    Boolean(
      runtimeModel ||
        mentionedModels.length > 0 ||
        mentionedModelSelectorValue.length > 0 ||
        lockedMentionedModels.length > 0
    )
  const { providers: loadedProviders } = useProviders(undefined, { enabled: shouldLoadProviders })
  const providers = resolvedProviders ?? loadedProviders
  const effectiveSubmittedModels =
    lockedMentionedModels.length > 1
      ? lockedMentionedModels
      : useMentionedModelSelector
        ? mentionedModelSelectorValue
        : mentionedModels.length > 0
          ? mentionedModels
          : runtimeModel
            ? [runtimeModel]
            : EMPTY_MODELS
  const effectiveSubmittedModel = effectiveSubmittedModels.length === 1 ? effectiveSubmittedModels[0] : undefined
  // Persisted assistant refreshes may clear transient mentions; submit the visible selector
  // snapshot so the next turn cannot fall back to stale assistant state.
  const submittedMentionedModels =
    assistant && useMentionedModelSelector ? mentionedModelSelectorValue : mentionedModels
  // Without an assistant, persistent request controls have no owner. Keep per-turn Fast available.
  const speedControlModel = useMemo(
    () =>
      effectiveSubmittedModel && !selectedAssistantId
        ? { ...effectiveSubmittedModel, reasoning: undefined, requestControls: undefined }
        : effectiveSubmittedModel,
    [effectiveSubmittedModel, selectedAssistantId]
  )

  useEffect(() => {
    if (speedControlModel?.supportsFastMode !== true) setFastMode(false)
  }, [speedControlModel?.supportsFastMode])

  const handleReasoningEffortChange = useCallback(
    (option: ReasoningEffortOption) => {
      if (!selectedAssistantId) return
      if (
        option === 'minimal' &&
        effectiveSubmittedModel &&
        isOpenAIWebSearchModel(effectiveSubmittedModel) &&
        isGPT5SeriesReasoningModel(effectiveSubmittedModel) &&
        assistant?.settings.enableWebSearch
      ) {
        toast.warning(t('chat.web_search.warning.openai'))
        return
      }
      const version = ++reasoningMutationVersionRef.current
      setReasoningOverride({
        assistantId: selectedAssistantId,
        value: option,
        version
      })
      void updateAssistantSettings({ reasoning_effort: option })
        .then(() => {
          setReasoningOverride((current) => (current?.version === version ? null : current))
        })
        .catch((error) => {
          setReasoningOverride((current) => (current?.version === version ? null : current))
          logger.warn('Failed to persist reasoning effort', { error })
        })
    },
    [assistant?.settings.enableWebSearch, effectiveSubmittedModel, selectedAssistantId, t, updateAssistantSettings]
  )
  const handleReasoningSummaryChange = useCallback(
    (summary: ReasoningSummary) => {
      void updateAssistantSettings({ reasoning_summary: summary }).catch((error) => {
        logger.warn('Failed to persist reasoning summary', { error })
      })
    },
    [updateAssistantSettings]
  )
  const handleServiceTierChange = useCallback(
    (tier: ServiceTierSelection) => {
      if (!selectedAssistantId) return
      const version = ++serviceTierMutationVersionRef.current
      setServiceTierOverride({ assistantId: selectedAssistantId, value: tier, version })
      void updateAssistantSettings({ service_tier: tier })
        .then(() => {
          setServiceTierOverride((current) => (current?.version === version ? null : current))
        })
        .catch((error) => {
          setServiceTierOverride((current) => (current?.version === version ? null : current))
          logger.warn('Failed to persist service tier', { error })
        })
    },
    [selectedAssistantId, updateAssistantSettings]
  )
  const conversationControlsSnapshot = useMemo<ChatConversationControlsSnapshot>(
    () => ({
      scopeKey,
      mentionedModels,
      mentionedModelSelectorValue,
      lockedMentionedModels,
      mentionedModelMultiSelectMode,
      onModelSelect: handleModelSelect,
      onMentionedModelsSelect: handleMentionedModelsSelect,
      onMentionedModelMultiSelectModeChange: handleMentionedModelMultiSelectModeChange,
      onMentionedModelSelectorRestore: handleMentionedModelSelectorRestore
    }),
    [
      handleMentionedModelMultiSelectModeChange,
      handleMentionedModelSelectorRestore,
      handleMentionedModelsSelect,
      handleModelSelect,
      lockedMentionedModels,
      mentionedModelMultiSelectMode,
      mentionedModelSelectorValue,
      mentionedModels,
      scopeKey
    ]
  )
  useLayoutEffect(() => {
    onConversationControlsChange?.(composerOverridden ? null : conversationControlsSnapshot)
  }, [composerOverridden, conversationControlsSnapshot, onConversationControlsChange])
  useLayoutEffect(() => {
    if (!onConversationControlsChange) return
    return () => onConversationControlsChange(null)
  }, [onConversationControlsChange])
  const isMentionedModelSelectorLocked = lockedMentionedModels.length > 1
  const missingAssistantMessage = hasMissingPersistedAssistant ? selectAssistantMessage : undefined
  const missingModelMessage =
    assistant && isModelMissing && !selectedModelForMissingAssistantDefault && !isMentionedModelSelectorLocked
      ? t('code.model_required')
      : undefined
  const missingSelectedModelMessage =
    useMentionedModelSelector && !isMentionedModelSelectorLocked && mentionedModelSelectorValue.length === 0
      ? t('code.model_required')
      : undefined
  const isModelUnavailable =
    !missingAssistantMessage &&
    !runtimeModelPending &&
    !runtimeModel &&
    !selectedModelForMissingAssistantDefault &&
    !selectedModelForUnlinkedHome

  useEffect(() => {
    if (isPending) setIsSending(false)
  }, [isPending])

  useEffect(() => {
    setIsSending(false)
  }, [scopeKey])

  const loading = isPending || isSending || awaitingApproval
  const clearContextDisabled =
    loading ||
    Boolean(editingMessageForCurrentTopic) ||
    isSavingEdit ||
    isStartingNewContext ||
    chatWrite?.canStartNewContext === false
  // Steer: while a turn is streaming (but not paused for tool approval) a new message is sent as a
  // follow-up rather than blocked — the main process persists it and yields/chains a continuation.
  const canSteer = isPending && !awaitingApproval
  const selectedKnowledgeBasesScopeKey = `${scopeKey}:${selectedAssistantId ?? 'no-assistant'}`
  const assistantName = displayAssistant?.name ?? (isAssistantLoading ? t('common.loading') : selectAssistantMessage)
  const { canAddImageFile, supportedExts } = useComposerFileCapabilities({
    models: mentionedModels,
    fallbackModel: runtimeModel
  })

  const {
    selectableKnowledgeBases,
    selectedKnowledgeBasesInScope,
    resolveKnowledgeBaseMarker,
    restoreKnowledgeBaseSelection
  } = useComposerKnowledgeBaseScope({
    configuredKnowledgeBaseIds: assistant?.knowledgeBaseIds,
    allKnowledgeBases,
    isKnowledgeBasesLoading,
    scopeKey: selectedKnowledgeBasesScopeKey,
    selectedKnowledgeBases,
    setSelectedKnowledgeBases
  })

  useEffect(() => {
    if (isKnowledgeBaseDraftHydrated || isKnowledgeBasesLoading) return

    const wantedIds = new Set(initialDraft.knowledgeBaseIds)
    const restoredIds = selectableKnowledgeBases.filter((base) => wantedIds.has(base.id)).map((base) => base.id)
    observedKnowledgeBaseSelectionKeyRef.current = JSON.stringify(restoredIds)
    restoreKnowledgeBaseSelection(initialDraft.knowledgeBaseIds)
    setIsKnowledgeBaseDraftHydrated(true)
  }, [
    initialDraft.knowledgeBaseIds,
    isKnowledgeBaseDraftHydrated,
    isKnowledgeBasesLoading,
    restoreKnowledgeBaseSelection,
    selectableKnowledgeBases
  ])

  // Single owner of the topic draft cache. Runs after ComposerSurface's effects have synced the
  // editor to the current text, so getDraft() serializes the live tokens consistently. Every
  // persistable change is observed through text, files, knowledge bases, model selection, or the editor token revision.
  // The revision covers token-only edits whose serialized text stays unchanged.
  const persistedOnceRef = useRef(false)
  useEffect(() => {
    if (isInputHistoryActive || !isKnowledgeBaseDraftHydrated || !isMentionedModelDraftHydrated) return
    if (!persistedOnceRef.current) {
      persistedOnceRef.current = true
      return
    }
    if (skipDraftCacheWriteForHistoryPreviewRef.current) {
      skipDraftCacheWriteForHistoryPreviewRef.current = false
      return
    }
    if (editingMessage) return
    const selectedKnowledgeBaseIds = selectedKnowledgeBasesInScope.map((base) => base.id)
    const selectedKnowledgeBaseIdsKey = JSON.stringify(selectedKnowledgeBaseIds)
    if (observedKnowledgeBaseSelectionKeyRef.current === null) {
      observedKnowledgeBaseSelectionKeyRef.current = selectedKnowledgeBaseIdsKey
    } else if (observedKnowledgeBaseSelectionKeyRef.current !== selectedKnowledgeBaseIdsKey) {
      observedKnowledgeBaseSelectionKeyRef.current = selectedKnowledgeBaseIdsKey
      const selectableKnowledgeBaseIdSet = new Set(selectableKnowledgeBases.map((base) => base.id))
      const unresolvedKnowledgeBaseIds = knowledgeBaseIdsRef.current.filter(
        (id) => !selectableKnowledgeBaseIdSet.has(id)
      )
      knowledgeBaseIdsRef.current = [...new Set([...unresolvedKnowledgeBaseIds, ...selectedKnowledgeBaseIds])]
    }
    const draft = actionsRef.current.getDraft()
    writeChatDraftCache(draftCacheScopeKey, {
      text,
      tokens: draft.tokens,
      files,
      knowledgeBaseIds: knowledgeBaseIdsRef.current,
      ...mentionedModelDraftRef.current
    })
  }, [
    actionsRef,
    draftCacheScopeKey,
    draftTokenRevision,
    editingMessage,
    files,
    isInputHistoryActive,
    isKnowledgeBaseDraftHydrated,
    isMentionedModelDraftHydrated,
    mentionedModelMultiSelectMode,
    mentionedModels,
    selectableKnowledgeBases,
    selectedKnowledgeBasesInScope,
    text
  ])

  const persistFinalDraft = useEffectEvent(() => {
    if (isInputHistoryActive) return
    const savedDraft = savedDraftBeforeEditingRef.current
    if (editingMessage && !savedDraft) return
    const draft = savedDraft ? { text: savedDraft.text, tokens: savedDraft.draftTokens } : surfaceGetDraftRef.current()
    writeChatDraftCache(draftCacheScopeKey, {
      text: savedDraft ? draft.text : text,
      tokens: draft.tokens,
      files: savedDraft?.files ?? filesRef.current,
      knowledgeBaseIds: savedDraft?.knowledgeBaseIds ?? knowledgeBaseIdsRef.current,
      mentionedModelIds:
        savedDraft?.mentionedModels.map((model) => model.id) ?? mentionedModelDraftRef.current.mentionedModelIds,
      modelMultiSelectMode:
        savedDraft?.mentionedModelMultiSelectMode ?? mentionedModelDraftRef.current.modelMultiSelectMode
    })
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` reads the latest draft; cleanup is keyed only by topic.
  useEffect(() => () => persistFinalDraft(), [draftCacheScopeKey])

  const restoreSavedDraft = useCallback(() => {
    const savedDraft = savedDraftBeforeEditingRef.current
    savedDraftBeforeEditingRef.current = null

    if (!savedDraft) return

    exitInputHistoryPreview()
    actionsRef.current.replaceDraft({ text: savedDraft.text, tokens: savedDraft.draftTokens })
    setText(savedDraft.text)
    setDraftTokens(savedDraft.draftTokens)
    setFiles(savedDraft.files)
    const restoredSelectorModels =
      savedDraft.mentionedModelSelectionWasPending && savedDraft.mentionedModelSelectorValue.length === 0
        ? runtimeModelRef.current
          ? [runtimeModelRef.current]
          : []
        : savedDraft.mentionedModelSelectorValue
    restoreMentionedModelSelection(
      restoredSelectorModels,
      savedDraft.mentionedModels,
      savedDraft.mentionedModelMultiSelectMode
    )
    setSelectedKnowledgeBases(savedDraft.selectedKnowledgeBases)
  }, [
    actionsRef,
    exitInputHistoryPreview,
    restoreMentionedModelSelection,
    runtimeModelRef,
    setFiles,
    setSelectedKnowledgeBases
  ])

  const handleCancelEditing = useCallback(() => {
    restoreSavedDraft()
    cancelEditing()
  }, [cancelEditing, restoreSavedDraft])
  const editingMessageId = editingMessageForCurrentTopic?.message.id
  const handleLocateEditingMessage = useCallback(() => {
    if (!editingMessageId) return
    void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + editingMessageId, true)
  }, [editingMessageId])

  const restoreEditableMessageDraft = useEffectEvent((nextEditingMessage: NonNullable<typeof editingMessage>) => {
    const editableDraft = createEditableMessageDraft(nextEditingMessage.parts)
    const originalFilePartsByTokenId = new Map<string, ComposerFilePart>()
    const originalFileParts = nextEditingMessage.parts.filter(
      (part): part is ComposerFilePart => part.type === 'file' && !!part.url
    )
    originalFileParts.forEach((part, index) => {
      const file = editableDraft.files[index]
      if (file) originalFilePartsByTokenId.set(chatComposerTokenId.file(file), part)
    })
    editingOriginalFilePartsByTokenIdRef.current = originalFilePartsByTokenId
    actionsRef.current.replaceDraft({ text: editableDraft.text, tokens: editableDraft.draftTokens })
    setText(editableDraft.text)
    setDraftTokens(editableDraft.draftTokens)
    setFiles(editableDraft.files)
    setSelectedKnowledgeBases(getEditableKnowledgeBases(editableDraft.draftTokens, selectableKnowledgeBases))
  })

  useEffect(() => {
    if (!editingMessageForCurrentTopic) {
      restoredEditingSessionIdRef.current = null
      editingOriginalFilePartsByTokenIdRef.current = new Map()
      return
    }
    if (restoredEditingSessionIdRef.current === editingMessageForCurrentTopic.editingSessionId) return
    restoredEditingSessionIdRef.current = editingMessageForCurrentTopic.editingSessionId

    if (savedDraftBeforeEditingRef.current?.text === undefined) {
      const historyPreview = exitInputHistoryPreview()
      const currentDraft = historyPreview.draft ?? actionsRef.current.getDraft()
      const currentTools = historyPreview.tools
      savedDraftBeforeEditingRef.current = {
        text: currentDraft.text,
        draftTokens: currentDraft.tokens,
        files: currentTools?.files ?? filesRef.current,
        mentionedModels: currentTools?.mentionedModels ?? mentionedModelsRef.current,
        mentionedModelSelectorValue: mentionedModelSelectorValueRef.current,
        mentionedModelMultiSelectMode: mentionedModelMultiSelectModeRef.current,
        mentionedModelSelectionWasPending: runtimeModelPending && mentionedModelSelectorValueRef.current.length === 0,
        selectedKnowledgeBases: currentTools?.selectedKnowledgeBases ?? selectedKnowledgeBasesRef.current,
        knowledgeBaseIds: [...knowledgeBaseIdsRef.current]
      }
    } else {
      exitInputHistoryPreview()
    }

    restoreEditableMessageDraft(editingMessageForCurrentTopic)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` reads latest selectable knowledge bases; this effect is keyed by editingSessionId.
  }, [
    actionsRef,
    editingMessageForCurrentTopic,
    exitInputHistoryPreview,
    filesRef,
    mentionedModelsRef,
    selectedKnowledgeBasesRef
  ])

  useEffect(() => {
    if (!staleEditingMessage) return
    restoreSavedDraft()
    stopEditing()
  }, [restoreSavedDraft, staleEditingMessage, stopEditing])

  const placeholderText = t('chat.input.placeholder', { key: getComposerShortcutLabel(sendMessageShortcut) })

  const tokens = useMemo(
    () => [...files.map(fileToComposerToken), ...selectedKnowledgeBasesInScope.map(knowledgeBaseToComposerToken)],
    [files, selectedKnowledgeBasesInScope]
  )

  // Editor→state reconciliation owned by the tools: attachmentTool prunes+dedupes files,
  // knowledgeBaseTool prunes+re-adds knowledge bases (against the injected selectableKnowledgeBases).
  const reconcileTokens = useComposerTokenReconcile({ scope, assistant: displayAssistant, model: runtimeModel })
  const handleTokensChange = useCallback(
    (nextDraftTokens: readonly ComposerSerializedToken[]) => {
      reconcileTokens(nextDraftTokens)
      setDraftTokenRevision((revision) => revision + 1)
    },
    [reconcileTokens]
  )

  const { sources: entityReferenceSources, hasPendingReference } = useEntityReferenceMentionSource({
    entityType: 'topic',
    excludeId: topicId
  })

  const onPause = useCallback(() => {
    chatWrite?.pause()
  }, [chatWrite])

  const handleAssistantChange = useCallback(
    async (nextId: string | null) => {
      if (!nextId || nextId === selectedAssistantId) return
      if (onDraftAssistantChange) {
        await onDraftAssistantChange(nextId)
        return
      }
      if (topicId) {
        await updateTopic(topicId, { assistantId: nextId })
      }
    },
    [onDraftAssistantChange, selectedAssistantId, topicId, updateTopic]
  )

  const createEmptyTopic = useCallback(
    (payload?: AddNewTopicPayload) => {
      if (isAssistantLoading || hasMissingPersistedAssistant) return
      void onCreateEmptyTopic?.(payload ?? (selectedAssistantId ? { assistantId: selectedAssistantId } : undefined))
    },
    [hasMissingPersistedAssistant, isAssistantLoading, onCreateEmptyTopic, selectedAssistantId]
  )

  const addNewTopic = useCallback(
    (payload?: AddNewTopicPayload) => {
      if (onCreateEmptyTopic) {
        createEmptyTopic(payload)
        return
      }
      void onNewTopic?.(payload)
    },
    [createEmptyTopic, onCreateEmptyTopic, onNewTopic]
  )

  const handleNewTopicShortcut = useCallback(() => {
    addNewTopic()
  }, [addNewTopic])
  const hasNewTopicAction = Boolean(onCreateEmptyTopic || onNewTopic)
  const newTopicDisabled = Boolean(onCreateEmptyTopic) && (isAssistantLoading || hasMissingPersistedAssistant)
  const handleStartNewContext = useCallback(async () => {
    if (!chatWrite || clearContextDisabled) return

    setIsStartingNewContext(true)
    try {
      await chatWrite.startNewContext()
      actionsRef.current.focus('end')
    } catch (error) {
      logger.warn('Failed to update context boundary', { error })
      toast.error(t('message.error.operation_unavailable'))
    } finally {
      setIsStartingNewContext(false)
    }
  }, [actionsRef, chatWrite, clearContextDisabled, t])

  const rootPanelLeadingItems = useMemo<QuickPanelListItem[]>(() => {
    const items: QuickPanelListItem[] = []

    if (hasNewTopicAction) {
      const label = t('chat.conversation.new')
      items.push({
        id: CHAT_NEW_CONVERSATION_TOOL_ID,
        label,
        icon: <NewConversationIcon size={16} />,
        disabled: newTopicDisabled,
        filterText: label,
        searchAliases: getQuickPanelSearchAliases(t, 'chat.conversation.new', ['new chat']),
        action: () => {
          addNewTopic()
        }
      })
    }

    return items
  }, [addNewTopic, hasNewTopicAction, newTopicDisabled, t])
  const toolbarCustomTools = useMemo<ComposerToolbarCustomTool[]>(
    () => [
      ...(hasNewTopicAction
        ? [
            {
              id: CHAT_NEW_CONVERSATION_TOOL_ID,
              label: t('chat.conversation.new'),
              icon: <NewConversationIcon size={18} aria-hidden />,
              disabled: newTopicDisabled,
              customizePlacement: 'leading' as const,
              requiresPanel: false,
              onSelect: () => addNewTopic()
            }
          ]
        : []),
      ...(chatWrite
        ? [
            {
              id: CHAT_CLEAR_CONTEXT_TOOL_ID,
              label: t('chat.input.new.context'),
              icon: <Eraser size={18} aria-hidden />,
              disabled: clearContextDisabled,
              customizePlacement: 'leading' as const,
              requiresPanel: false,
              availableWithoutModel: true,
              onSelect: () => void handleStartNewContext()
            }
          ]
        : []),
      ...CHAT_TOOLBAR_CUSTOM_TOOLS
    ],
    [addNewTopic, chatWrite, clearContextDisabled, handleStartNewContext, hasNewTopicAction, newTopicDisabled, t]
  )

  const rootPanelAdditionalItems = useMemo<QuickPanelListItem[]>(() => {
    const items: QuickPanelListItem[] = []
    if (!chatWrite || pinnedToolIds.includes(CHAT_CLEAR_CONTEXT_TOOL_ID)) return items

    const label = t('chat.input.new.context')
    items.push({
      id: CHAT_CLEAR_CONTEXT_TOOL_ID,
      label,
      icon: <Eraser size={16} />,
      disabled: clearContextDisabled,
      filterText: label,
      searchAliases: getQuickPanelSearchAliases(t, 'chat.input.new.context', ['clear context']),
      action: () => void handleStartNewContext()
    })
    return items
  }, [chatWrite, clearContextDisabled, handleStartNewContext, pinnedToolIds, t])
  useEffect(
    () => toolsRegistry.registerLaunchers('composer-toolbar-settings', [], [customizeFooterAction]),
    [customizeFooterAction, toolsRegistry]
  )

  const handleSurfaceActionsChange = useCallback(
    (actions: ComposerSurfaceActions) => {
      surfaceGetDraftRef.current = actions.getDraft
      Object.assign(actionsRef.current, actions)
    },
    [actionsRef]
  )

  useEffect(() => {
    return EventEmitter.on(EVENT_NAMES.FOCUS_CHAT_COMPOSER, (payload) => {
      const topicId = typeof payload === 'object' && payload ? (payload as { topicId?: string }).topicId : undefined
      if (topicId !== streamScopeKey) return
      actionsRef.current.focus('end')
    })
  }, [actionsRef, streamScopeKey])

  useEffect(() => {
    Object.assign(actionsRef.current, { addNewTopic })
  }, [actionsRef, addNewTopic])

  useComposerQuoteInsertion(actionsRef)

  const isActiveTab = useIsActiveTab()
  useCommandHandler('topic.create', handleNewTopicShortcut, { enabled: isActiveTab })
  useCommandHandler('chat.context.toggle_new', () => void handleStartNewContext(), {
    enabled: isActiveTab && Boolean(chatWrite) && !clearContextDisabled
  })

  const buildQueuedPayload = useCallback(
    (draft: ComposerSerializedDraft): ComposerQueuedMessagePayload | null => {
      const payload = buildComposerQueuedPayload(draft, {
        files,
        fileTokenId: chatComposerTokenId.file,
        // Allow attachment-only sends (matches v1 Inputbar + the send-enabled condition above).
        requireText: false,
        extra: () => ({
          mentionedModels: submittedMentionedModels.length
            ? submittedMentionedModels.map((currentModel) => currentModel.id)
            : undefined,
          reasoningEffort:
            assistantId && speedControlModel
              ? resolveComposerReasoningEffort(speedControlModel, reasoningEffort)
              : assistantId
                ? reasoningEffort
                : 'default',
          serviceTier:
            assistantId && speedControlModel
              ? resolveComposerServiceTier(speedControlModel, serviceTier)
              : assistantId
                ? serviceTier
                : 'standard',
          ...(fastMode && speedControlModel?.supportsFastMode === true ? { fastMode: true } : {}),
          chatTarget
        })
      })
      if (!payload) return null

      const tokenIds = getComposerTokenIds(draft.tokens)
      const knowledgeBaseIds = selectedKnowledgeBasesInScope
        .filter((base) => tokenIds.has(chatComposerTokenId.knowledge(base)))
        .map((base) => base.id)
      return {
        ...payload,
        userMessageParts: withKnowledgeScopePart(payload.userMessageParts, knowledgeBaseIds)
      }
    },
    [
      assistantId,
      chatTarget,
      fastMode,
      files,
      reasoningEffort,
      serviceTier,
      selectedKnowledgeBasesInScope,
      speedControlModel,
      submittedMentionedModels
    ]
  )

  const sendQueuedPayload = useCallback(
    async (payload: ComposerQueuedMessagePayload) => {
      setIsSending(true)

      try {
        const attachments = (payload.attachments as ComposerAttachment[] | undefined) ?? []
        const fileParts = await buildFilePartsForAttachments(attachments)
        const sent = await onSend(payload.text, {
          mentionedModels: payload.mentionedModels,
          userMessageParts: [...payload.userMessageParts, ...fileParts],
          reasoningEffort: payload.reasoningEffort,
          serviceTier: payload.serviceTier,
          ...(payload.fastMode ? { fastMode: true } : {}),
          chatTarget: payload.chatTarget
        })
        if (sent === false) return false
        saveHistory(getComposerHistoryText(payload.userMessageParts))
        return true
      } catch (error) {
        logger.warn('send failed', { error })
        toast.error(t('chat.input.send_failed'))
        return false
      } finally {
        setIsSending(false)
      }
    },
    [onSend, saveHistory, t]
  )

  const clearCurrentDraft = useCallback(() => {
    setText('')
    setDraftTokens(undefined)
    setFiles([])
    // Knowledge base selection belongs to the conversation scope, not the individual draft.
    // Clearing the composer must also drop the input-history nav state: a
    // recalled draft that gets sent/queued without further edits would otherwise
    // leave useInputHistory pointing at that history entry, so the next
    // ArrowDown would restore the already-sent draft and ArrowUp would resume
    // from a stale index.
    resetHistoryIndex()
    inputHistoryToolsRef.current = null
  }, [resetHistoryIndex, setFiles, setText])

  // Queue mode: while a turn streams, follow-ups go here instead of sending; the head auto-drains
  // (normal send) when the topic goes idle, and the dock steers/edits/removes individual items.
  const {
    items: queuedFollowups,
    enqueue: enqueueFollowup,
    removeId: removeFollowup,
    reorder: reorderFollowups,
    paused: followupPaused,
    setPaused: setFollowupPaused
  } = useFollowupQueue({
    scopeKey: selectedKnowledgeBasesScopeKey,
    isFulfilled,
    markSeen,
    onDrain: sendQueuedPayload
  })
  const queuedFollowupModelsDataEnabled = queuedFollowups.some(
    (item) => (item.payload.mentionedModels?.length ?? 0) > 0
  )
  const isQueuedFollowupSteerDisabled = useCallback(
    (item: FollowupQueueItem) => (isPending || awaitingApproval) && item.payload.chatTarget?.mode === 'reserved-branch',
    [awaitingApproval, isPending]
  )
  const { models: allModels } = useModels({ enabled: true }, { fetchEnabled: queuedFollowupModelsDataEnabled })

  // Edit a queued item = atomically restore the whole editor draft plus its managed tools, then drop
  // it from the queue. Atomic replacement also preserves unmanaged tokens when the text is unchanged.
  const restoreFollowupDraft = useCallback(
    (item: FollowupQueueItem) => {
      resetHistoryIndex()
      inputHistoryToolsRef.current = null
      skipDraftCacheWriteForHistoryPreviewRef.current = false
      actionsRef.current.replaceDraft(item.draft)
      setText(item.draft.text)
      setDraftTokens(item.draft.tokens.length ? [...item.draft.tokens] : undefined)
      setFiles((item.payload.attachments as ComposerAttachment[] | undefined) ?? [])
      restoreKnowledgeBaseSelection(getKnowledgeBaseIdsFromParts(item.payload.userMessageParts) ?? [])
      const queuedModels = (item.payload.mentionedModels ?? [])
        .map((modelId) => allModels.find((candidate) => candidate.id === modelId))
        .filter((candidate): candidate is Model => candidate !== undefined)
      if (queuedModels.length > 0) {
        changeMentionedModelMultiSelectMode(queuedModels.length > 1)
        selectMentionedModels(queuedModels)
      } else {
        restoreMentionedModelSelector()
      }
      handleReasoningEffortChange(item.payload.reasoningEffort ?? 'default')
      handleServiceTierChange(item.payload.serviceTier ?? 'standard')
      setFastMode(item.payload.fastMode === true)
    },
    [
      actionsRef,
      allModels,
      changeMentionedModelMultiSelectMode,
      handleReasoningEffortChange,
      handleServiceTierChange,
      resetHistoryIndex,
      restoreKnowledgeBaseSelection,
      restoreMentionedModelSelector,
      selectMentionedModels,
      setFiles,
      setText
    ]
  )

  const buildEditedMessageParts = useCallback(
    async (draft: ComposerSerializedDraft) => {
      const normalizedDraft = trimComposerDraftBoundaryBlankLines(draft)
      const tokenIds = getComposerTokenIds(normalizedDraft.tokens)
      const payloadFiles = files.filter((file) => tokenIds.has(chatComposerTokenId.file(file)))
      if (hasUnsyncedComposerAttachments(files, payloadFiles)) return null

      const originalFilePartsByTokenId = editingOriginalFilePartsByTokenIdRef.current

      const newFiles = payloadFiles.filter((file) => !originalFilePartsByTokenId.has(chatComposerTokenId.file(file)))
      const [textPart] = createComposerUserMessageParts(normalizedDraft)
      const newFileParts = await buildFilePartsForAttachments(newFiles)
      const rebuiltFileParts = new Map<string, CherryMessagePart>()

      newFileParts.forEach((part, index) => {
        const file = newFiles[index]
        if (file) rebuiltFileParts.set(chatComposerTokenId.file(file), part)
      })

      const messageParts = [
        textPart,
        ...payloadFiles.flatMap((file) => {
          const tokenId = chatComposerTokenId.file(file)
          const originalFilePart = originalFilePartsByTokenId.get(tokenId)
          const filePart = originalFilePart
            ? withComposerFilePartMeta(originalFilePart, file)
            : rebuiltFileParts.get(tokenId)
          return filePart ? [filePart] : []
        })
      ]
      const knowledgeBaseIds = selectedKnowledgeBasesInScope
        .filter((base) => tokenIds.has(chatComposerTokenId.knowledge(base)))
        .map((base) => base.id)
      return withKnowledgeScopePart(messageParts, knowledgeBaseIds)
    },
    [files, selectedKnowledgeBasesInScope]
  )

  /** `resend` = fork the user message and regenerate; otherwise save the edit in place. */
  const commitEditedMessage = useCallback(
    async (draft: ComposerSerializedDraft, resend: boolean) => {
      if (!editingMessageForCurrentTopic) return
      const editingSessionId = editingMessageForCurrentTopic.editingSessionId
      if (editSaveInFlightSessionIdRef.current === editingSessionId) return

      const isAssistantReply = editingMessageForCurrentTopic.message.role === 'assistant'
      if (!chatWrite) {
        toast.error(t('message.error.operation_unavailable'))
        return
      }

      if (isAssistantReply && !canEditAssistantMessageParts(editingMessageForCurrentTopic.parts)) {
        toast.error(t('message.error.operation_unavailable'))
        return
      }

      editSaveInFlightSessionIdRef.current = editingSessionId
      setSavingEditingSessionId(editingSessionId)
      try {
        const editedParts = await buildEditedMessageParts(draft)
        if (!editedParts) return

        const savedParts = isAssistantReply
          ? replaceComposerEditableMessageParts(editingMessageForCurrentTopic.parts, editedParts)
          : editedParts
        if (isAssistantReply || !resend) {
          await chatWrite.editMessage(editingMessageForCurrentTopic.message.id, savedParts)
        } else {
          const editedTurnOptions = isMentionedModelSelectorLocked
            ? undefined
            : {
                reasoningEffort:
                  assistantId && speedControlModel
                    ? resolveComposerReasoningEffort(speedControlModel, reasoningEffort)
                    : assistantId
                      ? reasoningEffort
                      : 'default',
                serviceTier:
                  assistantId && speedControlModel
                    ? resolveComposerServiceTier(speedControlModel, serviceTier)
                    : assistantId
                      ? serviceTier
                      : 'standard',
                fastMode: fastMode && speedControlModel?.supportsFastMode === true
              }
          await chatWrite.forkAndResend(editingMessageForCurrentTopic.message.id, savedParts, editedTurnOptions)
        }
        if (editingMessageForCurrentTopicRef.current?.editingSessionId === editingSessionId) {
          restoreSavedDraft()
          stopEditing()
        }
      } catch (error) {
        logger.warn('edited message save failed', { error, role: editingMessageForCurrentTopic.message.role })
        toast.error(t('message.error.operation_unavailable'))
      } finally {
        if (editSaveInFlightSessionIdRef.current === editingSessionId) {
          editSaveInFlightSessionIdRef.current = null
          setSavingEditingSessionId((currentSessionId) =>
            currentSessionId === editingSessionId ? null : currentSessionId
          )
        }
      }
    },
    [
      assistantId,
      buildEditedMessageParts,
      chatWrite,
      editingMessageForCurrentTopic,
      editingMessageForCurrentTopicRef,
      fastMode,
      isMentionedModelSelectorLocked,
      reasoningEffort,
      serviceTier,
      restoreSavedDraft,
      speedControlModel,
      stopEditing,
      t
    ]
  )

  const handleSaveEditedMessage = useCallback(
    (draft: ComposerSerializedDraft) => commitEditedMessage(draft, false),
    [commitEditedMessage]
  )

  const handleSendDraft = useCallback(
    async (draft: ComposerSerializedDraft) => {
      if (directSendInFlightRef.current) return

      if (staleEditingMessage) {
        restoreSavedDraft()
        stopEditing()
        return
      }

      if (editingMessageForCurrentTopic) {
        await commitEditedMessage(draft, true)
        return
      }

      if (missingAssistantMessage) {
        toast.error(selectAssistantMessage)
        return
      }

      if (!runtimeModel && !selectedModelForMissingAssistantDefault && !selectedModelForUnlinkedHome) {
        toast.error(t('code.model_required'))
        return
      }

      if (missingSelectedModelMessage) {
        toast.error(missingSelectedModelMessage)
        return
      }

      if (sendDisabled) return
      if (runtimeModelPending) return
      // While streaming, only block if we can't steer (e.g. paused for tool approval).
      if (loading && !canSteer) return

      const payload = buildQueuedPayload(draft)
      if (!payload) return

      // Busy (streaming, not awaiting approval) → queue the follow-up instead of sending now. The
      // dock lets the user steer/edit/remove it; the head auto-drains when the turn goes idle.
      if (canSteer) {
        enqueueFollowup(draft, payload)
        clearCurrentDraft()
        return
      }

      directSendInFlightRef.current = true
      setIsDirectSending(true)
      try {
        if (selectedModelForMissingAssistantDefault) {
          await handleModelSelect(selectedModelForMissingAssistantDefault)
        }

        const sent = await sendQueuedPayload(payload)
        if (sent) clearCurrentDraft()
      } finally {
        directSendInFlightRef.current = false
        setIsDirectSending(false)
      }
    },
    [
      buildQueuedPayload,
      canSteer,
      clearCurrentDraft,
      commitEditedMessage,
      editingMessageForCurrentTopic,
      enqueueFollowup,
      handleModelSelect,
      loading,
      missingAssistantMessage,
      missingSelectedModelMessage,
      runtimeModel,
      runtimeModelPending,
      selectedModelForMissingAssistantDefault,
      selectedModelForUnlinkedHome,
      sendDisabled,
      selectAssistantMessage,
      sendQueuedPayload,
      staleEditingMessage,
      stopEditing,
      restoreSavedDraft,
      t
    ]
  )

  const renderPersistentToolShortcuts = useCallback(
    ({
      inputAdapter,
      unifiedPanelControl
    }: {
      inputAdapter?: ComposerInputAdapter
      unifiedPanelControl?: ComposerUnifiedPanelControl
    }) => (
      <ComposerToolbarShortcuts
        scope={TopicType.Chat}
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

  if (isMultiSelectMode) return null

  const controlSlots = renderControls({
    assistantId: selectedAssistantId,
    assistantName,
    assistantEmoji: displayAssistant?.emoji,
    model: runtimeModel,
    modelPending: runtimeModelPending,
    providers,
    mentionedModels,
    mentionedModelSelectorValue,
    lockedMentionedModels,
    mentionedModelMultiSelectMode,
    useMentionedModelSelector,
    shouldAutoSelectCreatedAssistant: Boolean(onDraftAssistantChange),
    selectModelLabel: runtimeModelPending ? t('common.loading') : t('button.select_model'),
    topBarPortalAvailable,
    topBarPortalIconOnly,
    renderPersistentToolShortcuts,
    onAssistantChange: handleAssistantChange,
    onModelSelect: handleModelSelect,
    onMentionedModelsSelect: handleMentionedModelsSelect,
    onMentionedModelMultiSelectModeChange: handleMentionedModelMultiSelectModeChange,
    onMentionedModelSelectorRestore: handleMentionedModelSelectorRestore
  })
  const sendAccessory: ComposerSurfaceProps['sendAccessory'] = (
    <>
      {speedControlModel ? (
        <ComposerSpeedControl
          model={speedControlModel}
          reasoningEffort={reasoningEffort}
          reasoningSummary={assistant?.settings.reasoning_summary}
          serviceTier={serviceTier}
          fastMode={fastMode}
          onReasoningEffortChange={handleReasoningEffortChange}
          onReasoningSummaryChange={handleReasoningSummaryChange}
          onServiceTierChange={handleServiceTierChange}
          onFastModeChange={setFastMode}
        />
      ) : null}
      <ChatComposerContextUsage usage={contextUsage} />
    </>
  )

  return (
    <ComposerToolDerivedStateProvider
      couldAddImageFile={canAddImageFile}
      extensions={supportedExts}
      selectableKnowledgeBases={selectableKnowledgeBases}>
      {displayAssistant && runtimeModel && (
        <ComposerToolRuntimeHost scope={scope} assistant={displayAssistant} model={runtimeModel} />
      )}
      <ResourceEditDialogEventHost />
      <ComposerPinnedToolsProvider value={pinnedToolIds}>
        <ComposerSurface
          text={text}
          onTextChange={handleTextChange}
          tokens={tokens}
          draftTokens={draftTokens}
          managedTokenKinds={
            isKnowledgeBaseDraftHydrated ? CHAT_MANAGED_TOKEN_KINDS : CHAT_MANAGED_TOKEN_KINDS_BEFORE_KNOWLEDGE_RESTORE
          }
          onTokensChange={handleTokensChange}
          suggestionSources={entityReferenceSources}
          resolveKnowledgeBaseMarker={resolveKnowledgeBaseMarker}
          placeholder={searching ? t('chat.input.translating') : placeholderText}
          sendMessageShortcut={sendMessageShortcut}
          sendDisabled={
            (text.trim().length === 0 && files.length === 0) ||
            (loading && !canSteer) ||
            isSavingEdit ||
            isDirectSending ||
            sendDisabled ||
            searching ||
            runtimeModelPending ||
            hasPendingReference ||
            !!missingAssistantMessage ||
            !!missingModelMessage ||
            !!missingSelectedModelMessage
          }
          sendBlockedReason={
            isSavingEdit || isDirectSending || sendDisabled || hasPendingReference
              ? t('common.loading')
              : (missingAssistantMessage ?? missingModelMessage ?? missingSelectedModelMessage)
          }
          isLoading={loading}
          onSendDraft={handleSendDraft}
          editingState={
            editingMessageForCurrentTopic
              ? {
                  messageId: editingMessageForCurrentTopic.message.id,
                  highlightKey: editingMessageForCurrentTopic.editingSessionId,
                  onLocate: handleLocateEditingMessage,
                  onCancel: handleCancelEditing,
                  // Assistant edits already save in place on send; only user edits need a save-only path.
                  onSave:
                    editingMessageForCurrentTopic.message.role === 'assistant' ? undefined : handleSaveEditedMessage
                }
              : undefined
          }
          onPause={onPause}
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
                }}
                onEdit={(id) => {
                  const item = queuedFollowups.find((entry) => entry.id === id)
                  if (!item) return
                  restoreFollowupDraft(item)
                  removeFollowup(id)
                }}
                onRemove={removeFollowup}
                onReorder={reorderFollowups}
                isSteerDisabled={isQueuedFollowupSteerDisabled}
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
          editable={!searching && !isDirectSending}
          fontSize={fontSize}
          narrowMode={forceNarrowLayout || narrowMode}
          railGutterPx={railGutterPx}
          onFocus={() => setSearching(false)}
          onActionsChange={handleSurfaceActionsChange}
          isInputHistoryActive={isInputHistoryActive}
          onInputHistoryNavigate={handleInputHistoryNavigate}
          getToolLaunchers={() => getLaunchers()}
          toolLaunchersVersion={toolLaunchersVersion}
          rootPanelLeadingItems={rootPanelLeadingItems}
          rootPanelAdditionalItems={rootPanelAdditionalItems}
          onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
          deferQuickPanel={deferQuickPanel}
          sendAccessory={sendAccessory}
          compactWhenSingleLine={compactWhenSingleLine}
          {...controlSlots}
        />
      </ComposerPinnedToolsProvider>
    </ComposerToolDerivedStateProvider>
  )
}

const ChatComposer = (props: ChatComposerProps) => {
  return (
    <ChatComposerRoot
      {...props}
      renderControls={props.externalContextControls ? renderChatInputControls : renderChatToolbarControls}
    />
  )
}

export const ChatHomeComposer = (props: ChatComposerProps) => {
  return (
    <ChatComposerRoot
      {...props}
      useMentionedModelSelector
      forceNarrowLayout
      renderControls={props.externalContextControls ? renderChatHomeInputControls : renderChatHomeControls}
    />
  )
}

export const ChatPlacementComposer = (props: ChatPlacementComposerProps) => {
  const { placement, ...composerProps } = props

  if (placement === 'home') {
    return (
      <ChatComposerRoot
        {...composerProps}
        useMentionedModelSelector
        forceNarrowLayout
        deferQuickPanel
        renderControls={composerProps.externalContextControls ? renderChatHomeInputControls : renderChatHomeControls}
      />
    )
  }

  return (
    <ChatComposerRoot
      {...composerProps}
      useMentionedModelSelector
      deferQuickPanel
      renderControls={composerProps.externalContextControls ? renderChatInputControls : renderChatToolbarControls}
    />
  )
}

export default ChatComposer
