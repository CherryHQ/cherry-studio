/**
 * AiHubMix model-class dispatch.
 *
 * AiHubMix is a multi-backend gateway: one registered provider that hands a chat model to one of
 * five AI SDK model classes. WHICH backend an id belongs to is registry data
 * (`ProviderConfig.modelRouting` in `providers/aihubmix.ts`), so request-time endpoint resolution
 * and the catalog's reasoning projection read one table and can never drift. This module only maps
 * that resolved route onto the model class `createChatModel` builds.
 */
import type { ProviderModelRoute } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

/** Wire family AiHubMix routes a chat model to. */
export type AihubmixChatFamily = 'anthropic' | 'gemini' | 'openai-responses' | 'openai-chat' | 'compat'

/**
 * The model class for a routed model. An unrouted id is the openai-compatible
 * passthrough line — AiHubMix's default for everything it doesn't serve natively.
 */
export function resolveAihubmixChatFamily(route: ProviderModelRoute | undefined): AihubmixChatFamily {
  switch (route?.endpointType) {
    case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
      return 'anthropic'
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return 'gemini'
    case ENDPOINT_TYPE.OPENAI_RESPONSES:
      return 'openai-responses'
    // Only the responses-incapable OpenAI SKUs are routed here; @ai-sdk/openai's
    // chat model reads the same canonical `openai` namespace.
    case ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS:
      return 'openai-chat'
    default:
      return 'compat'
  }
}
