// This module currently mixes v1 (Redux) and v2 (Preference) reads:
//   v2 / Preference: chat.* keys via `preferenceService`
//   v1 / Redux:      `store.getState().llm.translateModel`,
//                    `getStoreProviders` (assistants slice + provider list)
// The v1 reads stay until the corresponding migrators land — see the
// Coexistence Mindset in CLAUDE.md. Don't add new v1 reads.

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { getModelSupportedReasoningEffortOptions } from '@renderer/config/models'
import { isQwenMTModel } from '@renderer/config/models/qwen'
import { getStoreProviders } from '@renderer/hooks/useStore'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import type { Assistant, AssistantSettings, Model, TranslateAssistant, TranslateLanguage } from '@renderer/types'
import { DEFAULT_ASSISTANT_SETTINGS as SHARED_DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

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
 * Compose a translate "assistant" (really a model + prompt + target-language
 * bag). Throws when no translate model is configured or the language is
 * unknown.
 */
export async function getDefaultTranslateAssistant(
  targetLanguage: TranslateLanguage,
  text: string,
  _settings?: Partial<AssistantSettings>
): Promise<TranslateAssistant> {
  // Direct Redux read — the LLM slice still owns translate-model selection.
  // Goes away when this function is deleted in favour of `useTranslateModel`
  // composition inside ActionTranslate / TranslatePage.
  const model = store.getState().llm.translateModel
  const assistant = getDefaultAssistant()

  if (!model) {
    logger.error('No translate model')
    throw new Error(i18n.t('translate.error.not_configured'))
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

export function getAssistantById(id: string | undefined | null) {
  if (!id) return undefined
  const assistants = store.getState().assistants.assistants
  return assistants.find((a) => a.id === id)
}
