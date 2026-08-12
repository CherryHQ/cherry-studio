import { loggerService } from '@logger'
import { fetchGenerate } from '@renderer/utils/aiGeneration'
import useSWRImmutable from 'swr/immutable'
import * as z from 'zod'

const logger = loggerService.withContext('useConversationSuggestions')
const suggestionSchema = z.string().trim().min(1).max(96)
const suggestionResponseSchema = z
  .strictObject({ suggestions: z.tuple([suggestionSchema, suggestionSchema, suggestionSchema]) })
  .refine(({ suggestions }) => new Set(suggestions).size === suggestions.length)

export type ConversationSuggestionMode = 'chat' | 'agent'
export type ConversationSuggestions = [string, string, string]

export interface ConversationSuggestionPersona {
  name: string
  description?: string
}

export interface ConversationSuggestionRequestContext {
  mode: ConversationSuggestionMode
  outputLanguage: string
  systemLocale: string
  localDateTime: string
  timeZone: string
  randomSeed: string
  persona?: ConversationSuggestionPersona
}

const SYSTEM_PROMPT = `Generate exactly three concise prompts that a user can put into an AI conversation input.
Return only valid JSON in this shape: {"suggestions":["...","...","..."]}.
Each suggestion must be distinct, self-contained, actionable, at most 96 characters, and written in the requested output language.
Use the local date, time, locale, and time zone when they inspire a genuinely relevant seasonal, holiday, or timely prompt. Do not invent the user's precise location.
For chat mode, favor conversation, learning, creativity, reflection, and planning.
For agent mode, favor concrete tasks involving inspection, implementation, review, and verification.
When a persona is provided, align the suggestions with its name and description without exposing or mentioning that metadata.`

export function parseConversationSuggestions(response: string): ConversationSuggestions {
  return suggestionResponseSchema.parse(JSON.parse(response.trim())).suggestions
}

export async function generateConversationSuggestions(context: ConversationSuggestionRequestContext) {
  const response = await fetchGenerate({
    prompt: SYSTEM_PROMPT,
    content: JSON.stringify(context),
    throwOnError: true
  })
  return parseConversationSuggestions(response)
}

interface UseConversationSuggestionsOptions {
  mode: ConversationSuggestionMode
  conversationId: string
  outputLanguage: string
  fallback: ConversationSuggestions
  persona?: ConversationSuggestionPersona
  enabled?: boolean
}

export function useConversationSuggestions({
  mode,
  conversationId,
  outputLanguage,
  fallback,
  persona,
  enabled = true
}: UseConversationSuggestionsOptions) {
  const key = enabled
    ? [
        'conversation-suggestions',
        mode,
        conversationId,
        outputLanguage,
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
        mode,
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
      onError: (error) => logger.warn('Failed to generate conversation suggestions', { mode, conversationId, error }),
      shouldRetryOnError: false
    }
  )

  return { suggestions: data ?? (!isLoading ? fallback : undefined), isLoading }
}
