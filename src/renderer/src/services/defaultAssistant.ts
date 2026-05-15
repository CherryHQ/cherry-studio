import i18n from '@renderer/i18n'
import type { Assistant } from '@renderer/types'
import {
  DEFAULT_ASSISTANT_CONTEXT_COUNT,
  type DefaultAssistantPreference
} from '@shared/data/preference/preferenceTypes'
import { DEFAULT_ASSISTANT_ID, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { UniqueModelId } from '@shared/data/types/model'

const DEFAULT_ASSISTANT_TIMESTAMP = new Date(0).toISOString()

/**
 * Pure runtime composition of the default assistant. v2 has no `id='default'`
 * row in SQLite (legacy `'default'` was remapped to a UUID by AssistantMigrator);
 * the default assistant is always synthesized from a static template, persisted
 * user overrides, and the caller-supplied `modelId`.
 *
 * React contexts: prefer `useDefaultAssistant()` from `@renderer/hooks/useAssistant`.
 */
export function composeDefaultAssistant(
  modelId: UniqueModelId | null,
  overrides: DefaultAssistantPreference | null = null
): Assistant {
  const settings = {
    ...DEFAULT_ASSISTANT_SETTINGS,
    contextCount: DEFAULT_ASSISTANT_CONTEXT_COUNT,
    ...overrides?.settings
  }

  return {
    id: DEFAULT_ASSISTANT_ID,
    name: overrides?.name ?? i18n.t('chat.default.name'),
    emoji: overrides?.emoji ?? '😀',
    prompt: overrides?.prompt ?? '',
    description: '',
    settings,
    modelId,
    modelName: null,
    mcpServerIds: [],
    knowledgeBaseIds: [],
    tags: [],
    createdAt: DEFAULT_ASSISTANT_TIMESTAMP,
    updatedAt: DEFAULT_ASSISTANT_TIMESTAMP
  }
}
