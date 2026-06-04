import i18n from '@renderer/i18n'
import type { AssistantSettings, LegacyAssistant } from '@renderer/types'
import { DEFAULT_ASSISTANT_SETTINGS as SHARED_DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

const LEGACY_DEFAULT_ASSISTANT_ID = 'default'

/**
 * v1 back-compat shim for the Redux assistants slice, which initialises
 * `defaultAssistant` synchronously without a modelId. Dies with the slice.
 */
export function getDefaultAssistant(): LegacyAssistant {
  return {
    id: LEGACY_DEFAULT_ASSISTANT_ID,
    name: i18n.t('chat.default.name'),
    prompt: '',
    topics: [],
    type: 'assistant',
    emoji: '😀',
    description: '',
    settings: SHARED_DEFAULT_ASSISTANT_SETTINGS
  }
}

/** Default assistant settings — single source of truth lives in the shared
 *  schema; re-exported here for legacy import paths until consumers migrate. */
export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = SHARED_DEFAULT_ASSISTANT_SETTINGS
