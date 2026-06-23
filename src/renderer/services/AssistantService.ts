import i18n from '@renderer/i18n'
import type { Assistant, AssistantSettings } from '@renderer/types'
import { DEFAULT_ASSISTANT_SETTINGS as SHARED_DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

const LEGACY_DEFAULT_ASSISTANT_LITERAL = 'default'
const DEFAULT_ASSISTANT_TIMESTAMP = new Date(0).toISOString()

/**
 * v1 back-compat shim for the Redux assistants slice, which initialises
 * `defaultAssistant` synchronously without a modelId. Dies with the slice.
 */
export function getDefaultAssistant(): Assistant {
  return {
    id: LEGACY_DEFAULT_ASSISTANT_LITERAL,
    name: i18n.t('chat.default.name'),
    emoji: '😀',
    prompt: '',
    description: '',
    settings: SHARED_DEFAULT_ASSISTANT_SETTINGS,
    modelId: null,
    modelName: null,
    orderKey: '',
    mcpServerIds: [],
    knowledgeBaseIds: [],
    tags: [],
    createdAt: DEFAULT_ASSISTANT_TIMESTAMP,
    updatedAt: DEFAULT_ASSISTANT_TIMESTAMP
  }
}

/** Default assistant settings — single source of truth lives in the shared
 *  schema; re-exported here for legacy import paths until consumers migrate. */
export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = SHARED_DEFAULT_ASSISTANT_SETTINGS
