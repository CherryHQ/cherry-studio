import { hasRuntimeTransportAdapter } from '@shared/data/presets/runtimeTransport'
import { ENDPOINT_TYPE, type EndpointType, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isGatewayRoutableModel } from '@shared/utils/model'
import { getModelPreferredEndpoint, isLoginBasedProvider } from '@shared/utils/provider'

export type DshApi = 'anthropic-messages' | 'google-generative-ai' | 'openai-completions' | 'openai-responses'
export type PiApi = DshApi | 'azure-openai-responses'

type AgentRuntime = 'pi' | 'dsh'

/** Maps a resolved Cherry endpoint to a protocol supported by the runtime's injection contract. */
export function mapEndpointToAgentApi(
  runtime: 'dsh',
  endpointType: EndpointType | undefined,
  adapterFamily: string | undefined
): DshApi | undefined
export function mapEndpointToAgentApi(
  runtime: AgentRuntime,
  endpointType: EndpointType | undefined,
  adapterFamily: string | undefined
): PiApi | undefined
export function mapEndpointToAgentApi(
  runtime: AgentRuntime,
  endpointType: EndpointType | undefined,
  adapterFamily: string | undefined
): PiApi | undefined {
  // Only Pi can inject the provider environment required by Azure Responses.
  if (adapterFamily === 'azure-responses') return runtime === 'pi' ? 'azure-openai-responses' : undefined
  if (adapterFamily === 'azure') return undefined

  // Neither injection contract carries Bedrock signing or Vertex service-account credentials.
  if (adapterFamily === 'bedrock' || adapterFamily === 'google-vertex' || adapterFamily === 'google-vertex-anthropic') {
    return undefined
  }

  switch (endpointType) {
    case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
      return 'anthropic-messages'
    case ENDPOINT_TYPE.OPENAI_RESPONSES:
      return 'openai-responses'
    case ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS:
      return 'openai-completions'
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return 'google-generative-ai'
    default:
      return undefined
  }
}

/** Resolves the provider/model's native protocol; gateway fallback is evaluated separately. */
export function resolveAgentApi(runtime: 'dsh', provider: Provider, model: Model): DshApi | undefined
export function resolveAgentApi(runtime: AgentRuntime, provider: Provider, model: Model): PiApi | undefined
export function resolveAgentApi(runtime: AgentRuntime, provider: Provider, model: Model): PiApi | undefined {
  // App-managed OAuth depends on Pi's per-request transport injection, absent in the DSH subprocess.
  if (isLoginBasedProvider(provider) && (runtime === 'dsh' || !hasRuntimeTransportAdapter(provider.id)))
    return undefined
  const endpointType = getModelPreferredEndpoint(model, provider, MODEL_CAPABILITY.TEXT_GENERATION)
  const adapterFamily = endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined
  return mapEndpointToAgentApi(runtime, endpointType, adapterFamily)
}

/** Whether the runtime can use this model, including DSH's gateway fallback. Used for renderer filtering. */
export function isAgentCompatibleModel(runtime: AgentRuntime, provider: Provider, model: Model): boolean {
  return resolveAgentApi(runtime, provider, model) !== undefined || (runtime === 'dsh' && isGatewayRoutableModel(model))
}
