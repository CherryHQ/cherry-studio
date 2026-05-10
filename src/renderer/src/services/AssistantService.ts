import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { MAX_CONTEXT_COUNT, UNLIMITED_CONTEXT_COUNT } from '@renderer/config/constant'
import { getModelSupportedReasoningEffortOptions } from '@renderer/config/models'
import { isQwenMTModel } from '@renderer/config/models/qwen'
import { UNKNOWN } from '@renderer/config/translate'
import { getStoreProviders } from '@renderer/hooks/useStore'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { addAssistant } from '@renderer/store/assistants'
import type {
  Assistant,
  AssistantPreset,
  AssistantSettings,
  LegacyAssistant,
  Model,
  TranslateLanguage
} from '@renderer/types'
import { DEFAULT_ASSISTANT_SETTINGS as SHARED_DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { v4 as uuid } from 'uuid'

import { composeDefaultAssistant } from './defaultAssistant'
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

const logger = loggerService.withContext('AssistantService')

/** Default assistant settings — single source of truth lives in the shared
 *  schema; re-exported here for legacy import paths until consumers migrate. */
export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = SHARED_DEFAULT_ASSISTANT_SETTINGS

/** v1 Redux store seed only — kept until the legacy assistants slice is removed. */
export function getDefaultAssistant(): Assistant {
  return composeDefaultAssistant(null)
}

/**
 * Translate-specific composition: assistant + the live translate model + the
 * per-call target language and prompt-rendered content. Lives here only because
 * `getDefaultTranslateAssistant` builds it; translate paths should compose
 * locally (see plan).
 */
export type TranslateComposition = Assistant & {
  model: Model
  targetLanguage: TranslateLanguage
  content: string
}

/**
 * Compose a translate "assistant" (really a model + prompt + target-language
 * bag). Throws when no translate model is configured or the language is
 * unknown.
 */
export async function getDefaultTranslateAssistant(
  targetLanguage: TranslateLanguage,
  text: string,
  _settings?: Partial<AssistantSettings>
): Promise<TranslateComposition> {
  // Direct Redux read — the LLM slice still owns translate-model selection.
  // Goes away when this function is deleted in favour of `useTranslateModel`
  // composition inside ActionTranslate / TranslatePage.
  const model = store.getState().llm.translateModel
  const assistant = getDefaultAssistant()

  if (!model) {
    logger.error('No translate model')
    throw new Error(i18n.t('translate.error.not_configured'))
  }

  if (targetLanguage.langCode === UNKNOWN.langCode) {
    logger.error('Unknown target language', targetLanguage)
    throw new Error('Unknown target language')
  }

  const supportedOptions = getModelSupportedReasoningEffortOptions(model)
  const reasoningEffort = supportedOptions?.includes('none') ? 'none' : 'default'
  const settings: AssistantSettings = {
    ...DEFAULT_ASSISTANT_SETTINGS,
    reasoning_effort: reasoningEffort,
    ..._settings
  }

  const content = isQwenMTModel(model)
    ? text
    : (await preferenceService.get('feature.translate.model_prompt'))
        .replaceAll('{{target_language}}', targetLanguage.value)
        .replaceAll('{{text}}', text)

  return {
    ...assistant,
    settings,
    model,
    targetLanguage,
    content
  }
}

/**
 * Normalize assistant settings — currently the only non-trivial transform is
 * collapsing `MAX_CONTEXT_COUNT` to `UNLIMITED_CONTEXT_COUNT` for downstream
 * consumers (TokenService, CodeCliPage). Schema defaults already populate the
 * rest, so the v1-era `?? DEFAULT_ASSISTANT_SETTINGS.x` chain is gone.
 */
export const getAssistantSettings = (assistant: Assistant): AssistantSettings => {
  const settings = assistant.settings
  return {
    ...settings,
    contextCount: settings.contextCount === MAX_CONTEXT_COUNT ? UNLIMITED_CONTEXT_COUNT : settings.contextCount
  }
}

export function getAssistantById(id: string) {
  const assistants = store.getState().assistants.assistants
  return assistants.find((a) => a.id === id)
}

/**
 * v1 legacy: dispatches Redux v1 slice. Going away with the slice itself.
 * Casts at the boundary to satisfy LegacyAssistant typing.
 */
export async function createAssistantFromAgent(agent: AssistantPreset) {
  const assistantId = uuid()
  const now = new Date().toISOString()

  const assistant: Assistant = {
    id: assistantId,
    name: agent.name,
    emoji: agent.emoji,
    prompt: agent.prompt,
    description: agent.description,
    settings: agent.settings ?? DEFAULT_ASSISTANT_SETTINGS,
    modelId: agent.modelId ?? null,
    mcpServerIds: agent.mcpServerIds ?? [],
    knowledgeBaseIds: agent.knowledgeBaseIds ?? [],
    createdAt: now,
    updatedAt: now
  }

  store.dispatch(addAssistant(assistant as unknown as LegacyAssistant))

  window.toast.success(i18n.t('message.assistant.added.content'))

  return assistant
}
