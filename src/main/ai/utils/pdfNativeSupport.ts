/**
 * Whether the active provider/model accepts a native `file` part with
 * `mediaType: 'application/pdf'`.
 *
 * Lives here (not in features/pdfCompatibility) so tools can import the
 * gating predicate without pulling in the LMv3 middleware module — that
 * module also imports tool-side code, and we'd otherwise close a cycle.
 */

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isAnthropicModel, isGeminiModel, isOpenAILLMModel } from '@shared/utils/model'

import { getAiSdkProviderId } from '../provider/factory'
import type { AppProviderId } from '../types'

/**
 * AI SDK provider ids whose API natively supports PDF file input.
 *
 * Only first-party provider protocols (OpenAI Responses, Anthropic, Google)
 * plus cloud-hosted variants are included. Aggregators / generic
 * openai-compatible endpoints are excluded because they may route to
 * backends that reject the `file` part type.
 */
const PDF_NATIVE_PROVIDER_IDS = new Set<AppProviderId>([
  'openai-responses',
  'anthropic',
  'google',
  'azure',
  'azure-responses',
  'google-vertex',
  'amazon-bedrock',
  'anthropic-vertex'
])

export function supportsNativePdf(provider: Provider, model: Model): boolean {
  if (isOpenAILLMModel(model) || isAnthropicModel(model) || isGeminiModel(model)) return true
  return PDF_NATIVE_PROVIDER_IDS.has(getAiSdkProviderId(provider))
}
