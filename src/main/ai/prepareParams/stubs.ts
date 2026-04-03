/**
 * Stub functions for renderer-specific services.
 *
 * TODO (Step 2 Phase C): These stubs exist because the original renderer code
 * fetches data from Redux store / renderer services. In Main process, this data
 * should come from BuildContext (injected by AiCompletionService).
 *
 * When BuildContext is implemented:
 * 1. Remove these stubs
 * 2. Refactor callers to receive data via function parameters instead of calling these
 */

import type { Assistant, Model, Provider } from '@types'

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
