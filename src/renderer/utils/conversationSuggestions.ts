import * as z from 'zod'

const CONVERSATION_SUGGESTION_PERSONA_NAME_MAX_LENGTH = 200
const CONVERSATION_SUGGESTION_PERSONA_DESCRIPTION_MAX_LENGTH = 2000

const suggestionSchema = z.string().trim().min(1).max(96)
const suggestionResponseSchema = z
  .strictObject({ suggestions: z.tuple([suggestionSchema, suggestionSchema, suggestionSchema]) })
  .refine(({ suggestions }) => new Set(suggestions).size === suggestions.length)

export type ConversationSuggestions = [string, string, string]

export interface ConversationSuggestionPersona {
  name: string
  description?: string
}

export interface ConversationSuggestionRequestContext {
  focus: string
  outputLanguage: string
  systemLocale: string
  localDateTime: string
  timeZone: string
  randomSeed: string
  persona?: ConversationSuggestionPersona
}

export function normalizeConversationSuggestionPersona(
  persona?: ConversationSuggestionPersona
): ConversationSuggestionPersona | undefined {
  if (!persona) return undefined

  return {
    ...persona,
    name: persona.name.slice(0, CONVERSATION_SUGGESTION_PERSONA_NAME_MAX_LENGTH),
    description: persona.description?.slice(0, CONVERSATION_SUGGESTION_PERSONA_DESCRIPTION_MAX_LENGTH)
  }
}

export function parseConversationSuggestions(response: string): ConversationSuggestions {
  return suggestionResponseSchema.parse(JSON.parse(response.trim())).suggestions
}
