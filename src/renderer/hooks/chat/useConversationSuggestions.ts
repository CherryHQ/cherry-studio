import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { generateConversationSuggestions } from '@renderer/utils/aiGeneration'
import {
  type ConversationSuggestionPersona,
  type ConversationSuggestions
} from '@renderer/utils/conversationSuggestions'
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
  const resolvedModelId = suggestionsModelId ?? defaultModelId
  const key = active
    ? [
        'conversation-suggestions',
        focus,
        conversationId,
        outputLanguage,
        resolvedModelId ?? '',
        persona?.name ?? '',
        persona?.description ?? ''
      ]
    : null
  const { data, isLoading } = useSWRImmutable(
    key,
    async () => {
      const systemLocale = navigator.language
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const now = new Date()

      return generateConversationSuggestions({
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
      })
    },
    {
      onError: (error) => logger.warn('Failed to generate conversation suggestions', { focus, conversationId, error }),
      shouldRetryOnError: false
    }
  )

  return {
    suggestions: active ? (data ?? (!isLoading ? fallback : undefined)) : undefined,
    isLoading: !active || isLoading,
    suggestionsEnabled
  }
}
