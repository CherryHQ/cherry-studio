import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { MessageEditingProvider, useMessageEditing } from '@renderer/components/chat/editing/MessageEditingContext'
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
  useComposerToolLauncherController,
  useComposerToolLauncherVersion,
  useComposerToolState
} from '@renderer/components/composer/ComposerToolRuntime'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { getComposerToolConfig } from '@renderer/components/composer/tools/registry'
import EmojiIcon from '@renderer/components/EmojiIcon'
import NewConversationIcon from '@renderer/components/icons/NewConversationIcon'
import { ModelSelector } from '@renderer/components/ModelSelector'
import type { QuickPanelListItem } from '@renderer/components/QuickPanel'
import { AssistantSelector } from '@renderer/components/resourceCatalog/selectors'
import { useCache } from '@renderer/data/hooks/useCache'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useChatWrite } from '@renderer/hooks/chat/ChatWriteContext'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useProviders } from '@renderer/hooks/useProvider'
import { useTopicMutations } from '@renderer/hooks/useTopic'
import { useTopicAwaitingApproval, useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { toast } from '@renderer/services/toast'
import { type Topic, TopicType } from '@renderer/types/topic'
import { buildFilePartsForAttachments, withComposerFilePartMeta } from '@renderer/utils/file/buildFileParts'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { canEditAssistantMessageParts } from '@renderer/utils/message/partsHelpers'
import { canModelUseAssistantWebSearch } from '@renderer/utils/model'
import { getLeadingEmoji } from '@renderer/utils/naming'
import { cn } from '@renderer/utils/style'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNonChatModel } from '@shared/utils/model'
import { Bot, ChevronDown } from 'lucide-react'
import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createComposerUserMessageParts } from '../composerDraft'
import type { InputHistoryDirection } from '../inputHistoryNavigation'
import { QueuedFollowupsDock } from '../QueuedFollowupsDock'
import type { ComposerDraftToken, ComposerSerializedDraft, ComposerSerializedToken } from '../tokens'
import { type FollowupQueueItem, useFollowupQueue } from '../useFollowupQueue'
import { useInputHistory } from '../useInputHistory'
import { type ChatComposerDraftCache, readChatDraftCache, writeChatDraftCache } from './chat/chatDraftCache'
import { createEditableMessageDraft, getEditableKnowledgeBases } from './chat/messageEditingDraft'
import { useChatKnowledgeBaseScope } from './chat/useChatKnowledgeBaseScope'
import { useChatMentionedModels } from './chat/useChatMentionedModels'
import {
  chatComposerTokenId,
  fileToComposerToken,
  getComposerTokenIds,
  knowledgeBaseToComposerToken
} from './chatComposerTokens'
import { SelectedModelsTrigger } from './SelectedModelsTrigger'
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
import { type AddNewTopicPayload, emptyActions, type ProviderActionHandlers } from './shared/composerProviderActions'
import { buildComposerQueuedPayload, hasUnsyncedComposerAttachments } from './shared/composerQueuedPayload'
import { useComposerQuoteInsertion } from './shared/composerQuote'
import { ComposerToolbarShortcuts } from './shared/ComposerToolbarShortcuts'
import { useComposerFileCapabilities } from './shared/useComposerFileCapabilities'
import { useComposerToolbarPinnedTools } from './shared/useComposerToolbarPinnedTools'
import { useLatest } from './shared/useLatest'

const logger = loggerService.withContext('ChatComposer')
const CHAT_MANAGED_TOKEN_KINDS = ['file', 'knowledge'] as const satisfies readonly ComposerDraftToken['kind'][]
const CHAT_MODEL_FILTER = (model: Model) => !isNonChatModel(model)

interface ChatComposerProps {
  topic?: Topic
  scopeKey?: string
  topicId?: string
  assistantId?: string
  onSend: (
    text: string,
    options?: {
      mentionedModels?: UniqueModelId[]
      knowledgeBaseIds?: KnowledgeBase['id'][]
      userMessageParts?: CherryMessagePart[]
    }
  ) => void | Promise<void>
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
  selectedKnowledgeBases: KnowledgeBase[]
}

interface InputHistoryToolSnapshot extends Pick<SavedComposerDraft, 'files' | 'selectedKnowledgeBases'> {
  mentionedModels: Model[]
}

type ComposerFilePart = Extract<CherryMessagePart, { type: 'file' }>

const isComposerEditableMessagePart = (part: CherryMessagePart) => part.type === 'text' || part.type === 'file'

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

interface ChatComposerContextControlsProps {
  assistantId: string | null
  assistantName: string
  assistantEmoji?: string
  model?: Model
  modelPending?: boolean
  providers: Provider[]
  mentionedModels: Model[]
  mentionedModelSelectorValue: Model[]
  lockedMentionedModels: Model[]
  mentionedModelMultiSelectMode: boolean
  selectModelLabel: string
  useMentionedModelSelector?: boolean
  shouldAutoSelectCreatedAssistant: boolean
  side: 'top' | 'bottom'
  iconOnly?: boolean
  onDialogCloseAutoFocus?: () => void
  onAssistantChange: (assistantId: string | null) => void | Promise<void>
  onModelSelect: (model: Model | undefined) => void
  onMentionedModelsSelect: (models: Model[]) => void
  onMentionedModelMultiSelectModeChange: (enabled: boolean) => void
  onMentionedModelSelectorRestore: () => void
}

const ChatComposerContextControls = ({
  assistantId,
  assistantName,
  assistantEmoji,
  model,
  modelPending,
  providers,
  mentionedModels,
  mentionedModelSelectorValue,
  lockedMentionedModels,
  mentionedModelMultiSelectMode,
  selectModelLabel,
  useMentionedModelSelector,
  shouldAutoSelectCreatedAssistant,
  side,
  iconOnly = false,
  onDialogCloseAutoFocus,
  onAssistantChange,
  onModelSelect,
  onMentionedModelsSelect,
  onMentionedModelMultiSelectModeChange,
  onMentionedModelSelectorRestore
}: ChatComposerContextControlsProps) => {
  const assistantIcon = assistantEmoji || getLeadingEmoji(assistantName)
  const triggerClassName = side === 'bottom' ? COMPOSER_BELOW_SELECTOR_BUTTON_CLASS : COMPOSER_SELECTOR_BUTTON_CLASS
  const compactTriggerClassName = cn(triggerClassName, iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS)
  const labelClassName = cn('truncate', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)
  const modelTriggerClassName = cn(triggerClassName, iconOnly && model && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS)
  const modelLabelClassName = cn('truncate', iconOnly && model && COMPOSER_ICON_ONLY_LABEL_CLASS)
  const isMentionedModelSelectorLocked = lockedMentionedModels.length > 1
  const selectedMentionedModels = isMentionedModelSelectorLocked
    ? lockedMentionedModels
    : useMentionedModelSelector
      ? mentionedModelSelectorValue
      : mentionedModels
  const mentionedModelTriggerClassName = cn(
    triggerClassName,
    iconOnly && selectedMentionedModels.length > 0 && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS
  )
  const assistantModelLabel = model ? model.name : selectModelLabel
  const modelLabel = assistantModelLabel
  const [mentionedModelSelectorOpen, setMentionedModelSelectorOpen] = useState(false)
  const handleMentionedModelSelect = useCallback(
    (nextModels: Model[]) => {
      onMentionedModelsSelect(nextModels)
    },
    [onMentionedModelsSelect]
  )

  const handleMentionedModelMultiSelectModeChange = useCallback(
    (nextEnabled: boolean) => {
      onMentionedModelMultiSelectModeChange(nextEnabled)
    },
    [onMentionedModelMultiSelectModeChange]
  )

  const assistantTrigger = (
    <Button variant="ghost" size="sm" className={compactTriggerClassName}>
      {assistantIcon ? <EmojiIcon emoji={assistantIcon} size={20} /> : iconOnly ? <Bot size={16} aria-hidden /> : null}
      <span className={cn('max-w-40', labelClassName)}>{assistantName}</span>
      <ChevronDown size={14} aria-hidden className={cn('text-muted-foreground', iconOnly && 'hidden')} />
    </Button>
  )

  return (
    <>
      <AssistantSelector
        multi={false}
        value={assistantId}
        onChange={onAssistantChange}
        autoSelectOnCreate={shouldAutoSelectCreatedAssistant}
        side={side}
        align="start"
        mountStrategy="lazy-keep"
        onDialogCloseAutoFocus={onDialogCloseAutoFocus}
        trigger={assistantTrigger}
      />
      {useMentionedModelSelector && isMentionedModelSelectorLocked ? (
        <SelectedModelsTrigger
          className={mentionedModelTriggerClassName}
          disabled
          iconOnly={iconOnly}
          models={selectedMentionedModels}
          assistantModel={model}
          providers={providers}
          fallbackLabel={selectModelLabel}
          suppressSelectionPopover
          onModelsChange={() => undefined}
          onRestore={() => undefined}
        />
      ) : useMentionedModelSelector ? (
        <ModelSelector
          multiple
          value={mentionedModelSelectorValue}
          onSelect={handleMentionedModelSelect}
          open={mentionedModelSelectorOpen}
          onOpenChange={setMentionedModelSelectorOpen}
          multiSelectMode={mentionedModelMultiSelectMode}
          onMultiSelectModeChange={handleMentionedModelMultiSelectModeChange}
          filter={CHAT_MODEL_FILTER}
          shortcut="chat.model.select"
          side={side}
          align="start"
          mountStrategy="lazy-keep"
          trigger={
            <SelectedModelsTrigger
              className={mentionedModelTriggerClassName}
              disabled={modelPending}
              iconOnly={iconOnly}
              models={selectedMentionedModels}
              assistantModel={model}
              providers={providers}
              fallbackLabel={selectModelLabel}
              suppressSelectionPopover={mentionedModelSelectorOpen}
              onModelsChange={handleMentionedModelSelect}
              onRestore={onMentionedModelSelectorRestore}
            />
          }
        />
      ) : (
        <ModelSelector
          multiple={false}
          value={model}
          onSelect={onModelSelect}
          filter={CHAT_MODEL_FILTER}
          shortcut="chat.model.select"
          side={side}
          align="start"
          mountStrategy="lazy-keep"
          trigger={
            <Button variant="ghost" size="sm" className={modelTriggerClassName} disabled={modelPending}>
              {model ? <ModelAvatar model={model} size={20} /> : null}
              <span className={cn('max-w-52', modelLabelClassName)}>{modelLabel}</span>
              <ChevronDown
                size={14}
                aria-hidden
                className={cn('text-muted-foreground', iconOnly && model && 'hidden')}
              />
            </Button>
          }
        />
      )}
    </>
  )
}

type ChatComposerControlProps = Omit<ChatComposerContextControlsProps, 'side'> & {
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
type ChatComposerControlSlots = Pick<ComposerSurfaceProps, 'renderLeftControls' | 'renderBelowControls'>
type ChatComposerControlsRenderer = (props: ChatComposerControlProps) => ChatComposerControlSlots

const restoreComposerInputFocus = (inputAdapter: ComposerInputAdapter) => {
  window.requestAnimationFrame(() => inputAdapter?.focus())
}

const ChatComposerContextControlsWithAutoFocus = ({
  inputAdapter,
  ...props
}: ChatComposerControlProps & { side: 'top' | 'bottom'; iconOnly?: boolean; inputAdapter: ComposerInputAdapter }) => {
  const onDialogCloseAutoFocus = useCallback(() => restoreComposerInputFocus(inputAdapter), [inputAdapter])

  return <ChatComposerContextControls {...props} onDialogCloseAutoFocus={onDialogCloseAutoFocus} />
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

type ChatComposerRootProps = ChatComposerProps & {
  renderControls: ChatComposerControlsRenderer
  forceNarrowLayout?: boolean
}

type ChatPlacementDockedProps = Omit<ChatComposerProps, 'onDraftAssistantChange'>
type ChatPlacementComposerProps =
  | (ChatComposerProps & { placement: 'home' })
  | (ChatPlacementDockedProps & { placement: 'docked' })

const ChatComposerRoot = ({
  topic,
  scopeKey,
  topicId,
  assistantId,
  onSend,
  sendDisabled,
  useMentionedModelSelector,
  onDraftAssistantChange,
  onNewTopic,
  onCreateEmptyTopic,
  renderControls,
  forceNarrowLayout = false
}: ChatComposerRootProps) => {
  const resolvedScopeKey = scopeKey ?? topic?.id
  const resolvedTopicId = topicId ?? topic?.id
  const resolvedAssistantId = assistantId ?? topic?.assistantId
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })
  // Snapshot the global draft cache once per mount: files seed the tool provider synchronously so
  // the surface's managed-token sync does not strip restored file tokens, and the same snapshot
  // feeds text/draftTokens in ChatComposerInner so files and tokens stay consistent.
  const initialDraftRef = useRef<ChatComposerDraftCache | null>(null)
  if (initialDraftRef.current === null) {
    initialDraftRef.current = readChatDraftCache()
  }
  const initialDraft = initialDraftRef.current
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
        initialState={initialState}
        actions={{
          addNewTopic: () => actionsRef.current.addNewTopic(),
          onTextChange: (updater) => actionsRef.current.onTextChange(updater)
        }}>
        {resolvedScopeKey ? (
          <ChatComposerInner
            scopeKey={resolvedScopeKey}
            topicId={resolvedTopicId}
            assistantId={resolvedAssistantId}
            initialDraft={initialDraft}
            actionsRef={actionsRef}
            onSend={onSend}
            sendDisabled={sendDisabled}
            useMentionedModelSelector={useMentionedModelSelector}
            onDraftAssistantChange={onDraftAssistantChange}
            onNewTopic={onNewTopic}
            onCreateEmptyTopic={onCreateEmptyTopic}
            renderControls={renderControls}
            forceNarrowLayout={forceNarrowLayout}
          />
        ) : null}
      </ComposerToolRuntimeProvider>
    </MessageEditingProvider>
  )
}

interface ChatComposerInnerProps extends Omit<ChatComposerProps, 'scopeKey'> {
  scopeKey: string
  initialDraft: ChatComposerDraftCache
  actionsRef: React.RefObject<ProviderActionHandlers>
  renderControls: ChatComposerControlsRenderer
  forceNarrowLayout?: boolean
}

const ChatComposerInner = ({
  scopeKey,
  topicId,
  assistantId,
  initialDraft,
  actionsRef,
  onSend,
  sendDisabled = false,
  useMentionedModelSelector,
  onDraftAssistantChange,
  onNewTopic,
  onCreateEmptyTopic,
  renderControls,
  forceNarrowLayout = false
}: ChatComposerInnerProps) => {
  const streamScopeKey = topicId ?? scopeKey
  const awaitingApproval = useTopicAwaitingApproval(streamScopeKey)
  const scope = TopicType.Chat
  const config = getComposerToolConfig(scope)
  const { files, mentionedModels, selectedKnowledgeBases, isExpanded } = useComposerToolState()
  const { setFiles, setMentionedModels, setSelectedKnowledgeBases, setIsExpanded } = useComposerToolDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherController()
  const toolLaunchersVersion = useComposerToolLauncherVersion()
  const {
    assistant,
    isLoading: isAssistantLoading,
    model,
    isModelPending,
    isModelMissing,
    setModel
  } = useAssistant(assistantId)
  const { updateTopic } = useTopicMutations()
  const { bases: allKnowledgeBases, isLoading: isKnowledgeBasesLoading } = useKnowledgeBases()
  const { providers } = useProviders()
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const {
    pinnedIds: pinnedToolIds,
    setPinnedIds: setPinnedToolIds,
    resetPinnedIds: resetPinnedToolIds,
    isDefault: pinnedToolsAtDefault,
    customizeOpen: customizeToolbarOpen,
    setCustomizeOpen: setCustomizeToolbarOpen,
    customizePanelItem
  } = useComposerToolbarPinnedTools('chat.input.toolbar.pinned_tools')
  const [fontSize] = usePreference('chat.message.font_size')
  const [narrowMode] = usePreference('chat.narrow_mode')
  const { available: topBarPortalAvailable, iconOnly: topBarPortalIconOnly } = useConversationTopBarPortalLayout()
  const [searching, setSearching] = useCache('chat.web_search.searching')
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')
  const { t } = useTranslation()
  const chatWrite = useChatWrite()
  const { editingMessage, cancelEditing, stopEditing } = useMessageEditing()
  const editingMessageForCurrentTopic = topicId && editingMessage?.message.topicId === topicId ? editingMessage : null
  const staleEditingMessage = editingMessage && !editingMessageForCurrentTopic
  const { isPending, isFulfilled, markSeen } = useTopicStreamStatus(streamScopeKey)
  const [isSending, setIsSending] = useState(false)
  const [text, setText] = useState(() => initialDraft.text)
  const [draftTokens, setDraftTokens] = useState<ComposerSerializedToken[] | undefined>(() =>
    initialDraft.tokens.length ? initialDraft.tokens : undefined
  )
  const filesRef = useLatest(files)
  const selectedKnowledgeBasesRef = useLatest(selectedKnowledgeBases)
  const mentionedModelsRef = useLatest(mentionedModels)
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
        setMentionedModels([])
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
  const { navigateHistory, resetHistoryIndex, takeDraftBeforeHistory, saveHistory } = useInputHistory({
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
  const editingOriginalFilePartsByTokenIdRef = useRef(new Map<string, ComposerFilePart>())
  const restoredEditingSessionIdRef = useRef<number | null>(null)
  const selectAssistantMessage = t('button.select_assistant')
  const displayAssistant = assistant
  const hasMissingPersistedAssistant = !!assistantId && !isAssistantLoading && !assistant
  const runtimeModel = assistant || !assistantId ? model : undefined
  const runtimeModelPending = isAssistantLoading || isModelPending
  const selectedAssistantId = assistant?.id ?? null

  const handleModelSelect = useCallback(
    (nextModel: Model | undefined) => {
      if (!nextModel) return
      if (!assistant) return

      const enabledWebSearch = canModelUseAssistantWebSearch(nextModel)
      return setModel(nextModel, { enableWebSearch: enabledWebSearch && assistant.settings.enableWebSearch })
    },
    [assistant, setModel]
  )

  const {
    mentionedModelSelectorValue,
    mentionedModelMultiSelectMode,
    handleMentionedModelsSelect: selectMentionedModels,
    handleMentionedModelMultiSelectModeChange: changeMentionedModelMultiSelectMode,
    handleMentionedModelSelectorRestore: restoreMentionedModelSelector
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
    writeChatDraftCache(visibleDraft.text, visibleDraft.tokens, filesRef.current)
  }, [actionsRef, exitInputHistoryPreview, filesRef])
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
      : []
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

  useEffect(() => {
    if (isPending) setIsSending(false)
  }, [isPending])

  useEffect(() => {
    setIsSending(false)
  }, [scopeKey])

  const loading = isPending || isSending || awaitingApproval
  // Steer: while a turn is streaming (but not paused for tool approval) a new message is sent as a
  // follow-up rather than blocked — the main process persists it and yields/chains a continuation.
  const canSteer = isPending && !awaitingApproval
  const selectedKnowledgeBasesScopeKey = `${scopeKey}:${selectedAssistantId ?? 'no-assistant'}`
  const assistantName = displayAssistant?.name ?? (isAssistantLoading ? t('common.loading') : selectAssistantMessage)
  const { canAddImageFile, supportedExts } = useComposerFileCapabilities({
    models: mentionedModels,
    fallbackModel: runtimeModel
  })

  const { selectableKnowledgeBases, selectedKnowledgeBasesInScope, resolveKnowledgeBaseMarker } =
    useChatKnowledgeBaseScope({
      assistantKnowledgeBaseIds: assistant?.knowledgeBaseIds,
      allKnowledgeBases,
      isKnowledgeBasesLoading,
      topicId: scopeKey,
      selectedAssistantId,
      selectedKnowledgeBases,
      setSelectedKnowledgeBases
    })

  // Single owner of the global draft cache. Runs after ComposerSurface's effects have synced the
  // editor to the current text, so getDraft() serializes the live tokens consistently. Every
  // persistable change reduces to a text or files state change (deleting a file token leaves text
  // unchanged but prunes files via reconcile); knowledge selection is intentionally not cached.
  const persistedOnceRef = useRef(false)
  useEffect(() => {
    if (!persistedOnceRef.current) {
      persistedOnceRef.current = true
      return
    }
    if (skipDraftCacheWriteForHistoryPreviewRef.current) {
      skipDraftCacheWriteForHistoryPreviewRef.current = false
      return
    }
    if (editingMessage) return
    writeChatDraftCache(text, actionsRef.current.getDraft().tokens, files)
  }, [actionsRef, editingMessage, files, text])

  const restoreSavedDraft = useCallback(() => {
    const savedDraft = savedDraftBeforeEditingRef.current
    savedDraftBeforeEditingRef.current = null

    if (!savedDraft) return

    exitInputHistoryPreview()
    actionsRef.current.replaceDraft({ text: savedDraft.text, tokens: savedDraft.draftTokens })
    setText(savedDraft.text)
    setDraftTokens(savedDraft.draftTokens)
    setFiles(savedDraft.files)
    setMentionedModels(savedDraft.mentionedModels)
    setSelectedKnowledgeBases(savedDraft.selectedKnowledgeBases)
  }, [actionsRef, exitInputHistoryPreview, setFiles, setMentionedModels, setSelectedKnowledgeBases])

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
        selectedKnowledgeBases: currentTools?.selectedKnowledgeBases ?? selectedKnowledgeBasesRef.current
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

  const placeholderText = t('chat.input.placeholder', { key: getSendMessageShortcutLabel(sendMessageShortcut) })

  const tokens = useMemo(
    () => [...files.map(fileToComposerToken), ...selectedKnowledgeBasesInScope.map(knowledgeBaseToComposerToken)],
    [files, selectedKnowledgeBasesInScope]
  )

  // Editor→state reconciliation owned by the tools: attachmentTool prunes+dedupes files,
  // knowledgeBaseTool prunes+re-adds knowledge bases (against the injected selectableKnowledgeBases).
  const handleTokensChange = useComposerTokenReconcile({ scope, assistant: displayAssistant, model: runtimeModel })

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

  const rootPanelLeadingItems = useMemo<QuickPanelListItem[]>(() => {
    const label = t('chat.conversation.new')

    if (!hasNewTopicAction) return []

    return [
      {
        id: 'composer:new-conversation',
        label,
        icon: <NewConversationIcon size={16} />,
        disabled: newTopicDisabled,
        filterText: label,
        searchAliases: getQuickPanelSearchAliases(t, 'chat.conversation.new', ['new chat']),
        action: () => {
          addNewTopic()
        }
      }
    ]
  }, [addNewTopic, hasNewTopicAction, newTopicDisabled, t])

  const rootPanelCustomizeItems = useMemo(() => [customizePanelItem], [customizePanelItem])

  const handleSurfaceActionsChange = useCallback(
    (actions: ComposerSurfaceActions) => {
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

  const buildQueuedPayload = useCallback(
    (draft: ComposerSerializedDraft): ComposerQueuedMessagePayload | null =>
      buildComposerQueuedPayload(draft, {
        files,
        fileTokenId: chatComposerTokenId.file,
        // Allow attachment-only sends (matches v1 Inputbar + the send-enabled condition above).
        requireText: false,
        extra: (tokenIds) => {
          const knowledgeBaseIds = selectedKnowledgeBasesInScope
            .filter((base) => tokenIds.has(chatComposerTokenId.knowledge(base)))
            .map((base) => base.id)
          return {
            mentionedModels: mentionedModels.length
              ? mentionedModels.map((currentModel) => currentModel.id)
              : undefined,
            knowledgeBaseIds: knowledgeBaseIds.length ? knowledgeBaseIds : undefined
          }
        }
      }),
    [files, mentionedModels, selectedKnowledgeBasesInScope]
  )

  const sendQueuedPayload = useCallback(
    async (payload: ComposerQueuedMessagePayload) => {
      setIsSending(true)

      try {
        const attachments = (payload.attachments as ComposerAttachment[] | undefined) ?? []
        const fileParts = await buildFilePartsForAttachments(attachments)
        await onSend(payload.text, {
          mentionedModels: payload.mentionedModels,
          knowledgeBaseIds: payload.knowledgeBaseIds,
          userMessageParts: [...payload.userMessageParts, ...fileParts]
        })
        saveHistory(payload.text)
        return true
      } catch (error) {
        logger.warn('send failed', { error })
        return false
      } finally {
        setIsSending(false)
      }
    },
    [onSend, saveHistory]
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
    onDrain: sendQueuedPayload,
    onDrainFailed: () => toast.error(t('chat.input.send_failed'))
  })

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
      setSelectedKnowledgeBases(allKnowledgeBases.filter((base) => item.payload.knowledgeBaseIds?.includes(base.id)))
    },
    [actionsRef, allKnowledgeBases, resetHistoryIndex, setFiles, setSelectedKnowledgeBases, setText]
  )

  const buildEditedMessageParts = useCallback(
    async (draft: ComposerSerializedDraft) => {
      const tokenIds = getComposerTokenIds(draft.tokens)
      const payloadFiles = files.filter((file) => tokenIds.has(chatComposerTokenId.file(file)))
      if (hasUnsyncedComposerAttachments(files, payloadFiles)) return null

      const originalFilePartsByTokenId = editingOriginalFilePartsByTokenIdRef.current

      const newFiles = payloadFiles.filter((file) => !originalFilePartsByTokenId.has(chatComposerTokenId.file(file)))
      const [textPart] = createComposerUserMessageParts(draft)
      const newFileParts = await buildFilePartsForAttachments(newFiles)
      const rebuiltFileParts = new Map<string, CherryMessagePart>()

      newFileParts.forEach((part, index) => {
        const file = newFiles[index]
        if (file) rebuiltFileParts.set(chatComposerTokenId.file(file), part)
      })

      return [
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
    },
    [files]
  )

  const handleSendDraft = useCallback(
    async (draft: ComposerSerializedDraft) => {
      if (staleEditingMessage) {
        restoreSavedDraft()
        stopEditing()
        return
      }

      if (editingMessageForCurrentTopic) {
        const isAssistantReply = editingMessageForCurrentTopic.message.role === 'assistant'
        const saveEditedMessage = isAssistantReply ? chatWrite?.editMessage : chatWrite?.forkAndResend
        if (!saveEditedMessage) {
          toast.error(t('message.error.operation_unavailable'))
          return
        }

        if (isAssistantReply && !canEditAssistantMessageParts(editingMessageForCurrentTopic.parts)) {
          toast.error(t('message.error.operation_unavailable'))
          return
        }

        try {
          const editedParts = await buildEditedMessageParts(draft)
          if (!editedParts) return

          const savedParts = isAssistantReply
            ? replaceComposerEditableMessageParts(editingMessageForCurrentTopic.parts, editedParts)
            : editedParts
          await saveEditedMessage(editingMessageForCurrentTopic.message.id, savedParts)
          restoreSavedDraft()
          stopEditing()
        } catch (error) {
          logger.warn('edited message save failed', { error, role: editingMessageForCurrentTopic.message.role })
          toast.error(t('message.error.operation_unavailable'))
        }
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

      if (selectedModelForMissingAssistantDefault) {
        await handleModelSelect(selectedModelForMissingAssistantDefault)
      }

      // Optimistically clear the draft so the cleared input doubles as the re-entry
      // guard, but snapshot it first: a pre-stream failure never reaches the streaming
      // UI, so restore the draft (text + files + knowledge bases; tokens re-derive) and
      // surface the failure instead of silently discarding what the user typed.
      const previousText = text
      const previousFiles = files
      const previousKnowledgeBases = selectedKnowledgeBases

      clearCurrentDraft()
      const sent = await sendQueuedPayload(payload)
      if (!sent) {
        setText(previousText)
        setFiles(previousFiles)
        setSelectedKnowledgeBases(previousKnowledgeBases)
        toast.error(t('chat.input.send_failed'))
      }
    },
    [
      buildQueuedPayload,
      buildEditedMessageParts,
      canSteer,
      chatWrite,
      clearCurrentDraft,
      editingMessageForCurrentTopic,
      enqueueFollowup,
      files,
      handleModelSelect,
      loading,
      missingAssistantMessage,
      missingSelectedModelMessage,
      runtimeModel,
      runtimeModelPending,
      selectedKnowledgeBases,
      selectedModelForMissingAssistantDefault,
      selectedModelForUnlinkedHome,
      sendDisabled,
      selectAssistantMessage,
      sendQueuedPayload,
      setFiles,
      setSelectedKnowledgeBases,
      setText,
      staleEditingMessage,
      stopEditing,
      restoreSavedDraft,
      t,
      text
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
        pinnedIds={pinnedToolIds}
        onPinnedIdsChange={setPinnedToolIds}
        onResetPinnedIds={resetPinnedToolIds}
        isDefault={pinnedToolsAtDefault}
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
      setPinnedToolIds
    ]
  )

  if (isMultiSelectMode) return null

  const newTopicControl = hasNewTopicAction ? (
    <Tooltip content={t('chat.conversation.new')} placement="top">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn(COMPOSER_SEND_ACCESSORY_BUTTON_CLASS, '[&_.new-conversation-icon]:!size-5')}
        disabled={newTopicDisabled}
        aria-label={t('chat.conversation.new')}
        onClick={() => addNewTopic()}>
        <NewConversationIcon size={20} aria-hidden />
      </Button>
    </Tooltip>
  ) : undefined

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
    leadingControl: newTopicControl,
    renderPersistentToolShortcuts,
    onAssistantChange: handleAssistantChange,
    onModelSelect: handleModelSelect,
    onMentionedModelsSelect: handleMentionedModelsSelect,
    onMentionedModelMultiSelectModeChange: handleMentionedModelMultiSelectModeChange,
    onMentionedModelSelectorRestore: handleMentionedModelSelectorRestore
  })
  return (
    <ComposerToolDerivedStateProvider
      couldAddImageFile={canAddImageFile}
      extensions={supportedExts}
      selectableKnowledgeBases={selectableKnowledgeBases}>
      {displayAssistant && runtimeModel && (
        <ComposerToolRuntimeHost scope={scope} assistant={displayAssistant} model={runtimeModel} />
      )}
      <ComposerPinnedToolsProvider value={pinnedToolIds}>
        <ComposerSurface
          text={text}
          onTextChange={handleTextChange}
          tokens={tokens}
          draftTokens={draftTokens}
          managedTokenKinds={CHAT_MANAGED_TOKEN_KINDS}
          onTokensChange={handleTokensChange}
          resolveKnowledgeBaseMarker={resolveKnowledgeBaseMarker}
          placeholder={searching ? t('chat.input.translating') : placeholderText}
          sendDisabled={
            (text.trim().length === 0 && files.length === 0) ||
            (loading && !canSteer) ||
            sendDisabled ||
            searching ||
            runtimeModelPending ||
            !!missingAssistantMessage ||
            !!missingModelMessage ||
            !!missingSelectedModelMessage
          }
          sendBlockedReason={
            sendDisabled
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
                  onCancel: handleCancelEditing
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
          editable={!searching}
          fontSize={fontSize}
          narrowMode={forceNarrowLayout || narrowMode}
          onFocus={() => setSearching(false)}
          onActionsChange={handleSurfaceActionsChange}
          onInputHistoryNavigate={handleInputHistoryNavigate}
          getToolLaunchers={() => getLaunchers()}
          toolLaunchersVersion={toolLaunchersVersion}
          rootPanelLeadingItems={rootPanelLeadingItems}
          rootPanelAdditionalItems={rootPanelCustomizeItems}
          onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
          {...controlSlots}
        />
      </ComposerPinnedToolsProvider>
    </ComposerToolDerivedStateProvider>
  )
}

const ChatComposer = (props: ChatComposerProps) => {
  return <ChatComposerRoot {...props} renderControls={renderChatToolbarControls} />
}

export const ChatHomeComposer = (props: ChatComposerProps) => {
  return (
    <ChatComposerRoot {...props} useMentionedModelSelector forceNarrowLayout renderControls={renderChatHomeControls} />
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
        renderControls={renderChatHomeControls}
      />
    )
  }

  return <ChatComposerRoot {...composerProps} useMentionedModelSelector renderControls={renderChatToolbarControls} />
}

export default ChatComposer
