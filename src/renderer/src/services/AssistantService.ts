import type { Assistant, AssistantSettings } from '@renderer/types'
import { DEFAULT_ASSISTANT_SETTINGS as SHARED_DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { composeDefaultAssistant } from './defaultAssistant'

/**
 * v1 back-compat shim for the Redux assistants slice, which initialises
 * `defaultAssistant` synchronously without a modelId. Dies with the slice.
 */
export function getDefaultAssistant(): Assistant {
  return composeDefaultAssistant(null)
}

/** Default assistant settings — single source of truth lives in the shared
 *  schema; re-exported here for legacy import paths until consumers migrate. */
export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = SHARED_DEFAULT_ASSISTANT_SETTINGS
