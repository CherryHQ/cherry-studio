/**
 * Resolve what the `read_file` tool may hand back to the model: native media
 * (image/PDF in a tool result) vs extracted text.
 *
 * The provider set + per-model checks are lifted from the retired
 * `pdfCompatibility` feature — the same first-party protocols that accept a
 * native PDF in a user message also accept image/PDF media inside a **tool
 * result** (verified against the installed `@ai-sdk/{openai,anthropic,google}`
 * providers: OpenAI-Responses → `input_file`/`input_image`, Anthropic →
 * `document`/`image`, Gemini → `inlineData`). Aggregators / openai-compatible
 * tool results are text-only, so they fall through to extracted text.
 */

import type { FileToolCapabilities } from '@main/ai/tools/adapters/aiSdk/context'
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

/** First-party protocols whose tool-result channel accepts image/PDF media. */
const MEDIA_TOOL_RESULT_PROVIDER_IDS = new Set<AppProviderId>([
  // The resolver emits the base `openai` id only for the Responses endpoint
  // (chat-completions resolves to `openai-chat`/`openai-compatible`), so this
  // targets exactly the rich-tool-result Responses path.
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

function supportsMediaInToolResult(provider: Provider, model: Model, aiSdkProviderId: AppProviderId): boolean {
  if (
    FORCE_TEXT_PROVIDER_IDS.has(provider.id) ||
    (provider.presetProviderId != null && FORCE_TEXT_PROVIDER_IDS.has(provider.presetProviderId))
  ) {
    return false
  }
  if (!MEDIA_TOOL_RESULT_PROVIDER_IDS.has(aiSdkProviderId)) return false

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

export function resolveFileToolCapabilities(
  provider: Provider,
  model: Model,
  aiSdkProviderId: AppProviderId
): FileToolCapabilities {
  return {
    acceptsMediaInToolResult: supportsMediaInToolResult(provider, model, aiSdkProviderId),
    isVision: isVisionModel(model),
    isAudio: isAudioModel(model),
    isVideo: isVideoModel(model)
  }
}
