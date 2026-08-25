import * as z from 'zod'

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

export function parseConversationSuggestions(response: string): ConversationSuggestions {
  return suggestionResponseSchema.parse(JSON.parse(response.trim())).suggestions
}
