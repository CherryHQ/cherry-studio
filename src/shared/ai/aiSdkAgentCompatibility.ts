/**
 * AI SDK agent runtime provider/model compatibility.
 *
 * Pure, cross-process predicate shared by renderer model filtering (the
 * `ai-sdk` runtime descriptor) and main-side session/build validation so the
 * two sides cannot drift — the same pattern as `piModelCompatibility.ts`.
 * No service imports, no runtime state.
 *
 * The AI SDK agent runtime drives the selected provider/model through the
 * existing `providerToAiSdkConfig` pipeline, so compatibility is broad:
 * anything with an AI-SDK-drivable chat endpoint qualifies, provided the
 * model natively supports function calling (the runtime is a tool loop).
 */

import { isManagedCherryAiDefaultModel } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isFunctionCallingModel } from '@shared/utils/model'
import { isExternalCliProvider } from '@shared/utils/provider'

/** Chat protocols the AI SDK parameter pipeline can drive. */
const AI_SDK_AGENT_CHAT_ENDPOINTS: ReadonlySet<EndpointType> = new Set([
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  ENDPOINT_TYPE.OLLAMA_CHAT,
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES
])

/**
 * Whether the effective chat endpoint is AI-SDK-drivable. An undeclared
 * endpoint is drivable: `providerToAiSdkConfig` falls back to the
 * openai-compatible chat builder. Non-chat endpoint families (rerank,
 * embeddings, image/audio/video, text completions) are not.
 */
export function isAiSdkAgentDrivableEndpoint(endpointType: EndpointType | undefined): boolean {
  return endpointType === undefined || AI_SDK_AGENT_CHAT_ENDPOINTS.has(endpointType)
}

/**
 * Whether an `ai-sdk` agent can use this provider+model. Fail-closed:
 *
 * - orphan models (no provider) are rejected — the runtime needs the
 *   provider's endpoint config and credentials;
 * - external-CLI login providers (e.g. Claude Code) hold no app-side
 *   credential the AI SDK pipeline could inject;
 * - the managed CherryAI free-quota default must not be driven directly,
 *   matching the pi/claude runtime rule;
 * - the model must support native function calling;
 * - the effective chat endpoint must be AI-SDK-drivable.
 */
export function isAiSdkAgentCompatibleModel(provider: Provider | undefined, model: Model): boolean {
  if (!provider) return false
  if (isExternalCliProvider(provider)) return false
  if (isManagedCherryAiDefaultModel(model.providerId, model.apiModelId ?? parseUniqueModelId(model.id).modelId)) {
    return false
  }
  if (!isFunctionCallingModel(model)) return false
  return isAiSdkAgentDrivableEndpoint(model.endpointTypes?.[0] ?? provider.defaultChatEndpoint)
}
