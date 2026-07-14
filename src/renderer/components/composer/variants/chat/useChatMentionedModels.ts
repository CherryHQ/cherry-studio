import type { Model } from '@shared/data/types/model'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'

interface UseMentionedModelSelectorParams {
  /** Whether the mentioned-model selector UI is in use (chat home / placement). */
  enabled: boolean | undefined
  runtimeModel: Model | undefined
  runtimeModelPending: boolean
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
  const selectorScopeKeyRef = useRef<string | null>(null)
  mentionedModelMultiSelectModeRef.current = mentionedModelMultiSelectMode
  mentionedModelSelectorValueRef.current = mentionedModelSelectorValue
  mentionedModelsRef.current = mentionedModels

  const initializeMentionedModelSelector = useEffectEvent(
    (isInitialSelection: boolean, preserveExplicitSelection: boolean, selectedModel?: Model) => {
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
    const initializationKey = `${selectorScopeKey}:${runtimeModel?.id ?? 'no-model'}`
    if (mentionedModelSelectorInitKeyRef.current === initializationKey) return

    const isInitialSelection = mentionedModelSelectorInitKeyRef.current === null
    const isSameSelectorScope = selectorScopeKeyRef.current === selectorScopeKey
    mentionedModelSelectorInitKeyRef.current = initializationKey
    selectorScopeKeyRef.current = selectorScopeKey
    initializeMentionedModelSelector(
      isInitialSelection,
      Boolean(preserveExplicitSelectionOnRuntimeChange && isSameSelectorScope),
      runtimeModel
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` reads latest mentioned models; this effect is keyed by topic/assistant/model.
  }, [
    runtimeModel,
    runtimeModelPending,
    selectedAssistantId,
    topicId,
    enabled,
    preserveExplicitSelectionOnRuntimeChange
  ])

  const handleMentionedModelsSelect = useCallback(
    (nextModels: Model[]) => {
      setMentionedModelSelectorValue(nextModels)
      if (mentionedModelMultiSelectModeRef.current) {
        setMentionedModels(nextModels)
        return
      }

      setMentionedModels(nextModels)
      const [nextModel] = nextModels
      if (nextModel) onModelSelect(nextModel)
    },
    [onModelSelect, setMentionedModels]
  )

  const handleMentionedModelMultiSelectModeChange = useCallback(
    (nextEnabled: boolean) => {
      mentionedModelMultiSelectModeRef.current = nextEnabled
      setMentionedModelMultiSelectMode(nextEnabled)

      if (nextEnabled) {
        return
      }

      const collapsedModels = mentionedModelSelectorValueRef.current.slice(0, 1)
      setMentionedModelSelectorValue(collapsedModels)
      setMentionedModels(collapsedModels)
    },
    [setMentionedModels]
  )

  const handleMentionedModelSelectorRestore = useCallback(() => {
    mentionedModelMultiSelectModeRef.current = false
    setMentionedModelMultiSelectMode(false)
    setMentionedModelSelectorValue(runtimeModel ? [runtimeModel] : [])
    setMentionedModels([])
  }, [runtimeModel, setMentionedModels])

  return {
    mentionedModelSelectorValue,
    mentionedModelMultiSelectMode,
    handleMentionedModelsSelect,
    handleMentionedModelMultiSelectModeChange,
    handleMentionedModelSelectorRestore
  }
}
