/**
 * Reasoning Cache Service
 *
 * Manages reasoning-related caching for AI providers that support thinking/reasoning modes.
 * This includes Google Gemini's thought signatures and OpenRouter's reasoning details.
 */

import type { JSONArray } from '@ai-sdk/provider'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'
import type { ProviderMetadata } from 'ai'

import { application } from '@application'

/**
 * Interface for reasoning cache
 */
export interface IReasoningCache<T> {
  set(key: string, value: T): void
  get(key: string): T | undefined
}

/**
 * Cache duration: 30 minutes
 * Reasoning data is typically only needed within a short conversation context
 */
const REASONING_CACHE_DURATION = 30 * 60 * 1000

/**
 * Google Gemini reasoning cache
 *
 * Stores thought signatures for Gemini 3 models to handle multi-turn conversations
 * where the model needs to maintain thinking context across tool calls.
 */
export const googleReasoningCache: IReasoningCache<string> = {
  set: (key, value) => application.get('CacheService').set(`google-reasoning:${key}`, value, REASONING_CACHE_DURATION),
  get: (key) => application.get('CacheService').get<string>(`google-reasoning:${key}`) || undefined
}

/**
 * OpenRouter reasoning cache
 *
 * Stores reasoning details from OpenRouter responses to preserve thinking tokens
 * and reasoning metadata across the conversation flow.
 */
export const openRouterReasoningCache: IReasoningCache<JSONArray> = {
  set(key, details) {
    // The SDK appends to this array and can extend its trailing reasoning.text in place after publishing a tool call.
    const snapshot = details.slice()
    const tail = snapshot.at(-1)
    if (tail && typeof tail === 'object' && !Array.isArray(tail) && tail.type === 'reasoning.text') {
      snapshot[snapshot.length - 1] = { ...tail }
    }
    application.get('CacheService').set(`openrouter-reasoning:${key}`, snapshot, REASONING_CACHE_DURATION)
  },
  get: (key) => application.get('CacheService').get<JSONArray>(`openrouter-reasoning:${key}`)
}

export interface ReasoningCacheReaders {
  googleReasoningCache?: Pick<typeof googleReasoningCache, 'get'>
  openRouterReasoningCache?: Pick<typeof openRouterReasoningCache, 'get'>
  getReplayMetadata?: (block: ContentBlockParam) => ProviderMetadata | null | undefined
}
