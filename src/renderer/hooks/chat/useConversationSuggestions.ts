import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useModelById } from '@renderer/hooks/useModel'
import { generateConversationSuggestions } from '@renderer/utils/aiGeneration'
import {
  type ConversationSuggestionPersona,
  type ConversationSuggestions
} from '@renderer/utils/conversationSuggestions'
import type { UniqueModelId } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'
import useSWRImmutable from 'swr/immutable'

const logger = loggerService.withContext('useConversationSuggestions')

interface UseConversationSuggestionsOptions {
  focus: string
  conversationId: string
  outputLanguage: string
  fallback: ConversationSuggestions
  persona?: ConversationSuggestionPersona
  enabled?: boolean
}

export function useConversationSuggestions({
  focus,
  conversationId,
  outputLanguage,
  fallback,
  persona,
  enabled = true
}: UseConversationSuggestionsOptions) {
  const [suggestionsEnabled] = usePreference('chat.suggestions.enabled')
  const [suggestionsModelId] = usePreference('chat.suggestions.model_id')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const active = suggestionsEnabled && enabled
  // Inactive lookups use undefined so useModelById stays mounted (hook order)
  // without an id. null is reserved for an active unset dedicated/default id.
  const dedicatedId = active ? ((suggestionsModelId as UniqueModelId | null) ?? null) : undefined
  const { model: dedicatedModel, isLoading: dedicatedLoading } = useModelById(dedicatedId)
  const dedicatedUsable = Boolean(active && dedicatedModel && !isNonChatModel(dedicatedModel))
  const fallbackId =
    active && (!dedicatedId || (!dedicatedLoading && !dedicatedUsable))
      ? ((defaultModelId as UniqueModelId | null) ?? null)
      : undefined
  const { model: defaultModel, isLoading: defaultLoading } = useModelById(fallbackId)
  const defaultUsable = Boolean(active && defaultModel && !isNonChatModel(defaultModel))
  const generationModel = dedicatedUsable ? dedicatedModel : defaultUsable ? defaultModel : undefined
  const modelPending = Boolean(dedicatedId && dedicatedLoading) || Boolean(fallbackId && defaultLoading)
  const key =
    active && !modelPending && generationModel
      ? [
          'conversation-suggestions',
          focus,
          conversationId,
          outputLanguage,
          generationModel.id,
          persona?.name ?? '',
          persona?.description ?? ''
        ]
      : null
  const fetchSuggestions = generationModel
    ? async () => {
        const systemLocale = navigator.language
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const now = new Date()

        return generateConversationSuggestions(
          {
            focus,
            outputLanguage,
            systemLocale,
            localDateTime: now.toLocaleString(systemLocale, {
              dateStyle: 'full',
              timeStyle: 'short',
              timeZone
            }),
            timeZone,
            randomSeed: `${now.getTime()}-${Math.random().toString(36).slice(2)}`,
            persona
          },
          generationModel
        )
      }
    : null
  const { data, isLoading } = useSWRImmutable(key, fetchSuggestions, {
    onError: (error) => logger.warn('Failed to generate conversation suggestions', { focus, conversationId, error }),
    shouldRetryOnError: false
  })

  return {
    suggestions: active ? (data ?? (!isLoading && !modelPending ? fallback : undefined)) : undefined,
    isLoading: !active || modelPending || isLoading,
    suggestionsEnabled
  }
}
