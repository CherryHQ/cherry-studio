/**
 * Stub functions for renderer-specific services and utilities.
 *
 * TODO (Step 2 Phase C): These stubs exist because the original renderer code
 * fetches data from Redux store / renderer services. In Main process, this data
 * should come from BuildContext (injected by AiService).
 *
 * When BuildContext is implemented:
 * 1. Remove these stubs
 * 2. Refactor callers to receive data via function parameters instead of calling these
 */

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { Assistant } from '@types'

/** Stub: get provider config by model. */
export function getProviderByModel(_model: Model): Provider | undefined {
  throw new Error('getProviderByModel stub: use BuildContext instead')
}

/** Stub: get assistant settings. */
export function getAssistantSettings(_assistant: Assistant): Assistant['settings'] {
  throw new Error('getAssistantSettings stub: use BuildContext instead')
}

/** Stub: get store setting. */
export function getStoreSetting<T>(_key: string): T {
  throw new Error('getStoreSetting stub: use BuildContext instead')
}

/** Stub: get provider by ID. */
export function getProviderById(_id: string): Provider | undefined {
  throw new Error('getProviderById stub: use BuildContext instead')
}

/** Stub: get lowercase base model name. */
export function getLowerBaseModelName(model: Model): string {
  return model.id.toLowerCase()
}

/** Stub: map language to Qwen MT model. */
export function mapLanguageToQwenMTModel(_language: string): string | undefined {
  // TODO: migrate from src/renderer/src/config/translate.ts
  return undefined
}

/** Web search configuration type. */
export interface CherryWebSearchConfig {
  enabled?: boolean
  maxResults?: number
  excludeDomains?: string[]
  [key: string]: unknown
}

/** Stub: map regex patterns for blacklist. */
export function mapRegexToPatterns(patterns: string[]): string[] {
  // TODO: migrate from src/renderer/src/utils/blacklistMatchPattern.ts
  return patterns
}
