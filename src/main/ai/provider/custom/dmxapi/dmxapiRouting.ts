/**
 * DMXAPI model-class dispatch.
 *
 * Which backend a model belongs to is registry data — each endpoint in `providers/dmxapi.ts` declares
 * the creators it `serves` — shared with request-time endpoint resolution and the catalog's
 * reasoning projection. This module only maps the resolved route onto the AI SDK model class.
 */
import type { ResolvedModelRoute } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

export type DmxapiChatFamily = 'openai-compat' | 'openai' | 'anthropic' | 'gemini'

/** An unrouted id is the openai-compatible passthrough line. */
export function resolveDmxapiChatFamily(route: ResolvedModelRoute | undefined): DmxapiChatFamily {
  switch (route?.endpointType) {
    case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
      return 'anthropic'
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return 'gemini'
    // Native OpenAI chat models — @ai-sdk/openai's chat class reads the canonical `openai` namespace.
    case ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS:
      return 'openai'
    default:
      return 'openai-compat'
  }
}
