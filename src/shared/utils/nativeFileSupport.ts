/**
 * Cross-process native file-part eligibility that does not need AI SDK routing.
 *
 * Full audio/video converter gates still live in main (`nativeFileSupport.ts`)
 * because they need the resolved AI SDK provider id. Vision image uploads only
 * need model capability + a small force-text provider denylist, so both the
 * picker and MediaExecutionConfig can share this predicate.
 */

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNonChatModel, isVisionModel } from '@shared/utils/model'

/** Providers known to choke on native file parts; force text extraction (e.g. Qiniu, #15090). */
const FORCE_TEXT_PROVIDER_IDS = new Set<string>(['qiniu'])

/**
 * First-party provider ids whose default AI SDK converters discard native audio
 * file parts. Conservative picker denylist — does not include openai/azure
 * because chat-completions variants can accept audio while Responses cannot,
 * and the renderer cannot resolve the live converter without main routing.
 */
const NO_GENERATE_TEXT_AUDIO_PROVIDER_IDS = new Set<string>([
  'anthropic',
  'azure-anthropic',
  'anthropic-vertex',
  'google-vertex-anthropic',
  'bedrock',
  'xai',
  'xai-responses',
  'mistral',
  'groq',
  'perplexity'
])

function matchesProviderIdSet(provider: Pick<Provider, 'id' | 'presetProviderId'>, ids: ReadonlySet<string>): boolean {
  return ids.has(provider.id) || (provider.presetProviderId != null && ids.has(provider.presetProviderId))
}

/** Whether this provider must extract files to text instead of sending native file parts. */
export function isForceTextExtractionProvider(provider: Pick<Provider, 'id' | 'presetProviderId'>): boolean {
  return matchesProviderIdSet(provider, FORCE_TEXT_PROVIDER_IDS)
}

/**
 * Best-effort renderer/main gate for generateText audio file parts when the
 * resolved AI SDK converter id is unavailable. Force-text and known no-audio
 * first-party providers are rejected; unknown/custom providers stay selectable.
 */
export function supportsGenerateTextAudioInput(provider: Pick<Provider, 'id' | 'presetProviderId'>): boolean {
  if (isForceTextExtractionProvider(provider)) return false
  return !matchesProviderIdSet(provider, NO_GENERATE_TEXT_AUDIO_PROVIDER_IDS)
}

/**
 * Model vision capability plus converter eligibility for image file parts.
 * Providers forced to text extraction cannot carry vision uploads.
 */
export function supportsVisionFileInput(provider: Pick<Provider, 'id' | 'presetProviderId'>, model: Model): boolean {
  if (!isVisionModel(model)) return false
  if (isForceTextExtractionProvider(provider)) return false
  return true
}

/**
 * Video-vision picker / default-model row: vision-capable chat models whose
 * provider can actually accept image frame parts for the AV vision pipeline.
 */
export function isVideoVisionSelectableModel(
  model: Model,
  provider?: Pick<Provider, 'id' | 'presetProviderId'> | null
): boolean {
  if (!isVisionModel(model) || isNonChatModel(model)) return false
  if (!provider) return false
  return supportsVisionFileInput(provider, model)
}
