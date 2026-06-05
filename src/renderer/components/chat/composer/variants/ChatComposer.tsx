import { Button } from '@cherrystudio/ui'
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
import { formatQuoteTokenPromptText } from '@renderer/components/chat/utils/quoteToken'
import EmojiIcon from '@renderer/components/EmojiIcon'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { AssistantSelector, ModelSelector } from '@renderer/components/Selector'
import { isGenerateImageModel, isGenerateImageModels, isVisionModel, isVisionModels } from '@renderer/config/models'
import { MessageEditingProvider, useMessageEditing } from '@renderer/context/MessageEditingContext'
import { useIsActiveTab } from '@renderer/context/TabIdContext'
import { useCache } from '@renderer/data/hooks/useCache'
import { usePreference } from '@renderer/data/hooks/usePreference'
import {
  isRuntimeDefaultAssistantId,
  RUNTIME_DEFAULT_ASSISTANT_EMOJI
} from '@renderer/domain/assistant/runtimeDefaultAssistant'
import { useChatWrite } from '@renderer/hooks/ChatWriteContext'
import { useAssistant, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { useProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import { useTopicMutations } from '@renderer/hooks/useTopic'
import { useTopicAwaitingApproval, useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { AddNewTopicPayload } from '@renderer/pages/home/types'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { FileMetadata, Topic } from '@renderer/types'
import { FILE_TYPE, TopicType } from '@renderer/types'
import { cn, getLeadingEmoji } from '@renderer/utils'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import { canModelUseAssistantWebSearch } from '@renderer/utils/modelReconcile'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { IpcChannel } from '@shared/IpcChannel'
import { isNonChatModel } from '@shared/utils/model'
import { Bot } from 'lucide-react'
import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createComposerUserMessageParts } from '../composerDraft'
import {
  type ComposerDraftToken,
  type ComposerSerializedDraft,
  type ComposerSerializedToken,
  isComposerDraftTokenKind
} from '../tokens'
import {
  chatComposerTokenId,
  fileToComposerToken,
  getComposerTokenIds,
  knowledgeBaseToComposerToken
} from './chatComposerTokens'
import { SelectedModelsTrigger } from './SelectedModelsTrigger'
import { useComposerBottomToolbarIconOnly } from './useComposerBottomToolbarIconOnly'

const INPUTBAR_DRAFT_CACHE_KEY = 'inputbar-draft'
const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000
const logger = loggerService.withContext('ChatComposer')
const CHAT_MANAGED_TOKEN_KINDS = ['file', 'knowledge'] as const satisfies readonly ComposerDraftToken['kind'][]
const CHAT_MODEL_FILTER = (model: Model) => !isNonChatModel(model)
const KNOWLEDGE_BASE_IDS_KEY_SEPARATOR = '\u0000'
const COMPOSER_TOOLBAR_CLASS = 'flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden'
const COMPOSER_SELECTOR_BUTTON_CLASS = 'h-7 shrink-0 gap-1.5 rounded-full px-2 text-xs'
const COMPOSER_BELOW_SELECTOR_BUTTON_CLASS =
  'h-8 shrink-0 gap-1.5 rounded-lg border border-transparent bg-transparent px-2.5 text-xs font-medium text-muted-foreground/75 shadow-none hover:bg-transparent hover:text-muted-foreground/75 disabled:bg-transparent disabled:text-muted-foreground/50 [&_svg]:text-muted-foreground/60 hover:[&_svg]:text-muted-foreground/60'
const COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS = 'w-8 justify-center px-0'
const COMPOSER_ICON_ONLY_LABEL_CLASS = 'sr-only'

interface ChatComposerProps {
  topic: Topic
  onSend: (
    text: string,
    options?: {
      files?: FileMetadata[]
      mentionedModels?: UniqueModelId[]
      knowledgeBaseIds?: KnowledgeBase['id'][]
      userMessageParts?: CherryMessagePart[]
    }
  ) => void | Promise<void>
  sendDisabled?: boolean
  useMentionedModelSelector?: boolean
  onTemporaryAssistantChange?: (assistantId: string | null) => void | Promise<void>
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
}

type ProviderActionHandlers = ComposerSurfaceActions & {
  addNewTopic: (payload?: AddNewTopicPayload) => void
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

interface SavedComposerDraft {
  text: string
  draftTokens: ComposerSerializedToken[]
  files: FileMetadata[]
  selectedKnowledgeBases: KnowledgeBase[]
}

interface EditableMessageDraft {
  text: string
  draftTokens: ComposerSerializedToken[]
  files: FileMetadata[]
}

type EditableFileMetadata = FileMetadata & Pick<Extract<CherryMessagePart, { type: 'file' }>, 'providerMetadata'>

function getFileExtension(value: string | undefined, mediaType: string | undefined) {
  const source = value ?? ''
  const fileName = source.split(/[\\/]/).pop() ?? source
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop()}` : ''
  if (extension !== '.') return extension.toLowerCase()
  if (mediaType?.startsWith('image/')) return `.${mediaType.slice('image/'.length)}`
  return ''
}

function createEditableFileMetadata(
  part: Extract<CherryMessagePart, { type: 'file' }>,
  index: number
): EditableFileMetadata | null {
  const path = part.url
  if (!path) return null

  const name = part.filename || path.split(/[\\/]/).pop() || `attachment-${index + 1}`
  const ext = getFileExtension(name || path, part.mediaType)
  return {
    id: path,
    name,
    origin_name: name,
    path,
    size: 0,
    ext,
    type: part.mediaType?.startsWith('image/') ? FILE_TYPE.IMAGE : FILE_TYPE.DOCUMENT,
    created_at: new Date().toISOString(),
    count: 1,
    ...(part.providerMetadata && { providerMetadata: part.providerMetadata })
  }
}

function createEditableMessageDraft(parts: CherryMessagePart[]): EditableMessageDraft {
  const textParts = parts.filter((part): part is Extract<CherryMessagePart, { type: 'text' }> => part.type === 'text')
  const text = textParts.map((part) => part.text).join('\n\n')
  const composer = textParts.length === 1 ? readCherryMeta(textParts[0])?.composer : undefined
  const draftTokens =
    composer?.tokens.flatMap((token) =>
      isComposerDraftTokenKind(token.kind)
        ? [
            {
              ...token,
              kind: token.kind
            }
          ]
        : []
    ) ?? []
  const files = parts.flatMap((part, index) => {
    if (part.type !== 'file') return []
    const file = createEditableFileMetadata(part, index)
    return file ? [file] : []
  })

  return { text, draftTokens, files }
}

function getEditableKnowledgeBases(
  draftTokens: readonly ComposerSerializedToken[],
  selectableKnowledgeBases: readonly KnowledgeBase[]
) {
  const knowledgeTokenIds = getComposerTokenIds(draftTokens, 'knowledge')
  if (knowledgeTokenIds.size === 0) return []

  return selectableKnowledgeBases.filter((base) => knowledgeTokenIds.has(chatComposerTokenId.knowledge(base)))
}

const createQuoteToken = (selectedText: string, label: string): ComposerDraftToken => ({
  id: `quote:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  kind: 'quote',
  label,
  description: selectedText,
  promptText: formatQuoteTokenPromptText(selectedText)
})

interface ChatComposerContextControlsProps {
  assistantId: string | null
  assistantName: string
  assistantEmoji?: string
  model?: Model
  modelProviderName?: string
  modelPending?: boolean
  providers: Provider[]
  mentionedModels: Model[]
  mentionedModelSelectorValue: Model[]
  mentionedModelMultiSelectMode: boolean
  selectModelLabel: string
  useMentionedModelSelector?: boolean
  shouldAutoSelectCreatedAssistant: boolean
  side: 'top' | 'bottom'
  iconOnly?: boolean
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
  modelProviderName,
  modelPending,
  providers,
  mentionedModels,
  mentionedModelSelectorValue,
  mentionedModelMultiSelectMode,
  selectModelLabel,
  useMentionedModelSelector,
  shouldAutoSelectCreatedAssistant,
  side,
  iconOnly = false,
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
  const selectedMentionedModels = useMentionedModelSelector ? mentionedModelSelectorValue : mentionedModels
  const mentionedModelTriggerClassName = cn(
    triggerClassName,
    iconOnly && selectedMentionedModels.length > 0 && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS
  )
  const assistantModelLabel = model
    ? `${model.name}${modelProviderName ? ` | ${modelProviderName}` : ''}`
    : selectModelLabel
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
        trigger={
          <Button variant="ghost" size="sm" className={compactTriggerClassName}>
            {assistantIcon ? (
              <EmojiIcon emoji={assistantIcon} size={20} />
            ) : iconOnly ? (
              <Bot size={16} aria-hidden />
            ) : null}
            <span className={cn('max-w-40', labelClassName)}>{assistantName}</span>
          </Button>
        }
      />
      {useMentionedModelSelector ? (
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
            </Button>
          }
        />
      )}
    </>
  )
}

interface ChatComposerToolbarControlsProps extends Omit<ChatComposerContextControlsProps, 'side'> {
  inputAdapter?: QuickPanelInputAdapter
}

const ChatComposerToolMenuControls = ({ inputAdapter }: { inputAdapter?: QuickPanelInputAdapter }) => {
  return (
    <>
      <ComposerToolMenu inputAdapter={inputAdapter} />
      <ComposerActiveToolControls inputAdapter={inputAdapter} />
    </>
  )
}

const ChatComposerToolbarControls = ({ inputAdapter, ...contextProps }: ChatComposerToolbarControlsProps) => {
  const { iconOnly, toolbarRef } = useComposerBottomToolbarIconOnly()

  return (
    <div ref={toolbarRef} className={cn(COMPOSER_TOOLBAR_CLASS, 'w-full')}>
      <ChatComposerToolMenuControls inputAdapter={inputAdapter} />
      <ChatComposerContextControls {...contextProps} side="top" iconOnly={iconOnly} />
    </div>
  )
}

type ChatComposerControlProps = Omit<ChatComposerToolbarControlsProps, 'inputAdapter'>

const ChatComposerBelowControls = (contextProps: ChatComposerControlProps) => {
  const { iconOnly, toolbarRef } = useComposerBottomToolbarIconOnly()

  return (
    <div ref={toolbarRef} className={cn(COMPOSER_TOOLBAR_CLASS, 'w-full')}>
      <ChatComposerContextControls {...contextProps} side="bottom" useMentionedModelSelector iconOnly={iconOnly} />
    </div>
  )
}

type ComposerSurfaceProps = React.ComponentProps<typeof ComposerSurface>
type ChatComposerControlSlots = Pick<ComposerSurfaceProps, 'renderLeftControls' | 'renderBelowControls'>
type ChatComposerControlsRenderer = (props: ChatComposerControlProps) => ChatComposerControlSlots

const renderChatToolbarControls: ChatComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter) => <ChatComposerToolbarControls inputAdapter={inputAdapter} {...props} />
})

const renderChatHomeControls: ChatComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter) => (
    <div className={COMPOSER_TOOLBAR_CLASS}>
      <ChatComposerToolMenuControls inputAdapter={inputAdapter} />
    </div>
  ),
  renderBelowControls: () => <ChatComposerBelowControls {...props} />
})

type ChatComposerRootProps = ChatComposerProps & {
  renderControls: ChatComposerControlsRenderer
}

const ChatComposerRoot = ({
  topic,
  onSend,
  sendDisabled,
  useMentionedModelSelector,
  onTemporaryAssistantChange,
  onNewTopic,
  renderControls
}: ChatComposerRootProps) => {
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })
  const initialState = useMemo(
    () => ({
      files: [] as FileMetadata[],
      mentionedModels: [] as Model[],
      selectedKnowledgeBases: [] as KnowledgeBase[],
      isExpanded: false,
      couldAddImageFile: false,
      extensions: [] as string[]
    }),
    []
  )

  return (
    <MessageEditingProvider>
      <ComposerToolRuntimeProvider
        initialState={initialState}
        actions={{
          addNewTopic: () => actionsRef.current.addNewTopic(),
          onTextChange: (updater) => actionsRef.current.onTextChange(updater)
        }}>
        <ChatComposerInner
          topic={topic}
          actionsRef={actionsRef}
          onSend={onSend}
          sendDisabled={sendDisabled}
          useMentionedModelSelector={useMentionedModelSelector}
          onTemporaryAssistantChange={onTemporaryAssistantChange}
          onNewTopic={onNewTopic}
          renderControls={renderControls}
        />
      </ComposerToolRuntimeProvider>
    </MessageEditingProvider>
  )
}

interface ChatComposerInnerProps extends Omit<ChatComposerProps, 'setActiveTopic'> {
  actionsRef: React.MutableRefObject<ProviderActionHandlers>
  renderControls: ChatComposerControlsRenderer
}

const ChatComposerInner = ({
  topic,
  actionsRef,
  onSend,
  sendDisabled = false,
  useMentionedModelSelector,
  onTemporaryAssistantChange,
  onNewTopic,
  renderControls
}: ChatComposerInnerProps) => {
  const awaitingApproval = useTopicAwaitingApproval(topic.id)
  const scope = topic.type ?? TopicType.Chat
  const config = getComposerToolConfig(scope)
  const { files, mentionedModels, selectedKnowledgeBases, isExpanded } = useComposerToolState()
  const { setFiles, setMentionedModels, setSelectedKnowledgeBases, setIsExpanded } = useComposerToolDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherActions()
  const {
    assistant,
    isLoading: isAssistantLoading,
    model,
    isModelPending,
    isModelMissing,
    setModel
  } = useAssistant(topic.assistantId)
  const { assistant: defaultAssistant } = useDefaultAssistant()
  const { updateTopic } = useTopicMutations()
  const { setDefaultModel } = useDefaultModel()
  const { bases: allKnowledgeBases, isLoading: isKnowledgeBasesLoading } = useKnowledgeBases()
  const { providers } = useProviders()
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const [narrowMode] = usePreference('chat.narrow_mode')
  const [searching, setSearching] = useCache('chat.web_search.searching')
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')
  const { t } = useTranslation()
  const chatWrite = useChatWrite()
  const { editingMessage, cancelEditing, stopEditing } = useMessageEditing()
  const editingMessageForCurrentTopic = editingMessage?.message.topicId === topic.id ? editingMessage : null
  const staleEditingMessage = editingMessage && !editingMessageForCurrentTopic
  const { isPending } = useTopicStreamStatus(topic.id)
  const selectedKnowledgeBasesScopeKeyRef = useRef<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [text, setTextState] = useState(() => cacheService.getCasual<string>(INPUTBAR_DRAFT_CACHE_KEY) ?? '')
  const [draftTokens, setDraftTokens] = useState<ComposerSerializedToken[] | undefined>(undefined)
  const [mentionedModelMultiSelectMode, setMentionedModelMultiSelectMode] = useState(false)
  const [mentionedModelSelectorValue, setMentionedModelSelectorValue] = useState<Model[]>([])
  const mentionedModelSelectorInitKeyRef = useRef<string | null>(null)
  const mentionedModelMultiSelectModeRef = useRef(mentionedModelMultiSelectMode)
  const mentionedModelsRef = useRef(mentionedModels)
  const filesRef = useRef(files)
  const selectedKnowledgeBasesRef = useRef(selectedKnowledgeBases)
  const savedDraftBeforeEditingRef = useRef<SavedComposerDraft | null>(null)
  const selectAssistantMessage = t('button.select_assistant')
  const selectedAssistantId = topic.assistantId ?? null
  const isRuntimeAssistantSelected = isRuntimeDefaultAssistantId(selectedAssistantId)
  const displayAssistant =
    assistant ?? (isRuntimeAssistantSelected && !isAssistantLoading ? defaultAssistant : undefined)
  const hasMissingPersistedAssistant = !isRuntimeAssistantSelected && !isAssistantLoading && !assistant
  const runtimeModel = displayAssistant ? model : undefined
  const runtimeModelPending = isAssistantLoading || (!!displayAssistant && isModelPending)
  const selectedModelForMissingAssistantDefault =
    displayAssistant && !displayAssistant.modelId ? mentionedModelSelectorValue[0] : undefined
  const missingAssistantMessage = hasMissingPersistedAssistant ? selectAssistantMessage : undefined
  const missingModelMessage =
    displayAssistant && isModelMissing && !selectedModelForMissingAssistantDefault
      ? t('code.model_required')
      : undefined
  const missingSelectedModelMessage =
    useMentionedModelSelector && mentionedModelSelectorValue.length === 0 ? t('code.model_required') : undefined
  mentionedModelsRef.current = mentionedModels
  filesRef.current = files
  selectedKnowledgeBasesRef.current = selectedKnowledgeBases
  mentionedModelMultiSelectModeRef.current = mentionedModelMultiSelectMode

  useEffect(() => {
    if (isPending) setIsSending(false)
  }, [isPending])

  useEffect(() => {
    setIsSending(false)
  }, [topic.id])

  const loading = isPending || isSending || awaitingApproval
  const selectedKnowledgeBasesScopeKey = `${topic.id}:${selectedAssistantId ?? 'no-assistant'}`
  const assistantName = displayAssistant?.name ?? (isAssistantLoading ? t('common.loading') : selectAssistantMessage)
  const assistantEmoji =
    displayAssistant?.emoji ?? (isRuntimeAssistantSelected ? RUNTIME_DEFAULT_ASSISTANT_EMOJI : undefined)
  const providerName = useProviderDisplayName(runtimeModel?.providerId)

  const isVisionAssistant = useMemo(() => (runtimeModel ? isVisionModel(runtimeModel) : false), [runtimeModel])
  const isGenerateImageAssistant = useMemo(
    () => (runtimeModel ? isGenerateImageModel(runtimeModel) : false),
    [runtimeModel]
  )

  const isVisionSupported = useMemo(
    () =>
      (mentionedModels.length > 0 && isVisionModels(mentionedModels)) ||
      (mentionedModels.length === 0 && isVisionAssistant),
    [mentionedModels, isVisionAssistant]
  )

  const isGenerateImageSupported = useMemo(
    () =>
      (mentionedModels.length > 0 && isGenerateImageModels(mentionedModels)) ||
      (mentionedModels.length === 0 && isGenerateImageAssistant),
    [mentionedModels, isGenerateImageAssistant]
  )

  const canAddImageFile = useMemo(
    () => isVisionSupported || isGenerateImageSupported,
    [isGenerateImageSupported, isVisionSupported]
  )

  const canAddTextFile = useMemo(
    () => isVisionSupported || (!isVisionSupported && !isGenerateImageSupported),
    [isGenerateImageSupported, isVisionSupported]
  )

  const supportedExts = useMemo(() => {
    if (canAddImageFile && canAddTextFile) return [...imageExts, ...documentExts, ...textExts]
    if (canAddImageFile) return [...imageExts]
    if (canAddTextFile) return [...documentExts, ...textExts]
    return []
  }, [canAddImageFile, canAddTextFile])

  const configuredKnowledgeBaseIdsKey = (assistant?.knowledgeBaseIds ?? []).join(KNOWLEDGE_BASE_IDS_KEY_SEPARATOR)
  const configuredKnowledgeBaseIdSet = useMemo(
    () =>
      new Set(
        configuredKnowledgeBaseIdsKey ? configuredKnowledgeBaseIdsKey.split(KNOWLEDGE_BASE_IDS_KEY_SEPARATOR) : []
      ),
    [configuredKnowledgeBaseIdsKey]
  )
  const availableKnowledgeBaseIdsKey = useMemo(
    () => allKnowledgeBases.map((base) => base.id).join(KNOWLEDGE_BASE_IDS_KEY_SEPARATOR),
    [allKnowledgeBases]
  )
  const availableKnowledgeBaseIdSet = useMemo(
    () =>
      new Set(availableKnowledgeBaseIdsKey ? availableKnowledgeBaseIdsKey.split(KNOWLEDGE_BASE_IDS_KEY_SEPARATOR) : []),
    [availableKnowledgeBaseIdsKey]
  )
  const filterSelectableKnowledgeBases = useCallback(
    (bases: readonly KnowledgeBase[]) => {
      if (configuredKnowledgeBaseIdSet.size === 0) return []
      return bases.filter(
        (base) =>
          configuredKnowledgeBaseIdSet.has(base.id) &&
          (isKnowledgeBasesLoading || availableKnowledgeBaseIdSet.has(base.id))
      )
    },
    [availableKnowledgeBaseIdSet, configuredKnowledgeBaseIdSet, isKnowledgeBasesLoading]
  )
  const selectableKnowledgeBases = useMemo(
    () => filterSelectableKnowledgeBases(allKnowledgeBases),
    [allKnowledgeBases, filterSelectableKnowledgeBases]
  )
  const knowledgeBaseMarkerMap = useMemo(() => {
    const map = new Map<string, KnowledgeBase>()
    selectableKnowledgeBases.forEach((base) => {
      map.set(base.id, base)
      map.set(base.name, base)
      map.set(chatComposerTokenId.knowledge(base), base)
    })
    return map
  }, [selectableKnowledgeBases])
  const resolveKnowledgeBaseMarker = useCallback(
    (marker: string): ComposerDraftToken | null => {
      const base = knowledgeBaseMarkerMap.get(marker)
      return base ? knowledgeBaseToComposerToken(base) : null
    },
    [knowledgeBaseMarkerMap]
  )
  const isSelectedKnowledgeBasesScopeCurrent =
    selectedKnowledgeBasesScopeKeyRef.current === selectedKnowledgeBasesScopeKey
  const selectedKnowledgeBasesInScope = useMemo(
    () => (isSelectedKnowledgeBasesScopeCurrent ? filterSelectableKnowledgeBases(selectedKnowledgeBases) : []),
    [filterSelectableKnowledgeBases, isSelectedKnowledgeBasesScopeCurrent, selectedKnowledgeBases]
  )

  const setText = useCallback(
    (nextText: string) => {
      setTextState(nextText)
      if (!editingMessageForCurrentTopic) {
        cacheService.setCasual(INPUTBAR_DRAFT_CACHE_KEY, nextText, DRAFT_CACHE_TTL)
      }
    },
    [editingMessageForCurrentTopic]
  )

  const restoreSavedDraft = useCallback(() => {
    const savedDraft = savedDraftBeforeEditingRef.current
    savedDraftBeforeEditingRef.current = null

    if (!savedDraft) return

    setTextState(savedDraft.text)
    cacheService.setCasual(INPUTBAR_DRAFT_CACHE_KEY, savedDraft.text, DRAFT_CACHE_TTL)
    setDraftTokens(savedDraft.draftTokens)
    setFiles(savedDraft.files)
    setSelectedKnowledgeBases(savedDraft.selectedKnowledgeBases)
  }, [setFiles, setSelectedKnowledgeBases])

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
    setTextState(editableDraft.text)
    setDraftTokens(editableDraft.draftTokens)
    setFiles(editableDraft.files)
    setSelectedKnowledgeBases(getEditableKnowledgeBases(editableDraft.draftTokens, selectableKnowledgeBases))
  })

  useEffect(() => {
    if (!editingMessageForCurrentTopic) return
    if (savedDraftBeforeEditingRef.current?.text === undefined) {
      const currentDraft = actionsRef.current.getDraft()
      savedDraftBeforeEditingRef.current = {
        text: currentDraft.text,
        draftTokens: currentDraft.tokens,
        files: filesRef.current,
        selectedKnowledgeBases: selectedKnowledgeBasesRef.current
      }
    }

    restoreEditableMessageDraft(editingMessageForCurrentTopic)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` reads the current selectable knowledge bases without resetting the edit draft when they refresh.
  }, [actionsRef, editingMessageForCurrentTopic])

  useEffect(() => {
    if (!staleEditingMessage) return
    restoreSavedDraft()
    stopEditing()
  }, [restoreSavedDraft, staleEditingMessage, stopEditing])

  const initializeMentionedModelSelector = useEffectEvent((isInitialSelection: boolean, selectedModel?: Model) => {
    const currentMentionedModels = mentionedModelsRef.current
    setMentionedModelSelectorValue(
      isInitialSelection && currentMentionedModels.length > 1
        ? currentMentionedModels
        : selectedModel
          ? [selectedModel]
          : []
    )
    setMentionedModelMultiSelectMode(false)

    if (!isInitialSelection && currentMentionedModels.length > 0) {
      setMentionedModels([])
    }
  })

  useEffect(() => {
    if (!useMentionedModelSelector) {
      mentionedModelSelectorInitKeyRef.current = null
      setMentionedModelSelectorValue([])
      setMentionedModelMultiSelectMode(false)
      return
    }

    if (!runtimeModel && runtimeModelPending) {
      return
    }

    const initializationKey = `${topic.id}:${selectedAssistantId ?? 'no-assistant'}:${runtimeModel?.id ?? 'no-model'}`
    if (mentionedModelSelectorInitKeyRef.current === initializationKey) return

    const isInitialSelection = mentionedModelSelectorInitKeyRef.current === null
    mentionedModelSelectorInitKeyRef.current = initializationKey
    initializeMentionedModelSelector(isInitialSelection, runtimeModel)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` must not participate in the dependency key here.
  }, [runtimeModel, runtimeModelPending, selectedAssistantId, topic.id, useMentionedModelSelector])

  const placeholderText = t('chat.input.placeholder', { key: getSendMessageShortcutLabel(sendMessageShortcut) })

  const tokens = useMemo(
    () => [...files.map(fileToComposerToken), ...selectedKnowledgeBasesInScope.map(knowledgeBaseToComposerToken)],
    [files, selectedKnowledgeBasesInScope]
  )

  const handleTokensChange = useCallback(
    (draftTokens: readonly ComposerSerializedToken[]) => {
      const tokenIds = getComposerTokenIds(draftTokens)
      const knowledgeTokenIds = getComposerTokenIds(draftTokens, 'knowledge')
      setFiles((prev) => {
        const next = prev.filter((file) => tokenIds.has(chatComposerTokenId.file(file)))
        return next.length === prev.length ? prev : next
      })
      setSelectedKnowledgeBases((prev) => {
        const next = prev.filter((base) => knowledgeTokenIds.has(chatComposerTokenId.knowledge(base)))
        const nextIds = new Set(next.map(chatComposerTokenId.knowledge))
        let changed = next.length !== prev.length

        for (const base of selectableKnowledgeBases) {
          const tokenId = chatComposerTokenId.knowledge(base)
          if (!knowledgeTokenIds.has(tokenId) || nextIds.has(tokenId)) continue
          next.push(base)
          nextIds.add(tokenId)
          changed = true
        }

        return changed ? next : prev
      })
    },
    [selectableKnowledgeBases, setFiles, setSelectedKnowledgeBases]
  )

  useEffect(() => {
    setFiles((prev) => {
      const seenIds = new Set<string>()
      const next: typeof prev = []
      let changed = false

      for (const file of prev) {
        const id = chatComposerTokenId.file(file)
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

  const onPause = useCallback(() => {
    chatWrite?.pause()
  }, [chatWrite])

  const handleAssistantChange = useCallback(
    async (nextId: string | null) => {
      if (nextId === selectedAssistantId) return
      if (onTemporaryAssistantChange) {
        await onTemporaryAssistantChange(nextId)
        return
      }
      await updateTopic(topic.id, { assistantId: nextId })
    },
    [onTemporaryAssistantChange, selectedAssistantId, topic.id, updateTopic]
  )

  const handleModelSelect = useCallback(
    (nextModel: Model | undefined) => {
      if (!nextModel) return
      if (isRuntimeAssistantSelected) {
        return setDefaultModel(nextModel)
      }

      if (!assistant) return
      const enabledWebSearch = canModelUseAssistantWebSearch(nextModel)
      return setModel(nextModel, { enableWebSearch: enabledWebSearch && assistant.settings.enableWebSearch })
    },
    [assistant, isRuntimeAssistantSelected, setDefaultModel, setModel]
  )
  const handleMentionedModelsSelect = useCallback(
    (nextModels: Model[]) => {
      setMentionedModelSelectorValue(nextModels)
      if (mentionedModelMultiSelectModeRef.current) {
        setMentionedModels(nextModels)
        return
      }

      setMentionedModels([])
      const [nextModel] = nextModels
      if (nextModel) void handleModelSelect(nextModel)
    },
    [handleModelSelect, setMentionedModels]
  )

  const handleMentionedModelMultiSelectModeChange = useCallback(
    (nextEnabled: boolean) => {
      mentionedModelMultiSelectModeRef.current = nextEnabled
      setMentionedModelMultiSelectMode(nextEnabled)

      if (nextEnabled) {
        return
      }

      setMentionedModelSelectorValue((currentModels) => currentModels.slice(0, 1))
      setMentionedModels([])
    },
    [setMentionedModels]
  )

  const handleMentionedModelSelectorRestore = useCallback(() => {
    mentionedModelMultiSelectModeRef.current = false
    setMentionedModelMultiSelectMode(false)
    setMentionedModelSelectorValue(runtimeModel ? [runtimeModel] : [])
    setMentionedModels([])
  }, [runtimeModel, setMentionedModels])

  const addNewTopic = useCallback(
    (payload?: AddNewTopicPayload) => {
      void onNewTopic?.(payload)
    },
    [onNewTopic]
  )

  const handleQuote = useCallback(
    (selectedText: string) => {
      if (!selectedText) return

      actionsRef.current.insertToken(createQuoteToken(selectedText, t('selection.action.builtin.quote')))
      actionsRef.current.toggleExpanded(isExpanded)
    },
    [actionsRef, isExpanded, t]
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
      if (topicId !== topic.id) return
      actionsRef.current.focus()
    })
  }, [actionsRef, topic.id])

  useEffect(() => {
    Object.assign(actionsRef.current, { addNewTopic })
  }, [actionsRef, addNewTopic])

  useEffect(() => {
    return window.electron?.ipcRenderer.on(IpcChannel.App_QuoteToMain, (_, selectedText: string) => {
      handleQuote(selectedText)
    })
  }, [handleQuote])

  const isActiveTab = useIsActiveTab()
  useCommandHandler(
    'topic.create',
    () => {
      addNewTopic()
    },
    { enabled: isActiveTab }
  )

  useEffect(() => {
    const scopeChanged = selectedKnowledgeBasesScopeKeyRef.current !== selectedKnowledgeBasesScopeKey
    selectedKnowledgeBasesScopeKeyRef.current = selectedKnowledgeBasesScopeKey
    setSelectedKnowledgeBases((prev) => {
      const next = scopeChanged ? [] : filterSelectableKnowledgeBases(prev)
      if (next.length === prev.length && next.every((base, index) => base.id === prev[index]?.id)) return prev
      return next
    })
  }, [filterSelectableKnowledgeBases, selectedKnowledgeBasesScopeKey, setSelectedKnowledgeBases])

  const buildQueuedPayload = useCallback(
    (draft: ComposerSerializedDraft): ComposerQueuedMessagePayload | null => {
      const nextText = draft.text.trim()
      if (!nextText) return null
      const tokenIds = getComposerTokenIds(draft.tokens)
      const payloadFiles = files.filter((file) => tokenIds.has(chatComposerTokenId.file(file)))
      const payloadKnowledgeBases = selectedKnowledgeBasesInScope.filter((base) =>
        tokenIds.has(chatComposerTokenId.knowledge(base))
      )
      const userMessageParts = createComposerUserMessageParts(draft, { files: payloadFiles })

      const knowledgeBaseIds = payloadKnowledgeBases.map((base) => base.id)

      return {
        text: nextText,
        files: payloadFiles.length ? (payloadFiles as unknown as Array<Record<string, unknown>>) : undefined,
        mentionedModels: mentionedModels.length ? mentionedModels.map((currentModel) => currentModel.id) : undefined,
        knowledgeBaseIds: knowledgeBaseIds?.length ? knowledgeBaseIds : undefined,
        userMessageParts
      }
    },
    [files, mentionedModels, selectedKnowledgeBasesInScope]
  )

  const sendQueuedPayload = useCallback(
    async (payload: ComposerQueuedMessagePayload) => {
      setIsSending(true)

      try {
        await onSend(payload.text, {
          files: payload.files as FileMetadata[] | undefined,
          mentionedModels: payload.mentionedModels,
          knowledgeBaseIds: payload.knowledgeBaseIds,
          userMessageParts: payload.userMessageParts
        })
        return true
      } catch (error) {
        logger.warn('send failed', { error })
        return false
      } finally {
        setIsSending(false)
      }
    },
    [onSend]
  )

  const clearCurrentDraft = useCallback(() => {
    setText('')
    setDraftTokens(undefined)
    setFiles([])
    setSelectedKnowledgeBases([])
  }, [setFiles, setSelectedKnowledgeBases, setText])

  const buildEditedMessageParts = useCallback(
    (draft: ComposerSerializedDraft) => {
      const tokenIds = getComposerTokenIds(draft.tokens)
      const payloadFiles = files.filter((file) => tokenIds.has(chatComposerTokenId.file(file)))
      const originalFilePartsByTokenId = new Map<string, Extract<CherryMessagePart, { type: 'file' }>>()

      editingMessageForCurrentTopic?.parts.forEach((part, index) => {
        if (part.type !== 'file') return
        const file = createEditableFileMetadata(part, index)
        if (file) originalFilePartsByTokenId.set(chatComposerTokenId.file(file), part)
      })

      const newFiles = payloadFiles.filter((file) => !originalFilePartsByTokenId.has(chatComposerTokenId.file(file)))
      const rebuiltParts = createComposerUserMessageParts(draft, { files: newFiles })
      const textPart = rebuiltParts[0]
      const rebuiltFileParts = new Map<string, CherryMessagePart>()

      rebuiltParts.slice(1).forEach((part, index) => {
        const file = newFiles[index]
        if (file) rebuiltFileParts.set(chatComposerTokenId.file(file), part)
      })

      return [
        textPart,
        ...payloadFiles.flatMap((file) => {
          const tokenId = chatComposerTokenId.file(file)
          const filePart = originalFilePartsByTokenId.get(tokenId) ?? rebuiltFileParts.get(tokenId)
          return filePart ? [filePart] : []
        })
      ]
    },
    [editingMessageForCurrentTopic?.parts, files]
  )

  const handleSendDraft = useCallback(
    async (draft: ComposerSerializedDraft) => {
      if (staleEditingMessage) {
        restoreSavedDraft()
        stopEditing()
        return
      }

      if (editingMessageForCurrentTopic) {
        if (!chatWrite?.forkAndResend) {
          window.toast?.error(t('message.error.operation_unavailable'))
          return
        }

        const editedParts = buildEditedMessageParts(draft)
        try {
          await chatWrite.forkAndResend(editingMessageForCurrentTopic.message.id, editedParts)
          restoreSavedDraft()
          stopEditing()
        } catch (error) {
          logger.warn('edited message fork and resend failed', { error })
          window.toast?.error(t('message.error.operation_unavailable'))
        }
        return
      }

      if (missingAssistantMessage) {
        window.toast?.error(selectAssistantMessage)
        return
      }

      if (!runtimeModel && !selectedModelForMissingAssistantDefault) {
        window.toast?.error(t('code.model_required'))
        return
      }

      if (missingSelectedModelMessage) {
        window.toast?.error(missingSelectedModelMessage)
        return
      }

      if (sendDisabled) return
      if (runtimeModelPending) return
      // The send queue was removed; while a turn is streaming we no longer buffer
      // messages, so block sending until it finishes instead of dispatching concurrently.
      if (loading) return

      const payload = buildQueuedPayload(draft)
      if (!payload) return

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
        window.toast?.error(t('chat.input.send_failed'))
      }
    },
    [
      buildQueuedPayload,
      buildEditedMessageParts,
      chatWrite,
      clearCurrentDraft,
      editingMessageForCurrentTopic,
      files,
      handleModelSelect,
      loading,
      missingAssistantMessage,
      missingSelectedModelMessage,
      runtimeModel,
      runtimeModelPending,
      selectedKnowledgeBases,
      selectedModelForMissingAssistantDefault,
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

  if (isMultiSelectMode) return null

  const controlSlots = renderControls({
    assistantId: selectedAssistantId,
    assistantName,
    assistantEmoji,
    model: runtimeModel,
    modelProviderName: providerName,
    modelPending: runtimeModelPending,
    providers,
    mentionedModels,
    mentionedModelSelectorValue,
    mentionedModelMultiSelectMode,
    useMentionedModelSelector,
    shouldAutoSelectCreatedAssistant: Boolean(onTemporaryAssistantChange),
    selectModelLabel: runtimeModelPending ? t('common.loading') : t('button.select_model'),
    onAssistantChange: handleAssistantChange,
    onModelSelect: handleModelSelect,
    onMentionedModelsSelect: handleMentionedModelsSelect,
    onMentionedModelMultiSelectModeChange: handleMentionedModelMultiSelectModeChange,
    onMentionedModelSelectorRestore: handleMentionedModelSelectorRestore
  })

  return (
    <ComposerToolDerivedStateProvider couldAddImageFile={canAddImageFile} extensions={supportedExts}>
      {displayAssistant && runtimeModel && (
        <ComposerToolRuntimeHost scope={scope} assistant={displayAssistant} model={runtimeModel} />
      )}
      <ComposerSurface
        text={text}
        onTextChange={setText}
        tokens={tokens}
        draftTokens={draftTokens}
        managedTokenKinds={CHAT_MANAGED_TOKEN_KINDS}
        onTokensChange={handleTokensChange}
        resolveKnowledgeBaseMarker={resolveKnowledgeBaseMarker}
        placeholder={searching ? t('chat.input.translating') : placeholderText}
        sendDisabled={
          text.trim().length === 0 ||
          loading ||
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
                onLocate: handleLocateEditingMessage,
                onCancel: handleCancelEditing
              }
            : undefined
        }
        onPause={onPause}
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
        narrowMode={narrowMode}
        onFocus={() => setSearching(false)}
        onActionsChange={handleSurfaceActionsChange}
        getToolLaunchers={() => getLaunchers()}
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
        {...controlSlots}
      />
    </ComposerToolDerivedStateProvider>
  )
}

const ChatComposer = (props: ChatComposerProps) => {
  return <ChatComposerRoot {...props} renderControls={renderChatToolbarControls} />
}

export const ChatHomeComposer = (props: ChatComposerProps) => {
  return <ChatComposerRoot {...props} useMentionedModelSelector renderControls={renderChatHomeControls} />
}

export const ChatPlacementComposer = ({
  isHome,
  onTemporaryAssistantChange,
  ...props
}: ChatComposerProps & { isHome: boolean }) => {
  return (
    <ChatComposerRoot
      {...props}
      onTemporaryAssistantChange={isHome ? onTemporaryAssistantChange : undefined}
      useMentionedModelSelector
      renderControls={isHome ? renderChatHomeControls : renderChatToolbarControls}
    />
  )
}

export default ChatComposer
