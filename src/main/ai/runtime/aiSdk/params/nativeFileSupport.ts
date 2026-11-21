/**
 * Resolve which attachment modalities the target (provider, model) can take as
 * **native user-message file input** — the routing gate in `prepareChatMessages`:
 * native modalities are inlined as the real file part; everything else is sent
 * as extracted/OCR text.
 *
 * The first-party provider set + per-model PDF check are lifted from the retired
 * `pdfCompatibility` feature. Image input rides on the model capability alone.
 * Audio/video additionally require the resolved AI SDK converter to support the
 * modality; model metadata describes intrinsic capability, not wire compatibility.
 */

import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
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
  /** Audio MIME types the converter accepts. Absent: any resolved audio MIME stays native when `audio` is true. */
  readonly audioMediaTypes?: readonly string[]
}

/** Resolved request routing needed to identify the actual AI SDK converter. */
export interface NativeFileRouting {
  readonly endpointType?: EndpointType
  readonly aiSdkProviderId: AppProviderId
  readonly runtimeProviderId: AppProviderId
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

/** AI SDK converters that reject or discard every audio/video file part. */
const NO_NATIVE_AUDIO_VIDEO_PROVIDER_IDS = new Set<AppProviderId>([
  'openai',
  'azure-responses',
  'anthropic',
  'azure-anthropic',
  'bedrock',
  'google-vertex-anthropic',
  'anthropic-vertex',
  'xai',
  'xai-responses',
  'mistral',
  'groq',
  'perplexity'
])

/** AI SDK converters with native support for both audio and video file parts. */
const NATIVE_AUDIO_VIDEO_PROVIDER_IDS = new Set<AppProviderId>(['google', 'google-vertex'])

/** Audio MIME types accepted by the installed OpenRouter converter. */
const OPENROUTER_AUDIO_MEDIA_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/x-wav',
  'audio/wave',
  'audio/wav',
  'audio/ogg',
  'audio/vorbis',
  'audio/aac',
  'audio/x-aac',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp4',
  'audio/aiff',
  'audio/x-aiff',
  'audio/flac',
  'audio/x-flac',
  'audio/pcm16',
  'audio/pcm24'
] as const

/** OpenAI chat-compatible converters: partial audio support, no video file parts. */
const OPENAI_CHAT_MEDIA_PROVIDER_IDS = new Set<AppProviderId>([
  'openai-chat',
  'openai-compatible',
  'azure',
  'github-copilot-openai-compatible',
  'google-vertex-maas'
])

/** Installed OpenAI chat and OpenAI-compatible converters accept these audio types and throw for the rest. */
const OPENAI_CHAT_AUDIO_MEDIA_TYPES = ['audio/wav', 'audio/mp3', 'audio/mpeg'] as const

interface NativeAudioVideoSupport {
  readonly audio: boolean
  readonly video: boolean
  readonly audioMediaTypes?: readonly string[]
}

function openAiChatAudioVideo(): NativeAudioVideoSupport {
  return { audio: true, video: false, audioMediaTypes: OPENAI_CHAT_AUDIO_MEDIA_TYPES }
}

function resolveNativeAudioVideoSupport(
  runtimeProviderId: AppProviderId,
  endpointType?: EndpointType
): NativeAudioVideoSupport {
  if (NO_NATIVE_AUDIO_VIDEO_PROVIDER_IDS.has(runtimeProviderId)) return { audio: false, video: false }
  // Protocol-level denials override otherwise-capable converters.
  if (endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES || endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES) {
    return { audio: false, video: false }
  }
  if (NATIVE_AUDIO_VIDEO_PROVIDER_IDS.has(runtimeProviderId)) return { audio: true, video: true }
  if (runtimeProviderId === 'openrouter') {
    return { audio: true, video: true, audioMediaTypes: OPENROUTER_AUDIO_MEDIA_TYPES }
  }
  if (OPENAI_CHAT_MEDIA_PROVIDER_IDS.has(runtimeProviderId)) return openAiChatAudioVideo()

  // Multi-backend providers retain their own provider id, so their resolved
  // endpoint is the source of truth for which converter they select internally.
  if (endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) return openAiChatAudioVideo()
  if (endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) {
    return { audio: true, video: true }
  }

  // Preserve the previous model-only behavior for unclassified endpoints.
  return { audio: true, video: true }
}

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
  routing: NativeFileRouting
): NativeFileSupport {
  const mediaSupport = resolveNativeAudioVideoSupport(routing.runtimeProviderId, routing.endpointType)
  return {
    image: isVisionModel(model),
    pdf: supportsNativePdf(provider, model, routing.aiSdkProviderId),
    audio: mediaSupport.audio && isAudioModel(model),
    video: mediaSupport.video && isVideoModel(model),
    ...(mediaSupport.audioMediaTypes ? { audioMediaTypes: mediaSupport.audioMediaTypes } : {})
  }
}

/**
 * Prepared audio can be replayed only when the fallback converter accepts every
 * required MIME. An absent allow-list still means any audio MIME.
 */
export function acceptsPreparedAudio(required: NativeFileSupport, fallback: NativeFileSupport): boolean {
  const requiredTypes = required.audioMediaTypes
  if (!required.audio || !requiredTypes?.length) return true
  const allowed = fallback.audioMediaTypes
  if (!allowed) return true
  return requiredTypes.every((mediaType) => allowed.includes(mediaType))
}
