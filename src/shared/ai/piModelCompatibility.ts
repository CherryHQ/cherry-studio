import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isGatewayRoutableModel } from '@shared/utils/model'
import { isExternalCliProvider } from '@shared/utils/provider'

/** Native Pi protocols exposed by Cherry's internal gateway. */
export type PiApi = 'anthropic-messages' | 'openai-completions' | 'openai-responses' | 'google-generative-ai'

/** Preserve the model's protocol when possible; other upstream protocols use the gateway's OpenAI route. */
export function mapEndpointToPiApi(
  endpointType: EndpointType | undefined,
  adapterFamily: string | undefined
): PiApi | undefined {
  // Cloud authentication and deployment URLs belong to Cherry's upstream provider execution.
  if (
    adapterFamily === 'azure' ||
    adapterFamily === 'azure-responses' ||
    adapterFamily === 'bedrock' ||
    adapterFamily === 'google-vertex' ||
    adapterFamily === 'google-vertex-anthropic'
  ) {
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

/** Shared by the Pi and Durable model pickers, child catalog and gateway binding. */
export function isPiCompatibleModel(provider: Provider, model: Model): boolean {
  return !isExternalCliProvider(provider) && isGatewayRoutableModel(model)
}
