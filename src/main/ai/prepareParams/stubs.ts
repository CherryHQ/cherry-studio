/**
 * Stub functions for renderer-specific services.
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

/** Stub: get provider config by model. In Main, use application.get('PreferenceService') or BuildContext. */
export function getProviderByModel(_model: Model): Provider | undefined {
  throw new Error('getProviderByModel stub: use BuildContext instead')
}

/** Stub: get assistant settings. In Main, use BuildContext.assistant.settings. */
export function getAssistantSettings(_assistant: Assistant): Assistant['settings'] {
  throw new Error('getAssistantSettings stub: use BuildContext instead')
}

/** Stub: default assistant settings constant. */
export const DEFAULT_ASSISTANT_SETTINGS: Partial<Assistant['settings']> = {}

/** Stub: get store setting. In Main, use application.get('PreferenceService'). */
export function getStoreSetting<T>(_key: string): T {
  throw new Error('getStoreSetting stub: use BuildContext instead')
}

/** Stub: check if tool use mode is function calling. */
export function isToolUseModeFunction(_assistant: Assistant): boolean {
  return false
}

/** Stub: get default model. */
export function getDefaultModel(): Model | undefined {
  return undefined
}

/** Stub: get hub mode system prompt. */
export function getHubModeSystemPrompt(): string {
  return ''
}

/** Stub: replace prompt variables ({{date}}, {{time}}, etc). */
export function replacePromptVariables(prompt: string): string {
  // TODO: migrate from src/renderer/src/utils/prompt.ts
  return prompt
}

/**
 * Stub: IdleTimeoutController — resets timeout on each chunk.
 * TODO: migrate from src/renderer/src/utils/IdleTimeoutController.ts
 */
export class IdleTimeoutController {
  start(_timeoutMs: number, _onTimeout: () => void): IdleTimeoutHandle {
    return { reset: () => {}, clear: () => {} }
  }
}

export interface IdleTimeoutHandle {
  reset: () => void
  clear: () => void
}
