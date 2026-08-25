import { Button, Skeleton } from '@cherrystudio/ui'
import { useConversationSuggestions } from '@renderer/hooks/chat/useConversationSuggestions'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import {
  type ConversationSuggestionPersona,
  type ConversationSuggestions as SuggestionTuple
} from '@renderer/utils/conversationSuggestions'
import { useTranslation } from 'react-i18next'

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
        className="flex min-w-0 flex-col items-start gap-1.5"
        aria-hidden>
        <Skeleton className="h-7 w-48 rounded-full opacity-50" />
        <Skeleton className="h-7 w-40 rounded-full opacity-50" />
        <Skeleton className="h-7 w-44 rounded-full opacity-50" />
      </div>
    )
  }

  return (
    <div data-testid="conversation-suggestions" className="flex min-w-0 flex-col items-start gap-1.5">
      {suggestions.map((suggestion) => (
        <Button
          key={suggestion}
          type="button"
          variant="ghost"
          size="sm"
          className="whitespace-normal! h-auto min-h-7 max-w-full justify-start rounded-full border-[0.5px] border-transparent bg-background-subtle px-2.5 py-1 text-left font-normal text-[11px] text-foreground-tertiary! leading-4 shadow-none hover:border-border-subtle hover:bg-muted/50 hover:text-foreground-tertiary! focus-visible:border-border-subtle focus-visible:bg-muted/50 focus-visible:text-foreground-tertiary!"
          onClick={() => void EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId, text: suggestion })}>
          <span>{suggestion}</span>
        </Button>
      ))}
    </div>
  )
}
