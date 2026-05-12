// This module currently mixes v1 (Redux) and v2 (Preference) reads:
//   v2 / Preference: chat.* keys via `preferenceService`
//   v1 / Redux:      `getStoreProviders` (provider list)
// The v1 reads stay until the corresponding migrators land — see the
// Coexistence Mindset in CLAUDE.md. Don't add new v1 reads.

import { getStoreProviders } from '@renderer/hooks/useStore'
import type { AssistantSettings, Model } from '@renderer/types'
import { DEFAULT_ASSISTANT_SETTINGS as SHARED_DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { getProviderByModel } from './ProviderService'

export { getProviderByModel }

/**
 * Fallback chain for "give me *some* provider":
 *   1. Provider that matches the assistant's chosen model
 *   2. First provider in the registry
 *
 * Returns `undefined` only when the provider registry is completely empty
 * (fresh install before any LLM provider is configured). Caller passes the
 * model so the function stays free of Redux/global lookups.
 */
export function getDefaultProvider(model?: Model) {
  return getProviderByModel(model) ?? getStoreProviders()[0]
}

/** Default assistant settings — single source of truth lives in the shared
 *  schema; re-exported here for legacy import paths until consumers migrate. */
export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = SHARED_DEFAULT_ASSISTANT_SETTINGS
