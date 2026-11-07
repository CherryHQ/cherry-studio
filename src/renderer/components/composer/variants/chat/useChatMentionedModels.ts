import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'

import type { Model } from '@shared/data/types/model'

interface UseMentionedModelSelectorParams {
  /** Whether the mentioned-model selector UI is in use (chat home / placement). */
  enabled: boolean | undefined
  runtimeModel: Model | undefined
  runtimeModelPending: boolean
  /** Model last used in this topic; seeds the selector when the topic is opened. */
  topicLastModel?: Model
  topicLastModelPending?: boolean
  selectedAssistantId: string | null
  topicId: string
  mentionedModels: Model[]
  setMentionedModels: (models: Model[]) => void
  preserveExplicitSelectionOnRuntimeChange?: boolean
  /** Applies a single model to the assistant (the composer's `handleModelSelect`). */
  onModelSelect: (model: Model | undefined) => void
}

interface UseMentionedModelSelectorResult {
  mentionedModelSelectorValue: Model[]
  mentionedModelMultiSelectMode: boolean
  handleMentionedModelsSelect: (models: Model[]) => void
  handleMentionedModelMultiSelectModeChange: (enabled: boolean) => void
  handleMentionedModelSelectorRestore: () => void
  restoreMentionedModelDraft: (models: Model[], multiSelectMode: boolean) => void
  restoreMentionedModelSelection: (selectorModels: Model[], mentionedModels: Model[], multiSelectMode: boolean) => void
}

/**
 * Owns the chat composer's mentioned-model multi-select machinery: the selector value,
 * the multi-select toggle, and the (re)initialization that syncs it to the active
 * topic/assistant/model. Extracted verbatim from ChatComposer — chat-only.
 */
export function useChatMentionedModels({
  enabled,
  runtimeModel,
  runtimeModelPending,
  topicLastModel,
  topicLastModelPending = false,
  selectedAssistantId,
  topicId,
  mentionedModels,
  setMentionedModels,
  preserveExplicitSelectionOnRuntimeChange,
  onModelSelect
}: UseMentionedModelSelectorParams): UseMentionedModelSelectorResult {
  const [mentionedModelMultiSelectMode, setMentionedModelMultiSelectMode] = useState(false)
  const [mentionedModelSelectorValue, setMentionedModelSelectorValue] = useState<Model[]>([])
  const mentionedModelSelectorInitKeyRef = useRef<string | null>(null)
  const mentionedModelMultiSelectModeRef = useRef(mentionedModelMultiSelectMode)
  const mentionedModelSelectorValueRef = useRef(mentionedModelSelectorValue)
  const mentionedModelsRef = useRef(mentionedModels)
  const explicitSelectionScopeRef = useRef<string | null>(null)
  const selectorScopeKeyRef = useRef<string | null>(null)
  mentionedModelMultiSelectModeRef.current = mentionedModelMultiSelectMode
  mentionedModelSelectorValueRef.current = mentionedModelSelectorValue
  mentionedModelsRef.current = mentionedModels

  const initializeMentionedModelSelector = useEffectEvent(
    (
      isInitialSelection: boolean,
      preserveExplicitSelection: boolean,
      selectedModel?: Model,
      ownsPendingSelection = false
    ) => {
      // A pending-history edit owns the whole selector, including mode and an empty value.
      if (ownsPendingSelection) return
      const currentMentionedModels = mentionedModelsRef.current
      const keepCurrentSelection = preserveExplicitSelection && currentMentionedModels.length > 0
      setMentionedModelSelectorValue(
        keepCurrentSelection || (isInitialSelection && currentMentionedModels.length > 1)
          ? currentMentionedModels
          : selectedModel
            ? [selectedModel]
            : []
      )
      setMentionedModelMultiSelectMode(false)

      if (!isInitialSelection && currentMentionedModels.length > 0 && !keepCurrentSelection) {
        setMentionedModels([])
      }
    }
  )

  useEffect(() => {
    if (!enabled) {
      mentionedModelSelectorInitKeyRef.current = null
      selectorScopeKeyRef.current = null
      setMentionedModelSelectorValue((currentModels) => (currentModels.length === 0 ? currentModels : []))
      setMentionedModelMultiSelectMode((currentEnabled) => (currentEnabled ? false : currentEnabled))
      return
    }

    if (!runtimeModel && runtimeModelPending) {
      return
    }

    const selectorScopeKey = `${topicId}:${selectedAssistantId ?? 'no-assistant'}`
    const isNewSelectorScope = selectorScopeKeyRef.current !== selectorScopeKey
    if (isNewSelectorScope && topicLastModelPending) return
    const seedModel = isNewSelectorScope ? (topicLastModel ?? runtimeModel) : runtimeModel
    const initializationKey = `${selectorScopeKey}:${runtimeModel?.id ?? 'no-model'}`
    if (mentionedModelSelectorInitKeyRef.current === initializationKey) return

    const isInitialSelection = mentionedModelSelectorInitKeyRef.current === null
    const isSameSelectorScope = selectorScopeKeyRef.current === selectorScopeKey
    mentionedModelSelectorInitKeyRef.current = initializationKey
    selectorScopeKeyRef.current = selectorScopeKey
    initializeMentionedModelSelector(
      isInitialSelection,
      Boolean(
        (preserveExplicitSelectionOnRuntimeChange && isSameSelectorScope) ||
        (isNewSelectorScope && explicitSelectionScopeRef.current === selectorScopeKey)
      ),
      seedModel,
      isNewSelectorScope && explicitSelectionScopeRef.current === selectorScopeKey
    )
  }, [
    runtimeModel,
    runtimeModelPending,
    topicLastModel,
    topicLastModelPending,
    selectedAssistantId,
    topicId,
    enabled,
    preserveExplicitSelectionOnRuntimeChange
  ])

  const handleMentionedModelsSelect = useCallback(
    (nextModels: Model[]) => {
      explicitSelectionScopeRef.current = `${topicId}:${selectedAssistantId ?? 'no-assistant'}`
      setMentionedModelSelectorValue(nextModels)
      if (mentionedModelMultiSelectModeRef.current) {
        setMentionedModels(nextModels)
        return
      }

      setMentionedModels(nextModels)
      const [nextModel] = nextModels
      if (nextModel) onModelSelect(nextModel)
    },
    [onModelSelect, setMentionedModels, topicId, selectedAssistantId]
  )

  const handleMentionedModelMultiSelectModeChange = useCallback(
    (nextEnabled: boolean) => {
      explicitSelectionScopeRef.current = `${topicId}:${selectedAssistantId ?? 'no-assistant'}`
      mentionedModelMultiSelectModeRef.current = nextEnabled
      setMentionedModelMultiSelectMode(nextEnabled)

      if (nextEnabled) {
        return
      }

      const collapsedModels = mentionedModelSelectorValueRef.current.slice(0, 1)
      setMentionedModelSelectorValue(collapsedModels)
      setMentionedModels(collapsedModels)
    },
    [setMentionedModels, topicId, selectedAssistantId]
  )

  const handleMentionedModelSelectorRestore = useCallback(() => {
    mentionedModelMultiSelectModeRef.current = false
    setMentionedModelMultiSelectMode(false)
    setMentionedModelSelectorValue(runtimeModel ? [runtimeModel] : [])
    setMentionedModels([])
  }, [runtimeModel, setMentionedModels])

  const restoreMentionedModelSelection = useCallback(
    (selectorModels: Model[], restoredMentionedModels: Model[], multiSelectMode: boolean) => {
      mentionedModelsRef.current = restoredMentionedModels
      mentionedModelSelectorValueRef.current = selectorModels
      mentionedModelMultiSelectModeRef.current = multiSelectMode
      setMentionedModels(restoredMentionedModels)
      setMentionedModelSelectorValue(selectorModels)
      setMentionedModelMultiSelectMode(multiSelectMode)
    },
    [setMentionedModels]
  )

  const restoreMentionedModelDraft = useCallback(
    (models: Model[], multiSelectMode: boolean) => {
      explicitSelectionScopeRef.current = `${topicId}:${selectedAssistantId ?? 'no-assistant'}`
      restoreMentionedModelSelection(models, models, multiSelectMode)
    },
    [restoreMentionedModelSelection, topicId, selectedAssistantId]
  )

  return {
    mentionedModelSelectorValue,
    mentionedModelMultiSelectMode,
    handleMentionedModelsSelect,
    handleMentionedModelMultiSelectModeChange,
    handleMentionedModelSelectorRestore,
    restoreMentionedModelDraft,
    restoreMentionedModelSelection
  }
}
