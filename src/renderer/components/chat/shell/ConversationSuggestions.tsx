import { useTranslation } from 'react-i18next'

import { Button, Skeleton } from '@cherrystudio/ui'
import { useConversationSuggestions } from '@renderer/hooks/chat/useConversationSuggestions'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import {
  type ConversationSuggestionPersona,
  type ConversationSuggestions as SuggestionTuple
} from '@renderer/utils/conversationSuggestions'

interface ConversationSuggestionsProps {
  focus: string
  conversationId: string
  topicId: string
  fallback: SuggestionTuple
  persona?: ConversationSuggestionPersona
  enabled?: boolean
}

export function ConversationSuggestions({
  focus,
  conversationId,
  topicId,
  fallback,
  persona,
  enabled
}: ConversationSuggestionsProps) {
  const { i18n } = useTranslation()
  const { suggestions, isLoading, suggestionsEnabled } = useConversationSuggestions({
    focus,
    conversationId,
    outputLanguage: i18n?.resolvedLanguage ?? i18n?.language ?? navigator.language,
    fallback,
    persona,
    enabled
  })

  if (!suggestionsEnabled) return null

  if (isLoading || !suggestions) {
    return (
      <div
        data-testid="conversation-suggestions-loading"
        className="flex w-full min-w-0 flex-col items-center gap-2"
        aria-hidden>
        <Skeleton className="h-9 w-full max-w-[560px] rounded-lg opacity-50" />
        <Skeleton className="h-9 w-full max-w-[520px] rounded-lg opacity-50" />
        <Skeleton className="h-9 w-full max-w-[540px] rounded-lg opacity-50" />
      </div>
    )
  }

  return (
    <div data-testid="conversation-suggestions" className="flex w-full min-w-0 flex-col items-center gap-2">
      {suggestions.map((suggestion) => (
        <Button
          key={suggestion}
          type="button"
          variant="ghost"
          size="sm"
          className="whitespace-normal! h-auto min-h-9 w-full max-w-[560px] justify-center rounded-lg border border-transparent bg-background-subtle px-4 py-2 text-center text-sm font-normal leading-5 text-foreground-secondary! shadow-none hover:border-border-subtle hover:bg-muted/50 hover:text-foreground! focus-visible:border-border-subtle focus-visible:bg-muted/50 focus-visible:text-foreground!"
          onClick={() => void EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId, text: suggestion })}>
          <span>{suggestion}</span>
        </Button>
      ))}
    </div>
  )
}
