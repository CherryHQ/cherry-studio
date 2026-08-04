/**
 * Resolve which attachment modalities the target (provider, model) can take as
 * **native user-message file input** — the routing gate in `prepareChatMessages`:
 * native modalities are inlined as the real file part; everything else is sent
 * as extracted/OCR text.
 *
 * The first-party provider set + per-model PDF check are lifted from the retired
 * `pdfCompatibility` feature. Image/audio/video native input rides on the model
 * capability alone (`isVision`/`isAudio`/`isVideo`) — matching how the legacy
 * path inlined media to any provider — so a multimodal model stays native even
 * on an aggregator / openai-compatible endpoint. Only PDF additionally requires
 * a first-party protocol (its native-PDF support is provider-specific).
 */

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import {
  isAnthropicModel,
  isAudioModel,
  isGeminiModel,
  isOpenAILLMModel,
  isVideoModel,
  isVisionModel
} from '@shared/utils/model'

import type { AppProviderId } from '../../../types'

/** What a (provider, model) accepts as a native user-message file part. */
export interface NativeFileSupport {
  readonly image: boolean
  readonly pdf: boolean
  readonly audio: boolean
  readonly video: boolean
}

/**
 * First-party protocols that accept native file user-message input.
 *
 * This is a conservative **default allow-list** (carried over from the retired
 * `pdfCompatibility`): an unknown third-party provider does not get native PDF,
 * so we never hand a file part to a compat endpoint that can't take one. It can
 * later be superseded by provider-level metadata / a toggle declaring native
 * file support — `resolveNativeFileSupport` already receives `provider`, so
 * adding that boolean needs no signature change.
 */
const NATIVE_FILE_PROVIDER_IDS = new Set<AppProviderId>([
  // The resolver emits the base `openai` id only for the Responses endpoint
  // (chat-completions resolves to `openai-chat`/`openai-compatible`).
  'openai',
  'anthropic',
  'google',
  'azure',
  'azure-responses',
  'google-vertex',
  'bedrock',
  'anthropic-vertex'
])

/** Providers known to choke on native file parts; force text extraction (e.g. Qiniu, #15090). */
const FORCE_TEXT_PROVIDER_IDS = new Set<string>(['qiniu'])

function isFirstPartyFileProvider(provider: Provider, aiSdkProviderId: AppProviderId): boolean {
  if (
    FORCE_TEXT_PROVIDER_IDS.has(provider.id) ||
    (provider.presetProviderId != null && FORCE_TEXT_PROVIDER_IDS.has(provider.presetProviderId))
  ) {
    return false
  }
  return NATIVE_FILE_PROVIDER_IDS.has(aiSdkProviderId)
}

function supportsNativePdf(provider: Provider, model: Model, aiSdkProviderId: AppProviderId): boolean {
  if (!isFirstPartyFileProvider(provider, aiSdkProviderId)) return false
  if (aiSdkProviderId === 'openai' || aiSdkProviderId === 'azure' || aiSdkProviderId === 'azure-responses') {
    return isOpenAILLMModel(model)
  }
  if (aiSdkProviderId === 'anthropic' || aiSdkProviderId === 'anthropic-vertex' || aiSdkProviderId === 'bedrock') {
    return isAnthropicModel(model)
  }
  if (aiSdkProviderId === 'google' || aiSdkProviderId === 'google-vertex') {
    return isGeminiModel(model)
  }
  return true
}

export function resolveNativeFileSupport(
  provider: Provider,
  model: Model,
  aiSdkProviderId: AppProviderId
): NativeFileSupport {
  return {
    image: isVisionModel(model),
    pdf: supportsNativePdf(provider, model, aiSdkProviderId),
    audio: isAudioModel(model),
    video: isVideoModel(model)
  }
}
