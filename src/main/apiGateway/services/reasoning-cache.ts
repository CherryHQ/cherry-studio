/**
 * Reasoning Cache Service
 *
 * Manages reasoning-related caching for AI providers that support thinking/reasoning modes.
 * This includes Google Gemini's thought signatures and OpenRouter's reasoning details.
 */

import type { ReasoningDetailUnion } from '@main/apiGateway/adapters/openrouter'
import { CacheService } from '@main/services/CacheService'

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
  set: (key, value) => CacheService.set(`google-reasoning:${key}`, value, REASONING_CACHE_DURATION),
  get: (key) => CacheService.get(`google-reasoning:${key}`) || undefined
}

/**
 * OpenRouter reasoning cache
 *
 * Stores reasoning details from OpenRouter responses to preserve thinking tokens
 * and reasoning metadata across the conversation flow.
 */
export const openRouterReasoningCache: IReasoningCache<ReasoningDetailUnion[]> = {
  set: (key, value) => CacheService.set(`openrouter-reasoning:${key}`, value, REASONING_CACHE_DURATION),
  get: (key) => CacheService.get(`openrouter-reasoning:${key}`) || undefined
}
