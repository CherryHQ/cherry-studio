import i18n from '@renderer/i18n'
import type { Assistant } from '@renderer/types'
import { DEFAULT_ASSISTANT_ID, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { UniqueModelId } from '@shared/data/types/model'

const DEFAULT_ASSISTANT_TIMESTAMP = new Date(0).toISOString()

/**
 * Pure runtime composition of the default assistant. v2 has no `id='default'`
 * row in SQLite (legacy `'default'` was remapped to a UUID by AssistantMigrator);
 * the default assistant is always synthesized from a static template plus the
 * caller-supplied `modelId` (sourced from `chat.default_model_id` preference).
 *
 * React contexts: prefer `useDefaultAssistant()` from `@renderer/hooks/useAssistant`.
 */
export function composeDefaultAssistant(modelId: UniqueModelId | null): Assistant {
  return {
    id: DEFAULT_ASSISTANT_ID,
    name: i18n.t('chat.default.name'),
    emoji: '😀',
    prompt: '',
    description: '',
    settings: DEFAULT_ASSISTANT_SETTINGS,
    modelId,
    mcpServerIds: [],
    knowledgeBaseIds: [],
    createdAt: DEFAULT_ASSISTANT_TIMESTAMP,
    updatedAt: DEFAULT_ASSISTANT_TIMESTAMP
  }
}
